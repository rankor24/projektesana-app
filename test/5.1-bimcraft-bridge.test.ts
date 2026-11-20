// 5.1 the BimCraft bridge contract: BimCraft's real add-on loader and API 1.1 (getcadcraft/bimcraft app/addons/bimcraft-api.js),
// our bridge add-on (src/bimcraft-addon/projektesana), BimCraft's real IFC engine on an invented IFC, and a real
// MessageChannel standing where the frame boundary is in the app. Skipped only when the BimCraft checkout is not on this PC.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";
import { elementFocus, isBimcraftMessage, type BimcraftToHost } from "../src/shared/bimcraft-protocol.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED, FIX, tmp } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");
const BIMCRAFT = BIMCRAFT_DIR ?? "";
const DEV = join(BIMCRAFT, "app");
const have = existsSync(join(DEV, "addons", "bimcraft-api.js"));

test("bimcraft:// maps BimCraft's URL layout and nothing outside its copy", async () => {
	const { bimcraftResponse, mapBimcraftPath } = await import("../src/main/bimcraft-protocol.ts");
	const dir = tmp();
	for (const f of ["index.html", "app/bimcraft.js", "vendor/three/0.186.1/three.module.js", "site/assets/css/site.css"]) {
		mkdirSync(join(dir, f, ".."), { recursive: true });
		writeFileSync(join(dir, f), "x");
	}
	const site = { dir, slug: "bimcraft", vendorPins: { three: "0.186.1" }, isolate: "" };
	assert.equal(mapBimcraftPath(site, "/"), join(dir, "index.html"));
	assert.equal(mapBimcraftPath(site, "/assets/apps/bimcraft/dev/bimcraft.js"), join(dir, "app", "bimcraft.js"));
	assert.equal(mapBimcraftPath(site, "/assets/vendor/three/current/three.module.js"), join(dir, "vendor", "three", "0.186.1", "three.module.js"));
	assert.equal(mapBimcraftPath(site, "/assets/css/site.css"), join(dir, "site", "assets", "css", "site.css"));
	assert.equal(mapBimcraftPath(site, "/assets/apps/bimcraft/dev/../../../../../Windows/win.ini"), null);
	assert.equal(mapBimcraftPath(site, "/etc/passwd"), null);
	assert.equal(bimcraftResponse(site, "bimcraft://app/assets/apps/bimcraft/dev/bimcraft.js").headers["Content-Type"], "text/javascript; charset=utf-8");
	assert.equal(bimcraftResponse(site, "bimcraft://app/nav.js").status, 404);
});
