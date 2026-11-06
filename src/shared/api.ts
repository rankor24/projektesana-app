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

export interface RoleQuestion {
	folderKey: string;
	folderName: string;
	proposed: string;
	files: number;
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
] as const satisfies readonly ApiName[];

// Compile-time check that API_NAMES lists every key of ApiSpec (and no other).
type Missing = Exclude<ApiName, (typeof API_NAMES)[number]>;
const _complete: [Missing] extends [never] ? true : Missing = true;
void _complete;

export interface EventSpec {
	"data.changed": { projectId: string | null; what: string[] };
	"agent.event": { runId: string; event: RunEvent };
	"agent.login": LoginNotice;
}

export type EventName = keyof EventSpec;
export const EVENT_NAMES = ["data.changed", "agent.event", "agent.login"] as const satisfies readonly EventName[];

export type Handlers = { [K in ApiName]: (...args: Parameters<ApiSpec[K]>) => ReturnType<ApiSpec[K]> | Promise<ReturnType<ApiSpec[K]>> };
