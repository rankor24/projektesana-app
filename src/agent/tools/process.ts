// Process mode as tools (task 14.3): the leader asks for a gate, skips a stage, changes the profile; eks records the S6 re-check. Every refusal is a Latvian
// text. No tool here, or anywhere, approves or returns a gate: that is `process.gate`, the user's click.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { type ProcessState, type ProfilePatch, changeProfile, readProcess, recordReview, requestGate, skipStage } from "../../core/process.js";
import { STAGE_CARD } from "../../core/process-def.js";
import { type ToolCtx, storeOf } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

const OFF = "Procesa režīms nav ieslēgts.";

/** The state of a project in process mode; anything else is a refusal (a project that never had the mode, or has gone back to co-work). */
function active(ctx: ToolCtx): ProcessState {
	const s = readProcess(storeOf(ctx));
	if (!s || s.mode !== "process") throw new Error(OFF);
	return s;
}

/** Ids of the agents in Iestatījumi → Aģenti (agents.json beside the settings); none saved yet means the shipped three, none of which can lead a process. */
function existingAgents(ctx: ToolCtx): string[] {
	const f = join(ctx.appDir, "agents.json");
	if (!existsSync(f)) return [];
	try {
		const j = JSON.parse(readFileSync(f, "utf8")) as { id?: unknown }[];
		return Array.isArray(j) ? j.map((a) => a.id).filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

export const processTools: ToolDef[] = [
	tool({
		name: "process_status",
		level: "read",
		description: "The project's process: stage, gates, profile, and the card of the current stage.",
		input: {},
		run: (ctx) => {
			const s = readProcess(storeOf(ctx));
			if (!s) return OFF;
			return { state: s, card: s.stage === "mācības" || s.stage === "done" ? null : STAGE_CARD[s.stage] };
		},
	}),
	tool({
		name: "process_request_gate",
		level: "run",
		description: "Ask the user to pass the current stage's gate (stage leader only). Fill the summary.",
		input: { result: z.array(z.string()), files: z.array(z.string()), deviations: z.string(), questions: z.array(z.string()), risks: z.string(), decisions: z.array(z.string()), next: z.string() },
		run: (ctx, a) => {
			const store = storeOf(ctx);
			// the mode and the leader are checked inside, on the state the request is applied to
			const r = requestGate(store, store.project.id, ctx.agent ?? "", a);
			const g = r.gates.at(-1)!;
			return { ok: true, gate: g.id, note: g.noteId, message: "Gate gaida lietotāja lēmumu (Gaida tevi). Nepārej uz nākamo stadiju, kamēr tas nav apstiprināts." };
		},
	}),
	tool({
		name: "process_skip_stage",
		level: "run",
		description: "Skip the current stage, with a reason (bpv only).",
		input: { why: z.string() },
		run: (ctx, { why }) => {
			active(ctx);
			if (ctx.agent !== "bpv") throw new Error("Tikai bpv var izlaist stadiju.");
			return { ok: true, stage: skipStage(storeOf(ctx), why, "agent").stage };
		},
	}),
	tool({
		name: "process_set_profile",
		level: "run",
		description: "Change the process profile: docType, depth per stage, agents; why is required (bpv only).",
		input: { why: z.string(), docType: z.string().optional(), depth: z.record(z.string(), z.string()).optional(), agents: z.array(z.string()).optional() },
		run: (ctx, a) => {
			active(ctx);
			if (ctx.agent !== "bpv") throw new Error("Tikai bpv var mainīt profilu.");
			// the same function as the user's: the reason, bpv, S6 and S7 are checked there
			const r = changeProfile(storeOf(ctx), a as ProfilePatch, existingAgents(ctx), "agent");
			return { ok: true, profile: r.profile };
		},
	}),
	tool({
		name: "process_review_done",
		level: "run",
		description: "Record the ekspertīze re-check of S6 (eks only); H6 needs it.",
		input: {},
		run: (ctx) => {
			active(ctx);
			if (ctx.agent !== "eks") throw new Error("Tikai eks var atzīmēt ekspertīzes atkārtotu pārbaudi.");
			recordReview(storeOf(ctx), "agent");
			return { ok: true };
		},
	}),
];
