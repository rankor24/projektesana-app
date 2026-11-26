// The VZD "Būves eksplikācija" of an inventarizācijas / kadastrālās uzmērīšanas lieta, read from OCR text (a scan of 2000 and
// later): every room, not a sample (2026-11-20, a real scan: the column reader kept 22 of the rooms, with area and height swapped).
//   Stāvs: -1                          the floor, for the rows below it (OCR: "Srnvs", "Stays", "Stavs")
//   Telpu grupas numurs: 003           a room group; numbers restart per group and floor
//   1  gaitenis  Nedzīvojama iekštelpa  17.6  2.95  [pazīme]
// OCR moves things: the number after the name, the area after the type or the name after the area, table borders read as
// I ! | i J, a name split over two lines. So a room line is any line with a room type ("… iekštelpa / ārtelpa"); its number is
// the first whole number, its height the number nearest the floor's usual height, its area the other. Names are put back
// with diacritics from the room names these documents use. The document's own totals check the result.
import type { RoomRow, RoomTable } from "./kl.js";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** the room type column: "Nedzīvojama iekštelpa", "Dzīvojamā istaba", "Koplietošanas ārtelpa" (OCR: Nedzlvojama, iek~telpa) */
const TYPE = /\b(?:ne\s*)?(?:dz\S{0,2}voj\S*|koplieto\S*)\s+(?:iek\S{0,3}telp\S*|\S{0,2}rtelp\S*|istab\S*|telp\S*)/i;
// "Stāvs" has a non-ASCII letter, which \w does not match; the OCR turns it into "Srnvs", "Stays", "St~vs"
const FLOOR = /^[^\p{L}\d]{0,3}s[\p{L}~]{1,4}s\s*:\s*(-?\d{1,2})(?!\d)/iu;
const GROUP = /grupas\s+numurs\s*:\s*(\d{1,4})/i;
const NOISE = /^[|!iIJl~:;.,'"`_\-–—]+$/;
const NUM = /^-?\d+(?:[.,]\d+)?$/;
/** names these documents use; an OCR word one or two letters off becomes the right word, with its diacritics */
const NAMES = ["gaitenis", "kabinets", "noliktava", "arhīvs", "pieliekamais", "laboratorija", "duša", "priekštelpa", "tualete", "palīgtelpa", "tehniskā", "telpa", "kāpnes", "kāpņu", "vestibils", "mācību", "garderobe", "aptieka", "radiopunkts", "radiopost", "virtuve", "ēdnīca", "zāle", "istaba", "vējtveris", "katlu", "ventilācijas", "sanitārais", "mezgls", "dzīvoklis", "veikals", "darbnīca", "uzgaidāmā", "operatoru", "dispečeru", "atpūtas", "ģērbtuve", "slimnīcas", "procedūru", "personāla", "pagrabs", "bēniņi", "balkons", "lodžija", "terase", "garāža", "boksi", "sargtelpa", "serveru", "elektro", "siltummezgls", "kurtuve", "veļas", "mazgātava", "kopēšanas", "sēžu", "konferenču", "zāle", "apspriežu", "biroja"];
const NAME_KEYS = NAMES.map((n) => [fold(n), n] as const);

function lev(a: string, b: string): number {
	const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) d[0]![j] = j;
	for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
	return d[a.length]![b.length]!;
}
/** An OCR word back to the room name it most likely is ("paUgtelpa" → "palīgtelpa", "maclbu" → "mācību"); else as read. */
function word(w: string): string {
	const f = fold(w).replace(/[~^]/g, "");
	if (f.length < 3) return w;
	let best: string | null = null;
	let bestD = 99;
	for (const [k, n] of NAME_KEYS) {
		const d = lev(f, k);
		if (d < bestD) (bestD = d), (best = n);
	}
	return best && bestD <= (f.length <= 5 ? 1 : 2) ? best : w;
}

const num = (t: string) => Number(t.replace(",", "."));

interface Raw {
	floor: string;
	group: string;
	no: string;
	name: string;
	nums: number[];
	page: number;
	line: string;
}

export function roomsFromEksplikacija(pages: string[]): RoomTable {
	const raws: Raw[] = [];
	const totals: RoomTable["totals"] = [];
	const unread: RoomTable["unread"] = [];
	let floor = "";
	let group = "";
	// a room whose sizes are not on its own line: a page the scan read column by column (all "12 zāle" lines, then all
	// "Nedzīvojama iekštelpa 116.2 3.45" lines) or a row split in two; its sizes are the next sizes-only line, in order
	let waiting: { floor: string; group: string; no: string; words: string[]; page: number; line: string }[] = [];
	pages.forEach((text, pi) => {
		for (const rawLine of text.split("\n")) {
			const line = rawLine.replace(/\s+/g, " ").trim();
			const page = pi + 1;
			if (!line) continue;
			const f = FLOOR.exec(line);
			if (f) {
				floor = String(Number(f[1]));
				continue;
			}
			const whole = /b\S{1,3}ves\s+kop\S*\s+plat\S*\s*\(kv\.?m\.?\)\s*:\s*(\d+(?:[.,]\d+)?)/i.exec(line);
			if (whole) totals.push({ floor: "*", area: num(whole[1]!), page });
			const gt = /^(\d{3})\s+telpu\s+grupas\s+kop\S*\s+plat\S*.*?:\s*(\d+(?:[.,]\d+)?)/i.exec(line);
			if (gt) totals.push({ floor: "*", group: gt[1]!, area: num(gt[2]!), page });
			// the building's and the groups' summary lines ("… platība (kv.m.): 1378") and the headers are not rooms
			const g = GROUP.exec(line);
			if (g) group = g[1]!;
			if (whole || gt || /\(kv\.?\s*m\.?\)\s*:/i.test(line) || g || /kadastra\s+apz|izdrukas\s+datums|grupas\s+(adreses|izmanto)/i.test(line)) continue;
			const typed = TYPE.test(line);
			const tokens = line.replace(TYPE, " ").split(" ").filter((t) => t && !NOISE.test(t));
			const ints: string[] = [];
			const nums: number[] = [];
			const words: string[] = [];
			for (const t of tokens) {
				if (NUM.test(t)) (!/[.,]/.test(t) && !words.length && !nums.length && !ints.length ? ints : nums).push(t as never);
				else if (/\p{L}{2,}/u.test(t) || (t.length === 1 && /\p{L}/u.test(t) && words.length)) {
					if (t.length === 1) words[words.length - 1] += t;
					else words.push(t.replace(/[|!~\\]/g, ""));
				}
			}
			// header words of the table ("Telpas numurs", "nosaukums", "platība", "augstums") are not a room
			if (!typed && words.some((w) => /^(telpas|numurs|nosaukums|plat|augst|veids|pazime|patval|buvniec|kv\.?m)/i.test(fold(w)))) continue;
			let sizes = nums.map(Number).filter((n) => Number.isFinite(n));
			let no = ints.length ? String(Number(ints[0])) : null;
			// the scan moved the number behind the name ("noliktava Nedzīvojama iekštelpa 6 31.4 2.95"): three sizes, the first whole
			if (!no && words.length && sizes.length >= 3 && Number.isInteger(sizes[0]) && sizes[0]! > 0 && sizes[0]! < 1000) {
				no = String(sizes[0]);
				sizes = sizes.slice(1);
			}
			if (no && words.length && sizes.length) {
				// a whole row: number, name, sizes (a number after the type is the area, so the sizes keep their order)
				raws.push({ floor, group, no, name: words.map(word).join(" ").trim(), nums: sizes, page, line: rawLine.trim() });
			} else if (no && words.length) {
				waiting.push({ floor, group, no, words, page, line: rawLine.trim() });
			} else if (!words.length && (sizes.length || (no && typed))) {
				// sizes only (a type before them or not): the oldest room waiting for its sizes takes them
				const all = no ? [Number(no), ...sizes] : sizes;
				const w = waiting.shift();
				if (w) raws.push({ floor: w.floor, group: w.group, no: w.no, name: w.words.map(word).join(" ").trim(), nums: all, page: w.page, line: `${w.line} | ${rawLine.trim()}` });
				else if (typed) unread.push({ page, line: rawLine.trim() });
			} else if (typed) unread.push({ page, line: rawLine.trim() });
		}
	});
	for (const w of waiting) unread.push({ page: w.page, line: w.line });
	waiting = [];
	// the usual height of each page: the most common number that can be a height
	const usual = new Map<number, number>();
	for (const p of new Set(raws.map((r) => r.page))) {
		const count = new Map<number, number>();
		for (const r of raws.filter((x) => x.page === p)) for (const n of r.nums) if (n >= 2 && n <= 6) count.set(n, (count.get(n) ?? 0) + 1);
		const top = [...count].sort((a, b) => b[1] - a[1])[0];
		if (top) usual.set(p, top[0]);
	}
	const grp = (r: Raw) => (r.group ? { group: r.group } : {});
	const rows: RoomRow[] = raws.map((r) => {
		// a trailing small whole number after the height is the "patvaļīgas būvniecības pazīme" column, not a size
		const nums = r.nums.length > 2 ? r.nums.slice(0, 2) : r.nums;
		if (nums.length === 1) return { floor: r.floor, ...grp(r), no: r.no, name: r.name, area: nums[0]!, height: null, page: r.page, quote: r.line };
		const h = usual.get(r.page) ?? 3;
		const [a, b] = nums as [number, number];
		const hi = Math.abs(a - h) < Math.abs(b - h) && a <= 6 ? 0 : 1;
		return { floor: r.floor, ...grp(r), no: r.no, name: r.name, area: hi === 0 ? b : a, height: hi === 0 ? a : b, page: r.page, quote: r.line };
	});
	return { rows, totals, unread };
}

/** Is this the VZD eksplikācija layout (rows with a room type, "Telpu grupas numurs")? */
export function isEksplikacija(pages: string[]): boolean {
	const t = pages.join("\n");
	return GROUP.test(t) && (t.match(new RegExp(TYPE.source, "gi"))?.length ?? 0) >= 3;
}
