// The IPC contract: every method the renderer may call and every event main may send, with their types.
// main/api.ts must implement exactly API_NAMES (checked by test/0.4-ipc.test.ts); the preload exposes one invoke and one on.
// Types only from ../core/model (pure) and ./types, so the renderer can import this file.
import type { BimStage, Delivery, Fact, Finding, Note, NoteType, Pin, PinTarget, Project, Requirement, Revision, Source } from "../core/model.js";
import type { LoginNotice, RunEvent, Settings } from "./types.js";

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

/** What the agent receives as the Fokuss: what Boris has selected in panels and the preview. */
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
	openFindings: number;
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

export interface ApiSpec {
	"app.info": () => AppInfo;
	"settings.get": () => Settings;
	"settings.set": (patch: Partial<Settings>) => Settings;
	"dialog.pickFolder": (title: string) => string | null;
	"agent.status": () => AgentStatus;
	"agent.providers": () => ProviderRow[];
	"agent.setKey": (provider: string, key: string) => void;
	"agent.clearKey": (provider: string) => void;
	"agent.login": (provider: string) => void;
	"agent.loginAnswer": (text: string) => void;
	"agent.logout": (provider: string) => void;
	"agent.send": (projectId: string | null, text: string, focus: FocusItem[]) => { runId: string };
	"agent.stop": () => void;
	"agent.confirm": (confirmId: string, allow: boolean) => void;
	"agent.history": (projectId: string | null) => { role: "user" | "assistant"; text: string; at: string }[];
	"agent.reset": (projectId: string | null) => void;
	"projects.list": () => ProjectRow[];
	"projects.add": (root: string) => ProjectRow;
	"projects.forget": (id: string) => void;
	"projects.scan": (id: string) => void;
	"projects.scanSummary": (id: string) => ScanSummaryRow | null;
	"projects.roleQuestions": (id: string) => RoleQuestion[];
	"projects.confirmRole": (id: string, folderKey: string, role: string) => void;
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
	"findings.runAll": (id: string) => number;
	"pins.list": (id: string) => Pin[];
	"pins.add": (id: string, target: PinTarget, text: string) => Pin;
	"pins.comment": (id: string, pinId: string, text: string) => void;
	"pins.close": (id: string, pinId: string) => void;
	"pins.reopen": (id: string, pinId: string) => void;
	"notes.list": (id: string, type?: NoteType) => Note[];
	"notes.write": (id: string, type: NoteType, title: string, body: string) => Note;
	"revit.status": () => RevitStatusRow;
	"models.list": (id: string) => { rel: string; name: string; section: string | null; size: number; mtime: string }[];
	"models.bytes": (id: string, rel: string) => Uint8Array;
	"revisions.list": (id: string) => Revision[];
	"revisions.ifc": (id: string, revisionId: string) => Uint8Array;
	"revit.rooms": () => RevitRoomRow[];
	"revit.select": (elementIds: number[]) => void;
	"rooms.compare": (id: string) => RoomCompareRow;
	"rooms.invAreaPlan": (id: string) => InvAreaRow[];
	"rooms.geometry": (id: string, sourceId: string) => { page: number; floor: string | null; fractions: { x1: number; y1: number; x2: number; y2: number }[]; segments: number }[];
	"rooms.geometryCsv": (id: string, sourceId: string) => string;
	"rooms.writeInvArea": (id: string, items: InvAreaRow[]) => { written: number; noParam: string[] };
	"facts.decide": (id: string, factId: string, state: "confirmed" | "rejected") => void;
	"facts.setByBoris": (id: string, key: string, value: string) => void;
	"rooms.exportXlsx": (id: string, sourceId: string) => string;
}

export type ApiName = keyof ApiSpec;

/** Runtime list of the contract, so the test can hold main's handlers against it. */
export const API_NAMES = [
	"app.info",
	"settings.get",
	"settings.set",
	"dialog.pickFolder",
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
	"projects.list",
	"projects.add",
	"projects.forget",
	"projects.scan",
	"projects.scanSummary",
	"projects.roleQuestions",
	"projects.confirmRole",
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
	"findings.runAll",
	"pins.list",
	"pins.add",
	"pins.comment",
	"pins.close",
	"pins.reopen",
	"notes.list",
	"notes.write",
	"revit.status",
	"models.list",
	"models.bytes",
	"revisions.list",
	"revisions.ifc",
	"revit.rooms",
	"revit.select",
	"rooms.compare",
	"rooms.invAreaPlan",
	"rooms.geometry",
	"rooms.geometryCsv",
	"rooms.writeInvArea",
	"facts.decide",
	"facts.setByBoris",
	"rooms.exportXlsx",
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
}

export type EventName = keyof EventSpec;
export const EVENT_NAMES = ["data.changed", "agent.event", "agent.login", "scan.progress"] as const satisfies readonly EventName[];

export type Handlers = { [K in ApiName]: (...args: Parameters<ApiSpec[K]>) => ReturnType<ApiSpec[K]> | Promise<ReturnType<ApiSpec[K]>> };
