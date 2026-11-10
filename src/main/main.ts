// Electron main process: window and wiring. Logic lives in api.ts and the modules it calls.
// Carried from v1 src/main/main.ts: crash log, link handling, reload / devtools keys, renderer recovery.
import { app, BrowserWindow, dialog, net, protocol, safeStorage, shell } from "electron";
import { pathToFileURL } from "node:url";
import { BIMCRAFT_SCHEME, bimcraftResponse, bimcraftSite } from "./bimcraft-protocol.js";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { EVENT_NAMES, type EventName, type EventSpec } from "../shared/api.js";
import type { PiRuntime } from "../agent/pi/index.js";
import { AgentSession } from "../agent/session.js";
import { createHandlers } from "./api.js";
import { registerIpc } from "./ipc.js";
import { ActivityLog } from "./activity.js";
import { TASKS } from "../agent/tasks.js";
import { makeLevelOf } from "../agent/tools/levels.js";
import { appLevels } from "../agent/tools/defs.js";
import { AppSettings } from "./settings.js";
import { Registry } from "../core/registry.js";
import { ProjectEngine } from "./engine.js";
import { RevitClient, defaultServerJs, launchSpec, resolveRevitLaunch } from "../revit/client.js";
import { revitRead } from "../revit/commands.js";
import { revitExport } from "../revit/exports.js";
import { captureRevision, isWorkCopy } from "../revit/revision.js";
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
	// the folder scan also shows in the activity feed, beside the agent's runs
	if (event === "scan.progress") activity.scan(payload as EventSpec["scan.progress"]);
	if (events.has(event)) win?.webContents.send(`ev:${event}`, payload);
};

// What the agent and the folder scan are doing, as lines a person reads: the dock's run card and the status strip.
const activity = new ActivityLog({
	send: (a) => emit("activity", a),
	sources: (projectId) => registry.store(projectId).read("sources"),
	levelOf: makeLevelOf(appLevels(), REVIT_LEVELS),
	templates: TASKS,
});

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
	toolsServer: (env) => {
		const r = settings.get();
		return { command: process.execPath, args: [toolsServerJs], env: { ...env, ELECTRON_RUN_AS_NODE: "1", PROJEKTESANA_REVIT_JS: r.revitServerJs ?? "", PROJEKTESANA_REVIT_NODE: r.revitNode ?? "" } };
	},
	revit: () => {
		const l = resolveRevitLaunch(settings.get());
		return l ? { ...launchSpec(l, process.execPath), tools: REVIT_TOOLS, levels: REVIT_LEVELS } : null;
	},
	ctx: { projectsDir: settings.projectsDir(), dataDir, appDir, skillsDir: join(app.isPackaged ? process.resourcesPath : join(here, "..", "..", "resources"), "skills") },
	revitWork: async (projectId) => {
		if (!projectId) return { ok: false, title: "nav projekta" };
		const doc = await revitExport.docInfo(revit);
		return { ok: isWorkCopy(registry.store(projectId), doc.path), title: doc.title };
	},
	afterBatch: async (projectId, summary) => {
		const store = registry.store(projectId);
		const rev = await captureRevision(store, revit, { trigger: "agentBatch", summary, bimcraftApp: join(resourcesDir, "bimcraft", "app") });
		const r = await engine.afterChange(store, "rooms");
		emit("data.changed", { projectId, what: ["revisions", "findings"] });
		return `revīzija ${rev.id}${rev.diffFromPrev ? ` (+${rev.diffFromPrev.added} −${rev.diffFromPrev.removed} ~${rev.diffFromPrev.changed})` : ""}; atvērtie atradumi: ${r.open}`;
	},
	runsDir: join(appDir, "runs"),
	chatDir: settings.chatDir(),
	emit: (runId, event) => {
		activity.event(runId, event);
		emit("agent.event", { runId, event });
	},
});

const registry = new Registry(settings.registryFile(), settings.projectsDir());
const resourcesDir = app.isPackaged ? process.resourcesPath : join(here, "..", "..", "resources");
const pageRenderer = new PageRenderer(join(here, "..", "renderer"));
const ocr = new Ocr(join(resourcesDir, "tessdata"));

const revit = new RevitClient(() => resolveRevitLaunch(settings.get()), process.execPath);
{
	// one line per start: what this process sees when it looks for the Revit MCP server
	const s = settings.get();
	const l = resolveRevitLaunch(s);
	log(`revit lookup: user=${userInfo().username} LOCALAPPDATA=${process.env.LOCALAPPDATA ?? "(unset)"} checked=${defaultServerJs()} exists=${existsSync(defaultServerJs())} settingsJs=${s.revitServerJs ?? "-"} -> ${l ? `${l.source} ${l.serverJs}` : "nav atrasts"}`);
}
const engine = new ProjectEngine({
	dataDir,
	officeStandardPdf: () => settings.get().officeStandardPdf,
	modelRooms: async () => (revit.configured() ? (await revitRead.rooms(revit)).map((r) => ({ number: r.number, name: r.name, level: r.level, area: r.areaM2, id: r.uniqueId })) : undefined),
});

const handlers = createHandlers({
	bimcraftApp: join(resourcesDir, "bimcraft", "app"),
	engine,
	revit,
	registry,
	hooks: () => ({ ocr: ocrHook(pageRenderer, ocr), officeText: (abs, ext) => officeText(join(resourcesDir, "office-text.ps1"), abs, ext) }),
	version: app.getVersion(),
	settings,
	dataDir,
	session,
	activity,
	pi,
	emit,
	pickFolder: async (title) => {
		const r = await dialog.showOpenDialog(win!, { title, properties: ["openDirectory"] });
		return r.canceled ? null : r.filePaths[0];
	},
	pickFile: async (title, extensions) => {
		const r = await dialog.showOpenDialog(win!, { title, properties: ["openFile"], filters: [{ name: extensions.join(", "), extensions }] });
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
	// the main window is the app: closing it quits, even while a hidden helper window is still open
	win.on("closed", () => app.quit());
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

// the BimCraft preview runs from bimcraft:// (its page uses absolute paths; file:// cannot serve it)
protocol.registerSchemesAsPrivileged([{ scheme: BIMCRAFT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

app.whenReady().then(() => {
	const site = bimcraftSite(join(resourcesDir, "bimcraft"));
	protocol.handle(BIMCRAFT_SCHEME, async (req) => {
		if (!site) return new Response("nav konfigurēts: BimCraft nav resources/bimcraft (npm run build)", { status: 404 });
		const r = bimcraftResponse(site, req.url);
		if (!r.file) return new Response("not found", { status: r.status, headers: r.headers });
		const res = await net.fetch(pathToFileURL(r.file).href);
		return new Response(res.body, { status: 200, headers: r.headers });
	});
	createWindow();
});
// Quitting must end every process the app started. Closing the window alone does not: the hidden page-renderer window
// keeps "window-all-closed" from firing, and the Revit MCP server and the agent's tool servers are separate processes
// that Windows leaves running when their parent exits. So the first quit is held, everything is closed (at most 4 s),
// then the app exits.
let closing = false;
async function shutdown(): Promise<void> {
	pageRenderer.close();
	const closeAll = Promise.allSettled([session.shutdown(), revit.close(), ocr.close()]);
	await Promise.race([closeAll, new Promise((r) => setTimeout(r, 4000))]);
}
app.on("before-quit", (e) => {
	if (closing) return;
	closing = true;
	e.preventDefault();
	shutdown()
		.catch((err) => log(`shutdown: ${(err as Error).stack ?? err}`))
		.finally(() => app.exit(0));
});
app.on("window-all-closed", () => app.quit());
