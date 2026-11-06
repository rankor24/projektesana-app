// Electron main process: window and wiring. Logic lives in api.ts and the modules it calls.
// Carried from v1 src/main/main.ts: crash log, link handling, reload / devtools keys, renderer recovery.
import { app, BrowserWindow, dialog, safeStorage, shell } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { EVENT_NAMES, type EventName, type EventSpec } from "../shared/api.js";
import type { PiRuntime } from "../agent/pi/index.js";
import { AgentSession } from "../agent/session.js";
import { createHandlers } from "./api.js";
import { registerIpc } from "./ipc.js";
import { AppSettings } from "./settings.js";
import { Registry } from "../core/registry.js";
import { ProjectEngine } from "./engine.js";
import { RevitClient, launchSpec, resolveRevitLaunch } from "../revit/client.js";
import { revitRead } from "../revit/commands.js";
import { REVIT_LEVELS, REVIT_TOOLS } from "../agent/tools/revit-levels.js";
import { Ocr } from "../sources/text/ocr.js";
import { officeText } from "../sources/text/office-com.js";
import { ocrHook } from "./ocr-hook.js";
import { PageRenderer } from "./offscreen.js";

const here = import.meta.dirname; // dist/main
const dataDir = app.isPackaged ? join(process.resourcesPath, "data") : join(here, "..", "..", "data");

let win: BrowserWindow | null = null;

const crypto = {
	available: () => safeStorage.isEncryptionAvailable(),
	encrypt: (s: string) => safeStorage.encryptString(s),
	decrypt: (b: Buffer) => safeStorage.decryptString(b),
};
const appDir = join(app.getPath("appData"), "Projektesana");
// Chromium's own caches go to a subfolder, so the app data folder holds only app data
app.setPath("userData", join(appDir, "chromium"));
const settings = new AppSettings(appDir, crypto);

mkdirSync(settings.logsDir(), { recursive: true });
const logFile = join(settings.logsDir(), "app.log");
const log = (line: string) => {
	try {
		appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`, "utf8");
	} catch {
		// logging must never take the app down
	}
};
process.on("uncaughtException", (e) => log(`main uncaughtException: ${e.stack ?? e}`));
process.on("unhandledRejection", (e) => log(`main unhandledRejection: ${(e as Error)?.stack ?? e}`));

const openUrl = (url: string) => {
	if (/^https:\/\//i.test(url)) void shell.openExternal(url);
};

const events = new Set<string>(EVENT_NAMES);
const emit = <E extends EventName>(event: E, payload: EventSpec[E]) => {
	if (events.has(event)) win?.webContents.send(`ev:${event}`, payload);
};

// pi loads on first use (about 1.4 s to import), so the window opens at once.
let piRuntime: Promise<PiRuntime> | null = null;
const pi = () =>
	(piRuntime ??= import("../agent/pi/index.js").then((m) =>
		m.createPiRuntime({
			path: settings.piCredentialsFile(),
			seal: crypto,
			apiKey: (provider) => settings.apiKey(provider),
			modelCachePath: settings.modelCacheFile(),
			identity: { name: "Projektesana App", url: "https://buvdizains.lv" },
		}),
	));

// The tools server runs on Electron's own node (ELECTRON_RUN_AS_NODE), from the built dist/agent/tools/server.js.
const toolsServerJs = join(here, "..", "agent", "tools", "server.js");
const session = new AgentSession({
	runtime: pi,
	settings: () => settings.get(),
	toolsServer: (env) => ({ command: process.execPath, args: [toolsServerJs], env: { ...env, ELECTRON_RUN_AS_NODE: "1" } }),
	revit: () => {
		const l = resolveRevitLaunch(settings.get());
		return l ? { ...launchSpec(l, process.execPath), tools: REVIT_TOOLS, levels: REVIT_LEVELS } : null;
	},
	ctx: { projectsDir: settings.projectsDir(), dataDir, appDir },
	runsDir: join(appDir, "runs"),
	chatDir: settings.chatDir(),
	emit: (runId, event) => emit("agent.event", { runId, event }),
});

const registry = new Registry(settings.registryFile(), settings.projectsDir());
const resourcesDir = app.isPackaged ? process.resourcesPath : join(here, "..", "..", "resources");
const pageRenderer = new PageRenderer(join(here, "..", "renderer"));
const ocr = new Ocr(join(resourcesDir, "tessdata"));

const revit = new RevitClient(() => resolveRevitLaunch(settings.get()), process.execPath);
const engine = new ProjectEngine({
	dataDir,
	officeStandardPdf: () => settings.get().officeStandardPdf,
	modelRooms: async () => (revit.configured() ? (await revitRead.rooms(revit)).map((r) => ({ number: r.number, name: r.name, level: r.level, area: r.areaM2, id: r.uniqueId })) : undefined),
});

const handlers = createHandlers({
	engine,
	revit,
	registry,
	hooks: () => ({ ocr: ocrHook(pageRenderer, ocr), officeText: (abs, ext) => officeText(join(resourcesDir, "office-text.ps1"), abs, ext) }),
	version: app.getVersion(),
	settings,
	dataDir,
	session,
	pi,
	emit,
	pickFolder: async (title) => {
		const r = await dialog.showOpenDialog(win!, { title, properties: ["openDirectory"] });
		return r.canceled ? null : r.filePaths[0];
	},
	openPath: (p) => shell.openPath(p),
	openUrl,
});
registerIpc(handlers, log);

function createWindow(): void {
	win = new BrowserWindow({
		width: 1600,
		height: 960,
		minWidth: 1100,
		minHeight: 700,
		title: "Projektēšanas App",
		backgroundColor: "#161615",
		webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
	});
	win.setMenuBarVisibility(false);
	const wc = win.webContents;
	wc.setWindowOpenHandler(({ url }) => {
		openUrl(url);
		return { action: "deny" };
	});
	wc.on("will-navigate", (e, url) => {
		if (!url.startsWith("file:")) {
			e.preventDefault();
			openUrl(url);
		}
	});
	wc.on("console-message", (e) => {
		if (e.level === "error" || e.level === "warning") log(`renderer ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`);
	});
	wc.on("preload-error", (_e, path, error) => log(`preload error ${path}: ${error.stack ?? error}`));
	wc.on("render-process-gone", (_e, d) => {
		log(`renderer gone: ${d.reason} (exit ${d.exitCode})`);
		if (d.reason !== "clean-exit") setTimeout(() => win?.reload(), 500);
	});
	wc.on("before-input-event", (e, input) => {
		if (input.type !== "keyDown") return;
		if (input.key === "F5" || (input.control && input.key.toLowerCase() === "r")) {
			e.preventDefault();
			wc.reload();
		} else if (input.control && input.shift && input.key.toLowerCase() === "i") {
			e.preventDefault();
			wc.toggleDevTools();
		}
	});
	void win.loadFile(join(here, "..", "renderer", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
