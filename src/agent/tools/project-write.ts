// Which file writes of the agent need no click. The rule (the user's, 2.10.1): a text note the agent writes inside the open project's
// folder (an .md analysis, a .csv list, a .json) runs without asking, and so does rewriting a file the agent made itself.
// Everything else keeps its click: a path outside the project folder (also through `..`, a symlink or another drive), a hidden folder,
// a file type that is not plain text, and any file the agent did not create (the office's own documents; overwriting one is kept in
// <app data>\backups\agent either way). The gate (levels.ts) asks `freeWrite` before it asks the user; the tools record what they
// create with `recordCreated`, so "a file the agent made" survives a restart. run_command, move_file and deletes never come here.
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { isInside } from "../../core/guard.js";
import { readJson, writeAtomic } from "../../core/safe-file.js";
import type { ToolCtx } from "./context.js";

/** The tools whose confirm level is lifted when `freeWrite` says so, and the argument that names the file they write. */
const WRITES: Record<string, "path" | "to"> = { write_file: "path", edit_file: "path", copy_file: "to" };

/** Plain-text kinds only: write_file writes text, so a .docx or .pdf written this way would be damaged, never "a note". */
const TEXT = new Set([".md", ".markdown", ".txt", ".csv", ".tsv", ".json", ".yml", ".yaml", ".html", ".htm", ".log"]);
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
const LEDGER_MAX = 5000;

/** The open project's folder (the office project folder), or null without a project. */
export function projectRoot(ctx: ToolCtx): string | null {
	if (!ctx.projectId) return null;
	const root = (JSON.parse(readFileSync(join(ctx.projectsDir, ctx.projectId, "project.json"), "utf8")) as { root?: unknown }).root;
	return typeof root === "string" && root ? root : null;
}

const key = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

const ledgerFile = (ctx: ToolCtx) => join(ctx.appDir, "agent-files", `${ctx.projectId}.json`);

function ledger(ctx: ToolCtx): string[] {
	const v = readJson<unknown[]>(ledgerFile(ctx), Array.isArray);
	return (v ?? []).filter((x): x is string => typeof x === "string");
}

/** A path with its symlinks and junctions resolved. A file that does not exist yet takes the real path of the nearest folder that does;
 *  a link that points nowhere throws (so the caller asks the user). */
function realPath(p: string): string {
	let cur = resolve(p);
	const rest: string[] = [];
	for (;;) {
		try {
			lstatSync(cur);
			break;
		} catch {
			const up = dirname(cur);
			if (up === cur) break;
			rest.unshift(basename(cur));
			cur = up;
		}
	}
	return join(realpathSync.native(cur), ...rest);
}

/** The real path of a file inside the project folder, or null when it is not a path the agent may write without asking. */
function inProject(ctx: ToolCtx, raw: string): string | null {
	const root = projectRoot(ctx);
	if (!root || raw.includes("\0")) return null;
	const target = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
	// a stream name ("file.md:x") or a drive other than the root's is never a note; after the drive letter no ":" may stay
	if (/:/.test(target.replace(/^[a-z]:/i, ""))) return null;
	const rootReal = realPath(root);
	const real = realPath(target);
	if (dirname(rootReal) === rootReal) return null; // a project "folder" that is a drive root would let every file on it pass
	if (key(real) === key(rootReal) || !isInside(real, rootReal)) return null;
	const rel = relative(rootReal, real);
	if (isAbsolute(rel)) return null;
	for (const seg of rel.split(/[\\/]/)) if (seg.startsWith(".") || seg.endsWith(" ") || seg.endsWith(".") || DEVICE.test(seg)) return null;
	return TEXT.has(extname(real).toLowerCase()) ? real : null;
}

/** True when this call writes a text note inside the project folder and needs no click: a file that is new, or one the agent made earlier. */
export function freeWrite(ctx: ToolCtx, tool: string, args: unknown): boolean {
	const field = WRITES[tool];
	if (!field) return false;
	const raw = (args as Record<string, unknown> | null | undefined)?.[field];
	if (typeof raw !== "string" || !raw.trim()) return false;
	try {
		const real = inProject(ctx, raw);
		if (!real) return false;
		if (!existsSync(real)) return tool !== "edit_file"; // an edit of a file that is not there fails by itself, and asks nothing
		const st = lstatSync(real);
		if (!st.isFile() || st.isSymbolicLink() || st.nlink > 1) return false;
		return ledger(ctx).includes(key(real));
	} catch {
		return false;
	}
}

/** Remembers a file the agent created (not one it overwrote), so rewriting it later needs no click. Never throws. */
export function recordCreated(ctx: ToolCtx, file: string): void {
	try {
		if (!ctx.projectId) return;
		const real = inProject(ctx, file);
		if (!real) return;
		const k = key(real);
		const have = ledger(ctx);
		if (have.includes(k)) return;
		writeAtomic(ledgerFile(ctx), JSON.stringify([...have, k].slice(-LEDGER_MAX)));
	} catch {
		// a missing record only means the next rewrite asks once
	}
}
