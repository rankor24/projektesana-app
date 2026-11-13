// The IPC contract: every method the renderer may call and every event main may send, with their types.
// main/api.ts must implement exactly API_NAMES (checked by test/0.4-ipc.test.ts); the preload exposes one invoke and one on.
// Types only from ../core/model (pure) and ./types, so the renderer can import this file.
import type { BimStage, Delivery, Fact, Finding, Note, NoteType, Pin, PinTarget, Project, Requirement, Revision, Source } from "../core/model.js";
import type { ProjectSummary } from "../core/summary-types.js";
import type { LoginNotice, RunEvent, Settings } from "./types.js";
import type { Activity } from "./activity.js";
import type { ChecklistRow, CopyPlan, StageSheetsResult } from "./nodevums.js";


export interface AppInfo {
	version: string;
	dataDir: string;
	platform: string;
}

export interface AgentStatus {
	provider: string;
	providerLabel: string;
	model: string;
	/** `nav pieslēgts` when the provider has no credential */
	signedIn: boolean;
	reason: string;
	revit: "nav savienojuma" | "savienots" | "nav konfigurēts";
	/** the chosen model takes images (screenshots); null = not known (not signed in, unknown model) */
	images: boolean | null;
	/** the model's own limits for images (from pi's catalog); null = it takes none, or the model is not known */
	imageLimits: { maxEdge: number; maxBytes: number; maxPerRequest: number | null; maxRequestBytes: number | null } | null;
}

/** What the next request carries and where the limits are. Numbers are tokens. */
export interface ContextInfo {
	window: number;
	/** compaction starts here: min(200K, 80% of the window) */
	compactAt: number;
	/** the context now; null = no conversation in memory yet (a new project, or the app was restarted) */
	used: number | null;
	/** `usage` = the provider's own count of the last prompt (+ an estimate of what came after); `estimate` = sizes alone */
	source: "usage" | "estimate" | "none";
	/** where it goes, by size; null when `used` is null */
	parts: { fixed: number; chat: number; docs: number; tools: number; images: number } | null;
	imageCount: number;
	messages: number;
	/** what every request carries before the user types (system prompt, rules, skills, the app's tool declarations); Revit's tools are added when connected */
	fixedEstimate: number;
	/** what the last run added to the context; null = not known */
	lastAdded: number | null;
	/** compactions of this conversation since the app started */
	compactions: number;
	/** what the message being typed would add, without files: the text, the Fokuss, the open pins */
	draft: { text: number; focus: number; pins: number } | null;
}

/** What one attached file will add to the context. */
export interface FileCost {
	kind: "image" | "document";
	tokens: number;
	pages?: number;
	/** a document longer than the limit per file: only the beginning goes */
	cut?: boolean;
	/** characters of the document text that go */
	chars?: number;
}

/** A file attached to a chat message, as the window sends it. */
export interface ChatAttachment {
	name: string;
	mimeType: string;
	/** the file's bytes, base64 (an image already downscaled by the window) */
	data: string;
	/** images: a small JPEG data URL the transcript keeps */
	thumb?: string;
}

/** What the transcript remembers of an attachment. */
export interface ChatAttachmentRef {
	name: string;
	kind: "image" | "document";
	thumb?: string;
}

/** One line of a project's chat transcript. A `compaction` line holds the summary that replaced the older conversation. */
export interface ChatEntry {
	role: "user" | "assistant";
	text: string;
	at: string;
	attachments?: ChatAttachmentRef[];
	kind?: "compaction";
	/** compaction: estimated context before and after */
	tokens?: { before: number; after: number };
}

export interface ProviderRow {
	id: string;
	label: string;
	auth: readonly ("api_key" | "oauth")[];
	configured: boolean;
	method?: string;
	keyUrl?: string;
	models: { id: string; name: string; legacy: boolean; efforts: string[]; defaultEffort: string }[];
}

/** What the agent receives as the Fokuss: what the user has selected in panels and the preview. */
export interface FocusItem {
	kind: "source" | "page-region" | "fact" | "requirement" | "finding" | "room" | "delivery" | "element" | "pin" | "note" | "sketch" | "text";
	id: string;
	label: string;
	/** details the agent needs, kept small */
	data?: Record<string, unknown>;
}

export interface ScanProgress {
	projectId: string;
	phase: "walk" | "hash" | "text" | "done" | "error";
	done: number;
	total: number;
	current?: string;
	message?: string;
}

export interface ProjectRow extends Project {
	missing: boolean;
	stage: BimStage | null;
	/** open errors and warnings: what needs action */
	openFindings: number;
	/** open info notes: shown, never red */
	openInfo: number;
}

export interface ScanSummaryRow {
	at: string;
	inputsRel: string | null;
	files: number;
	surveys: number;
	added: number;
	changed: number;
	gone: number;
	skipped: { archive: number; junk: number };
	problems: string[];
	folders: { folderKey: string; name: string; rel: string; role: string; roleFrom: "folder" | "confirmed" | "unconfirmed"; files: number }[];
}

export interface RoleQuestion {
	folderKey: string;
	folderName: string;
	proposed: string;
	files: number;
	options: readonly string[];
}

export interface InventoryTable {
	sourceId: string;
	title: string;
	rows: { floor: string; no: string; name: string; area: number; height: number | null; page: number }[];
	totals: { floor: string; stated: number; sum: number; ok: boolean }[];
	unread: { page: number; line: string }[];
}

export interface RevitStatusRow {
	state: "nav konfigurēts" | "nav savienojuma" | "savienots";
	document: string | null;
	activeView: string | null;
	version: string | null;
	message?: string;
	/** the MCP server the app starts, and how it was found */
	server?: { serverJs: string; node: string | null; source: "iestatījumi" | "automātiski" } | null;
}

/** Where the Faili tab can look (task 8.3): the office folder, the drafts' staging, the app's own data for the project. */
export interface FileRoot {
	key: "projekts" | "uzmetumi" | "dati";
	label: string;
	exists: boolean;
}

export interface FileEntry {
	name: string;
	/** relative to the root; "<container>::<inner>" for a file inside an .edoc / .asice */
	rel: string;
	kind: "dir" | "file";
	size: number | null;
	mtime: string | null;
	/** folder: files below it, counted by name (stops at 5 000: capped) */
	files?: number;
	capped?: boolean;
	/** the scan's source for this file, and its role (for a folder: the office folder map's role) */
	sourceId?: string;
	role?: string;
	roleFrom?: string;
	/** a container with files the scan registered inside it */
	inner?: number;
}

export interface FileList {
	entries: FileEntry[];
	/** entries not shown (the list is cut at 400; a search at 200) */
	hidden: number;
}

/** Where a model sits (task 8.1): the office tree's parts, a draft's staging folder, a captured revision. */
export type ModelOrigin = "izejas dati" | "projekta daļas" | "nodevumi" | "cits" | "uzmetums" | "revīzija";

export interface ModelRow {
	/** what the preview opens it by: a path under the project folder, an absolute path in the data folder, "src:<id>" or "rev:<id>" */
	rel: string;
	name: string;
	section: string | null;
	size: number;
	mtime: string;
	origin: ModelOrigin;
	/** in an arhīvs folder: older than the file kept in its section */
	archived: boolean;
}

/** The BimCraft copy the app ships (task 8.0): present, where from, and whether our bridge add-on is on. */
export interface BimcraftStatusRow {
	state: "gatavs" | "nav tilta" | "nav konfigurēts";
	dir: string;
	/** the checkout the build copied it from (SOURCE.txt) */
	source: string | null;
	copiedAt: string | null;
	/** pinned vendor libraries in the copy */
	vendor: number;
	addon: boolean;
	message?: string;
}

export interface RevitRoomRow {
	id: string;
	uniqueId: string;
	number: string;
	name: string;
	level: string;
	areaM2: number;
	phase: string;
}

export interface InvAreaRow {
	elementId: number;
	number: string;
	name: string;
	areaM2: number;
}

export interface RoomCompareRow {
	state: "ok" | "nav savienojuma" | "nav inventarizācijas";
	message?: string;
	inventory: number;
	model: number;
	matched: number;
	diffs: { kind: string; no: string; message: string; inventory?: { floor: string; no: string; name: string; area: number }; model?: { number: string; name: string; level: string; area: number; id: string }; delta?: number; tolerance?: number }[];
}

export interface ClockRow {
	id: string;
	kind: "tn" | "approval";
	issuer: string;
	issuerKind: "state_municipal" | "network_owner";
	requestedOn: string;
	extended: boolean;
	receivedOn: string | null;
	label: string;
	due: string;
	daysLeft: number;
	point: string;
	caveat: string;
	state: "gaida" | "kavē" | "saņemts";
}

export interface VersionRow {
	at: string;
	kind: "source" | "delivery" | "revision" | "data";
	label: string;
	detail?: string;
	/** compare A (older) → B (newer), when both exist */
	compare?: { a: string; b: string; mode: "sheet" | "ifc"; aLabel: string; bLabel: string };
	/** open in the preview */
	open?: { sourceId?: string; ifc?: string };
}

export interface SheetDiffRow {
	a: number;
	b: number;
	sheetNo: string | null;
	summary: string[];
	where: { x: number; y: number }[];
	frameA: { x0: number; y0: number; x1: number; y1: number } | null;
	frameB: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** The law library (global, in the app data): one act or standard. Same shape as rules/library.ts Source. */
export type LibraryCategory = "likums" | "mk" | "lvs" | "es";
export interface LibraryRow {
	id: string;
	title: string;
	category: LibraryCategory;
	kind: "builtin" | "url" | "file";
	url: string | null;
	file: string | null;
	/** ISO date the text was read */
	readOn: string;
	paragraphs: number;
	sha256: string;
	/** set by a re-read when the live text differs from what was saved */
	changedOn?: string;
}

/** One act or standard of data/applicable-acts.json, judged against the project's CONFIRMED profile facts. */
export interface ApplicableRow {
	id: string;
	title: string;
	category: LibraryCategory;
	/** likumi = free text on likumi.lv (one click to fetch); paid = LVS / EN / ISO standard, the user adds their own PDF */
	kind: "likumi" | "paid";
	url: string | null;
	actId: string | null;
	ref: string | null;
	catalogue: string | null;
	state: "attiecas" | "nav zināms" | "neattiecas";
	/** confirmed facts that make it apply */
	because: string[];
	/** conditions with no confirmed fact yet */
	missing: string[];
	/** confirmed facts that rule it out */
	notMatched: string[];
	/** the act's own paragraph that says what it covers */
	why: { act: string; actId: string; point: string; url: string; quote: string };
	caveat: string | null;
	inLibrary: { id: string; readOn: string; changedOn: string | null } | null;
	/** the quote found in the library text of the citing act; null = that act is not in the library */
	quoteFound: boolean | null;
}

export interface ApiSpec {
	"app.info": () => AppInfo;
	"settings.get": () => Settings;
	"settings.set": (patch: Partial<Settings>) => Settings;
	"dialog.pickFolder": (title: string) => string | null;
	"dialog.pickFile": (title: string, extensions: string[]) => string | null;
	"agent.status": () => AgentStatus;
	"agent.providers": () => ProviderRow[];
	"agent.setKey": (provider: string, key: string) => void;
	"agent.clearKey": (provider: string) => void;
	"agent.login": (provider: string) => void;
	"agent.loginAnswer": (text: string) => void;
	"agent.logout": (provider: string) => void;
	"agent.send": (projectId: string | null, text: string, focus: FocusItem[], attachments?: ChatAttachment[]) => { runId: string };
	"agent.stop": () => void;
	"agent.confirm": (confirmId: string, allow: boolean) => void;
	"agent.history": (projectId: string | null) => ChatEntry[];
	"agent.reset": (projectId: string | null) => void;
	"agent.context": (projectId: string | null, draft?: { text: string; focus: FocusItem[] }) => ContextInfo;
	"agent.measureFile": (attachment: ChatAttachment) => FileCost;
	/** Summarizes the older part of the conversation now (the same compaction that starts by itself at the limit). */
	"agent.compact": (projectId: string | null) => { before: number; after: number };
	/** The activity lines main still keeps (all projects, oldest first), for a window that opened or reloaded mid-run. */
	"activity.recent": () => Activity[];
	"projects.list": () => ProjectRow[];
	/** the dashboard: per project the stage, next delivery, open findings, closest clock, last scan and why it needs attention (task 8.4) */
	"projects.summaries": () => ProjectSummary[];
	"projects.add": (root: string) => ProjectRow;
	"projects.forget": (id: string) => void;
	"projects.scan": (id: string) => void;
	"projects.scanSummary": (id: string) => ScanSummaryRow | null;
	"projects.roleQuestions": (id: string) => RoleQuestion[];
	"projects.confirmRole": (id: string, folderKey: string, role: string) => void;
	/** the role of one document (wins over its folder's); null = back to the folder's role */
	"sources.setRole": (id: string, sourceId: string, role: string | null) => void;
	"sources.list": (id: string) => Source[];
	"sources.text": (id: string, sourceId: string) => { pages: string[]; state: string; reason?: string } | null;
	"sources.bytes": (id: string, sourceId: string) => Uint8Array;
	"sources.openOriginal": (id: string, sourceId: string) => void;
	"rooms.table": (id: string) => InventoryTable[];
	"facts.list": (id: string) => Fact[];
	"deliveries.list": (id: string) => Delivery[];
	"deliveries.prepare": (id: string, deliveryId: string) => { open: number };
	"deliveries.markSent": (id: string, deliveryId: string) => void;
	"deliveries.setPlanned": (id: string, deliveryId: string, date: string | null) => void;
	"deliveries.addPlanned": (id: string, kind: string, date: string) => void;
	/** "Nodot projektu": a draft delivery of this kind for this date (ISO), with its staging folder (7.1). */
	"deliveries.start": (id: string, kind: string, date: string) => Delivery;
	/** The draft's checklist (7.2); withRevit compares the staged sheets with the open model (answers within a few seconds or says why not). */
	"deliveries.checklist": (id: string, deliveryId: string, withRevit: boolean) => { rows: ChecklistRow[]; revitNote: string | null };
	/** Revit sheets → one PDF each into the draft's staging folder (7.3); all, or the listed sheet numbers. */
	"deliveries.stageSheets": (id: string, deliveryId: string, opts: { numbers?: string[]; replace?: boolean }) => StageSheetsResult;
	"deliveries.stageIfc": (id: string, deliveryId: string, opts: { part?: string; replace?: boolean }) => { file: string };
	/** A file the project has (a source, an export) copied into staging under a name. */
	"deliveries.stageFile": (id: string, deliveryId: string, from: string, name?: string) => { file: string };
	"deliveries.unstage": (id: string, deliveryId: string, name: string) => void;
	"deliveries.openStaging": (id: string, deliveryId: string) => void;
	/** Where "Kopēt uz 1.4_Nodevumi" would write and what stops it now (7.6). */
	"deliveries.copyPlan": (id: string, deliveryId: string) => CopyPlan;
	/** The user's click: copies the staged set into 1.4_Nodevumi<kind><YYMMDD>, then re-reads the deliveries. */
	"deliveries.copy": (id: string, deliveryId: string) => { target: string; files: number };
	"timeline.clocks": (id: string) => ClockRow[];
	"clocks.add": (id: string, c: { kind: "tn" | "approval"; issuer: string; issuerKind: "state_municipal" | "network_owner"; requestedOn: string }) => void;
	"clocks.update": (id: string, clockId: string, patch: { receivedOn?: string | null; extended?: boolean }) => void;
	"requirements.list": (id: string) => Requirement[];
	"requirements.notes": (id: string) => string[];
	"requirements.decide": (id: string, reqId: string, state: "confirmed" | "rejected") => void;
	"requirements.refresh": (id: string) => number;
	"findings.list": (id: string) => Finding[];
	"findings.override": (id: string, findingId: string, reason: string) => void;
	"findings.reopen": (id: string, findingId: string) => void;
	/** only info notes, BCF topics and closed findings; errors and warnings need a fix or a reason */
	"findings.remove": (id: string, findingId: string) => void;
	"findings.runAll": (id: string) => number;
	"bcf.export": (id: string, findingIds: string[] | null) => string;
	/** the project's pins on model elements as a BCF file (task 8.2); → the file */
	"bcf.exportPins": (id: string) => string;
	"bcf.import": (id: string, file: string) => { topics: number; byDiscipline: Record<string, number>; notes: string[] };
	"pins.list": (id: string) => Pin[];
	"pins.add": (id: string, target: PinTarget, text: string) => Pin;
	"pins.comment": (id: string, pinId: string, text: string) => void;
	"pins.close": (id: string, pinId: string) => void;
	"pins.reopen": (id: string, pinId: string) => void;
	"notes.list": (id: string, type?: NoteType) => Note[];
	"notes.write": (id: string, type: NoteType, title: string, body: string) => Note;
	"revit.status": () => RevitStatusRow;
	"revit.views": () => { id: string; name: string; type: string }[];
	"revit.exportView": (id: string, viewId: string, name: string) => string;
	"revit.exportIfc": (id: string) => string;
	"revit.workCopy": (id: string) => string;
	"revisions.capture": (id: string, summary: string, sheetIds: string[]) => Revision;
	"tasks.list": () => { id: string; label: string; text: string }[];
	"models.list": (id: string) => ModelRow[];
	"models.bytes": (id: string, rel: string) => Uint8Array;
	"revisions.list": (id: string) => Revision[];
	"sheets.bytes": (id: string, ref: string) => Uint8Array;
	"versions.between": (id: string, from: string, to: string) => VersionRow[];
	"sheets.diff": (id: string, a: string, b: string) => SheetDiffRow[];
	"bimcraft.status": () => BimcraftStatusRow;
	"files.roots": (id: string) => FileRoot[];
	"files.list": (id: string, root: FileRoot["key"], rel: string) => FileList;
	"files.search": (id: string, root: FileRoot["key"], q: string) => FileList;
	/** the file in the PC's own program, or a folder in Explorer */
	"files.open": (id: string, root: FileRoot["key"], rel: string) => void;
	"models.diff": (id: string, a: string, b: string) => { added: string[]; removed: string[]; changed: { guid: string; props: string[]; moved: number; reshaped: boolean }[]; same: number; dupes: number };
	"revisions.ifc": (id: string, revisionId: string) => Uint8Array;
	"revit.rooms": () => RevitRoomRow[];
	"revit.select": (elementIds: number[]) => void;
	"rooms.compare": (id: string) => RoomCompareRow;
	"rooms.invAreaPlan": (id: string) => InvAreaRow[];
	"rooms.geometry": (id: string, sourceId: string) => { page: number; floor: string | null; fractions: { x1: number; y1: number; x2: number; y2: number }[]; segments: number }[];
	"rooms.geometryCsv": (id: string, sourceId: string) => string;
	"rooms.writeInvArea": (id: string, items: InvAreaRow[]) => { written: number; noParam: string[] };
	"facts.decide": (id: string, factId: string, state: "confirmed" | "rejected") => void;
	"facts.setByUser": (id: string, key: string, value: string) => void;
	"rooms.exportXlsx": (id: string, sourceId: string) => string;
	"library.list": () => LibraryRow[];
	"library.paragraphs": (sourceId: string) => { source: LibraryRow; paragraphs: string[] };
	/** likumi.lv only; fetched in main, saved with its read date */
	"library.addUrl": (url: string, category: LibraryCategory, title?: string) => LibraryRow;
	/** a file the user owns (paid LVS / EN / ISO PDF); a copy is kept in the library */
	"library.addFile": (file: string, category: LibraryCategory, title?: string) => LibraryRow;
	"library.remove": (sourceId: string) => void;
	"library.reread": (sourceId: string) => { changed: boolean; source: LibraryRow };
	/** which acts apply to the project, from its confirmed profile facts and data/applicable-acts.json */
	"library.applicable": (id: string) => { rows: ApplicableRow[]; readOn: string; notRead: string };
}

export type ApiName = keyof ApiSpec;

/** Runtime list of the contract, so the test can hold main's handlers against it. */
export const API_NAMES = [
	"app.info",
	"settings.get",
	"settings.set",
	"dialog.pickFolder",
	"dialog.pickFile",
	"agent.status",
	"agent.providers",
	"agent.setKey",
	"agent.clearKey",
	"agent.login",
	"agent.loginAnswer",
	"agent.logout",
	"agent.send",
	"agent.stop",
	"agent.confirm",
	"agent.history",
	"agent.reset",
	"agent.context",
	"agent.measureFile",
	"agent.compact",
	"activity.recent",
	"projects.list",
	"projects.summaries",
	"projects.add",
	"projects.forget",
	"projects.scan",
	"projects.scanSummary",
	"projects.roleQuestions",
	"projects.confirmRole",
	"sources.setRole",
	"sources.list",
	"sources.text",
	"sources.bytes",
	"sources.openOriginal",
	"rooms.table",
	"facts.list",
	"deliveries.list",
	"deliveries.prepare",
	"deliveries.markSent",
	"deliveries.setPlanned",
	"deliveries.addPlanned",
	"deliveries.start",
	"deliveries.checklist",
	"deliveries.stageSheets",
	"deliveries.stageIfc",
	"deliveries.stageFile",
	"deliveries.unstage",
	"deliveries.openStaging",
	"deliveries.copyPlan",
	"deliveries.copy",
	"timeline.clocks",
	"clocks.add",
	"clocks.update",
	"requirements.list",
	"requirements.notes",
	"requirements.decide",
	"requirements.refresh",
	"findings.list",
	"findings.override",
	"findings.reopen",
	"findings.remove",
	"findings.runAll",
	"bcf.export",
	"bcf.exportPins",
	"bcf.import",
	"pins.list",
	"pins.add",
	"pins.comment",
	"pins.close",
	"pins.reopen",
	"notes.list",
	"notes.write",
	"revit.status",
	"revit.views",
	"revit.exportView",
	"revit.exportIfc",
	"revit.workCopy",
	"revisions.capture",
	"tasks.list",
	"models.list",
	"models.bytes",
	"revisions.list",
	"sheets.bytes",
	"versions.between",
	"sheets.diff",
	"models.diff",
	"bimcraft.status",
	"files.roots",
	"files.list",
	"files.search",
	"files.open",
	"revisions.ifc",
	"revit.rooms",
	"revit.select",
	"rooms.compare",
	"rooms.invAreaPlan",
	"rooms.geometry",
	"rooms.geometryCsv",
	"rooms.writeInvArea",
	"facts.decide",
	"facts.setByUser",
	"rooms.exportXlsx",
	"library.list",
	"library.paragraphs",
	"library.addUrl",
	"library.addFile",
	"library.remove",
	"library.reread",
	"library.applicable",
] as const satisfies readonly ApiName[];

// Compile-time check that API_NAMES lists every key of ApiSpec (and no other).
type Missing = Exclude<ApiName, (typeof API_NAMES)[number]>;
const _complete: [Missing] extends [never] ? true : Missing = true;
void _complete;

export interface EventSpec {
	"data.changed": { projectId: string | null; what: string[] };
	"agent.event": { runId: string; event: RunEvent };
	"agent.login": LoginNotice;
	"scan.progress": ScanProgress;
	/** What the agent or the folder scan is doing, as a line a person reads (shared/activity.ts). */
	activity: Activity;
}

export type EventName = keyof EventSpec;
export const EVENT_NAMES = ["data.changed", "agent.event", "agent.login", "scan.progress", "activity"] as const satisfies readonly EventName[];

export type Handlers = { [K in ApiName]: (...args: Parameters<ApiSpec[K]>) => ReturnType<ApiSpec[K]> | Promise<ReturnType<ApiSpec[K]>> };
