// What the app actually has of BimCraft: the copy in resources/bimcraft (made by scripts/sync-bimcraft.mjs at build time),
// where it came from, and whether our bridge add-on is switched on in it. Shown in Iestatījumi like the Revit MCP row, so
// "the viewer is empty" can be told apart from "the build had no BimCraft" at a glance.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BimcraftStatusRow } from "../shared/api.js";

/** `appDir` is resources/bimcraft/app (what the other handlers get as bimcraftApp). */
export function bimcraftStatus(appDir: string): BimcraftStatusRow {
	const site = dirname(appDir);
	if (!existsSync(join(appDir, "bimcraft.js")) || !existsSync(join(site, "index.html"))) {
		return { state: "nav konfigurēts", dir: site, source: null, copiedAt: null, vendor: 0, addon: false, message: "BimCraft nav iekopēts: npm run build to dara no BimCraft pirmkoda (BIMCRAFT_SOURCE vai .opensrc spogulis)." };
	}
	let source: string | null = null;
	let copiedAt: string | null = null;
	let vendor = 0;
	try {
		const t = readFileSync(join(site, "SOURCE.txt"), "utf8");
		const m = /copied from (.+?) on (\S+?);/.exec(t);
		source = m?.[1] ?? null;
		copiedAt = m?.[2] ?? null;
		const pins = /vendor pins: (\{.*\})/.exec(t)?.[1];
		if (pins) vendor = Object.keys(JSON.parse(pins) as Record<string, string>).length;
	} catch {
		// a copy without SOURCE.txt still runs; the row just has no origin
	}
	let addon = false;
	try {
		const list = JSON.parse(readFileSync(join(appDir, "addons", "index.json"), "utf8")) as { addons?: string[] };
		addon = !!list.addons?.includes("projektesana") && existsSync(join(appDir, "addons", "projektesana"));
	} catch {
		addon = false;
	}
	return {
		state: addon ? "gatavs" : "nav tilta",
		dir: site,
		source,
		copiedAt,
		vendor,
		addon,
		message: addon ? undefined : "BimCraft ir, bet projektesana tilta papildinājums nav ieslēgts: atlase un skices nenonāks pie aģenta.",
	};
}
