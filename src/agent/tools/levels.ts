// Approval levels (design doc 4.2, work plan "Agent tools"). Every tool the agent can reach has one; a tool without one is
// treated as `never`. The gate runs in the main process on pi's beforeToolCall hook, for the app's tools and Revit's alike.
import { AUTO_STILL_ASKS_CALLS, AUTO_STILL_ASKS_TOOLS } from "../../shared/auto-mode.js";
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
export const ALWAYS_NEVER = new Set(["send_code_to_revit"]);

export type LevelOf = (tool: string) => Level;

/** `confirm` tools that only change the app's own project data (never an office folder, never a model file): the draft delivery and its staging folder in the app's data folder, and the
 *  room table the app read from a document (it can be read again from the document). The user's ruling of 2026-11-26: an agent works on its own where it touches only its own copy,
 *  so these need no click. They stay `confirm` in the tables (a delegate lane still never gets them); the gate lifts the click (thread-runner.ts). */
export const OWN_DATA_TOOLS: ReadonlySet<string> = new Set(["start_delivery", "unstage_file", "delete_inventory_rooms"]);

/** The .rvt paths an `open_document` call names, wherever the Revit MCP puts them in its arguments (strings, a few levels of nesting). */
export function rvtPathsOf(args: unknown): string[] {
	const out: string[] = [];
	const walk = (v: unknown, depth: number) => {
		if (typeof v === "string") {
			if (/\.rvt$/i.test(v.trim())) out.push(v.trim());
		} else if (depth < 3 && v && typeof v === "object") for (const x of Object.values(v)) walk(x, depth + 1);
	};
	walk(args, 0);
	return out;
}

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

// The app's own program: starting it (a second copy that stays in the background: seen 2026-11-25, nine processes) or stopping it (the user's own app window).
const APP_PROGRAM = /projektesana[\w-]*\.exe|win-unpacked|projektesana-setup|get-process\s+(?:-name\s+)?projektesana(?![\w-])|(?:stop-process|taskkill|kill)\b[^\n|;]*\bprojektesana(?![\w-])/i;

/** `run_command` may not start or stop the app itself: a copy started by an agent has no window and stays running, and stopping it is the user's call. Returns the refusal, or null. */
export function appShellBlock(command: string): string | null {
	if (!APP_PROGRAM.test(command)) return null;
	return "run_command nedrīkst startēt vai apturēt pašu lietotni (Projektesana.exe): kopija bez loga paliek fonā. Lietotni atver un aizver lietotājs; ja vajag testu, pasaki, kas jāpārbauda.";
}

/** Tools whose level depends on what they are asked to do. (Deleting model elements, delete_element and operate_element with "Delete", was never until 2.14.4, then a click per batch;
 *  since 2.15.0 no click either: a change of the model runs on the project's working copy only, and the gate checks that, never the user. The user's ruling of 2026-11-26.) */
export function neverByArgs(tool: string, args: unknown): string | null {
	if (tool === "run_command") {
		const command = String((args as { command?: unknown } | null)?.command ?? "");
		return revitShellBlock(command) ?? appShellBlock(command);
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

export { AUTO_STILL_ASKS_CALLS, AUTO_STILL_ASKS_TOOLS };

/** True when a batch of confirm calls may be answered by Auto mode: none of its calls is one the user keeps. */
export function autoMayApprove(batch: readonly { tool: string; args: unknown }[]): boolean {
	return batch.every((b) => {
		if (AUTO_STILL_ASKS_TOOLS.has(b.tool)) return false;
		if (b.tool !== "app_confirm") return true;
		const call = (b.args as { call?: unknown } | null | undefined)?.call;
		// an app_confirm whose call name cannot be read is not one Auto mode can judge: it asks
		return typeof call === "string" && !AUTO_STILL_ASKS_CALLS.has(call);
	});
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
	private answered = new WeakMap<object, boolean | string>();
	private pending = new WeakMap<object, Promise<boolean | string>>();
	private n = 0;

	/** `ask` answers true (the user allowed it), false (the user refused, or the run was stopped), or a string: the app itself refused the batch before any click (for example the
	 *  working-copy rule), and the string is the reason the agent is told. A refusal that is not the user's must never reach the agent as "the user refused".
	 *  `free` lifts a confirm call that needs no click for what it was asked to do (project-write.ts: a text note in the agent's work folder).
	 *  `deny` is a refusal no click can lift (project-write.ts `officeBlock`: a write into an office project folder): the call is blocked before the user is asked. */
	constructor(
		private levelOf: LevelOf,
		private ask: (req: ConfirmRequest) => Promise<boolean | string>,
		private free: (tool: string, args: unknown) => boolean = () => false,
		private deny: (tool: string, args: unknown) => string | null = () => null,
	) {}

	before = async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
		const name = ctx.toolCall.name;
		const level = this.levelOf(name);
		if (level === "never") return { block: true, reason: `Rīks ${name} nav atļauts (līmenis: nekad).` };
		const argNever = neverByArgs(name, ctx.args ?? ctx.toolCall.arguments);
		if (argNever) return { block: true, reason: argNever };
		const denied = this.deny(name, ctx.args ?? ctx.toolCall.arguments);
		if (denied) return { block: true, reason: denied };
		if (level !== "confirm") return undefined;
		if (this.free(name, ctx.args ?? ctx.toolCall.arguments)) return undefined;
		const msg = ctx.assistantMessage as object;
		let ok = this.answered.get(msg);
		if (ok === undefined) {
			let p = this.pending.get(msg);
			if (!p) {
				const batch = ctx.assistantMessage.content
					.filter((c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall" && this.levelOf(c.name) === "confirm" && !this.free(c.name, c.arguments) && !neverByArgs(c.name, c.arguments) && !this.deny(c.name, c.arguments))
					.map((c) => ({ tool: c.name, args: c.arguments }));
				p = this.ask({ id: `c${++this.n}`, batch });
				this.pending.set(msg, p);
			}
			ok = await p;
			this.answered.set(msg, ok);
		}
		if (typeof ok === "string") return { block: true, reason: ok };
		return ok ? undefined : { block: true, reason: "Lietotājs šo partiju noraidīja. Neatkārto to; jautā, ko darīt citādi." };
	};
}
