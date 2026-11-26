// Watches Revit for a popup that stays open while an agent holds Revit, and gets it answered or handed to the user (docs/revit-dialogs-plan.md).
//
// Order of help: the add-in's own handler answers what Revit's API events show, at once (its log lines are in the same revit-dialogs.jsonl). This watcher is independent of it: it looks
// at Revit's windows every few seconds, and a popup that is still open after `graceMs` (the add-in did not or could not answer it, the user did not either) goes to the computer-use
// helper (dialog-agent.ts). What the helper may not answer, or could not clear, is said to the user in the chat, once. One watcher per run that holds Revit.
import { dirname, join } from "node:path";
import { appendDialogLog, chatLine, dialogLogFile, LogTail, type DialogLogLine, type DialogWindow, type PolicyContext } from "../revit/dialog-policy.js";
import { powershellRun, RevitScreen } from "../revit/screen.js";
import type { RunEvent } from "../shared/types.js";
import { lookupAgentModel } from "./agent-model.js";
import { runDialogAgent, type DialogAgentDeps } from "./dialog-agent.js";
import type { LaneDeps } from "./subagents.js";

export interface WatchDeps {
	screen: Pick<RevitScreen, "popups">;
	/** the helper, started on the popups that waited too long; resolves when it is done */
	help: (popups: DialogWindow[]) => Promise<{ cleared: boolean; person: boolean; report: string }>;
	log: (l: Omit<DialogLogLine, "at" | "source">) => void;
	/** false = never touch the screen, only tell the user */
	act: () => boolean;
	/** new lines the add-in wrote in the shared log since the last look */
	tail?: () => DialogLogLine[];
	/** one add-in line, to show and, when it matters, to tell the agent */
	onAddin?: (l: DialogLogLine) => void;
	/** is a Revit call of the run going now (or just ended)? A popup the user opened themselves, while no agent call waits for Revit, is not touched or reported. Default: always. */
	active?: () => boolean;
	graceMs?: number;
	/** a popup the helper tried this often and still open goes to the user */
	maxTries?: number;
	now?: () => number;
}

interface Seen {
	since: number;
	tries: number;
	told: boolean;
}

const keyOf = (d: DialogWindow) => `${d.pid}:${d.hwnd}:${d.title}`;

/** One look. Separate from the timer so a test can drive it. */
export class DialogWatch {
	private seen = new Map<string, Seen>();
	private busy = false;

	constructor(private d: WatchDeps) {}

	async tick(): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			for (const l of this.d.tail?.() ?? []) if (l.source === "addin") this.d.onAddin?.(l);
			if (this.d.active && !this.d.active()) {
				this.seen.clear();
				return;
			}
			const now = (this.d.now ?? Date.now)();
			const popups = await this.d.screen.popups();
			const keys = new Set(popups.map(keyOf));
			for (const k of [...this.seen.keys()])
				if (!keys.has(k)) {
					this.seen.delete(k);
				}
			for (const p of popups) {
				if (!this.seen.has(keyOf(p))) {
					this.seen.set(keyOf(p), { since: now, tries: 0, told: false });
					this.d.log({ action: "seen", title: p.title, text: p.text, pid: p.pid });
				}
			}
			const waiting = popups.filter((p) => now - this.seen.get(keyOf(p))!.since >= (this.d.graceMs ?? 8000));
			if (!waiting.length) return;
			const fresh = waiting.filter((p) => !this.seen.get(keyOf(p))!.told);
			if (!fresh.length) return;
			if (!this.d.act()) {
				for (const p of fresh) {
					this.seen.get(keyOf(p))!.told = true;
					this.d.log({ action: "person", title: p.title, text: p.text, reason: "ekrāna palīgs ir izslēgts (Iestatījumi)", pid: p.pid });
				}
				return;
			}
			for (const p of fresh) this.seen.get(keyOf(p))!.tries++;
			const out = await this.d.help(fresh);
			const left = await this.d.screen.popups().catch(() => [] as DialogWindow[]);
			for (const p of fresh) {
				const s = this.seen.get(keyOf(p));
				if (!s) continue;
				const stillOpen = left.some((l) => keyOf(l) === keyOf(p));
				if (!stillOpen) continue;
				if (out.person) s.told = true; // the helper already said it
				else if (s.tries >= (this.d.maxTries ?? 2)) {
					s.told = true;
					this.d.log({ action: "person", title: p.title, text: p.text, reason: `palīgs to neatrisināja (${out.report.slice(0, 200)})`, pid: p.pid });
				} else s.told = false;
			}
		} catch (e) {
			// no desktop (screen locked, remote session closed) or no helper script: say it once, keep watching
			if (!this.seen.has("error")) {
				this.seen.set("error", { since: Date.now(), tries: 0, told: true });
				this.d.log({ action: "failed", reason: (e as Error).message });
			}
		} finally {
			this.busy = false;
		}
	}
}

export interface StartWatch {
	appDir: string;
	/** the folder with the app's resources (revit-screen.ps1 lies there) */
	resourcesDir: string;
	run: string;
	/** the project's working copy, or anything in the app's own folders */
	own: (path: string) => boolean;
	laneDeps: Pick<LaneDeps, "run" | "base">;
	emit: (e: RunEvent) => void;
	signal: AbortSignal;
	/** Iestatījumi: may the helper use the screen? (default yes) */
	act: () => boolean;
	/** is a Revit call of this run going now (or just ended)? */
	active: () => boolean;
	/** puts a message into the running conversation (the agent reads it after its current step); absent = the engine cannot */
	tell?: (text: string) => void;
	maxTurns?: number;
	intervalMs?: number;
	/** tests: the screen, the script runner */
	screen?: Pick<RevitScreen, "popups" | "shot" | "cursor" | "click" | "key" | "press">;
}

/** Starts the watch for one run; returns the function that stops it. Does nothing off Windows. */
export function startRevitDialogWatch(o: StartWatch): () => void {
	if (!o.screen && process.platform !== "win32") return () => undefined;
	const screen = o.screen ?? new RevitScreen(powershellRun(join(o.resourcesDir, "revit-screen.ps1")));
	const file = dialogLogFile(o.appDir);
	const log: WatchDeps["log"] = (l) => {
		const line: DialogLogLine = { at: new Date().toISOString(), source: "screen", run: o.run, ...l };
		appendDialogLog(file, line);
		o.emit({ type: "text", text: `\n[lietotne] ${chatLine(line)}\n` });
	};
	const ctx: PolicyContext = { own: o.own };
	let sees = false;
	try {
		const m = lookupAgentModel(o.laneDeps.base.runtime, o.laneDeps.base.provider ?? "", o.laneDeps.base.modelId);
		sees = m.input.includes("image");
	} catch {
		sees = false;
	}
	const help: WatchDeps["help"] = async (popups) => {
		const agent: DialogAgentDeps = { screen, ctx, log, run: o.laneDeps.run, base: o.laneDeps.base, signal: o.signal, seesImages: sees, maxTurns: o.maxTurns, onEvent: (e) => (e.type === "usage" ? o.emit(e) : undefined) };
		const out = await runDialogAgent(agent, popups).catch((e) => ({ cleared: false, person: false, actions: 0, report: `(${(e as Error).message})` }));
		const titles = popups.map((p) => `«${p.title}»`).join(", ");
		// the agent's call may have been cancelled by the answer: it must not assume the batch worked
		if (out.actions > 0) o.tell?.(`[lietotne] Revit rādīja logu ${titles}, un lietotne to atbildēja uz ekrāna (${out.report.slice(0, 300)}). Revit izsaukums, kas to gaidīja, varēja tikt atcelts: pirms turpini, pārbaudi modeļa stāvokli, nepieņem, ka partija izdevās.`);
		else if (out.person) o.tell?.(`[lietotne] Revit rāda logu ${titles}, ko lietotnei nevajag atbildēt (pieteikšanās, licence, oriģināla modelis vai kas nezināms). Lietotājs ir informēts. Negaidi to ar jauniem izsaukumiem; pasaki lietotājam, ka Revit gaida viņu.`);
		return out;
	};
	const tail = new LogTail(file);
	const onAddin = (l: DialogLogLine) => {
		if (l.action === "seen" || l.action === "installed") return;
		o.emit({ type: "text", text: `\n[lietotne] ${chatLine(l)}\n` });
		// a rolled-back transaction means the change did not happen, and the call that made it may have reported success
		if (l.action === "rollback") o.tell?.(`[lietotne] Revit atcēla darbību (kļūda, ko nevar ignorēt): ${(l.text ?? "").slice(0, 300)}. Izmaiņa NENOTIKA. Pārbaudi modeļa stāvokli un izlabo cēloni; neatkārto to pašu partiju neizmainītu.`);
	};
	const watch = new DialogWatch({ screen, help, log, act: o.act, active: o.active, tail: () => tail.read(), onAddin });
	const timer = setInterval(() => void watch.tick(), o.intervalMs ?? 3000);
	timer.unref?.();
	const stop = () => clearInterval(timer);
	o.signal.addEventListener("abort", stop, { once: true });
	return stop;
}

/** Is `p` the project's working copy or inside the app's own folder? (the watcher's `own`) */
export function ownPathOf(appDir: string, workCopy: (p: string) => boolean): (p: string) => boolean {
	const root = appDir.replace(/[\\/]+$/, "").toLowerCase();
	return (p) => workCopy(p) || p.toLowerCase().startsWith(root) || dirname(p).toLowerCase().startsWith(root);
}
