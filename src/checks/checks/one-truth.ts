// One truth: the address, the cadastral designations and the areas say the same in every source (PU, property
// documents, TN, permit, …) and in the confirmed facts. Values are compared after normalising case, spacing,
// punctuation and the post code; every differing value is listed with its source and page.
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

/** Street and number only: "Testa iela 1, Izdomāti, LV-0000" → "testa iela 1". */
export function normAddress(s: string): string {
	return s
		.split(",")[0]
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\bLV-?\d{4}\b/gi, "")
		.replace(/[.„"“”]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

const normOf = (key: string, v: string) => (key === "profile.address" ? normAddress(v) : key === "profile.totalAreaM2" ? String(Math.round(Number(v) * 10) / 10) : v.replace(/\s/g, ""));

export interface Seen {
	value: string;
	norm: string;
	sourceId: string | null;
	title: string;
	page: number | null;
}

export function valuesOf(store: ProjectStore): Map<string, Seen[]> {
	const out = new Map<string, Seen[]>();
	const add = (key: string, s: Seen) => {
		if (!(key in KEYS)) return;
		const l = out.get(key) ?? [];
		if (!l.some((x) => x.norm === s.norm && x.sourceId === s.sourceId)) l.push(s);
		out.set(key, l);
	};
	const sources = store.read("sources");
	for (const s of sources) {
		const v = s.versions[s.versions.length - 1];
		const t = v?.sha256 ? store.readText(v.sha256) : null;
		if (!t || s.kind !== "document") continue;
		// the PU extractor reads the address; the cadastral extractor reads designations and areas in any document
		const cands = [...(s.role === "PU" || s.role === "Iepirkums" ? extractPu(t.pages) : []), ...extractCadastral(t.pages), ...extractPu(t.pages).filter((c) => c.key === "profile.address")];
		for (const c of cands) add(c.key, { value: c.value, norm: normOf(c.key, c.value), sourceId: s.id, title: s.title, page: c.page });
	}
	for (const f of store.read("facts")) if (f.state === "confirmed") add(f.key, { value: f.value, norm: normOf(f.key, f.value), sourceId: "sourceId" in f.source ? f.source.sourceId : null, title: "sourceId" in f.source ? (sources.find((x) => x.id === (f.source as { sourceId: string }).sourceId)?.title ?? "") : "Boris", page: "page" in f.source ? f.source.page : null });
	return out;
}

export const oneTruthCheck: Check = {
	id: "one-truth",
	title: "Viena patiesība visos avotos",
	on: ["sources", "facts", "roles"],
	run: ({ store }) => {
		const results: CheckResult[] = [];
		const reqs = store.read("requirements");
		for (const [key, seen] of valuesOf(store)) {
			const distinct = [...new Set(seen.map((s) => s.norm))];
			if (distinct.length < 2) continue;
			const list = seen.map((s) => `“${s.value}” (${s.title}${s.page ? `, lpp. ${s.page}` : ""})`).join("; ");
			// the requirement row that states one of these values (e.g. the PU row with the address) is the one it concerns
			const req = reqs.find((r) => r.origin !== "law" && seen.some((s) => r.citation.quote.includes(s.value)));
			results.push({ key, severity: "error", message: `${KEYS[key]} atšķiras avotos: ${list}`, where: { sourceId: seen[0].sourceId ?? undefined, page: seen[0].page ?? undefined }, requirementId: req?.id });
		}
		return { results };
	},
};
