// PU room programme vs model rooms (task 3.5). The programme is read from a PU (or tender) source whose text has a
// "telpu programma": one row per room type with an optional count and an area, "min." marking a minimum.
// Model rooms are matched by name (folded; one contains the other). Findings: too few rooms of a type (missing), a room
// over the programme area by more than 10 % (oversized), a room under a stated minimum (undersized).
import type { Check, CheckResult } from "../registry.js";

export interface ProgrammeRow {
	name: string;
	count: number;
	area: number;
	minimum: boolean;
	page: number;
	quote: string;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const ROW = /^(?:\d+(?:\.\d+)*\.?\s+)?(\p{L}[\p{L}\s\-/()]*?\p{L}\)?)\s*[–—:\-\t ]\s*(?:(\d{1,3})\s*(?:gab\.?|telp\p{L}*|x)\s*[–—:\-,×\t ]*\s*)?(?:(min\.?|ne\s+mazāk\s+kā|vismaz)\s*)?(?:~\s*)?(\d{1,4}(?:[,.]\d{1,2})?)\s*(?:m2|m²|kv\.\s*m)/iu;

/** The programme rows of the pages after a "telpu programma" heading (or all pages when the heading is on page 1). */
export function programmeRows(pages: string[]): ProgrammeRow[] {
	const out: ProgrammeRow[] = [];
	let on = false;
	pages.forEach((p, i) => {
		for (const raw of p.split("\n")) {
			const line = raw.replace(/\s+/g, " ").trim();
			if (/telpu\s+programm/i.test(line)) {
				on = true;
				continue;
			}
			if (!on) continue;
			const m = ROW.exec(line);
			if (!m) continue;
			out.push({ name: m[1].trim(), count: m[2] ? Number(m[2]) : 1, area: Number(m[4].replace(",", ".")), minimum: !!m[3], page: i + 1, quote: line });
		}
	});
	return out;
}

export function compareProgramme(rows: ProgrammeRow[], model: { number: string; name: string; area: number; id: string }[]): { key: string; kind: "missing" | "oversized" | "undersized"; message: string; id?: string }[] {
	const out: { key: string; kind: "missing" | "oversized" | "undersized"; message: string; id?: string }[] = [];
	for (const r of rows) {
		const n = fold(r.name);
		const mine = model.filter((m) => {
			const x = fold(m.name);
			return x === n || (n.length > 3 && x.length > 3 && (x.includes(n) || n.includes(x)));
		});
		if (mine.length < r.count) out.push({ key: `missing:${n}`, kind: "missing", message: `Programmā “${r.name}” ${r.count} gab., modelī ${mine.length} (lpp. ${r.page})` });
		for (const m of mine) {
			if (r.minimum && m.area < r.area) out.push({ key: `undersized:${m.id}`, kind: "undersized", message: `Telpa ${m.number} “${m.name}”: ${m.area} m² < programmā min. ${r.area} m²`, id: m.id });
			else if (!r.minimum && m.area > r.area * 1.1) out.push({ key: `oversized:${m.id}`, kind: "oversized", message: `Telpa ${m.number} “${m.name}”: ${m.area} m² > programmā ${r.area} m² (+${Math.round((m.area / r.area - 1) * 100)} %)`, id: m.id });
		}
	}
	return out;
}

export const programmeCheck: Check = {
	id: "programme",
	title: "PU telpu programma pret modeli",
	on: ["rooms", "manual"],
	run: ({ store, modelRooms }) => {
		if (!modelRooms) return { results: [], skipped: "nav savienojuma ar Revit" };
		const rows: (ProgrammeRow & { sourceId: string })[] = [];
		const reqs = store.read("requirements");
		for (const s of store.read("sources")) {
			if (s.kind !== "document" || !["PU", "Iepirkums", "Info no pasūtītāja"].includes(s.role)) continue;
			const t = store.readText(s.versions[s.versions.length - 1]?.sha256 ?? "");
			if (t && /telpu\s+programm/i.test(t.pages.join(" "))) rows.push(...programmeRows(t.pages).map((r) => ({ ...r, sourceId: s.id })));
		}
		if (!rows.length) return { results: [], skipped: "PU telpu programma nav atrasta" };
		const results: CheckResult[] = compareProgramme(rows, modelRooms).map((d) => {
			const row = rows.find((r) => d.message.includes(`“${r.name}”`) || d.key.endsWith(fold(r.name)));
			const req = row && reqs.find((q) => q.citation.kind === "document" && q.citation.sourceId === row.sourceId && q.citation.page === row.page);
			return { key: d.key, severity: d.kind === "oversized" ? "warning" : "error", message: d.message, where: { sourceId: row?.sourceId, page: row?.page, elementGuid: d.id }, requirementId: req?.id };
		});
		return { results };
	},
};
