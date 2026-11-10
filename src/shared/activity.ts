// What the agent (and the app's own background work) is doing, in words a person reads. Shared by the main process,
// which turns RunEvents and scan progress into lines (main/activity.ts), and the window, which shows them (the dock's
// run card and the status strip). Pattern from konkurss-app src/shared/activity.ts: one line per thing that happens,
// and lines with the same `step` are one thing that changes (a tool call going from running to finished).

/** What a step does, from the person's point of view. */
export type ActKind = "read" | "search" | "write" | "check" | "revit" | "ui" | "other";

export type ActStatus = "running" | "ok" | "failed" | "stopped";

/** A fact the agent proposed with set_fact: what, and where it read it. */
export interface FactRef {
	key: string;
	value: string;
	sourceId: string;
	page: number | null;
	quote: string;
}

/** One source a run touched. `reading` = a call on it is going now. */
export interface SourceChip {
	id: string;
	title: string;
	state: "reading" | "read" | "failed";
	/** facts proposed from it that the code accepted */
	facts: number;
}

/** What a run changed in the project, counted from write tools that succeeded. */
export interface Changes {
	facts: number;
	requirements: number;
	pins: number;
	notes: number;
	revit: number;
}

export interface RunSummary {
	/** tool calls so far */
	steps: number;
	/** sources the run listed (list_sources, counted in the project's store); null = it did not list them */
	listed: number | null;
	sources: SourceChip[];
	changes: Changes;
}

export interface Activity {
	/** one run; every line of it carries the same id */
	run: string;
	project: string | null;
	/** "agent" = a model run; "app" = the app's own work (scanning the project folder) */
	who: "agent" | "app";
	at: string;
	kind: "start" | "thinking" | "tool" | "answer" | "note" | "confirm" | "summary" | "done" | "error";
	text: string;
	/** the full text behind the line: the whole task for "start", the reasoning or answer so far, a tool's input and result */
	detail?: string;
	/** lines with the same step replace each other */
	step?: string;
	tool?: ActKind;
	status?: ActStatus;
	/** set_fact: the proposed fact, so the window can show the quote and open the page */
	fact?: FactRef;
	/** a step about one source: the window can open it */
	source?: { id: string; page?: number };
	/** kind "summary": the run's counters (one line per run, replaced as they change) */
	summary?: RunSummary;
	/** scan progress: done of total */
	progress?: { done: number; total: number };
	/** a tool's whole answer in characters: what it costs the context */
	chars?: number;
}

/** The app's own tools: what each one is called on screen, and what kind of step it is. */
export const TOOLS: Record<string, { words: string; kind: ActKind }> = {
	list_sources: { words: "Skatās avotu sarakstu", kind: "read" },
	read_source: { words: "Lasa avotu", kind: "read" },
	search_sources: { words: "Meklē avotos", kind: "search" },
	search_law: { words: "Meklē normatīvos", kind: "search" },
	get_profile: { words: "Skatās projekta profilu", kind: "read" },
	extract_candidates: { words: "Meklē kandidātus", kind: "search" },
	set_fact: { words: "Iesaka faktu", kind: "write" },
	read_notes: { words: "Lasa atmiņu", kind: "read" },
	write_note: { words: "Raksta atmiņā", kind: "write" },
	list_deliveries: { words: "Skatās nodevumus", kind: "read" },
	list_rooms: { words: "Skatās inventarizācijas telpas", kind: "read" },
	get_focus: { words: "Skatās fokusu", kind: "read" },
	list_requirements: { words: "Skatās prasības", kind: "read" },
	add_requirement: { words: "Pievieno prasību", kind: "write" },
	propose_justification: { words: "Iesaka pamatojumu", kind: "write" },
	list_findings: { words: "Skatās atradumus", kind: "read" },
	run_check: { words: "Palaiž pārbaudi", kind: "check" },
	list_pins: { words: "Skatās piezīmes", kind: "read" },
	add_pin: { words: "Pievieno piezīmi", kind: "write" },
	add_comment: { words: "Komentē piezīmi", kind: "write" },
	resolve_pin: { words: "Atrisina piezīmi", kind: "write" },
	list_skills: { words: "Skatās prasmes", kind: "read" },
	read_skill: { words: "Ielādē instrukcijas", kind: "read" },
	open_panel: { words: "Atver paneli", kind: "ui" },
	show_source: { words: "Rāda avotu", kind: "ui" },
	highlight: { words: "Iezīmē modelī", kind: "ui" },
	draw_sketch: { words: "Zīmē skici", kind: "ui" },
	export_room_table: { words: "Eksportē telpu tabulu", kind: "revit" },
	revit_view_geometry: { words: "Nolasa skata ģeometriju", kind: "revit" },
	revit_export_pdf: { words: "Eksportē PDF", kind: "revit" },
	revit_export_ifc: { words: "Eksportē IFC", kind: "revit" },
	revit_save_copy: { words: "Saglabā darba kopiju", kind: "revit" },
	revit_create_plans: { words: "Veido plānus", kind: "revit" },
	revit_set_view_scale: { words: "Maina skata mērogu", kind: "revit" },
	revit_create_elevations: { words: "Veido fasādes", kind: "revit" },
	revit_create_sheet: { words: "Veido lapu", kind: "revit" },
};

export const KIND_LABEL: Record<ActKind | "thinking", string> = {
	read: "Lasa",
	search: "Meklē",
	write: "Raksta",
	check: "Pārbauda",
	revit: "Revit",
	ui: "Rāda",
	other: "Rīks",
	thinking: "Domā",
};

/** The MCP tool name may arrive as `mcp__projektesana-tools__read_source` or plain `read_source`; keep the last part. */
export const baseName = (name: string) => name.split(/__/).pop() ?? name;

export const oneLine = (s: string, max: number) => {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * One field of a tool's input. The input arrives as JSON cut at a fixed length (agent/pi/events.ts INPUT_MAX), so a
 * long quote can leave it unparseable: then the field is read with a pattern that also takes an unterminated string.
 */
export function field(detail: string | undefined, name: string): string | number | undefined {
	if (!detail) return undefined;
	try {
		const v = (JSON.parse(detail) as Record<string, unknown>)[name];
		return typeof v === "string" || typeof v === "number" ? v : undefined;
	} catch {
		const num = new RegExp(`"${name}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(detail);
		if (num) return Number(num[1]);
		const str = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)("?)`).exec(detail);
		if (!str) return undefined;
		const raw = str[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
		return str[2] ? raw : `${raw}…`;
	}
}

const str = (v: string | number | undefined) => (v === undefined ? "" : String(v));

/** The fact a set_fact call proposes, from its input; null when the input does not carry the key. */
export function factOf(detail: string | undefined): FactRef | null {
	const key = str(field(detail, "key"));
	if (!key) return null;
	const page = field(detail, "page");
	return { key, value: str(field(detail, "value")), sourceId: str(field(detail, "sourceId")), page: typeof page === "number" ? page : null, quote: str(field(detail, "quote")) };
}

/** The source a tool call is about, by id: read_source/extract_candidates take `id`, set_fact/show_source `sourceId`. */
export function sourceIdOf(name: string, detail: string | undefined): string | null {
	const b = baseName(name);
	if (b === "read_source" || b === "extract_candidates") return str(field(detail, "id")) || null;
	if (b === "set_fact" || b === "show_source") return str(field(detail, "sourceId")) || null;
	return null;
}

/**
 * The line for a tool call: its words and what it is about. `title` turns a source id into the source's title (main has
 * the store); an id it does not know is shown as it is.
 */
export function toolLine(name: string, detail: string | undefined, title: (sourceId: string) => string | null): { text: string; kind: ActKind } {
	const b = baseName(name);
	const own = TOOLS[b];
	// the only other tools server is Revit's (agent/pi/mcp.ts keeps the servers' plain tool names)
	if (!own) return { text: `Revit: ${b}`, kind: "revit" };
	const sid = sourceIdOf(name, detail);
	const src = sid ? (title(sid) ?? sid) : "";
	let target = "";
	switch (b) {
		case "read_source": {
			const pages = str(field(detail, "pages"));
			target = pages ? `${src} · lpp. ${pages}` : src;
			break;
		}
		case "extract_candidates":
			target = src;
			break;
		case "set_fact": {
			const f = factOf(detail);
			target = f ? `${f.key} = ${oneLine(f.value, 60)}` : "";
			break;
		}
		case "show_source": {
			const page = field(detail, "page");
			target = page ? `${src} · lpp. ${page}` : src;
			break;
		}
		case "search_sources":
		case "search_law":
			target = str(field(detail, "q")) ? `«${oneLine(str(field(detail, "q")), 60)}»` : "";
			break;
		case "list_sources":
			target = str(field(detail, "role"));
			break;
		case "run_check":
		case "list_findings":
			target = str(field(detail, "checkId"));
			break;
		case "read_skill":
			target = str(field(detail, "name"));
			break;
		case "open_panel":
			target = str(field(detail, "name"));
			break;
		default: {
			// the first short text the input carries, e.g. a requirement's text or a note's title
			const t = str(field(detail, "title")) || str(field(detail, "text")) || str(field(detail, "reason")) || str(field(detail, "note"));
			target = t ? oneLine(t, 60) : "";
		}
	}
	return { text: target ? `${own.words}: ${target}` : own.words, kind: own.kind };
}

/** The first line of the model's reasoning, without markdown emphasis: what it is thinking about. */
export const thinkingLine = (text: string) => oneLine(text.replace(/[*_`#]+/g, "").split("\n").find((l) => l.trim()) ?? "", 100) || "…";

/** Streamed answer text is shown in the chat; here only how much has been written. */
export const answerLine = (chars: number) => `Raksta atbildi — ${chars.toLocaleString("lv-LV")} zīmes`;

/** The run's title: the task template's label when the text is one of them, else the first line of what was asked. */
export function taskTitle(prompt: string, templates: readonly { label: string; text: string }[] = []): string {
	const t = prompt.trim();
	const tpl = templates.find((x) => t === x.text.trim() || t.startsWith(x.text.trim()));
	if (tpl) return tpl.label;
	const line = t.split("\n").find((l) => l.trim()) ?? "";
	return oneLine(line, 90) || "Uzdevums";
}

/** Lines in the order they happened. A line with a step replaces the earlier line of that run and step. Keeps the last `max`. */
export function addActivity(list: Activity[], a: Activity, max = 600): Activity[] {
	const at = a.step ? list.findIndex((x) => x.run === a.run && x.step === a.step) : -1;
	const next = at >= 0 ? list.map((x, i) => (i === at ? a : x)) : [...list, a];
	return next.length > max ? next.slice(-max) : next;
}

/** The lines of each run, runs in the order they started. */
export function groupRuns(list: Activity[]): { run: string; lines: Activity[] }[] {
	const out = new Map<string, Activity[]>();
	for (const a of list) {
		const g = out.get(a.run);
		if (g) g.push(a);
		else out.set(a.run, [a]);
	}
	return [...out].map(([run, lines]) => ({ run, lines }));
}

/** A run is going until a line says it is done or failed. */
export const isRunning = (lines: Activity[]) => lines.length > 0 && !lines.some((l) => l.kind === "done" || l.kind === "error");

export const CHANGE_LABEL: Record<keyof Changes, [string, string]> = {
	facts: ["fakts ieteikts", "fakti ieteikti"],
	requirements: ["prasība", "prasības"],
	pins: ["piezīme", "piezīmes"],
	notes: ["atmiņas ieraksts", "atmiņas ieraksti"],
	revit: ["Revit partija", "Revit partijas"],
};

/** "4 fakti ieteikti · 1 prasība", only what is not zero; "" when the run changed nothing. */
export function changesText(c: Changes): string {
	return (Object.keys(CHANGE_LABEL) as (keyof Changes)[])
		.filter((k) => c[k] > 0)
		.map((k) => `${c[k]} ${c[k] === 1 ? CHANGE_LABEL[k][0] : CHANGE_LABEL[k][1]}`)
		.join(" · ");
}
