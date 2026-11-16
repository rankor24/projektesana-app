// The mail tools of the main process: `send_message` puts a message into the project's mailbox for another agent and returns at once;
// the coordinator delivers it and wakes the recipient (coordinator.ts). `close_topic` ends a topic into Atmiņa: an agreement is a decision note,
// a pass-up (also the automatic one at a send limit) an open question. Like `delegate` they are handed to pi through `extraTools`, not served by the tools server.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentSpec } from "../shared/agent-types.js";
import { canSend, closedReason, threadOnTopic, type Limits, type Mailbox, type Message, type MessageKind, type Topic } from "../core/messages.js";
import { newId, type Note } from "../core/model.js";
import type { ProcessState } from "../core/process.js";
import { EKS } from "../core/process-def.js";
import type { ThreadStore } from "../core/threads.js";
import { LEAD_ID, type Thread } from "../shared/thread-types.js";
import type { Level } from "./tools/levels.js";

/** The two tools as the gate sees them. Sending mail changes nothing in the project; what the recipient then does goes through its own gate. */
export const MAIL_TOOL_LEVELS: Record<string, Level> = { send_message: "run", close_topic: "run" };

/** Three lines every agent's standing text carries (the lead's and a specialist's). */
export const MAIL_RULES =
	"send_message: darbam, kas pārsniedz tavu gājienu (jautājums citam aģentam, uzdevuma nodošana); atbilde pienāk vēlāk kā ziņa un tevi pamodina. Uz saņemtu ziņu atbildi ar send_message, kind reply, tajā pašā tematā.\n" +
	"delegate (ja tas tev ir): atskaitei, kas vajadzīga šajā pašā gājienā.\n" +
	"Nekad nesūti ziņu sev.";

export interface MailDeps {
	mailbox: Mailbox;
	/** this project's threads: the recipient's thread on the topic is found or made here */
	threads: ThreadStore;
	agents: () => readonly AgentSpec[];
	limits: () => Limits;
	/** who is sending: the run's agent, thread, project and wave; `depth` is how many hops deep the run is (0 = the user started it) */
	self: { agent: string; threadId: string; projectId: string | null; wave: string; depth: number };
	/** the message is in the mailbox: the coordinator delivers (and wakes) */
	enqueue: () => void;
	/** a line for the run's feed */
	note: (line: string) => void;
	/** the project's Atmiņa (its `ProjectStore`); returns null when the thread has no open project, and then no topic can be closed or passed up */
	notes?: () => { writeNote(n: Note): void; notes?(type: "question"): Note[] } | null;
	/** a question for the user was written: "Gaida tevi" changed */
	notesChanged?: () => void;
	/** the lead's current thread in this project (made when there is none); without it the project's thread store is asked */
	leadThread?: () => Thread;
	/** the project's process state, read at each call (the user may switch the mode between two); without it, or null, nothing of process mode applies */
	process?: () => ProcessState | null;
}

/** The state of process mode as it is now; null in co-work, with no state, or when it cannot be read (then the co-work rules hold). */
function processNow(d: MailDeps): ProcessState | null {
	try {
		const p = d.process?.() ?? null;
		return p?.mode === "process" ? p : null;
	} catch {
		return null;
	}
}

/** `stage` for a note written now: the stage that is on in process mode (R39), nothing in co-work. */
const stageOf = (d: MailDeps): { stage?: string } => {
	const p = processNow(d);
	return p ? { stage: p.stage } : {};
};

/** Who takes a pass-up in process mode (in co-work: the lead). */
const PROCESS_LEADER = "bpv";

export const NO_PROJECT = "Temata slēgšanai vajag atvērtu projektu.";

// a plain `enum` is a third the size of a union of literals in the declaration every request carries
const oneOf = <T extends string>(...v: T[]) => Type.Unsafe<T>(Type.String({ enum: v }));
const strs = Type.Array(Type.String());
const taskEnvelope = Type.Object({ stage: Type.Optional(Type.String()), goal: Type.String(), context: Type.Optional(strs), expects: Type.String(), iteration: Type.Optional(Type.Number()) });
const replyEnvelope = Type.Object({
	status: oneOf("izpildīts", "daļēji", "bloķēts"),
	results: Type.Optional(strs),
	questions: Type.Optional(strs),
	decisions: Type.Optional(strs),
	risks: Type.Optional(Type.String()),
});

const sendSchema = Type.Object({
	to: Type.String({ description: "Agent id." }),
	topic: Type.Optional(Type.String({ description: "Existing topic id." })),
	title: Type.Optional(Type.String({ description: "New topic; topic or title, not both." })),
	kind: oneOf("task", "ask", "reply"),
	text: Type.String(),
	refs: Type.Optional(strs),
	task: Type.Optional(taskEnvelope),
	reply: Type.Optional(replyEnvelope),
});

const closeSchema = Type.Object({
	topic: Type.String(),
	outcome: oneOf("agreed", "passed-up"),
	decision: Type.String({ description: "agreed: what was agreed; passed-up: what is unresolved and why." }),
	impact: Type.Object({ cost: Type.Boolean(), time: Type.Boolean(), norms: Type.Boolean(), pu: Type.Boolean() }, { description: "Does the agreement change cost, time, compliance with norms or the PU? true = it goes to the user." }),
});

/** What the four flags of `impact` are called in a note the user reads. */
const IMPACT_WORD = { cost: "izmaksas", time: "termiņu", norms: "normatīvo atbilstību", pu: "PU" } as const;

const result = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], details: {}, isError });

/** The ids of the messages of a topic: what a note about it refers to. */
const topicRefs = (d: MailDeps, topic: Topic) => d.mailbox.messages().filter((m) => m.topic === topic.id).map((m) => m.id);

/** Writes a question note about a topic and closes the topic `passed-up` with it. The question is addressed to the user when it is for the user, so the window hears of it. */
function askAbout(d: MailDeps, store: { writeNote(n: Note): void }, topic: Topic, q: { to: string; title: string; body: string }): Note {
	const note: Note = {
		id: newId("n"), type: "question", title: q.title, body: q.body, refs: topicRefs(d, topic), by: "agent", at: new Date().toISOString(),
		agent: d.self.agent, to: q.to, topic: topic.id, status: "open", ...stageOf(d),
	};
	store.writeNote(note);
	d.mailbox.closeTopic(topic.id, "passed-up", note.id);
	if (q.to === "user") d.notesChanged?.();
	return note;
}

/** The topic goes up: an open question for the lead (or for the user, when the caller is the lead) whose body is `why`; the topic closes `passed-up`.
 *  In process mode the question goes to bpv instead of the lead (to the user when the caller is bpv itself or the lead, who is no party of the process);
 *  `toUser` sends it to the user whoever the caller is (an iteration overflow: the user decides, not bpv).
 *  A question for the lead or bpv is also put in the mailbox as an `ask` from the caller on a new topic "Nodots: …", so that thread is woken and reads it
 *  (a note alone wakes nobody). It is a system notice: written straight into the mailbox, no send rules, not an exchange of the old topic.
 *  Past the chain depth no notice is sent (the notices skip `canSend`, so an agent that keeps answering would pass up for ever); the question goes to the user instead,
 *  so a pass-up always reaches someone.
 *  Used by `close_topic` (passed-up) and by a send refused at a limit. Throws NO_PROJECT when the thread has no Atmiņa to write into. */
export function passUp(d: MailDeps, topic: Topic, why: string, o: { toUser?: boolean } = {}): Note {
	const store = d.notes?.();
	if (!store) throw new Error(NO_PROJECT);
	const inProcess = processNow(d) !== null;
	const addressee = inProcess ? PROCESS_LEADER : LEAD_ID;
	const toUser = !!o.toUser || d.self.agent === LEAD_ID || d.self.agent === addressee || d.self.depth + 1 > d.limits().chainDepth;
	const note = askAbout(d, store, topic, { to: toUser ? "user" : addressee, title: `Nodots tālāk: ${topic.title}`, body: why });
	if (!toUser) {
		try {
			const thread = inProcess ? processLeaderThread(d, topic) : d.leadThread ? d.leadThread() : d.threads.lead(d.self.projectId, "");
			const notice = d.mailbox.openTopic({ title: `Nodots: ${topic.title}`, parties: [d.self.agent, addressee], parent: topic.id, notice: true });
			d.mailbox.add({
				wave: d.self.wave, topic: notice.id, from: d.self.agent, to: addressee, kind: "ask", text: why, refs: [note.id],
				fromThread: d.self.threadId, toThread: thread.id, depth: d.self.depth + 1,
			});
			d.enqueue();
		} catch {
			// the note is written and the topic closed; the notice could not be: the question still waits in Atmiņa
		}
	}
	return note;
}

/** bpv's newest open thread in this project; made, started by the caller, when it has none. */
function processLeaderThread(d: MailDeps, topic: Topic): Thread {
	return (
		d.threads.list({ agent: PROCESS_LEADER, open: true })[0] ??
		d.threads.create({ projectId: d.self.projectId, agent: PROCESS_LEADER, title: `Nodots: ${topic.title}`, startedBy: d.self.agent })
	);
}

/** Closes the open question notes eks wrote on a topic: the question has its answer (a real reply, or the coordinator's automatic one). */
export function closeEksQuestions(store: { writeNote(n: Note): void; notes?(type: "question"): Note[] }, topic: string): void {
	for (const q of store.notes?.("question") ?? []) if (q.agent === EKS && q.topic === topic && q.status === "open") store.writeNote({ ...q, status: "closed" });
}

/** S5 (14.6): what eks asks an author, and what the author answers, is also in Atmiņa, marked `agent: "eks"` (so eks reads it back and the user sees what was asked). The topic stays open:
 *  this is a record, not a pass-up. A write that fails leaves the mail as it is. */
function recordEksExchange(d: MailDeps, process: ProcessState | null, m: { from: string; to: string; kind: MessageKind; text: string }, topic: Topic): void {
	if (!process || process.stage !== "S5") return;
	const ask = m.from === EKS && m.kind === "ask";
	const answer = m.to === EKS && m.kind === "reply";
	if (!ask && !answer) return;
	try {
		const store = d.notes?.();
		if (!store) return;
		// the answer closes the question it answers, so the status page does not list it as open for ever
		if (answer) closeEksQuestions(store, topic.id);
		store.writeNote({
			id: newId("n"), type: "question", title: `${ask ? "Jautājums" : "Atbilde"}: ${topic.title}`, body: m.text, refs: [topic.id], by: "agent", at: new Date().toISOString(),
			agent: EKS, to: ask ? m.to : EKS, topic: topic.id, status: ask ? "open" : "closed", stage: process.stage,
		});
	} catch {
		// the message is sent; the record is a convenience
	}
}

/** send_message and close_topic, for pi (`extraTools` of the run). */
export function mailTools(d: MailDeps): AgentTool<any>[] {
	const send: AgentTool<typeof sendSchema> = {
		name: "send_message",
		label: "Ziņa aģentam",
		description: "Message another agent: ask, task, or reply. Returns at once; the answer wakes you later.",
		parameters: sendSchema,
		execute: async (_id, p: Static<typeof sendSchema>) => {
			if (!!p.topic === !!p.title?.trim()) return result("Norādi tieši vienu: topic (esoša temata id) vai title (jauns temats).", true);
			const { mailbox } = d;
			const existing = p.topic ? mailbox.topics().find((t) => t.id === p.topic) : undefined;
			if (p.topic && !existing) return result(`Temats ${p.topic} nav atrasts.`, true);
			if (existing && !(existing.parties.includes(d.self.agent) && existing.parties.includes(p.to))) {
				return result(`Temats «${existing.title}» ir starp ${existing.parties.join(" un ")}; ziņu uz to var sūtīt tikai viens no viņiem otram.`, true);
			}
			const process = processNow(d);
			const check = canSend(
				{ from: d.self.agent, to: p.to, kind: p.kind, topic: existing ?? null, depth: d.self.depth + 1, iteration: p.task?.iteration, stage: p.task?.stage },
				{ agents: d.agents(), limits: d.limits(), messages: mailbox.messages(), process },
			);
			if (!check.ok) {
				// a limit was reached: the topic goes up with the message that was not sent (a new topic is opened just to record that)
				if (check.passUp && d.notes?.()) {
					try {
						const topic = existing ?? mailbox.openTopic({ title: p.title!.trim(), parties: [d.self.agent, p.to], parent: null });
						const q = passUp(d, topic, `${check.reason}\nNeizsūtītā ziņa (${p.kind} → ${p.to}): ${p.text}`, { toUser: !!process && check.code === "iterations" });
						return result(`${check.reason} Jautājums ierakstīts Atmiņā (${q.id}).`, true);
					} catch {
						// the note could not be written: the plain refusal below
					}
				}
				return result(check.reason, true);
			}

			const topic = existing ?? mailbox.openTopic({ title: p.title!.trim(), parties: [d.self.agent, p.to], parent: null });
			// the thread the other side already has on this topic, else one opened for it
			const known = threadOnTopic(topic.id, p.to, mailbox.messages());
			const open = d.threads.list({ agent: p.to, open: true });
			const toThread =
				(known && open.find((t) => t.id === known)?.id) ??
				open.find((t) => t.topic === topic.id)?.id ??
				d.threads.create({ projectId: d.self.projectId, agent: p.to, title: topic.title, topic: topic.id, startedBy: d.self.agent }).id;

			const msg: Omit<Message, "id" | "at" | "state"> = {
				wave: d.self.wave, topic: topic.id, from: d.self.agent, to: p.to, kind: p.kind, text: p.text, refs: p.refs ?? [],
				fromThread: d.self.threadId, toThread, depth: d.self.depth + 1,
				// in process mode a task is for the stage that is on unless it says otherwise (and then it was refused above)
				...(p.task ? { task: { id: newId("u"), ...((p.task.stage ?? process?.stage) ? { stage: p.task.stage ?? process!.stage } : {}), goal: p.task.goal, context: p.task.context ?? [], expects: p.task.expects, iteration: p.task.iteration ?? 1 } } : {}),
				...(p.reply ? { reply: { id: newId("a"), status: p.reply.status, results: p.reply.results ?? [], questions: p.reply.questions ?? [], decisions: p.reply.decisions ?? [], risks: p.reply.risks } } : {}),
			};
			const added = mailbox.add(msg);
			recordEksExchange(d, process, msg, topic);
			d.note(`\n[lietotne] Ziņa → ${p.to}: ${topic.title}`);
			d.enqueue();
			return result(`Ziņa nosūtīta (${added.id}). Atbilde pienāks vēlāk; tagad pabeidz savu gājienu.`);
		},
	};
	const close: AgentTool<typeof closeSchema> = {
		name: "close_topic",
		label: "Temata slēgšana",
		description: "Close a topic you are a party of. agreed = a decision note in Atmiņa; passed-up = a question for the lead or the user. An agreement that changes cost, time, norms compliance or the PU is not yours to make: set that impact flag and it goes to the user as a question.",
		parameters: closeSchema,
		execute: async (_id, p: Static<typeof closeSchema>) => {
			const store = d.notes?.();
			if (!store) return result(NO_PROJECT, true);
			const topic = d.mailbox.topics().find((t) => t.id === p.topic);
			if (!topic) return result(`Temats ${p.topic} nav atrasts.`, true);
			if (!topic.parties.includes(d.self.agent)) return result(`Temats «${topic.title}» ir starp ${topic.parties.join(" un ")}; slēgt to var tikai viens no viņiem.`, true);
			// a notice is the lead's to answer; the agent that sent it already passed its topic up and has nothing more to close
			if (topic.notice && d.self.agent !== LEAD_ID) return result("Šo tematu slēdz galvenais aģents.", true);
			if (topic.state !== "open") return result(closedReason(topic), true);
			try {
				if (p.outcome === "passed-up") {
					const q = passUp(d, topic, p.decision);
					return result(`Temats «${topic.title}» nodots ${q.to === "user" ? "lietotājam" : "vadošajam aģentam"}: jautājums ierakstīts Atmiņā (${q.id}).`);
				}
				const flags = (Object.keys(IMPACT_WORD) as (keyof typeof IMPACT_WORD)[]).filter((k) => p.impact[k]);
				if (flags.length) {
					// agents do not settle what changes cost, time, norms or the PU: the proposal goes to the user
					const words = flags.map((k) => IMPACT_WORD[k]).join(", ");
					const q = askAbout(d, store, topic, {
						to: "user",
						title: `Jāizlemj: ${topic.title}`,
						body: `${topic.parties.join(" un ")} piedāvā lēmumu:\n${p.decision}\n\nTas ietekmē: ${words}. Šādu lēmumu pieņem lietotājs, nevis aģenti.`,
					});
					return result(`Vienošanās ietekmē ${words}: tā nav aģentu ziņā. Temats nodots lietotājam kā jautājums (${q.id}).`);
				}
				const other = topic.parties.find((x) => x !== d.self.agent) ?? topic.parties[0];
				const note: Note = {
					id: newId("n"), type: "decision", title: topic.title, body: p.decision, refs: topicRefs(d, topic), by: "agent", at: new Date().toISOString(),
					agent: d.self.agent, to: other, topic: topic.id, reviewed: false, ...stageOf(d),
				};
				store.writeNote(note);
				d.mailbox.closeTopic(topic.id, "agreed", note.id);
				return result(`Temats «${topic.title}» slēgts: vienošanās ierakstīta Atmiņā (${note.id}).`);
			} catch (e) {
				return result(e instanceof Error ? e.message : String(e), true);
			}
		},
	};
	return [send, close];
}

/** The two tools' declarations as the model sees them, for the estimate of what every request carries. */
export function mailDeclarations(): { name: string; description: string; parameters: unknown }[] {
	const stub = {} as MailDeps;
	return mailTools(stub).map((x) => ({ name: x.name, description: x.description, parameters: x.parameters }));
}
