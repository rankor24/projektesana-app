// What may be done with a popup window of Revit, and what is written down about it. Pure: no window, no file is touched here except the log append.
//
// The rules (the user's, 2026-11-26): an answer that loses data is Cancel; nothing that touches an original model (B:, any model file that is not the project's working
// copy or in the app's own folders) is answered by the app; what the app does not know it leaves to the user. They hold for both ways of answering: the add-in's
// own handler (Revit API events, in the add-in's dialogPolicy.json) and the screen helper (dialog-agent.ts), which asks `decide` before every click or key.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname } from "node:path";

export interface Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface DialogButton {
	name: string;
	rect: Rect | null;
	id?: string | null;
}

/** One popup of a Revit process as the screen helper reads it (resources/revit-screen.ps1 `windows`). */
export interface DialogWindow {
	hwnd: number;
	pid: number;
	title: string;
	className: string;
	rect: Rect;
	text: string;
	buttons: DialogButton[];
	checkboxes: string[];
	/** how many text boxes and drop-down lists the popup has (a field to fill in = the user's) */
	edits: number;
}

export type ButtonKind = "cancel" | "close" | "ok" | "no" | "yes" | "retry" | "ignore" | "continue" | "destructive" | "save" | "unknown";

const clean = (s: string) =>
	s
		.toLowerCase()
		.replace(/&/g, "")
		.replace(/[….]+$/g, "")
		.replace(/\s+/g, " ")
		.trim();

// Words in the two languages Revit runs in here (English, Latvian). A button text is matched whole for the short ones and by containing for the long ones.
const DESTRUCTIVE = /delete|remove|overwrite|replace|discard|don'?t save|do not save|without sav|detach|synchroni[sz]e|relinquish|reload latest|dzēst|noņemt|pārrakst|aizstāt|atmest|nesaglab|bez saglab|atvienot|sinhroniz/;
const SAVE = /^save|saglab/;

/** What a button does, from its text. Destructive wins over everything ("Don't save" contains "save"). */
export function buttonKind(name: string): ButtonKind {
	const n = clean(name);
	if (!n) return "unknown";
	if (DESTRUCTIVE.test(n)) return "destructive";
	if (SAVE.test(n)) return "save";
	if (n === "cancel" || n === "atcelt") return "cancel";
	if (n === "close" || n === "aizvērt" || n === "×" || n === "x") return "close";
	if (n === "ok" || n === "labi" || n === "okay") return "ok";
	if (n === "no" || n === "nē") return "no";
	if (n === "yes" || n === "jā") return "yes";
	if (/^(retry|try again|atkārtot|mēģināt vēlreiz)/.test(n)) return "retry";
	if (/^(ignore|ignorēt)/.test(n)) return "ignore";
	if (/^(continue|proceed|turpināt)/.test(n)) return "continue";
	return "unknown";
}

// A window that must be dealt with by a person: signing in, the licence, a crash, a password.
const PERSON = /licen[cs]|sign.?in|autodesk id|activat|subscription|account|password|parole|pieteik|aktiviz|crash|not responding|nereaģē|recovery|atkopšan|unexpected error|serious.?error|encountered a problem|journal|žurnāl/i;
// A question whose "yes" loses something.
const DATA_LOSS = /delet|remov|overwrit|replac|discard|\blose\b|\blost\b|permanent|cannot be undone|will be removed|dzēs|noņem|pārrakst|aizstāj|zaudē|neatgriezeniski|nevar atsaukt/i;
// "Save changes?": the only safe answer is Cancel.
const SAVE_QUESTION = /save (the )?changes|unsaved|saglabāt izmaiņas|nesaglabāt|izmaiņas netika saglabātas|before (closing|you close)|pirms aizvēršanas|sync(hroni[sz]e)? with central|sinhroniz/i;
const MODEL_PATH = /(?:[A-Za-z]:\\|\\\\)[^\r\n"<>|*?]*?\.(?:rvt|rfa|rte|rft|ifc|nwc|nwd|dwg|dxf|rvl)\b/gi;
const NETWORK_PATH = /(?:^|[^A-Za-z])B:\\|\\\\[A-Za-z0-9_.-]+\\/i;

// Revit's own warnings window ("Warning -- 0 Errors, 3 Warnings", OK / Cancel / Show / More Info / Expand >>). It is never pressed from outside: on 2026-11-27 the helper
// pressed it while the agent's API transaction (create_room) was still open, it was pressed twice within 52 ms, and Revit stopped with "Revit encountered a serious
// error" (journal: "Acquired transaction group has a proxy"). The agent's own warnings are deleted by the add-in before this window can show (FailuresProcessing,
// known by the transaction name "MCP: ..."); one that shows anyway is the user's own work or something the add-in missed, and is the user's.
const WARNINGS_COUNT = /\b(\d+)\s+errors?\s*,\s*(\d+)\s+warnings?\b/i;

/** Revit's warnings window with warnings only (no errors), from its counts line or, when that was not read, from its own buttons (Show, Expand >>) with no error count. */
export function revitWarningsOnly(d: Pick<DialogWindow, "text" | "buttons">): boolean {
	const m = WARNINGS_COUNT.exec(d.text);
	if (m) return Number(m[1]) === 0 && Number(m[2]) > 0;
	const names = d.buttons.map((b) => clean(b.name));
	return names.includes("show") && names.some((n) => n.startsWith("expand")) && names.includes("ok") && !/\berrors?\b/i.test(d.text);
}

/** A window of Revit's that is no popup to answer: the hidden "<guid>Monitor" helper window that sits under a modal popup. */
export function revitInternal(d: Pick<DialogWindow, "title">): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}monitor$/i.test(d.title.trim());
}

/** The model-file paths a popup names (title and text). */
export function pathsIn(d: Pick<DialogWindow, "title" | "text">): string[] {
	return [...`${d.title}\n${d.text}`.matchAll(MODEL_PATH)].map((m) => m[0]);
}

export interface PolicyContext {
	/** is this path the project's working copy or inside the app's own folders (agent-work, the app's data)? Anything else is an original. */
	own: (path: string) => boolean;
}

export interface Assessment {
	/** nothing may be clicked: the user has to act */
	person: boolean;
	/** names a model file that is not ours, or a network (B:) path */
	outside: boolean;
	dataLoss: boolean;
	saveQuestion: boolean;
	/** Revit's warnings window (no errors): never pressed from outside, it is the user's */
	warningsOnly: boolean;
	/** the button kinds that may be answered with; empty = none */
	allowed: ButtonKind[];
	why: string;
}

export function assess(d: DialogWindow, ctx: PolicyContext): Assessment {
	const all = `${d.title}\n${d.text}`;
	const warningsOnly = revitWarningsOnly(d);
	const person = PERSON.test(all) || d.edits > 0 || warningsOnly;
	const paths = pathsIn(d);
	const outside = paths.some((p) => !ctx.own(p)) || NETWORK_PATH.test(all);
	const dataLoss = DATA_LOSS.test(all);
	const saveQuestion = SAVE_QUESTION.test(all);
	let allowed: ButtonKind[];
	let why: string;
	if (person) {
		allowed = [];
		why = warningsOnly
			? "Revit's warnings window: the app never presses it (pressed from outside during an agent's change it crashed Revit); the add-in clears the agent's own warnings before they show, so this one is yours: OK keeps the change, Cancel undoes it"
			: d.edits > 0
				? "the popup asks for something to be typed (name, password): that is the user's"
				: "licence, sign-in, crash or recovery window: that is the user's";
	} else if (outside) {
		allowed = ["cancel", "close"];
		why = "it names a model file that is not the project's working copy (an original): only Cancel or Close";
	} else if (saveQuestion) {
		allowed = ["cancel", "close"];
		why = "a question about saving or synchronising: only Cancel or Close (nothing is saved or discarded by the app here)";
	} else if (dataLoss) {
		allowed = ["cancel", "close", "no"];
		why = "the popup can lose data: only Cancel, Close or No";
	} else {
		allowed = ["cancel", "close", "ok", "no", "yes", "retry", "ignore", "continue"];
		why = "a plain popup: Cancel, Close, OK, Yes, No, Retry, Ignore, Continue";
	}
	return { person, outside, dataLoss, saveQuestion, warningsOnly, allowed, why };
}

/** The popup's title-bar close box, which no automation tree shows: the top band at the right edge. */
export function titleBarClose(d: DialogWindow, x: number, y: number): boolean {
	return y >= d.rect.top && y <= d.rect.top + 34 && x >= d.rect.right - 56 && x <= d.rect.right;
}

/** The button under a screen point, or null. */
export function buttonAt(d: DialogWindow, x: number, y: number): DialogButton | null {
	for (const b of d.buttons) if (b.rect && x >= b.rect.left && x <= b.rect.right && y >= b.rect.top && y <= b.rect.bottom) return b;
	return null;
}

export const inside = (r: Rect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export type Action = { type: "click"; x: number; y: number } | { type: "press"; name: string } | { type: "key"; key: string };
export type Decision = { ok: true; button: string; kind: ButtonKind } | { ok: false; reason: string; person: boolean };

/** May this action be done on this popup? One answer for a click at a point, a button pressed by name, and a key. */
export function decide(d: DialogWindow, a: Action, ctx: PolicyContext): Decision {
	const as = assess(d, ctx);
	if (as.person) return { ok: false, reason: as.why, person: true };
	if (a.type === "key") {
		// Escape is the popup's own Cancel; no other key (Enter would press whatever button is the default one, a letter would type into a field)
		if (clean(a.key) !== "escape" && clean(a.key) !== "esc") return { ok: false, reason: "only the Escape key may be pressed", person: false };
		return { ok: true, button: "Escape", kind: "cancel" };
	}
	let button: DialogButton | null = null;
	if (a.type === "press") button = d.buttons.find((b) => clean(b.name) === clean(a.name)) ?? null;
	else {
		if (!inside(d.rect, a.x, a.y)) return { ok: false, reason: "the point is outside the popup: only the popup itself may be clicked", person: false };
		button = buttonAt(d, a.x, a.y);
		if (!button && titleBarClose(d, a.x, a.y)) button = { name: "×", rect: null };
	}
	if (!button) return { ok: false, reason: a.type === "press" ? `the popup has no button «${a.name}»` : "that point is not on a button (check boxes, fields and the rest of the popup are not clicked)", person: false };
	const kind = buttonKind(button.name);
	if (!as.allowed.includes(kind)) return { ok: false, reason: `«${button.name}» (${kind}) is refused here: ${as.why}`, person: false };
	return { ok: true, button: button.name, kind };
}

// ---- the log -----------------------------------------------------------------------------------------------------------------

export interface DialogLogLine {
	at: string;
	/** where the answer came from: the add-in's handler, or the screen helper */
	source: "addin" | "screen";
	pid?: number;
	/** seen = a popup noticed; click, press, key = done by the screen helper; answered = the add-in answered it; warnings = the add-in dismissed a transaction's warnings; rollback = the add-in
	 *  rolled a failed transaction back (the change did not happen); refused = the policy said no; person = left to the user; gone = it closed on its own; installed = the add-in's handlers started */
	action: "seen" | "click" | "press" | "key" | "answered" | "warnings" | "rollback" | "refused" | "person" | "gone" | "failed" | "installed";
	title?: string;
	text?: string;
	button?: string;
	kind?: ButtonKind;
	reason?: string;
	/** the run that was working when it happened */
	run?: string;
	/** the Revit call that was running (the add-in's lines) */
	call?: string;
}

/** One JSON line per event, in the app's own folder (never an office one). A failed write never stops the work. */
export function appendDialogLog(file: string, line: DialogLogLine): void {
	try {
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(file, `${JSON.stringify({ ...line, text: line.text?.slice(0, 600) })}\n`, "utf8");
	} catch {
		// the log is a record, not a gate
	}
}

export const dialogLogFile = (appDir: string) => `${appDir.replace(/[\\/]+$/, "")}${appDir.includes("\\") ? "\\" : "/"}revit-dialogs.jsonl`;

/** The chat line for one logged event, in the app's own language of messages (Latvian, as the other «[lietotne]» lines). */
export function chatLine(l: DialogLogLine): string {
	const what = l.title ? `«${l.title}»` : "logs";
	switch (l.action) {
		case "seen":
			return `Revit rāda logu ${what}${l.text ? `: ${l.text.replace(/\s+/g, " ").slice(0, 160)}` : ""}.`;
		case "click":
		case "press":
		case "key":
			return `Revit logs ${what}: ${l.source === "addin" ? "spraudnis" : "uz ekrāna"} nospiests «${l.button ?? "?"}».`;
		case "answered":
			return `Revit logs ${what}: spraudnis atbildēja «${l.button ?? "?"}».`;
		case "warnings":
			return `Revit brīdinājumi noņemti (elementi paliek)${l.text ? `: ${l.text.replace(/\s+/g, " ").slice(0, 160)}` : ""}.`;
		case "rollback":
			return `Revit darbība atcelta (Cancel), izmaiņa NEnotika${l.text ? `: ${l.text.replace(/\s+/g, " ").slice(0, 200)}` : ""}.`;
		case "refused":
			return `Revit logs ${what}: darbība atteikta (${l.reason ?? ""}).`;
		case "person":
			return `Revit logs ${what} gaida tevi: ${l.reason ?? "lietotnei to nevajag atbildēt"}. Aizver to pats; darbs turpināsies.`;
		case "gone":
			return `Revit logs ${what} ir aizvērts.`;
		default:
			return `Revit logs ${what}: neizdevās (${l.reason ?? ""}).`;
	}
}

/** Reads what has been appended to the log since it was created or last read (the add-in writes its lines there from Revit's process). */
export class LogTail {
	private pos: number;
	private rest = "";

	constructor(private file: string) {
		this.pos = existsSync(file) ? statSync(file).size : 0;
	}

	read(): DialogLogLine[] {
		try {
			if (!existsSync(this.file)) return [];
			const size = statSync(this.file).size;
			if (size < this.pos) {
				this.pos = 0;
				this.rest = "";
			}
			if (size === this.pos) return [];
			const buf = Buffer.alloc(size - this.pos);
			const fd = openSync(this.file, "r");
			try {
				readSync(fd, buf, 0, buf.length, this.pos);
			} finally {
				closeSync(fd);
			}
			this.pos = size;
			const lines = (this.rest + buf.toString("utf8")).split("\n");
			this.rest = lines.pop() ?? "";
			const out: DialogLogLine[] = [];
			for (const l of lines) {
				if (!l.trim()) continue;
				try {
					out.push(JSON.parse(l) as DialogLogLine);
				} catch {
					// a half-written or foreign line
				}
			}
			return out;
		} catch {
			return [];
		}
	}
}
