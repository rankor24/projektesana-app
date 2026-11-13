// What an agent tool asks the window to do (open a panel, show a source, act on the viewer). The tools server is its own
// process; its tool result carries the instruction and the chat dock carries it out. Viewer actions (task 9.5) change only
// the view, never the model or any project data; the run card keeps them as chips the user can press again.

export const PANEL_NAMES = ["projekts", "parskats", "faili", "grafiks", "avoti", "prasibas", "telpas", "nodevumi", "atmina", "versijas", "koordinacija", "normativi"] as const;

/** One thing done to the viewer. The guids are IFC GlobalIds. */
export type ViewerAction =
	| { action: "fly_to"; pin?: string; guid?: string }
	| { action: "select"; guids: string[] }
	/** an empty list shows everything again */
	| { action: "isolate"; guids: string[]; ghost?: boolean }
	/** by the value of a property or attribute, with a legend; an empty property clears the colours */
	| { action: "colour"; property: string; guids?: string[] }
	/** two angles of the open model, or two files (source ids) side by side */
	| { action: "split"; dir?: "h" | "v"; a?: string; b?: string };

export interface UiInstruction {
	open_panel?: { name: (typeof PANEL_NAMES)[number]; filter?: string };
	highlight?: { guids: string[]; note?: string };
	show_source?: { sourceId: string; page?: number };
	viewer?: ViewerAction;
}

export const MAX_GUIDS = 500;
export const MAX_PROPERTY = 80;

const guidList = (g: unknown, allowEmpty: boolean): string | null =>
	!Array.isArray(g) || g.some((x) => typeof x !== "string" || !x.trim())
		? "guids: a list of GlobalIds"
		: g.length > MAX_GUIDS
			? `guids: at most ${MAX_GUIDS}`
			: !allowEmpty && g.length === 0
				? "guids: at least one"
				: null;

/** The problem with a viewer action in words, or null when it can be carried out. */
export function checkViewerAction(a: ViewerAction): string | null {
	switch (a?.action) {
		case "fly_to": {
			const n = Number(typeof a.pin === "string" && a.pin.length > 0) + Number(typeof a.guid === "string" && a.guid.length > 0);
			return n === 1 ? null : "fly_to: give a pin or an element GlobalId, one of them";
		}
		case "select":
			return guidList(a.guids, false);
		case "isolate":
			return guidList(a.guids, true);
		case "colour":
			if (typeof a.property !== "string" || a.property.length > MAX_PROPERTY) return `colour: a property name up to ${MAX_PROPERTY} characters (empty clears)`;
			return a.guids === undefined ? null : guidList(a.guids, false);
		case "split":
			if (a.dir !== undefined && a.dir !== "h" && a.dir !== "v") return "split: dir is h or v";
			if ((a.a === undefined) !== (a.b === undefined)) return "split: two files need both a and b (source ids)";
			return a.a !== undefined && (typeof a.a !== "string" || typeof a.b !== "string" || !a.a || !a.b || a.a === a.b) ? "split: two different source ids" : null;
		default:
			return "unknown viewer action";
	}
}

const plural = (n: number, one: string, many: string) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : many}`;

/** The chip on the run card: what the agent did to the view, in words ("Izolēt 3 elementus", "Krāsot pēc FireRating"). */
export function chipLabel(a: ViewerAction): string {
	switch (a.action) {
		case "fly_to":
			return a.pin ? `Uz piezīmi ${a.pin}` : "Uz elementu";
		case "select":
			return `Iezīmēt ${plural(a.guids.length, "elementu", "elementus")}`;
		case "isolate":
			return a.guids.length === 0 ? "Rādīt visu" : `${a.ghost ? "Izcelt" : "Izolēt"} ${plural(a.guids.length, "elementu", "elementus")}`;
		case "colour":
			return a.property ? `Krāsot pēc ${a.property}` : "Noņemt krāsas";
		case "split":
			return a.a ? "Divi faili blakus" : `Divi skati (${a.dir === "v" ? "virs" : "blakus"})`;
	}
}

/** The tool result: a short text for the model plus the instruction. */
export const uiResult = (text: string, ui: UiInstruction) => JSON.stringify({ ok: true, note: text, __ui: ui });

export function readUi(output: string | undefined): UiInstruction | null {
	if (!output || !output.includes("__ui")) return null;
	try {
		return (JSON.parse(output) as { __ui?: UiInstruction }).__ui ?? null;
	} catch {
		return null;
	}
}

export interface ViewerChip {
	/** 1-based, in the order the agent did them in this run */
	n: number;
	label: string;
	action: ViewerAction;
}

/**
 * The chips of one run: every successful viewer tool call, in order, from the call lines of the activity feed (a line's detail
 * is the tool's input, then "→ " and its result; the result carries the instruction). Failed calls give no chip.
 */
export function viewerChips(lines: { kind: string; status?: string; detail?: string }[]): ViewerChip[] {
	const out: ViewerChip[] = [];
	for (const l of lines) {
		if (l.kind !== "tool" || l.status === "failed" || !l.detail) continue;
		const result = l.detail.includes("\n\n→ ") ? l.detail.slice(l.detail.lastIndexOf("\n\n→ ") + 4) : l.detail;
		const a = readUi(result)?.viewer;
		if (a && checkViewerAction(a) === null) out.push({ n: out.length + 1, label: chipLabel(a), action: a });
	}
	return out;
}
