// The command palette's ranking (task 8.6). Pure and node-free: the renderer and the tests use the same function.
// A query is words; every word must match the label, the hint or the keywords, and a match at the start of the label or of a
// word in it beats one in the middle. Case and diacritics are ignored (a user types "pasutijums" for "Pasūtījums").

export type PaletteGroup = "panel" | "project" | "template" | "source" | "recent";

export interface PaletteItem {
	id: string;
	group: PaletteGroup;
	label: string;
	hint?: string;
	keywords?: string;
}

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const GROUP_ORDER: Record<PaletteGroup, number> = { recent: 0, panel: 1, project: 2, template: 3, source: 4 };

/** How well one word matches one item: 0 = not at all. */
function wordScore(word: string, item: PaletteItem): number {
	const label = fold(item.label);
	if (label.startsWith(word)) return 100;
	if (label.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(word))) return 70;
	if (label.includes(word)) return 40;
	if (fold(`${item.hint ?? ""} ${item.keywords ?? ""}`).includes(word)) return 20;
	return 0;
}

/** Items matching every word of `query`, best first; with no query, recent things then panels, in order. */
export function rank(items: PaletteItem[], query: string, limit = 30): PaletteItem[] {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (!words.length) return [...items].filter((i) => i.group === "recent" || i.group === "panel").sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]).slice(0, limit);
	const scored: { item: PaletteItem; score: number }[] = [];
	for (const item of items) {
		let total = 0;
		let all = true;
		for (const w of words) {
			const s = wordScore(w, item);
			if (!s) {
				all = false;
				break;
			}
			total += s;
		}
		if (all) scored.push({ item, score: total });
	}
	return scored
		.sort((a, b) => b.score - a.score || GROUP_ORDER[a.item.group] - GROUP_ORDER[b.item.group] || a.item.label.length - b.item.label.length || a.item.label.localeCompare(b.item.label, "lv"))
		.slice(0, limit)
		.map((s) => s.item);
}
