// Token sizes both the main process and the window show. Estimates, from pi-ai's own rule (utils/estimate.ts):
// 3.5 characters per token, and an image counts as 4800 characters. Real counts come from the provider after each answer.
export const CHARS_PER_TOKEN = 3.5;
export const IMAGE_TOKENS = Math.ceil(4800 / CHARS_PER_TOKEN);

export const estimateTextTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

/** 850 → "850", 1372 → "1.4K", 38200 → "38K", 1048576 → "1.05M" */
export function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 10_000) return `${Math.round(n / 1000)}K`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return String(Math.round(n));
}

/** A run's or project's usage on one line: tokens in (cached ones included) and out, and the price when it is known. A price
 *  for only some turns is marked "no", never presented as the total. */
export function usageText(u: { input: number; output: number; cacheRead: number; cost: number | null; turns?: number; priced?: number }): string {
	const tokens = `${fmtTokens(u.input + u.cacheRead)} ievade · ${fmtTokens(u.output)} izvade`;
	if (u.cost === null) return `${tokens} · cena nav zināma`;
	const partial = u.turns !== undefined && u.priced !== undefined && u.priced < u.turns ? ` (no ${u.priced} no ${u.turns} piegājieniem)` : "";
	return `${tokens} · $${u.cost < 1 ? u.cost.toFixed(3) : u.cost.toFixed(2)}${partial}`;
}
