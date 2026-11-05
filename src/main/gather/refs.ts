// Which laws, regulations and standards do THIS project's documents name? Found by code, with the words around
// each mention as the quote. Shown in panels 1–4 above the library, so the first thing there is the project's own list.
import { loadFiles } from "../../kernel/files.js";
import { normText } from "../files/text.js";
import { cachedText } from "./scan.js";
import type { Category } from "../library/library.js";

export interface ProjectRef {
	category: Category;
	/** normalised name, e.g. "LBN 208-15" */
	ref: string;
	/** project file that mentions it first */
	path: string;
	/** the words around the mention, verbatim from the file */
	quote: string;
	/** how many files mention it */
	files: number;
}

const STEMS_LIKUMS = [
	"Būvniecības likum",
	"Teritorijas attīstības plānošanas likum",
	"Aizsargjoslu likum",
	"Ugunsdrošības un ugunsdzēsības likum",
	"Enerģētikas likum",
	"Ēku energoefektivitātes likum",
	"Civillikum",
	"Dzīvokļa īpašuma likum",
	"Zemes ierīcības likum",
	"Nekustamā īpašuma valsts kadastra likum",
	"Meža likum",
	"Publisko iepirkumu likum",
	"Autoceļu likum",
	"Dzelzceļa likum",
];

interface Matcher {
	category: Category;
	re: RegExp;
	/** turns one match into the normalised name */
	name: (m: RegExpExecArray) => string;
}

const MATCHERS: Matcher[] = [
	{ category: "mk", re: /\bLBN\s?\d{3}-\d{2}\b/g, name: (m) => m[0].replace(/\s+/g, " ").replace(/^LBN(\d)/, "LBN $1") },
	{ category: "mk", re: /(?:\bMK\b|Ministru\s+kabineta)\s+(?:20\d\d\.\s*gada\s+\d{1,2}\.\s*\p{L}+\s+)?noteikum\p{L}*\s+Nr\.\s*\d+/giu, name: (m) => `MK noteikumi Nr. ${/Nr\.\s*(\d+)/i.exec(m[0])![1]}` },
	{ category: "lvs", re: /\bLVS\s+(?:EN\s+)?(?:ISO\s+)?\d+(?:[-–:]\d+)*/g, name: (m) => m[0].replace(/\s+/g, " ").replace("–", "-") },
	{ category: "lvs", re: /(?<!LVS\s)\b(?:EN|ISO)\s+\d{3,6}(?:[-:]\d+)*/g, name: (m) => m[0].replace(/\s+/g, " ") },
	{ category: "es", re: /\b(Direktīv|Regul)\p{L}*\s*(?:\((?:ES|EK|ES,\s*Euratom)\)\s*)?(?:Nr\.\s*)?\d{1,4}\/\d{1,4}(?:\/\p{L}+)?/giu, name: (m) => `${/^dir/i.test(m[1]) ? "Direktīva" : "Regula"} ${/\d{1,4}\/\d{1,4}(?:\/\p{L}+)?/u.exec(m[0])![0]}` },
	{ category: "likums", re: new RegExp(`(?:${STEMS_LIKUMS.join("|")})\\p{L}*`, "giu"), name: (m) => STEMS_LIKUMS.find((s) => m[0].toLowerCase().startsWith(s.toLowerCase()))!.replace(/um$/, "ums") },
];

const around = (text: string, i: number, len: number) => text.slice(Math.max(0, i - 70), Math.min(text.length, i + len + 70)).trim();

/** Mentions in the project's own readable files (the law library is not scanned here). */
export async function projectRefs(root: string): Promise<ProjectRef[]> {
	const found = new Map<string, ProjectRef & { set: Set<string> }>();
	for (const f of loadFiles(root)) {
		let text: string;
		try {
			text = normText(await cachedText(root, f.path));
		} catch {
			continue;
		}
		for (const m of MATCHERS) {
			m.re.lastIndex = 0;
			for (let x = m.re.exec(text); x; x = m.re.exec(text)) {
				const ref = m.name(x);
				const key = `${m.category}|${ref.toLowerCase()}`;
				const hit = found.get(key);
				if (hit) hit.set.add(f.path);
				else found.set(key, { category: m.category, ref, path: f.path, quote: around(text, x.index, x[0].length), files: 1, set: new Set([f.path]) });
			}
		}
	}
	return [...found.values()]
		.map(({ set, ...r }) => ({ ...r, files: set.size }))
		.sort((a, b) => a.ref.localeCompare(b.ref, "lv", { numeric: true }));
}
