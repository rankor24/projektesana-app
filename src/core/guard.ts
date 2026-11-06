// Path guard: the one place that decides whether a path may be read or written.
// Carried from v1 src/kernel/guard.ts and changed for v2: the office project folder is a read-only SOURCE; the app writes
// only into its own per-project data folder. No write ever lands inside the source root, whatever path is asked for.
import { isAbsolute, relative, resolve } from "node:path";

export interface GuardConfig {
	/** The office project folder (for example on the office drive). Read-only to the app. */
	sourceRoot: string;
	/** The app's data folder for this project (`<appData>\Projektesana\projects\<BD>`). */
	dataDir: string;
}

export type GuardResult = { ok: true; path: string } | { ok: false; reason: string };

function norm(p: string): string {
	const r = resolve(p);
	return process.platform === "win32" ? r.toLowerCase() : r;
}

export function isInside(child: string, parent: string): boolean {
	const rel = relative(norm(parent), norm(child));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Reading: inside the source root or inside the data folder. Relative paths resolve against the source root. */
export function checkRead(cfg: GuardConfig, raw: string): GuardResult {
	if (!raw || typeof raw !== "string") return { ok: false, reason: "Nav norādīts ceļš." };
	const path = resolve(cfg.sourceRoot, raw);
	if (isInside(path, cfg.sourceRoot) || isInside(path, cfg.dataDir)) return { ok: true, path };
	return { ok: false, reason: `Ārpus projekta mapes: ${path}` };
}

/** Writing: only inside the data folder, never inside the source root (even when the data folder sits inside it). */
export function checkWrite(cfg: GuardConfig, raw: string): GuardResult {
	if (!raw || typeof raw !== "string") return { ok: false, reason: "Nav norādīts ceļš." };
	const path = resolve(cfg.dataDir, raw);
	if (isInside(path, cfg.sourceRoot)) return { ok: false, reason: `Izejas mapē app neraksta nekad: ${path}` };
	if (!isInside(path, cfg.dataDir)) return { ok: false, reason: `Ārpus app datu mapes: ${path}` };
	return { ok: true, path };
}
