// The IPC contract: every method the renderer may call and every event main may send, with their types.
// main/api.ts must implement exactly API_NAMES (checked by test/0.4-ipc.test.ts); the preload exposes one invoke and one on.
// Types only from ../core/model (pure) and ./types, so the renderer can import this file.
import type { BimStage, Delivery, Fact, Finding, Markup, Note, NoteType, Pin, PinIntent, PinTarget, Project, Requirement, Revision, Source, Task, TaskPriority } from "../core/model.js";
import type { StageDates } from "./gantt.js";
import type { GrafikItem } from "./calendar.js";
import type { DrawingSet } from "./drawing-sets.js";
import type { ProjectDashboard, ProjectSummary } from "../core/summary-types.js";
import type { AuditReport, CoordReference, Declared } from "../core/coordination-types.js";
import type { UndoRow } from "../core/undo-types.js";
import type { TraceView } from "./trace-types.js";
import type { RenameMode, RenameResult, RenameRow } from "./rename.js";
import type { AgentSpec, AgentsView } from "./agent-types.js";
import type { SkillInfo } from "./skill-types.js";
import type { ExpertRemark, ExpertSummary, ImportResult, RemarkState, ReviewSource } from "./expert-types.js";
import type { LoginNotice, RunEvent, Settings } from "./types.js";
import type { Activity } from "./activity.js";
import type { QueueView, RoomLine, Thread, WaitingItem } from "./thread-types.js";
import type { ChecklistRow, CopyPlan, StageSheetsResult } from "./nodevums.js";
import type { LayoutStore } from "./layout.js";
import type { PlanStep } from "./plan.js";
import type { DwgCompare, DwgView } from "./compare2d.js";
import type { RelayMsg } from "./popout.js";
import type { PlanDoc } from "../core/model.js";
import type { ProcessState } from "../core/process.js";
import type { Depth, DocType, Stage } from "../core/process-def.js";


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
	draft: { text: number; focus: number; pins: number; plan: number } | null;
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
	/** how to get the key when there is no page for it (the Claude subscription: `claude setup-token`); also the field's placeholder */
	keyHelp?: string;
	models: { id: string; name: string; legacy: boolean; efforts: string[]; defaultEffort: string }[];
}

/** What the agent receives as the Fokuss: what the user has selected in panels and the preview. */
export interface FocusItem {
	kind: "source" | "page-region" | "fact" | "requirement" | "finding" | "room" | "delivery" | "element" | "pin" | "note" | "sketch" | "text" | "view";
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
	server?: { serverJs: string; node: string | null; source: "iestatījumi" | "automātiski" | "iekļauts" } | null;
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

/** The Revit tab: the .rvt files of the project folder (Revit's own backups counted, not listed) and the document open in Revit. */
export interface RevitFilesView {
	files: ModelRow[];
	backups: number;
	/** null = no Revit session answers; `rel` = the listed file it is ("path": Revit's path is that file, "name": only the name matches) */
	open: { title: string; path: string; rel: string | null; by: "path" | "name" | null } | null;
	/** why `open` is null, in words */
	message: string | null;
}

/** The coordination panel's one answer (task 8.9): the reference, the audit of the models against it, what a seeded reference
 *  leaves undecided, how many models there are and which could not be read, and why Revit is not in it when it is not. */
export interface CoordinationView {
	reference: CoordReference | null;
	audit: AuditReport | null;
	warnings: string[];
	models: number;
	/** the models that are measured, each with what models.bytes opens it by: the federated 3D of Koordinācija (9.8) shows them all */
	files: { file: string; key: string }[];
	errors: { file: string; message: string }[];
	revit: string | null;
}

/** What the model turns of a project used (task 8.7); cost = the known prices added, `priced` of `turns` had one. */
export interface UsageRow {
	project: string | null;
	runs: number;
	turns: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number | null;
	priced: number;
	lastAt: string;
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
	compare?: { a: string; b: string; mode: import("./compare2d.js").CompareMode; aLabel: string; bLabel: string };
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
	/** where each window is, per page (task 9.0): the renderer's own state, kept in the app's data folder */
	"layout.get": () => LayoutStore;
	/** `origin` names the window that saved: it is told "layout.changed" like the others, and ignores its own */
	"layout.set": (store: LayoutStore, origin?: string) => void;
	/** open the OS window of a layout window (a second monitor); closing it docks the window back (task 9.11) */
	"layout.popOut": (id: string) => void;
	/** close that OS window (the layout window was docked back in the main window) */
	"layout.popIn": (id: string) => void;
	/** a popped window asks the main window to do something (open a file in the viewer, fly the camera, go to a page) */
	"layout.relay": (msg: RelayMsg) => void;
	/** the plan above the chat input (task 9.2): the agent writes it with update_plan, the user edits it here */
	"plan.get": (id: string) => PlanDoc;
	"plan.set": (id: string, steps: PlanStep[]) => PlanDoc;
	"dialog.pickFolder": (title: string) => string | null;
	"dialog.pickFile": (title: string, extensions: string[]) => string | null;
	/** a rectangle of the app window as a PNG (the screen grab of the comment tools; CSS px of the window) */
	"screen.capture": (rect: { x: number; y: number; width: number; height: number }) => Uint8Array;
	"agent.status": () => AgentStatus;
	"agent.providers": () => ProviderRow[];
	"agent.setKey": (provider: string, key: string) => void;
	"agent.clearKey": (provider: string) => void;
	"agent.login": (provider: string) => void;
	"agent.loginAnswer": (text: string) => void;
	"agent.logout": (provider: string) => void;
	"agent.send": (projectId: string | null, text: string, focus: FocusItem[], attachments?: ChatAttachment[]) => { runId: string | null; queued: boolean };
	"agent.stop": () => void;
	/** What the start-up found left in flight, until the user answers; null when nothing waits for an answer. */
	"queue.restored": () => { interrupted: number; queued: number } | null;
	/** Go on: the restored queue starts, the interrupted threads wait their turn or are idle. */
	"queue.resumeInterrupted": () => void;
	/** Drop it: the restored items stay as stopped, the threads are idle. */
	"queue.discardInterrupted": () => void;
	/** The run table and the queue as they are now (the same view `queue.changed` sends). */
	"queue.view": () => QueueView;
	/** Nothing queued starts until resume; runs already going continue. */
	"queue.pause": () => void;
	"queue.resume": () => void;
	/** A wave stopped at a limit (Gaida tevi, "Turpināt"): its counts start again from zero and what it held back starts. */
	"queue.resumeWave": (wave: string) => void;
	/** Everything that waits for the user, of every project, not only the open one (Gaida tevi). */
	"waiting.list": () => WaitingItem[];
	/** The room (Telpa) of the project: one line per message, agreement, pass-up and paused wave, oldest first, the newest 300. */
	"room.lines": (projectId: string | null) => RoomLine[];
	/** Every thread of the project, newest first. */
	"threads.list": (projectId: string | null) => Thread[];
	/** A new thread with an agent: "lead" or a specialist's id. The title defaults to the specialist's name. */
	"threads.open": (projectId: string | null, agent: string, title?: string) => Thread;
	/** A message to one thread. Refused for a closed thread, a removed specialist, and a thread that is running or queued. */
	"threads.send": (threadId: string, projectId: string | null, text: string, focus: FocusItem[], attachments?: ChatAttachment[]) => { runId: string | null; queued: boolean };
	"threads.history": (threadId: string, projectId: string | null) => ChatEntry[];
	"threads.stop": (threadId: string) => void;
	/** Closes a thread (kept on disk); refused while it is running or queued. */
	"threads.close": (threadId: string, projectId: string | null) => Thread;
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
	/** the open project's own page (task 9.6): tiles, stage timeline, Jāizdara, Fakti, recent changes, folders, findings history */
	"projects.dashboard": (id: string) => ProjectDashboard;
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
	/** what the staged files would be called by the office convention (or BIS upload names), and which cannot be decided or collide (task 8.12) */
	"deliveries.renamePlan": (id: string, deliveryId: string, mode: RenameMode, revision?: string) => RenameRow[];
	/** renames inside the draft's staging folder only, never over a file; every rename is recorded so the batch can be taken back */
	"deliveries.renameApply": (id: string, deliveryId: string, pairs: { file: string; to: string }[]) => RenameResult;
	"deliveries.renameUndo": (id: string, deliveryId: string, batch: string) => { reverted: number; errors: string[] };
	/** the specialists the agent can delegate to (8.15), edited in Iestatījumi → Aģenti */
	"agents.list": () => AgentsView;
	"agents.save": (specs: AgentSpec[]) => AgentSpec[];
	/** the role text of an agent (agents\<id>.md), null without a file; set keeps the replaced text under versions (16 000 characters at most) */
	"agents.role.get": (id: string) => string | null;
	"agents.role.set": (id: string, text: string) => void;
	/** a UTF-8 .md the user picked becomes the role file (the replaced text kept); `roleFile` on the spec is set only by the user's save */
	"agents.role.import": (id: string, path: string) => { chars: number };
	/** the rules every agent gets (agents\_kopejie.md, 6 000 characters at most) */
	"agents.shared.get": () => string;
	"agents.shared.set": (text: string) => void;
	/** the skills library (13.6): the synced Revit skills and the office's own, with state and placeholder count; assignment to an agent is agents.save (spec.skills) */
	"skills.list": () => SkillInfo[];
	/** every <group>/<name>/SKILL.md under the folder is copied into <appDir>\skills; a name that exists is replaced and the old one kept under versions */
	"skills.import": (folder: string) => { imported: string[]; refused: { name: string; why: string }[] };
	/** the user's mark that a skill's test example was checked; refused while the skill has placeholders */
	"skills.tested": (name: string, tested: boolean) => SkillInfo;
	/** a skill's SKILL.md (or one of its files) for the page's read-only view; a draft is readable here */
	"skills.read": (name: string, path?: string) => string;
	/** expert reviews (8.14): the remarks, the counts, and the documents that can be read as a review */
	"expert.list": (id: string) => { remarks: ExpertRemark[]; summary: ExpertSummary; sources: ReviewSource[] };
	"expert.read": (id: string, sourceId: string) => ImportResult;
	/** the user closes a remark (done, or not applicable with a reason) or reopens it */
	"expert.setState": (id: string, remarkId: string, state: RemarkState, note: string | null) => void;
	"expert.edit": (id: string, remarkId: string, patch: { responsible?: string | null; daļa?: string | null }) => void;
	"expert.fixList": (id: string, daļa: string | null) => string;
	/** The project's process state; null until the first switch to process mode. */
	"process.get": (projectId: string) => ProcessState | null;
	/** Process mode on or off. The first switch builds the state from the profile facts and the agents that exist; refused without an agent `bpv`. Switching back keeps everything else. */
	"process.setMode": (projectId: string, mode: "cowork" | "process") => ProcessState;
	/** Changes doc type, depth per stage or agents. Needs a `why`; `bpv` must stay, ids must exist, S6 and S7 cannot be skipped. Each change is logged in profile.changes. */
	"process.setProfile": (projectId: string, p: { docType?: DocType; depth?: Partial<Record<Stage, Depth>>; agents?: string[]; why: string }) => ProcessState;
	/** The user decides the waiting gate: approve (H5: `fix` = the remark ids to correct) or return (a comment is required). The only way a gate is passed; no agent tool does it.
	 *  `noteId`: the gate note the card showed; the decision is refused when another gate waits now (the user decided on what they read). */
	"process.gate": (projectId: string, d: { approve: boolean; comment?: string; fix?: string[]; noteId?: string }) => ProcessState;
	/** Writes the decision, question, risk and change registers, the status page and one file per gate into <project data>\export\00_vadiba (never the office folder); returns the paths. */
	"process.export": (projectId: string) => string[];
	/** The user records a change the client asked for (process mode): a `change` note at the stage that is on, and bpv is asked to judge its impact (process_change_impact). Refused in co-work. */
	"process.change": (projectId: string, text: string) => Note;
	/** After H7 (stage mācības): every agent of the profile is given one task, to write the project's lessons to the office memory as proposals. Returns the agents asked. Refused before H7. */
	"process.learn": (projectId: string) => { asked: string[] };
	/** "Pabeigt": the user has gone through the lessons; mācības → done. */
	"process.finish": (projectId: string) => ProcessState;
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
	/** a comment on anything a page shows (task 9.4): a target, the text, what the user means and the marks drawn with it */
	"pins.add": (id: string, target: PinTarget, text: string, opts?: { intent?: PinIntent; markup?: Markup[] }) => Pin;
	"pins.comment": (id: string, pinId: string, text: string) => void;
	"pins.close": (id: string, pinId: string) => void;
	"pins.reopen": (id: string, pinId: string) => void;
	"notes.list": (id: string, type?: NoteType) => Note[];
	"notes.write": (id: string, type: NoteType, title: string, body: string) => Note;
	/** the user closes (or reopens) a question the agents left (task 12.3); "Gaida tevi" is sent again */
	"notes.setStatus": (id: string, noteId: string, status: "open" | "closed", answer?: string) => Note;
	/** the user has seen an agents' decision */
	"notes.review": (id: string, noteId: string) => Note;
	/** the user cancels a decision: a new decision note that names it; nothing is deleted */
	"notes.cancel": (id: string, noteId: string, reason: string) => Note;
	"revit.status": () => RevitStatusRow;
	/** the Revit add-in years shipped with the app / already installed */
	"revit.addins": () => { year: string; available: boolean; installed: boolean }[];
	/** copies the shipped add-in into the user's Revit add-ins folder; one line per year */
	"revit.installAddins": (years: string[]) => string[];
	"revit.views": () => { id: string; name: string; type: string }[];
	"revit.exportView": (id: string, viewId: string, name: string) => string;
	"revit.exportIfc": (id: string) => string;
	"revit.workCopy": (id: string) => string;
	"revisions.capture": (id: string, summary: string, sheetIds: string[]) => Revision;
	"tasks.list": () => { id: string; label: string; text: string }[];
	"models.list": (id: string) => ModelRow[];
	/** the PDF and DWG files of the project folder grouped by drawing: version chains and the PDF = DWG check */
	"sheets.sets": (id: string) => DrawingSet[];
	/** the Revit files of the project folder and which one is open in Revit */
	"revit.files": (id: string) => RevitFilesView;
	"models.bytes": (id: string, rel: string) => Uint8Array;
	"revisions.list": (id: string) => Revision[];
	"sheets.bytes": (id: string, ref: string) => Uint8Array;
	"versions.between": (id: string, from: string, to: string) => VersionRow[];
	"sheets.diff": (id: string, a: string, b: string) => SheetDiffRow[];
	/** one DWG as lines per space (CadCraft's reader) */
	"dwg.view": (id: string, ref: string) => DwgView;
	/** two DWGs, `a` the older: added / removed / changed per space (CadCraft's DWGCOMPARE) */
	"dwg.compare": (id: string, a: string, b: string) => DwgCompare;
	/** the text of two documents for the word diff; `note` says when one has no text to compare */
	"compare.text": (id: string, a: string, b: string) => { a: string; b: string; note: string | null };
	/** a DWG's bytes for CadCraft's frame */
	"dwg.bytes": (id: string, ref: string) => Uint8Array;
	/** CadCraft is installed (resources/cadcraft): DWG opens in it, else in the plain line view */
	"dwg.craft": () => boolean;
	/** the labelled changes between two issues of a sheet traced to elements of the model (task 8.11); oldIfc = the model of the older issue, when there is one */
	"sheets.trace": (id: string, a: string, b: string, newIfc: string, oldIfc: string | null) => TraceView;
	"bimcraft.status": () => BimcraftStatusRow;
	/** tokens and cost per project, from the log the agent's turns are written to */
	"usage.summary": () => UsageRow[];
	"coordination.get": (id: string, withRevit: boolean) => CoordinationView;
	"coordination.save": (id: string, reference: CoordReference) => void;
	/** (re)build the reference from the models, with BIP values typed in when there are any; saves and returns it */
	"coordination.seed": (id: string, declared?: Declared) => CoordReference;
	/** the audit as an HTML file: into the draft's staging when a delivery is given, else the project's exports; → the file */
	"coordination.report": (id: string, deliveryId: string | null) => string;
	/** the shared-coordinates guide for this project (task 8.10): returned as text and kept as a note in Atmiņa */
	"coordination.guide": (id: string) => string;
	/** the office memory (task 8.8): lessons for every project; proposals from the agent are in the list, marked */
	"memory.list": (type?: NoteType) => Note[];
	"memory.write": (type: NoteType, title: string, body: string) => Note;
	/** lift one of the project's notes up to the office memory (a copy; the project's stays) */
	"memory.promote": (id: string, noteId: string) => Note;
	"memory.decide": (noteId: string, accept: boolean) => void;
	/** what an agent run changed, newest last, and whether each change can still be taken back (task 8.7) */
	"undo.list": (id: string, run: string) => UndoRow[];
	"undo.apply": (id: string, key: string) => string;
	/** the project's tasks (not the agent's task templates, which are tasks.list) */
	"todos.list": (id: string) => Task[];
	"todos.add": (id: string, input: { title: string; due?: string | null; start?: string | null; priority?: TaskPriority; assignee?: string | null; checklist?: { id?: string; text: string; done?: boolean }[]; refs?: Task["refs"]; note?: string }) => Task;
	"todos.update": (id: string, taskId: string, patch: { title?: string; due?: string | null; start?: string | null; priority?: TaskPriority; assignee?: string | null; checklist?: { id?: string; text: string; done?: boolean }[]; note?: string; state?: Task["state"] }) => Task;
	/** where each BIM stage starts and ends (the Gantt) */
	"stages.dates": (id: string) => StageDates;
	/** sets one stage's dates, or clears them (null) */
	"stages.setDates": (id: string, stage: BimStage, range: { start: string; end: string } | null) => StageDates;
	"todos.remove": (id: string, taskId: string) => void;
	/** what falls on each day from `from` to `to`: planned and sent deliveries, clock ends, tasks; of one project or of all */
	"grafiks.items": (scope: "project" | "all", projectId: string | null, from: string, to: string) => GrafikItem[];
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
	"layout.get",
	"layout.set",
	"layout.popOut",
	"layout.popIn",
	"layout.relay",
	"plan.get",
	"plan.set",
	"dialog.pickFolder",
	"dialog.pickFile",
	"screen.capture",
	"agent.status",
	"agent.providers",
	"agent.setKey",
	"agent.clearKey",
	"agent.login",
	"agent.loginAnswer",
	"agent.logout",
	"agent.send",
	"agent.stop",
	"queue.restored",
	"queue.resumeInterrupted",
	"queue.discardInterrupted",
	"queue.view",
	"queue.pause",
	"queue.resume",
	"queue.resumeWave",
	"waiting.list",
	"room.lines",
	"threads.list",
	"threads.open",
	"threads.send",
	"threads.history",
	"threads.stop",
	"threads.close",
	"agent.confirm",
	"agent.history",
	"agent.reset",
	"agent.context",
	"agent.measureFile",
	"agent.compact",
	"activity.recent",
	"projects.list",
	"projects.summaries",
	"projects.dashboard",
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
	"deliveries.renamePlan",
	"deliveries.renameApply",
	"deliveries.renameUndo",
	"agents.list",
	"agents.save",
	"agents.role.get",
	"agents.role.set",
	"agents.role.import",
	"agents.shared.get",
	"agents.shared.set",
	"skills.list",
	"skills.import",
	"skills.tested",
	"skills.read",
	"expert.list",
	"expert.read",
	"expert.setState",
	"expert.edit",
	"expert.fixList",
	"process.get",
	"process.setMode",
	"process.setProfile",
	"process.gate",
	"process.export",
	"process.change",
	"process.learn",
	"process.finish",
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
	"notes.setStatus",
	"notes.review",
	"notes.cancel",
	"revit.status",
	"revit.addins",
	"revit.installAddins",
	"revit.views",
	"revit.exportView",
	"revit.exportIfc",
	"revit.workCopy",
	"revisions.capture",
	"tasks.list",
	"models.list",
	"sheets.sets",
	"revit.files",
	"models.bytes",
	"revisions.list",
	"sheets.bytes",
	"versions.between",
	"sheets.diff",
	"dwg.view",
	"dwg.compare",
	"compare.text",
	"dwg.bytes",
	"dwg.craft",
	"sheets.trace",
	"models.diff",
	"bimcraft.status",
	"usage.summary",
	"coordination.get",
	"coordination.save",
	"coordination.seed",
	"coordination.report",
	"coordination.guide",
	"memory.list",
	"memory.write",
	"memory.promote",
	"memory.decide",
	"undo.list",
	"undo.apply",
	"todos.list",
	"todos.add",
	"todos.update",
	"todos.remove",
	"stages.dates",
	"stages.setDates",
	"grafiks.items",
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
	"agent.event": { runId: string; event: RunEvent; threadId: string; agent: string; projectId: string | null; wave: string };
	/** a thread was made or changed state (running, waiting-confirm, idle) */
	"threads.changed": { projectId: string | null; thread: Thread };
	/** the run table or the queue changed (task 11.2) */
	"queue.changed": QueueView;
	/** a confirmation opened or was answered, or the restart question was answered: the whole list as it is now (task 11.5) */
	"waiting.changed": WaitingItem[];
	/** a message was added to a project's mailbox or a topic was closed: the line it adds to the room (task 12.5) */
	"room.line": { projectId: string | null; line: RoomLine };
	"agent.login": LoginNotice;
	/** the layout file was saved (by `origin`): every window adopts it (task 9.11) */
	"layout.changed": { store: LayoutStore; origin: string };
	/** the OS window of a popped layout window was closed */
	"layout.popped": { id: string };
	/** a popped window's request to the main window */
	"layout.relay": { msg: RelayMsg };
	"scan.progress": ScanProgress;
	/** What the agent or the folder scan is doing, as a line a person reads (shared/activity.ts). */
	activity: Activity;
}

export type EventName = keyof EventSpec;
export const EVENT_NAMES = ["data.changed", "agent.event", "agent.login", "layout.changed", "layout.popped", "layout.relay", "scan.progress", "activity", "threads.changed", "queue.changed", "waiting.changed", "room.line"] as const satisfies readonly EventName[];

export type Handlers = { [K in ApiName]: (...args: Parameters<ApiSpec[K]>) => ReturnType<ApiSpec[K]> | Promise<ReturnType<ApiSpec[K]>> };
