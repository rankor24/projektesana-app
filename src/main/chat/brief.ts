// Project brief (spec §7): every fact carries its source — a verbatim quote from a registered file,
// or a verbatim quote of something Boris wrote in the setup chat. Code checks both; a fact without a verified quote is refused.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { checkRead } from "../../kernel/guard.js";
import { appendLog } from "../../kernel/log.js";
import { loadFiles } from "../../kernel/files.js";
import { normText } from "../files/text.js";
import { cachedText } from "../gather/scan.js";
import { checklistFor, type ChecklistItem } from "../rules/checklist.js";
import { groupOf, procedureOf, type Facts, type Procedure } from "../rules/engine.js";
import type { Rule } from "../rules/types.js";

export type Source =
	| { kind: "file"; path: string; quote: string }
	| { kind: "boris"; quote: string; at: string }
	| { kind: "unknown"; quote: string; at: string }
	/** computed by the rules engine from the other facts; `rules` are the rule ids, `quote` the first rule's verbatim text */
	| { kind: "rules"; rules: string[]; quote: string };

export interface Fact {
	value: string;
	source: Source;
	/** who wrote it: `agent:pi`, `boris`, `app` */
	by?: string;
	/** when Boris confirmed a fact the agent read from a file */
	confirmedAt?: string;
}

/**
 * proposed  = read by the agent from a file, Boris has not looked yet
 * confirmed = Boris said it, or Boris clicked "pareizi"; computed answers count once every input they rest on is confirmed
 * unknown   = Boris said he does not know
 */
export type FactState = "proposed" | "confirmed" | "unknown";

export function factState(b: Brief, f: Fact): FactState {
	switch (f.source.kind) {
		case "unknown":
			return "unknown";
		case "boris":
			return "confirmed";
		case "file":
			return f.confirmedAt ? "confirmed" : "proposed";
		case "rules":
			return Object.entries(b.facts).every(([id, x]) => !id.startsWith("engine.") || factState(b, x) !== "proposed") ? "confirmed" : "proposed";
	}
}

export interface Brief {
	facts: Record<string, Fact>;
	/** inputs of the rules engine; each also has a source in `facts` under `engine.<key>` */
	engine: Partial<Facts>;
}

const briefFile = (root: string) => join(root, ".bv", "brief.json");
const chatFile = (root: string) => join(root, ".bv", "chat.jsonl");

export function loadBrief(root: string): Brief {
	return existsSync(briefFile(root)) ? (JSON.parse(readFileSync(briefFile(root), "utf8")) as Brief) : { facts: {}, engine: {} };
}

// ---- chat transcript (what Boris actually wrote) -----------------------------

export function appendChat(root: string, role: "boris" | "agent", text: string, now = new Date()) {
	appendFileSync(chatFile(root), JSON.stringify({ at: now.toISOString(), role, text }) + "\n", "utf8");
}

export function readChat(root: string): { at: string; role: "boris" | "agent"; text: string }[] {
	if (!existsSync(chatFile(root))) return [];
	return readFileSync(chatFile(root), "utf8")
		.split("\n")
		.filter(Boolean)
		.flatMap((l) => {
			try {
				return [JSON.parse(l)];
			} catch {
				return [];
			}
		});
}

// ---- engine fact keys --------------------------------------------------------

const NUM_KEYS = ["floorsAbove", "floorsBelow", "footprintM2", "totalAreaM2", "fireLoadMJ", "documentedGroup"] as const;
const BOOL_KEYS = ["seasonal", "publicFunded", "specialGroup3"] as const;
const STR_KEYS = ["work", "use"] as const;
export const ENGINE_KEYS: readonly string[] = [...NUM_KEYS, ...BOOL_KEYS, ...STR_KEYS];

function parseEngine(key: string, raw: string): Partial<Facts> {
	if ((NUM_KEYS as readonly string[]).includes(key)) {
		const n = Number(raw.replace(",", "."));
		if (!Number.isFinite(n)) throw new Error(`${key}: "${raw}" nav skaitlis.`);
		return { [key]: n };
	}
	if ((BOOL_KEYS as readonly string[]).includes(key)) {
		if (!/^(true|false)$/i.test(raw)) throw new Error(`${key}: gaidīts true/false.`);
		return { [key]: /^true$/i.test(raw) };
	}
	const allowed = key === "work" ? WORKS : USES;
	if (!(allowed as readonly string[]).includes(raw)) throw new Error(`${key}: „${raw}” nav atļauta vērtība. Atļautas: ${allowed.join(", ")}.`);
	return { [key]: raw };
}

const WORKS: readonly string[] = ["new_build", "reconstruction", "simple_reconstruction", "renovation", "simplified_renovation", "use_change", "demolition"];
const USES: readonly string[] = ["residential_1_2", "residential_other", "public", "production", "warehouse", "auxiliary", "agricultural", "other"];
export const ENGINE_CHOICES: Record<string, readonly string[]> = { work: WORKS, use: USES };

// ---- verification ------------------------------------------------------------

async function verifySource(root: string, s: Source): Promise<void> {
	if (s.kind === "rules") throw new Error("Aprēķinātus faktus raksta tikai lietotne pati.");
	if (!s.quote.trim()) throw new Error("Citāts ir tukšs.");
	if (s.kind === "file") {
		const registered = loadFiles(root).some((f) => f.path === s.path.split("\\").join("/"));
		if (!registered) throw new Error(`Fails nav reģistrēts projektā: ${s.path}`);
		const g = checkRead({ root }, s.path);
		if (!g.ok) throw new Error(g.reason);
		const text = normText(await cachedText(root, relative(root, g.path)));
		if (!text.includes(normText(s.quote))) throw new Error(`Citāts nav atrodams failā ${s.path}. Citātam jābūt burtiski no faila.`);
	} else {
		const said = readChat(root).some((m) => m.role === "boris" && normText(m.text).includes(normText(s.quote)));
		if (!said) throw new Error("Boriss čatā to nav rakstījis. Citātam jābūt burtiski no viņa ziņas.");
	}
}

/** Writes one fact. `engine.<key>` also updates the rules-engine inputs. */
export async function setFact(root: string, id: string, value: string, source: Source, by: string): Promise<Brief> {
	const b = loadBrief(root);
	const isEngine = id.startsWith("engine.");
	if (isEngine && !ENGINE_KEYS.includes(id.slice(7))) throw new Error(`Nezināma atslēga ${id}.`);
	if (!isEngine && !KNOWN_IDS.has(id)) throw new Error(`Nezināms kontrolsaraksta punkts ${id}.`);
	if (!value.trim()) throw new Error("Vērtība ir tukša.");
	await verifySource(root, source);
	if (isEngine) b.engine = { ...b.engine, ...parseEngine(id.slice(7), value.trim()) };
	b.facts[id] = { value: value.trim(), source, by };
	writeFileSync(briefFile(root), JSON.stringify(b, null, 1), "utf8");
	appendLog(root, { kind: "brief.fact", by, data: { id, value: value.trim(), source } });
	return b;
}

function saveBrief(root: string, b: Brief) {
	writeFileSync(briefFile(root), JSON.stringify(b, null, 1), "utf8");
}

/** Boris looked at a fact the agent read from a file and says it is right. */
export function confirmFact(root: string, id: string): Brief {
	const b = loadBrief(root);
	const f = b.facts[id];
	if (!f) throw new Error(`Nav fakta ${id}.`);
	f.confirmedAt = new Date().toISOString();
	saveBrief(root, b);
	appendLog(root, { kind: "brief.fact.confirmed", by: "boris", data: { id, value: f.value } });
	return b;
}

/** Boris says the agent's fact is wrong: it goes back to open. The log keeps what was there. */
export function rejectFact(root: string, id: string): Brief {
	const b = loadBrief(root);
	const f = b.facts[id];
	if (!f) throw new Error(`Nav fakta ${id}.`);
	delete b.facts[id];
	if (id.startsWith("engine.")) delete (b.engine as Record<string, unknown>)[id.slice(7)];
	saveBrief(root, b);
	appendLog(root, { kind: "brief.fact.rejected", by: "boris", data: { id, value: f.value, source: f.source } });
	return b;
}

/**
 * Boris types the right value. What he typed is written into the chat transcript as his own message, and that
 * message is the fact's source, so the same rule holds: every fact has words behind it.
 */
export async function editFact(root: string, id: string, value: string, label: string, now = new Date()): Promise<Brief> {
	const v = value.trim();
	if (!v) throw new Error("Vērtība ir tukša.");
	if (id.startsWith("engine.")) parseEngine(id.slice(7), v); // refuse before anything is written
	appendChat(root, "boris", `Labojums — ${label}: ${v}`, now);
	return setFact(root, id, v, { kind: "boris", quote: v, at: now.toISOString() }, "boris");
}

/**
 * Group and procedure are not read from documents: the rules engine computes them from the building facts.
 * They are written with the rule ids and the first rule's verbatim text as their source, and only when the inputs exist.
 */
export function deriveFacts(root: string, rules: Rule[]): Brief {
	const b = loadBrief(root);
	if (!b.engine.work || !b.engine.use) return b;
	const f = b.engine as Facts;
	const cite = (ids: string[]) => ids.flatMap((id) => rules.filter((r) => r.id === id));
	const g = groupOf(f);
	const p = procedureOf(f);
	const put = (id: string, value: string, ids: string[]) => {
		const first = cite(ids)[0];
		const prev = b.facts[id];
		// a person's own answer is never replaced by a computed one
		if (prev && prev.source.kind !== "rules") return;
		const next: Fact = { value, source: { kind: "rules", rules: ids, quote: first?.quote ?? "" }, by: "app" };
		if (prev && prev.value === value && JSON.stringify(prev.source) === JSON.stringify(next.source)) return;
		b.facts[id] = next;
		appendLog(root, { kind: "brief.fact", by: "app", data: { id, value, source: next.source } });
	};
	put("group", `${g.value}. grupa${g.check.length ? ` (pārbaudi: ${g.check.join(" ")})` : ""}`, g.because);
	put("procedure", `${PROCEDURE_LABEL[p.value]}${p.check.length ? ` (pārbaudi: ${p.check.join(" ")})` : ""}`, p.because);
	saveBrief(root, b);
	return b;
}

export const PROCEDURE_LABEL: Record<Procedure, string> = {
	pazinojums: "paziņojums par būvniecību",
	paskaidrojuma_raksts: "paskaidrojuma raksts",
	mbp_buvatlauja: "būvprojekts minimālā sastāvā (MBP) un būvatļauja",
};

/** Only with a quote of Boris saying he does not know. */
export async function markUnknown(root: string, id: string, borisQuote: string, by: string): Promise<Brief> {
	const at = new Date().toISOString();
	return setFact(root, id, "nezināms", { kind: "unknown", quote: borisQuote, at }, by);
}

export const KNOWN_IDS = new Set(checklistFor({ work: "new_build", use: "public", publicFunded: true, floorsAbove: 7 }).map((i) => i.id).concat(["phases", "bim"]));

// ---- completeness ------------------------------------------------------------

/** `proposed`: the agent read it from a file and Boris has not confirmed it yet. */
export type ItemStatus = "filled" | "proposed" | "unknown" | "open";

export interface Completeness {
	items: (ChecklistItem & { status: ItemStatus; fact?: Fact })[];
	complete: boolean;
	/** why the checklist could not be built yet */
	blocked: string | null;
}

export function completeness(root: string): Completeness {
	const b = loadBrief(root);
	if (!b.engine.work || !b.engine.use) return { items: [], complete: false, blocked: "Vispirms jānoskaidro darbu veids un ēkas lietojums (engine.work, engine.use)." };
	const list = checklistFor(b.engine as Facts & Pick<Facts, "work" | "use">);
	const items = list.map((it) => {
		const fact = b.facts[it.id];
		const st = fact ? factState(b, fact) : null;
		const status: ItemStatus = !fact ? "open" : st === "unknown" ? "unknown" : st === "proposed" ? "proposed" : "filled";
		return { ...it, status, fact };
	});
	const engineProposed = Object.entries(b.facts).some(([id, x]) => id.startsWith("engine.") && factState(b, x) === "proposed");
	return { items, complete: !engineProposed && items.filter((i) => i.required).every((i) => i.status !== "open" && i.status !== "proposed"), blocked: null };
}
