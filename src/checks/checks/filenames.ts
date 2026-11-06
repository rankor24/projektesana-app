// Deliverable names (office standard): the delivery folder is dated YYMMDD; each file is "<sheet number>_<title>"; no
// diacritics in folder or file names. The finding names the office requirement with its quote from the standard; when the
// standard is not set, the finding says so instead.
import { basename } from "node:path";
import { dateOfFolder } from "../../core/stages.js";
import type { Check, CheckResult } from "../registry.js";

export const SHEET_FILE = /^[A-Z]{1,5}[A-Z0-9]{0,3}[-_ ]?\d+(?:[.\-]\d+)*[a-z]?_[^_].*\.\w+$/i;
export const DIACRITIC = /[^\x00-\x7F]/;

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
			if (!d.folder) continue;
			const folder = basename(d.folder);
			if (!dateOfFolder(folder)) results.push({ key: `${d.id}:date`, severity: "error", message: `${d.label}: mapes nosaukumā nav datuma YYMMDD (“${folder}”)${noStd}`, where: { deliveryId: d.id, path: d.folder }, requirementId: req("office:delivery-date") });
			if (DIACRITIC.test(folder)) results.push({ key: `${d.id}:folder-diacritics`, severity: "error", message: `${d.label}: mapes nosaukumā ir garumzīmes vai mīkstinājuma zīmes (“${folder}”)${noStd}`, where: { deliveryId: d.id, path: d.folder }, requirementId: req("office:no-diacritics") });
			for (const it of d.items) {
				const name = basename(it.file);
				if (DIACRITIC.test(name)) results.push({ key: `${d.id}:${name}:diacritics`, severity: "error", message: `${d.label}: “${name}” — nosaukumā ir garumzīmes vai mīkstinājuma zīmes${noStd}`, where: { deliveryId: d.id, path: it.file }, requirementId: req("office:no-diacritics") });
				if (!SHEET_FILE.test(name)) results.push({ key: `${d.id}:${name}:pattern`, severity: "warning", message: `${d.label}: “${name}” — nav formā rasējuma numurs_nosaukums${noStd}`, where: { deliveryId: d.id, path: it.file }, requirementId: req("office:sheet-filenames") });
			}
		}
		return { results };
	},
};
