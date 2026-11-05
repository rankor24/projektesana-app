// What the gather runs did and found: last run per section, and the laws the agent cited for this project.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendLog } from "../../kernel/log.js";
import { normText } from "../files/text.js";
import { Library, type Category } from "../library/library.js";
import type { SectionId } from "./sections.js";

export interface GatherRun {
	section: SectionId;
	at: string;
	ok: boolean;
	/** the agent's closing report */
	summary: string;
	tools: number;
	error?: string;
}

const runsFile = (root: string) => join(root, ".bv", "gather.json");

export function loadRuns(root: string): Partial<Record<SectionId, GatherRun>> {
	return existsSync(runsFile(root)) ? (JSON.parse(readFileSync(runsFile(root), "utf8")) as Partial<Record<SectionId, GatherRun>>) : {};
}

export function saveRun(root: string, run: GatherRun) {
	writeFileSync(runsFile(root), JSON.stringify({ ...loadRuns(root), [run.section]: run }, null, 1), "utf8");
	appendLog(root, { kind: "gather.run", by: "app", data: { section: run.section, ok: run.ok, tools: run.tools, error: run.error ?? null } });
}

// ---- laws the agent cited for this project -------------------------------------

export interface Applicable {
	id: string;
	category: Category;
	sourceId: string;
	title: string;
	url: string | null;
	readOn: string;
	/** verbatim paragraph from the library */
	quote: string;
	/** why it applies to this project */
	why: string;
	by: string;
	confirmed: boolean;
}

const applicableFile = (root: string) => join(root, ".bv", "applicable.json");

export function loadApplicable(root: string): Applicable[] {
	return existsSync(applicableFile(root)) ? (JSON.parse(readFileSync(applicableFile(root), "utf8")) as Applicable[]) : [];
}

const save = (root: string, a: Applicable[]) => writeFileSync(applicableFile(root), JSON.stringify(a, null, 1), "utf8");

/** The quote must be a paragraph (or part of one) of that source in the library; anything else is refused. */
export function addApplicable(root: string, lib: Library, a: { category: Category; sourceId: string; quote: string; why: string }, by: string): Applicable {
	if (!a.why.trim()) throw new Error("Norādi, kāpēc tas attiecas uz šo projektu.");
	const src = lib.list().find((s) => s.id === a.sourceId);
	if (!src) throw new Error(`Bibliotēkā nav avota ${a.sourceId}. Izmanto id no search_sources rezultāta.`);
	if (src.category !== a.category) throw new Error(`Avots ${a.sourceId} ir kategorijā ${src.category}, nevis ${a.category}.`);
	const q = normText(a.quote);
	if (q.length < 20) throw new Error("Citāts ir pārāk īss.");
	if (!lib.paragraphs(src.id).some((p) => normText(p).includes(q))) throw new Error("Citāts nav atrodams šī avota pantos. Citātam jābūt burtiski no search_sources rezultāta.");
	const all = loadApplicable(root);
	const dup = all.find((x) => x.sourceId === src.id && normText(x.quote) === q);
	if (dup) return dup;
	const next = Math.max(0, ...all.map((x) => Number(x.id.slice(1)) || 0)) + 1;
	const x: Applicable = { id: `a${next}`, category: src.category, sourceId: src.id, title: src.title, url: src.url, readOn: src.readOn, quote: a.quote.trim(), why: a.why.trim(), by, confirmed: false };
	save(root, [...all, x]);
	appendLog(root, { kind: "law.cited", by, data: { id: x.id, source: src.id, quote: x.quote, why: x.why } });
	return x;
}

export function confirmApplicable(root: string, id: string): Applicable {
	const all = loadApplicable(root);
	const x = all.find((a) => a.id === id);
	if (!x) throw new Error(`Nav ieraksta ${id}`);
	x.confirmed = true;
	save(root, all);
	appendLog(root, { kind: "law.confirmed", by: "boris", data: { id } });
	return x;
}

export function removeApplicable(root: string, id: string): boolean {
	const all = loadApplicable(root);
	const x = all.find((a) => a.id === id);
	if (!x) throw new Error(`Nav ieraksta ${id}`);
	save(root, all.filter((a) => a.id !== id));
	appendLog(root, { kind: "law.removed", by: "boris", data: { ...x } });
	return true;
}
