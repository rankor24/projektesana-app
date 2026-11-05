import { useEffect, useMemo, useState } from "react";
import { api, onAgent } from "../api";
import { Badge, Empty, Err, useAction, useLoad } from "../ui";
import { PdfViewer } from "./PdfViewer";
import { IfcViewer, type Picked } from "./IfcViewer";
import type { AgentEvent, Pin, RevisionData, RevisionRow, RevitState, ReviewState } from "../types";

type Tab = "pages" | "model" | "compare" | "diff";
const STATE_LABEL: Record<ReviewState, string> = { new: "jauns", commented: "komentēts", approved: "apstiprināts" };
const revFile = (rev: string, f: string) => `.bv/revisions/${rev}/${f}`;

export function Views({ root }: { root: string }) {
	const revs = useLoad(() => api<RevisionRow[]>("revisionsList", root), [root]);
	const [rev, setRev] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>("pages");
	const act = useAction();

	useEffect(() => {
		if (!rev && revs.data?.length) setRev(revs.data[revs.data.length - 1].id);
	}, [revs.data, rev]);

	const data = useLoad(() => (rev ? api<RevisionData>("revisionGet", root, rev) : Promise.resolve(null)), [root, rev]);
	const refresh = () => {
		revs.reload();
		data.reload();
	};

	return (
		<>
			<h1>Skati — PDF un IFC</h1>
			<Modelling root={root} onRevision={(id) => (revs.reload(), setRev(id))} />
			<Err text={act.err ?? revs.err} />
			{revs.data?.length === 0 && <Empty>Nav revīziju. Revīzija rodas pēc aģenta partijas (augstāk) — PDF lapas un IFC modelis parādās šeit, līdz tu tos apstiprini.</Empty>}
			{revs.data && revs.data.length > 0 && (
				<>
					<div className="row" style={{ marginBottom: 8 }}>
						{revs.data.map((r) => (
							<button key={r.id} className={`btn ${r.id === rev ? "primary" : ""}`} onClick={() => setRev(r.id)}>
								{r.id} <span style={{ opacity: 0.8 }}>· {r.approved}/{r.items}</span>
							</button>
						))}
						{rev && revs.data.find((r) => r.id === rev)?.complete && (
							<button
								className="btn primary"
								onClick={async () => {
									const out = await act.run(() => api<string>("publish", root, rev));
									if (out) alert(`Apstiprinātā revīzija nokopēta uz:\n${out}`);
								}}
							>
								Nodot apstiprināto (approved/{rev})
							</button>
						)}
					</div>
					<div className="tabs">
						{(
							[
								["pages", "Lapas (PDF)"],
								["model", "Modelis (IFC)"],
								["compare", "Salīdzināt revīzijas"],
								["diff", "Atšķirības"],
							] as [Tab, string][]
						).map(([t, l]) => (
							<button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
								{l}
							</button>
						))}
					</div>
					{data.err && <Err text={data.err} />}
					{rev && data.data && tab === "pages" && <Pages root={root} rev={rev} d={data.data} onChange={refresh} />}
					{rev && data.data && tab === "model" && <Model root={root} rev={rev} d={data.data} onChange={refresh} />}
					{tab === "compare" && <Compare root={root} revs={revs.data} />}
					{data.data && tab === "diff" && <Diff d={data.data} />}
				</>
			)}
		</>
	);
}

// ---- modelling panel ---------------------------------------------------------

function Modelling({ root, onRevision }: { root: string; onRevision: (id: string) => void }) {
	const st = useLoad(() => api<RevitState>("revitStatus"), []);
	const wc = useLoad(() => api<{ workPath: string | null }>("modellingGet", root), [root]);
	const act = useAction();
	const [name, setName] = useState("");
	const [instruction, setInstruction] = useState("Izveido skiču modeli no brief: līmeņus, sienas, telpas ar platībām un skatus (stāvu plāns, fasādes).");
	const [events, setEvents] = useState<AgentEvent[]>([]);
	useEffect(() => onAgent((e) => setEvents((x) => [...x.slice(-300), e])), []);

	async function run() {
		setEvents([]);
		const r = await act.run(() => api<{ ok: boolean; id: string; reason?: string; manifest?: { id: string } }>("batchRun", root, instruction));
		if (r && !r.ok) act.setErr(r.reason ?? "Partija neizdevās.");
		if (r?.ok && r.manifest) onRevision(r.manifest.id);
	}
	const connected = st.data?.state === "connected";
	return (
		<details className="card" open={!wc.data?.workPath}>
			<summary>
				<b>Modelēšana (Revit)</b> {st.data && <Badge kind={connected ? "ok" : "warn"}>{st.data.state}</Badge>} {wc.data?.workPath ? <span className="mono muted">{wc.data.workPath}</span> : <Badge kind="warn">nav darba kopijas</Badge>}
			</summary>
			<div style={{ marginTop: 8 }}>
				{st.data && st.data.state !== "connected" && <div className="muted">{st.data.state === "not configured" ? "Revit MCP serveris nav konfigurēts (Iestatījumi)." : (st.data as { reason: string }).reason}</div>}
				<div className="row" style={{ margin: "6px 0" }}>
					<button className="btn" onClick={st.reload}>
						Pārbaudīt Revit
					</button>
					<input type="text" placeholder="Darba kopijas nosaukums" value={name} onChange={(e) => setName(e.target.value)} />
					<button
						className="btn"
						disabled={!connected || !name.trim() || act.busy}
						title="Saglabā aktīvo Revit dokumentu kā Modelis/<nosaukums>_WORK.rvt; oriģināls netiek mainīts"
						onClick={async () => {
							await act.run(() => api("modellingCreateWorkCopy", root, name));
							wc.reload();
						}}
					>
						Izveidot darba kopiju no aktīvā dokumenta
					</button>
					<button
						className="btn"
						disabled={!connected || act.busy}
						onClick={async () => {
							await act.run(() => api("modellingUseActive", root));
							wc.reload();
						}}
					>
						Izmantot atvērto _WORK.rvt
					</button>
				</div>
				<div className="row" style={{ margin: "6px 0" }}>
					<button
						className="btn"
						disabled={!connected || !wc.data?.workPath || act.busy}
						title="Izveido stāvu plānus līmeņiem, kuriem tie nav, uzliek mērogu 1:100 un, ja nav fasāžu, izveido četras"
						onClick={async () => {
							const r = await act.run(() => api<{ createdPlans: string[]; elevations: string[] }>("modellingPrepareViews", root, 100));
							if (r) alert(`Izveidoti plāni: ${r.createdPlans.join(", ") || "—"}\nFasādes: ${r.elevations.join(", ") || "—"}`);
						}}
					>
						Sagatavot skatus (plāni, mērogs, fasādes)
					</button>
				</div>
				<textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} />
				<div className="row" style={{ marginTop: 6 }}>
					<button className="btn primary" disabled={act.busy || !wc.data?.workPath || !connected} onClick={run}>
						{act.busy ? "Aģents strādā…" : "Palaist partiju"}
					</button>
					{act.busy && (
						<button className="btn danger" onClick={() => api("agentStop")}>
							Apturēt
						</button>
					)}
					<span className="muted">Aģents strādā tikai darba kopijā. Pēc partijas Revit eksportē PDF un IFC; apstiprina tikai Boriss.</span>
				</div>
				<Err text={act.err} />
				{events.length > 0 && (
					<div className="activity">
						{events.filter((e) => e.type === "tool" || e.type === "error" || e.type === "text").map((e, i) => (
							<div key={i}>{e.type === "tool" ? `▸ ${e.name}` : e.type === "error" ? `✖ ${e.message}` : (e as { text: string }).text.slice(0, 200)}</div>
						))}
					</div>
				)}
			</div>
		</details>
	);
}

// ---- pages -------------------------------------------------------------------

function ReviewButtons({ state, onSet }: { state: ReviewState; onSet: (s: ReviewState) => void }) {
	return state === "approved" ? (
		<button className="btn" onClick={() => onSet("commented")}>
			Atcelt apstiprinājumu
		</button>
	) : (
		<button className="btn primary" onClick={() => onSet("approved")}>
			Apstiprināt
		</button>
	);
}

function PinList({ root, pins, onChange }: { root: string; pins: Pin[]; onChange: () => void }) {
	const act = useAction();
	const [coords, setCoords] = useState<Record<string, string>>({});
	return (
		<div>
			<Err text={act.err} />
			{pins.length === 0 && <div className="muted">Nav pin.</div>}
			{pins.map((p, i) => (
				<div key={p.id} style={{ padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
					<div className="row">
						<b>{i + 1}.</b>
						<Badge kind={p.state === "open" ? "warn" : p.state === "addressed" ? undefined : "ok"}>{p.state === "open" ? "atvērts" : p.state === "addressed" ? "aģents atbildējis" : "aizvērts"}</Badge>
						<span className="mono muted">{p.target.kind === "pdf" ? p.target.sheet : `IFC ${p.target.guid}`}</span>
					</div>
					<div>{p.text}</div>
					{p.agentNote && <div className="quote">Aģents: {p.agentNote}</div>}
					<div className="row">
						{p.state !== "closed" && (
							<button className="btn" onClick={async () => (await act.run(() => api("pinClose", root, p.id)), onChange())}>
								Aizvērt
							</button>
						)}
						{p.state !== "open" && (
							<button className="btn" onClick={async () => (await act.run(() => api("pinReopen", root, p.id)), onChange())}>
								Atvērt vēlreiz
							</button>
						)}
						{p.target.kind === "pdf" && (
							<button
								className="btn"
								title="Pin pozīcija modeļa koordinātēs (mm), no skata apgriešanas rāmja un mēroga"
								onClick={async () => {
									const r = await act.run(() => api<{ x: number; y: number; z: number; levelName: string | null }>("pinToModel", root, p.id));
									if (r) setCoords((c) => ({ ...c, [p.id]: `x ${r.x} · y ${r.y} · z ${r.z} mm${r.levelName ? ` · ${r.levelName}` : ""}` }));
								}}
							>
								Modeļa koordinātes
							</button>
						)}
					</div>
					{coords[p.id] && <div className="mono">{coords[p.id]}</div>}
				</div>
			))}
		</div>
	);
}

function Pages({ root, rev, d, onChange }: { root: string; rev: string; d: RevisionData; onChange: () => void }) {
	const pages = d.manifest?.pages ?? [];
	const [file, setFile] = useState<string | null>(null);
	const cur = file ?? pages[0]?.file ?? null;
	const [placing, setPlacing] = useState(false);
	const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
	const [text, setText] = useState("");
	const act = useAction();
	const pagePins = useMemo(() => d.pins.filter((p) => p.target.kind === "pdf" && p.target.sheet === cur), [d.pins, cur]);
	const state = d.review.find((r) => r.item === cur)?.state ?? "new";

	async function savePin() {
		if (!spot || !cur) return;
		const viewId = Number(pages.find((p) => p.file === cur)?.viewId ?? NaN);
		const ok = await act.run(() => api("pinAdd", root, rev, { kind: "pdf", sheet: cur, page: 1, x: spot.x, y: spot.y, viewId: Number.isFinite(viewId) ? viewId : null }, text));
		if (ok) {
			setSpot(null);
			setText("");
			setPlacing(false);
			onChange();
		}
	}
	if (!cur) return <Empty>Šajā revīzijā nav lapu.</Empty>;
	return (
		<div className="split" style={{ gridTemplateColumns: "180px 1fr 320px" }}>
			<div>
				{pages.map((p) => {
					const s = d.review.find((r) => r.item === p.file)?.state ?? "new";
					return (
						<button key={p.file} className={`nav ${p.file === cur ? "on" : ""}`} style={{ padding: "6px 8px" }} onClick={() => (setFile(p.file), setSpot(null), setPlacing(false))}>
							<span style={{ flex: 1 }}>{p.viewName}</span>
							<Badge kind={s === "approved" ? "ok" : s === "commented" ? "warn" : undefined}>{STATE_LABEL[s]}</Badge>
						</button>
					);
				})}
			</div>
			<div>
				<div className="row" style={{ marginBottom: 6 }}>
					<b>{pages.find((p) => p.file === cur)?.viewName}</b>
					<Badge kind={state === "approved" ? "ok" : state === "commented" ? "warn" : undefined}>{STATE_LABEL[state]}</Badge>
					<span className="grow" />
					<button className={`btn ${placing ? "primary" : ""}`} onClick={() => (setPlacing(!placing), setSpot(null))}>
						{placing ? "Klikšķini uz lapas…" : "Pievienot pin"}
					</button>
					<ReviewButtons
						state={state}
						onSet={async (s) => {
							await act.run(() => api("reviewSet", root, rev, cur, s));
							onChange();
						}}
					/>
				</div>
				<Err text={act.err} />
				<PdfViewer root={root} file={revFile(rev, cur)} pins={pagePins} placing={placing} onPlace={(x, y) => setSpot({ x, y })} onPinClick={() => {}} />
				{spot && (
					<div className="card" style={{ marginTop: 8 }}>
						<div className="muted">Pin pozīcija: {spot.x.toFixed(3)}, {spot.y.toFixed(3)}</div>
						<textarea autoFocus value={text} placeholder="Ko aģentam labot šeit?" onChange={(e) => setText(e.target.value)} />
						<div className="row">
							<button className="btn primary" disabled={!text.trim() || act.busy} onClick={savePin}>
								Saglabāt pin
							</button>
							<button className="btn" onClick={() => setSpot(null)}>
								Atcelt
							</button>
						</div>
					</div>
				)}
			</div>
			<div className="card">
				<h3>Pin un komentāri (šai lapai)</h3>
				<PinList root={root} pins={pagePins} onChange={onChange} />
			</div>
		</div>
	);
}

// ---- model -------------------------------------------------------------------

function Model({ root, rev, d, onChange }: { root: string; rev: string; d: RevisionData; onChange: () => void }) {
	const [picked, setPicked] = useState<Picked | null>(null);
	const [text, setText] = useState("");
	const act = useAction();
	const modelPins = d.pins.filter((p) => p.target.kind === "ifc");
	const state = d.review.find((r) => r.item === "model.ifc")?.state ?? "new";
	const [hl, setHl] = useState<string[]>([]);
	return (
		<div className="split">
			<div>
				<div className="row" style={{ marginBottom: 6 }}>
					<Badge kind={state === "approved" ? "ok" : state === "commented" ? "warn" : undefined}>{STATE_LABEL[state]}</Badge>
					<span className="grow" />
					<ReviewButtons
						state={state}
						onSet={async (s) => {
							await act.run(() => api("reviewSet", root, rev, "model.ifc", s));
							onChange();
						}}
					/>
				</div>
				<Err text={act.err} />
				<IfcViewer root={root} file={revFile(rev, "model.ifc")} highlight={hl} onPick={setPicked} />
				{picked && (
					<div className="card" style={{ marginTop: 8 }}>
						<b>{picked.type}</b> {picked.name} <span className="mono muted">{picked.guid}</span>
						<textarea value={text} placeholder="Komentārs šim elementam" onChange={(e) => setText(e.target.value)} />
						<button
							className="btn primary"
							disabled={!text.trim() || act.busy}
							onClick={async () => {
								if (await act.run(() => api("pinAdd", root, rev, { kind: "ifc", guid: picked.guid }, text))) {
									setText("");
									onChange();
								}
							}}
						>
							Pievienot pin elementam
						</button>
					</div>
				)}
			</div>
			<div className="card">
				<h3>Pin modelim</h3>
				<PinList root={root} pins={modelPins} onChange={onChange} />
				{modelPins.length > 0 && (
					<button className="btn" onClick={() => setHl(modelPins.flatMap((p) => (p.target.kind === "ifc" ? [p.target.guid] : [])))}>
						Izcelt visus modelī
					</button>
				)}
				{d.summary && (
					<>
						<h3 style={{ marginTop: 12 }}>Kopsavilkums</h3>
						<div className="muted">
							Līmeņi: {d.summary.levels.length} · sienas: {d.summary.walls} · grīdas: {d.summary.floors}
						</div>
						<table>
							<tbody>
								{d.summary.rooms.map((r) => (
									<tr key={r.id}>
										<td>{r.name}</td>
										<td>{r.level}</td>
										<td>{r.areaM2} m²</td>
									</tr>
								))}
							</tbody>
						</table>
					</>
				)}
			</div>
		</div>
	);
}

// ---- compare -----------------------------------------------------------------

function Compare({ root, revs }: { root: string; revs: RevisionRow[] }) {
	const ids = revs.map((r) => r.id);
	const [a, setA] = useState(ids[Math.max(0, ids.length - 2)]);
	const [b, setB] = useState(ids[ids.length - 1]);
	const da = useLoad(() => api<RevisionData>("revisionGet", root, a), [root, a]);
	const db = useLoad(() => api<RevisionData>("revisionGet", root, b), [root, b]);
	const common = (da.data?.manifest?.pages ?? []).map((p) => p.file).filter((f) => db.data?.manifest?.pages.some((p) => p.file === f));
	const [file, setFile] = useState<string | null>(null);
	const cur = file && common.includes(file) ? file : common[0];
	if (ids.length < 2) return <Empty>Salīdzināšanai vajag vismaz divas revīzijas.</Empty>;
	return (
		<>
			<div className="row" style={{ marginBottom: 8 }}>
				<select value={a} onChange={(e) => setA(e.target.value)}>
					{ids.map((i) => (
						<option key={i}>{i}</option>
					))}
				</select>
				<span>↔</span>
				<select value={b} onChange={(e) => setB(e.target.value)}>
					{ids.map((i) => (
						<option key={i}>{i}</option>
					))}
				</select>
				<select value={cur ?? ""} onChange={(e) => setFile(e.target.value)}>
					{common.map((f) => (
						<option key={f}>{f}</option>
					))}
				</select>
			</div>
			{!cur ? (
				<Empty>Šīm revīzijām nav kopēju lapu.</Empty>
			) : (
				<div className="row" style={{ alignItems: "flex-start" }}>
					<div>
						<b>{a}</b>
						<PdfViewer root={root} file={revFile(a, cur)} pins={[]} placing={false} onPlace={() => {}} onPinClick={() => {}} width={520} />
					</div>
					<div>
						<b>{b}</b>
						<PdfViewer root={root} file={revFile(b, cur)} pins={[]} placing={false} onPlace={() => {}} onPinClick={() => {}} width={520} />
					</div>
				</div>
			)}
		</>
	);
}

// ---- diff --------------------------------------------------------------------

function Diff({ d }: { d: RevisionData }) {
	if (!d.diff) return <Empty>Šī ir pirmā revīzija vai iepriekšējai nav IFC — nav ar ko salīdzināt.</Empty>;
	const { ifc, rooms } = d.diff;
	const n = ifc.added.length + ifc.removed.length + ifc.moved.length + ifc.changed.length + rooms.added.length + rooms.removed.length + rooms.areaChanged.length;
	return (
		<>
			<div className="muted">Salīdzinājums ar {d.diff.against} (IFC pēc GlobalId; telpas pēc Id).</div>
			{n === 0 && <Empty>Atšķirību nav.</Empty>}
			<div className="grid">
				{(
					[
						["Pievienoti elementi", ifc.added.map((x) => `${x.type} ${x.guid}`)],
						["Izņemti elementi", ifc.removed.map((x) => `${x.type} ${x.guid}`)],
						["Pārbīdīti", ifc.moved.map((x) => `${x.type} ${x.guid}: ${x.from} → ${x.to}`)],
						["Mainīti", ifc.changed.map((x) => `${x.type} ${x.guid}`)],
						["Pievienotas telpas", rooms.added.map((r) => `${r.name} ${r.areaM2} m²`)],
						["Izņemtas telpas", rooms.removed.map((r) => `${r.name} ${r.areaM2} m²`)],
						["Mainīta platība", rooms.areaChanged.map((r) => `${r.name}: ${r.from} → ${r.to} m²`)],
					] as [string, string[]][]
				)
					.filter(([, l]) => l.length)
					.map(([t, l]) => (
						<div key={t} className="card">
							<h3>
								{t} ({l.length})
							</h3>
							{l.slice(0, 60).map((x, i) => (
								<div key={i} className="mono">
									{x}
								</div>
							))}
						</div>
					))}
			</div>
		</>
	);
}
