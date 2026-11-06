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
}

export function ctxFromEnv(env: NodeJS.ProcessEnv): ToolCtx {
	const need = (k: string) => {
		const v = env[k];
		if (!v) throw new Error(`tools server: ${k} not set`);
		return v;
	};
	return { projectsDir: need("PROJEKTESANA_PROJECTS"), projectId: env.PROJEKTESANA_PROJECT || null, dataDir: need("PROJEKTESANA_DATA"), appDir: need("PROJEKTESANA_APP"), runDir: env.PROJEKTESANA_RUN || null };
}

export function ctxEnv(c: ToolCtx): Record<string, string> {
	return { PROJEKTESANA_PROJECTS: c.projectsDir, PROJEKTESANA_PROJECT: c.projectId ?? "", PROJEKTESANA_DATA: c.dataDir, PROJEKTESANA_APP: c.appDir, PROJEKTESANA_RUN: c.runDir ?? "" };
}

export function storeOf(c: ToolCtx): ProjectStore {
	if (!c.projectId) throw new Error("nav projekta: Boris nav atvēris projektu.");
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
