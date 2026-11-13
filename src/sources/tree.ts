// The Faili tab's data (task 8.3): the project's folders and files as the user sees them in Explorer, one level at a time,
// with what the app knows laid over them — the scan's source (and so its role) for a file, the role of a 1.1.x folder,
// the files it found inside an .edoc / .asice container. Read-only; nothing here writes or opens anything.
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { Source } from "../core/model.js";
import type { FileEntry, FileList } from "../shared/api.js";
import { isJunk } from "./roles.js";

/** The scan's view of the project, keyed so Windows' case and slashes do not matter. */
export interface Overlay {
	sourceByRel: Map<string, Source>;
	innerByContainer: Map<string, Source[]>;
	folderRoles: Map<string, { role: string; roleFrom: string }>;
}

export const relKey = (rel: string) => rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").normalize("NFC").toLowerCase();

const LIST_CAP = 400;
const COUNT_CAP = 5000;
const COUNT_DEPTH = 8;
const SEARCH_ENTRIES = 60_000;
const SEARCH_CAP = 200;
const SEARCH_DEPTH = 10;

export function buildOverlay(root: string, sources: Source[], folders: { rel: string; role: string; roleFrom: string }[] = []): Overlay {
	const sourceByRel = new Map<string, Source>();
	const innerByContainer = new Map<string, Source[]>();
	for (const s of sources) {
		for (const p of s.paths) {
			if (p.includes("::")) continue;
			sourceByRel.set(relKey(relative(root, resolve(root, p))), s);
		}
		if (s.container) {
			const k = relKey(relative(root, resolve(root, s.container.path)));
			innerByContainer.set(k, [...(innerByContainer.get(k) ?? []), s]);
		}
	}
	return { sourceByRel, innerByContainer, folderRoles: new Map(folders.map((f) => [relKey(f.rel), { role: f.role, roleFrom: f.roleFrom }])) };
}

const EMPTY: Overlay = { sourceByRel: new Map(), innerByContainer: new Map(), folderRoles: new Map() };

/** `base`-relative path → absolute, or null when it would leave the base (.., another drive). */
export function insideBase(base: string, rel: string): string | null {
	const abs = resolve(base, rel);
	const b = resolve(base);
	return abs === b || abs.startsWith(b + sep) ? abs : null;
}

async function countFiles(dir: string, depth = 0, acc = { n: 0 }): Promise<{ n: number; capped: boolean }> {
	if (depth > COUNT_DEPTH || acc.n >= COUNT_CAP) return { n: acc.n, capped: acc.n >= COUNT_CAP };
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return { n: acc.n, capped: false };
	}
	for (const d of entries) {
		if (d.isDirectory()) await countFiles(join(dir, d.name), depth + 1, acc);
		else if (d.isFile() && !isJunk(d.name)) acc.n++;
		if (acc.n >= COUNT_CAP) break;
	}
	return { n: acc.n, capped: acc.n >= COUNT_CAP };
}

const natural = (a: string, b: string) => a.localeCompare(b, "lv", { numeric: true, sensitivity: "base" });

function fileEntry(rel: string, name: string, size: number, mtimeMs: number, ov: Overlay): FileEntry {
	const s = ov.sourceByRel.get(relKey(rel));
	const inner = ov.innerByContainer.get(relKey(rel))?.length;
	return {
		name,
		rel,
		kind: "file",
		size,
		mtime: new Date(mtimeMs).toISOString(),
		...(s ? { sourceId: s.id, role: s.role, roleFrom: s.roleFrom } : {}),
		...(inner ? { inner } : {}),
	};
}

/** One level of `base`\\rel: folders first (with the number of files below, counted by name), then files. */
export async function listDirectory(base: string, rel: string, overlay: Overlay = EMPTY): Promise<FileList> {
	if (rel.endsWith("::")) return listContainer(rel.slice(0, -2), overlay);
	const abs = insideBase(base, rel);
	if (!abs) throw new Error(`Ārpus mapes: ${rel}`);
	const entries = await readdir(abs, { withFileTypes: true });
	const dirs = entries.filter((d) => d.isDirectory()).sort((a, b) => natural(a.name, b.name));
	const files = entries.filter((d) => d.isFile() && !isJunk(d.name)).sort((a, b) => natural(a.name, b.name));
	const out: FileEntry[] = [];
	for (const d of [...dirs, ...files].slice(0, LIST_CAP)) {
		const childRel = rel ? join(rel, d.name) : d.name;
		const full = join(abs, d.name);
		if (d.isDirectory()) {
			const c = await countFiles(full);
			const fr = overlay.folderRoles.get(relKey(childRel));
			out.push({ name: d.name, rel: childRel, kind: "dir", size: null, mtime: null, files: c.n, ...(c.capped ? { capped: true } : {}), ...(fr ? { role: fr.role, roleFrom: fr.roleFrom } : {}) });
		} else {
			let s;
			try {
				s = await stat(full);
			} catch {
				continue;
			}
			out.push(fileEntry(childRel, d.name, s.size, s.mtimeMs, overlay));
		}
	}
	return { entries: out, hidden: Math.max(0, dirs.length + files.length - LIST_CAP) };
}

/** The files the scan registered inside a container (.edoc / .asice), as rows under it: rel "<container>::<inner>". */
export function listContainer(containerRel: string, ov: Overlay): FileList {
	const inner = ov.innerByContainer.get(relKey(containerRel)) ?? [];
	const entries: FileEntry[] = inner
		.map((s) => {
			const name = s.container!.inner;
			const v = s.versions.at(-1);
			return { name, rel: `${containerRel}::${name}`, kind: "file" as const, size: v?.size ?? null, mtime: v?.mtime ?? null, sourceId: s.id, role: s.role, roleFrom: s.roleFrom };
		})
		.sort((a, b) => natural(a.name, b.name));
	return { entries, hidden: 0 };
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** File and folder names containing `q` (case and diacritics ignored), breadth first, capped; names inside containers too. */
export async function searchTree(base: string, q: string, overlay: Overlay = EMPTY): Promise<FileList> {
	const needle = fold(q.trim());
	if (needle.length < 2) throw new Error("Meklēšanai vajag vismaz 2 rakstzīmes.");
	const out: FileEntry[] = [];
	let seen = 0;
	let queue: string[] = [""];
	for (let depth = 0; depth <= SEARCH_DEPTH && queue.length && out.length < SEARCH_CAP && seen < SEARCH_ENTRIES; depth++) {
		const next: string[] = [];
		for (const rel of queue) {
			let entries;
			try {
				entries = await readdir(join(base, rel), { withFileTypes: true });
			} catch {
				continue;
			}
			for (const d of entries) {
				if (++seen > SEARCH_ENTRIES || out.length >= SEARCH_CAP) break;
				const childRel = rel ? join(rel, d.name) : d.name;
				if (d.isDirectory()) {
					next.push(childRel);
					if (fold(d.name).includes(needle)) out.push({ name: d.name, rel: childRel, kind: "dir", size: null, mtime: null });
				} else if (d.isFile() && !isJunk(d.name)) {
					if (fold(d.name).includes(needle)) {
						try {
							const s = await stat(join(base, childRel));
							out.push(fileEntry(childRel, d.name, s.size, s.mtimeMs, overlay));
						} catch {
							// gone since listing: skip
						}
					}
					for (const s of overlay.innerByContainer.get(relKey(childRel)) ?? []) {
						if (fold(s.container!.inner).includes(needle) && out.length < SEARCH_CAP) out.push({ name: s.container!.inner, rel: `${childRel}::${s.container!.inner}`, kind: "file", size: s.versions.at(-1)?.size ?? null, mtime: s.versions.at(-1)?.mtime ?? null, sourceId: s.id, role: s.role, roleFrom: s.roleFrom });
					}
				}
			}
		}
		queue = next;
	}
	return { entries: out, hidden: seen >= SEARCH_ENTRIES || out.length >= SEARCH_CAP ? 1 : 0 };
}
