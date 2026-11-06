// One truth across sources.
// - Address: every source that states the object's address says the same street and number (case, spacing, punctuation,
//   post code and town ignored). A candidate without a house number is not an address ("… nav" in a form field).
// - Cadastral designations and the total area: a project can have several land units and buildings, so they are NOT
//   required to be equal. What the PU / tender (or Boris) states must be found in the property documents — a PU that
//   names a designation or an area no property document has is the finding. (Found on a real project, 2026-11-06: the
//   first version compared all designations and flagged a site with 18 buildings.)
import type { CheckResult, Check } from "../registry.js";
import type { ProjectStore } from "../../core/store.js";
import { extractCadastral } from "../../sources/extract/cadastral.js";
import { extractPu } from "../../sources/extract/pu.js";

const KEYS: Record<string, string> = {
	"profile.address": "adrese",
	"profile.cadastralNo": "zemes kadastra apzīmējums",
	"cadastral.building": "būves kadastra apzīmējums",
	"profile.totalAreaM2": "kopējā platība",
};

const STATED_BY = new Set(["PU", "Iepirkums", "Info no pasūtītāja"]);
const PROPERTY = "Īpašuma dokumenti";

/** Street and number only: "…Testa iela 1, Izdomāti, LV-0000" → "testa iela 1". */
export function normAddress(s: string): string {
	return s
		.split(",")[0]
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\bLV-?\d{4}\b/gi, "")
		.replace(/[.„"“”…]/g, "")
		.replace(/^[^a-z0-9]+/, "")
		.replace(/\s+/g, " ")
		.trim();
}

export const isAddress = (v: string) => /\d/.test(normAddress(v)) && /\p{L}{3,}/u.test(normAddress(v));

const normOf = (key: string, v: string) => (key === "profile.address" ? normAddress(v) : key === "profile.totalAreaM2" ? String(Math.round(Number(v) * 10) / 10) : v.replace(/\s/g, ""));

export interface Seen {
	value: string;
	norm: string;
	sourceId: string | null;
	title: string;
	page: number | null;
	role: string;
}

export function valuesOf(store: ProjectStore): Map<string, Seen[]> {
	const out = new Map<string, Seen[]>();
	const add = (key: string, s: Seen) => {
		if (!(key in KEYS)) return;
		if (key === "profile.address" && !isAddress(s.value)) return;
		const l = out.get(key) ?? [];
		if (!l.some((x) => x.norm === s.norm && x.sourceId === s.sourceId)) l.push(s);
		out.set(key, l);
	};
	const sources = store.read("sources");
	for (const s of sources) {
		const v = s.versions[s.versions.length - 1];
		const t = v?.sha256 ? store.readText(v.sha256) : null;
		if (!t || s.kind !== "document") continue;
		const cands = [...(STATED_BY.has(s.role) ? extractPu(t.pages) : extractPu(t.pages).filter((c) => c.key === "profile.address")), ...extractCadastral(t.pages)];
		for (const c of cands) add(c.key, { value: c.value, norm: normOf(c.key, c.value), sourceId: s.id, title: s.title, page: c.page, role: s.role });
	}
	for (const f of store.read("facts"))
		if (f.state === "confirmed") {
			const sid = "sourceId" in f.source ? f.source.sourceId : null;
			const src = sid ? sources.find((x) => x.id === sid) : null;
			add(f.key, { value: f.value, norm: normOf(f.key, f.value), sourceId: sid, title: src?.title ?? "Boris", page: "page" in f.source ? f.source.page : null, role: src?.role ?? "Boris" });
		}
	return out;
}

const where = (s: Seen) => `“${s.value}” (${s.title}${s.page ? `, lpp. ${s.page}` : ""})`;

export const oneTruthCheck: Check = {
	id: "one-truth",
	title: "Viena patiesība visos avotos",
	on: ["sources", "facts", "roles"],
	run: ({ store }) => {
		const results: CheckResult[] = [];
		const reqs = store.read("requirements");
		const reqFor = (seen: Seen[]) => reqs.find((r) => r.origin !== "law" && seen.some((s) => r.citation.quote.includes(s.value)))?.id;
		for (const [key, seen] of valuesOf(store)) {
			if (key === "profile.address") {
				const distinct = [...new Set(seen.map((s) => s.norm))];
				if (distinct.length < 2) continue;
				results.push({ key, severity: "error", message: `adrese atšķiras avotos: ${seen.map(where).join("; ")}`, where: { sourceId: seen[0].sourceId ?? undefined, page: seen[0].page ?? undefined }, requirementId: reqFor(seen) });
				continue;
			}
			const stated = seen.filter((s) => STATED_BY.has(s.role) || s.role === "Boris");
			const property = new Set(seen.filter((s) => s.role === PROPERTY).map((s) => s.norm));
			if (!stated.length) continue;
			if (!property.size) {
				const n = new Set(stated.map((s) => s.norm)).size;
				results.push({ key: `${key}:no-property`, severity: "info", message: `${KEYS[key]}: PU/Boris nosauc ${n}, bet avotos nav īpašuma dokumentu (lomā “${PROPERTY}”) — nav ar ko salīdzināt`, where: { sourceId: stated[0].sourceId ?? undefined, page: stated[0].page ?? undefined } });
				continue;
			}
			for (const s of stated) {
				if (property.has(s.norm)) continue;
				results.push({ key: `${key}:${s.norm}`, severity: "error", message: `${KEYS[key]} ${where(s)} nav atrodams īpašuma dokumentos (tajos: ${[...property].slice(0, 6).join(", ")}${property.size > 6 ? " …" : ""})`, where: { sourceId: s.sourceId ?? undefined, page: s.page ?? undefined }, requirementId: reqFor([s]) });
			}
		}
		return { results };
	},
};
