// Role of an input document = its office folder (design doc 2, office standard 00_Projekta mapju koks).
// 1.1.1 … 1.1.7 are fixed; 1.1.8 and later are free folders whose role is proposed from the folder name and confirmed by
// Boris once per project (remembered in roles.json of the project's data folder). No role is guessed from document text.

export const INPUTS_DIR = ["01_Projektesana", "1.1_Izejas dati"] as const;

export const FIXED_ROLES: Record<string, string> = {
	"1.1.1": "Iepirkums",
	"1.1.2": "Īpašuma dokumenti",
	"1.1.3": "Fotofiksācija",
	"1.1.4": "PU",
	"1.1.5": "Tehniskie noteikumi",
	"1.1.6": "Topogrāfija",
	"1.1.7": "Ģeoloģija",
};

/** Roles a free folder can have. "Arhīvs" folders are not read: their files are counted, never listed one by one. */
export const FREE_ROLES = ["TAA", "BIP / BIM prasības", "Info no pasūtītāja", "Būvatļauja / nosacījumi", "Saskaņojumi", "Arhīvs", "Cits"] as const;

/** "1.1.03_FF" → "1.1.3"; "1.1.12_arhivs" → "1.1.12"; anything else → null. */
export function folderKeyOf(name: string): string | null {
	const m = /^1\.1\.0*(\d+)(?:[_\s.-]|$)/.exec(name.trim());
	return m ? `1.1.${Number(m[1])}` : null;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-.]+/g, " ");

/** Proposal for a free folder, from its name only. */
export function proposeFreeRole(folderName: string): (typeof FREE_ROLES)[number] {
	const n = fold(folderName);
	if (/\barhiv/.test(n)) return "Arhīvs";
	if (/\btaa\b|tehnisk\w* apseko/.test(n)) return "TAA";
	if (/\bbip\b|\bbim\b|\beir\b/.test(n)) return "BIP / BIM prasības";
	if (/pasutitaj|\binfo\b/.test(n)) return "Info no pasūtītāja";
	if (/buvatlauj|nosacijum|\bbis\b/.test(n)) return "Būvatļauja / nosacījumi";
	if (/saskanoj/.test(n)) return "Saskaņojumi";
	return "Cits";
}

/** A photo survey folder: YYMMDD_FF (also YYMMDD FF, YYYYMMDD_FF). Returns the ISO date, or null when not one. */
export function surveyDateOf(folderName: string): string | null | undefined {
	const m = /^(\d{6}|\d{8})[ _-]*FF\b/i.exec(folderName.trim());
	if (!m) return undefined;
	const d = m[1];
	const [y, mo, da] = d.length === 6 ? [`20${d.slice(0, 2)}`, d.slice(2, 4), d.slice(4, 6)] : [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)];
	const iso = `${y}-${mo}-${da}`;
	return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) || Number(mo) > 12 || Number(da) > 31 ? null : iso;
}

export const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".heic", ".tif", ".tiff", ".bmp", ".webp", ".dng", ".cr2", ".nef", ".arw"]);
export const VIDEO_EXT = new Set([".mp4", ".mov", ".avi", ".mts"]);

/** Never registered: office temp and lock files, system files. */
export function isJunk(name: string): boolean {
	const n = name.toLowerCase();
	return n.startsWith("~$") || n.startsWith(".~") || n === "thumbs.db" || n === "desktop.ini" || n === ".ds_store" || /\.(tmp|bak|dwl2?|lck|lock|crdownload|part)$/.test(n);
}
