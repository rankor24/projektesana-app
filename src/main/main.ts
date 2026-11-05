// Electron main process: window + wiring. Logic lives in api.ts.
import { app, BrowserWindow, safeStorage, shell } from "electron";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./store.js";
import { AppApi } from "./api.js";
import { registerIpc } from "./ipc.js";
import { createPiEngine } from "./engines/pi.js";
import type { PiRuntime } from "../agent-pi/index.js";

const here = import.meta.dirname; // dist/main
const dataDir = app.isPackaged ? join(process.resourcesPath, "data") : join(here, "..", "..", "data");

let win: BrowserWindow | null = null;

const crypto = {
	available: () => safeStorage.isEncryptionAvailable(),
	encrypt: (s: string) => safeStorage.encryptString(s),
	decrypt: (b: Buffer) => safeStorage.decryptString(b),
};
const store = new Store(join(app.getPath("userData"), "data"), crypto);

// One crash log for main and renderer. A black window must leave a trace that Boris can send.
mkdirSync(store.logsDir(), { recursive: true });
const logFile = join(store.logsDir(), "app.log");
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

// pi loads on first use (about 1.4 s to import), so the window opens at once.
let piRuntime: Promise<PiRuntime> | null = null;
const pi = () =>
	(piRuntime ??= import("../agent-pi/index.js").then((m) =>
		m.createPiRuntime({
			path: store.piCredentialsFile(),
			seal: crypto,
			apiKey: (provider) => store.apiKey(provider),
			modelCachePath: store.modelCacheFile(),
			identity: { name: "Projektesana App", url: "https://buvdizains.lv" },
		}),
	));

const api = new AppApi({
	store,
	engine: createPiEngine({ runtime: pi, selection: () => store.settings() }),
	pi,
	serverJs: join(here, "..", "mcp", "server.js"),
	dataDir,
	emit: (channel, ...args) => win?.webContents.send(channel, ...args),
	openUrl,
	openPath: (p) => shell.openPath(p),
	revitDefault: () => {
		const usual = "D:\\Code\\BIM\\revit-mcp\\server\\build\\index.js";
		return existsSync(usual) ? usual : null;
	},
});
registerIpc(api, () => win, openUrl);

function createWindow(): void {
	win = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 1100,
		minHeight: 700,
		title: "Projektēšanas App",
		backgroundColor: "#161615",
		webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
	});
	win.setMenuBarVisibility(false);
	const wc = win.webContents;
	// links open in the system browser, never inside the app window
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
	// renderer errors and crashes go to the log; a dead renderer is reloaded instead of leaving a black window
	wc.on("console-message", (e) => {
		if (e.level === "error" || e.level === "warning") log(`renderer ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`);
	});
	wc.on("preload-error", (_e, path, error) => log(`preload error ${path}: ${error.stack ?? error}`));
	wc.on("render-process-gone", (_e, d) => {
		log(`renderer gone: ${d.reason} (exit ${d.exitCode})`);
		if (d.reason !== "clean-exit") setTimeout(() => win?.reload(), 500);
	});
	wc.on("unresponsive", () => log("renderer unresponsive"));
	// F5 / Ctrl+R reload, Ctrl+Shift+I developer tools: a way out of any broken screen
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
