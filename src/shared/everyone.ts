// "@visi …" / "@all …" in the chat box: a line addressed to everyone goes to BPV alone, not to every agent.
//
// Ported from OpenMausBot (Apache-2.0), server/chief-of-staff.ts `EVERYONE_ON_THE_MAP`: "When the person writes to @everyone ... it comes to you alone,
// so you decide who it concerns ... never to all of them by default". The reason is OpenMausBot's: a fan-out to 13 bots costs about 13 model turns, most
// of them from bots the line did not concern. Here the Chief is BPV, and the line reaches it with that instruction in front, since the standing text of
// an agent is not changed per message. Pure; the window's "@" popup and the main process use the same word list.

/** The words that mean "everyone", with and without diacritics. */
export const EVERYONE_WORDS = ["visi", "visiem", "all", "everyone", "everybody", "komanda", "team"] as const;

const EVERYONE = new RegExp(String.raw`^\s*@(${EVERYONE_WORDS.join("|")})(?![\p{L}\p{N}_-])[,:;]?[ \t]*`, "iu");

/** What the chat line says once the "@visi" is taken off, or null when the line is not addressed to everyone. */
export function parseEveryone(text: string): { text: string } | null {
	const m = EVERYONE.exec(text);
	return m ? { text: text.slice(m[0].length).trimStart() } : null;
}

/** What BPV reads before the user's words. */
export const EVERYONE_NOTE =
	"[Lietotājs raksta VISIEM aģentiem; tas nonāk pie tevis vienīgā. Izlem, kuru darbs tas skar, un nodod to ar assign_task tikai tiem; nevienam nenodod pēc noklusējuma. Ja tas neattiecas uz citiem, atbildi pats.]";

/** The text BPV gets: the note, then the user's own words. */
export const toEveryoneText = (rest: string): string => `${EVERYONE_NOTE}\n${rest}`;
