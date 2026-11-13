// The project's IFC models, wherever they are (task 8.1). Before, only 1.2_Projekta dalas was looked at, so an IFC of the
// existing building (1.1), one handed over in 1.4, or one exported into a draft was not a model to the app.
//   listModels(root)      every .ifc under 01_Projektesana: 1.1, 1.2, 1.4 and the rest; arhīvs folders are listed and marked
//                         old, never hidden (the office keeps the latest file per section in the section folder)
//   projectModels(store)  that, plus the IFCs staged in drafts and the revisions the app captured
// Read-only. The preview opens a model through its `rel`: a path under the project folder, an absolute path under the
// app's data folder (drafts), or "rev:<id>" (a revision).
import { existsSync, readdirSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { ProjectStore } from "../core/store.js";
import type { ModelOrigin, ModelRow } from "../shared/api.js";

export type ModelFile = ModelRow;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const MAX_DEPTH = 8;
const MAX_ENTRIES = 200_000;

/** Which part of the office tree a first-level folder is. */
export function originOf(folderName: string): ModelOrigin {
	const n = folderName.trim();
	if (/^1\.1(?![.\d])/.test(n)) return "izejas dati";
	if (/^1\.2(?![.\d])/.test(n)) return "projekta daļas";
	if (/^1\.4(?![.\d])/.test(n)) return "nodevumi";
	return "cits";
}

const sortModels = (a: ModelFile, b: ModelFile) =>
	Number(a.archived) - Number(b.archived) || (a.section ?? "").localeCompare(b.section ?? "", "lv", { numeric: true }) || a.name.localeCompare(b.name, "lv");

export async function listModels(root: string): Promise<ModelFile[]> {
	const out: ModelFile[] = [];
	let top;
	try {
		top = (await readdir(root, { withFileTypes: true })).find((d) => d.isDirectory() && /^01[\s_.-]*projekt/.test(norm(d.name)));
	} catch {
		return out;
	}
	if (!top) return out;
	const base = join(root, top.name);
	let seen = 0;
	// `part` = the first-level folder (1.1 / 1.2 / 1.4 / other); `section` = the folder under it
	const walk = async (p: string, part: string, section: string | null, archived: boolean, depth: number) => {
		if (depth > MAX_DEPTH) return;
		let entries;
		try {
			entries = await readdir(p, { withFileTypes: true });
		} catch {
			return;
		}
		for (const d of entries) {
			if (++seen > MAX_ENTRIES) return;
			const full = join(p, d.name);
			if (d.isDirectory()) {
				if (/^(node_modules|\.git)$/i.test(d.name)) continue;
				await walk(full, part, section ?? (depth > 0 ? d.name : null), archived || /^arh[iī]v/.test(norm(d.name)), depth + 1);
			} else if (d.isFile() && extname(d.name).toLowerCase() === ".ifc") {
				const s = await stat(full);
				out.push({ rel: relative(root, full), name: d.name, section, size: s.size, mtime: s.mtime.toISOString(), origin: originOf(part), archived });
			}
		}
	};
	for (const d of await readdir(base, { withFileTypes: true })) {
		if (d.isDirectory()) await walk(join(base, d.name), d.name, null, /^arh[iī]v/.test(norm(d.name)), 1);
		else if (d.isFile() && extname(d.name).toLowerCase() === ".ifc") {
			const s = await stat(join(base, d.name));
			out.push({ rel: relative(root, join(base, d.name)), name: d.name, section: null, size: s.size, mtime: s.mtime.toISOString(), origin: "cits", archived: false });
		}
	}
	return out.sort(sortModels);
}

/** IFC files under the drafts' staging folders (<data>\nodevumi\<KIND>\<YYMMDD>\…). */
export function stagedModels(dataDir: string): ModelFile[] {
	const out: ModelFile[] = [];
	const base = join(dataDir, "nodevumi");
	if (!existsSync(base)) return out;
	const walk = (p: string, label: string, depth: number) => {
		if (depth > 5) return;
		for (const d of readdirSync(p, { withFileTypes: true })) {
			const full = join(p, d.name);
			if (d.isDirectory()) walk(full, depth === 0 ? d.name : `${label}\\${d.name}`, depth + 1);
			else if (d.isFile() && extname(d.name).toLowerCase() === ".ifc") {
				const s = statSync(full);
				out.push({ rel: full, name: d.name, section: label, size: s.size, mtime: s.mtime.toISOString(), origin: "uzmetums", archived: false });
			}
		}
	};
	walk(base, "", 0);
	return out;
}

/** The IFC of each revision the app captured, as "rev:<id>". */
export function revisionModels(store: ProjectStore): ModelFile[] {
	const out: ModelFile[] = [];
	for (const r of store.read("revisions")) {
		if (!r.ifc) continue;
		const abs = join(store.dir, r.ifc);
		if (!existsSync(abs)) continue;
		const s = statSync(abs);
		out.push({ rel: `rev:${r.id}`, name: `${r.id}.ifc`, section: r.summary || null, size: s.size, mtime: r.at, origin: "revīzija", archived: false });
	}
	return out.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/** Everything the preview can open as a model: the office tree, then drafts, then revisions. */
export async function projectModels(store: ProjectStore): Promise<ModelFile[]> {
	return [...(await listModels(store.project.root)), ...stagedModels(store.dir), ...revisionModels(store)];
}
