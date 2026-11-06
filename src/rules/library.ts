// Law library: acts and standards Boris adds by link or file, plus the built-in likumi.lv snapshots.
// Lives in the app's user data (shared by all projects). Text is kept per paragraph so a search returns verbatim
// paragraphs with source, URL and read date — the same citation discipline as the rules.
//
// "Nolasīts <date>" = the day the text was downloaded/extracted and saved here. Nothing of it sits in the agent's context:
// the agent sees only what it asks for through the search_law tool.
// Carried from v1 src/main/library/library.ts; changed: extraction through sources/text (states, pages).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { extractText } from "../sources/text/index.js";

export type Category = "likums" | "mk" | "lvs" | "es";
export const CATEGORY_LABEL: Record<Category, string> = { likums: "Likumi", mk: "MK noteikumi un LBN", lvs: "LVS standarti", es: "ES standarti un tiesības" };

export interface Source {
	id: string;
	title: string;
	category: Category;
	kind: "builtin" | "url" | "file";
	/** web address it was read from */
	url: string | null;
	/** original file name (a copy is kept in the library) */
	file: string | null;
	/** ISO date the text was read */
	readOn: string;
	paragraphs: number;
	sha256: string;
	removed?: boolean;
	/** set by a re-read when the live text differs from what was saved */
	changedOn?: string;
}

/** The six acts read on 2026-11-03 and shipped with the app (data/law-snapshots). */
export const BUILTIN: { actId: string; title: string; category: Category }[] = [
	{ actId: "258572", title: "Būvniecības likums", category: "likums" },
	{ actId: "72608", title: "Par svētku, atceres un atzīmējamām dienām", category: "likums" },
	{ actId: "269069", title: "MK 500 Vispārīgie būvnoteikumi", category: "mk" },
	{ actId: "269164", title: "MK 529 Ēku būvnoteikumi", category: "mk" },
	{ actId: "301303", title: "LBN 202-18 Būvniecības ieceres dokumentācijas noformēšana (MK 545)", category: "mk" },
	{ actId: "326992", title: "LBN 200-21 (MK 693)", category: "mk" },
];
const BUILTIN_READ_ON = "2026-11-03";

const BLOCK = /<\/?(p|div|br|tr|td|th|li|ul|ol|table|tbody|thead|h[1-6]|section|article|hr|blockquote)\b[^>]*>/gi;
const ENT: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };

/** HTML → one paragraph per line. Inline tags (<sup>, <a>) never split a word or a number such as 7.1. */
export function htmlToParagraphs(html: string): string[] {
	const body = html
		.replace(/<(script|style|noscript|nav|header|footer)[\s\S]*?<\/\1>/gi, " ")
		.replace(BLOCK, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&[a-z]+;|&#39;/gi, (e) => ENT[e.toLowerCase()] ?? e);
	return toParagraphs(body);
}

export function toParagraphs(text: string): string[] {
	return text
		.split(/\n/)
		.map((l) => l.replace(/[ \t ]+/g, " ").trim())
		.filter((l) => l.length >= 3);
}

export function titleOf(html: string): string | null {
	const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
	return t ? t.replace(/\s+/g, " ").replace(/&amp;/g, "&").trim() : null;
}

const today = () => new Date().toISOString().slice(0, 10);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export class Library {
	constructor(
		private dir: string,
		private snapshotDir: string,
	) {
		mkdirSync(join(dir, "files"), { recursive: true });
	}

	private indexFile = () => join(this.dir, "index.json");
	private load(): Source[] {
		return existsSync(this.indexFile()) ? (JSON.parse(readFileSync(this.indexFile(), "utf8")) as Source[]) : [];
	}
	private save(all: Source[]) {
		writeFileSync(this.indexFile(), JSON.stringify(all, null, 1), "utf8");
	}

	/** Built-in snapshots first, then what Boris added (removed ones hidden). */
	list(category?: Category): Source[] {
		const builtin = BUILTIN.filter((b) => existsSync(join(this.snapshotDir, `${b.actId}.txt`))).map((b): Source => {
			const text = readFileSync(join(this.snapshotDir, `${b.actId}.txt`), "utf8");
			return { id: `builtin-${b.actId}`, title: b.title, category: b.category, kind: "builtin", url: `https://likumi.lv/ta/id/${b.actId}`, file: null, readOn: BUILTIN_READ_ON, paragraphs: toParagraphs(text).length, sha256: sha(text) };
		});
		return [...builtin, ...this.load().filter((s) => !s.removed)].filter((s) => !category || s.category === category);
	}

	paragraphs(id: string): string[] {
		if (id.startsWith("builtin-")) return toParagraphs(readFileSync(join(this.snapshotDir, `${id.slice(8)}.txt`), "utf8"));
		const f = join(this.dir, `${id}.txt`);
		if (!existsSync(f)) throw new Error(`Avots ${id} nav atrasts.`);
		return readFileSync(f, "utf8").split("\n");
	}

	private add(meta: Omit<Source, "id" | "paragraphs" | "sha256" | "readOn">, paragraphs: string[]): Source {
		if (paragraphs.length === 0) throw new Error("No avota neizdevās nolasīt tekstu (tukšs vai skenēts PDF bez teksta slāņa).");
		const all = this.load();
		const body = paragraphs.join("\n");
		const dup = all.find((s) => !s.removed && s.sha256 === sha(body));
		if (dup) throw new Error(`Šis teksts jau ir bibliotēkā: ${dup.title}`);
		const id = `s${Date.now().toString(36)}`;
		writeFileSync(join(this.dir, `${id}.txt`), body, "utf8");
		const s: Source = { ...meta, id, readOn: today(), paragraphs: paragraphs.length, sha256: sha(body) };
		this.save([...all, s]);
		return s;
	}

	/** A web page: likumi.lv, EUR-Lex or any https address. `fetchPage` returns the HTML. */
	async addUrl(url: string, category: Category, fetchPage: (url: string) => Promise<string>, title?: string): Promise<Source> {
		if (!/^https:\/\//i.test(url.trim())) throw new Error("Saitei jāsākas ar https://");
		const html = await fetchPage(url.trim());
		return this.add({ title: title?.trim() || titleOf(html) || url, category, kind: "url", url: url.trim(), file: null }, htmlToParagraphs(html));
	}

	/** A file Boris holds (LVS standards are paid PDFs). A copy is kept so the original can be moved or deleted. */
	async addFile(abs: string, category: Category, title?: string): Promise<Source> {
		const t = await extractText(abs);
		if (t.state !== "ok") throw new Error(`No avota neizdevās nolasīt tekstu: ${t.reason ?? t.state}`);
		const paragraphs = toParagraphs(t.pages.join("\n"));
		const s = this.add({ title: title?.trim() || basename(abs, extname(abs)), category, kind: "file", url: null, file: basename(abs) }, paragraphs);
		copyFileSync(abs, join(this.dir, "files", `${s.id}${extname(abs).toLowerCase()}`));
		return s;
	}

	/** Hides a source from the panels and the agent. Its files stay in the library folder. */
	remove(id: string): void {
		const all = this.load();
		const s = all.find((x) => x.id === id);
		if (!s) throw new Error("Iebūvētos aktus noņemt nevar; tie ir noteikumu pamatā.");
		s.removed = true;
		this.save(all);
	}

	/** Reads a link again; a changed text is saved as the new version and the old one is kept beside it. */
	async reread(id: string, fetchPage: (url: string) => Promise<string>): Promise<{ changed: boolean; source: Source }> {
		const all = this.load();
		const s = all.find((x) => x.id === id);
		if (!s || !s.url) throw new Error("Pārlasīt var tikai avotus, kas pievienoti ar saiti.");
		const body = htmlToParagraphs(await fetchPage(s.url)).join("\n");
		if (sha(body) === s.sha256) {
			s.readOn = today();
			this.save(all);
			return { changed: false, source: s };
		}
		writeFileSync(join(this.dir, `${s.id}.${s.readOn}.txt`), readFileSync(join(this.dir, `${s.id}.txt`)));
		writeFileSync(join(this.dir, `${s.id}.txt`), body, "utf8");
		Object.assign(s, { sha256: sha(body), paragraphs: body.split("\n").length, changedOn: today(), readOn: today() });
		this.save(all);
		return { changed: true, source: s };
	}

	/** Paragraphs that contain every word of the query (case-insensitive), with their citation. */
	search(query: string, opts: { category?: Category; limit?: number } = {}): { source: string; title: string; url: string | null; readOn: string; paragraph: string }[] {
		const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
		if (!words.length) throw new Error("Meklēšanas teksts ir tukšs.");
		const out: { source: string; title: string; url: string | null; readOn: string; paragraph: string }[] = [];
		for (const s of this.list(opts.category)) {
			for (const p of this.paragraphs(s.id)) {
				const low = p.toLowerCase();
				if (p.length >= 25 && words.every((w) => low.includes(w))) out.push({ source: s.id, title: s.title, url: s.url, readOn: s.readOn, paragraph: p });
				if (out.length >= (opts.limit ?? 40)) return out;
			}
		}
		return out;
	}

	/** LVS standards and EU acts that the texts already in the library refer to, each with the paragraph that cites it. */
	references(kind: "lvs" | "es"): { ref: string; title: string; paragraph: string }[] {
		// EU acts in any Latvian case form (regula, regulai, regulas, regulā …), shown in the nominative
		const re =
			kind === "lvs"
				? /\bLVS\s+(?:EN\s+)?(?:ISO\s+)?(?:IEC\s+)?\d+(?:[-–]\d+)*(?::\d{4}(?:\+A\d+:\d{4})?)?/gu
				: /(?<![\p{L}])([Rr]egul|[Dd]irektīv|[Ll]ēmum)\p{L}*\s*(\((?:ES|EK|EEK|Euratom)\)\s*(?:Nr\.\s*)?\d{2,4}\/\d+(?:\/(?:ES|EK|EEK))?)/gu;
		const NOMINATIVE: Record<string, string> = { regul: "Regula", direktīv: "Direktīva", lēmum: "Lēmums" };
		const seen = new Map<string, { ref: string; title: string; paragraph: string }>();
		for (const s of this.list()) {
			for (const p of this.paragraphs(s.id)) {
				for (const m of p.matchAll(re)) {
					const ref = (kind === "lvs" ? m[0] : `${NOMINATIVE[m[1].toLowerCase()]} ${m[2]}`).replace(/\s+/g, " ");
					if (!seen.has(ref)) seen.set(ref, { ref, title: s.title, paragraph: p });
				}
			}
		}
		return [...seen.values()].sort((a, b) => a.ref.localeCompare(b.ref, "lv"));
	}

	/** For the "open the original" button. */
	originalFile(id: string): string | null {
		const f = readdirSync(join(this.dir, "files")).find((n) => n.startsWith(`${id}.`));
		return f ? join(this.dir, "files", f) : null;
	}
}
