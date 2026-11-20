// DWG in the viewer: one drawing (DwgView), or two issues compared (DwgCompareView) as CadCraft's DWGCOMPARE sees them —
// objects added (green), removed (red) and changed (old orange, new blue) — either over the newer drawing (Pārklājums) or
// A | B side by side at the same place and zoom. The change list beside it flies to a change and gives it to the agent.
// Main reads the drawings (src/sources/dwg.ts); here they are only drawn (DwgCanvas).
import { useMemo, useState } from "react";
import type { DwgCompareSpace } from "../../shared/compare2d";
import { call } from "../bridge";
import { ui } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";
import { tr } from "../i18n";
import { DwgCanvas, type DrawLayer, type View2d } from "./DwgCanvas";
import { CadView, type CadMarks, type CadViewState } from "./CadView";

const INK = "#222";
const GREY = "#9aa0a6";
const ADD = "#1a9c3c";
const REM = "#d93025";
const OLD = "#e8710a";
const NEW = "#1a73e8";

const spaceName = (n: string) => (n === "" ? tr("Modelis") : n);

/** CadCraft installed: DWG opens in it; else (a build without resources/cadcraft) the plain line view below. */
const useCraft = () => useLoad(() => call("dwg.craft"), []);

export function DwgView({ projectId, path, title }: { projectId: string; path: string; title: string }) {
	const craft = useCraft();
	if (craft.data === null && !craft.error) return <Empty title={tr("atver DWG…")} />;
	if (craft.data)
		return (
			<div className="fill-col">
				<CadView projectId={projectId} path={path} name={title} />
			</div>
		);
	return <DwgLines projectId={projectId} path={path} title={title} />;
}

function DwgLines({ projectId, path, title }: { projectId: string; path: string; title: string }) {
	const d = useLoad(() => call("dwg.view", projectId, path), [projectId, path]);
	const [space, setSpace] = useState(0);
	if (d.error) return <Err error={d.error} />;
	if (!d.data) return <Empty title={tr("lasa DWG…")} />;
	const s = d.data.spaces[space] ?? d.data.spaces[0];
	if (!s?.lines.length) return <Empty title={tr("no data")}>{tr("Zīmējumā nav līniju, ko parādīt.")}</Empty>;
	return (
		<div className="fill-col">
			<div className="viewer-bar">
				<b>{title}</b>
				<SpacePick names={d.data.spaces.map((x) => x.name)} value={space} onChange={setSpace} />
				<span className="dim small">{tr("{n} objekti", { n: d.data.objects })}</span>
				{d.data.silent > 0 && <span className="dim small" title={tr("Punkti, attēli un veidi, ko lasītājs neuzzīmē")}>{tr("{n} bez līnijām", { n: d.data.silent })}</span>}
				<span className="grow" />
				<span className="dim small">{tr("velc: pārvietot · ritenis: tuvināt · dubultklikšķis: viss")}</span>
			</div>
			<DwgCanvas key={`${path}:${space}`} layers={[{ lines: s.lines, color: INK }]} bounds={s.bounds} />
		</div>
	);
}

function SpacePick({ names, value, onChange }: { names: string[]; value: number; onChange: (i: number) => void }) {
	if (names.length < 2) return null;
	return (
		<select value={value} onChange={(e) => onChange(Number(e.target.value))} title={tr("Modelis vai lapa")}>
			{names.map((n, i) => (
				<option key={i} value={i}>
					{spaceName(n)}
				</option>
			))}
		</select>
	);
}

type Mode = "overlay" | "split";

export function DwgCompareView({ projectId, a, b, aLabel, bLabel }: { projectId: string; a: string; b: string; aLabel: string; bLabel: string }) {
	const craft = useCraft();
	const d = useLoad(() => call("dwg.compare", projectId, a, b), [projectId, a, b]);
	// CadCraft frames: the linked view (A | B) and a picked change to fly to
	const [cadView, setCadView] = useState<{ from: "a" | "b"; v: CadViewState } | null>(null);
	const [flyN, setFlyN] = useState(0);
	const [space, setSpace] = useState(0);
	const [mode, setMode] = useState<Mode>("overlay");
	const [view, setView] = useState<View2d | null>(null);
	const [picked, setPicked] = useState<number | null>(null);
	const s: DwgCompareSpace | undefined = d.data?.spaces[space] ?? d.data?.spaces[0];
	const layers = useMemo(() => {
		if (!s) return { over: [], left: [], right: [] };
		const over: DrawLayer[] = [
			{ lines: s.base, color: GREY },
			{ lines: s.removed, color: REM, width: 2 },
			{ lines: s.changedOld, color: OLD, width: 1.5, dash: [5, 4] },
			{ lines: s.added, color: ADD, width: 2 },
			{ lines: s.changedNew, color: NEW, width: 2 },
		];
		const left: DrawLayer[] = [{ lines: s.baseA, color: GREY }, { lines: s.removed, color: REM, width: 2 }, { lines: s.changedOld, color: OLD, width: 2 }];
		const right: DrawLayer[] = [{ lines: s.base, color: GREY }, { lines: s.added, color: ADD, width: 2 }, { lines: s.changedNew, color: NEW, width: 2 }];
		return { over, left, right };
	}, [s]);
	if (d.error) return <Err error={d.error} />;
	if (!d.data || !s) return <Empty title={tr("salīdzina DWG…")} />;
	const onCraft = !!craft.data;
	const marksOf = (side: "a" | "b" | "both"): CadMarks[] =>
		d.data!.spaces.map((x) => ({
			name: x.name,
			sets: [
				...(side !== "b" ? [{ lines: x.removed, color: REM, width: 2 }, { lines: x.changedOld, color: OLD, width: side === "both" ? 1.5 : 2, ...(side === "both" ? { dash: [5, 4] } : {}) }] : []),
				...(side !== "a" ? [{ lines: x.added, color: ADD, width: 2 }, { lines: x.changedNew, color: NEW, width: 2 }] : []),
			],
		}));
	const flyTo = picked !== null && s.changes[picked] ? { x: s.changes[picked].x, y: s.changes[picked].y, n: flyN } : null;
	const t = d.data.totals;
	const marker = picked !== null ? s.changes[picked] : null;
	const fly = (i: number) => {
		const c = s.changes[i];
		setPicked(i);
		setFlyN((n) => n + 1);
		// the change in the middle, closer in than the whole drawing
		setView((v) => ({ cx: c.x, cy: c.y, scale: Math.max(v?.scale ?? 1, (v?.scale ?? 1) * 4) }));
	};
	return (
		<div className="fill-col">
			<div className="viewer-bar">
				<b>{aLabel}</b> → <b>{bLabel}</b>
				<SpacePick
					names={d.data.spaces.map((x) => x.name)}
					value={space}
					onChange={(i) => {
						setSpace(i);
						setView(null);
						setPicked(null);
					}}
				/>
				<div className="seg">
					<button className={mode === "overlay" ? "on" : ""} onClick={() => setMode("overlay")} title={tr("Izmaiņas virs jaunākā zīmējuma")}>
						{tr("Pārklājums")}
					</button>
					<button className={mode === "split" ? "on" : ""} onClick={() => setMode("split")} title={tr("A pa kreisi, B pa labi, viena vieta un mērogs")}>
						{tr("A | B")}
					</button>
				</div>
				<Badge tone="ok">{tr("+{n} jauni", { n: t.added })}</Badge>
				<Badge tone="bad">{tr("−{n} noņemti", { n: t.removed })}</Badge>
				<Badge tone="info">{tr("{n} mainīti", { n: t.changed })}</Badge>
				<span className="dim small">{tr("{n} bez izmaiņām", { n: t.same })}</span>
				{s.onlyIn && <Badge tone="dim">{s.onlyIn === "a" ? tr("lapa tikai A") : tr("lapa tikai B")}</Badge>}
			</div>
			<div className="split" style={{ gridTemplateColumns: "minmax(0,1fr) 300px", flex: 1, minHeight: 0 }}>
				{onCraft ? (
					mode === "overlay" ? (
						<CadView key="o" projectId={projectId} path={b} name={bLabel} label={tr("B ar izmaiņām · {l}", { l: bLabel })} marks={marksOf("both")} fly={flyTo} />
					) : (
						<div className="dwg-split">
							<CadView key="a" projectId={projectId} path={a} name={aLabel} label={`A · ${aLabel}`} marks={marksOf("a")} fly={flyTo} view={cadView?.from === "b" ? cadView.v : null} onView={(v) => setCadView({ from: "a", v })} />
							<CadView key="b" projectId={projectId} path={b} name={bLabel} label={`B · ${bLabel}`} marks={marksOf("b")} fly={flyTo} view={cadView?.from === "a" ? cadView.v : null} onView={(v) => setCadView({ from: "b", v })} />
						</div>
					)
				) : mode === "overlay" ? (
					<DwgCanvas key={`o:${space}`} layers={layers.over} bounds={s.bounds} view={view} onView={setView} marker={marker} />
				) : (
					<div className="dwg-split">
						<div className="dwg-split-side">
							<div className="dwg-split-label">A · {aLabel}</div>
							<DwgCanvas key={`a:${space}`} layers={layers.left} bounds={s.bounds} view={view} onView={setView} marker={marker} />
						</div>
						<div className="dwg-split-side">
							<div className="dwg-split-label">B · {bLabel}</div>
							<DwgCanvas key={`b:${space}`} layers={layers.right} bounds={s.bounds} view={view} onView={setView} marker={marker} />
						</div>
					</div>
				)}
				<div className="pane fill" style={{ borderLeft: "1px solid var(--border)" }}>
					<div className="section-title">{tr("Izmaiņas ({n})", { n: s.changes.length })}</div>
					{(d.data.layersAdded.length > 0 || d.data.layersRemoved.length > 0) && (
						<div className="dim small" style={{ padding: "0 10px 6px" }}>
							{d.data.layersAdded.length > 0 && <div>{tr("Jauni slāņi: {l}", { l: d.data.layersAdded.join(", ") })}</div>}
							{d.data.layersRemoved.length > 0 && <div>{tr("Noņemti slāņi: {l}", { l: d.data.layersRemoved.join(", ") })}</div>}
						</div>
					)}
					{s.changes.length === 0 && <div className="dim" style={{ padding: "0 10px" }}>{tr("Šajā telpā izmaiņu nav.")}</div>}
					{s.changes.map((c, i) => (
						<div key={i} className={`row small dwg-change ${picked === i ? "sel" : ""}`} onClick={() => fly(i)}>
							<span className="dwg-dot" style={{ background: c.what === "added" ? ADD : c.what === "removed" ? REM : NEW }} />
							<span className="grow">
								{c.label}
								{c.detail.length > 0 && <span className="dim"> · {c.detail.join(", ")}</span>}
							</span>
							<button
								className="small ghost"
								onClick={(e) => {
									e.stopPropagation();
									ui.focusAdd({ kind: "text", id: `dwg:${a}:${b}:${space}:${i}`, label: `${c.what}: ${c.label}`.slice(0, 60), data: { a: aLabel, b: bLabel, sheet: spaceName(s.name), change: c.what, object: c.label, detail: c.detail, at: [Math.round(c.x), Math.round(c.y)] } });
								}}
							>
								{tr("→ aģentam")}
							</button>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
