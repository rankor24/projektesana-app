// Completeness per delivery: every law requirement for the delivery's kind (MBP: MK 529 26; BP: 71/72, 73, 74, 74.1,
// 75.1, 76–80 by profile) must be covered by a sheet or file of the delivery. Coverage is read from the sheet titles and
// file names; a requirement whose condition the profile does not know is a warning, not an error.
import type { Delivery, Requirement } from "../../core/model.js";
import type { Check, CheckResult } from "../registry.js";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-.]+/g, " ");

/** Requirement item (folded) → what a covering sheet title or file name looks like (folded). */
const COVERAGE: [RegExp, RegExp][] = [
	[/generalplan/, /generalplan|\bgp\b|gp ?\d|situacijas plan/],
	[/jumta un stavu plani|stavu plani/, /stava plans|stavu plan|\d ?stava|\bplans\b/],
	[/jumta plans/, /jumta plan/],
	[/fasad/, /fasad/],
	[/griezum/, /griezum/],
	[/skaidroj\w* apraksts/,/apraksts|skaidroj|\bsa\b/],
	[/specifikacij/, /specifik/],
	[/mezgl/, /mezgl/],
	[/informacijas modelis/, /\bifc\b/],
	[/kartam/, /kart/],
	[/tehnologisk/, /tehnolog/],
	[/ekonomisk/, /tame|apjom|kopsavilk|ekonomisk/],
	[/energoefektivit/, /energo/],
	[/dop|darbu organiz/, /\bdop\b|darbu organiz/],
	[/planotajam izmainam/, /izmain|demontaz|esos/],
];

export function covering(req: Requirement, d: Delivery): string[] {
	const item = fold(req.text.replace(/\s*\(attiecas, ja:.*$/, ""));
	// a format rule (LBN 202-18: documents in PDF) is met only when every file of the delivery is a PDF
	if (/\bpdf\b/.test(item)) return d.items.length && d.items.every((i) => /\.pdf$/i.test(i.file)) ? d.items.map((i) => i.file) : [];
	const rule = COVERAGE.find(([r]) => r.test(item));
	if (!rule) return [];
	return d.items.filter((i) => rule[1].test(fold(`${i.sheetNo ?? ""} ${i.title} ${i.file}`))).map((i) => i.file);
}

export function completenessOf(reqs: Requirement[], d: Delivery): { results: CheckResult[]; met: string[] } {
	const results: CheckResult[] = [];
	const met: string[] = [];
	for (const r of reqs) {
		if (r.origin !== "law" || r.state === "rejected" || !r.appliesTo.deliveries?.includes(d.kind) || r.status === "justified") continue;
		const cite = r.citation.kind === "law" ? `${r.citation.act} ${r.citation.point}` : "";
		if (covering(r, d).length) met.push(r.id);
		else {
			const conditional = /attiecas, ja:/.test(r.text);
			results.push({
				key: `${d.id}:${r.id}`,
				severity: conditional ? "warning" : "error",
				message: `${d.label}: nav atrasts “${r.text}” (${cite})${conditional ? " — pārbaudi, vai attiecas" : ""}`,
				where: { deliveryId: d.id },
				requirementId: r.id,
			});
		}
	}
	return { results, met };
}

export const completenessCheck: Check = {
	id: "completeness",
	title: "Nodevuma pilnība pēc likuma",
	on: ["delivery", "requirements", "facts"],
	run: ({ store, deliveryId }) => {
		const reqs = store.read("requirements");
		const deliveries = store.read("deliveries").filter((d) => (deliveryId ? d.id === deliveryId : !d.sent) && (d.kind === "MBP" || d.kind === "BP") && d.items.length);
		const out = { results: [] as CheckResult[], met: [] as string[] };
		for (const d of deliveries) {
			const r = completenessOf(reqs, d);
			out.results.push(...r.results);
			out.met.push(...r.met);
		}
		return out;
	},
};
