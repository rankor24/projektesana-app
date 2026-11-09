// Approval levels (design doc 4.2, work plan "Agent tools"). Every tool the agent can reach has one; a tool without one is
// treated as `never`. The gate runs in the main process on pi's beforeToolCall hook, for the app's tools and Revit's alike.
import type { BeforeToolCallContext, BeforeToolCallResult } from "@earendil-works/pi-agent-core";

export type Level = "read" | "propose" | "annotate" | "run" | "confirm" | "never";

export const LEVEL_LABEL: Record<Level, string> = {
	read: "auto, lasa",
	propose: "auto, kā priekšlikums",
	annotate: "auto, anotē",
	run: "auto, palaiž",
	confirm: "apstiprina lietotājs (pa partijām)",
	never: "nekad",
};

/** Tools whose level is fixed at `never` whatever any table says. */
export const ALWAYS_NEVER = new Set(["delete_element", "send_code_to_revit"]);

export type LevelOf = (tool: string) => Level;

/** Tools whose level depends on what they are asked to do. operate_element also deletes ("Delete") — deletion is never
 *  an agent action, whatever the batch confirmation says. */
export function neverByArgs(tool: string, args: unknown): string | null {
	if (tool === "operate_element") {
		const action = String((args as { data?: { action?: unknown } } | null)?.data?.action ?? "").toLowerCase();
		if (action === "delete") return "operate_element ar darbību Delete nav atļauts: elementus dzēš tikai lietotājs.";
	}
	return null;
}

export function makeLevelOf(...tables: Record<string, Level>[]): LevelOf {
	return (tool) => {
		if (ALWAYS_NEVER.has(tool)) return "never";
		for (const t of tables) if (Object.hasOwn(t, tool)) return t[tool];
		return "never";
	};
}

/** The names a server lists that may be offered to the model: everything except `never` (and unknown, which is never). */
export function offered(listed: readonly string[], levelOf: LevelOf): string[] {
	return listed.filter((n) => levelOf(n) !== "never");
}

export interface ConfirmRequest {
	id: string;
	/** the confirm-level tool calls of this assistant message, in order */
	batch: { tool: string; args: unknown }[];
}

/**
 * Confirm per batch: the first `confirm` tool call of an assistant message asks the user once for all the confirm-level calls in
 * that message; his answer covers the rest of the message. `never` tools are blocked even if a model names one.
 */
export class Gate {
	private answered = new WeakMap<object, boolean>();
	private pending = new WeakMap<object, Promise<boolean>>();
	private n = 0;

	constructor(
		private levelOf: LevelOf,
		private ask: (req: ConfirmRequest) => Promise<boolean>,
	) {}

	before = async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
		const name = ctx.toolCall.name;
		const level = this.levelOf(name);
		if (level === "never") return { block: true, reason: `Rīks ${name} nav atļauts (līmenis: nekad).` };
		const argNever = neverByArgs(name, ctx.args ?? ctx.toolCall.arguments);
		if (argNever) return { block: true, reason: argNever };
		if (level !== "confirm") return undefined;
		const msg = ctx.assistantMessage as object;
		let ok = this.answered.get(msg);
		if (ok === undefined) {
			let p = this.pending.get(msg);
			if (!p) {
				const batch = ctx.assistantMessage.content
					.filter((c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall" && this.levelOf(c.name) === "confirm")
					.map((c) => ({ tool: c.name, args: c.arguments }));
				p = this.ask({ id: `c${++this.n}`, batch });
				this.pending.set(msg, p);
			}
			ok = await p;
			this.answered.set(msg, ok);
		}
		return ok ? undefined : { block: true, reason: "Lietotājs šo partiju noraidīja. Neatkārto to; jautā, ko darīt citādi." };
	};
}
