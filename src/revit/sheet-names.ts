// Delivery file names from Revit (work plan 7.3, 7.4). The office rule: a sheet is "<sheet no>_<title>", no diacritics, in a
// YYMMDD folder. Pure, so the page can show the name before anything is exported.
import { safeName, yymmdd } from "../sources/staging.js";

/** "AR-3" + "Fasādes ziemeļu/dienvidu" → "AR-3_Fasades ziemelu_dienvidu" (no extension: Revit adds ".pdf"). */
export function sheetFileName(number: string, name: string): string {
	const no = number.trim().replace(/\s+/g, "-");
	if (!no) throw new Error(`Lapai “${name}” nav numura — Revit lapai vajag numuru.`);
	return safeName(`${no}_${name.trim() || "lapa"}`);
}

/** Sheet file names of a set, checked for clashes after folding (two numbers that fold to the same name). */
export function sheetFileNames(sheets: { number: string; name: string }[]): string[] {
	const out = sheets.map((s) => sheetFileName(s.number, s.name));
	const seen = new Map<string, number>();
	out.forEach((n, i) => {
		const k = n.toLowerCase();
		if (seen.has(k)) throw new Error(`Divām lapām sanāk viens faila nosaukums “${n}” (${sheets[seen.get(k)!].number} un ${sheets[i].number}).`);
		seen.set(k, i);
	});
	return out;
}

/** The IFC of a delivery (the user's answer, 2026-11-10): <BD code>_<daļa>_<YYMMDD>.ifc, e.g. BD427_AR_261110.ifc. */
export function ifcFileName(projectId: string, part: string, date: string): string {
	const code = /^BD\d+/i.exec(projectId.trim())?.[0].toUpperCase() ?? safeName(projectId);
	const p = safeName(part.trim().toUpperCase() || "AR").replace(/[\s_]+/g, "-");
	return `${code}_${p}_${yymmdd(date)}.ifc`;
}
