// Deliverable names (office standard): the delivery folder is dated YYMMDD; each file is "<sheet number>_<title>"; no
// diacritics in folder or file names. The finding names the office requirement with its quote from the standard; when the
// standard is not set, the finding says so instead.
import { basename } from "node:path";
import { dateOfFolder } from "../../core/stages.js";
import type { Check, CheckResult } from "../registry.js";

import { DIACRITIC, SHEET_FILE } from "../../shared/rename.js";
export { DIACRITIC, SHEET_FILE };

export const filenameCheck: Check = {
	id: "filenames",
	title: "Nodevumu mapju un failu nosaukumi",
	on: ["delivery", "sources"],
	run: ({ store, deliveryId }) => {
		const reqs = new Map(store.read("requirements").map((r) => [r.id, r]));
		const noStd = reqs.has("office:no-diacritics") ? "" : " (biroja standarts nav norādīts iestatījumos — prasības citāts nav pieejams)";
		const req = (id: string) => (reqs.has(id) ? id : undefined);
		const results: CheckResult[] = [];
		for (const d of store.read("deliveries")) {
			if (deliveryId && d.id !== deliveryId) continue;
			// a delivery being made has no folder yet: its staged files are read, its folder name is not
			if (!d.folder && !d.draft) continue;
			const where = d.folder ?? d.draft!.stagingDir;
			const folder = d.folder ? basename(d.folder) : null;
			if (folder && !dateOfFolder(folder)) results.push({ key: `${d.id}:date`, severity: "error", message: `${d.label}: mapes nosaukumā nav datuma YYMMDD (“${folder}”)${noStd}`, where: { deliveryId: d.id, path: where }, requirementId: req("office:delivery-date") });
			if (folder && DIACRITIC.test(folder)) results.push({ key: `${d.id}:folder-diacritics`, severity: "error", message: `${d.label}: mapes nosaukumā ir garumzīmes vai mīkstinājuma zīmes (“${folder}”)${noStd}`, where: { deliveryId: d.id, path: where }, requirementId: req("office:no-diacritics") });
			// one finding per delivery and rule, with the count and the first names (a real BP had 968 such files)
			const names = d.items.map((it) => basename(it.file));
			const list = (l: string[]) => `${l.slice(0, 5).map((n) => `“${n}”`).join(", ")}${l.length > 5 ? ` un vēl ${l.length - 5}` : ""}`;
			const withDiacritics = names.filter((n) => DIACRITIC.test(n));
			if (withDiacritics.length) results.push({ key: `${d.id}:diacritics`, severity: "error", message: `${d.label}: ${withDiacritics.length} failu nosaukumos ir garumzīmes vai mīkstinājuma zīmes: ${list(withDiacritics)}${noStd}`, where: { deliveryId: d.id, path: where }, requirementId: req("office:no-diacritics") });
			const noSheet = names.filter((n) => !SHEET_FILE.test(n));
			if (noSheet.length) results.push({ key: `${d.id}:pattern`, severity: "warning", message: `${d.label}: ${noSheet.length} no ${names.length} failiem nav formā rasējuma numurs_nosaukums: ${list(noSheet)}${noStd}`, where: { deliveryId: d.id, path: where }, requirementId: req("office:sheet-filenames") });
		}
		return { results };
	},
};
