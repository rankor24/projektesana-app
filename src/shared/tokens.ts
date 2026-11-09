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
