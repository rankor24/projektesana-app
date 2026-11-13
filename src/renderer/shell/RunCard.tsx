// One agent run in the dock: what was asked, the sources it touched, every step in words (open one to see the input and
// what came back), each proposed fact with its quote and a link to the page, and what the run changed in the project.
// Steps and the run box follow konkurss-app src/renderer/screens/ActivityPanel.tsx (Run, Step).
import { useEffect, useRef, useState } from "react";
import { changesText, isRunning, KIND_LABEL, type ActKind, type Activity, type RunSummary } from "../../shared/activity";
import { fmtTokens, usageText } from "../../shared/tokens";
import type { UndoRow } from "../../core/undo-types";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { useLoad } from "../ui";

const ICON: Record<ActKind | "thinking" | "note" | "confirm" | "error", string> = {
	read: "▤",
	search: "⌕",
	write: "✎",
	check: "☑",
	revit: "▦",
	ui: "◳",
	other: "·",
	thinking: "◌",
	note: "ℹ",
	confirm: "⏸",
	error: "✗",
};

const clock = (at: string) => new Date(at).toLocaleTimeString("lv-LV", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function duration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const openSource = (id: string, page?: number) => ui.show({ kind: "source", sourceId: id, page });

/** The run's summary line (the newest one, as it replaces itself). */
export const summaryOf = (lines: Activity[]): RunSummary | null => [...lines].reverse().find((l) => l.kind === "summary")?.summary ?? null;

function Mark({ status }: { status?: Activity["status"] }) {
	if (status === "running") return <span className="spin" aria-label="darbojas" />;
	if (status === "ok") return <span className="ok-mark" aria-label="izdevās">✓</span>;
	if (status === "failed") return <span className="bad-mark" aria-label="neizdevās">✗</span>;
	if (status === "stopped") return <span className="dim" aria-label="pārtraukts">—</span>;
	return null;
}

function Step({ a, live }: { a: Activity; live: boolean }) {
	const icon = a.kind === "tool" ? ICON[a.tool ?? "other"] : ICON[a.kind as "thinking" | "note" | "confirm" | "error"] ?? "·";
	const label = a.kind === "tool" ? KIND_LABEL[a.tool ?? "other"] : a.kind === "thinking" ? KIND_LABEL.thinking : "";
	const head = (
		<>
			<span className="act-ic" aria-hidden>{icon}</span>
			{label && <span className="act-kind">{label}</span>}
			<span className="act-msg">{a.text}</span>
			{a.source && !a.fact && (
				<button
					className="ghost small act-open"
					title="Atvērt avotu priekšskatā"
					onClick={(e) => {
						e.preventDefault();
						openSource(a.source!.id, a.source!.page);
					}}
				>
					↗
				</button>
			)}
			{a.chars ? <span className="dim act-cost" title="Cik konteksta aizņem šī rīka atbilde (aptuveni)">≈{fmtTokens(Math.ceil(a.chars / 3.5))}</span> : null}
			<Mark status={a.status} />
			<span className="act-t">{clock(a.at)}</span>
		</>
	);
	const fact = a.fact && (
		<div className={`act-fact ${a.status ?? ""}`}>
			{a.fact.quote && <span className="act-quote">„{a.fact.quote}”</span>}
			<button className="link small" onClick={() => openSource(a.fact!.sourceId, a.fact!.page ?? undefined)}>
				atvērt{a.fact.page ? ` lpp. ${a.fact.page}` : ""}
			</button>
			{a.status === "ok" && <span className="dim small">ieteikts — apstiprini: Projekts → profils</span>}
		</div>
	);
	const cls = `act-step k-${a.kind} ${a.tool ? `t-${a.tool}` : ""} ${a.status ?? ""} ${a.fact ? "fact" : ""}`;
	if (!a.detail)
		return (
			<div className={cls}>
				<div className="act-sum">{head}</div>
				{fact}
			</div>
		);
	return (
		<div className={cls}>
			{/* the newest thinking stays open while it is being written */}
			<details open={live && a.kind === "thinking"}>
				<summary className="act-sum">{head}</summary>
				<pre className="act-pre">{a.detail}</pre>
			</details>
			{fact}
		</div>
	);
}

function Chips({ s }: { s: RunSummary }) {
	if (!s.sources.length && s.listed === null) return null;
	const read = s.sources.filter((x) => x.state === "read").length;
	return (
		<div className="act-sources">
			<div className="dim small">
				Avoti: {read} izlasīti{s.listed !== null ? ` no ${s.listed}` : ""}
				{s.sources.some((x) => x.state === "reading") ? " · lasa" : ""}
			</div>
			<div className="act-chips">
				{s.sources.map((x) => (
					<button key={x.id} className={`act-chip ${x.state}`} title={`${x.title} — atvērt`} onClick={() => openSource(x.id)}>
						{x.state === "read" ? "✓" : x.state === "failed" ? "✗" : "⟳"} {x.title}
						{x.facts > 0 && <span className="act-chip-n">+{x.facts}</span>}
					</button>
				))}
			</div>
		</div>
	);
}

/** What the run changed in the project, each with a way back (task 8.7). Nothing shows when it changed nothing. */
function Changes({ project, run }: { project: string; run: string }) {
	const rows = useLoad<UndoRow[]>(() => call("undo.list", project, run), [project, run]);
	const [err, setErr] = useState<string | null>(null);
	const list = rows.data ?? [];
	if (list.length === 0) return null;
	const live = list.filter((r) => !r.undone).length;
	const undo = (r: UndoRow) =>
		call("undo.apply", project, r.key)
			.then(() => (setErr(null), rows.reload()))
			.catch((e) => setErr(errText(e)));
	return (
		<details className="run-undo">
			<summary className="dim small">
				Izmaiņas, ko var atsaukt: {live} no {list.length}
			</summary>
			{err && <div className="err">{err}</div>}
			{list.map((r) => (
				<div key={r.key} className={`undo-row ${r.undone ? "done" : ""}`}>
					<span className="grow small" title={r.tool ?? undefined}>
						{r.label}
					</span>
					{r.undone ? (
						<span className="dim small">atsaukts</span>
					) : (
						<button className="small ghost" disabled={!r.undoable} title={r.why ?? "Atgriež, kā bija pirms šīs izmaiņas. Nekas netiek dzēsts."} onClick={() => undo(r)}>
							Atsaukt
						</button>
					)}
					{!r.undone && !r.undoable && r.why && <span className="dim small">{r.why}</span>}
				</div>
			))}
		</details>
	);
}

/** Lines of one run. `latest` = the newest run of the conversation, open by default. */
export function RunCard({ lines, latest }: { lines: Activity[]; latest: boolean }) {
	const start = lines.find((l) => l.kind === "start");
	const end = lines.find((l) => l.kind === "done" || l.kind === "error");
	const running = isRunning(lines);
	const summary = summaryOf(lines);
	const steps = lines.filter((l) => l.kind === "tool" || l.kind === "thinking" || l.kind === "note" || l.kind === "confirm" || (l.kind === "error" && !!l.text));
	const lastStep = steps[steps.length - 1];

	// open while it runs and for the newest run; the person's own open/close wins from then on
	const [open, setOpen] = useState(latest || running);
	const touched = useRef(false);
	useEffect(() => {
		if (!touched.current) setOpen(latest || running);
	}, [latest, running]);

	// the clock moves while the run is going, even when no line arrives (a long tool call, a long thought)
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!running) return;
		const t = setInterval(() => setTick((n) => n + 1), 1000);
		return () => clearInterval(t);
	}, [running]);
	const now = Date.now();
	const began = start ? Date.parse(start.at) : Date.parse(lines[0].at);
	const took = (end ? Date.parse(end.at) : now) - began;

	// the step list follows its newest line unless the person scrolled up
	const box = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	useEffect(() => {
		const el = box.current;
		if (el && running && follow.current) el.scrollTo({ top: el.scrollHeight });
	}, [lines.length, lastStep?.detail?.length, running, open]);

	const changed = summary ? changesText(summary.changes) : "";
	return (
		<details
			className={`run-card ${running ? "running" : end?.kind === "error" ? "failed" : "done"}`}
			open={open}
			onToggle={(e) => {
				const isOpen = e.currentTarget.open;
				if (isOpen !== open) {
					touched.current = true;
					setOpen(isOpen);
				}
			}}
		>
			<summary className="run-head">
				{running ? <span className="pulse" /> : end?.kind === "error" ? <span className="bad-mark">✗</span> : <span className="ok-mark">✓</span>}
				<span className="run-title">{start?.text ?? "Uzdevums"}</span>
				<span className="dim small run-meta">
					{clock(lines[0].at).slice(0, 5)} · {summary?.steps ?? 0} soļi · {duration(took)}
				</span>
				{summary?.usage && (
					<span className="dim small run-meta" title={`${summary.usage.turns} modeļa piegājieni; kešatmiņā lasīti ${fmtTokens(summary.usage.cacheRead)}, ierakstīti ${fmtTokens(summary.usage.cacheWrite)}`}>
						{usageText(summary.usage)}
					</span>
				)}
			</summary>
			{start?.detail && (
				<details className="run-task">
					<summary className="dim small">Uzdevums aģentam</summary>
					<pre className="act-pre">{start.detail}</pre>
				</details>
			)}
			{summary && <Chips s={summary} />}
			<div
				className="run-steps"
				ref={box}
				onScroll={(e) => {
					const el = e.currentTarget;
					follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
				}}
			>
				{steps.map((l, i) => (
					<Step key={`${l.step ?? l.kind}-${i}`} a={l} live={running && l === lastStep} />
				))}
				{running && steps.length === 0 && <div className="dim small">Aģents sāk darbu…</div>}
			</div>
			{!running && start?.project && <Changes project={start.project} run={start.run} />}
			<div className="run-foot small">
				{changed ? `${running ? "Līdz šim: " : "Izmaiņas: "}${changed}` : running ? "Projektā vēl nekas nav mainīts" : "Projektā nekas netika mainīts"}
			</div>
		</details>
	);
}
