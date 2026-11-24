// The agent log (Žurnāls): the runs that have a log, one run's whole log, and a run as a file. The recorder is core/agent-log.ts; this only reads it.
import type { AgentLog } from "../../core/agent-log.js";
import type { Handlers } from "../../shared/api.js";

export interface AgentLogDeps {
	/** absent in tests that do not look at it */
	agentLog?: AgentLog;
}

type K = `agentlog.${string}`;

export function agentLogHandlers(d: AgentLogDeps): Pick<Handlers, Extract<keyof Handlers, K>> {
	return {
		"agentlog.runs": (projectId) => d.agentLog?.runs(projectId === undefined ? undefined : { projectId }) ?? [],
		"agentlog.read": (runId) => d.agentLog?.read(runId) ?? [],
		"agentlog.export": (runId, format) => {
			if (!d.agentLog) throw new Error("Žurnāls šeit nav pieejams.");
			return d.agentLog.export(runId, format === "jsonl" ? "jsonl" : "md");
		},
	};
}
