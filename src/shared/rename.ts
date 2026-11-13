// File names for a delivery (task 8.12): the rules for turning what is in a staging folder into names the office standard and the
// `filenames` check accept — "<sheet number>_<title>.<ext>", no diacritics — or, for an upload to BIS.gov.lv, BIM Crew's
// "NUMURS_MARKA_REVĪZIJA_LAPAS NOSAUKUMS" (ported from core/bis_renamer.py: its pattern, its marka list, its guesses). Pure and
// node-free: the plan is made here, shown first (old → new, conflicts), and only then applied by staging.ts.
export type RenameMode = "office" | "bis";
export type RenameStatus = "same" | "rename" | "input" | "conflict";

export interface RenameResult {
	applied: number;
	errors: string[];
	/** the renames of this call, for taking them back together; null when nothing was renamed */
	batch: string | null;
}

export interface RenameRow {
	/** the file as staged: its path inside the staging folder, with "/" */
	file: string;
	/** the new name (the file stays in its folder); null when it cannot be worked out */
	to: string | null;
	status: RenameStatus;
	/** why: what was changed, or what is missing */
	why: string;
}

/** The sheet-file shape the office standard asks for (the `filenames` check uses this same one). */
export const SHEET_FILE = /^[A-Z]{1,5}[A-Z0-9]{0,3}[-_ ]?\d+(?:[.\-]\d+)*[a-z]?_[^_].*\.\w+$/i;
export const DIACRITIC = /[^\x00-\x7F]/;

const LV: Record<string, string> = { ā: "a", č: "c", ē: "e", ģ: "g", ī: "i", ķ: "k", ļ: "l", ņ: "n", š: "s", ū: "u", ž: "z", Ā: "A", Č: "C", Ē: "E", Ģ: "G", Ī: "I", Ķ: "K", Ļ: "L", Ņ: "N", Š: "S", Ū: "U", Ž: "Z" };

/** Latvian letters to their plain ones (ā → a, Š → S), other accents stripped, characters a file name cannot hold replaced by a space. */
export function foldName(s: string): string {
	const lv = s.replace(/[āčēģīķļņšūžĀČĒĢĪĶĻŅŠŪŽ]/g, (c) => LV[c]);
	return lv
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[\\/:*?"<>|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

const splitExt = (name: string): [string, string] => {
	const m = /^(.*?)(\.[^.]+)?$/.exec(name)!;
	return [m[1], m[2] ?? ""];
};

/** Sheet number and title from a stem, whatever the separators: "AR 3 Fasades", "ar-3_fasades", "AR-3.1 - Griezumi 1-1". */
export function parseSheet(stem: string): { number: string; title: string } | null {
	const m = /^([A-Za-z]{1,5}?[A-Za-z0-9]{0,3}?)[-_ ]?(\d+(?:[.-]\d+)*[a-z]?)(?:[\s_-]+(.+))?$/.exec(stem);
	if (!m) return null;
	return { number: `${m[1].toUpperCase()}-${m[2]}`, title: (m[3] ?? "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim() };
}

// ---- BIS.gov.lv upload names (BIM Crew bis_renamer.py) ----------------------------------------------------------------------

/** The firm's section marks. Compound ones keep their hyphen: it is part of the mark, not a separator. */
export const DISCIPLINE_MARKAS = new Set(["GP", "TS", "TS-L", "TS-CD", "AR", "ARD", "IN", "IE", "TN", "BK", "MKD", "DZKD", "KKD", "AVK", "AVK-A", "AVK-V", "AVK-K", "SM", "GA", "DN", "DA", "UK", "UK-U", "UK-K", "EL", "ESS", "ESS-TK", "ESS-PK", "ESS-AS", "ESS-VN", "ESS-CI", "ESS-VAS", "UATS", "UAS", "ELT", "EST", "ŪKT", "LKT", "DT", "GAT", "SAT", "BA", "UR", "IZP"]);

const BIS_UNDERSCORE = /^(?<numurs>[^_]+)_(?<marka>[^_]+)_(?<revizija>[^_]+)_(?<lapas>.+?)(?:\s*\((?<orig>[^)]+)\))?$/;
const BIS_HYPHEN = /^(?<numurs>[^-]+)-(?<marka>[^-]+)-(?<revizija>[^-]+)-(?<lapas>.+?)(?:\s*\((?<orig>[^)]+)\))?$/;

export function parseBis(stem: string): { numurs: string; marka: string; revizija: string; lapas: string; orig: string } | null {
	for (const re of [BIS_UNDERSCORE, BIS_HYPHEN]) {
		const g = re.exec(stem)?.groups;
		if (g) return { numurs: g.numurs.trim(), marka: g.marka.trim(), revizija: g.revizija.trim(), lapas: g.lapas.trim(), orig: (g.orig ?? "").trim() };
	}
	return null;
}

/** The first known section mark among the first 25 characters (split on _ space . only, so AVK-A survives). */
export function extractMarka(stem: string): string {
	for (const tok of stem.slice(0, 25).split(/[_\s.]+/)) if (tok && DISCIPLINE_MARKAS.has(tok.toUpperCase())) return tok.toUpperCase();
	return "";
}

/** The first group of 3–4 digits in the coded prefix, kept as written (001 stays 001). */
export function extractNumurs(stem: string): string {
	return /(?:^|[_\-\s])(\d{3,4})(?=[_\-\s]|$)/.exec(stem)?.[1] ?? "";
}

/** The human sheet name: the first field with a space or a lowercase letter (codes are short and uppercase); split on _ only. */
export function guessLapas(stem: string): string {
	const fields = stem.split("_");
	const i = fields.findIndex((f) => f.includes(" ") || /[a-zāčēģīķļņšūž]/.test(f));
	return (i >= 0 ? fields.slice(i).join(" ") : (fields.at(-1) ?? "").replace(/[_-]+/g, " ")).trim();
}

// ---- the plan --------------------------------------------------------------------------------------------------------------

interface Planned {
	to: string | null;
	status: Exclude<RenameStatus, "conflict">;
	why: string;
}

function officeName(base: string): Planned {
	const [stem, ext] = splitExt(base);
	const clean = foldName(stem);
	const folded = DIACRITIC.test(base) || clean !== stem;
	if (SHEET_FILE.test(base) && !folded) return { to: base, status: "same", why: "jau pareizs" };
	const target = `${clean}${ext}`;
	if (SHEET_FILE.test(target) && clean !== stem) return { to: target, status: "rename", why: DIACRITIC.test(base) ? "garumzīmes vai mīkstinājuma zīmes" : "nederīgas rakstzīmes" };
	const p = parseSheet(clean);
	if (!p) return { to: null, status: "input", why: "nav lapas numura (AR-3 veidā): ieraksti to pats" };
	if (!p.title) return { to: null, status: "input", why: `ir numurs ${p.number}, bet nav nosaukuma: ieraksti to pats` };
	const to = `${p.number}_${p.title}${ext}`;
	return { to, status: "rename", why: `numurs ${p.number}, nosaukums «${p.title}»` };
}

function bisName(base: string, revision: string): Planned {
	const [stem, ext] = splitExt(base);
	const clean = foldName(stem);
	const parsed = parseBis(clean);
	if (parsed && DISCIPLINE_MARKAS.has(parsed.marka.toUpperCase()) && !DIACRITIC.test(base)) return { to: base, status: "same", why: "jau BIS formā" };
	const numurs = extractNumurs(clean);
	const marka = extractMarka(clean);
	if (!numurs || !marka) return { to: null, status: "input", why: `${!numurs ? "nav 3–4 ciparu numura" : ""}${!numurs && !marka ? " un " : ""}${!marka ? "nav zināmas sadaļas markas (AR, BK, AVK-A…)" : ""}: ieraksti pats` };
	const lapas = guessLapas(clean) || clean;
	return { to: `${numurs}_${marka}_${revision}_${lapas}${ext}`, status: "rename", why: `numurs ${numurs}, marka ${marka}, revīzija ${revision}` };
}

/** The plan for a list of staged files ("/" paths inside the staging folder): what each becomes, and which cannot be decided or collide. */
export function planRenames(files: string[], mode: RenameMode = "office", opts: { revision?: string } = {}): RenameRow[] {
	const revision = opts.revision?.trim() || "01";
	const rows: RenameRow[] = files.map((file) => {
		const base = file.split("/").pop()!;
		const p = mode === "bis" ? bisName(base, revision) : officeName(base);
		return { file, ...p };
	});
	// two files cannot end up with one name, and a name already taken by a file that stays cannot be used
	const dirOf = (f: string) => f.split("/").slice(0, -1).join("/").toLowerCase();
	const taken = new Map<string, string>();
	for (const r of rows) if (r.status === "same") taken.set(`${dirOf(r.file)}/${r.to!.toLowerCase()}`, r.file);
	for (const r of rows) {
		if (r.status !== "rename") continue;
		const key = `${dirOf(r.file)}/${r.to!.toLowerCase()}`;
		const other = taken.get(key);
		if (other && other !== r.file) {
			r.status = "conflict";
			r.why = `nosaukums «${r.to}» jau ir citam failam (${other.split("/").pop()})`;
			continue;
		}
		taken.set(key, r.file);
	}
	return rows;
}

/** Whether a name the user typed for one row is usable: not empty, no folder, no characters Windows refuses. */
export function validName(name: string): string | null {
	if (!name.trim()) return "tukšs nosaukums";
	if (/[\\/:*?"<>|]/.test(name)) return "nosaukumā nedrīkst būt \\ / : * ? \" < > |";
	if (/^\.|[. ]$/.test(name)) return "nosaukums nedrīkst sākties ar punktu vai beigties ar punktu vai atstarpi";
	if (name.length > 180) return "nosaukums ir pārāk garš";
	return null;
}
