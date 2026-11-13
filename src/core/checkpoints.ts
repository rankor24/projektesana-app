// File checkpoints for the agent's writes (task 8.7). The JSON collections already keep every replaced version (store.ts), so
// they need none. What they do not cover are files: an exported sheet the agent replaced, a staged file it removed, a note it
// wrote. Two cases, one list:
//   a file about to be overwritten or removed → a copy is taken first (<data>\checkpoints\<id>__<name>)
//   a file the tool created                   → recorded afterwards (found by comparing the folders before and after)
// Undo puts the copy back, or moves the created file aside. Nothing is ever deleted: what undo replaces goes to checkpoints\aside.
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { checkWrite } from "./guard.js";
import { newId } from "./model.js";
import { currentScope } from "./scope.js";
import type { ProjectStore } from "./store.js";

export interface Checkpoint {
	id: string;
	at: string;
	run: string | null;
	tool: string;
	/** relative to the project's data folder */
	path: string;
	/** true = the tool made this file (undo moves it aside); false = it existed and was replaced or removed (undo restores it) */
	created: boolean;
	/** the copy, relative to the data folder; null for a created file */
	backup: string | null;
	state: "active" | "undone";
}

/** The data-folder subfolders whose files an agent tool can create. */
export const WATCHED = ["nodevumi", "notes", "exports"] as const;

const META = "checkpoints";
const all = (store: ProjectStore) => store.readMeta<Checkpoint[]>(META, []);
const save = (store: ProjectStore, list: Checkpoint[], kind: string) => store.writeMeta(META, list, { kind, by: "app" });

export function listCheckpoints(store: ProjectStore, run?: string | null): Checkpoint[] {
	return all(store).filter((c) => run === undefined || c.run === run);
}

/** Every file below the watched folders, relative to the data folder. */
export function snapshotFiles(store: ProjectStore): Set<string> {
	const out = new Set<string>();
	const walk = (dir: string, depth: number) => {
		if (depth > 8 || !existsSync(dir)) return;
		for (const d of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, d.name);
			if (d.isDirectory()) walk(full, depth + 1);
			else if (d.isFile()) out.add(relative(store.dir, full));
		}
	};
	for (const w of WATCHED) walk(join(store.dir, w), 0);
	return out;
}

/** Called right before a file is overwritten or removed. Only inside an agent tool call; a user's own click is not a checkpoint. */
export function checkpointBeforeWrite(store: ProjectStore, abs: string): Checkpoint | null {
	const scope = currentScope();
	if (!scope || !existsSync(abs) || !statSync(abs).isFile()) return null;
	const g = checkWrite(store.guard, abs);
	if (!g.ok) return null;
	const id = newId("cp");
	const rel = relative(store.dir, g.path);
	const backup = join("checkpoints", `${id}__${basename(g.path)}`);
	mkdirSync(join(store.dir, "checkpoints"), { recursive: true });
	copyFileSync(g.path, join(store.dir, backup));
	const cp: Checkpoint = { id, at: new Date().toISOString(), run: scope.run, tool: scope.tool, path: rel, created: false, backup, state: "active" };
	save(store, [...all(store), cp], "checkpoint.taken");
	return cp;
}

/** Runs a tool call and records the files it made. */
export async function trackCreated<T>(store: ProjectStore | null, fn: () => Promise<T> | T): Promise<T> {
	const scope = currentScope();
	if (!store || !scope) return fn();
	const before = snapshotFiles(store);
	try {
		return await fn();
	} finally {
		const made = [...snapshotFiles(store)].filter((p) => !before.has(p));
		if (made.length) {
			const at = new Date().toISOString();
			save(store, [...all(store), ...made.map((path): Checkpoint => ({ id: newId("cp"), at, run: scope.run, tool: scope.tool, path, created: true, backup: null, state: "active" }))], "checkpoint.created");
		}
	}
}

/** Puts one file back as it was: the copy returns, or a created file is moved aside. What is in the way goes to checkpoints\aside. */
export function undoCheckpoint(store: ProjectStore, id: string): { path: string; did: "restored" | "moved-aside" } {
	const list = all(store);
	const cp = list.find((c) => c.id === id);
	if (!cp) throw new Error(`Kontrolpunkts ${id} nav atrasts.`);
	if (cp.state === "undone") throw new Error("Šī izmaiņa jau ir atsaukta.");
	const target = resolve(store.dir, cp.path);
	const g = checkWrite(store.guard, target);
	if (!g.ok) throw new Error(g.reason);
	const aside = join(store.dir, "checkpoints", "aside");
	mkdirSync(aside, { recursive: true });
	const moveAside = () => {
		if (existsSync(g.path)) renameSync(g.path, join(aside, `${newId("u")}__${basename(g.path)}`));
	};
	let did: "restored" | "moved-aside";
	if (cp.created) {
		moveAside();
		did = "moved-aside";
	} else {
		const from = resolve(store.dir, cp.backup ?? "");
		if (!cp.backup || !existsSync(from)) throw new Error("Kopijas vairs nav: atsaukt nevar.");
		moveAside();
		mkdirSync(join(g.path, ".."), { recursive: true });
		copyFileSync(from, g.path);
		did = "restored";
	}
	save(store, list.map((c) => (c.id === id ? { ...c, state: "undone" as const } : c)), "checkpoint.undone");
	return { path: g.path, did };
}
