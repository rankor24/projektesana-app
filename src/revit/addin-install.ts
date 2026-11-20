// The optional install of the Revit add-in that ships inside the app (resources/revit-mcp/addins/<year>), the same placement
// Install-RevitMCP.ps1 of the Revit MCP bundle makes: <APPDATA>\Autodesk\Revit\Addins\<year>\{mcp-servers-for-revit.addin, revit_mcp_plugin\}.
// The server itself needs no install (the app starts it from its own folder); the add-in is what makes Revit answer.
// Nothing is deleted: an existing plugin folder is copied to a backup first, and the user's commandRegistry.json is kept.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AddinYear {
	year: string;
	/** shipped with the app */
	available: boolean;
	/** the add-in manifest is already in the user's Revit add-ins folder */
	installed: boolean;
}

const MANIFEST = "mcp-servers-for-revit.addin";
const PLUGIN = "revit_mcp_plugin";

export function appDataDir(): string {
	return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
}

const addinsRoot = (appData: string) => join(appData, "Autodesk", "Revit", "Addins");

export function addinStatus(bundled: string | null, appData = appDataDir()): AddinYear[] {
	const shipped = bundled && existsSync(join(bundled, "addins")) ? readdirSync(join(bundled, "addins")).filter((y) => /^\d{4}$/.test(y) && existsSync(join(bundled, "addins", y, MANIFEST))) : [];
	const installed = existsSync(addinsRoot(appData)) ? readdirSync(addinsRoot(appData)).filter((y) => /^\d{4}$/.test(y) && existsSync(join(addinsRoot(appData), y, MANIFEST))) : [];
	const years = [...new Set([...shipped, ...installed])].sort();
	return years.map((year) => ({ year, available: shipped.includes(year), installed: installed.includes(year) }));
}

/** Copies the shipped add-in of each year. Returns what was done, one line per year; throws a clear message when Revit holds the files. */
export function installAddins(bundled: string | null, years: string[], backupDir: string, appData = appDataDir()): string[] {
	if (!bundled) throw new Error("Revit MCP nav iekļauts šajā lietotnes versijā.");
	const log: string[] = [];
	for (const y of years) {
		if (!/^\d{4}$/.test(y)) throw new Error(`Nederīgs Revit gads: ${y}`);
		const from = join(bundled, "addins", y);
		if (!existsSync(join(from, MANIFEST))) throw new Error(`Revit ${y} spraudnis nav iekļauts lietotnē.`);
		const to = join(addinsRoot(appData), y);
		const plugin = join(to, PLUGIN);
		mkdirSync(to, { recursive: true });
		try {
			if (existsSync(plugin)) {
				const bk = join(backupDir, y);
				mkdirSync(bk, { recursive: true });
				cpSync(plugin, join(bk, PLUGIN), { recursive: true });
				if (existsSync(join(to, MANIFEST))) cpSync(join(to, MANIFEST), join(bk, MANIFEST));
			}
			// the enabled-command list the user already has stays
			const registry = join(plugin, "Commands", "commandRegistry.json");
			cpSync(join(from, PLUGIN), plugin, { recursive: true, filter: (p) => !(p.endsWith("commandRegistry.json") && existsSync(registry)) });
			cpSync(join(from, MANIFEST), join(to, MANIFEST));
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code === "EBUSY" || code === "EPERM" || code === "EACCES") throw new Error(`Revit ${y}: faili ir aizņemti. Aizver Revit un mēģini vēlreiz.`);
			throw e;
		}
		log.push(`Revit ${y}: spraudnis ielikts (${plugin}). Restartē Revit.`);
	}
	return log;
}
