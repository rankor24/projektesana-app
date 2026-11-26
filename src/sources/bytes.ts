// Bytes of a source's latest file: a loose file through the guard, a file inside a container from its zip.
// A file that is no longer where the source list says (the folder was moved, renamed or unpacked into one level less after the last scan) is looked for
// under the project's inputs by its name and by its hash (size when the source has none); the list itself is corrected by the next scan.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { unzipSync } from "fflate";
import type { Source } from "../core/model.js";
import { checkRead } from "../core/guard.js";
import type { ProjectStore } from "../core/store.js";

const SEARCH_DEPTH = 10;
const SEARCH_ENTRIES = 20_000;

const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Files named like `missing` (any case) under `dir`, at most SEARCH_ENTRIES entries looked at. */
function sameName(dir: string, missing: string, found: string[], seen = { n: 0 }, depth = 0): void {
	if (depth > SEARCH_DEPTH || seen.n > SEARCH_ENTRIES) return;
	const want = basename(missing).toLowerCase();
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		seen.n++;
		const full = join(dir, e.name);
		if (e.isDirectory()) sameName(full, missing, found, seen, depth + 1);
		else if (e.isFile() && e.name.toLowerCase() === want) found.push(full);
	}
}

/** The bytes of a file the list names, or — when it is gone from that place — of the same file found elsewhere in the project's inputs. */
function readSourceFile(store: ProjectStore, s: Source, path: string): Uint8Array {
	const g = checkRead(store.guard, path);
	if (!g.ok) throw new Error(g.reason);
	try {
		return new Uint8Array(readFileSync(g.path));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
		const v = s.versions[s.versions.length - 1];
		const inputsRel = store.readMeta<{ inputsRel?: string | null }>("scan", {}).inputsRel;
		const found: string[] = [];
		sameName(join(store.project.root, inputsRel ?? ""), g.path, found);
		for (const f of found) {
			if (!checkRead(store.guard, f).ok) continue;
			let b: Uint8Array;
			try {
				b = new Uint8Array(readFileSync(f));
			} catch {
				continue;
			}
			const same = v?.sha256 && !v.sha256.startsWith("q:") ? sha256(b) === v.sha256 : v ? b.length === v.size : true;
			if (same) return b;
		}
		throw new Error(`Avota ${s.id} fails nav tur, kur saraksts to rāda (${g.path}), un tāds pats fails nav atrasts arī 1.1 mapē: tas pārvietots vai pārdēvēts. Atsvaidzini sarakstu: app_change projects.scan.`);
	}
}

export function sourceBytes(store: ProjectStore, sourceId: string): Uint8Array {
	const s = store.read("sources").find((x) => x.id === sourceId);
	if (!s) throw new Error(`Avots ${sourceId} nav atrasts.`);
	const loose = s.paths.find((p) => !p.includes("::"));
	if (loose) return readSourceFile(store, s, loose);
	const ref = s.container ? { path: s.container.path, inner: s.container.inner } : s.paths[0] ? { path: s.paths[0].split("::")[0], inner: s.paths[0].split("::")[1] } : null;
	if (!ref) throw new Error("Avotam vairs nav faila mapē.");
	const inner = unzipSync(readSourceFile(store, s, ref.path), { filter: (f) => f.name === ref.inner })[ref.inner];
	if (!inner) throw new Error(`Konteinerā nav ${ref.inner}`);
	return inner;
}
