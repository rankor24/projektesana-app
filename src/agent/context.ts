// What is in the model's context, and the cheap ways to keep it small: token estimates, the limits a model states for
// images, dropping old screenshots, trimming old tool results. Pure functions over pi's AgentMessage[]; no I/O.
//
// Borrowed from pi: pi-ai utils/estimate.ts (estimateContextTokens: the last assistant `usage` is the real size of
// the prompt it answered, only what came after is estimated; usage older than the newest "prefix" message, such as a
// compaction summary, is stale and ignored; 3.5 chars per token; an image counts 4800 chars) and
// coding-agent core/compaction/compaction.ts (the compaction threshold idea). Why the copy: pi-ai does not export
// its estimator from the package root.
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, ImageContent, Model, TextContent, Usage } from "@earendil-works/pi-ai";

import { CHARS_PER_TOKEN, estimateTextTokens, IMAGE_TOKENS } from "../shared/tokens.js";
// pi's flat estimate for one image; real cost is about 0.8–1.6K tokens for a 2000 px screenshot depending on the provider
export { estimateTextTokens, IMAGE_TOKENS };

/** Compaction starts at this much context: 80% of the window, never above 200K (quality and cost drop long before the hard limit). */
export const COMPACT_CAP = 200_000;
export const COMPACT_RATIO = 0.8;
export const compactLine = (contextWindow: number) => Math.min(COMPACT_CAP, Math.floor(contextWindow * COMPACT_RATIO));

// ---- limits the model states --------------------------------------------------------------------------------------

export interface ImageLimits {
	/** longest side in pixels */
	maxEdge: number;
	maxBytes: number;
	/** images the provider takes in one request; null = not stated */
	maxPerRequest: number | null;
	/** whole request body in bytes (images are base64 in it); null = not stated */
	maxRequestBytes: number | null;
}

/** Used when the catalog states nothing: what every vision model in pi's catalog states (2000 px, 4.5 MB). */
export const DEFAULT_IMAGE_LIMITS: ImageLimits = { maxEdge: 2000, maxBytes: 4_718_592, maxPerRequest: null, maxRequestBytes: null };

/** The model's own image limits (pi's `inputLimits`), or null when it takes no images. */
export function imageLimits(model: Pick<Model<Api>, "input" | "inputLimits">): ImageLimits | null {
	if (!model.input.includes("image")) return null;
	const il = model.inputLimits;
	const r = il?.images?.resize;
	return {
		maxEdge: Math.min(r?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxEdge, r?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxEdge),
		maxBytes: r?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
		maxPerRequest: il?.images?.maxPerRequest ?? null,
		maxRequestBytes: il?.maxRequestBytes ?? null,
	};
}

// ---- estimates ----------------------------------------------------------------------------------------------------

type Block = TextContent | ImageContent | { type: string; [k: string]: unknown };
const blocksOf = (content: unknown): Block[] => (Array.isArray(content) ? (content as Block[]) : typeof content === "string" ? [{ type: "text", text: content }] : []);
const textOf = (b: Block) => (b.type === "text" ? String((b as TextContent).text ?? "") : "");

/** Tokens of one message by size alone. System messages count their tool declarations too. */
export function estimateMessageTokens(m: AgentMessage): number {
	const msg = m as { role: string; content?: unknown; toolsAdded?: unknown; sections?: Record<string, string | null> };
	if (msg.role === "system") {
		let chars = blocksOf(msg.content).reduce((n, b) => n + textOf(b).length, 0);
		for (const s of Object.values(msg.sections ?? {})) chars += s?.length ?? 0;
		if (msg.toolsAdded) chars += JSON.stringify(msg.toolsAdded).length;
		return Math.ceil(chars / CHARS_PER_TOKEN);
	}
	if (msg.role === "user" || msg.role === "toolResult") {
		return blocksOf(msg.content).reduce((n, b) => n + (b.type === "image" ? IMAGE_TOKENS : estimateTextTokens(textOf(b))), 0);
	}
	if (msg.role === "assistant") {
		let chars = 0;
		for (const b of blocksOf(msg.content) as { type: string; text?: string; thinking?: string; name?: string; arguments?: unknown }[]) {
			if (b.type === "text") chars += b.text?.length ?? 0;
			else if (b.type === "thinking") chars += b.thinking?.length ?? 0;
			else if (b.type === "toolCall") chars += (b.name?.length ?? 0) + JSON.stringify(b.arguments ?? {}).length;
		}
		return Math.ceil(chars / CHARS_PER_TOKEN);
	}
	return 0;
}

const usageTokens = (u: Usage) => u.totalTokens || u.input + u.output + u.cacheRead + u.cacheWrite;

export interface ContextEstimate {
	tokens: number;
	/** where the number comes from: the provider's own count of the last prompt (+ an estimate of what followed), or sizes alone */
	source: "usage" | "estimate";
	/** the part after the last provider count, estimated */
	trailing: number;
}

/**
 * The size of the context the next request would carry. A provider-reported `usage` is exact for the prompt it answered,
 * but only if nothing was inserted before that answer since (a compaction summary, a pruned screenshot): a message
 * stamped later than an assistant message makes that message's usage stale.
 */
export function estimateContext(messages: readonly AgentMessage[]): ContextEstimate {
	let newestPrefix = Number.NEGATIVE_INFINITY;
	let last = -1;
	messages.forEach((m, i) => {
		const a = m as { role: string; timestamp?: number; stopReason?: string; usage?: Usage };
		if (a.role === "assistant" && a.usage && a.stopReason !== "aborted" && a.stopReason !== "error" && usageTokens(a.usage) > 0 && (a.timestamp ?? 0) >= newestPrefix) last = i;
		newestPrefix = Math.max(newestPrefix, a.timestamp ?? 0);
	});
	if (last < 0) {
		const tokens = messages.reduce((n, m) => n + estimateMessageTokens(m), 0);
		return { tokens, source: "estimate", trailing: tokens };
	}
	const trailing = messages.slice(last + 1).reduce((n, m) => n + estimateMessageTokens(m), 0);
	return { tokens: usageTokens((messages[last] as { usage: Usage }).usage) + trailing, source: "usage", trailing };
}

export interface Breakdown {
	/** system prompt, rules, skills and the tool declarations */
	fixed: number;
	/** what was said: questions, answers, summaries */
	chat: number;
	/** attached documents' text (between the pielikums markers of the prompt) */
	docs: number;
	/** tool calls and their results */
	tools: number;
	images: number;
	imageCount: number;
}

const DOC_BLOCK = /--- pielikums: [^\n]*---\n[\s\S]*?\n--- beigas: [^\n]*---/g;

/** Where the context goes, by size alone (the total of a provider count is shown separately). */
export function breakdown(messages: readonly AgentMessage[]): Breakdown {
	const b: Breakdown = { fixed: 0, chat: 0, docs: 0, tools: 0, images: 0, imageCount: 0 };
	for (const m of messages) {
		const msg = m as { role: string; content?: unknown };
		if (msg.role === "system") b.fixed += estimateMessageTokens(m);
		else if (msg.role === "toolResult") {
			for (const bl of blocksOf(msg.content)) {
				if (bl.type === "image") (b.images += IMAGE_TOKENS), b.imageCount++;
				else b.tools += estimateTextTokens(textOf(bl));
			}
		} else if (msg.role === "assistant") {
			const all = estimateMessageTokens(m);
			const calls = (blocksOf(msg.content) as { type: string; name?: string; arguments?: unknown }[]).filter((x) => x.type === "toolCall").reduce((n, x) => n + Math.ceil(((x.name?.length ?? 0) + JSON.stringify(x.arguments ?? {}).length) / CHARS_PER_TOKEN), 0);
			b.tools += calls;
			b.chat += all - calls;
		} else if (msg.role === "user") {
			for (const bl of blocksOf(msg.content)) {
				if (bl.type === "image") (b.images += IMAGE_TOKENS), b.imageCount++;
				else {
					const t = textOf(bl);
					const docs = (t.match(DOC_BLOCK) ?? []).reduce((n, d) => n + d.length, 0);
					b.docs += Math.ceil(docs / CHARS_PER_TOKEN);
					b.chat += estimateTextTokens(t) - Math.ceil(docs / CHARS_PER_TOKEN);
				}
			}
		}
	}
	return b;
}

// ---- keeping it small: screenshots --------------------------------------------------------------------------------

export const IMAGE_GONE = "[attēls izņemts no konteksta, lai ietaupītu vietu; ziņojumā minēts, kas tas bija]";

const hasImage = (m: AgentMessage) => {
	const msg = m as { role: string; content?: unknown };
	return (msg.role === "user" || msg.role === "toolResult") && blocksOf(msg.content).some((b) => b.type === "image");
};

export function countImages(messages: readonly AgentMessage[]): number {
	let n = 0;
	for (const m of messages) if (hasImage(m)) n += blocksOf((m as { content?: unknown }).content).filter((b) => b.type === "image").length;
	return n;
}

/**
 * Replaces the images of older messages by a short note. Only when more than `keep + slack` messages carry images, and
 * then down to the newest `keep`: the history is rewritten once per `slack` new screenshots, not on every message, so
 * the provider's prompt cache (which needs a stable prefix) survives in between. The result replaces the stored history,
 * so already-pruned messages stay pruned. Files stay on disk in the run folder.
 */
export function pruneImages(messages: readonly AgentMessage[], o: { keep: number; slack: number } = { keep: 3, slack: 3 }): { messages: AgentMessage[]; pruned: number } {
	const withImages = messages.map((m, i) => (hasImage(m) ? i : -1)).filter((i) => i >= 0);
	if (withImages.length <= o.keep + o.slack) return { messages: [...messages], pruned: 0 };
	const drop = new Set(withImages.slice(0, withImages.length - o.keep));
	let pruned = 0;
	const out = messages.map((m, i) => {
		if (!drop.has(i)) return m;
		const msg = m as { content: Block[] | string };
		const content = blocksOf(msg.content).map((b) => (b.type === "image" ? (pruned++, { type: "text", text: IMAGE_GONE } as TextContent) : b));
		return { ...m, content } as AgentMessage;
	});
	return { messages: out, pruned };
}

// ---- keeping it small: old tool results ---------------------------------------------------------------------------

/**
 * Cuts the text of tool results older than the last `recent` messages to their beginning. A tool result is read once,
 * in the turn that asked for it; later turns need what the model said about it. The cut says how much was dropped.
 */
export function trimToolResults(messages: readonly AgentMessage[], o: { recent: number; maxChars: number; headChars: number } = { recent: 16, maxChars: 4000, headChars: 1500 }): { messages: AgentMessage[]; trimmed: number } {
	const edge = messages.length - o.recent;
	let trimmed = 0;
	const out = messages.map((m, i) => {
		const msg = m as { role: string; content?: unknown };
		if (i >= edge || msg.role !== "toolResult") return m;
		let touched = false;
		const content = blocksOf(msg.content).map((b) => {
			const t = textOf(b);
			if (b.type !== "text" || t.length <= o.maxChars) return b;
			touched = true;
			return { type: "text", text: `${t.slice(0, o.headChars)}\n[… saīsināts vēlāk: ${t.length - o.headChars} no ${t.length} zīmēm]` } as TextContent;
		});
		if (!touched) return m;
		trimmed++;
		return { ...m, content } as AgentMessage;
	});
	return { messages: out, trimmed };
}
