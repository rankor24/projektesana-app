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

/** The Revit tools an agent has instead of a shell: the names the refusal below gives the agent (kept next to the rule so they cannot drift apart). */
export const REVIT_INSTEAD = "Revit MCP rīki (get_current_view_info, get_current_view_elements, operate_element, …) un lietotnes rīki revit_list_views, revit_open_view, revit_get_view_settings, revit_set_view_settings, revit_get_schedule, revit_set_schedule_filter, revit_list_models, revit_read_parameters, revit_set_parameter";

// Driving a window from a script: UI Automation, synthetic keys and mouse, window messages, the shell's own window scripting.
const UI_AUTOMATION = /UIAutomationClient|UIAutomationTypes|System\.Windows\.Automation|SendKeys|AppActivate|SetForegroundWindow|keybd_event|mouse_event|\bSendInput\b|\bPostMessage|\bSendMessage|WScript\.Shell|Microsoft\.VisualBasic\.Interaction|SetCursorPos/i;
// Taking hold of a Revit process, or going round the Revit MCP to the add-in (its instance files, journal files).
const REVIT_PROCESS = /revit\.exe|RevitMCP|\.jrn\b|(?=[\s\S]*\brevit\b)(?=[\s\S]*(?:get-process|stop-process|start-process|wait-process|taskkill|tasklist|processname|mainwindow|\.kill\(|get-ciminstance|get-wmiobject|wmic|invoke-item|\bii\s))/i;

/** `run_command` may never drive Revit (the user's rule, 2026-11-24: "never allowed"): no clicking through its windows, no taking hold of its process, no side door round the
 *  Revit MCP. Returns the refusal, or null. UI automation of any window is refused too: the agent has no use for it, and a script that does not name Revit can still click in it. */
export function revitShellBlock(command: string): string | null {
	if (!UI_AUTOMATION.test(command) && !REVIT_PROCESS.test(command)) return null;
	return `run_command nedrīkst vadīt Revit (ne UI automatizācija, ne Revit procesa vadība, ne apiešana ap Revit MCP) — lietotājs to neatļauj nekad. Lieto: ${REVIT_INSTEAD}. Ja vajadzīgā Revit darbībai rīka nav, pasaki lietotājam, kas trūkst, un neizmēģini apeju ar komandrindu.`;
}

/** Tools whose level depends on what they are asked to do. operate_element also deletes ("Delete") — deletion is never
 *  an agent action, whatever the batch confirmation says. */
export function neverByArgs(tool: string, args: unknown): string | null {
	if (tool === "run_command") return revitShellBlock(String((args as { command?: unknown } | null)?.command ?? ""));
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

	/** `free` lifts a confirm call that needs no click for what it was asked to do (project-write.ts: a text note inside the project folder). */
	constructor(
		private levelOf: LevelOf,
		private ask: (req: ConfirmRequest) => Promise<boolean>,
		private free: (tool: string, args: unknown) => boolean = () => false,
	) {}

	before = async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
		const name = ctx.toolCall.name;
		const level = this.levelOf(name);
		if (level === "never") return { block: true, reason: `Rīks ${name} nav atļauts (līmenis: nekad).` };
		const argNever = neverByArgs(name, ctx.args ?? ctx.toolCall.arguments);
		if (argNever) return { block: true, reason: argNever };
		if (level !== "confirm") return undefined;
		if (this.free(name, ctx.args ?? ctx.toolCall.arguments)) return undefined;
		const msg = ctx.assistantMessage as object;
		let ok = this.answered.get(msg);
		if (ok === undefined) {
			let p = this.pending.get(msg);
			if (!p) {
				const batch = ctx.assistantMessage.content
					.filter((c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall" && this.levelOf(c.name) === "confirm" && !this.free(c.name, c.arguments) && !neverByArgs(c.name, c.arguments))
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
