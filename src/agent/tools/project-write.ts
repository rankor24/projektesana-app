// Where the agent's files go, and the one rule about the office folders.
//
// The rule (design doc, and the user's, restated 2026-11-25 after .md files appeared in an office project folder): the office project
// folders are READ-ONLY to the app. An agent tool never writes, edits, copies into or moves out of one, whatever the path (relative, absolute,
// `..`, a symlink or junction, another spelling of the same drive), and no click turns that on. The only sanctioned write into an office
// folder is the user's own delivery copy to 1.4_Nodevumi (core/guard.ts `checkDeliveryWrite`), which is not an agent tool.
//
// The agent's own files (an analysis, a letter draft, a list) go to the app's per-project folder, `<app data>\agent-work\<project>`
// (`workDirOf`), the same folder convert_file, unpack_archive and write_spreadsheet use. A relative path of a write tool means that folder.
// Inside it an agent needs no click: a text note (write_file, edit_file), a copy of any file type (copy_file), and a move from the work folder to the work folder
// (move_file); the old text is kept in <app data>\backups\agent first. Everything else keeps its click (a path elsewhere on the PC, a file type write_file cannot
// write as text), and run_command and deletes never come to `freeWrite`.
//
// `officeBlock` is asked twice: by the gate before it asks the user (so no click is even offered), and by the tool where it runs.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { isInside } from "../../core/guard.js";
import { workDirOf } from "../media.js";
import type { ToolCtx } from "./context.js";

/** The part of the tool context this file reads, so the gate can call it before a run directory or agent exists. */
type WriteCtx = Pick<ToolCtx, "projectId" | "projectsDir" | "appDir">;

/** The tools that write, and the arguments that name what they write to (move_file also takes something away from `from`). */
const TARGETS: Record<string, readonly string[]> = { write_file: ["path"], edit_file: ["path"], copy_file: ["to"], move_file: ["from", "to"] };
/** The tools whose confirm level is lifted when `freeWrite` says so, and the argument that names the file they write. */
const FREE: Record<string, "path" | "to"> = { write_file: "path", edit_file: "path", copy_file: "to", move_file: "to" };
/** Tools that write bytes they copy or move, not text they are given: any file type may land in the work folder (a PDF, a drawing, an export). */
const ANY_TYPE = new Set(["copy_file", "move_file"]);

/** Plain-text kinds only: write_file writes text, so a .docx or .pdf written this way would be damaged, never "a note". */
const TEXT = new Set([".md", ".markdown", ".txt", ".csv", ".tsv", ".json", ".yml", ".yaml", ".html", ".htm", ".log"]);
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** The open project's office folder, or null without a project (or when project.json is unreadable). */
export function projectRoot(ctx: WriteCtx): string | null {
	if (!ctx.projectId) return null;
	try {
		const root = (JSON.parse(readFileSync(join(ctx.projectsDir, ctx.projectId, "project.json"), "utf8")) as { root?: unknown }).root;
		return typeof root === "string" && root ? root : null;
	} catch {
		return null;
	}
}

/** Every office folder the app knows: the roots of all projects, so a thread of one project cannot write into another's folder either. */
export function officeRoots(ctx: WriteCtx): string[] {
	const roots = new Set<string>();
	const current = projectRoot(ctx);
	if (current) roots.add(current);
	try {
		for (const e of readdirSync(ctx.projectsDir, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			try {
				const root = (JSON.parse(readFileSync(join(ctx.projectsDir, e.name, "project.json"), "utf8")) as { root?: unknown }).root;
				if (typeof root === "string" && root) roots.add(root);
			} catch {
				// a project folder without a readable project.json has no root to protect
			}
		}
	} catch {
		// no projects folder yet
	}
	return [...roots];
}

/** The agent's folder for its own files in this project: `<app data>\agent-work\<project>`. */
export const workFolder = (ctx: WriteCtx): string => workDirOf(ctx.appDir, ctx.projectId);

/** Where a write tool puts a file: a relative path is under the agent's work folder (never the office folder), an absolute one is as given. */
export function resolveWrite(ctx: WriteCtx, p: string): string {
	return isAbsolute(p) ? resolve(p) : resolve(workFolder(ctx), p);
}

/** Where a read of a relative path goes: the office folder first, else the agent's work folder (a note it wrote earlier). */
export function resolveRead(ctx: WriteCtx, p: string, exists: (f: string) => boolean): string {
	if (isAbsolute(p)) return resolve(p);
	const root = projectRoot(ctx);
	const inRoot = root ? resolve(root, p) : null;
	const inWork = resolve(workFolder(ctx), p);
	if (inRoot && (exists(inRoot) || !exists(inWork))) return inRoot;
	if (!inRoot && !exists(inWork)) throw new Error("Relatīvs ceļš vajag atvērtu projektu; dod pilnu ceļu.");
	return inWork;
}

const key = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/** A path with its symlinks and junctions resolved. A file that does not exist yet takes the real path of the nearest folder that does;
 *  a link that points nowhere throws (so the caller refuses or asks). */
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

const OFFICE_MSG = "Projekta (biroja) mapē app neraksta nekad: ";

/** The refusal when `target` lies inside an office folder (or cannot be proven to lie outside), else null. */
export function officeFolderBlock(ctx: WriteCtx, target: string): string | null {
	const t = resolve(target);
	// a share written by its network name (\\server\share\…) or a \\?\ path is another spelling of a drive: never a place for an agent file
	if (/^\\\\/.test(t) && !/^\\\\\?\\[a-z]:/i.test(t)) return `${OFFICE_MSG}tīkla ceļš ${t} nav atļauts; raksti savā darba mapē (${workFolder(ctx)}).`;
	for (const root of officeRoots(ctx)) {
		if (isInside(t, root)) return `${OFFICE_MSG}${t}. Raksti savā darba mapē (${workFolder(ctx)}); uz 1.4_Nodevumi nokopē tikai lietotājs.`;
		let rootReal: string;
		try {
			rootReal = realPath(root);
		} catch {
			continue; // a project folder that is not reachable now (drive missing) cannot be written into
		}
		try {
			if (isInside(realPath(t), rootReal)) return `${OFFICE_MSG}${t} (saite ved uz projekta mapi). Raksti savā darba mapē (${workFolder(ctx)}).`;
		} catch {
			return `${OFFICE_MSG}neizdevās pārbaudīt ceļu ${t} (saite, kas ved nekur). Raksti savā darba mapē (${workFolder(ctx)}).`;
		}
	}
	return null;
}

// What a PowerShell / cmd line does when it changes something on disk, and the redirect that writes a file.
// A verb counts where a command starts (line start, after a space, ; | & ( or a backtick), never inside a file name such as notes.md.
const VERB = /(?:^|[\s;|&(`])(?:set-content|add-content|out-file|new-item|copy-item|move-item|remove-item|rename-item|clear-content|expand-archive|compress-archive|export-\w+|tee-object|robocopy|xcopy|copy|move|del|erase|rmdir|rd|mkdir|md|ren|rename|rm|cp|mv|ni|sc|ac|ri|mi|ci|tee)(?=[\s;|&)]|$)/i;
const CALL = /\bwrite(?:all|text|bytes)\w*|\[system\.io\.file\]::\w*(?:write|copy|move|delete|create)|\bsave(?:as)?\s*\(/i;
const REDIRECT = />>?\s*(?!\$null\b|&)[^\s&|]/;
const SHELL_WRITE = { test: (text: string) => VERB.test(text) || CALL.test(text) || REDIRECT.test(text) };

/** A shell command that names an office folder (or runs in one) and writes something: refused. A command can build a path in ways no text
 *  check sees, so this is a net for the plain cases; the click the user gives stays the last line, and the default folder of a command is the work folder. */
function shellBlock(ctx: WriteCtx, command: string, cwd: string): string | null {
	let text = command.replace(/\//g, "\\").toLowerCase();
	const roots = officeRoots(ctx);
	const named = roots.some((r) => text.includes(resolve(r).toLowerCase()));
	const runsIn = roots.some((r) => isInside(cwd, r));
	if (!(named || runsIn)) return null;
	// the office path itself is not a verb: take it out before looking at what the command does (a folder called "Copy of plans" is a read)
	for (const r of roots) text = text.split(resolve(r).toLowerCase()).join(" ");
	if (!SHELL_WRITE.test(text)) return null;
	return `${OFFICE_MSG}komanda raksta projekta mapē vai strādā tajā. Raksti savā darba mapē (${workFolder(ctx)}); komandas noklusētā mape ir tā pati.`;
}

/** The refusal for this tool call when it would write into an office folder, else null. The one check the gate and the tools both make. */
export function officeBlock(ctx: WriteCtx, tool: string, args: unknown): string | null {
	const a = (args ?? {}) as Record<string, unknown>;
	if (tool === "run_command") {
		const command = typeof a.command === "string" ? a.command : "";
		const cwd = typeof a.cwd === "string" && a.cwd.trim() ? (() => { try { return resolveRead(ctx, a.cwd as string, () => true); } catch { return workFolder(ctx); } })() : workFolder(ctx);
		return shellBlock(ctx, command, cwd);
	}
	const fields = TARGETS[tool];
	if (!fields) return null;
	for (const f of fields) {
		const raw = a[f];
		if (typeof raw !== "string" || !raw.trim() || raw.includes("\0")) continue;
		// a move takes the file away from `from`: that is read in the office folder's terms (a relative path means the project), a write in the work folder's
		const target = tool === "move_file" && f === "from" ? resolveFrom(ctx, raw) : resolveWrite(ctx, raw);
		const b = officeFolderBlock(ctx, target);
		if (b) return b;
	}
	return null;
}

/** The file move_file takes for this `from`, found the way its run finds it (resolveRead with the same test), so the check and the move name the same file: a relative path means
 *  the project folder, and the work folder only when the file is there and not in the project. */
function resolveFrom(ctx: WriteCtx, p: string): string {
	try {
		return resolveRead(ctx, p, existsSync);
	} catch {
		return resolve(workFolder(ctx), p); // no project and no such file in the work folder: nothing to protect, and the move fails by itself
	}
}

/** The real path of a file inside the agent's work folder, or null when it is not a path the agent may write without asking. */
function inWork(ctx: WriteCtx, raw: string, anyType = false): string | null {
	if (raw.includes("\0")) return null;
	const target = resolveWrite(ctx, raw);
	// a stream name ("file.md:x") or a drive other than the folder's is never a note; after the drive letter no ":" may stay
	if (/:/.test(target.replace(/^[a-z]:/i, ""))) return null;
	const work = workFolder(ctx);
	const workReal = realPath(work);
	const real = realPath(target);
	if (dirname(workReal) === workReal) return null; // a work "folder" that is a drive root would let every file on it pass
	if (key(real) === key(workReal) || !isInside(real, workReal)) return null;
	const rel = relative(workReal, real);
	if (isAbsolute(rel)) return null;
	for (const seg of rel.split(/[\\/]/)) if (seg.startsWith(".") || seg.endsWith(" ") || seg.endsWith(".") || DEVICE.test(seg)) return null;
	return anyType || TEXT.has(extname(real).toLowerCase()) ? real : null;
}

/** True when this call writes inside the agent's work folder and needs no click: a text note (write, edit, copy), a copy of any file type, or a move from the work folder to the work folder. */
export function freeWrite(ctx: WriteCtx, tool: string, args: unknown): boolean {
	const field = FREE[tool];
	if (!field) return false;
	const raw = (args as Record<string, unknown> | null | undefined)?.[field];
	if (typeof raw !== "string" || !raw.trim()) return false;
	try {
		if (officeBlock(ctx, tool, args)) return false;
		const real = inWork(ctx, raw, ANY_TYPE.has(tool));
		if (!real) return false;
		// a move takes the file away: it must come from the work folder too (a relative `from` is read where move_file reads it), and be a plain file
		if (tool === "move_file") {
			const from = (args as Record<string, unknown>).from;
			if (typeof from !== "string" || !from.trim()) return false;
			const src = inWork(ctx, resolveRead(ctx, from, (f) => { try { return lstatSync(f) !== undefined; } catch { return false; } }), true);
			if (!src) return false;
			const st = lstatSync(src);
			if (!st.isFile() || st.isSymbolicLink() || st.nlink > 1) return false;
		}
		// an existing target must be a plain file the agent could rewrite: no link, no hard link
		try {
			const st = lstatSync(real);
			return st.isFile() && !st.isSymbolicLink() && st.nlink <= 1;
		} catch {
			return tool !== "edit_file"; // an edit of a file that is not there fails by itself, and asks nothing
		}
	} catch {
		return false;
	}
}
