// Shapes the renderer reads from the main process (see src/main/api.ts for the owner).
export type AgentEvent =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "turn"; n: number }
	| { type: "tool"; name: string; detail?: string; id?: string }
	| { type: "tool_result"; name: string; ok: boolean; detail?: string; id?: string; output?: string }
	| { type: "done"; text: string }
	| { type: "error"; engine: string; message: string };

export interface ProjectRow {
	root: string;
	missing: boolean;
	meta: { id: string; name: string; createdAt: string } | null;
	openPins?: number;
	openTasks?: number;
	revisions?: number;
	latest?: string | null;
	approved?: number;
	reviewItems?: number;
	setup?: "not started" | "in progress" | "complete";
	files?: number;
	factsProposed?: number;
	factsConfirmed?: number;
	gathered?: number;
	next?: { date: string; kind: string; title: string } | null;
}

export interface Rule {
	id: string;
	act: string;
	actId: string;
	article: string;
	url: string;
	read_on: string;
	valid_from: string | null;
	valid_to: string | null;
	applies_when: Record<string, string | number | boolean>;
	requires: string[];
	section: string | null;
	quote: string;
}

export interface RulesAll {
	rules: Rule[];
	verification: { ok: boolean; failures: { id: string; reason: string }[]; checked: number };
	acts: Record<string, { short: string; title: string }>;
	notRead: string[];
	pending: { act: string; item: string; from: string }[];
}

export interface Reread {
	checked: number;
	changed: { id: string; act: string; article: string }[];
	failed: { actId: string; reason: string }[];
}

export interface Answer<T> {
	value: T;
	because: string[];
	check: string[];
}

export interface Requirement {
	ruleId: string;
	section: string;
	item: string;
	article: string;
	quote: string;
}

export type ProjectRules = { ready: false; reason: string } | { ready: true; group: Answer<number>; procedure: Answer<string>; content: { items: Requirement[]; notes: string[] }; bim: boolean };

export type SectionId = "pu" | "data" | "tr" | "laws";

export type FactState = "open" | "proposed" | "confirmed" | "unknown";

export interface FactRow {
	id: string;
	label: string;
	state: FactState;
	value?: string;
	source?: { kind: "file" | "boris" | "unknown" | "rules"; path?: string; quote: string };
	by?: string;
}

export interface ScanFile {
	path: string;
	text: "ok" | "empty" | "unsupported" | "toolarge" | "error";
	chars: number;
	note?: string;
}

export interface ScanResult {
	at: string;
	found: number;
	registered: number;
	files: ScanFile[];
}

export interface GatherRun {
	section: SectionId;
	at: string;
	ok: boolean;
	summary: string;
	tools: number;
	error?: string;
}

export interface GatherState {
	scan: ScanResult | null;
	runs: Partial<Record<SectionId, GatherRun>>;
	running: SectionId | null;
}

/** Progress from a scan or an agent run (channel gather:event). */
export type GatherEvent =
	| { root: string; type: "scan"; done: number; total: number; path: string }
	| { root: string; type: "scan-done"; found: number }
	| { root: string; section: SectionId; type: "start" | "end"; ok?: boolean }
	| { root: string; section: SectionId; type: "failed"; reason: string }
	| { root: string; section: SectionId; type: "agent"; event: AgentEvent };

export interface Applicable {
	id: string;
	category: Category;
	sourceId: string;
	title: string;
	url: string | null;
	readOn: string;
	quote: string;
	why: string;
	by: string;
	confirmed: boolean;
}

export interface ProjectRef {
	category: Category;
	ref: string;
	path: string;
	quote: string;
	files: number;
	inLibrary: boolean;
}

export interface FileRec {
	path: string;
	role?: string;
	roleSource?: { by: string; quote: string; confirmed: boolean };
	status: "ok" | "changed" | "missing";
	versions: { sha256: string; size: number; at: string }[];
}

export interface Task {
	id: string;
	title: string;
	due: string | null;
	done: boolean;
}

export interface CalendarEntry {
	date: string;
	kind: string;
	title: string;
}

export interface TrRow {
	id: string;
	who: string;
	issuer: "state_municipal" | "network_owner";
	status: "pieprasīts" | "saņemts" | "nav pieprasīts";
	requestedOn: string | null;
	receivedOn: string | null;
	file: string | null;
	note: string;
	found?: { by: string; file: string; quote: string; confirmed: boolean };
	deadline: { due: string; holidaysExcluded: true; caveat: string } | null;
}

export type Source = { kind: "file"; path: string; quote: string } | { kind: "boris"; quote: string; at: string } | { kind: "unknown"; quote: string; at: string } | { kind: "rules"; rules: string[]; quote: string };

export interface ChecklistRow {
	id: string;
	label: string;
	hint: string;
	required: boolean;
	status: "filled" | "proposed" | "unknown" | "open";
	fact?: { value: string; source: Source };
}

export interface ChatState {
	messages: { at: string; role: "boris" | "agent"; text: string }[];
	completeness: { items: ChecklistRow[]; complete: boolean; blocked: string | null };
}

export type ReviewState = "new" | "commented" | "approved";

export interface Pin {
	id: string;
	revision: string;
	target: { kind: "pdf"; sheet: string; page: number; x: number; y: number; viewId: number | null } | { kind: "ifc"; guid: string };
	text: string;
	state: "open" | "addressed" | "closed";
	agentNote?: string;
}

export interface RevisionRow {
	id: string;
	createdAt: string;
	pages: number;
	approved: number;
	items: number;
	complete: boolean;
}

export interface RevisionData {
	manifest: { id: string; pages: { file: string; viewId: string; viewName: string; viewType: string }[]; model: string; prev: string | null } | null;
	review: { item: string; kind: "page" | "model"; state: ReviewState }[];
	diff: {
		against: string;
		ifc: { added: { guid: string; type: string }[]; removed: { guid: string; type: string }[]; moved: { guid: string; type: string; from: string; to: string }[]; changed: { guid: string; type: string }[] };
		rooms: { added: { name: string; areaM2: number }[]; removed: { name: string; areaM2: number }[]; areaChanged: { name: string; from: number; to: number }[] };
	} | null;
	summary: { rooms: { id: string; name: string; level: string; areaM2: number }[]; levels: { name: string; elevMm: number }[]; walls: number; floors: number } | null;
	pins: Pin[];
}

export interface LogEntry {
	seq: number;
	at: string;
	kind: string;
	by: string;
	data?: Record<string, unknown>;
}

export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface AppSettings {
	provider: string;
	model: string;
	effort: Effort | "";
	theme: "auto" | "light" | "dark";
	revitServerJs: string | null;
}

export interface ProviderStatus {
	id: string;
	label: string;
	auth: ("api_key" | "oauth")[];
	configured: boolean;
	method: string | null;
	keyUrl: string | null;
	reason: string;
}

export interface ModelInfo {
	id: string;
	name: string;
	reasoning: boolean;
	contextWindow: number;
	efforts: Effort[];
	defaultEffort: Effort;
	legacy: boolean;
	live: boolean;
	created?: number;
}

export type LoginNotice =
	| { provider: string; type: "url"; url: string }
	| { provider: string; type: "code"; userCode: string; url: string }
	| { provider: string; type: "info"; message: string }
	| { provider: string; type: "ask"; message: string }
	| { provider: string; type: "done" }
	| { provider: string; type: "error"; message: string };

export type Category = "likums" | "mk" | "lvs" | "es";

export interface LibSource {
	id: string;
	title: string;
	category: Category;
	kind: "builtin" | "url" | "file";
	url: string | null;
	file: string | null;
	readOn: string;
	paragraphs: number;
	changedOn?: string;
}

export interface LibHit {
	source: string;
	title: string;
	url: string | null;
	readOn: string;
	paragraph: string;
}

export type RevitState = { state: "not configured" } | { state: "not connected"; reason: string } | { state: "connected"; instances: { pid: number }[]; selectedPid: number | null };
