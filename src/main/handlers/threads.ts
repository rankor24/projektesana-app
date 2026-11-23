// Threads and the queue: talk to any agent (task 11.4). The session does the work; this file only adds the activity title a run is shown under.
import type { AgentSession } from "../../agent/session.js";
import { exportThread } from "../../core/thread-export.js";
import type { Handlers } from "../../shared/api.js";
import type { ActivityLog } from "../activity.js";

export interface ThreadDeps {
	session: AgentSession;
	/** what the agent is doing, in readable lines; absent in tests that do not look at it */
	activity?: ActivityLog;
}

type K = `threads.${string}` | "queue.view" | "queue.pause" | "queue.resume" | "queue.resumeWave" | "waiting.list" | "pause.set" | "incidents.retry" | "incidents.dismiss";

/** Starts a run under the activity log's title: named by the run's id before the run starts, dropped again when the start is refused. */
export async function titled(d: ThreadDeps, projectId: string | null, start: (onRunId: (runId: string, sent: string) => void) => Promise<{ runId: string | null; queued: boolean }>): Promise<{ runId: string | null; queued: boolean }> {
	let named: string | null = null;
	try {
		const r = await start((id, sent) => {
			named = id;
			d.activity?.begin(projectId, sent, id);
		});
		// a queued run opens with its first event
		if (r.runId && !r.queued) d.activity?.bind(r.runId);
		return r;
	} catch (e) {
		if (named) d.activity?.cancel(named);
		throw e;
	}
}

export function threadHandlers(d: ThreadDeps): Pick<Handlers, Extract<keyof Handlers, K>> {
	return {
		"threads.list": (projectId) => d.session.listThreads(projectId),
		"threads.open": (projectId, agent, title) => d.session.openThread(projectId, agent, title),
		"threads.send": (threadId, projectId, text, focus, attachments) => titled(d, projectId, (onRunId) => d.session.sendToThread(threadId, projectId, text, focus, attachments ?? [], onRunId)),
		"threads.history": (threadId, projectId) => d.session.threadHistory(threadId, projectId),
		"threads.stop": (threadId) => d.session.stopThread(threadId),
		"threads.close": (threadId, projectId) => d.session.closeThread(threadId, projectId),
		"threads.export": (threadId, projectId, format) => {
			// history first: it refuses a thread that is not in this project, with the same text as the history call
			const entries = d.session.threadHistory(threadId, projectId);
			const thread = d.session.listThreads(projectId).find((t) => t.id === threadId);
			if (!thread) throw new Error(`Saruna ${threadId} nav atrasta.`);
			return exportThread(thread, entries, format === "md" ? "md" : "jsonl");
		},
		"threads.rename": (threadId, projectId, title) => d.session.renameThread(threadId, projectId, title),
		"threads.pin": (threadId, projectId, pinned) => d.session.pinThread(threadId, projectId, pinned),
		"threads.reopen": (threadId, projectId) => d.session.reopenThread(threadId, projectId),
		"threads.seen": (threadId, projectId) => d.session.seenThread(threadId, projectId),
		"pause.set": (target, paused) => d.session.setHold(target, paused),
		// a retry starts a run under the activity log's title like any send
		"incidents.retry": (id) => d.session.retryIncident(id),
		"incidents.dismiss": (id) => d.session.dismissIncident(id),
		"queue.view": () => d.session.queueView(),
		"queue.pause": () => d.session.pauseQueue(),
		"queue.resume": () => d.session.resumeQueue(),
		"queue.resumeWave": (wave) => d.session.resumeWave(wave),
		"waiting.list": () => d.session.waiting(),
	};
}
