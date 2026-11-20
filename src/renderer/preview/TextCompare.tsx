// Two documents compared word by word (DOCX, XLSX, TXT, or a PDF's text): A | B side by side, removed words struck in red on
// the left, added words in green on the right, or one column with both (Vienā kolonnā). Next / previous jump between the changes.
// The text is the scanner's own (sources keep it), so it is what the agent quotes; main sends it, the diff is shared/compare2d.
import { useMemo, useRef, useState } from "react";
import { textDiff, type DiffPart } from "../../shared/compare2d";
import { call } from "../bridge";
import { ui } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";
import { tr } from "../i18n";

type Mode = "split" | "inline";

export function TextCompare({ projectId, a, b, aLabel, bLabel }: { projectId: string; a: string; b: string; aLabel: string; bLabel: string }) {
	const t = useLoad(() => call("compare.text", projectId, a, b), [projectId, a, b]);
	const diff = useMemo(() => (t.data ? textDiff(t.data.a, t.data.b) : null), [t.data]);
	const [mode, setMode] = useState<Mode>("split");
	const [at, setAt] = useState(-1);
	const body = useRef<HTMLDivElement>(null);
	if (t.error) return <Err error={t.error} />;
	if (!t.data || !diff) return <Empty title={tr("salīdzina tekstu…")} />;
	const changes = diff.parts.map((p, i) => (p.op === "same" ? -1 : i)).filter((i) => i >= 0);
	const jump = (dir: 1 | -1) => {
		if (!changes.length) return;
		const k = changes.findIndex((i) => i > at);
		const next = dir === 1 ? changes[k === -1 ? 0 : k] : changes[(changes.findIndex((i) => i >= at) - 1 + changes.length) % changes.length] ?? changes[changes.length - 1];
		setAt(next);
		body.current?.querySelector(`[data-part="${next}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
	};
	const part = (p: DiffPart, i: number, side: "a" | "b" | "both") => {
		if (p.op === "same") return <span key={i}>{p.text}</span>;
		if ((p.op === "del" && side === "b") || (p.op === "add" && side === "a")) return null;
		return (
			<span key={i} data-part={i} className={`tdiff-${p.op} ${at === i ? "cur" : ""}`} onClick={() => setAt(i)} title={tr("klikšķis: šī izmaiņa")}>
				{p.text}
			</span>
		);
	};
	const cur = at >= 0 ? diff.parts[at] : null;
	return (
		<div className="fill-col">
			<div className="viewer-bar">
				<b>{aLabel}</b> → <b>{bLabel}</b>
				<div className="seg">
					<button className={mode === "split" ? "on" : ""} onClick={() => setMode("split")}>
						{tr("A | B")}
					</button>
					<button className={mode === "inline" ? "on" : ""} onClick={() => setMode("inline")}>
						{tr("Vienā kolonnā")}
					</button>
				</div>
				<Badge tone="ok">{tr("+{n} vārdi", { n: diff.added })}</Badge>
				<Badge tone="bad">{tr("−{n} vārdi", { n: diff.removed })}</Badge>
				{diff.coarse && <Badge tone="warn">{tr("pa rindām: garš dokuments")}</Badge>}
				<button className="small" onClick={() => jump(-1)} disabled={!changes.length}>
					↑ {tr("iepriekšējā")}
				</button>
				<button className="small" onClick={() => jump(1)} disabled={!changes.length}>
					↓ {tr("nākamā")}
				</button>
				<span className="grow" />
				{cur && (
					<button className="small ghost" onClick={() => ui.focusAdd({ kind: "text", id: `tdiff:${a}:${b}:${at}`, label: `${cur.op === "add" ? "+" : "−"} ${cur.text.trim()}`.slice(0, 60), data: { a: aLabel, b: bLabel, change: cur.op === "add" ? "pievienots" : "noņemts", text: cur.text.trim().slice(0, 2000) } })}>
						{tr("→ aģentam")}
					</button>
				)}
			</div>
			{t.data.note && <div className="warn-line small">{t.data.note}</div>}
			{!changes.length ? (
				<Empty title={tr("teksts nav mainījies")}>{tr("Abos dokumentos ir tie paši vārdi.")}</Empty>
			) : mode === "split" ? (
				<div ref={body} className="tdiff-split">
					<div className="tdiff-col">
						<div className="dwg-split-label">A · {aLabel}</div>
						<div className="tdiff-text">{diff.parts.map((p, i) => part(p, i, "a"))}</div>
					</div>
					<div className="tdiff-col">
						<div className="dwg-split-label">B · {bLabel}</div>
						<div className="tdiff-text">{diff.parts.map((p, i) => part(p, i, "b"))}</div>
					</div>
				</div>
			) : (
				<div ref={body} className="tdiff-one">
					<div className="tdiff-text">{diff.parts.map((p, i) => part(p, i, "both"))}</div>
				</div>
			)}
		</div>
	);
}
