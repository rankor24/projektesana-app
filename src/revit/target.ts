// Which Revit session a call goes to, decided before every call.
//
// The Revit MCP server keeps ONE selection per server process (`let selectedPid`, ConnectionManager.ts) and has no per-call target argument: with several sessions and none selected,
// every tool answers "2 Revit sessions are running. Call select_revit_instance first". The app runs several such processes (the agent's own, its tools server's, its own), new ones for
// every message, so a selection made earlier or elsewhere is never there. Each of them therefore lists the sessions and selects one by the pid listed NOW, right before the call:
//   1. the agent's own select_revit_instance choice, if that session still runs;
//   2. else the only session, when one runs;
//   3. else the one session whose active document is a working copy that counts (the project's);
//   4. else the call is refused, naming the sessions. Nothing is ever sent to a session nobody chose.
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { revitRead, selectSession, type RevitInstance } from "./commands.js";
import type { RevitCaller } from "./client.js";

export interface SessionRules {
	/** the arguments of the agent's last select_revit_instance (pid, or match), if it made one */
	choice?: Record<string, unknown> | null;
	/** is this file a working copy that counts here: of the run's project; for a screen without a project, of any project */
	isWork: (documentPath: string) => boolean;
}

/** Puts a Revit MCP connection on the right session; `r` talks to that connection directly. */
export type SessionPicker = (r: RevitCaller) => Promise<void>;

/** No session can be told apart: the message names the sessions and says what to do. */
export class SessionRefused extends Error {
	override name = "SessionRefused";
}

/** The tools that name or list sessions themselves: nothing is selected before them. */
export const SESSION_TOOLS: ReadonlySet<string> = new Set(["list_revit_instances", "select_revit_instance"]);

const named = (list: readonly RevitInstance[]) => list.map((i) => `pid ${i.pid} (${i.document ?? "nav atvērta modeļa"})`).join(", ");

export function pickSession(rules: () => SessionRules): SessionPicker {
	return async (r) => {
		const { instances } = await revitRead.instances(r);
		// no registry entry (Revit closed, MCP switch off, an old plugin): the server's own answer to the call counts
		if (!instances.length) return;
		const { choice, isWork } = rules();
		if (instances.length > 1 && choice) {
			// a pid that is not listed any more is never sent (a restarted Revit has a new one); `match` is for the server to resolve
			const gone = typeof choice.pid === "number" && !instances.some((i) => i.pid === choice.pid);
			if (!gone && (await selectSession(r, choice))) return;
		}
		let only = instances;
		if (instances.length > 1) {
			only = instances.filter((i) => i.documentPath !== null && isWork(i.documentPath));
			if (only.length !== 1)
				throw new SessionRefused(
					`Darbojas ${instances.length} Revit sesijas, un lietotne nevar droši pateikt, kurā strādāt: ${only.length ? `projekta darba kopija ir aktīva ${only.length} sesijās` : "nevienā aktīvais dokuments nav projekta darba kopija"}. Sesijas: ${named(instances)}. Izvēlies ar select_revit_instance (pid), vai atstāj darba kopiju aktīvu tieši vienā sesijā.`,
				);
		}
		const pid = only[0]!.pid;
		if (!(await selectSession(r, { pid }))) throw new SessionRefused(`Revit sesiju pid ${pid} neizdevās izvēlēties. Sesijas: ${named(instances)}.`);
	};
}

/** Where a conversation's own session choice is kept: it outlives one message, because the agent chooses once and goes on in later ones. */
export const choiceFile = (appDir: string, threadId: string): string => join(appDir, "revit-choice", `${threadId.replace(/[^\w-]/g, "_")}.json`);

export function readChoice(file: string | null): Record<string, unknown> | null {
	if (!file) return null;
	try {
		const v = JSON.parse(readFileSync(file, "utf8")) as unknown;
		return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}
