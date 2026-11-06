// The project's IFC models: files in 01_Projektesana\1.2_Projekta dalas\<section>\…\(04_)IFC (the office standard keeps the
// latest file per section; older ones sit in arhīvs, not listed). Read-only listing; the preview opens them.
import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

export interface ModelFile {
	rel: string;
	name: string;
	section: string | null;
	size: number;
	mtime: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export async function listModels(root: string): Promise<ModelFile[]> {
	const out: ModelFile[] = [];
	let top;
	try {
		top = (await readdir(root, { withFileTypes: true })).find((d) => d.isDirectory() && /^01[\s_.-]*projekt/.test(norm(d.name)));
	} catch {
		return out;
	}
	if (!top) return out;
	const parts = (await readdir(join(root, top.name), { withFileTypes: true })).find((d) => d.isDirectory() && /^1\.2(?![.\d])/.test(d.name.trim()));
	if (!parts) return out;
	const base = join(root, top.name, parts.name);
	const walk = async (p: string, section: string | null, depth: number) => {
		if (depth > 5) return;
		for (const d of await readdir(p, { withFileTypes: true })) {
			const full = join(p, d.name);
			if (d.isDirectory()) {
				if (/^arh[iī]v/.test(norm(d.name))) continue;
				await walk(full, section ?? d.name, depth + 1);
			} else if (d.isFile() && extname(d.name).toLowerCase() === ".ifc") {
				const s = await stat(full);
				out.push({ rel: relative(root, full), name: d.name, section, size: s.size, mtime: s.mtime.toISOString() });
			}
		}
	};
	await walk(base, null, 0);
	return out.sort((a, b) => (a.section ?? "").localeCompare(b.section ?? "", "lv", { numeric: true }) || a.name.localeCompare(b.name, "lv"));
}
