import type { EngineId } from "../../shared/types.js";
import type { McpLaunch } from "./types.js";
import { GATHER_TOOLS, MODEL_TOOLS, REVIT_AGENT_TOOLS, SETUP_TOOLS } from "./types.js";

/** projektesana-tools runs on the same Node that runs the app (ELECTRON_RUN_AS_NODE in Electron). */
export function toolsLaunch(p: { serverJs: string; root: string; engine: EngineId; dataDir?: string; libraryDir?: string; mode?: "setup" | "gather" | "model"; revisionId?: string }): McpLaunch {
	const mode = p.mode ?? "model";
	const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1", PROJEKTESANA_ROOT: p.root, PROJEKTESANA_ENGINE: p.engine, PROJEKTESANA_MODE: mode };
	if (p.revisionId) env.PROJEKTESANA_REVISION = p.revisionId;
	if (p.dataDir) env.PROJEKTESANA_DATA = p.dataDir;
	if (p.libraryDir) env.PROJEKTESANA_LIBRARY = p.libraryDir;
	return { command: process.execPath, args: [p.serverJs], env, tools: mode === "setup" ? SETUP_TOOLS : mode === "gather" ? GATHER_TOOLS : MODEL_TOOLS };
}

/** The Revit MCP fork over stdio. null when it is not configured: the screen says `not configured`. */
export function revitLaunch(serverJs: string | null): McpLaunch | null {
	if (!serverJs) return null;
	return { command: process.execPath, args: [serverJs], env: { ELECTRON_RUN_AS_NODE: "1" }, tools: REVIT_AGENT_TOOLS };
}
