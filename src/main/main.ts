// Electron main process: window and wiring. Logic lives in api.ts and the modules it calls.
// Carried from v1 src/main/main.ts: crash log, link handling, reload / devtools keys, renderer recovery.
import { app, BrowserWindow, dialog, nativeImage, net, protocol, safeStorage, shell } from "electron";
import { pathToFileURL } from "node:url";
import { BIMCRAFT_SCHEME, bimcraftResponse, bimcraftSite, CADCRAFT_SCHEME, craftSite } from "./bimcraft-protocol.js";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { userInfo } from "node:os";
import { createRequire } from "node:module";
import { join, sep } from "node:path";
import { EVENT_NAMES, type EventName, type EventSpec } from "../shared/api.js";
import type { PiRuntime } from "../agent/pi/index.js";
import { ClaudeAccount } from "../agent/claude/login.js";
import { CLAUDE_SUB } from "../agent/claude/provider.js";
import type { ClaudeRunOptions } from "../agent/claude/run.js";
import { AntigravityAccount } from "../agent/antigravity/account.js";
import { AntigravityHost } from "../agent/antigravity/host.js";
import { ANTIGRAVITY } from "../agent/antigravity/provider.js";
import type { AntigravityRunOptions } from "../agent/antigravity/run.js";
import { AgentSession } from "../agent/session.js";
import { createHandlers } from "./api.js";
import { registerIpc } from "./ipc.js";
import { ActivityLog } from "./activity.js";
import { AgentLog } from "../core/agent-log.js";
import { forWindow } from "../shared/agent-log.js";
import { TASKS } from "../agent/tasks.js";
import { makeLevelOf } from "../agent/tools/levels.js";
import { appLevels } from "../agent/tools/defs.js";
import { AppSettings } from "./settings.js";
import { PopoutManager } from "./windows.js";
import { popTitle } from "../shared/popout.js";
import { Registry } from "../core/registry.js";
import { snapshotAppData } from "../core/safe-file.js";
import { ProjectEngine } from "./engine.js";
import { RevitClient, defaultServerJs, launchSpec, localAppDataDir, resolveRevitLaunch, setBundledRevitDir, bundledRevitDir } from "../revit/client.js";
import { syncAddins } from "../revit/addin-install.js";
import { revitRead, selectSession } from "../revit/commands.js";
import { revitExport } from "../revit/exports.js";
import { captureRevision, isWorkCopy } from "../revit/revision.js";
import { REVIT_LEVELS, REVIT_TOOLS } from "../agent/tools/revit-levels.js";
import { Ocr } from "../sources/text/ocr.js";
import { officeText } from "../sources/text/office-com.js";
import { ocrHook } from "./ocr-hook.js";
import { startAgentBridge } from "./agent-bridge.js";
import { createAppSettingsHost } from "./app-settings/handlers.js";
import { setupFleet } from "./handlers/agents.js";
import { PageRenderer } from "./offscreen.js";
import { RoutineService } from "./routines-scheduler.js";
import { SearchIndexer } from "../search/manager.js";

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
// One copy of the app (2.14.5: nine copies were running at once, most of them started by tools, with no window, and they blocked the build). A second start hands over to the first and
// ends before it reads or writes anything; the first brings its window forward, or opens one if it has none (a copy that lost its window shows itself instead of hiding for ever).
if (!app.requestSingleInstanceLock()) {
	app.exit(0);
	process.exit(0);
}
const settings = new AppSettings(appDir, crypto);
// before anything reads or writes: a copy of settings, project list, layout and the key files (see core/safe-file.ts)
snapshotAppData(appDir);

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

// The OS windows of popped-out layout windows (task 9.11): the same renderer bundle with ?pop=<id>, the same preload; closing one
// tells the main window to dock the layout window back.
const popouts = new PopoutManager(
	(id) => {
		const w = new BrowserWindow({
			width: 1100,
			height: 800,
			minWidth: 360,
			minHeight: 240,
			title: popTitle(id),
			backgroundColor: "#161615",
			webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
		});
		w.setMenuBarVisibility(false);
		w.webContents.setWindowOpenHandler(({ url }) => {
			openUrl(url);
			return { action: "deny" };
		});
		w.webContents.on("console-message", (e) => {
			if (e.level === "error" || e.level === "warning") log(`popout ${id} ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`);
		});
		void w.loadFile(join(here, "..", "renderer", "index.html"), { query: { pop: id } });
		return {
			focus: () => w.focus(),
			close: () => (w.isDestroyed() ? undefined : w.close()),
			send: (channel, payload) => (w.isDestroyed() ? undefined : w.webContents.send(channel, payload)),
			onClosed: (cb) => w.on("closed", cb),
		};
	},
	(id) => emit("layout.popped", { id }),
);

const events = new Set<string>(EVENT_NAMES);
// set below, once the search index exists: what a data change means for it
let indexOnData: ((p: EventSpec["data.changed"]) => void) | null = null;
const emit = <E extends EventName>(event: E, payload: EventSpec[E]) => {
	if (event === "data.changed") indexOnData?.(payload as EventSpec["data.changed"]);
	// the folder scan also shows in the activity feed, beside the agent's runs
	if (event === "scan.progress") activity.scan(payload as EventSpec["scan.progress"]);
	if (!events.has(event)) return;
	win?.webContents.send(`ev:${event}`, payload);
	popouts.broadcast(`ev:${event}`, payload);
};

// What the agent and the folder scan are doing, as lines a person reads: the dock's run card and the status strip.
const activity = new ActivityLog({
	send: (a) => emit("activity", a),
	sources: (projectId) => registry.store(projectId).read("sources"),
	levelOf: makeLevelOf(appLevels(), REVIT_LEVELS),
	templates: TASKS,
});

// The agent log (Žurnāls): every event of every run and what each run started with, in full and with secrets masked, for the log panel.
const agentLog = new AgentLog({ runsDir: join(appDir, "runs"), send: (n) => emit("agentlog.entry", n) });

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

// The Claude subscription engine (Agent SDK) loads on first use, like pi. Its claude.exe ships in the SDK's platform package; in the
// installed app that package is unpacked from the asar (electron-builder asarUnpack), since an exe inside an asar cannot be started.
// Claude Code keeps its sessions in the app's own folder, never the user's ~/.claude: none of their settings, hooks or memory reach a run.
const claudeDir = join(appDir, "claude-code");
let claudeEngine: Promise<(o: ClaudeRunOptions) => Promise<void>> | null = null;
// The sign-in runs this same claude.exe by its path (`claude auth login`), so in development too the path is resolved, not left to the SDK.
const claudeBinary = (): string => {
	const exe = createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${process.platform === "win32" ? ".exe" : ""}`);
	return app.isPackaged ? exe.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`) : exe;
};
const claudeExecutable = (): string | undefined => (app.isPackaged ? claudeBinary() : undefined);
// Sign in (`claude auth login` into claudeDir), its status and Sign out; a run with no pasted setup-token uses this login.
const claudeAccount = new ClaudeAccount({
	cli: claudeBinary,
	configDir: claudeDir,
	onChange: () => emit("data.changed", { projectId: null, what: ["agent"] }),
	log: (line) => log(`claude: ${line}`),
});
const claudeRun = async (o: ClaudeRunOptions) =>
	(await (claudeEngine ??= import("../agent/claude/run.js").then((m) => {
		mkdirSync(join(claudeDir, "work"), { recursive: true });
		return m.createClaudeRun({
			token: () => settings.apiKey(CLAUDE_SUB),
			login: () => claudeAccount.ensureSignedIn(),
			executable: claudeExecutable(),
			configDir: claudeDir,
			cwd: join(claudeDir, "work"),
			clientApp: `projektesana/${app.getVersion()}`,
			log: (line) => log(`claude: ${line.trimEnd()}`),
		});
	})))(o);

// Google Antigravity (Google's ACP server, signed in with the user's Google account): one server process for the whole app, started on first use and
// ended after ten idle minutes; its install, its profile and the models of the account are in <appData>\antigravity. The run loads on first use, like pi.
// The relay it starts for the app's tools is dist/agent/antigravity/bridge-stdio.js, on Electron's own node.
const antigravityHost = new AntigravityHost({ root: join(appDir, "antigravity"), nodePath: process.execPath, log: (line) => log(`antigravity: ${line}`) });
const antigravityAccount = new AntigravityAccount({
	host: antigravityHost,
	onChange: () => emit("data.changed", { projectId: null, what: ["agent"] }),
	// a finished sign-in ends a "signed out" hold on the provider (failover/holds.ts)
	onSignedIn: () => session.signedIn(ANTIGRAVITY),
	log: (line) => log(`antigravity: ${line}`),
});
void antigravityAccount.refresh();
let antigravityEngine: Promise<(o: AntigravityRunOptions) => Promise<void>> | null = null;
const antigravityRun = async (o: AntigravityRunOptions) =>
	(await (antigravityEngine ??= import("../agent/antigravity/run.js").then((m) => {
		mkdirSync(antigravityHost.folders.work, { recursive: true });
		return m.createAntigravityRun({ host: antigravityHost, nodePath: process.execPath, bridgeScript: join(here, "..", "agent", "antigravity", "bridge-stdio.js"), log: (line) => log(`antigravity: ${line}`) });
	})))(o);

// The project search index (src/search): built in a background worker after every scan and conversation turn and a little after
// the app starts; the model files are fetched into <appDir>\models on the first build. Declared before the session because its
// thread callback asks for a run, and `registry` (further down) is only touched when a run starts.
const searchIndex = new SearchIndexer({
	appDir,
	projectsDir: settings.projectsDir(),
	sources: (projectId) =>
		registry.store(projectId).read("sources").flatMap((s) => {
			const v = s.versions[s.versions.length - 1];
			return s.kind === "document" && v?.sha256 ? [{ id: s.id, title: s.title, sha: v.textCache ? v.textCache.replace(/\.json$/, "") : v.sha256 }] : [];
		}),
	emit: (s) => emit("search.progress", s),
	log,
});

// The Markdown memory (Atmiņa) and the notes of a project's decision and question logs are in the index too: a write to them, by the user
// (the Atmiņa page, a decision cancelled) or by an agent (memory_write, write_note, close_topic: thread-runner reports them), asks for a run.
// Notes belong to one project. Memory is app-wide and each project's index holds a copy, so every project is asked, one after another; a run
// that finds nothing changed reads a few files and ends without loading the model.
indexOnData = (p) => {
	if (p.what.includes("memory")) registry.list().forEach((x, i) => searchIndex.request(x.id, "messages", 4000 + i * 1000));
	else if (p.projectId && p.what.includes("notes")) searchIndex.request(p.projectId, "messages");
};

// The tools server runs on Electron's own node (ELECTRON_RUN_AS_NODE), from the built dist/agent/tools/server.js.
const toolsServerJs = join(here, "..", "agent", "tools", "server.js");
const skillsDir = join(app.isPackaged ? process.resourcesPath : join(here, "..", "..", "resources"), "skills");
// once, at the first start of the version that has role-based tools: agents whose tool list is empty get the tools and skills of their role (shared/fleet-defaults.ts)
try {
	const fleet = setupFleet({ settings, skillsDir });
	if (fleet) log(`fleet setup: ${fleet.applied.length} agents set up${fleet.skipped.length ? `, skipped: ${fleet.skipped.map((s) => `${s.id} (${s.why})`).join("; ")}` : ""}`);
} catch (e) {
	log(`fleet setup failed: ${e instanceof Error ? e.message : e}`);
}
const session = new AgentSession({
	runtime: pi,
	claudeRun,
	antigravityRun,
	antigravityConnected: () => {
		antigravityAccount.refreshIfStale();
		return antigravityAccount.peek().signedIn;
	},
	claudeConnected: () => {
		if (settings.apiKey(CLAUDE_SUB)) return "setup-token";
		claudeAccount.refreshIfStale();
		return claudeAccount.peek().state === "in" ? "login" : false;
	},
	settings: () => settings.get(),
	toolsServer: (env) => {
		const r = settings.get();
		return { command: process.execPath, args: [toolsServerJs], env: { ...env, ELECTRON_RUN_AS_NODE: "1", PROJEKTESANA_REVIT_JS: r.revitServerJs ?? "", PROJEKTESANA_REVIT_NODE: r.revitNode ?? "", PROJEKTESANA_REVIT_BUNDLED: bundledRevitDir() ?? "" } };
	},
	revit: () => {
		const l = resolveRevitLaunch(settings.get());
		return l ? { ...launchSpec(l, process.execPath), tools: REVIT_TOOLS, levels: REVIT_LEVELS } : null;
	},
	ctx: { projectsDir: settings.projectsDir(), dataDir, appDir, skillsDir },
	revitWork: async (projectId, choice) => {
		if (!projectId) return { ok: false, title: "nav projekta" };
		try {
			// the session the agent chose (select_revit_instance) is chosen here too: with two Revit sessions open the check follows the agent, and a second Revit with another project never blocks it
			// a choice this connection cannot make leaves it on an older session, which says nothing about where the agent writes: handled below like no choice at all
			if (choice && !(await selectSession(revit, choice))) throw new Error("select_revit_instance: lietotne nevarēja izvēlēties to pašu sesiju");
			const doc = await revitExport.docInfo(revit);
			return { ok: isWorkCopy(registry.store(projectId), doc.path), title: doc.title };
		} catch (e) {
			if (!/Revit sessions are running|select_revit_instance/i.test((e as Error).message)) throw e;
			// several sessions and the agent has not chosen one: tell it which one holds this project's working copy
			const store = registry.store(projectId);
			const inst = await revitRead.instances(revit).catch(() => ({ selectedPid: null, instances: [] }));
			const mine = inst.instances.filter((x) => x.documentPath && isWorkCopy(store, x.documentPath));
			const where = mine.length ? `Šī projekta darba kopija ir atvērta sesijā pid ${mine.map((x) => x.pid).join(", ")}: izsauc select_revit_instance ar to un atkārto izmaiņu.` : "Neviena sesija nav šī projekta darba kopija: izvēlies ar select_revit_instance sesiju, kurā atvērts modelis, izveido darba kopiju ar revit_save_copy un atkārto izmaiņu.";
			return { ok: false, title: "vairākas Revit sesijas", hint: `Revit izmaiņa NAV izpildīta, un lietotājs partiju NENORAIDĪJA: darbojas vairākas Revit sesijas, un lietotne nezina, kurā tu strādā. ${where} Citā sesijā (cita projekta modelī) nerakstīs.` };
		}
	},
	isWorkCopyPath: (projectId, path) => {
		try {
			return !!projectId && isWorkCopy(registry.store(projectId), path);
		} catch {
			return false;
		}
	},
	afterBatch: async (projectId, summary, choice) => {
		const store = registry.store(projectId);
		if (choice) await revit.call("select_revit_instance", choice).catch(() => undefined);
		const rev = await captureRevision(store, revit, { trigger: "agentBatch", summary, bimcraftApp: join(resourcesDir, "bimcraft", "app") });
		const r = await engine.afterChange(store, "rooms");
		emit("data.changed", { projectId, what: ["revisions", "findings"] });
		return `revīzija ${rev.id}${rev.diffFromPrev ? ` (+${rev.diffFromPrev.added} −${rev.diffFromPrev.removed} ~${rev.diffFromPrev.changed})` : ""}; atvērtie atradumi: ${r.open}`;
	},
	agents: () => settings.agentSpecs().specs,
	departments: () => settings.departments().departments,
	runsDir: join(appDir, "runs"),
	agentLog,
	chatDir: settings.chatDir(),
	emit: (runId, event, meta) => {
		// the log keeps the whole arguments and answers; the dock and the activity lines get the cut copies
		agentLog.event(runId, event, meta);
		const slim = forWindow(event);
		activity.event(runId, slim, meta);
		emit("agent.event", { runId, event: slim, ...meta });
	},
	onHolds: () => emit("data.changed", { projectId: null, what: ["agent"] }),
	// a held message that starts a run of its own (the agent finished before reading it): the activity log titles that run with the text
	titleRun: (projectId, text, runId) => {
		activity.begin(projectId, text, runId);
		return () => activity.cancel(runId);
	},
	onThread: (thread) => {
		emit("threads.changed", { projectId: thread.projectId, thread });
		// a turn ended (the thread is waiting for the user or closed): its new messages go into the search index
		if (thread.projectId && (thread.state === "idle" || thread.state === "waiting-reply" || thread.state === "closed")) searchIndex.request(thread.projectId, "messages");
	},
	onQueue: (v) => emit("queue.changed", v),
	onWaiting: (items) => emit("waiting.changed", items),
	onData: (projectId, what) => {
		// a document role the agent set re-reads the requirements and re-runs the checks, as the user's change does (sources.setRole)
		if (projectId && what.includes("roles"))
			void engine
				.afterChange(registry.store(projectId), "roles")
				.catch(() => undefined)
				.finally(() => emit("data.changed", { projectId, what: [...what, "findings", "requirements"] }));
		else emit("data.changed", { projectId, what });
	},
});
// threads a dead process left in flight are marked interrupted and the saved queue waits paused; nothing starts until the user answers
session.restore();

const registry = new Registry(settings.registryFile(), settings.projectsDir());
const resourcesDir = app.isPackaged ? process.resourcesPath : join(here, "..", "..", "resources");
const pageRenderer = new PageRenderer(join(here, "..", "renderer"));
const ocr = new Ocr(join(resourcesDir, "tessdata"));

setBundledRevitDir(join(resourcesDir, "revit-mcp"));
// the add-in in Revit is the one this app ships: put in place at the first start after the setup or an update, no click (Revit open = the next start)
try {
	for (const line of syncAddins(bundledRevitDir(), join(localAppDataDir(), "Projektesana", "revit-backups", new Date().toISOString().replace(/[:.]/g, "-")))) log(`revit add-in: ${line}`);
} catch (e) {
	log(`revit add-in: sync failed: ${(e as Error).message}`);
}
const revit = new RevitClient(() => resolveRevitLaunch(settings.get()), process.execPath);
{
	// one line per start: what this process sees when it looks for the Revit MCP server
	const s = settings.get();
	const l = resolveRevitLaunch(s);
	log(`revit lookup: user=${userInfo().username} LOCALAPPDATA=${process.env.LOCALAPPDATA ?? "(unset)"} checked=${defaultServerJs()} exists=${existsSync(defaultServerJs())} settingsJs=${s.revitServerJs ?? "-"} -> ${l ? `${l.source} ${l.serverJs}` : "nav atrasts"}`);
}
const engine = new ProjectEngine({
	dataDir,
	bimcraftApp: join(resourcesDir, "bimcraft", "app"),
	officeStandardPdf: () => settings.get().officeStandardPdf,
	modelRooms: async () => (revit.configured() ? (await revitRead.rooms(revit)).map((r) => ({ number: r.number, name: r.name, level: r.level, area: r.areaM2, id: r.uniqueId })) : undefined),
});

// Routines (Grafiks → Rutīnas): the timer that starts an agent's run at the routine's time, only while the app runs; the same service answers the page's calls
const routines = new RoutineService({
	appDir,
	projectsDir: settings.projectsDir(),
	projectIds: () => registry.list().map((p) => p.id),
	agents: () => settings.agentSpecs().specs,
	session,
	store: (id) => registry.store(id),
	changed: (projectId, what) => emit("data.changed", { projectId, what }),
	log,
});
// the agent's settings tool (app_settings, main/app-settings): the Settings window's Undo and the agent bridge use this one host, so its write budget,
// its list of changes and its Undo are the same everywhere; the providers come from the handlers made just below
const appSettingsHost = createAppSettingsHost({
	settings,
	providers: async () => handlers["agent.providers"](),
	holds: async () => handlers["agent.holds"](),
	emit: (e) => emit("appSettings.changed", e),
	changed: () => emit("data.changed", { projectId: null, what: ["settings"] }),
});
const handlers = createHandlers({
	routines,
	appSettings: appSettingsHost,
	search: searchIndex,
	onScanned: (projectId) => searchIndex.request(projectId, "update"),
	skillsDir,
	bimcraftApp: join(resourcesDir, "bimcraft", "app"),
	engine,
	revit,
	registry,
	hooks: () => ({ ocr: ocrHook(pageRenderer, ocr), officeText: (abs, ext) => officeText(join(resourcesDir, "office-text.ps1"), abs, ext, undefined, appDir) }),
	version: app.getVersion(),
	settings,
	dataDir,
	session,
	activity,
	agentLog,
	pi,
	claude: claudeAccount,
	antigravity: antigravityAccount,
	emit,
	popouts,
	pickFolder: async (title) => {
		const r = await dialog.showOpenDialog(win!, { title, properties: ["openDirectory"] });
		return r.canceled ? null : r.filePaths[0];
	},
	pickFile: async (title, extensions) => {
		const r = await dialog.showOpenDialog(win!, { title, properties: ["openFile"], filters: [{ name: extensions.join(", "), extensions }] });
		return r.canceled ? null : r.filePaths[0];
	},
	// the screen grab: a rectangle of the window as the user sees it (the model viewer's frame included)
	capture: async (r) => {
		if (!win || win.isDestroyed()) throw new Error("Nav loga, ko uzņemt.");
		const clamp = (n: number) => Math.max(0, Math.round(n));
		const img = await win.webContents.capturePage({ x: clamp(r.x), y: clamp(r.y), width: Math.max(1, clamp(r.width)), height: Math.max(1, clamp(r.height)) });
		return new Uint8Array(img.toPNG());
	},
	openPath: (p) => shell.openPath(p),
	openUrl,
});
registerIpc(handlers, log);
routines.start();
app.on("will-quit", () => routines.stop());
// the agent's way into every call of the app and to page images (main/agent-bridge.ts); each agent run's tools server gets its
// address and token (agent/tools/context.ts ctxEnv)
void startAgentBridge({ handlers, registry, renderer: pageRenderer, appSettings: appSettingsHost, native: nativeImage })
	.then((b) => {
		process.env.PROJEKTESANA_BRIDGE = b.url;
		process.env.PROJEKTESANA_BRIDGE_TOKEN = b.token;
		app.on("will-quit", () => b.close());
	})
	.catch((e: Error) => log(`agent bridge failed: ${e.message}`));

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
	// the app opens maximized: a workspace of windows wants the whole screen (the size above is what "restore" goes back to)
	win.maximize();
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
// CadCraft (the DWG view and compare) the same way from cadcraft://
const CRAFT_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true };
protocol.registerSchemesAsPrivileged([
	{ scheme: BIMCRAFT_SCHEME, privileges: CRAFT_PRIVILEGES },
	{ scheme: CADCRAFT_SCHEME, privileges: CRAFT_PRIVILEGES },
]);

app.whenReady().then(() => {
	const site = bimcraftSite(join(resourcesDir, "bimcraft"));
	protocol.handle(BIMCRAFT_SCHEME, async (req) => {
		if (!site) return new Response("nav konfigurēts: BimCraft nav resources/bimcraft (npm run build)", { status: 404 });
		const r = bimcraftResponse(site, req.url);
		if (!r.file) return new Response("not found", { status: r.status, headers: r.headers });
		const res = await net.fetch(pathToFileURL(r.file).href);
		return new Response(res.body, { status: 200, headers: r.headers });
	});
	const cad = craftSite(join(resourcesDir, "cadcraft"), "cadcraft");
	protocol.handle(CADCRAFT_SCHEME, async (req) => {
		if (!cad) return new Response("nav konfigurēts: CadCraft nav resources/cadcraft (npm run build)", { status: 404 });
		const r = bimcraftResponse(cad, req.url);
		if (!r.file) return new Response("not found", { status: r.status, headers: r.headers });
		const res = await net.fetch(pathToFileURL(r.file).href);
		return new Response(res.body, { status: 200, headers: r.headers });
	});
	createWindow();
	// whatever an earlier session left unfinished in the search index (a closed window, a crash)
	searchIndex.requestAll(registry.list().map((p) => p.id));
});
// Quitting must end every process the app started. Closing the window alone does not: the hidden page-renderer window
// keeps "window-all-closed" from firing, and the Revit MCP server and the agent's tool servers are separate processes
// that Windows leaves running when their parent exits. So the first quit is held, everything is closed (at most 4 s),
// then the app exits.
let closing = false;
async function shutdown(): Promise<void> {
	pageRenderer.close();
	const closeAll = Promise.allSettled([searchIndex.dispose(), session.shutdown(), revit.close(), ocr.close(), claudeAccount.dispose(), antigravityAccount.dispose()]);
	popouts.closeAll();
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
app.on("second-instance", () => {
	if (!app.isReady()) return;
	if (!win || win.isDestroyed()) return createWindow();
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
});
