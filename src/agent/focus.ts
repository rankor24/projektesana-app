// The Fokuss: what Boris has selected in the panels and the preview, as the agent receives it.
// One serialisation for both places it is used: the header of every prompt and the get_focus tool.
import type { FocusItem } from "../shared/api.js";

export const FOCUS_NONE = "nekas";

const KIND_LABEL: Record<FocusItem["kind"], string> = {
	source: "avots",
	"page-region": "lapas apgabals",
	fact: "fakts",
	requirement: "prasība",
	finding: "atradums",
	room: "telpa",
	delivery: "nodevums",
	element: "modeļa elements",
	pin: "piezīme",
	note: "atmiņa",
	sketch: "skice",
	text: "iezīmēts teksts",
};

/** Small, stable, readable: one line per item, data as compact JSON. Long text is cut so the Fokuss cannot fill the context. */
export function focusText(items: FocusItem[]): string {
	if (!items.length) return `Fokuss: ${FOCUS_NONE}`;
	const lines = items.map((f) => {
		const data = f.data && Object.keys(f.data).length ? ` ${JSON.stringify(f.data).slice(0, 800)}` : "";
		return `- ${KIND_LABEL[f.kind]} [${f.kind}:${f.id}] ${f.label}${data}`;
	});
	return `Fokuss (${items.length}):\n${lines.join("\n")}`;
}

export function isFocusItem(x: unknown): x is FocusItem {
	const f = x as FocusItem;
	return !!f && typeof f === "object" && typeof f.id === "string" && typeof f.label === "string" && f.kind in KIND_LABEL;
}
