// The mail tools of the main process: `send_message` puts a message into the project's mailbox for another agent and returns at once;
// the coordinator delivers it and wakes the recipient (coordinator.ts). `close_topic` is declared here and given its body in task 12.3.
// Like `delegate` they are handed to pi through `extraTools`, not served by the tools server.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentSpec } from "../shared/agent-types.js";
import { canSend, threadOnTopic, type Limits, type Mailbox, type Message } from "../core/messages.js";
import { newId } from "../core/model.js";
import type { ThreadStore } from "../core/threads.js";
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
}

// a plain `enum` is a third the size of a union of literals in the declaration every request carries
const oneOf = <T extends string>(...v: T[]) => Type.Unsafe<T>(Type.String({ enum: v }));
const strs = Type.Array(Type.String());
const taskEnvelope = Type.Object({ goal: Type.String(), context: Type.Optional(strs), expects: Type.String(), iteration: Type.Optional(Type.Number()) });
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
	decision: Type.String(),
});

const result = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], details: {}, isError });

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
			const check = canSend(
				{ from: d.self.agent, to: p.to, kind: p.kind, topic: existing ?? null, depth: d.self.depth + 1, iteration: p.task?.iteration },
				{ agents: d.agents(), limits: d.limits(), messages: mailbox.messages() },
			);
			// a refusal that passes the topic up (check.passUp) gets its side effects in task 12.3
			if (!check.ok) return result(check.reason, true);

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
				...(p.task ? { task: { id: newId("u"), goal: p.task.goal, context: p.task.context ?? [], expects: p.task.expects, iteration: p.task.iteration ?? 1 } } : {}),
				...(p.reply ? { reply: { id: newId("a"), status: p.reply.status, results: p.reply.results ?? [], questions: p.reply.questions ?? [], decisions: p.reply.decisions ?? [], risks: p.reply.risks } } : {}),
			};
			const added = mailbox.add(msg);
			d.note(`\n[lietotne] Ziņa → ${p.to}: ${topic.title}`);
			d.enqueue();
			return result(`Ziņa nosūtīta (${added.id}). Atbilde pienāks vēlāk; tagad pabeidz savu gājienu.`);
		},
	};
	const close: AgentTool<typeof closeSchema> = {
		name: "close_topic",
		label: "Temata slēgšana",
		description: "Close a topic: agreed, or passed-up to the lead or the user.",
		parameters: closeSchema,
		execute: async () => result("close_topic nāk ar 12.3.", true),
	};
	return [send, close];
}

/** The two tools' declarations as the model sees them, for the estimate of what every request carries. */
export function mailDeclarations(): { name: string; description: string; parameters: unknown }[] {
	const stub = {} as MailDeps;
	return mailTools(stub).map((x) => ({ name: x.name, description: x.description, parameters: x.parameters }));
}
