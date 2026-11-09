// One truth across sources.
// - Address: every source that states the object's address says the same street and number (case, spacing, punctuation,
//   post code and town ignored). A candidate without a house number is not an address ("… nav" in a form field).
// - Cadastral designations and the total area: a project can have several land units and buildings, so they are NOT
//   required to be equal. What the PU / tender (or the user) states must be found in the property documents — a PU that
//   names a designation or an area no property document has is the finding. (Found on a real project, 2026-11-06: the
//   first version compared all designations and flagged a site with 18 buildings.)
import { USER_LABEL } from "../../core/model.js";
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
/** the role of a value the user wrote themself (no document behind it) */
const BY_USER = "Lietotājs";

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
			add(f.key, { value: f.value, norm: normOf(f.key, f.value), sourceId: sid, title: src?.title ?? ("name" in f.source && f.source.name ? f.source.name : USER_LABEL), page: "page" in f.source ? f.source.page : null, role: src?.role ?? BY_USER });
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
		// values with nothing to compare against, gathered into ONE note: the values themselves, where each was read
		const notCompared: { key: string; stated: Seen[] }[] = [];
		for (const [key, seen] of valuesOf(store)) {
			if (key === "profile.address") {
				const distinct = [...new Set(seen.map((s) => s.norm))];
				if (distinct.length < 2) continue;
				results.push({ key, severity: "error", message: `adrese atšķiras avotos: ${seen.map(where).join("; ")}`, where: { sourceId: seen[0].sourceId ?? undefined, page: seen[0].page ?? undefined }, requirementId: reqFor(seen) });
				continue;
			}
			const stated = seen.filter((s) => STATED_BY.has(s.role) || s.role === BY_USER);
			const property = new Set(seen.filter((s) => s.role === PROPERTY).map((s) => s.norm));
			if (!stated.length) continue;
			if (!property.size) {
				notCompared.push({ key, stated });
				continue;
			}
			for (const s of stated) {
				if (property.has(s.norm)) continue;
				results.push({ key: `${key}:${s.norm}`, severity: "error", message: `${KEYS[key]} ${where(s)} nav atrodams īpašuma dokumentos (tajos: ${[...property].slice(0, 6).join(", ")}${property.size > 6 ? " …" : ""})`, where: { sourceId: s.sourceId ?? undefined, page: s.page ?? undefined }, requirementId: reqFor([s]) });
			}
		}
		if (notCompared.length) {
			const anyProperty = store.read("sources").some((s) => s.role === PROPERTY);
			const head = anyProperty ? `Īpašuma dokumentos šīs vērtības nav atrastas, tāpēc nav salīdzinātas` : `Nav neviena avota ar lomu “${PROPERTY}”, tāpēc šīs vērtības nav salīdzinātas (lomu dokumentam var iestatīt panelī Avoti)`;
			const first = notCompared[0].stated[0];
			results.push({ key: "not-compared", severity: "info", message: `${head}: ${notCompared.map(({ key, stated }) => `${KEYS[key]} — ${listValues(stated)}`).join("; ")}`, where: { sourceId: first.sourceId ?? undefined, page: first.page ?? undefined } });
		}
		return { results };
	},
};

/** Each distinct value once, with where it was first read; at most 3, then how many more. */
export function listValues(seen: Seen[], max = 3): string {
	const byNorm = new Map<string, Seen>();
	for (const s of seen) if (!byNorm.has(s.norm)) byNorm.set(s.norm, s);
	const all = [...byNorm.values()];
	return all.slice(0, max).map(where).join(", ") + (all.length > max ? ` un vēl ${all.length - max}` : "");
}
