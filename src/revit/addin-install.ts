// The optional install of the Revit add-in that ships inside the app (resources/revit-mcp/addins/<year>), the same placement
// Install-RevitMCP.ps1 of the Revit MCP bundle makes: <APPDATA>\Autodesk\Revit\Addins\<year>\{mcp-servers-for-revit.addin, revit_mcp_plugin\}.
// The server itself needs no install (the app starts it from its own folder); the add-in is what makes Revit answer.
// Nothing is deleted: an existing plugin folder is copied to a backup first, and the user's commandRegistry.json is kept.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

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

export interface CommandRegistry {
	Commands?: { commandName: string; [k: string]: unknown }[];
	settings?: unknown;
	[k: string]: unknown;
}

const readJson = (file: string): CommandRegistry => JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as CommandRegistry;

/** The user's command list (their on/off choices and settings) plus the shipped commands it does not have yet; the same rule as merge-registry.mjs of the Revit MCP bundle. */
export function mergeRegistry(kept: CommandRegistry, shipped: CommandRegistry): { registry: CommandRegistry; added: string[] } {
	const have = new Set((kept.Commands ?? []).map((c) => c.commandName));
	const fresh = (shipped.Commands ?? []).filter((c) => !have.has(c.commandName));
	return { registry: { ...kept, Commands: [...(kept.Commands ?? []), ...fresh], ...(kept.settings || !shipped.settings ? {} : { settings: shipped.settings }) }, added: fresh.map((c) => c.commandName) };
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
			// …but a command this add-in ships and the user's list lacks is added (enabled), or an update could never switch on a new command
			const shippedRegistry = join(from, PLUGIN, "Commands", "commandRegistry.json");
			if (existsSync(registry) && existsSync(shippedRegistry)) {
				const merged = mergeRegistry(readJson(registry), readJson(shippedRegistry));
				if (merged.added.length) {
					writeFileSync(registry, JSON.stringify(merged.registry, null, 2), "utf8");
					log.push(`Revit ${y}: jaunas komandas ieslēgtas: ${merged.added.join(", ")}`);
				}
			}
			writeFileSync(join(plugin, STAMP), pluginStamp(join(from, PLUGIN)), "utf8");
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code === "EBUSY" || code === "EPERM" || code === "EACCES") throw new Error(`Revit ${y}: faili ir aizņemti. Aizver Revit un mēģini vēlreiz.`);
			throw e;
		}
		log.push(`Revit ${y}: spraudnis ielikts (${plugin}). Restartē Revit.`);
	}
	return log;
}

// ---- keeping the add-in in step with the app ----------------------------------------------------------------------------------------------------

const STAMP = ".projektesana-stamp";

/** A fingerprint of the shipped plugin folder (names and contents, the user's commandRegistry.json left out): changes whenever the app ships another add-in. */
export function pluginStamp(dir: string): string {
	const h = createHash("sha1");
	const walk = (d: string) => {
		for (const n of readdirSync(d).sort()) {
			const f = join(d, n);
			if (statSync(f).isDirectory()) walk(f);
			else if (n !== "commandRegistry.json") {
				h.update(relative(dir, f).replace(/\\/g, "/"));
				h.update(readFileSync(f));
			}
		}
	};
	walk(dir);
	return h.digest("hex");
}

/** The Revit years this PC has: Revit's own program folder (the standard install path), or an add-in already placed for that year. */
export function revitYears(appData = appDataDir(), programFiles = process.env.ProgramFiles || "C:\\Program Files"): string[] {
	const fromProgram = existsSync(join(programFiles, "Autodesk")) ? readdirSync(join(programFiles, "Autodesk")).map((n) => /^Revit (\d{4})$/.exec(n)?.[1]).filter((y): y is string => !!y) : [];
	const fromAddins = existsSync(addinsRoot(appData)) ? readdirSync(addinsRoot(appData)).filter((y) => /^\d{4}$/.test(y)) : [];
	return [...new Set([...fromProgram, ...fromAddins])].sort();
}

/**
 * At the app's start (and after an update): puts the add-in this app ships into each Revit year of this PC whose installed copy is not the same one (no stamp, or another stamp),
 * so the Revit MCP in Revit is always the one the app was built with, with no click. Nothing is deleted (installAddins backs the old plugin up). A year whose files Revit holds is
 * left for the next start and named in the result. Returns one line per year it acted on; an empty list = already in step.
 */
export function syncAddins(bundled: string | null, backupDir: string, appData = appDataDir(), programFiles?: string): string[] {
	if (!bundled) return [];
	const out: string[] = [];
	for (const year of revitYears(appData, programFiles)) {
		const shipped = join(bundled, "addins", year);
		if (!existsSync(join(shipped, MANIFEST)) || !existsSync(join(shipped, PLUGIN))) continue;
		const stamp = pluginStamp(join(shipped, PLUGIN));
		const mark = join(addinsRoot(appData), year, PLUGIN, STAMP);
		if (existsSync(mark) && readFileSync(mark, "utf8").trim() === stamp) continue;
		try {
			out.push(...installAddins(bundled, [year], backupDir, appData));
		} catch (e) {
			out.push(`Revit ${year}: spraudnis nav atjaunots (${(e as Error).message})`);
		}
	}
	return out;
}
