// A rule ships only if its quote is in the likumi.lv snapshot it claims to come from (spec §5).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Rule } from "./types.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export interface Verification {
	ok: boolean;
	failures: { id: string; reason: string }[];
	/** rules whose snapshot text changed or is missing: they must be re-read before use */
	checked: number;
}

export function verifyRules(rules: Rule[], snapshotDir: string): Verification {
	const cache = new Map<string, string>();
	const failures: Verification["failures"] = [];
	for (const r of rules) {
		if (!r.quote.trim()) failures.push({ id: r.id, reason: "tukšs citāts" });
		if (!r.url.startsWith("https://likumi.lv/ta/id/") || !r.url.endsWith(r.actId)) failures.push({ id: r.id, reason: "URL neatbilst aktam" });
		if (!/^\d{4}-\d{2}-\d{2}$/.test(r.read_on)) failures.push({ id: r.id, reason: "nav lasīšanas datuma" });
		const f = join(snapshotDir, `${r.actId}.txt`);
		if (!existsSync(f)) {
			failures.push({ id: r.id, reason: `nav snapshot ${r.actId}` });
			continue;
		}
		if (!cache.has(f)) cache.set(f, norm(readFileSync(f, "utf8")));
		if (!cache.get(f)!.includes(norm(r.quote))) failures.push({ id: r.id, reason: "citāts nav atrodams snapshot tekstā" });
	}
	return { ok: failures.length === 0, failures, checked: rules.length };
}

/** Re-read check: does the live page still contain the quote? Takes the page text so it stays testable. */
export function quoteStillInPage(rule: Rule, pageText: string): boolean {
	return norm(pageText).includes(norm(rule.quote));
}

const ENT: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

/** Page HTML → text the way the snapshots were made: tags dropped, entities decoded, whitespace collapsed. */
export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
		// block tags separate text; inline tags (<sup>, <a>, <span>…) must not split a word or a number like 7.1
		.replace(/<\/?(p|div|br|tr|td|th|li|ul|ol|table|tbody|thead|h[1-6]|section|article|hr)\b[^>]*>/gi, " ")
		.replace(/<[^>]+>/g, "")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&[a-z]+;|&#39;/gi, (e) => ENT[e.toLowerCase()] ?? e)
		.replace(/\s+/g, " ")
		.trim();
}

export interface Reread {
	checked: number;
	/** quote no longer found on the live page: the law text changed (or moved) and the rule must be re-read by a person */
	changed: { id: string; act: string; article: string }[];
	/** pages that could not be fetched; their rules are NOT assumed unchanged */
	failed: { actId: string; reason: string }[];
}

/** One command re-reads every act's page and flags rules whose quote is gone (spec §5). `fetchPage` returns the page HTML. */
export async function rereadRules(rules: Rule[], fetchPage: (url: string) => Promise<string>): Promise<Reread> {
	const out: Reread = { checked: 0, changed: [], failed: [] };
	const pages = new Map<string, string | null>();
	for (const r of rules) {
		if (!pages.has(r.actId)) {
			try {
				pages.set(r.actId, htmlToText(await fetchPage(r.url)));
			} catch (e) {
				pages.set(r.actId, null);
				out.failed.push({ actId: r.actId, reason: (e as Error).message });
			}
		}
		const page = pages.get(r.actId);
		if (page === null || page === undefined) continue;
		out.checked++;
		if (!quoteStillInPage(r, page)) out.changed.push({ id: r.id, act: r.act, article: r.article });
	}
	return out;
}

export function loadRules(dataDir: string): Rule[] {
	return JSON.parse(readFileSync(join(dataDir, "rules.json"), "utf8")) as Rule[];
}
