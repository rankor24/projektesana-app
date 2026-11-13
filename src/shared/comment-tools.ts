// Comment tools per page (task 9.4): how the user gives the direction of fixes on whatever page he is on. One palette, each
// page configures its own tools; every tool makes a pin (a comment on a thing the page shows) with an intent the agent reads
// ("[labot] …"), and the next prompt carries it. Pure and node-free: the palette and the tests use the same table.
import type { Markup, PinIntent, PinTarget } from "../core/model.js";
import { checkMarkup, checkTarget, targetKind, type TargetKind } from "./pins-view.js";

export interface CommentTool {
	id: string;
	label: string;
	hint: string;
	intent: PinIntent;
	/** the kinds of thing it can be used on (the page's selection) */
	on: TargetKind[];
	/** the text is the content ("pareizi ir…", the new date): empty text is refused */
	needsText: boolean;
	/** the tool also takes marks drawn on the page (2D) or over the view (3D) */
	marks?: Markup["shape"][];
	/** only on this group of a coordination cell */
	group?: string;
}

const NOTE = (id: string, on: TargetKind[], label = "Piezīme", hint = "Piezīme pie izvēlētā"): CommentTool => ({ id, label, hint, intent: "note", on, needsText: true });

/** The tools on every page, by page id (shared/pages.ts) — the model viewer has its own, below. */
export const TOOLS_BY_PAGE: Record<string, CommentTool[]> = {
	parskats: [
		NOTE("tile-note", ["tile", "fact"], "Piezīme kartītei", "Piezīme pie kartītes vai fakta"),
		{ id: "fix-value", label: "Labot vērtību", hint: "Fakta vērtība, kas jālabo (ieraksti pareizo)", intent: "fix", on: ["fact"], needsText: true },
		{ id: "move-date", label: "Pārcelt datumu", hint: "Kartīte, kuras datums jāpārceļ (ieraksti jauno)", intent: "move-date", on: ["tile"], needsText: true },
	],
	koordinacija: [
		NOTE("cell-note", ["cell"], "Piezīme šūnai", "Piezīme pie koordinācijas šūnas"),
		{ id: "storey-mark", label: "Atzīmēt stāvu", hint: "Atzīmē stāvu šūnā Stāvi", intent: "mark", on: ["cell"], needsText: true, group: "Stāvi" },
		{ id: "correct", label: "Pareizi ir…", hint: "Ieraksti, kāda vērtība ir pareiza", intent: "correct", on: ["cell"], needsText: true },
	],
	versijas: [
		{ id: "region-note", label: "Apgabals", hint: "Apgabals izmaiņā: velc taisnstūri lapā un uzraksti", intent: "note", on: ["change"], needsText: true, marks: ["rect"] },
		{ id: "accept-change", label: "Pieņemt izmaiņu", hint: "Izmaiņa ir pareiza", intent: "accept", on: ["change"], needsText: false },
		{ id: "reject-change", label: "Noraidīt izmaiņu", hint: "Izmaiņa nav pareiza: raksti, kāpēc", intent: "reject", on: ["change"], needsText: true },
	],
	telpas: [
		{ id: "colour-room", label: "Krāsot telpu", hint: "Telpa, kuru aģentam jāiekrāso modelī vai uz plāna", intent: "colour", on: ["room"], needsText: false },
		{ id: "boundary", label: "Robeža", hint: "Zīmē telpas robežu un uzraksti", intent: "boundary", on: ["room"], needsText: true, marks: ["free", "rect"] },
		NOTE("room-note", ["room"], "Piezīme telpai"),
	],
	nodevumi: [
		NOTE("item-note", ["item"], "Piezīme punktam"),
		{ id: "block", label: "Apturēt", hint: "Punkts aptur nodevumu: raksti, kāpēc", intent: "block", on: ["item"], needsText: true },
		{ id: "approve", label: "Apstiprināt", hint: "Punkts ir kārtībā", intent: "approve", on: ["item"], needsText: false },
	],
	prasibas: [
		{ id: "justify", label: "Pamatojums", hint: "Pamatojums atradumam vai prasībai", intent: "justify", on: ["finding", "requirement"], needsText: true },
		{ id: "accept", label: "Pieņemt", hint: "Pieņem aģenta priekšlikumu", intent: "accept", on: ["finding", "requirement"], needsText: false },
		{ id: "override", label: "Ignorēt", hint: "Ignorē ar pamatojumu (pārbaude netiek mainīta)", intent: "override", on: ["finding", "requirement"], needsText: true },
	],
};

/** The model viewer's own tools (3D): a pin with the camera, marks over the view, a sketch for the agent (the viewer bar). */
export const VIEWER_TOOLS: CommentTool[] = [
	{ id: "pin", label: "Piezīme", hint: "Piezīme pie elementa (ar kameru)", intent: "note", on: ["element", "page"], needsText: true },
	{ id: "line", label: "Līnija", hint: "Līnija pāri skatam", intent: "mark", on: ["element", "page"], needsText: true, marks: ["line"] },
	{ id: "circle", label: "Aplis", hint: "Aplis ap vietu", intent: "mark", on: ["element", "page"], needsText: true, marks: ["circle"] },
	{ id: "rect", label: "Taisnstūris", hint: "Taisnstūris ap vietu", intent: "mark", on: ["element", "page"], needsText: true, marks: ["rect"] },
	{ id: "free", label: "Zīmēt", hint: "Brīvs zīmējums", intent: "mark", on: ["element", "page"], needsText: true, marks: ["free"] },
];

export const pagesWithTools = (): string[] => Object.keys(TOOLS_BY_PAGE);
export const toolsFor = (page: string): CommentTool[] => TOOLS_BY_PAGE[page] ?? [];

/** What stops a tool being used on this selection, in words; null = fine. */
export function toolProblem(tool: CommentTool, subject: PinTarget | null, text: string): string | null {
	if (!subject) return "Vispirms izvēlies, pie kā komentārs: klikšķini rindu, šūnu vai kartīti.";
	const kind = targetKind(subject);
	if (!tool.on.includes(kind)) return `${tool.label}: šo rīku lieto uz ${tool.on.join(" / ")}, izvēlēts ir ${kind}.`;
	if (tool.group && "thing" in subject && subject.thing === "cell" && subject.group !== tool.group) return `${tool.label}: izvēlies šūnu grupā ${tool.group}.`;
	if (tool.needsText && text.trim().length < 2) return `${tool.label}: ieraksti tekstu.`;
	return null;
}

export interface BuiltPin {
	target: PinTarget;
	text: string;
	opts: { intent: PinIntent; markup?: Markup[] };
}

/**
 * The pin a tool makes on a selection. A tool with no text uses its own label as the text ("Pieņemt izmaiņu"); a region tool
 * puts its first rectangle into the change's region. Returns a problem in words when it cannot be made.
 */
export function buildPin(tool: CommentTool, subject: PinTarget | null, text: string, markup: Markup[] = []): BuiltPin | string {
	const bad = toolProblem(tool, subject, text);
	if (bad) return bad;
	let target = subject as PinTarget;
	const marks = tool.marks ? markup.filter((m) => tool.marks!.includes(m.shape)) : [];
	if (tool.id === "region-note" && "thing" in target && target.thing === "change") {
		const r = marks.find((m) => m.shape === "rect");
		if (!r) return `${tool.label}: velc taisnstūri lapā.`;
		const [[x0, y0], [x1, y1]] = r.points;
		target = { ...target, region: { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) } };
	}
	const t = text.trim() || tool.label;
	const prob = checkTarget(target) ?? checkMarkup(marks.length ? marks : undefined);
	return prob ? prob : { target, text: t, opts: { intent: tool.intent, ...(marks.length ? { markup: marks } : {}) } };
}
