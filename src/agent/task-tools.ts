// The tools of BPV as Chief of Staff, and the one every agent answers a task with:
//   assign_task    BPV (and a department lead, inside its department) hands out a task in the process's fixed UZDEVUMS format into the agent's standing task thread for
//                  that stage (found or made; its title carries the task id), and the agent is started (the coordinator wakes it as for any mail).
//   report_answer  the agent answers in the fixed ATBILDE format; the answer is posted into the thread of the one that handed the task out.
//   escalate       BPV puts a question to the user with up to three options and a recommendation (process §8: cost, deadline, regulation risk, unresolved after 3).
//   list_incidents BPV / a department lead reads the open incidents (failed, stalled, could not start) of the agents it manages: agent, thread, kind, when, what the run said.
//   retry_thread   ... and retries one: the user's own Retry (coordinator.retryIncident, same limits: twice an hour), refused for a paused agent or one outside its reach.
// Like the mail tools they are main-process tools handed to the engine as `extraTools`, not served by the tools server.
//
// Ported from OpenMausBot (Apache-2.0): server/coordinator.ts + server/chief-of-staff.ts (`coordinate_bots`: work goes into the conversation's one standing work thread with
// each teammate, with a brief that is "clear, self-contained"; the call returns at once and the Chief resumes when the result returns; "a refusal ... means nothing was
// sent: fix what it names and retry; never describe a handoff the tool did not accept"), docs/approval-levels.md (the Chief's ceiling flows down), server/host/rework-cap.ts
// (rework is counted and stops at a limit), server/drivers/agents-call.ts + docs/team-incidents.md (`retry_thread`: Chief-only, for a teammate the Chief can reach; the retried
// thread keeps its own approval level, the Chief is not woken for its result; "retry once, then report" is the standing rule). The formats and the limits are the BD process's (§7.1, §7.2, §8): chief.ts has the pure parts.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "@earendil-works/pi-ai";
import { canSend, answered, type Message } from "../core/messages.js";
import { holdsChiefTools, mayAssign, mayHandleIncidentOf, nextIteration, nextTaskId, openTaskIn, standingThread, STAGE_RE, taskThreadTitle, topicTitle } from "../core/chief.js";
import { newId, type Note } from "../core/model.js";
import { checkEscalation, ESCALATION_REASONS, renderEscalation, type Escalation } from "../shared/escalation.js";
import { limitsOf } from "../core/messages.js";
import type { IncidentView } from "../shared/thread-types.js";
import { oneOf, processNow, result, strs, type MailDeps } from "./mail.js";

const assignSchema = Type.Object({
	to: Type.String({ description: "Agent id." }),
	stage: Type.Optional(Type.String({ description: "S1..S7; the stage that is on when absent." })),
	goal: Type.String({ description: "1-2 sentences." }),
	context: Type.Optional(Type.Array(Type.String(), { description: "File paths to read." })),
	expects: Type.String({ description: "Output file or format." }),
	limits: Type.Optional(Type.String({ description: "What not to do." })),
	rework: Type.Optional(Type.Boolean({ description: "true = another round of the same work; the iteration counts up to 3." })),
});

const answerSchema = Type.Object({
	status: oneOf("izpildīts", "daļēji", "bloķēts"),
	results: Type.Optional(strs),
	questions: Type.Optional(strs),
	decisions: Type.Optional(strs),
	risks: Type.Optional(Type.String()),
});

const retrySchema = Type.Object({
	incident: Type.Optional(Type.String({ description: "Incident id from list_incidents." })),
	thread: Type.Optional(Type.String({ description: "Or the thread id of the incident." })),
});

const escalateSchema = Type.Object({
	reason: oneOf(...ESCALATION_REASONS),
	problem: Type.String(),
	options: Type.Array(Type.String(), { minItems: 1, maxItems: 3 }),
	recommend: Type.Number({ description: "Number of the option you recommend (1-based)." }),
	impact: Type.Optional(Type.String({ description: "Effect on cost and time." })),
});

/** The question note that puts an escalation to the user: it shows in Gaida tevi with its options as buttons. */
export function raiseEscalation(d: MailDeps, e: Escalation): Note {
	const store = d.notes?.();
	if (!store) throw new Error("Eskalācijai vajag atvērtu projektu.");
	const stage = processNow(d)?.stage;
	const note: Note = {
		id: newId("n"), type: "question", title: `Eskalācija (${e.reason}): ${e.problem.slice(0, 70)}`, body: renderEscalation(e), refs: [], by: "agent", at: new Date().toISOString(),
		agent: d.self.agent, to: "user", status: "open", ...(stage ? { stage } : {}),
	};
	store.writeNote(note);
	d.notesChanged?.();
	return note;
}

/** What the user is offered when a stage's task has gone round three times (process §1.5, §8): accept it as it is, one more round with the user's own instruction, or another way. */
function iterationEscalation(to: string, stage: string, iteration: number, limit: number, goal: string): Escalation {
	return {
		reason: "neatrisināts",
		problem: `${to}${stage ? ` (${stage})` : ""}: uzdevums «${goal.slice(0, 80)}» jau ir ${iteration - 1} reizes pārstrādāts (limits ${limit}); nākamā kārta ir ${iteration}. un to drīkst dot tikai ar tavu lēmumu.`,
		options: [`Pieņemt ${to} pēdējo rezultātu tāds, kāds tas ir.`, `Atļaut vēl vienu kārtu ar tavu norādījumu (ieraksti to atbildē).`, `Mainīt pieeju: nodot darbu citam aģentam vai pārformulēt mērķi.`],
		recommend: 1,
		impact: "Vēl viena kārta maksā laiku un modeļa izmaksas; pārējām sadaļām gaidīšana var aizkavēt stadiju.",
	};
}

/** assign_task and escalate (for a Chief: BPV, or a department lead) and report_answer (for every agent that can be given a task). */
export function taskTools(d: MailDeps, o: { chief: boolean }): AgentTool<any>[] {
	const answer: AgentTool<typeof answerSchema> = {
		name: "report_answer",
		label: "ATBILDE",
		description: "Answer the task you were given (UZDEVUMS) in the fixed format: status, result files, questions, agreements, risks. Short; the content is in files. Then end your turn.",
		parameters: answerSchema,
		execute: async (_id, p: Static<typeof answerSchema>) => {
			const all = d.mailbox.messages();
			const task = openTaskIn(all, d.self.threadId, answered);
			if (!task || !task.task) return result("Šajā sarunā nav atvērta uzdevuma, uz ko atbildēt.", true);
			const topic = d.mailbox.topics().find((t) => t.id === task.topic) ?? null;
			const check = canSend({ from: d.self.agent, to: task.from, kind: "reply", topic, depth: d.self.depth + 1 }, { agents: d.agents(), limits: d.limits(), messages: all, process: processNow(d), departments: d.departments?.() });
			if (!check.ok) return result(check.reason, true);
			const msg = d.mailbox.add({
				wave: d.self.wave, topic: task.topic, from: d.self.agent, to: task.from, kind: "reply", text: (p.results ?? []).join("; "), refs: [], fromThread: d.self.threadId, toThread: task.fromThread, depth: d.self.depth + 1,
				reply: { id: task.task.id, status: p.status, results: p.results ?? [], questions: p.questions ?? [], decisions: p.decisions ?? [], risks: p.risks },
			});
			d.note(`\n[lietotne] ATBILDE ${task.task.id} → ${task.from} (${p.status})`);
			d.enqueue();
			return result(`ATBILDE ${task.task.id} nosūtīta (${msg.id}). Pabeidz savu gājienu.`);
		},
	};
	if (!o.chief) return [answer];

	const assign: AgentTool<typeof assignSchema> = {
		name: "assign_task",
		label: "Uzdevums",
		description: "Hand a task to an agent in the fixed UZDEVUMS format. It goes into that agent's standing thread for the stage and the agent starts. Returns at once; the ATBILDE comes back later. A refusal means nothing was sent.",
		parameters: assignSchema,
		execute: async (_id, p: Static<typeof assignSchema>) => {
			const agents = d.agents();
			const departments = d.departments?.() ?? [];
			const may = mayAssign(d.self.agent, p.to, agents, departments);
			if (!may.ok) return result(may.reason, true);
			const held = d.held?.(p.to);
			if (held) return result(held, true);
			const process = processNow(d);
			const stage = (p.stage ?? process?.stage ?? "").trim().toUpperCase();
			if (stage && !STAGE_RE.test(stage)) return result("Stadija ir S1 līdz S7.", true);
			if (!p.goal.trim() || !p.expects.trim()) return result("Uzdevumam vajag mērķi un gaidāmo izeju.", true);
			const all = d.mailbox.messages();
			const limits = d.limits();
			const standing = standingThread(d.threads.list({ agent: p.to, open: true }), stage, p.to);
			const iteration = standing ? nextIteration(all, standing.id, stage, !!p.rework) : 1;
			const id = nextTaskId(all);
			const check = canSend({ from: d.self.agent, to: p.to, kind: "task", topic: null, depth: d.self.depth + 1, iteration, stage: stage || undefined }, { agents, limits, messages: all, process, departments });
			if (!check.ok) {
				// the 4th round of one stage's work is the user's to allow (process §1.5, §8): the refusal becomes a question with options
				if (check.code === "iterations" && d.notes?.()) {
					try {
						const q = raiseEscalation(d, iterationEscalation(p.to, stage, iteration, limitsOf({ limits }).taskIterations, p.goal));
						return result(`${check.reason} Jautājums lietotājam ierakstīts (${q.id}); uzdevumu vairs nedod, kamēr viņš neatbild.`, true);
					} catch {
						// no project to write into: the plain refusal below
					}
				}
				return result(check.reason, true);
			}
			const title = taskThreadTitle(stage, p.to, id);
			let thread = standing;
			if (thread) {
				thread = d.threads.patch(thread.id, { title });
			} else thread = d.threads.create({ projectId: d.self.projectId, agent: p.to, title, startedBy: d.self.agent });
			d.threadChanged?.(thread);
			const topic = d.mailbox.openTopic({ title: topicTitle(id, p.goal), parties: [d.self.agent, p.to], parent: null });
			const level = d.level?.();
			const msg: Omit<Message, "id" | "at" | "state"> = {
				wave: d.self.wave, topic: topic.id, from: d.self.agent, to: p.to, kind: "task", text: p.goal, refs: [], fromThread: d.self.threadId, toThread: thread.id, depth: d.self.depth + 1,
				task: { id, ...(stage ? { stage } : {}), goal: p.goal.trim(), context: p.context ?? [], expects: p.expects.trim(), iteration, ...(p.limits?.trim() ? { limits: p.limits.trim() } : {}) },
				...(level ? { level } : {}),
			};
			d.mailbox.add(msg);
			d.note(`\n[lietotne] UZDEVUMS ${id} → ${p.to}${stage ? ` (${stage}, ${iteration}/${limits.taskIterations})` : ""}`);
			d.enqueue();
			return result(`UZDEVUMS ${id} nodots: ${p.to}, stadija ${stage || "nav"}, iterācija ${iteration} no ${limits.taskIterations}, saruna «${title}». ATBILDE pienāks vēlāk; tagad pabeidz savu gājienu.`);
		},
	};

	const escalate: AgentTool<typeof escalateSchema> = {
		name: "escalate",
		label: "Eskalācija",
		description: "Put a decision to the user: cost, deadline, regulation risk, or unresolved after 3 iterations. Problem, up to 3 options, your recommendation, impact on cost and time. It waits in Gaida tevi; the user's answer comes back to you.",
		parameters: escalateSchema,
		execute: async (_id, p: Static<typeof escalateSchema>) => {
			const c = checkEscalation({ reason: p.reason, problem: p.problem, options: p.options, recommend: p.recommend, impact: p.impact });
			if (!c.ok) return result(c.error, true);
			try {
				const q = raiseEscalation(d, c.value);
				return result(`Eskalācija nodota lietotājam (${q.id}). Atbilde pienāks kā ziņa; līdz tam šo lēmumu nepieņem pats.`);
			} catch (e) {
				return result(e instanceof Error ? e.message : String(e), true);
			}
		},
	};

	const list: AgentTool<typeof emptySchema> = {
		name: "list_incidents",
		label: "Incidenti",
		description: "The open incidents (a run failed, stalled or could not start) of the agents you manage: agent, thread, kind, when, what the run said, whether Retry is still allowed.",
		parameters: emptySchema,
		execute: async () => {
			const agents = d.agents();
			const departments = d.departments?.() ?? [];
			const mine = (d.incidents?.() ?? []).filter((i) => mayHandleIncidentOf(d.self.agent, i.agent, agents, departments).ok);
			if (!mine.length) return result("Atvērtu incidentu nav.");
			return result(mine.map(incidentLine).join("\n"));
		},
	};

	const retry: AgentTool<typeof retrySchema> = {
		name: "retry_thread",
		label: "Atkārtot sarunu",
		description: "Retry the thread of an incident, as the user's Retry does (twice an hour per thread at most). Not for a paused agent or one outside your department. Its result stays in that thread.",
		parameters: retrySchema,
		execute: async (_id, p: Static<typeof retrySchema>) => {
			const key = (p.incident ?? "").trim() || (p.thread ?? "").trim();
			if (!key) return result("Norādi incidentu vai sarunu (id no list_incidents).", true);
			const found = (d.incidents?.() ?? []).find((i) => i.id === key || i.threadId === key);
			if (!found) return result("Šāda atvērta incidenta nav: to jau kāds atkārtoja vai noņēma. Skaties list_incidents.", true);
			const may = mayHandleIncidentOf(d.self.agent, found.agent, d.agents(), d.departments?.() ?? []);
			if (!may.ok) return result(may.reason, true);
			if (!d.retryIncident) return result("Atkārtošana šeit nav pieejama.", true);
			try {
				const r = d.retryIncident(found.id);
				d.note(`\n[lietotne] ATKĀRTOJA sarunu ${found.threadId} (${found.agent})`);
				return result(`Saruna ${found.threadId} (${found.agent}) ${r.queued ? "ielikta rindā" : "atkal darbojas"}. Rezultāts paliek tajā sarunā, tevi tas nepamodina; vēlāk pārbaudi ar list_incidents. Ja tā neizdodas vēlreiz, eskalē, nemēģini trešo reizi.`);
			} catch (e) {
				return result(e instanceof Error ? e.message : String(e), true);
			}
		},
	};
	return [answer, assign, escalate, list, retry];
}

const emptySchema = Type.Object({});

const KIND_WORD = { failed: "neizdevās", stalled: "pārstāja darboties", "not-started": "nevarēja sākties" } as const;

/** One incident as a line for list_incidents: id, agent, thread, kind, when, retries, who retried it, what the run said and what it was asked. */
export function incidentLine(i: IncidentView): string {
	const when = i.at.slice(0, 16).replace("T", " ");
	const retried = i.retries > 0 ? `atkārtots ${i.retries}×${i.retriedBy ? ` (${i.retriedBy} atkārtoja)` : ""}` : "neatkārtots";
	return `${i.id} · ${i.agent} · saruna ${i.threadId} · ${KIND_WORD[i.what]} · ${when} · ${retried} · ${i.mayRetry ? "atkārtot drīkst" : "atkārtot vairs nedrīkst, eskalē"} · «${i.detail}»${i.request ? ` · prasība: «${i.request}»` : ""}`;
}

/** Does this run get the Chief's tools: BPV, or a department's lead (chief.ts). */
export const chiefOf = (d: Pick<MailDeps, "agents" | "departments" | "self">): boolean => holdsChiefTools(d.self.agent, d.agents(), d.departments?.() ?? []);

/** The task tools' declarations as the model sees them (the estimate of what a request carries): report_answer for everyone, the Chief's two on top. */
export function taskDeclarations(chief: boolean): { name: string; description: string; parameters: unknown }[] {
	const stub = {} as MailDeps;
	return taskTools(stub, { chief }).map((x) => ({ name: x.name, description: x.description, parameters: x.parameters }));
}
