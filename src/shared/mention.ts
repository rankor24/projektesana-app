// "@ar pārbaudi sienas" in the chat box: the message goes to that specialist's thread instead of the lead's. Pure; the renderer uses it too.
import { normRef, type AgentSpec } from "./agent-types.js";

/** A name has spaces ("Ekspertīzes lasītājs"), so up to this many words are tried as the whole name before one word is tried loosely. */
const NAME_WORDS = 5;
const TRAILING = /[,:;.!?]+$/;
/** A prefix must be at least this long: "@d …" is more likely a typed "@" than a call for the first specialist whose name starts with d. */
const MIN_PREFIX = 3;

/** An exact id or name wins at any length; failing that, a prefix of an id or name of at least MIN_PREFIX characters. */
function pick(specs: readonly AgentSpec[], word: string): AgentSpec | undefined {
	const q = normRef(word);
	if (!q) return undefined;
	const exact = specs.find((s) => normRef(s.id) === q || normRef(s.name) === q);
	if (exact || q.length < MIN_PREFIX) return exact;
	return specs.find((s) => normRef(s.id).startsWith(q) || normRef(s.name).startsWith(q));
}

/**
 * "@ar pārbaudi sienas" → { agent: "ar", text: "pārbaudi sienas" }. Only a mention at the very start counts (blanks before it are fine);
 * an `@` anywhere else, or one that names nobody, gives null. The agent matches by id or name like `findSpec`: case, diacritics, and a prefix of at least 3 characters.
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
	const hit = pick(specs, words[0][0].replace(TRAILING, ""));
	return hit ? { agent: hit.id, text: rest(1) } : null;
}
