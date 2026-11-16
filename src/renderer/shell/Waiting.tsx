// Gaida tevi: everything that waits for an answer, of every project. A confirmation shows its batch and the agent; the restart question offers Turpināt / Atmest;
// a gate shows its summary with Apstiprināt / Atgriezt (task 14.8).
import { useEffect, useState } from "react";
import type { AgentSpec } from "../../shared/agent-types";
import type { ExpertRemark } from "../../shared/expert-types";
import { gateStage } from "../../shared/process-view";
import type { WaitingItem } from "../../shared/waiting";
import { call, errText } from "../bridge";
import { agentName } from "./useThreads";

interface Props {
	items: WaitingItem[];
	specs: AgentSpec[];
	projectId: string | null;
	onConfirm: (id: string, allow: boolean) => Promise<void>;
	onOpen: (threadId: string) => void;
}

const REASON = { runs: "darbu skaita robeža", cost: "izmaksu robeža" } as const;

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
				<b>Gaida tevi</b>
				<span className="badge warn">{items.length}</span>
			</div>
			{items.map((w, i) => {
				switch (w.kind) {
					case "confirm":
						return (
							<div key={w.id} className="confirm">
								<div className="row small">
									<b>{agentName(w.agent, specs)}</b>
									<span className={`badge ${w.projectId === projectId ? "dim" : "warn"}`} title={w.projectId === projectId ? "Atvērtais projekts" : "Cits projekts"}>
										{w.projectId ?? "bez projekta"}
									</span>
									<span className="dim">apstiprini partiju: {w.tool}</span>
									<span className="grow" />
									{w.projectId === projectId && (
										<button className="ghost small" onClick={() => onOpen(w.threadId)}>
											Atvērt sarunu
										</button>
									)}
								</div>
								<pre>{w.batch}</pre>
								<div className="row">
									<button className="primary" onClick={() => run(onConfirm(w.id, true))}>Atļaut</button>
									<button onClick={() => run(onConfirm(w.id, false))}>Noraidīt</button>
								</div>
							</div>
						);
					case "interrupted":
						return (
							<div key={`interrupted${i}`} className="confirm">
								<div>
									{w.interrupted} darbi tika pārtraukti, {w.queued} gaida rindā
								</div>
								<div className="row">
									<button className="primary" onClick={() => run(call("queue.resumeInterrupted"))}>Turpināt</button>
									<button onClick={() => run(call("queue.discardInterrupted"))}>Atmest</button>
								</div>
							</div>
						);
					case "wave-paused":
						return (
							<div key={`wave${w.wave}`} className="confirm">
								<div className="row small">
									<b>Vilnis apturēts</b>
									<span className={`badge ${w.projectId === projectId ? "dim" : "warn"}`}>{w.projectId ?? "bez projekta"}</span>
									<span className="dim">{REASON[w.reason]}</span>
								</div>
								<div className="row">
									<button className="primary" onClick={() => run(call("queue.resumeWave", w.wave))} title="Skaitītāji sākas no nulles; rindā gaidošie darbi sāk darbu">Turpināt</button>
								</div>
							</div>
						);
					// the two below are filled by later phases; a line each until they have their own controls
					case "question":
						return (
							<div key={`q${w.noteId}`} className="small">
								{agentName(w.from, specs)} jautā ({w.projectId}): {w.title}
							</div>
						);
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

/** One waiting gate: the note the leader wrote, the user's comment, and the two decisions. The decision is main's (`process.gate`); the card goes when main says the list changed.
 *  H5 also lists the project's open expert remarks: the ticked ones are what S6 has to fix. */
function GateCard({ w, current }: { w: Extract<WaitingItem, { kind: "gate" }>; current: boolean }) {
	const stage = gateStage(w.gate);
	const [body, setBody] = useState<string | null>(null);
	const [remarks, setRemarks] = useState<ExpertRemark[]>([]);
	const [ticked, setTicked] = useState<Set<string>>(new Set());
	const [comment, setComment] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let live = true;
		setBody(null);
		call("notes.list", w.projectId, "gate")
			.then((ns) => live && setBody(ns.find((n) => n.id === w.noteId)?.body ?? ""))
			.catch((e) => live && (setBody(""), setErr(errText(e))));
		return () => {
			live = false;
		};
	}, [w.projectId, w.noteId]);

	useEffect(() => {
		if (w.gate !== "H5") return;
		let live = true;
		call("expert.list", w.projectId)
			.then((v) => live && setRemarks(v.remarks.filter((r) => r.state === "open").sort((a, b) => rank(a) - rank(b))))
			.catch((e) => live && setErr(errText(e)));
		return () => {
			live = false;
		};
	}, [w.projectId, w.gate]);

	const tick = (id: string) =>
		setTicked((t) => {
			const n = new Set(t);
			if (!n.delete(id)) n.add(id);
			return n;
		});
	const decide = (approve: boolean) => {
		if (!approve && !comment.trim()) {
			setErr("Atgriežot vārtus, jāieraksta komentārs.");
			return;
		}
		setErr(null);
		setBusy(true);
		const fix = approve && w.gate === "H5" ? remarks.filter((r) => ticked.has(r.id)).map((r) => r.id) : undefined;
		call("process.gate", w.projectId, { approve, ...(comment.trim() ? { comment: comment.trim() } : {}), ...(fix ? { fix } : {}) })
			.catch((e) => setErr(errText(e)))
			.finally(() => setBusy(false));
	};

	return (
		<div className="confirm gate-card">
			<div className="row small">
				<b>
					Gate {w.gate}
					{stage ? ` · ${stage}` : ""}
				</b>
				<span className={`badge ${current ? "dim" : "warn"}`} title={current ? "Atvērtais projekts" : "Cits projekts"}>
					{w.projectId}
				</span>
			</div>
			{body === null ? <div className="dim small">lasa kopsavilkumu…</div> : body ? <pre>{body}</pre> : <div className="dim small">Kopsavilkuma piezīme nav atrasta.</div>}
			{w.gate === "H5" && (
				<div className="gate-remarks">
					<div className="row small">
						<b>Piezīmes, ko labot (S6)</b>
						<span className="dim">{ticked.size} no {remarks.length}</span>
						<span className="grow" />
						<button className="ghost small" onClick={() => setTicked(new Set(remarks.map((r) => r.id)))} disabled={remarks.length === 0}>visas</button>
						<button className="ghost small" onClick={() => setTicked(new Set())} disabled={ticked.size === 0}>nevienu</button>
					</div>
					{remarks.length === 0 && <div className="dim small">Atvērtu ekspertīzes piezīmju nav.</div>}
					{remarks.map((r) => (
						<label key={r.id} className="gate-remark small" title={r.quote}>
							<input type="checkbox" checked={ticked.has(r.id)} onChange={() => tick(r.id)} />
							<span className={`badge ${r.class === "K" ? "bad" : r.class === "B" ? "warn" : "dim"}`}>{r.class ?? "bez klases"}</span>
							<span className="dim">{r.daļa ?? "daļa nav norādīta"}</span>
							<span className="gate-quote">{r.quote}</span>
						</label>
					))}
				</div>
			)}
			<textarea className="gate-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Komentārs (Atgriezt: obligāts; Apstiprināt: pēc izvēles)" />
			<div className="row">
				<button className="primary" disabled={busy} onClick={() => decide(true)}>Apstiprināt</button>
				<button disabled={busy} onClick={() => decide(false)}>Atgriezt</button>
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
	const go = () => {
		setErr(null);
		setBusy(true);
		call("process.gate", w.projectId, { approve: true, ...(comment.trim() ? { comment: comment.trim() } : {}) })
			.catch((e) => setErr(errText(e)))
			.finally(() => setBusy(false));
	};
	return (
		<div className="confirm gate-card">
			<div className="row small">
				<b>Stadija {w.stage} eskalēta — gaida tavu lēmumu</b>
				<span className={`badge ${current ? "dim" : "warn"}`} title={current ? "Atvērtais projekts" : "Cits projekts"}>
					{w.projectId}
				</span>
			</div>
			<div className="dim small">Stadija atgriezta vairāk reižu, nekā procesā atļauts. Turpināt nozīmē pieņemt stadijas rezultātu un doties tālāk.</div>
			<textarea className="gate-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Komentārs (pēc izvēles)" />
			<div className="row">
				<button className="primary" disabled={busy} onClick={go}>Turpināt</button>
			</div>
			{err && <div className="err">{err}</div>}
		</div>
	);
}
