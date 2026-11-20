// Where a project's office folders 1.1 … 1.4 live. The office standard puts them under 01_Projektesana (any case and diacritics:
// 01_Projektēšana, 01 Projektesana); some projects keep them straight in the project folder (E:\BV BIM\<project>\1.1 Izejas Dati).
// One lookup for the scan (1.1), the deliveries (1.4) and the models (1.1, 1.2, 1.4), so they always agree. Read-only.
import { readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const isTop = (name: string) => /^01[\s_.-]*projekt/.test(norm(name));
/** "1.1_Izejas dati", "1.1 Izejas Dati" — not "1.10" or "1.1.2" */
export const isPart = (name: string, part: string) => new RegExp(`^${part.replace(".", "\\.")}(?![.\\d])`).test(name.trim());
const anyPart = (name: string) => /^1\.[1-4](?![.\d])/.test(name.trim());

type Entry = { name: string; isDirectory(): boolean };

function pick(root: string, entries: Entry[]): string | null {
	const dirs = entries.filter((d) => d.isDirectory());
	const top = dirs.find((d) => isTop(d.name));
	if (top) return join(root, top.name);
	// no 01_Projektesana: the project folder itself holds the 1.x folders
	return dirs.some((d) => anyPart(d.name)) ? root : null;
}

/** 01_Projektesana under `root`, else `root` itself when it holds 1.1 … 1.4 folders, else null. Never throws. */
export async function projectingDir(root: string): Promise<string | null> {
	try {
		return pick(root, await readdir(root, { withFileTypes: true }));
	} catch {
		return null;
	}
}

export function projectingDirSync(root: string): string | null {
	try {
		return pick(root, readdirSync(root, { withFileTypes: true }));
	} catch {
		return null;
	}
}

/** The folder of one office part ("1.1", "1.4") inside the projecting folder, or null. Never throws. */
export async function partDir(root: string, part: string): Promise<string | null> {
	const base = await projectingDir(root);
	if (!base) return null;
	try {
		const d = (await readdir(base, { withFileTypes: true })).find((x) => x.isDirectory() && isPart(x.name, part));
		return d ? join(base, d.name) : null;
	} catch {
		return null;
	}
}

export function partDirSync(root: string, part: string): string | null {
	const base = projectingDirSync(root);
	if (!base) return null;
	try {
		const d = readdirSync(base, { withFileTypes: true }).find((x) => x.isDirectory() && isPart(x.name, part));
		return d ? join(base, d.name) : null;
	} catch {
		return null;
	}
}
