// Messages between agents: the shapes, the send rules (pure) and a small on-disk mailbox.
// Nothing here runs an agent; delivery and waking are the coordinator's job (task 12.2).
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSpec } from "../shared/agent-types.js";
import { LEAD_ID } from "../shared/thread-types.js";
import { newId } from "./model.js";

export type MessageKind = "task" | "reply" | "ask";

/** The office's UZDEVUMS (process 7.1) as data. */
export interface TaskEnvelope { id: string; stage?: string; goal: string; context: string[]; expects: string; iteration: number; limits?: string }
/** The office's ATBILDE (process 7.2) as data. */
export interface ReplyEnvelope { id: string; status: "izpildīts" | "daļēji" | "bloķēts"; results: string[]; questions: string[]; decisions: string[]; risks?: string }

export interface Message {
	id: string;
	at: string;
	wave: string;
	topic: string;
	from: string;
	to: string;
	kind: MessageKind;
	text: string;
	refs: string[];
	fromThread: string;
	toThread: string;
	depth: number;
	state: "queued" | "delivered" | "failed" | "stopped";
	task?: TaskEnvelope;
	reply?: ReplyEnvelope;
}

export interface Topic {
	id: string;
	title: string;
	parties: [string, string];
	parent: string | null;
	state: "open" | "agreed" | "passed-up";
	openedAt: string;
	closedAt?: string;
	noteId?: string;
}

export interface Limits { exchangesPerTopic: number; chainDepth: number; runsPerWave: number; waveCost: number | null; taskIterations: number }
export const DEFAULT_LIMITS: Limits = { exchangesPerTopic: 3, chainDepth: 6, runsPerWave: 20, waveCost: null, taskIterations: 3 };

export type SendCheck =
	| { ok: true }
	| { ok: false; code: "self" | "unknown-agent" | "acl" | "closed" | "exchanges" | "depth" | "iterations" | "process"; reason: string; passUp: boolean };

// `mayMessage` / `acceptsFrom` arrive with the spec v2 (task 13.1); until then they are absent and every pair is allowed.
type Acl = { mayMessage?: string[]; acceptsFrom?: string[] };
const aclOf = (s: AgentSpec | undefined): Acl => (s ?? {}) as Acl;

const refuse = (code: Exclude<SendCheck, { ok: true }>["code"], reason: string, passUp = false): SendCheck => ({ ok: false, code, reason, passUp });

const STATE_WORD: Record<Topic["state"], string> = { open: "atvērts", agreed: "vienošanās panākta", "passed-up": "nodots tālāk" };

/** The send rules, in this order: self, unknown-agent, acl, closed, exchanges, depth, iterations. The first that fails decides. */
export function canSend(
	m: { from: string; to: string; kind: MessageKind; topic: Topic | null; depth: number; iteration?: number },
	c: { agents: readonly AgentSpec[]; limits: Limits; messages: readonly Message[] },
): SendCheck {
	if (m.from === m.to) return refuse("self", `Aģents «${m.from}» nevar sūtīt ziņu pats sev.`);

	// The lead is not a spec but always exists; "user" is never a message party (the user talks in threads, not in the mailbox).
	const spec = (id: string) => c.agents.find((a) => a.id === id);
	const known = (id: string) => id === LEAD_ID || !!spec(id);
	for (const id of [m.from, m.to]) {
		if (!known(id)) return refuse("unknown-agent", `Nezināms aģents «${id}»: ziņas var sūtīt tikai uzstādītiem aģentiem un vadošajam aģentam.`);
	}

	// A reply inside its own open topic always gets through, so an agent that takes messages from nobody still hears the answers to its own questions.
	const t = m.topic;
	const answersOwnTopic = m.kind === "reply" && !!t && t.state === "open" && t.parties.includes(m.from) && t.parties.includes(m.to);
	if (!answersOwnTopic) {
		const may = aclOf(spec(m.from)).mayMessage;
		if (may && !may.includes(m.to)) return refuse("acl", `Aģentam «${m.from}» nav atļauts sūtīt ziņas aģentam «${m.to}».`);
		const accepts = aclOf(spec(m.to)).acceptsFrom;
		if (accepts && !accepts.includes(m.from)) return refuse("acl", `Aģents «${m.to}» nepieņem ziņas no aģenta «${m.from}».`);
	}

	if (t && t.state !== "open") return refuse("closed", `Temats «${t.title}» jau ir slēgts (${STATE_WORD[t.state]}).`);

	if (t) {
		const sent = c.messages.filter((x) => x.topic === t.id && x.from === m.from).length;
		if (sent >= c.limits.exchangesPerTopic) return refuse("exchanges", `Par tematu «${t.title}» jau ir ${sent} ziņas no ${m.from}; temats nodots tālāk.`, true);
	}

	if (m.depth > c.limits.chainDepth) {
		return refuse("depth", `Ziņu ķēdes dziļums ${m.depth} pārsniedz atļauto ${c.limits.chainDepth}; temats nodots tālāk.`, true);
	}

	if (m.kind === "task" && (m.iteration ?? 0) > c.limits.taskIterations) {
		return refuse("iterations", `Uzdevuma iterācija ${m.iteration} pārsniedz atļauto ${c.limits.taskIterations}; temats nodots tālāk.`, true);
	}

	return { ok: true };
}

/** Messages waiting for this thread, in the order they were added. */
export function inboxOf(threadId: string, ms: readonly Message[]): Message[] {
	return ms.filter((m) => m.state === "queued" && m.toThread === threadId);
}

/** This thread's tasks and asks still waiting for an answer: no later message on the same topic came back to this thread.
 *  Failed and stopped ones are not waited for. Any later message back counts as an answer, whatever its own state, so a thread never waits for ever. */
export function pendingOf(threadId: string, ms: readonly Message[]): Message[] {
	return ms.filter(
		(m, i) =>
			m.fromThread === threadId &&
			(m.kind === "task" || m.kind === "ask") &&
			m.state !== "failed" &&
			m.state !== "stopped" &&
			!ms.some((r, j) => j > i && r.topic === m.topic && r.toThread === threadId),
	);
}

/** The thread should run now: a task or an ask in its inbox wakes it at once (another agent is waiting for it, and it may be waiting for that agent
 *  on another topic: holding the ask back would deadlock the two); replies alone are batched until nothing the thread asked is still unanswered. */
export function shouldWake(threadId: string, ms: readonly Message[]): boolean {
	const inbox = inboxOf(threadId, ms);
	if (!inbox.length) return false;
	if (inbox.some((m) => m.kind !== "reply")) return true;
	return pendingOf(threadId, ms).length === 0;
}

/** Has this task or ask got an answer: a later message on its topic that came back to the thread that sent it (the test `pendingOf` uses). */
export function answered(m: Message, ms: readonly Message[]): boolean {
	const i = ms.findIndex((x) => x.id === m.id);
	return ms.some((r, j) => j > i && r.topic === m.topic && r.toThread === m.fromThread);
}

const list = (xs: readonly string[]) => (xs.length ? xs.join("; ") : "nav");

/** The office's UZDEVUMS block (process 7.1). `of` is the iteration limit the "n no 3" line shows. */
export function renderTask(t: TaskEnvelope, agent: string, of: number = DEFAULT_LIMITS.taskIterations): string {
	return [
		`UZDEVUMS: ${t.id} | Stadija: ${t.stage || "nav"} | Aģents: ${agent}`,
		`Mērķis: ${t.goal}`,
		`Konteksta pakete: ${list(t.context)}`,
		`Gaidāmā izeja: ${t.expects}`,
		`Termiņš / iterācija: ${t.iteration} no ${of}`,
		`Ierobežojumi: ${t.limits || "nav"}`,
	].join("\n");
}

/** The office's ATBILDE block (process 7.2). */
export function renderReply(r: ReplyEnvelope): string {
	return [
		`ATBILDE: ${r.id} | Statuss: ${r.status}`,
		`Rezultāts: ${list(r.results)}`,
		`Jautājumi: ${list(r.questions)}`,
		`Vienošanās: ${list(r.decisions)}`,
		`Riski: ${r.risks || "nav"}`,
	].join("\n");
}

/** Where a project's mail lives: inside the project's data folder; with no project, under the app's data folder. */
export function mailDir(appDir: string, projectsDir: string, projectId: string | null): string {
	return projectId ? join(projectsDir, projectId, "mail") : join(appDir, "mail", "_");
}

/** The depth of a run a message starts: the deepest of the messages it reads (a message already counts its hop). A run the user starts has depth 0. */
export function runDepth(ids: readonly string[], ms: readonly Message[]): number {
	return Math.max(0, ...ms.filter((m) => ids.includes(m.id)).map((m) => m.depth));
}

/** The thread of `agent` that is on this topic, read from the mail itself: the newest message of the topic that `agent` sent or got names it.
 *  A thread the user began has no `topic` of its own, so the thread's own field is not enough to find it again. */
export function threadOnTopic(topicId: string, agent: string, ms: readonly Message[]): string | null {
	for (let i = ms.length - 1; i >= 0; i--) {
		const m = ms[i];
		if (m.topic !== topicId) continue;
		if (m.from === agent) return m.fromThread;
		if (m.to === agent) return m.toThread;
	}
	return null;
}

/** The open topics a thread takes part in, for the line every run's prompt carries (a compacted thread must still know them). */
export function openTopicsOf(thread: { id: string; topic: string | null }, topics: readonly Topic[], ms: readonly Message[]): Topic[] {
	return topics.filter((t) => t.state === "open" && (t.id === thread.topic || ms.some((m) => m.topic === t.id && (m.fromThread === thread.id || m.toThread === thread.id))));
}

export function topicsLine(open: readonly Topic[]): string {
	return open.length ? `Atvērti temati šajā sarunā: ${open.map((t) => `${t.id} «${t.title}»`).join("; ")}.` : "";
}

/** The text of a run a message starts: every message in order, headed with who wrote it, on what topic, of what kind. */
export function deliveryText(inbox: readonly Message[], topics: readonly Topic[]): string {
	return inbox
		.map((m) => {
			const head = `[no ${m.from} · ${topics.find((t) => t.id === m.topic)?.title ?? m.topic} · ${m.kind}]`;
			// the envelope when there is one; the free text beside it only if the envelope does not already say it
			const env = [m.task ? renderTask(m.task, m.to) : "", m.reply ? renderReply(m.reply) : ""].filter(Boolean).join("\n");
			const text = m.text.trim();
			const body = env ? (text && !env.includes(text) ? `${env}\n${text}` : env) : text;
			return `${head}\n${body}`;
		})
		.join("\n\n");
}

function atomicWrite(file: string, body: string) {
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, body);
	renameSync(tmp, file);
}

function endsWithoutNewline(file: string): boolean {
	if (!existsSync(file)) return false;
	const size = statSync(file).size;
	if (size === 0) return false;
	const fd = openSync(file, "r");
	try {
		const b = Buffer.alloc(1);
		readSync(fd, b, 0, 1, size - 1);
		return b[0] !== 0x0a;
	} finally {
		closeSync(fd);
	}
}

/** One project's mail: `messages.jsonl` (append-only; a state change is a new line with the same id, the last line of an id wins; a torn line is skipped)
 *  and `topics.json` (rewritten atomically). Everything is read from disk on each call, so two handles on one folder agree. */
export class Mailbox {
	constructor(private readonly dir: string) {}

	private get messagesFile() {
		return join(this.dir, "messages.jsonl");
	}
	private get topicsFile() {
		return join(this.dir, "topics.json");
	}

	/** A file that is missing is no topics; one that cannot be read as a list is `damaged` (and no topics) until `writeTopics` has kept a copy of it. */
	private readTopics(): { topics: Topic[]; damaged: boolean } {
		if (!existsSync(this.topicsFile)) return { topics: [], damaged: false };
		try {
			const raw: unknown = JSON.parse(readFileSync(this.topicsFile, "utf8"));
			if (!Array.isArray(raw)) return { topics: [], damaged: true };
			return { topics: (raw as Topic[]).filter((t) => typeof t?.id === "string"), damaged: false };
		} catch {
			return { topics: [], damaged: true };
		}
	}

	topics(): Topic[] {
		return this.readTopics().topics;
	}

	/** In the order each id first appeared, each as its last line left it. */
	messages(): Message[] {
		if (!existsSync(this.messagesFile)) return [];
		const byId = new Map<string, Message>();
		for (const line of readFileSync(this.messagesFile, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const m = JSON.parse(line) as Message;
				if (typeof m?.id === "string") byId.set(m.id, m);
			} catch {
				// a torn line is skipped
			}
		}
		return [...byId.values()];
	}

	private writeTopics(ts: Topic[]) {
		mkdirSync(this.dir, { recursive: true });
		// the rewrite would replace a file nobody could read: keep it first (never over an earlier copy), nothing is deleted
		if (this.readTopics().damaged) {
			let bad = `${this.topicsFile}.bad`;
			for (let n = 2; existsSync(bad); n++) bad = `${this.topicsFile}.bad${n}`;
			copyFileSync(this.topicsFile, bad);
		}
		atomicWrite(this.topicsFile, JSON.stringify(ts, null, 1));
	}

	openTopic(t: Omit<Topic, "id" | "state" | "openedAt">): Topic {
		const topic: Topic = { ...t, id: newId("tp"), state: "open", openedAt: new Date().toISOString() };
		this.writeTopics([...this.topics(), topic]);
		return topic;
	}

	closeTopic(id: string, state: "agreed" | "passed-up", noteId: string): Topic {
		const all = this.topics();
		const t = all.find((x) => x.id === id);
		if (!t) throw new Error(`Temats ${id} nav atrasts.`);
		if (t.state !== "open") throw new Error(`Temats ${id} jau ir slēgts.`);
		const next: Topic = { ...t, state, noteId, closedAt: new Date().toISOString() };
		this.writeTopics(all.map((x) => (x.id === id ? next : x)));
		return next;
	}

	private append(m: Message) {
		mkdirSync(this.dir, { recursive: true });
		// a torn last line has no newline; without one the new line would be glued to it and lost with it
		appendFileSync(this.messagesFile, (endsWithoutNewline(this.messagesFile) ? "\n" : "") + JSON.stringify(m) + "\n", "utf8");
	}

	add(m: Omit<Message, "id" | "at" | "state">): Message {
		const msg: Message = { ...m, id: newId("m"), at: new Date().toISOString(), state: "queued" };
		this.append(msg);
		return msg;
	}

	setState(id: string, s: Message["state"]): void {
		const m = this.messages().find((x) => x.id === id);
		if (!m) throw new Error(`Ziņa ${id} nav atrasta.`);
		this.append({ ...m, state: s });
	}
}
