// Facts: proposed by the agent or the code with a verified quote, or written by the user; confirmed or rejected by the user only.
// The quote is checked here, against the cached text of the exact page, whoever proposes it.
import { quoteOnPage } from "../sources/extract/common.js";
import { newId, type Fact, type FactSource, type Who } from "./model.js";
import type { ProjectStore } from "./store.js";

export const FACT_KEY = /^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*$/;

export interface ProposeInput {
	key: string;
	value: string;
	source: { sourceId: string; page: number; quote: string };
	by: Who;
}

/** Verifies the quote on the page of the source's latest version; refuses with the reason. */
export function verifyQuote(store: ProjectStore, src: { sourceId: string; page: number; quote: string }): { ok: true; sha: string } | { ok: false; reason: string } {
	const s = store.read("sources").find((x) => x.id === src.sourceId);
	if (!s) return { ok: false, reason: `Avots ${src.sourceId} nav atrasts.` };
	const v = s.versions[s.versions.length - 1];
	if (!v?.sha256) return { ok: false, reason: `Avotam ${s.title} nav nolasīta teksta.` };
	const t = store.readText(v.sha256);
	if (!t) return { ok: false, reason: `Avota ${s.title} teksts nav nolasīts (stāvoklis: ${v.textState}).` };
	const page = t.pages[src.page - 1];
	if (page === undefined) return { ok: false, reason: `Avotam ${s.title} nav lapas ${src.page} (lapas: ${t.pages.length}).` };
	if (!quoteOnPage(page, src.quote)) {
		const elsewhere = t.pages.findIndex((p) => quoteOnPage(p, src.quote));
		return { ok: false, reason: elsewhere >= 0 ? `Citāts nav ${src.page}. lapā; tas ir ${elsewhere + 1}. lapā.` : `Citāts nav atrodams avotā ${s.title} (burtiski, atstarpes neskaitot).` };
	}
	return { ok: true, sha: v.sha256 };
}

export function proposeFact(store: ProjectStore, f: ProposeInput, now = new Date()): Fact {
	if (!FACT_KEY.test(f.key)) throw new Error(`Nederīga fakta atslēga: ${f.key}`);
	if (!f.value.trim()) throw new Error("Tukša vērtība.");
	const v = verifyQuote(store, f.source);
	if (!v.ok) throw new Error(v.reason);
	const source: FactSource = { sourceId: f.source.sourceId, sha: v.sha, page: f.source.page, quote: f.source.quote.replace(/\s+/g, " ").trim() };
	const all = store.read("facts");
	// the same value from the same place is one fact
	const same = all.find((x) => x.key === f.key && x.value === f.value.trim() && "sourceId" in x.source && x.source.sourceId === source.sourceId && x.source.page === source.page);
	if (same) return same;
	const fact: Fact = { id: newId("f"), key: f.key, value: f.value.trim(), source, state: "proposed", by: f.by, at: now.toISOString() };
	store.write("facts", [...all, fact], { kind: "fact.proposed", by: f.by, data: { id: fact.id, key: fact.key } });
	return fact;
}

/** The user states a fact (no document says it): confirmed at once; the source is the user, with their name if set. */
export function userFact(store: ProjectStore, key: string, value: string, name?: string, now = new Date()): Fact {
	if (!FACT_KEY.test(key)) throw new Error(`Nederīga fakta atslēga: ${key}`);
	const fact: Fact = { id: newId("f"), key, value: value.trim(), source: { kind: "user", at: now.toISOString(), ...(name ? { name } : {}) }, state: "confirmed", by: "user", at: now.toISOString() };
	store.update("facts", (all) => [...all, fact], { kind: "fact.user", by: "user", data: { id: fact.id, key } });
	return fact;
}

/** Only the user decides. Confirming one value of a key rejects the other proposed values of the same key. */
export function decideFact(store: ProjectStore, factId: string, state: "confirmed" | "rejected"): void {
	store.update(
		"facts",
		(all) => {
			const f = all.find((x) => x.id === factId);
			if (!f) throw new Error(`Fakts ${factId} nav atrasts.`);
			return all.map((x) => {
				if (x.id === factId) return { ...x, state };
				if (state === "confirmed" && x.key === f.key && x.state === "proposed" && x.value !== f.value && !x.key.startsWith("profile.sections") && !x.key.startsWith("profile.stagesInContract")) return { ...x, state: "rejected" as const };
				return x;
			});
		},
		{ kind: `fact.${state}`, by: "user", data: { id: factId } },
	);
}
