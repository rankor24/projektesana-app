// Scan of the project's inputs: 01_Projektesana\1.1_Izejas dati only (v1 walked the whole project, up to 5 000 files,
// including sections, construction and archives — design doc 1, cause 1). Async readdir/stat, so the main process keeps
// serving the window while a network folder is read. Nothing is opened or hashed here; that is the worker's job (1.3).
import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { FIXED_ROLES, folderKeyOf, IMAGE_EXT, isJunk, proposeFreeRole, surveyDateOf, VIDEO_EXT } from "./roles.js";

export interface ScannedFile {
	/** relative to the project root, with backslashes as on Windows */
	rel: string;
	abs: string;
	folderKey: string;
	size: number;
	mtimeMs: number;
}

export interface ScannedSurvey {
	rel: string;
	folderKey: string;
	date: string | null;
	images: number;
	videos: number;
	bytes: number;
	latestMtimeMs: number;
}

export interface FolderInfo {
	folderKey: string;
	name: string;
	rel: string;
	/** fixed folders: their role; free folders: Boris's confirmed role, or the proposal */
	role: string;
	roleFrom: "folder" | "confirmed" | "unconfirmed";
	files: number;
}

export interface ScanResult {
	inputsRel: string | null;
	files: ScannedFile[];
	surveys: ScannedSurvey[];
	folders: FolderInfo[];
	skipped: { archive: number; junk: number };
	problems: string[];
}

/** A folder with at least this many images and no other files is one photo survey, whatever its name. */
const SURVEY_MIN_IMAGES = 20;
const MAX_FILES = 20_000;
const MAX_DEPTH = 10;

/** A folder with at least this many files, almost none of them readable documents, is aggregated into one row. */
const BULK_MIN = 100;
const DOC_EXT = new Set([".pdf", ".docx", ".doc", ".xlsx", ".xls", ".msg", ".rtf", ".txt", ".edoc", ".asice", ".dwg", ".dxf", ".ifc", ".rvt"]);

/** Inside the photo folder, surveys are named by date and who made them: "261013_AA", "261023_Dalux". */
export function datedFolderOf(name: string): string | null | undefined {
	const m = /^(\d{6}|\d{8})(?![\d])/.exec(name.trim());
	if (!m) return undefined;
	const d = m[1];
	const iso = d.length === 6 ? `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}` : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
	const t = Date.parse(`${iso}T00:00:00Z`);
	return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso ? null : iso;
}

/** File and readable-document counts by name only (no stat), stopping at 5 000. */
async function quickCount(p: string, depth = 0, acc = { files: 0, docs: 0 }): Promise<{ files: number; docs: number }> {
	if (depth > MAX_DEPTH || acc.files > 5000) return acc;
	for (const d of await readdir(p, { withFileTypes: true })) {
		if (d.isDirectory()) await quickCount(join(p, d.name), depth + 1, acc);
		else if (d.isFile()) {
			acc.files++;
			if (DOC_EXT.has(extname(d.name).toLowerCase())) acc.docs++;
		}
	}
	return acc;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function dirs(p: string) {
	return (await readdir(p, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "lv", { numeric: true }));
}

/** Finds 01_Projektesana\1.1_Izejas dati with tolerance for case and diacritics (01_Projektēšana, 1.1 Izejas dati). */
export async function findInputs(root: string): Promise<string | null> {
	const top = (await dirs(root)).find((d) => d.isDirectory() && /^01[\s_.-]*projekt/.test(norm(d.name)));
	if (!top) return null;
	const inner = (await dirs(join(root, top.name))).find((d) => d.isDirectory() && /^1\.1(?![.\d])/.test(d.name.trim()));
	return inner ? join(root, top.name, inner.name) : null;
}

async function countFiles(p: string, depth = 0): Promise<{ n: number; images: number; videos: number; bytes: number; latest: number }> {
	const out = { n: 0, images: 0, videos: 0, bytes: 0, latest: 0 };
	if (depth > MAX_DEPTH) return out;
	for (const d of await dirs(p)) {
		const full = join(p, d.name);
		if (d.isDirectory()) {
			const c = await countFiles(full, depth + 1);
			out.n += c.n;
			out.images += c.images;
			out.videos += c.videos;
			out.bytes += c.bytes;
			out.latest = Math.max(out.latest, c.latest);
		} else if (d.isFile() && !isJunk(d.name)) {
			const s = await stat(full);
			out.n++;
			out.bytes += s.size;
			out.latest = Math.max(out.latest, s.mtimeMs);
			const ext = extname(d.name).toLowerCase();
			if (IMAGE_EXT.has(ext)) out.images++;
			else if (VIDEO_EXT.has(ext)) out.videos++;
		}
	}
	return out;
}

/**
 * @param confirmed Boris's confirmed roles of free folders (folderKey → role), from roles.json.
 */
export async function scanInputs(root: string, confirmed: Record<string, string> = {}, onFolder?: (rel: string) => void): Promise<ScanResult> {
	const res: ScanResult = { inputsRel: null, files: [], surveys: [], folders: [], skipped: { archive: 0, junk: 0 }, problems: [] };
	const inputs = await findInputs(root).catch((e: Error) => (res.problems.push(`Mapi nevar nolasīt: ${e.message}`), null));
	if (!inputs) {
		if (!res.problems.length) res.problems.push("Nav mapes 01_Projektesana\\1.1_Izejas dati.");
		return res;
	}
	res.inputsRel = relative(root, inputs);
	const rel = (p: string) => relative(root, p);

	const addSurvey = async (p: string, folderKey: string, date: string | null) => {
		const c = await countFiles(p);
		res.surveys.push({ rel: rel(p), folderKey, date, images: c.images, videos: c.videos, bytes: c.bytes, latestMtimeMs: c.latest });
		return c.n;
	};

	const walk = async (p: string, folderKey: string, inSurveyFolder: boolean, depth: number): Promise<number> => {
		if (depth > MAX_DEPTH) {
			res.problems.push(`Pārāk dziļa mape, nav lasīta: ${rel(p)}`);
			return 0;
		}
		onFolder?.(rel(p));
		let n = 0;
		const entries = await dirs(p);
		const files = entries.filter((d) => d.isFile());
		const looseImages = files.filter((d) => IMAGE_EXT.has(extname(d.name).toLowerCase()) || VIDEO_EXT.has(extname(d.name).toLowerCase()));
		// a folder of only photos (or the photo folder 1.1.3 itself) is one survey, not a file list
		const others = files.filter((d) => !looseImages.includes(d) && !isJunk(d.name));
		const photoOnly = looseImages.length >= SURVEY_MIN_IMAGES && others.length === 0 && !entries.some((d) => d.isDirectory());
		if (looseImages.length && (inSurveyFolder || photoOnly)) {
			const c = { images: 0, videos: 0, bytes: 0, latest: 0 };
			for (const d of looseImages) {
				const s = await stat(join(p, d.name));
				if (IMAGE_EXT.has(extname(d.name).toLowerCase())) c.images++;
				else c.videos++;
				c.bytes += s.size;
				c.latest = Math.max(c.latest, s.mtimeMs);
			}
			const name = p.split(/[\\/]/).pop() ?? "";
			res.surveys.push({ rel: rel(p), folderKey, date: surveyDateOf(name) ?? null, images: c.images, videos: c.videos, bytes: c.bytes, latestMtimeMs: c.latest });
			n += looseImages.length;
		}
		for (const d of entries) {
			const full = join(p, d.name);
			if (d.isDirectory()) {
				if (/^arh[iī]v/i.test(norm(d.name))) {
					const c = await countFiles(full);
					res.skipped.archive += c.n;
					continue;
				}
				const sd = surveyDateOf(d.name) ?? (inSurveyFolder ? datedFolderOf(d.name) : undefined);
				if (sd !== undefined) {
					n += await addSurvey(full, folderKey, sd);
					continue;
				}
				// a bulk folder (a 360° viewer export, a photo dump) is one row, decided by names only before any stat
				const q = await quickCount(full);
				if (q.files >= BULK_MIN && q.docs / q.files < 0.05) {
					n += await addSurvey(full, folderKey, datedFolderOf(d.name) ?? null);
					continue;
				}
				n += await walk(full, folderKey, inSurveyFolder, depth + 1);
			} else if (d.isFile()) {
				if (isJunk(d.name)) {
					res.skipped.junk++;
					continue;
				}
				if (looseImages.includes(d) && (inSurveyFolder || photoOnly)) continue;
				if (res.files.length >= MAX_FILES) {
					if (res.files.length === MAX_FILES) res.problems.push(`Vairāk nekā ${MAX_FILES} faili; pārējie nav reģistrēti.`);
					continue;
				}
				const s = await stat(full);
				res.files.push({ rel: rel(full), abs: full, folderKey, size: s.size, mtimeMs: s.mtimeMs });
				n++;
			}
		}
		return n;
	};

	for (const d of await dirs(inputs)) {
		const full = join(inputs, d.name);
		if (d.isFile()) {
			if (isJunk(d.name)) {
				res.skipped.junk++;
				continue;
			}
			// a file straight in 1.1 has no office folder: its role is asked like a free folder's
			const s = await stat(full);
			res.files.push({ rel: rel(full), abs: full, folderKey: "1.1", size: s.size, mtimeMs: s.mtimeMs });
			continue;
		}
		if (!d.isDirectory()) continue;
		const key = folderKeyOf(d.name);
		if (!key) {
			res.problems.push(`Mape bez 1.1.x numura, nav lasīta: ${d.name}`);
			continue;
		}
		const fixed = FIXED_ROLES[key];
		const role = fixed ?? confirmed[key] ?? proposeFreeRole(d.name);
		const roleFrom: FolderInfo["roleFrom"] = fixed ? "folder" : confirmed[key] ? "confirmed" : "unconfirmed";
		if (role === "Arhīvs") {
			const c = await countFiles(full);
			res.skipped.archive += c.n;
			res.folders.push({ folderKey: key, name: d.name, rel: rel(full), role, roleFrom, files: c.n });
			continue;
		}
		const n = await walk(full, key, key === "1.1.3", 0);
		res.folders.push({ folderKey: key, name: d.name, rel: rel(full), role, roleFrom, files: n });
	}
	if (res.files.some((f) => f.folderKey === "1.1")) {
		res.folders.push({ folderKey: "1.1", name: "(1.1 sakne)", rel: res.inputsRel, role: confirmed["1.1"] ?? "Cits", roleFrom: confirmed["1.1"] ? "confirmed" : "unconfirmed", files: res.files.filter((f) => f.folderKey === "1.1").length });
	}
	return res;
}
