// Dates as Latvian documents write them, in the order they stand in a line: "30.09.2026", "2026-09-30", and the words of a
// contract or BIP: "2026. gada 30. septembris" / "2026. g. 1. decembrī". Only real calendar dates come back (31.02 does not).

const MONTHS = ["janvār", "februār", "mart", "aprīl", "maij", "jūnij", "jūlij", "august", "septembr", "oktobr", "novembr", "decembr"];

const iso = (y: number, m: number, d: number): string | null => {
	const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
	const t = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s ? s : null;
};

/** Every date in the text, in reading order, as YYYY-MM-DD. */
export function datesIn(text: string): string[] {
	const found: { at: number; date: string }[] = [];
	const add = (at: number, d: string | null) => d && found.push({ at, date: d });
	for (const m of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g)) add(m.index, iso(+m[3], +m[2], +m[1]));
	for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(m.index, iso(+m[1], +m[2], +m[3]));
	for (const m of text.matchAll(/\b(\d{4})\.\s*(?:gada|g\.)\s*(\d{1,2})\.\s*(\p{L}+)/giu)) {
		const w = m[3].toLowerCase();
		const month = MONTHS.findIndex((x) => w.startsWith(x));
		if (month >= 0) add(m.index, iso(+m[1], month + 1, +m[2]));
	}
	return found.sort((a, b) => a.at - b.at).map((f) => f.date);
}
