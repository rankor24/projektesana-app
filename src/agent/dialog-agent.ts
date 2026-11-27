// The computer-use helper for Revit's popup windows (the fallback behind the add-in's own handler, docs/revit-dialogs-plan.md).
// A model of the run's own provider gets the popup (its text, its buttons, a picture of it) and a handful of tools that see and act on Revit's popup windows and nothing else:
//   screen_look, screen_press, screen_click, screen_key, screen_wait, ask_user.
// The model chooses; the code decides whether the action may be done (revit/dialog-policy.ts `decide`): data-losing answers, anything about a model file that is not the
// project's working copy, sign-in, licence, crash and typing are refused, and the user is told instead. Every action is logged and shown in the chat.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "@earendil-works/pi-ai";
import { decide, assess, buttonAt, type DialogLogLine, type DialogWindow, type PolicyContext, type Rect } from "../revit/dialog-policy.js";
import { around, type RevitScreen } from "../revit/screen.js";
import type { RunEvent } from "../shared/types.js";
import type { PiRunOptions } from "./pi/index.js";

export interface DialogAgentDeps {
	screen: Pick<RevitScreen, "popups" | "shot" | "cursor" | "click" | "key" | "press">;
	ctx: PolicyContext;
	/** writes the log line and tells the chat */
	log: (l: Omit<DialogLogLine, "at" | "source">) => void;
	run: (o: PiRunOptions) => Promise<void>;
	/** the run's model choice: the helper asks the same model */
	base: Pick<PiRunOptions, "runtime" | "provider" | "modelId" | "model" | "effort">;
	signal: AbortSignal;
	/** does the model take pictures? Without, the helper works from the text and the button list */
	seesImages: boolean;
	onEvent?: (e: RunEvent) => void;
	maxTurns?: number;
	sleep?: (ms: number) => Promise<void>;
}

export interface DialogOutcome {
	/** no popup of Revit is open any more */
	cleared: boolean;
	/** a popup was left to the user */
	person: boolean;
	actions: number;
	report: string;
}

export const DIALOG_SYSTEM = `You are a helper in an architect's design workstation. Revit has shown a popup window and waits for an answer; the agent's Revit calls are stuck until it is answered. You can see and act on Revit's popup windows only (screen_look, screen_press, screen_click, screen_key, screen_wait, ask_user); nothing else on the screen, and no other program.

Rules (the program also enforces them and refuses the rest):
1. screen_look first: read the popup's text and its buttons.
2. Answer the way that loses nothing: Cancel, Close or No. Never press Delete, Remove, Overwrite, Replace, Save, Don't save, Synchronize, Relinquish, Detach or Discard, and do not tick or untick anything.
3. A popup that names a model file that is not this project's working copy (an original model, any B: path), asks for a sign-in, a licence, a password or any typing, or reports a crash or recovery: do not answer it. Call ask_user with the reason and stop.
4. A plain information or warning popup (OK, Close, Continue, Retry): answer it with the button that lets work go on. If it is a question you do not understand, Cancel or Escape.
   Revit's own warnings window ("0 Errors, N Warnings", buttons OK, Cancel, Show, More Info, Expand) is never pressed: call ask_user and stop. Pressed from outside while a change was running, it crashed Revit.
7. Never press the same button twice. If a press reports an error, screen_look: the popup may already be gone or changed. A second press on a closing popup can crash Revit.
5. Prefer screen_press with the button's name. Use screen_click with coordinates only when the button cannot be pressed by name. Escape is screen_key. Never press Enter or type.
6. After every action screen_look again. Stop when no popup is open. Do not repeat an action that did not work: ask_user.
Finish with one or two sentences: what the popup said, what you pressed, whether it is gone. Write the report in English.`;

const lookSchema = Type.Object({});
const pressSchema = Type.Object({ button: Type.String({ description: "The button's text exactly as screen_look lists it." }) });
const clickSchema = Type.Object({ x: Type.Number({ description: "Screen x (pixels) as in screen_look." }), y: Type.Number({ description: "Screen y (pixels)." }) });
const keySchema = Type.Object({ key: Type.String({ description: "Only Escape." }) });
const waitSchema = Type.Object({ seconds: Type.Number({ minimum: 1, maximum: 10 }) });
const askSchema = Type.Object({ reason: Type.String({ description: "Why the user has to act, in one sentence." }) });

const centre = (r: Rect | null) => (r ? `(${Math.round((r.left + r.right) / 2)}, ${Math.round((r.top + r.bottom) / 2)})` : "(no position)");

/** What the model reads about the popups: titles, texts, buttons with their centres. */
export function describe(popups: DialogWindow[], ctx: PolicyContext): string {
	if (!popups.length) return "No popup of Revit is open now.";
	return popups
		.map((d, i) => {
			const a = assess(d, ctx);
			return [
				`Popup ${i + 1}: «${d.title}» (Revit pid ${d.pid}), at (${d.rect.left}, ${d.rect.top}) to (${d.rect.right}, ${d.rect.bottom})`,
				d.text ? `Text: ${d.text.replace(/\r?\n/g, " | ")}` : "Text: (none read)",
				`Buttons: ${d.buttons.length ? d.buttons.map((b) => `«${b.name}» ${centre(b.rect)}`).join(", ") : "(none read: use screen_key Escape or ask_user)"}`,
				d.checkboxes.length ? `Check boxes (never changed): ${d.checkboxes.map((c) => `«${c}»`).join(", ")}` : "",
				a.person ? `The program says: this one is the user's: ${a.why}.` : `Allowed answers: ${a.allowed.join(", ")}. ${a.why}.`,
			]
				.filter(Boolean)
				.join("\n");
		})
		.join("\n\n");
}

const union = (ps: DialogWindow[]): Rect => ({ left: Math.min(...ps.map((p) => p.rect.left)), top: Math.min(...ps.map((p) => p.rect.top)), right: Math.max(...ps.map((p) => p.rect.right)), bottom: Math.max(...ps.map((p) => p.rect.bottom)) });

export function dialogTools(deps: DialogAgentDeps, state: { actions: number; person: boolean; cleared: boolean; lastPoint: { x: number; y: number } | null }): AgentTool<any>[] {
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], details: {}, isError });

	/** the popups now, and a note on what changed since the action */
	const afterAction = async (title: string): Promise<string> => {
		await sleep(1200);
		const now = await deps.screen.popups();
		state.cleared = now.length === 0;
		if (!now.length) {
			deps.log({ action: "gone", title });
			return "Done. No popup of Revit is open now.";
		}
		return `Done. Still open:\n${describe(now, deps.ctx)}`;
	};

	/** the user using the mouse themselves: our last click left it at lastPoint; anywhere else means a hand on it */
	const mouseFree = async (): Promise<string | null> => {
		if (!state.lastPoint) return null;
		const c = await deps.screen.cursor();
		return Math.abs(c.x - state.lastPoint.x) > 12 || Math.abs(c.y - state.lastPoint.y) > 12 ? "The user is moving the mouse: not clicking now. Wait with screen_wait, then look again." : null;
	};

	const find = async (): Promise<DialogWindow | null> => (await deps.screen.popups())[0] ?? null;

	const look: AgentTool<typeof lookSchema> = {
		name: "screen_look",
		label: "Revit logs",
		description: "Look at Revit's open popup windows: their text, their buttons with screen positions, and a picture of them. Only Revit's popups are shown.",
		parameters: lookSchema,
		execute: async () => {
			const ps = await deps.screen.popups();
			state.cleared = ps.length === 0;
			const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [{ type: "text", text: describe(ps, deps.ctx) }];
			if (ps.length && deps.seesImages) {
				try {
					const shot = await deps.screen.shot(around(union(ps)));
					content.push({ type: "image", data: shot.png, mimeType: "image/png" });
				} catch (e) {
					content.push({ type: "text", text: `(no picture: ${(e as Error).message})` });
				}
			}
			return { content, details: {} };
		},
	};

	const press: AgentTool<typeof pressSchema> = {
		name: "screen_press",
		label: "Revit logs: poga",
		description: "Press a button of the popup by its text.",
		parameters: pressSchema,
		execute: async (_id, p: Static<typeof pressSchema>) => {
			const d = await find();
			if (!d) return text("No popup of Revit is open now.");
			const dec = decide(d, { type: "press", name: p.button }, deps.ctx);
			if (!dec.ok) return refuse(d, dec.reason, dec.person, p.button);
			const busy = await mouseFree();
			if (busy) return text(busy, true);
			try {
				await deps.screen.press(d.hwnd, dec.button);
			} catch (e) {
				// No click "instead": a press that reports an error may still have reached the button (Invoke waits while Revit works on the answer, and the
				// script can give up first). A second press on that closing popup is what crashed Revit on 2026-11-27 (two presses 52 ms apart, journal.0161).
				state.actions++;
				deps.log({ action: "failed", title: d.title, button: dec.button, reason: `the press reported an error and may still have happened: ${(e as Error).message}`, pid: d.pid });
				return text(`The press reported an error, but it may still have reached the button. Do not press again: screen_look, and if the popup is still there call ask_user.\n${await afterAction(d.title)}`, true);
			}
			state.actions++;
			deps.log({ action: "press", title: d.title, text: d.text, button: dec.button, kind: dec.kind, pid: d.pid });
			return text(await afterAction(d.title));
		},
	};

	const click: AgentTool<typeof clickSchema> = {
		name: "screen_click",
		label: "Revit logs: klikšķis",
		description: "Click a point of the popup (screen pixels). Only buttons of the popup may be clicked.",
		parameters: clickSchema,
		execute: async (_id, p: Static<typeof clickSchema>) => {
			const d = await find();
			if (!d) return text("No popup of Revit is open now.");
			const dec = decide(d, { type: "click", x: p.x, y: p.y }, deps.ctx);
			if (!dec.ok) return refuse(d, dec.reason, dec.person, `(${p.x}, ${p.y})`);
			const busy = await mouseFree();
			if (busy) return text(busy, true);
			try {
				await deps.screen.click(d.hwnd, p.x, p.y);
				state.lastPoint = { x: Math.round(p.x), y: Math.round(p.y) };
			} catch (e) {
				return failed(d, (e as Error).message);
			}
			state.actions++;
			const b = buttonAt(d, p.x, p.y);
			deps.log({ action: "click", title: d.title, text: d.text, button: b?.name ?? dec.button, kind: dec.kind, pid: d.pid });
			return text(await afterAction(d.title));
		},
	};

	const key: AgentTool<typeof keySchema> = {
		name: "screen_key",
		label: "Revit logs: Escape",
		description: "Press Escape in the popup (its own Cancel). No other key is allowed.",
		parameters: keySchema,
		execute: async (_id, p: Static<typeof keySchema>) => {
			const d = await find();
			if (!d) return text("No popup of Revit is open now.");
			const dec = decide(d, { type: "key", key: p.key }, deps.ctx);
			if (!dec.ok) return refuse(d, dec.reason, dec.person, p.key);
			try {
				await deps.screen.key(d.hwnd, "Escape");
			} catch (e) {
				return failed(d, (e as Error).message);
			}
			state.actions++;
			deps.log({ action: "key", title: d.title, text: d.text, button: "Escape", kind: "cancel", pid: d.pid });
			return text(await afterAction(d.title));
		},
	};

	const wait: AgentTool<typeof waitSchema> = {
		name: "screen_wait",
		label: "Revit logs: gaida",
		description: "Wait a few seconds, then say what Revit's popups are now.",
		parameters: waitSchema,
		execute: async (_id, p: Static<typeof waitSchema>) => {
			await sleep(Math.max(1, Math.min(10, p.seconds)) * 1000);
			const ps = await deps.screen.popups();
			state.cleared = ps.length === 0;
			return text(describe(ps, deps.ctx));
		},
	};

	const ask: AgentTool<typeof askSchema> = {
		name: "ask_user",
		label: "Revit logs: lietotājam",
		description: "Leave the popup to the user: the app tells them in the chat. Then stop.",
		parameters: askSchema,
		execute: async (_id, p: Static<typeof askSchema>) => {
			const d = await find();
			state.person = true;
			deps.log({ action: "person", title: d?.title, text: d?.text, reason: p.reason, pid: d?.pid });
			return text("The user has been told. Stop now and report.");
		},
	};

	function refuse(d: DialogWindow, reason: string, person: boolean, what: string) {
		if (person) state.person = true;
		deps.log({ action: person ? "person" : "refused", title: d.title, text: d.text, button: what, reason, pid: d.pid });
		return text(`Refused by the program: ${reason}. ${person ? "Call ask_user and stop." : "Choose Cancel, Close or No, or call ask_user."}`, true);
	}

	function failed(d: DialogWindow, reason: string) {
		deps.log({ action: "failed", title: d.title, reason, pid: d.pid });
		return text(`The action failed: ${reason}`, true);
	}

	return [look, press, click, key, wait, ask];
}

/** Runs the helper on the popups that are open now. Resolves when it has finished (cleared, left to the user, or out of turns). */
export async function runDialogAgent(deps: DialogAgentDeps, popups: DialogWindow[]): Promise<DialogOutcome> {
	const state = { actions: 0, person: false, cleared: false, lastPoint: null as { x: number; y: number } | null };
	const tools = dialogTools(deps, state);
	let report = "";
	let error: string | null = null;
	let images: PiRunOptions["images"];
	if (deps.seesImages && popups.length) {
		try {
			const shot = await deps.screen.shot(around(union(popups)));
			images = [{ type: "image", data: shot.png, mimeType: "image/png" }];
		} catch {
			images = undefined;
		}
	}
	await deps.run({
		...deps.base,
		prompt: `Revit has been showing this for a while and the agent's Revit calls are stuck:\n\n${describe(popups, deps.ctx)}\n\nDeal with it by the rules.`,
		...(images ? { images } : {}),
		systemPrompt: DIALOG_SYSTEM,
		mcp: {},
		signal: deps.signal,
		maxTurns: deps.maxTurns ?? 14,
		history: [],
		beforeToolCall: async () => undefined,
		extraTools: tools,
		onEvent: (e) => {
			if (e.type === "done") report = e.text;
			else if (e.type === "error") error = e.message;
			deps.onEvent?.(e);
		},
	});
	const left = state.cleared ? [] : await deps.screen.popups().catch(() => []);
	return { cleared: state.cleared || left.length === 0, person: state.person, actions: state.actions, report: report || (error ? `(helper failed: ${error})` : "(no report)") };
}
