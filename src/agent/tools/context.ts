// What a tool sees: where the project data is, which project, the run folder with the Fokuss.
// The tools server gets it through environment variables from the main process; tests build it directly.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectStore } from "../../core/store.js";
import type { FocusItem } from "../../shared/api.js";
import { isFocusItem } from "../focus.js";

export interface ToolCtx {
	/** <appData>\Projektesana\projects */
	projectsDir: string;
	projectId: string | null;
	/** shipped data: rules.json, law snapshots */
	dataDir: string;
	/** <appData>\Projektesana (library, settings) */
	appDir: string;
	/** this run's folder: focus.json */
	runDir: string | null;
	/** synced skills (resources/skills) */
	skillsDir?: string;
	/** the agent this run is for (task 10.2); null = the lead / not set */
	agent: string | null;
	/** the main process's bridge for the app_* tools and view_page (main/agent-bridge.ts); absent in tests and without the app */
	bridge?: { url: string; token: string };
	/** the thread this run belongs to; null = not set */
	thread: string | null;
}

export function ctxFromEnv(env: NodeJS.ProcessEnv): ToolCtx {
	const need = (k: string) => {
		const v = env[k];
		if (!v) throw new Error(`tools server: ${k} not set`);
		return v;
	};
	return { projectsDir: need("PROJEKTESANA_PROJECTS"), projectId: env.PROJEKTESANA_PROJECT || null, dataDir: need("PROJEKTESANA_DATA"), appDir: need("PROJEKTESANA_APP"), runDir: env.PROJEKTESANA_RUN || null, skillsDir: env.PROJEKTESANA_SKILLS || undefined, agent: env.PROJEKTESANA_AGENT || null, thread: env.PROJEKTESANA_THREAD || null, ...(env.PROJEKTESANA_BRIDGE && env.PROJEKTESANA_BRIDGE_TOKEN ? { bridge: { url: env.PROJEKTESANA_BRIDGE, token: env.PROJEKTESANA_BRIDGE_TOKEN } } : {}) };
}

export function ctxEnv(c: ToolCtx): Record<string, string> {
	return { PROJEKTESANA_PROJECTS: c.projectsDir, PROJEKTESANA_PROJECT: c.projectId ?? "", PROJEKTESANA_DATA: c.dataDir, PROJEKTESANA_APP: c.appDir, PROJEKTESANA_RUN: c.runDir ?? "", PROJEKTESANA_SKILLS: c.skillsDir ?? "", PROJEKTESANA_AGENT: c.agent ?? "", PROJEKTESANA_THREAD: c.thread ?? "", ...bridgeEnv(c) };
}

/** The bridge's address for a tools server: the context's own, else the one main started (main.ts sets it in its environment). */
function bridgeEnv(c: ToolCtx): Record<string, string> {
	const url = c.bridge?.url ?? process.env.PROJEKTESANA_BRIDGE;
	const token = c.bridge?.token ?? process.env.PROJEKTESANA_BRIDGE_TOKEN;
	return url && token ? { PROJEKTESANA_BRIDGE: url, PROJEKTESANA_BRIDGE_TOKEN: token } : {};
}

export function storeOf(c: ToolCtx): ProjectStore {
	if (!c.projectId) throw new Error("nav projekta: lietotājs nav atvēris projektu.");
	return ProjectStore.load(c.projectsDir, c.projectId);
}

export function readFocus(c: ToolCtx): FocusItem[] {
	if (!c.runDir) return [];
	const f = join(c.runDir, "focus.json");
	if (!existsSync(f)) return [];
	try {
		const v = JSON.parse(readFileSync(f, "utf8")) as unknown;
		return Array.isArray(v) ? v.filter(isFocusItem) : [];
	} catch {
		return [];
	}
}
