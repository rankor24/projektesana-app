// Gaida tevi: everything that waits for an answer, of every project. A confirmation shows its batch and the agent; the restart question offers Turpināt / Atmest;
// a gate shows its summary with Apstiprināt / Atgriezt (task 14.8); a question shows its text, opens the asking conversation and closes with an optional answer the agent hears;
// S5 has a line that tells the user to open eks.
import { useEffect, useState } from "react";
import type { AgentSpec } from "../../shared/agent-types";
import type { ExpertRemark } from "../../shared/expert-types";
import { gateStage } from "../../shared/process-view";
import type { WaitingItem } from "../../shared/waiting";
import { call, errText } from "../bridge";
import { agentName } from "./useThreads";
import { tr } from "../i18n";

interface Props {
	items: WaitingItem[];
	specs: AgentSpec[];
	projectId: string | null;
	onConfirm: (id: string, allow: boolean) => Promise<void>;
	onOpen: (threadId: string) => void;
}

const REASON = { runs: tr("darbu skaita robeža"), cost: tr("izmaksu robeža") } as const;

export function Waiting({ items, specs, projectId, onConfirm, onOpen }: Props) {
	const [err, setErr] = useState<string | null>(null);
	if (items.length === 0) return null;
	// the answer is main's; the list changes when main says so, never from the click
	const run = (job: Promise<unknown>) => {
		setErr(null);
		job.catch((e) => setErr(errText(e)));
	};
	return (
		<div className="waiting-block">
			<div className="row small">
				<b>{tr("Gaida tevi")}</b>
				<span className="badge warn">{items.length}</span>
			</div>
			{items.map((w, i) => {
				switch (w.kind) {
					case "confirm":
						return (
							<div key={w.id} className="confirm">
								<div className="row small">
									<b>{agentName(w.agent, specs)}</b>
									<span className={`badge ${w.projectId === projectId ? "dim" : "warn"}`} title={w.projectId === projectId ? tr("Atvērtais projekts") : tr("Cits projekts")}>
										{w.projectId ?? tr("bez projekta")}
									</span>
									<span className="dim">{tr("apstiprini partiju: {tool}", { tool: w.tool })}</span>
									<span className="grow" />
									{w.projectId === projectId && (
										<button className="ghost small" onClick={() => onOpen(w.threadId)}>
											{tr("Atvērt sarunu")}</button>
									)}
								</div>
								<pre>{w.batch}</pre>
								<div className="row">
									<button className="primary" onClick={() => run(onConfirm(w.id, true))}>{tr("Atļaut")}</button>
									<button onClick={() => run(onConfirm(w.id, false))}>{tr("Noraidīt")}</button>
								</div>
							</div>
						);
					case "interrupted":
						return (
							<div key={`interrupted${i}`} className="confirm">
								<div>
									{tr("{interrupted} darbi tika pārtraukti, {queued} gaida rindā", { interrupted: w.interrupted, queued: w.queued })}</div>
								<div className="row">
									<button className="primary" onClick={() => run(call("queue.resumeInterrupted"))}>{tr("Turpināt")}</button>
									<button onClick={() => run(call("queue.discardInterrupted"))}>{tr("Atmest")}</button>
								</div>
							</div>
						);
					case "wave-paused":
						return (
							<div key={`wave${w.wave}`} className="confirm">
								<div className="row small">
									<b>{tr("Vilnis apturēts")}</b>
									<span className={`badge ${w.projectId === projectId ? "dim" : "warn"}`}>{w.projectId ?? tr("bez projekta")}</span>
									<span className="dim">{REASON[w.reason]}</span>
								</div>
								<div className="row">
									<button className="primary" onClick={() => run(call("queue.resumeWave", w.wave))} title={tr("Skaitītāji sākas no nulles; rindā gaidošie darbi sāk darbu")}>{tr("Turpināt")}</button>
								</div>
							</div>
						);
					case "question":
						return <QuestionCard key={`q${w.noteId}`} w={w} specs={specs} current={w.projectId === projectId} onOpen={onOpen} />;
					case "start-eks":
						return <StartEksCard key={`s${w.projectId}`} w={w} current={w.projectId === projectId} onOpen={onOpen} />;
					case "gate":
						return <GateCard key={`g${w.projectId}${w.gate}${w.noteId}`} w={w} current={w.projectId === projectId} />;
					case "escalated":
						return <EscalatedCard key={`e${w.projectId}${w.stage}`} w={w} current={w.projectId === projectId} />;
				}
			})}
			{err && <div className="err">{err}</div>}
		</div>
	);
}

const CLASS_ORDER = ["K", "B", "I"];
const rank = (r: ExpertRemark) => (r.class ? CLASS_ORDER.indexOf(r.class) : CLASS_ORDER.length);

/** The open expert remarks of a project, with the ticked ones: what H5 sends S6 to fix. Loaded only when `on`.
 *  `state` keeps "still reading" and "could not read" apart from "none open": an empty list approved while loading would send the process past S6. */
function useRemarkPick(projectId: string, on: boolean, fail: (e: unknown) => void) {
	const [remarks, setRemarks] = useState<ExpertRemark[]>([]);
	const [ticked, setTicked] = useState<Set<string>>(new Set());
	const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		if (!on) return;
		let live = true;
		setState("loading");
		call("expert.list", projectId)
			.then((v) => {
				if (!live) return;
				setRemarks(v.remarks.filter((r) => r.state === "open").sort((a, b) => rank(a) - rank(b)));
				setState("ready");
			})
			.catch((e) => {
				if (!live) return;
				setState("failed");
				fail(e);
			});
		return () => {
			live = false;
		};
	}, [projectId, on, attempt]);
	const retry = () => setAttempt((n) => n + 1);
	const tick = (id: string) =>
		setTicked((t) => {
			const n = new Set(t);
			if (!n.delete(id)) n.add(id);
			return n;
		});
	return { remarks, ticked, tick, setTicked, state, retry, ids: () => remarks.filter((r) => ticked.has(r.id)).map((r) => r.id) };
}

/** The H5 remark checkboxes (fix list), in the gate card and in the card of an escalated S5. */
function RemarkPick({ pick }: { pick: ReturnType<typeof useRemarkPick> }) {
	const { remarks, ticked, tick, setTicked, state, retry } = pick;
	if (state === "loading") return <div className="gate-remarks dim small">{tr("lasa ekspertīzes piezīmes…")}</div>;
	if (state === "failed")
		return (
			<div className="gate-remarks row small">
				<span className="err">{tr("Ekspertīzes piezīmes neizdevās nolasīt: apstiprināt nevar.")}</span>
				<button className="ghost small" onClick={retry}>{tr("Mēģināt vēlreiz")}</button>
			</div>
		);
	return (
		<div className="gate-remarks">
			<div className="row small">
				<b>{tr("Piezīmes, ko labot (S6)")}</b>
				<span className="dim">{tr("{size} no {v}", { size: ticked.size, v: remarks.length })}</span>
				<span className="grow" />
				<button className="ghost small" onClick={() => setTicked(new Set(remarks.map((r) => r.id)))} disabled={remarks.length === 0}>{tr("visas")}</button>
				<button className="ghost small" onClick={() => setTicked(new Set())} disabled={ticked.size === 0}>{tr("nevienu")}</button>
			</div>
			{remarks.length === 0 && <div className="dim small">{tr("Atvērtu ekspertīzes piezīmju nav.")}</div>}
			{remarks.map((r) => (
				<label key={r.id} className="gate-remark small" title={r.quote}>
					<input type="checkbox" checked={ticked.has(r.id)} onChange={() => tick(r.id)} />
					<span className={`badge ${r.class === "K" ? "bad" : r.class === "B" ? "warn" : "dim"}`}>{r.class ?? tr("bez klases")}</span>
					<span className="dim">{r.daļa ?? tr("daļa nav norādīta")}</span>
					<span className="gate-quote">{r.quote}</span>
				</label>
			))}
		</div>
	);
}

/** An agent's question for the user: its text, a way into the conversation that asked, and "Slēgt" with an answer the agent hears (the answer is optional). */
function QuestionCard({ w, specs, current, onOpen }: { w: Extract<WaitingItem, { kind: "question" }>; specs: AgentSpec[]; current: boolean; onOpen: (threadId: string) => void }) {
	const [body, setBody] = useState<string | null>(null);
	const [threadId, setThreadId] = useState<string | null>(null);
	const [answer, setAnswer] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		let live = true;
		setBody(null);
		call("notes.list", w.projectId, "question")
			.then((ns) => live && setBody(ns.find((n) => n.id === w.noteId)?.body ?? ""))
			.catch((e) => live && (setBody(""), setErr(errText(e))));
		return () => {
			live = false;
		};
	}, [w.projectId, w.noteId]);
	// the conversation that asked: the agent's newest thread that is not closed (only in the open project, where the lane can show it)
	useEffect(() => {
		if (!current) return;
		let live = true;
		call("threads.list", w.projectId)
			.then((ts) => live && setThreadId([...ts].filter((t) => t.agent === w.from && t.state !== "closed").sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0]?.id ?? null))
			.catch(() => live && setThreadId(null));
		return () => {
			live = false;
		};
	}, [w.projectId, w.from, current]);
	const close = () => {
		setErr(null);
		setBusy(true);
		call("notes.setStatus", w.projectId, w.noteId, "closed", answer.trim() || undefined)
			.catch((e) => setErr(errText(e)))
			.finally(() => setBusy(false));
	};
	return (
		<div className="confirm">
			<div className="row small">
				<b>{tr("{specs} jautā", { specs: agentName(w.from, specs) })}</b>
				<span className={`badge ${current ? "dim" : "warn"}`} title={current ? tr("Atvērtais projekts") : tr("Cits projekts")}>
					{w.projectId}
				</span>
				<span className="grow" />
				{threadId && (
					<button className="ghost small" onClick={() => onOpen(threadId)}>
						{tr("Atvērt sarunu")}</button>
				)}
			</div>
			<div>{w.title}</div>
			{body === null ? <div className="dim small">{tr("lasa jautājumu…")}</div> : body && <pre>{body}</pre>}
			<textarea className="gate-comment" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={tr("Atbilde (pēc izvēles): aģents to dzirdēs")} />
			<div className="row">
				<button disabled={busy} onClick={close}>{tr("Slēgt")}</button>
			</div>
			{err && <div className="err">{err}</div>}
		</div>
	);
}

/** S5 is on and eks has not been started: only the user opens its conversation. */
function StartEksCard({ w, current, onOpen }: { w: Extract<WaitingItem, { kind: "start-eks" }>; current: boolean; onOpen: (threadId: string) => void }) {
	const [err, setErr] = useState<string | null>(null);
	const open = () => {
		setErr(null);
		// the newest eks conversation that is open, else a new one
		call("threads.list", w.projectId)
			.then((ts) => [...ts].filter((t) => t.agent === "eks" && t.state !== "closed").sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0] ?? call("threads.open", w.projectId, "eks"))
			.then((t) => onOpen(t.id))
			.catch((e) => setErr(errText(e)));
	};
	return (
		<div className="confirm gate-card">
			<div className="row small">
				<b>{tr("Sāc ekspertīzi: atver eks sarunu")}</b>
				<span className={`badge ${current ? "dim" : "warn"}`} title={current ? tr("Atvērtais projekts") : tr("Cits projekts")}>
					{w.projectId}
				</span>
			</div>
			<div className="dim small">{tr("S5 ir ieslēgta. Ekspertīzes aģents neatbild uz ziņām: to sāc tu.")}</div>
			{current && (
				<div className="row">
					<button className="primary" onClick={open}>{tr("Atvērt eks sarunu")}</button>
				</div>
			)}
			{err && <div className="err">{err}</div>}
		</div>
	);
}

/** One waiting gate: the note the leader wrote, the user's comment, and the two decisions. The decision is main's (`process.gate`); the card goes when main says the list changed.
 *  H5 also lists the project's open expert remarks: the ticked ones are what S6 has to fix. */
function GateCard({ w, current }: { w: Extract<WaitingItem, { kind: "gate" }>; current: boolean }) {
	const stage = gateStage(w.gate);
	const [body, setBody] = useState<string | null>(null);
	const [bodyFailed, setBodyFailed] = useState(false);
	const [comment, setComment] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const pick = useRemarkPick(w.projectId, w.gate === "H5", (e) => setErr(errText(e)));
	// approval is a decision on what the card shows: the summary (and for H5 the remarks) must have been read
	const canApprove = body !== null && !bodyFailed && (w.gate !== "H5" || pick.state === "ready");

	useEffect(() => {
		let live = true;
		setBody(null);
		setBodyFailed(false);
		call("notes.list", w.projectId, "gate")
			.then((ns) => live && setBody(ns.find((n) => n.id === w.noteId)?.body ?? ""))
			.catch((e) => live && (setBody(""), setBodyFailed(true), setErr(errText(e))));
		return () => {
			live = false;
		};
	}, [w.projectId, w.noteId]);

	const decide = (approve: boolean) => {
		if (!approve && !comment.trim()) {
			setErr(tr("Atgriežot vārtus, jāieraksta komentārs."));
			return;
		}
		setErr(null);
		setBusy(true);
		if (approve && !canApprove) return;
		const fix = approve && w.gate === "H5" ? pick.ids() : undefined;
		call("process.gate", w.projectId, { approve, noteId: w.noteId, ...(comment.trim() ? { comment: comment.trim() } : {}), ...(fix ? { fix } : {}) })
			.catch((e) => setErr(errText(e)))
			.finally(() => setBusy(false));
	};

	return (
		<div className="confirm gate-card">
			<div className="row small">
				<b>
					{tr("Gate {gate}", { gate: w.gate })}{stage ? ` · ${stage}` : ""}
				</b>
				<span className={`badge ${current ? "dim" : "warn"}`} title={current ? tr("Atvērtais projekts") : tr("Cits projekts")}>
					{w.projectId}
				</span>
			</div>
			{body === null ? <div className="dim small">{tr("lasa kopsavilkumu…")}</div> : body ? <pre>{body}</pre> : <div className="dim small">{tr("Kopsavilkuma piezīme nav atrasta.")}</div>}
			{w.gate === "H5" && <RemarkPick pick={pick} />}
			<textarea className="gate-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tr("Komentārs (Atgriezt: obligāts; Apstiprināt: pēc izvēles)")} />
			<div className="row">
				<button className="primary" disabled={busy || !canApprove} onClick={() => decide(true)}>{tr("Apstiprināt")}</button>
				<button disabled={busy} onClick={() => decide(false)}>{tr("Atgriezt")}</button>
			</div>
			{err && <div className="err">{err}</div>}
		</div>
	);
}

/** A stage the process escalated after too many returns: no gate waits, so the user's word is the decision. "Turpināt" is `process.gate` approve, which main accepts on an escalated stage. */
function EscalatedCard({ w, current }: { w: Extract<WaitingItem, { kind: "escalated" }>; current: boolean }) {
	const [comment, setComment] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// an escalated S5 is approved like H5: the user also says which remarks S6 has to fix
	const pick = useRemarkPick(w.projectId, w.stage === "S5", (e) => setErr(errText(e)));
	const canGo = w.stage !== "S5" || pick.state === "ready";
	const go = () => {
		if (!canGo) return;
		setErr(null);
		setBusy(true);
		call("process.gate", w.projectId, { approve: true, ...(comment.trim() ? { comment: comment.trim() } : {}), ...(w.stage === "S5" ? { fix: pick.ids() } : {}) })
			.catch((e) => setErr(errText(e)))
			.finally(() => setBusy(false));
	};
	return (
		<div className="confirm gate-card">
			<div className="row small">
				<b>{tr("Stadija {stage} eskalēta — gaida tavu lēmumu", { stage: w.stage })}</b>
				<span className={`badge ${current ? "dim" : "warn"}`} title={current ? tr("Atvērtais projekts") : tr("Cits projekts")}>
					{w.projectId}
				</span>
			</div>
			<div className="dim small">{tr("Stadija atgriezta vairāk reižu, nekā procesā atļauts. Turpināt nozīmē pieņemt stadijas rezultātu un doties tālāk.")}</div>
			{w.stage === "S5" && <RemarkPick pick={pick} />}
			<textarea className="gate-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tr("Komentārs (pēc izvēles)")} />
			<div className="row">
				<button className="primary" disabled={busy || !canGo} onClick={go}>{tr("Turpināt")}</button>
			</div>
			{err && <div className="err">{err}</div>}
		</div>
	);
}
