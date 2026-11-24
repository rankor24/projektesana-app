// The agent log (Žurnāls): everything an agent run does and receives, as a verbose transcript in the way Claude Code shows one: the model and
// tools it was given, the system text and the prompt, the reasoning, the answer, every tool call with its whole arguments and every
// answer with how long it took, errors, retries and what each model turn cost. The runs are listed above (or beside, when the panel is
// wide) and the transcript follows the run live. It opens as a tab in the right panel like the list pages; the split between the list
// and the transcript is dragged like every split (the share is remembered). Filter by kind, search, open or close all, copy, save.
// The text comes from main (core/agent-log.ts) with keys and passwords already masked. Log files older than 30 days are removed.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clockMs, groupOf, LOG_GROUPS, logMarkdown, matches, spanText, type LogEntry, type LogGroup, type LogKind, type LogRun } from "../../shared/agent-log";
import { fmtTokens } from "../../shared/tokens";
import { call, errText, on } from "../bridge";
import { tr } from "../i18n";
import { SplitHandle, useSplit } from "../shell/SplitHandle";
import { useUi } from "../state";
import { Empty, Err } from "../ui";
import "../agent-log.css";

/** The words of each kind, in the app's language. */
const KIND_LABEL: Record<LogKind, () => string> = {
	run: () => tr("gājiens"),
	system: () => tr("sistēma"),
	prompt: () => tr("uzdevums"),
	thinking: () => tr("domāšana"),
	text: () => tr("atbilde"),
	tool: () => tr("rīka izsaukums"),
	result: () => tr("rīka atbilde"),
	usage: () => tr("patēriņš"),
	retry: () => tr("atkārtojums"),
	compact: () => tr("saspiešana"),
	confirm: () => tr("apstiprinājums"),
	lane: () => tr("palīgs"),
	check: () => tr("pārbaude"),
	error: () => tr("kļūda"),
	note: () => tr("piezīme"),
};

const GROUP_LABEL: Record<LogGroup, () => string> = {
	prompt: () => tr("Uzdevums"),
	reasoning: () => tr("Domāšana"),
	answer: () => tr("Atbilde"),
	tool: () => tr("Rīki"),
	error: () => tr("Kļūdas"),
	info: () => tr("Info"),
};

const STATUS_LABEL = { running: () => tr("darbojas"), ok: () => tr("izdevās"), failed: () => tr("neizdevās"), stopped: () => tr("pārtraukts") } as const;

/** A body longer than this is cut on screen until the user asks for all of it (it is all in the file and in Copy / Save). */
const SHOW_MAX = 20_000;
/** Opens by itself when it is not longer than this (a tool's arguments and answer, a prompt); a long one stays a line until clicked. */
const OPEN_MAX = 700;

const pad = (n: number) => String(n).padStart(2, "0");
const dayClock = (at: number) => {
	const d = new Date(at);
	const now = new Date();
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	return d.toDateString() === now.toDateString() ? time : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${time}`;
};

const costOf = (u: LogRun["usage"]) => (u.cost === null ? "" : ` · $${u.cost < 1 ? u.cost.toFixed(3) : u.cost.toFixed(2)}`);

/** Does this entry show its body when nothing was clicked? */
function defaultOpen(e: LogEntry): boolean {
	if (!e.text) return false;
	if (e.kind === "system") return false;
	if (e.kind === "text" || e.kind === "thinking" || e.kind === "error" || e.kind === "retry") return true;
	return e.text.length <= OPEN_MAX;
}

function save(fileName: string, mime: string, text: string) {
	const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
	const a = document.createElement("a");
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function copy(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

function RunRow({ r, on: selected, onPick }: { r: LogRun; on: boolean; onPick: () => void }) {
	const end = r.endedAt ?? Date.now();
	return (
		<button className={`alog-run ${selected ? "on" : ""} st-${r.status}`} onClick={onPick} title={`${r.runId}\n${r.model ?? ""}`}>
			<span className="alog-run-top">
				{r.status === "running" ? <span className="spin" aria-label={STATUS_LABEL.running()} /> : <span className={`alog-dot st-${r.status}`} aria-label={STATUS_LABEL[r.status]()} />}
				<b>{r.agent || "—"}</b>
				<span className="dim small">{dayClock(r.startedAt)}</span>
				<span className="dim small alog-run-span">{spanText(end - r.startedAt)}</span>
			</span>
			<span className="alog-run-title">{r.title || "—"}</span>
			<span className="dim small alog-run-meta">
				{r.model ? `${r.model} · ` : ""}
				{tr("{n} ieraksti · {t} rīki", { n: r.entries, t: r.tools })}
				{r.errors ? <span className="alog-bad"> · {tr("{n} kļūdas", { n: r.errors })}</span> : null}
				{r.usage.turns ? ` · ${fmtTokens(r.usage.input + r.usage.cacheRead)} → ${fmtTokens(r.usage.output)}${costOf(r.usage)}` : ""}
			</span>
		</button>
	);
}

function Body({ text }: { text: string }) {
	const [all, setAll] = useState(false);
	const cut = !all && text.length > SHOW_MAX;
	return (
		<>
			<pre className="alog-pre">{cut ? text.slice(0, SHOW_MAX) : text}</pre>
			{cut && (
				<button className="ghost small" onClick={() => setAll(true)}>
					{tr("Rādīt visu ({n} rakstzīmes)", { n: text.length })}
				</button>
			)}
		</>
	);
}

const Entry = memo(function Entry({ e, t0, open, onToggle }: { e: LogEntry; t0: number; open: boolean; onToggle: (n: number, open: boolean) => void }) {
	const [copied, setCopied] = useState(false);
	const label = KIND_LABEL[e.kind]();
	const bodyText = e.text ?? "";
	const hasBody = bodyText.length > 0;
	const lane = e.lane ? `${e.lane.agent ? `${e.lane.agent}: ` : ""}${e.lane.label}` : "";
	const doCopy = async (ev: React.MouseEvent) => {
		ev.stopPropagation();
		const ok = await copy(`[${clockMs(e.at)}] ${label}${lane ? ` (${lane})` : ""} ${e.title}\n${bodyText}`.trimEnd());
		setCopied(ok);
		setTimeout(() => setCopied(false), 1200);
	};
	return (
		<div className={`alog-e k-${e.kind} g-${groupOf(e.kind)} ${e.ok === false ? "failed" : ""} ${e.lane ? "lane" : ""}`}>
			<div className={`alog-h ${hasBody ? "can" : ""}`} onClick={hasBody ? () => onToggle(e.n, open) : undefined}>
				<span className="alog-caret" aria-hidden>{hasBody ? (open ? "▾" : "▸") : ""}</span>
				<span className="alog-t" title={new Date(e.at).toISOString()}>{clockMs(e.at)} <span className="dim">+{spanText(e.at - t0)}</span></span>
				<span className={`alog-kind k-${e.kind}`}>{label}</span>
				{lane && <span className="badge info alog-lane" title={lane}>{lane}</span>}
				<span className="alog-title">{e.name && e.title === e.name ? <code>{e.name}</code> : e.title}</span>
				{e.kind === "result" && (e.ok === false ? <span className="bad-mark" aria-label={tr("neizdevās")}>✗</span> : <span className="ok-mark" aria-label={tr("izdevās")}>✓</span>)}
				{e.ms !== undefined && <span className="badge dim" title={tr("Cik ilgi ilga")}>{spanText(e.ms)}</span>}
				{e.chars !== undefined && e.chars > 0 && <span className="badge dim" title={tr("Visa atbilde rakstzīmēs")}>{e.chars.toLocaleString()} {tr("zīm.")}</span>}
				{e.open && <span className="spin" aria-label={tr("darbojas")} />}
				{hasBody && (
					<button className="ghost small alog-copy" title={tr("Kopēt šo ierakstu")} onClick={doCopy}>
						{copied ? tr("Nokopēts") : tr("Kopēt")}
					</button>
				)}
			</div>
			{hasBody && open && (
				<div className="alog-body">
					<Body text={bodyText} />
					{e.cut && <div className="dim small">{tr("Ieraksts nogriezts: žurnālā ir tikai pirmās rakstzīmes.")}</div>}
				</div>
			)}
		</div>
	);
});

/** A run's entries with the live ones merged in: an entry with a number already held is replaced (a streamed answer grows). */
function merge(list: LogEntry[], e: LogEntry): LogEntry[] {
	const i = list.findIndex((x) => x.n === e.n);
	if (i >= 0) {
		const next = list.slice();
		next[i] = e;
		return next;
	}
	return e.n > (list.at(-1)?.n ?? 0) ? [...list, e] : [...list, e].sort((a, b) => a.n - b.n);
}

/** `filter`: a run id to show, or `thread:<id>` for the newest run of a thread (the chat's link); an `@<time>` suffix makes the same ask count again. */
export function AgentLog({ filter }: { filter?: string }) {
	const { projectId } = useUi();
	const [runs, setRuns] = useState<LogRun[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const [scope, setScope] = useState<"project" | "all">("project");
	const [runId, setRunId] = useState<string | null>(null);
	const [entries, setEntries] = useState<LogEntry[]>([]);
	const [groups, setGroups] = useState<Set<LogGroup>>(() => new Set(LOG_GROUPS));
	const [query, setQuery] = useState("");
	const [follow, setFollow] = useState(true);
	const [mode, setMode] = useState<"default" | "all" | "none">("default");
	const [flipped, setFlipped] = useState<Record<number, boolean>>({});
	const [note, setNote] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [wide, setWide] = useState(false);
	const split = useSplit("projektesana:alog-split", 34);
	const selected = useRef<string | null>(null);
	selected.current = runId;

	// side by side when the panel is wide, one above the other in the narrow right panel
	useEffect(() => {
		const el = rootRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(([c]) => setWide((c?.contentRect.width ?? 0) >= 900));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const loadRuns = useCallback(() => {
		call("agentlog.runs")
			.then((r) => (setRuns(r), setError(null)))
			.catch((e) => setError(e))
			.finally(() => setLoaded(true));
	}, []);
	useEffect(loadRuns, [loadRuns]);

	// live: a changed run replaces its row; a new entry joins the open run
	useEffect(
		() =>
			on("agentlog.entry", ({ run, entry }) => {
				setRuns((list) => {
					const i = list.findIndex((x) => x.runId === run.runId);
					if (i < 0) return [run, ...list].sort((a, b) => b.startedAt - a.startedAt);
					const next = list.slice();
					next[i] = run;
					return next;
				});
				if (entry && selected.current === run.runId) setEntries((list) => merge(list, entry));
			}),
		[],
	);

	const shown = useMemo(() => (scope === "all" ? runs : runs.filter((r) => r.projectId === projectId)), [runs, scope, projectId]);

	// which run is open: the one asked for (once per ask: a later click on another run stays), else the one already open, else the running one, else the newest
	const asked = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (!loaded) return;
		if (filter && asked.current !== filter) {
			const want = filter.replace(/@\d+$/, "");
			const wanted = want.startsWith("thread:") ? runs.find((r) => r.threadId === want.slice(7))?.runId : runs.some((r) => r.runId === want) ? want : undefined;
			if (wanted) {
				asked.current = filter;
				if (wanted !== runId) setRunId(wanted);
				return;
			}
		}
		if (runId && runs.some((r) => r.runId === runId)) return;
		setRunId((shown.find((r) => r.status === "running") ?? shown[0])?.runId ?? null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loaded, filter, runs.length, scope, projectId]);

	// the open run's whole log
	useEffect(() => {
		setEntries([]);
		setFlipped({});
		if (!runId) return;
		let live = true;
		call("agentlog.read", runId)
			// lines that arrived while this was loading are kept (they are newer than the read)
			.then((e) => live && (setEntries((cur) => [...new Map([...e, ...cur].map((x) => [x.n, x] as const)).values()].sort((a, b) => a.n - b.n)), setError(null)))
			.catch((e) => live && setError(e));
		return () => {
			live = false;
		};
	}, [runId]);

	const run = runs.find((r) => r.runId === runId) ?? null;
	const t0 = run?.startedAt ?? entries[0]?.at ?? 0;
	const visible = useMemo(() => entries.filter((e) => matches(e, groups, query) && !((e.kind === "text" || e.kind === "thinking") && !e.text && !e.open)), [entries, groups, query]);
	const isOpen = (e: LogEntry) => flipped[e.n] ?? (mode === "all" ? !!e.text : mode === "none" ? false : defaultOpen(e));

	// follow the newest entry while the user has not scrolled away
	useEffect(() => {
		const el = scrollRef.current;
		if (follow && el) el.scrollTop = el.scrollHeight;
	}, [entries, follow, visible.length]);

	const toggle = useCallback((n: number, now: boolean) => setFlipped((f) => ({ ...f, [n]: !now })), []);
	const toggleGroup = (g: LogGroup) =>
		setGroups((s) => {
			const n = new Set(s);
			if (n.has(g)) n.delete(g);
			else n.add(g);
			return n;
		});

	const say = (t: string) => {
		setNote(t);
		setTimeout(() => setNote(null), 2200);
	};
	const copyAll = async () => say((await copy(run ? logMarkdown(run, visible) : "")) ? tr("Nokopēts") : tr("Nevarēja nokopēt"));
	const saveAs = (format: "md" | "jsonl") => {
		if (!runId) return;
		call("agentlog.export", runId, format)
			.then((f) => save(f.fileName, f.mime, f.text))
			.catch((e) => setError(e));
	};

	const list = (
		<div className="alog-runs" ref={split.ref} style={{ flex: `0 0 ${split.pct}%` }}>
			<div className="alog-runs-head">
				<b>{tr("Gājieni")}</b>
				<select value={scope} onChange={(e) => setScope(e.target.value as "project" | "all")} aria-label={tr("Kuru projektu gājienus rādīt")}>
					<option value="project">{tr("Šis projekts")}</option>
					<option value="all">{tr("Visi projekti")}</option>
				</select>
				<span className="dim small">{shown.length}</span>
			</div>
			<div className="alog-runs-list">
				{shown.length === 0 && loaded && <Empty title={tr("Nav neviena gājiena žurnāla")}>{tr("Uzdod aģentam kaut ko, un tas parādīsies šeit.")}</Empty>}
				{shown.map((r) => (
					<RunRow key={r.runId} r={r} on={r.runId === runId} onPick={() => setRunId(r.runId)} />
				))}
			</div>
		</div>
	);

	const transcript = (
		<div className="alog-main">
			<Err error={error ? errText(error) : null} />
			<div className="alog-bar">
				<input className="alog-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Meklēt žurnālā…")} aria-label={tr("Meklēt žurnālā…")} />
				<div className="alog-groups" role="group" aria-label={tr("Ierakstu veidi")}>
					{LOG_GROUPS.map((g) => (
						<button key={g} className={`chip alog-chip g-${g} ${groups.has(g) ? "on" : "off"}`} aria-pressed={groups.has(g)} onClick={() => toggleGroup(g)}>
							{GROUP_LABEL[g]()}
						</button>
					))}
				</div>
				<div className="alog-actions">
					<label className="small alog-follow" title={tr("Ritina līdz jaunākajam ierakstam, kamēr gājiens notiek")}>
						<input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {tr("Sekot jaunākajam")}
					</label>
					<button className="small" onClick={() => (setMode("all"), setFlipped({}))}>{tr("Atvērt visu")}</button>
					<button className="small" onClick={() => (setMode("none"), setFlipped({}))}>{tr("Aizvērt visu")}</button>
					<button className="small" disabled={!run} onClick={copyAll} title={tr("Nokopē redzamos ierakstus kā Markdown")}>{tr("Kopēt visu")}</button>
					<button className="small" disabled={!run} onClick={() => saveAs("md")}>{tr("Saglabāt .md")}</button>
					<button className="small" disabled={!run} onClick={() => saveAs("jsonl")}>{tr("Saglabāt .jsonl")}</button>
					{note && <span className="dim small">{note}</span>}
				</div>
			</div>
			{run && (
				<div className="alog-sub dim small">
					<b>{run.agent}</b> · {STATUS_LABEL[run.status]()} · {new Date(run.startedAt).toLocaleString()} · {spanText((run.endedAt ?? Date.now()) - run.startedAt)}
					{run.model ? ` · ${run.model}${run.effort ? ` (${run.effort})` : ""}` : ""} · {tr("{shown} no {total} ierakstiem", { shown: visible.length, total: entries.length })}
					{run.usage.turns ? ` · ${tr("ievade {i} · izvade {o} · kešatmiņa {c}", { i: fmtTokens(run.usage.input), o: fmtTokens(run.usage.output), c: fmtTokens(run.usage.cacheRead) })}${costOf(run.usage)}` : ""}
				</div>
			)}
			<div className="alog-scroll" ref={scrollRef} onWheel={(e) => e.deltaY < 0 && follow && setFollow(false)}>
				{!run && loaded && <Empty title={tr("Izvēlies gājienu")} />}
				{run && entries.length === 0 && <div className="dim small alog-pad">{tr("ielādē…")}</div>}
				{visible.map((e) => (
					<Entry key={e.n} e={e} t0={t0} open={isOpen(e)} onToggle={toggle} />
				))}
				{run && entries.length > 0 && visible.length === 0 && <div className="dim small alog-pad">{tr("Nekas neatbilst filtram.")}</div>}
			</div>
			<div className="dim small alog-foot">{tr("Atslēgas un paroles ir aizklātas ar [***]. Žurnāli, vecāki par 30 dienām, tiek dzēsti.")}</div>
		</div>
	);

	return (
		<div className={`alog ${wide ? "wide" : "narrow"}`} ref={rootRef}>
			{list}
			<SplitHandle split={split} dir={wide ? "row" : "col"} />
			{transcript}
		</div>
	);
}
