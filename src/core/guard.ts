// Path guard: the one place that decides whether a path may be read or written.
// Carried from v1 src/kernel/guard.ts and changed for v2: the office project folder is a read-only SOURCE; the app writes
// only into its own per-project data folder. No write ever lands inside the source root, whatever path is asked for.
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

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

/** The one write the app makes into the office folder (work plan 7.6, the user's click only): a new dated delivery folder
 *  1.4_Nodevumi\<existing kind folder>\<YYMMDD> and the files inside it. `deliveriesDir` is the project's 1.4_Nodevumi; the
 *  target must sit exactly two levels under it, be named YYMMDD, and every file must stay inside the target. Nothing else. */
export function checkDeliveryWrite(cfg: GuardConfig, deliveriesDir: string, target: string, file?: string): GuardResult {
	const dd = resolve(deliveriesDir);
	const t = resolve(target);
	if (!isInside(dd, cfg.sourceRoot) || norm(dd) === norm(cfg.sourceRoot)) return { ok: false, reason: `Nodevumu mape nav projekta mapē: ${dd}` };
	if (!/^1\.4(?![.\d])/.test(basename(dd).trim())) return { ok: false, reason: `Nav 1.4_Nodevumi mape: ${dd}` };
	if (norm(dirname(dirname(t))) !== norm(dd)) return { ok: false, reason: `Nodevumu kopē tikai uz 1.4_Nodevumi\\<veids>\\<YYMMDD>: ${t}` };
	if (!/^\d{6}$/.test(basename(t))) return { ok: false, reason: `Mapes nosaukumam jābūt YYMMDD: ${basename(t)}` };
	if (file === undefined) return { ok: true, path: t };
	const f = resolve(t, file);
	if (!isInside(f, t) || norm(f) === norm(t)) return { ok: false, reason: `Ārpus nodevuma mapes: ${f}` };
	return { ok: true, path: f };
}

/** Writing: only inside the data folder, never inside the source root (even when the data folder sits inside it). */
export function checkWrite(cfg: GuardConfig, raw: string): GuardResult {
	if (!raw || typeof raw !== "string") return { ok: false, reason: "Nav norādīts ceļš." };
	const path = resolve(cfg.dataDir, raw);
	if (isInside(path, cfg.sourceRoot)) return { ok: false, reason: `Izejas mapē app neraksta nekad: ${path}` };
	if (!isInside(path, cfg.dataDir)) return { ok: false, reason: `Ārpus app datu mapes: ${path}` };
	return { ok: true, path };
}
