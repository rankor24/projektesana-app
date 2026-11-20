// Fixes applied to the CadCraft copy after scripts/sync-cadcraft.mjs copies it (CadCraft is Apache-2.0; the source checkout is
// never changed). Each patch names the exact text it replaces and fails the sync when that text is gone, so a CadCraft update
// that changes the code is noticed instead of shipping unpatched. Remove a patch once CadCraft has its own fix.
//
// 1. dwg-import.js convert(): one malformed entity stopped the whole DWG ("c[0] is not iterable" from a SOLID with no points,
//    "reading 'x'" from a CIRCLE with no centre; BD424 topo DUN8_RA_TI_00001_01.dwg, 2026-11-20). An entity that cannot be
//    read is now skipped and counted in the import report, like the entities CadCraft already skips. Upstream unfixed at ccd636f.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PATCHES = [
	{
		file: join("app", "dwg-import.js"),
		find: "const c = withProps(tagFromXdata(inPlan(convertBase(e), e), e.xdata), e);",
		replace:
			"let b;   // projektesana patch (scripts/cadcraft-patches.mjs): a malformed entity is skipped, not the whole drawing\n" +
			"    try { b = convertBase(e); } catch { skip(`${e.type}: nav nolasāms`); b = null; }\n" +
			"    const c = withProps(tagFromXdata(inPlan(b, e), e.xdata), e);",
	},
];

/** Applies every patch to the CadCraft copy in `dir`; throws, naming the patch, when its text is not found exactly once. */
export function applyCadcraftPatches(dir) {
	for (const p of PATCHES) {
		const f = join(dir, p.file);
		const raw = readFileSync(f, "utf8");
		const nl = raw.includes("\r\n") ? "\r\n" : "\n";
		const s = raw.replaceAll("\r\n", "\n");
		const n = s.split(p.find).length - 1;
		if (n !== 1) throw new Error(`cadcraft patch for ${p.file}: expected the text once, found ${n} — CadCraft changed; check whether it still needs the fix`);
		writeFileSync(f, s.replace(p.find, p.replace).replaceAll("\n", nl));
	}
	return PATCHES.length;
}
