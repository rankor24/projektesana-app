// "@ar pārbaudi sienas" in the chat box: the message goes to that specialist's thread instead of the lead's. Pure; the renderer uses it too.
import { findSpec, normRef, type AgentSpec } from "./agent-types.js";

/** A name has spaces ("Ekspertīzes lasītājs"), so up to this many words are tried as the whole name before one word is tried loosely. */
const NAME_WORDS = 5;
const TRAILING = /[,:;.!?]+$/;

/**
 * "@ar pārbaudi sienas" → { agent: "ar", text: "pārbaudi sienas" }. Only a mention at the very start counts (blanks before it are fine);
 * an `@` anywhere else, or one that names nobody, gives null. The agent matches by id or name like `findSpec`: case, diacritics, a prefix.
 * A name written in full wins over a prefix of its first word.
 */
export function parseMention(text: string, specs: readonly AgentSpec[]): { agent: string; text: string } | null {
	const m = /^\s*@(\S+)/.exec(text);
	if (!m) return null;
	const body = text.slice(text.indexOf("@") + 1);
	const words = [...body.matchAll(/\S+/g)];
	const rest = (upto: number) => body.slice(words[upto - 1].index! + words[upto - 1][0].length).replace(/^[ \t]*/, "").replace(/^\r?\n/, "").trimEnd();
	for (let n = Math.min(words.length, NAME_WORDS); n >= 2; n--) {
		const ref = normRef(words.slice(0, n).map((w) => w[0]).join(" ").replace(TRAILING, ""));
		const hit = ref && specs.find((s) => normRef(s.id) === ref || normRef(s.name) === ref);
		if (hit) return { agent: hit.id, text: rest(n) };
	}
	const hit = findSpec(specs, words[0][0].replace(TRAILING, ""));
	return hit ? { agent: hit.id, text: rest(1) } : null;
}
