// Proposes a role for a freshly imported file, with the quote that justifies it (day-one step 2). Boris confirms; code never assigns silently.
import { basename } from "node:path";
import { extractText } from "./text.js";

export const ROLES = ["PU", "Zemes dokumenti", "Topogrāfija", "Inventarizācijas lieta", "Punktu mākonis", "Tehniskie noteikumi", "BIP / BIM prasības", "Cits"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Keyword patterns per role, in priority order, written on FOLDED text (lower case, no diacritics, `_ - .` as spaces) so that
 * "3_pielikums_BIM_prasibas.docx" and "BIM prasības" are the same thing.
 */
const PATTERNS: { role: Role; re: RegExp }[] = [
	{ role: "PU", re: /projektesanas\s+uzdevum\w*/ },
	{ role: "Tehniskie noteikumi", re: /tehniskie\s+noteikum\w*/ },
	{ role: "Inventarizācijas lieta", re: /inventarizacijas\s+liet\w*/ },
	{ role: "Topogrāfija", re: /topograf\w*|geodeziska\s+uzmerisan\w*/ },
	{ role: "Zemes dokumenti", re: /zemesgramat\w*|kadastra\s+apzimejum\w*|zemes\s+robezu\s+plan\w*/ },
	{ role: "BIP / BIM prasības", re: /bim\s+prasib\w*|bim\s+izpildes\s+plan\w*|\bbip\b/ },
	{ role: "Punktu mākonis", re: /punktu\s+makon\w*|point\s*cloud/ },
];

/** Same length as the input, so a match index in the folded text is the same index in the original (the quote stays verbatim). */
function fold(s: string): string {
	let out = "";
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		out += /[_\-.]/.test(ch) ? " " : (ch.normalize("NFD")[0] ?? ch).toLowerCase();
	}
	return out;
}

/** A document announces what it is in its title, not on page 40. */
const TITLE_CHARS = 2000;

export interface RoleProposal {
	role: Role;
	/** verbatim text that matched */
	quote: string;
	from: "text" | "filename";
}

export async function proposeRole(abs: string): Promise<RoleProposal | null> {
	let text = "";
	try {
		text = await extractText(abs);
	} catch {
		// binary formats (point clouds, DWG): the name is all there is
	}
	return proposeRoleFromText(text, basename(abs));
}

/**
 * The same rules on text that is already extracted (the folder scan reads each file once).
 * 1. The file name (a deliberate label: "…_BIM_prasibas.docx" is BIM requirements).
 * 2. The title block: the FIRST role keyword in the first 2000 characters. A BIM-requirements annex that merely mentions
 *    "projektēšanas uzdevums" in its body is not a PU — the earlier version looked at 60 000 characters and called 39 files PU.
 */
export function proposeRoleFromText(fullText: string, name: string): RoleProposal | null {
	const foldedName = fold(name);
	for (const { role, re } of PATTERNS) {
		const n = re.exec(foldedName);
		if (n) return { role, quote: name.slice(n.index, n.index + n[0].length), from: "filename" };
	}
	const head = fullText.slice(0, TITLE_CHARS);
	const foldedHead = fold(head);
	let best: { role: Role; index: number; len: number } | null = null;
	for (const { role, re } of PATTERNS) {
		const t = re.exec(foldedHead);
		if (t && (!best || t.index < best.index)) best = { role, index: t.index, len: t[0].length };
	}
	if (best) return { role: best.role, quote: head.slice(best.index, best.index + best.len), from: "text" };
	if (/\.(las|laz|e57|rcp|rcs)$/i.test(name)) return { role: "Punktu mākonis", quote: name, from: "filename" };
	return null;
}
