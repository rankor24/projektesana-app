// Rules are data: every rule carries its source act, a read date and a verbatim quote. A rule ships only if its quote is in the
// likumi.lv snapshot it claims (verifyRules). Carried from v1 src/main/rules/{types,verify}.ts, merged into one file.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ActId = "258572" | "269069" | "269164" | "301303" | "326992" | "72608";

export const ACTS: Record<ActId, { short: string; title: string }> = {
	"72608": { short: "Svētku dienu likums", title: "Likums „Par svētku, atceres un atzīmējamām dienām”" },
	"258572": { short: "Būvniecības likums", title: "Būvniecības likums" },
	"269069": { short: "MK 500", title: "Vispārīgie būvnoteikumi (MK 19.08.2014. noteikumi Nr. 500)" },
	"269164": { short: "MK 529", title: "Ēku būvnoteikumi (MK noteikumi Nr. 529)" },
	"301303": { short: "LBN 202-18", title: "LBN 202-18 Būvniecības ieceres dokumentācijas noformēšana (MK Nr. 545)" },
	"326992": { short: "LBN 200-21", title: "LBN 200-21 Ēku būvnoteikumi un būvnormatīvs (MK Nr. 693)" },
};

/** The documentation stage the law speaks of (not the BIM stage of the timeline). */
export type DocStage = "koncepcija" | "skice" | "mbp" | "bp";
export type Section = "GP" | "AR" | "VISPARIGA" | "PROCESS";

export interface Rule {
	id: string;
	act: string;
	actId: ActId;
	/** e.g. "7.3 punkts" */
	article: string;
	url: string;
	/** ISO date the text was read from likumi.lv */
	read_on: string;
	valid_from: string | null;
	valid_to: string | null;
	/** machine-readable condition the engine uses, free keys */
	applies_when: Record<string, string | number | boolean>;
	/** content item or sadaļa this rule requires; empty for definitional rules */
	requires: string[];
	section: Section | null;
	/** verbatim text of the paragraph, exactly as in the snapshot */
	quote: string;
}

/** Rules in the law that take effect later and whose text is not visible yet: shown as `not read`, never as a rule. */
export const PENDING_UNREAD = [
	{ act: "Būvniecības likums", item: "15.1 pants — ieceres realizācija posmos", from: "2027-03-01" },
	{ act: "MK 500", item: "26.12.1 apakšpunkts", from: "2027-03-01" },
	{ act: "MK 529", item: "26.3.1 apakšpunkts (MBP), 74.2 punkts un 87.1 punkts", from: "2027-03-01" },
];

/** Acts and regulations the module has not read yet. */
export const NOT_READ = ["LBN 201-15", "LBN 208-15", "LBN 211-15", "LBN 016-15", "TIAN (teritorijas izmantošanas un apbūves noteikumi)", "LVS standartu saraksts"];


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
