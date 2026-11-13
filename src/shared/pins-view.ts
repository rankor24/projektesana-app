// How the annotation view numbers and orders a file's pins (task 8.2). Pure, so the dot in 3D, the dot on the page and the
// row in the list always agree on the number.
import { COORD_GROUPS, PIN_INTENTS, TILE_IDS, type Markup, type Pin, type PinTarget } from "../core/model.js";
import type { FocusItem } from "./api.js";

export interface NumberedPin {
	pin: Pin;
	/** 1-based, by creation time among this file's pins: it never changes when another pin closes */
	n: number;
}

const RANK = { open: 0, resolved: 1, closed: 2 } as const;

export function numbered(pins: Pin[]): NumberedPin[] {
	return [...pins].sort((a, b) => a.at.localeCompare(b.at)).map((pin, i) => ({ pin, n: i + 1 }));
}

/** Open first (oldest first: they wait longest), then resolved ones waiting for the user, closed last. */
export function listOrder(items: NumberedPin[]): NumberedPin[] {
	return [...items].sort((a, b) => RANK[a.pin.state] - RANK[b.pin.state] || a.n - b.n);
}

// ---- comments on any page (task 9.4): what a pin can point at, checked; how it reads to the agent; how it becomes a task ----

export type TargetKind = "page" | "element" | Extract<PinTarget, { thing: string }>["thing"];
export const targetKind = (t: PinTarget): TargetKind => ("elementGuid" in t ? "element" : "thing" in t ? t.thing : "page");

const frac = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** What the store knows, for the kinds that point at a stored thing (an unknown requirement or finding is refused). */
export interface Known {
	requirements?: ReadonlySet<string>;
	findings?: ReadonlySet<string>;
}

/** The problem with a target in words, or null when it is fine. Element and page targets keep their old rules (core/pins.ts). */
export function checkTarget(t: PinTarget, known: Known = {}): string | null {
	if (!t || typeof t !== "object") return "Nederīga piezīmes vieta.";
	if (!("thing" in t)) return null;
	switch (t.thing) {
		case "cell":
			if (!text(t.model)) return "Koordinācijas šūnai vajag modeli.";
			return (COORD_GROUPS as readonly string[]).includes(t.group) ? null : `Šūna nav zināma: grupa ${String(t.group)} (${COORD_GROUPS.join(", ")}).`;
		case "change": {
			if (!text(t.version)) return "Izmaiņai vajag versijas rindu.";
			if (t.side !== "A" && t.side !== "B") return "Izmaiņas puse ir A vai B.";
			const r = t.region;
			if (r === undefined) return null;
			return frac(r?.x) && frac(r?.y) && frac(r?.w) && frac(r?.h) && r.w > 0 && r.h > 0 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9 ? null : "Apgabals ir ārpus lapas (0–1, no augšas kreisās malas).";
		}
		case "room":
			return text(t.no) ? null : "Telpai vajag numuru.";
		case "fact":
			return text(t.key) ? null : "Faktam vajag atslēgu.";
		case "tile":
			return (TILE_IDS as readonly string[]).includes(t.id) ? null : `Kartīte nav zināma: ${String(t.id)}.`;
		case "item":
			return text(t.delivery) && text(t.item) ? null : "Nodevuma punktam vajag nodevumu un punktu.";
		case "requirement":
			if (!text(t.id)) return "Prasībai vajag id.";
			return known.requirements && !known.requirements.has(t.id) ? `Prasība ${t.id} nav atrasta.` : null;
		case "finding":
			if (!text(t.id)) return "Atradumam vajag id.";
			return known.findings && !known.findings.has(t.id) ? `Atradums ${t.id} nav atrasts.` : null;
		default:
			return "Nezināms piezīmes veids.";
	}
}

export const MAX_MARKUP = 20;
export const MAX_FREE_POINTS = 200;

/** The problem with a pin's marks, or null: every point inside the page (view), the right number of points per shape. */
export function checkMarkup(m: unknown): string | null {
	if (m === undefined) return null;
	if (!Array.isArray(m)) return "Atzīmējumi ir saraksts.";
	if (m.length > MAX_MARKUP) return `Ne vairāk kā ${MAX_MARKUP} atzīmējumi vienai piezīmei.`;
	for (const [i, x] of (m as Markup[]).entries()) {
		const pts = x?.points;
		if (!Array.isArray(pts)) return `Atzīmējumam ${i + 1} nav punktu.`;
		if (x.shape === "line" || x.shape === "rect" || x.shape === "circle") {
			if (pts.length !== 2) return `${x.shape}: vajag tieši divus punktus.`;
		} else if (x.shape === "free") {
			if (pts.length < 2 || pts.length > MAX_FREE_POINTS) return `Brīvs zīmējums: 2 līdz ${MAX_FREE_POINTS} punkti.`;
		} else return `Nezināma forma: ${String((x as { shape?: unknown }).shape)}.`;
		for (const pt of pts) if (!Array.isArray(pt) || pt.length !== 2 || !frac(pt[0]) || !frac(pt[1])) return "Atzīmējuma punkts ir ārpus lapas (0–1).";
	}
	return null;
}

export const isIntent = (v: unknown): boolean => typeof v === "string" && (PIN_INTENTS as readonly string[]).includes(v);

const INTENT_WORD: Record<string, string> = { note: "piezīme", fix: "labot", correct: "pareizi ir", mark: "atzīmēt", colour: "krāsot", boundary: "robeža", accept: "pieņemt", reject: "noraidīt", override: "ignorēt ar pamatojumu", justify: "pamatojums", block: "apturēt", approve: "apstiprināt", "move-date": "pārcelt datumu" };

/** Where a pin is, as the agent reads it (the pins block of every prompt) and as a row label. */
export function pinWhere(p: Pin): string {
	const t = p.target;
	if ("elementGuid" in t) return `elements ${t.elementGuid}${t.model ? ` modelī ${t.model}` : ""}`;
	if (!("thing" in t)) return `${t.sourceId ?? t.sheet ?? "lapa"}${t.page ? `, lpp. ${t.page}` : ""}`;
	switch (t.thing) {
		case "cell":
			return `koordinācijas šūna ${t.model} · ${t.group}`;
		case "change":
			return `izmaiņa ${t.version}, ${t.side} puse${t.region ? ", apgabals lapā" : ""}`;
		case "room":
			return `telpa ${t.no}${t.floor ? `, ${t.floor}. stāvs` : ""}`;
		case "fact":
			return `fakts ${t.key}`;
		case "tile":
			return `Pārskata kartīte ${t.id}`;
		case "item":
			return `nodevuma ${t.delivery} punkts ${t.item}`;
		case "requirement":
			return `prasība ${t.id}`;
		case "finding":
			return `atradums ${t.id}`;
	}
}

/** The intent and the marks, for the agent: "[labot] … · 2 atzīmējumi (rect, free)". */
export function pinMeaning(p: Pin): string {
	const i = p.intent && p.intent !== "note" ? `[${INTENT_WORD[p.intent] ?? p.intent}] ` : "";
	const m = p.markup?.length ? ` · ${p.markup.length} atzīmējumi (${[...new Set(p.markup.map((x) => x.shape))].join(", ")})` : "";
	return `${i}${p.text}${m}`;
}

/** A comment as a Fokuss item: what "→ aģentam" and a click on a pin put in front of the agent, whatever page it is from. */
export function pinFocus(p: Pin): FocusItem {
	return { kind: "pin", id: p.id, label: p.text.slice(0, 50), data: { state: p.state, where: pinWhere(p), target: p.target, ...(p.intent ? { intent: p.intent } : {}), ...(p.markup?.length ? { markup: p.markup } : {}) } };
}

/** A comment as a task (one click): its text as the title, the pin and what it was about as the links. */
export function pinTaskInput(p: Pin): { title: string; note: string; refs: { pinId: string; findingId?: string } } {
	const t = p.target;
	const finding = p.findingId ?? ("thing" in t && t.thing === "finding" ? t.id : undefined);
	return { title: pinMeaning({ ...p, markup: undefined }).slice(0, 120), note: pinWhere(p), refs: { pinId: p.id, ...(finding ? { findingId: finding } : {}) } };
}
