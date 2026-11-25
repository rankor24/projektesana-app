// BPV edits the whole fleet's settings (the user's ruling of 2026-11-25: "allow BPV to actually edit whole fleet settings").
// One tool, `agent_configure`, level `confirm`: the user sees the batch and clicks. It changes ONE agent per call, as a patch (tools added or
// removed, skills added or removed, model, provider, effort, level cap, department, who it may write to, name, description, role text), so the
// agent never has to resend the whole list. The checks are the settings page's own: the call goes through the app's `agents.save` /
// `agents.role.set` (main/handlers/agents.ts: validateSpec, the context limits, the department list), so nothing here can save what the page
// would refuse. Before every save the old agents.json is copied to agents\versions and one line goes to agents\fleet-changes.jsonl; nothing
// is deleted. Given by the runner to `bpv` only (core/process-def.ts PROCESS_TOOLS_OF), never listed in a spec.
import { appendFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { LEAD_ID } from "../../shared/thread-types.js";
import { ROLE_MAX, type AgentSpec } from "../../shared/agent-types.js";
import { bridge } from "./app.js";
import type { ToolCtx } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

const names = z.array(z.string()).optional();

const patchShape = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	tools_add: names.describe("tool names to add (a `confirm` tool needs maxLevel confirm)"),
	tools_remove: names,
	skills_add: names,
	skills_remove: names,
	model: z.string().optional().describe("a model id; empty = the run's"),
	provider: z.string().optional().describe("a provider id; empty = the app's"),
	effort: z.string().optional(),
	maxLevel: z.enum(["run", "confirm"]).optional(),
	department: z.string().optional().describe("a department id; empty = in none"),
	mayMessage: names.describe("agent ids it may write to; [] = nobody"),
	acceptsFrom: names.describe("agent ids it takes messages from; [] = nobody"),
});

type Patch = z.infer<typeof patchShape>;

/** `list` with `add` and `remove` applied, in order, without repeats. */
const edited = (list: readonly string[] | undefined, add: readonly string[] | undefined, remove: readonly string[] | undefined): string[] => {
	const gone = new Set((remove ?? []).map((x) => x.trim()));
	return [...new Set([...(list ?? []), ...(add ?? []).map((x) => x.trim())].filter((x) => x && !gone.has(x)))];
};

/** The spec after the patch. Only fields the patch names change; an unknown or unusable value is left for the settings page's own check (validateSpec) to refuse. */
export function applyPatch(spec: AgentSpec, p: Patch): AgentSpec {
	const next: AgentSpec = { ...spec };
	if (p.name !== undefined) next.name = p.name;
	if (p.description !== undefined) next.description = p.description;
	if (p.tools_add || p.tools_remove) next.tools = edited(spec.tools, p.tools_add, p.tools_remove);
	if (p.skills_add || p.skills_remove) next.skills = edited(spec.skills, p.skills_add, p.skills_remove);
	if (p.model !== undefined) {
		if (p.model.trim()) next.model = p.model.trim();
		else delete next.model;
	}
	if (p.provider !== undefined) {
		if (p.provider.trim()) next.provider = p.provider.trim();
		else delete next.provider;
	}
	if (p.effort !== undefined) {
		if (p.effort.trim()) next.effort = p.effort.trim() as AgentSpec["effort"];
		else delete next.effort;
	}
	if (p.maxLevel !== undefined) next.maxLevel = p.maxLevel;
	if (p.department !== undefined) next.department = p.department.trim();
	if (p.mayMessage !== undefined) next.mayMessage = p.mayMessage;
	if (p.acceptsFrom !== undefined) next.acceptsFrom = p.acceptsFrom;
	return next;
}

/** Copies agents.json to agents\versions\agents-json.<time>.json and returns the line of the log written after the save. */
function keepOld(appDir: string): void {
	const file = join(appDir, "agents.json");
	if (!existsSync(file)) return;
	const dir = join(appDir, "agents", "versions");
	mkdirSync(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	let kept = join(dir, `agents-json.${stamp}.json`);
	for (let n = 1; existsSync(kept); n++) kept = join(dir, `agents-json.${stamp}.${n}.json`);
	copyFileSync(file, kept);
}

function logLine(appDir: string, line: Record<string, unknown>): void {
	const dir = join(appDir, "agents");
	mkdirSync(dir, { recursive: true });
	appendFileSync(join(dir, "fleet-changes.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`, "utf8");
}

const call = async (ctx: ToolCtx, name: string, level: "read" | "confirm", args: unknown[]): Promise<unknown> => (await bridge(ctx, "/call", { name, level, args })).result;

export const fleetTools: ToolDef[] = [
	tool({
		name: "agent_configure",
		level: "confirm",
		description:
			"Change ONE agent's settings (BPV only): add or remove tools and skills, set model / provider / effort / level cap / department / who it may write to, rename it, or add to or rewrite its role text. Read the fleet first with app_read agents.list (every agent with its tools, skills and context size). The settings page's own checks apply: a tool above the agent's level cap, an unknown tool or a context over the limit is refused with the reason. The user confirms the batch; the old settings are kept in agents\\versions.",
		input: {
			agent: z.string().describe("the id of the agent to change, e.g. ar, bk, avk"),
			changes: patchShape.optional(),
			role: z.object({ mode: z.enum(["append", "replace"]), text: z.string() }).optional().describe("the agent's role text (agents\\<id>.md): append adds a section, replace rewrites it and may not make it less than half as long"),
			reason: z.string().min(5),
		},
		run: async (ctx, a) => {
			const id = a.agent.trim();
			if (!id || id === LEAD_ID) throw new Error("Norādi aģenta identifikatoru (galvenā aģenta iestatījumus šeit nemaina).");
			const view = (await call(ctx, "agents.list", "read", [])) as { specs: (AgentSpec & { fixedTokens?: number })[] };
			const list = view.specs.map(({ fixedTokens: _t, ...s }) => s as AgentSpec);
			const spec = list.find((s) => s.id === id);
			if (!spec) throw new Error(`Nav aģenta ${id}. Esošie: ${list.map((s) => s.id).join(", ")}.`);
			let next = a.changes ? applyPatch(spec, a.changes) : { ...spec };
			if (!a.changes && !a.role) throw new Error("Nav ko mainīt: norādi changes vai role.");

			let roleDone = "";
			if (a.role) {
				const text = a.role.text.trim();
				if (text.length < 10) throw new Error("Lomas teksts ir pārāk īss.");
				const before = ((await call(ctx, "agents.role.get", "read", [id])) as string | null) ?? "";
				let after: string;
				if (a.role.mode === "append") after = `${before.trimEnd()}\n\n${text}\n`;
				else {
					if (before && text.length < before.length / 2) throw new Error("Aizvietojums, kas ir vairāk nekā uz pusi īsāks par esošo lomu, nav atļauts: pievieno ar mode append.");
					after = `${text}\n`;
				}
				if (after.length > ROLE_MAX) throw new Error(`Lomas teksts: līdz ${ROLE_MAX} zīmēm (būtu ${after.length}).`);
				// the text first: a spec with roleFile is saved only when its file exists; the replaced text is kept in agents\versions by the write itself
				await call(ctx, "agents.role.set", "confirm", [id, after]);
				next = { ...next, roleFile: true };
				roleDone = `; lomas teksts ${a.role.mode === "append" ? "papildināts" : "pārrakstīts"} (${after.length} zīmes)`;
			}

			const changed = JSON.stringify(next) !== JSON.stringify(spec);
			if (changed) {
				keepOld(ctx.appDir);
				await call(ctx, "agents.save", "confirm", [list.map((s) => (s.id === id ? next : s))]);
			}
			logLine(ctx.appDir, { by: ctx.agent ?? LEAD_ID, agent: id, reason: a.reason, changes: a.changes ?? null, role: a.role ? { mode: a.role.mode, chars: a.role.text.length } : null, before: spec, after: next });
			return { ok: true, agent: id, settings: changed, note: `Aģenta ${id} iestatījumi ${changed ? "saglabāti" : "nav mainīti"}${roleDone}. Vecie iestatījumi ir mapē agents\\versions; izmaiņu žurnāls agents\\fleet-changes.jsonl. Maiņa stājas spēkā aģenta nākamajā gājienā.` };
		},
	}),
];
