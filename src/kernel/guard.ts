// Path guard: the one place that decides whether a path may be read or written.
// Written without app imports so it can be lifted into a shared package (spec §2).
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface GuardConfig {
	/** Project folder chosen by Boris. */
	root: string;
	/** Registered source files; never writable. */
	sources?: string[];
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

export function checkRead(cfg: GuardConfig, raw: string): GuardResult {
	if (!raw || typeof raw !== "string") return { ok: false, reason: "Nav norādīts ceļš." };
	const path = resolve(cfg.root, raw);
	if (!isInside(path, cfg.root)) return { ok: false, reason: `Ārpus projekta mapes: ${path}` };
	return { ok: true, path };
}

/** `.bv/` is written only by the kernel itself, never by an agent tool path. */
export function checkWrite(cfg: GuardConfig, raw: string): GuardResult {
	const r = checkRead(cfg, raw);
	if (!r.ok) return r;
	const bv = resolve(cfg.root, ".bv");
	if (isInside(r.path, bv)) return { ok: false, reason: ".bv mapi raksta tikai app kodols." };
	if ((cfg.sources ?? []).some((s) => norm(s) === norm(r.path))) {
		return { ok: false, reason: `Izejas failu nekad nemaina: ${r.path}. Izveido jaunu versiju.` };
	}
	return r;
}

export { sep };
