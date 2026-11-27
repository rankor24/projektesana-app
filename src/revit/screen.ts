// The app's way to look at and act on a Revit popup: resources/revit-screen.ps1, started by the app (never by an agent's shell), one call per action. Every call is on
// Revit's own windows only (the script refuses any other window); what is allowed is decided before the call by dialog-policy.ts.
import { execFile } from "node:child_process";
import { revitInternal, type DialogWindow, type Rect } from "./dialog-policy.js";

export type ScreenRun = (args: string[]) => Promise<string>;

/** Starts the script with Windows PowerShell; the answer is the one JSON line it prints. */
export function powershellRun(script: string, timeoutMs = 20_000): ScreenRun {
	return (args) =>
		new Promise((resolve, reject) => {
			execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { timeout: timeoutMs, maxBuffer: 24_000_000, windowsHide: true }, (err, stdout, stderr) => {
				if (err) reject(new Error((stderr || String(err)).toString().trim().split(/\r?\n/)[0] || "revit-screen.ps1 failed"));
				else resolve(stdout.toString().trim());
			});
		});
}

const json = <T>(text: string): T => {
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new Error(`revit-screen.ps1 gave no JSON: ${text.slice(0, 200)}`);
	}
};

const asList = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

interface RawPopup {
	hwnd: number;
	pid: number;
	title?: string;
	className?: string;
	rect: Rect;
	text?: string;
	buttons?: { name: string; id?: string; rect: Rect | null } | { name: string; id?: string; rect: Rect | null }[] | null;
	checkboxes?: string | string[] | null;
	edits?: number;
}

export function normalizePopup(p: RawPopup): DialogWindow {
	return {
		hwnd: p.hwnd,
		pid: p.pid,
		title: p.title ?? "",
		className: p.className ?? "",
		rect: p.rect,
		text: p.text ?? "",
		buttons: asList(p.buttons).map((b) => ({ name: b.name, id: b.id ?? null, rect: b.rect ?? null })),
		checkboxes: asList(p.checkboxes),
		edits: p.edits ?? 0,
	};
}

export class RevitScreen {
	constructor(private run: ScreenRun) {}

	/** The modal popups Revit shows right now (all Revit processes). Empty when there is none or no Revit. */
	async popups(): Promise<DialogWindow[]> {
		const r = json<{ popups?: RawPopup | RawPopup[] | null }>(await this.run(["-Op", "windows"]));
		// an entry with no window id is not a popup (Windows PowerShell writes an empty result as {})
		return asList(r.popups)
			.filter((p) => typeof p.hwnd === "number")
			.map(normalizePopup)
			// Revit's hidden "<guid>Monitor" window under a modal popup is no popup: it closes with the real one
			.filter((p) => !revitInternal(p));
	}

	/** A PNG (base64) of a screen area. */
	async shot(area: Rect): Promise<{ png: string; width: number; height: number }> {
		const width = Math.max(1, Math.round(area.right - area.left));
		const height = Math.max(1, Math.round(area.bottom - area.top));
		const r = json<{ png: string; width: number; height: number }>(await this.run(["-Op", "shot", "-Left", String(Math.round(area.left)), "-Top", String(Math.round(area.top)), "-Width", String(width), "-Height", String(height)]));
		return r;
	}

	async cursor(): Promise<{ x: number; y: number }> {
		return json<{ x: number; y: number }>(await this.run(["-Op", "cursor"]));
	}

	async click(hwnd: number, x: number, y: number, double = false): Promise<void> {
		await this.run(["-Op", "click", "-Hwnd", String(hwnd), "-X", String(Math.round(x)), "-Y", String(Math.round(y)), ...(double ? ["-Double"] : [])]);
	}

	async key(hwnd: number, key: "Escape"): Promise<void> {
		await this.run(["-Op", "key", "-Hwnd", String(hwnd), "-Key", key]);
	}

	async press(hwnd: number, name: string): Promise<void> {
		await this.run(["-Op", "press", "-Hwnd", String(hwnd), "-Name", name]);
	}
}

/** The box around a popup, a little larger (so its shadow and the title bar are in the picture), kept on the screen. */
export function around(r: Rect, margin = 24): Rect {
	return { left: Math.max(0, r.left - margin), top: Math.max(0, r.top - margin), right: r.right + margin, bottom: r.bottom + margin };
}
