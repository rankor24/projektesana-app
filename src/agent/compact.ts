// Compaction: when the conversation gets too big for the model, the older part becomes a summary and the recent part
// stays word for word. Pure apart from the one model call, which is injected (`Complete`), so tests run without a model.
//
// Borrowed from pi coding-agent core/compaction/compaction.ts + utils.ts: cut points only at turn starts (a tool result
// must stay with its tool call); walk back from the newest message until `keepRecentTokens` are kept; the old part is
// serialized to plain text so the summarizer does not continue the conversation; a second pass updates an earlier
// summary (<previous-summary>) instead of summarizing a summary; a summary that stopped on `error` or `length` is
// never accepted. Changed: the prompt is Latvian and keeps what this app's rules need (source ids, pages, quotes,
// the user's corrections, what each screenshot showed); the summary is merged into the first kept user message
// (providers expect alternating roles) and stamped newer than the kept answers, which marks their old `usage` stale.
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, TextContent } from "@earendil-works/pi-ai";
import { estimateMessageTokens } from "./context.js";

/** Asks the model once: system prompt + one user text → its reply. Injected; the app's version streams through pi. */
export type Complete = (model: Model<Api>, system: string, user: string, signal?: AbortSignal) => Promise<AssistantMessage>;

export const SUMMARY_HEADER = "[SARUNAS KOPSAVILKUMS — iepriekšējā saruna saspiesta, lai ietilptu kontekstā]";
const SUMMARY_END = "[KOPSAVILKUMA BEIGAS — tālāk sākas pēdējie ziņojumi burtiski]";

export const SUMMARY_SYSTEM = `Tu esi konteksta kopsavilkuma asistents. Izlasi sarunu starp lietotāju (projektētāju) un aģentu un uzraksti strukturētu kopsavilkumu pēc norādītā formāta.
NEVEDI sarunu tālāk un neatbildi uz jautājumiem sarunā. Izvadi TIKAI kopsavilkumu.`;

const FORMAT = `## Mērķis
[Ko lietotājs vēlas panākt; vairākas lietas, ja saruna aptver vairākus uzdevumus.]

## Lietotāja norādes un labojumi
- [Ko lietotājs izlaboja, aizliedza vai lūdza darīt citādi. Tas nav jāatceļ. Vai "(nav)".]

## Padarīts
- [x] [Pabeigtais, ar rezultātu]

## Procesā
- [ ] [Kas tiek darīts tagad]

## Lēmumi
- **[Lēmums]**: [īss pamatojums]

## Avoti un fakti
- [avota id, lappuse, burtisks citāts; Revit elementu id un līmeņi; skaitļi un nosaukumi — tikai tas, kas sarunā tiešām parādījās. Vai "(nav)".]

## Ekrānuzņēmumi un pielikumi
- [katram: nosaukums, ko tas rādīja un ko lietotājs par to teica. Attēli vairs nav kontekstā, tāpēc šeit jāpaliek būtiskajam.]

## Nākamie soļi
1. [Kas jādara tālāk]

Saglabā precīzus avotu id, lappuses, citātus, nosaukumus, numurus, elementu id un kļūdu tekstus. Nekad neizdomā to, kā sarunā nebija; ja nav datu, raksti "nav datu". Raksti tajā valodā, kurā lietotājs galvenokārt raksta. Katra sadaļa — īsa.`;

const FIRST_PROMPT = `Iepriekš ir saruna, kas jāsaspiež kontekstā. Uzraksti kopsavilkumu, ko cits aģents izmantos, lai turpinātu darbu.

Izmanto TIEŠI šo formātu:

${FORMAT}`;

const UPDATE_PROMPT = `Iepriekš ir JAUNI sarunas ziņojumi, kas jāiestrādā esošajā kopsavilkumā (<previous-summary>).
- SAGLABĀ visu esošo informāciju
- PIEVIENO jauno: padarīto, lēmumus, avotus, ekrānuzņēmumus
- ATJAUNO "Procesā" un "Nākamie soļi"; pabeigto pārvieto uz "Padarīts"
- Ja kaut kas vairs nav svarīgs, drīkst izņemt

Izmanto TIEŠI šo formātu:

${FORMAT}`;

// ---- serialization ------------------------------------------------------------------------------------------------

const TOOL_RESULT_MAX = 2000;

type Block = { type: string; text?: string; thinking?: string; name?: string; arguments?: unknown };
const blocks = (c: unknown): Block[] => (Array.isArray(c) ? (c as Block[]) : typeof c === "string" ? [{ type: "text", text: c }] : []);
const role = (m: AgentMessage) => (m as { role: string }).role;
const content = (m: AgentMessage) => blocks((m as { content?: unknown }).content);

const cut = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max)}\n[… vēl ${t.length - max} zīmes]`);

/** Plain text of the messages for the summarizer. Thinking is left out; images become a marker; tool results are cut. */
export function serializeConversation(messages: readonly AgentMessage[]): string {
	const parts: string[] = [];
	for (const m of messages) {
		const r = role(m);
		if (r === "user") {
			const text = content(m).map((b) => (b.type === "image" ? "[attēls]" : (b.text ?? ""))).filter(Boolean).join("\n");
			if (text.trim()) parts.push(`[Lietotājs]: ${text}`);
		} else if (r === "assistant") {
			const text = content(m).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
			const calls = content(m).filter((b) => b.type === "toolCall").map((b) => `${b.name}(${Object.entries((b.arguments ?? {}) as Record<string, unknown>).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})`);
			if (text.trim()) parts.push(`[Aģents]: ${text}`);
			if (calls.length) parts.push(`[Aģenta rīku izsaukumi]: ${calls.join("; ")}`);
		} else if (r === "toolResult") {
			const text = content(m).map((b) => (b.type === "image" ? "[attēls]" : (b.text ?? ""))).join("\n");
			if (text.trim()) parts.push(`[Rīka atbilde]: ${cut(text, TOOL_RESULT_MAX)}`);
		}
	}
	return parts.join("\n\n");
}

// ---- the earlier summary ------------------------------------------------------------------------------------------

/** The summary block at the start of a user message, if this message carries one. */
export function summaryOf(m: AgentMessage): string | null {
	if (role(m) !== "user") return null;
	const first = content(m)[0];
	const t = first?.type === "text" ? (first.text ?? "") : "";
	if (!t.startsWith(SUMMARY_HEADER)) return null;
	const end = t.indexOf(SUMMARY_END);
	return t.slice(SUMMARY_HEADER.length, end < 0 ? undefined : end).trim();
}

/** The message without its summary block (what the user actually sent). */
function withoutSummary(m: AgentMessage): AgentMessage {
	if (summaryOf(m) === null) return m;
	return { ...m, content: content(m).slice(1) } as AgentMessage;
}

// ---- cut point ----------------------------------------------------------------------------------------------------

/**
 * Index of the first message to keep word for word, or null when there is nothing to summarize. A cut is always at the
 * start of a turn (a user message), so a tool call and its result stay together. Leading system messages are never
 * summarized. Walks back from the newest message until `keepRecentTokens` are kept, as pi does.
 */
export function findCut(messages: readonly AgentMessage[], keepRecentTokens: number): number | null {
	const start = messages.findIndex((m) => role(m) !== "system");
	if (start < 0) return null;
	const cuts = messages.map((m, i) => (i > start && role(m) === "user" ? i : -1)).filter((i) => i > 0);
	if (!cuts.length) return null;
	let kept = 0;
	for (let i = messages.length - 1; i > start; i--) {
		kept += estimateMessageTokens(messages[i]);
		if (kept >= keepRecentTokens) return cuts.find((c) => c >= i) ?? cuts[cuts.length - 1];
	}
	// everything fits in the recent part: nothing to summarize
	return null;
}

// ---- the model call -----------------------------------------------------------------------------------------------

/** Summarizes `old` (merging `previous` when there is one). Throws with the reason when the summary cannot be trusted. */
export async function summarize(o: { complete: Complete; model: Model<Api>; old: readonly AgentMessage[]; previous?: string; signal?: AbortSignal; maxInputTokens: number }): Promise<string> {
	let text = serializeConversation(o.old);
	const maxChars = Math.floor(o.maxInputTokens * 3.5);
	if (text.length > maxChars) text = `[… vecākais teksts izlaists, nepietiek vietas]\n${text.slice(text.length - maxChars)}`;
	let prompt = `<conversation>\n${text}\n</conversation>\n\n`;
	if (o.previous) prompt += `<previous-summary>\n${o.previous}\n</previous-summary>\n\n`;
	prompt += o.previous ? UPDATE_PROMPT : FIRST_PROMPT;

	const r = await o.complete(o.model, SUMMARY_SYSTEM, prompt, o.signal);
	if (r.stopReason === "error") throw new Error(`Kopsavilkums neizdevās: ${r.errorMessage || "nezināma kļūda"}`);
	if (r.stopReason === "aborted") throw new Error("Kopsavilkums pārtraukts.");
	if (r.stopReason === "length") throw new Error("Kopsavilkums neizdevās: atbilde pārtrūka (nepietiek izvades limita), nepilns kopsavilkums netiek izmantots.");
	if (r.content.some((b) => b.type === "toolCall")) throw new Error("Kopsavilkums neizdevās: modelis mēģināja izsaukt rīku.");
	const out = r.content.filter((b): b is TextContent => b.type === "text").map((b) => b.text).join("").trim();
	if (!out) throw new Error("Kopsavilkums neizdevās: modelis neatbildēja ar tekstu.");
	return out;
}

// ---- compaction ---------------------------------------------------------------------------------------------------

export interface Compacted {
	messages: AgentMessage[];
	summary: string;
	/** estimated sizes of the messages before and after (the provider's own count is not known for the new list) */
	tokensBefore: number;
	tokensAfter: number;
	/** how many messages became the summary */
	summarized: number;
}

/**
 * The messages with their older part replaced by a summary. Returns null when there is nothing to summarize (one turn,
 * or everything fits in `keepRecentTokens`). Does not touch the input.
 */
export async function compactMessages(messages: readonly AgentMessage[], o: { complete: Complete; model: Model<Api>; keepRecentTokens: number; signal?: AbortSignal; maxInputTokens: number; now?: number }): Promise<Compacted | null> {
	const at = findCut(messages, o.keepRecentTokens);
	if (at === null) return null;
	const start = messages.findIndex((m) => role(m) !== "system");
	const head = messages.slice(0, start);
	const old = messages.slice(start, at);
	const previous = old.map(summaryOf).find((s): s is string => s !== null);
	const summary = await summarize({ complete: o.complete, model: o.model, old: old.map(withoutSummary), previous, signal: o.signal, maxInputTokens: o.maxInputTokens });

	const [first, ...rest] = messages.slice(at);
	const block: TextContent = { type: "text", text: `${SUMMARY_HEADER}\n${summary}\n${SUMMARY_END}` };
	// merged into the first kept user message; stamped newer than every kept answer, which makes their old usage stale
	const merged = { ...first, content: [block, ...content(first)], timestamp: o.now ?? Date.now() } as AgentMessage;
	const out = [...head, merged, ...rest];
	const size = (ms: readonly AgentMessage[]) => ms.reduce((n, m) => n + estimateMessageTokens(m), 0);
	return { messages: out, summary, tokensBefore: size(messages), tokensAfter: size(out), summarized: old.length };
}
