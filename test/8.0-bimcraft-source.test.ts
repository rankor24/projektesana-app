// 8.0 where BimCraft is looked for, what a build does without it, and what the settings row reports. Invented folders only.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
// @ts-expect-error plain .mjs shared with the build script
import { bimcraftCandidates, findBimcraftSource, missingVendor } from "../scripts/bimcraft-source.mjs";
import { bimcraftStatus } from "../src/main/bimcraft-status.ts";
import { tmp } from "./helpers.ts";

const mk = (root: string, files: Record<string, string>) => {
	for (const [rel, body] of Object.entries(files)) {
		mkdirSync(join(root, ...rel.split("/").slice(0, -1)), { recursive: true });
		writeFileSync(join(root, ...rel.split("/")), body);
	}
};

test("lookup order: BIMCRAFT_SOURCE, then the opensrc mirror, then the sibling checkout", () => {
	const c = bimcraftCandidates({ env: { BIMCRAFT_SOURCE: join("own", "bc") }, home: join("h", "u"), root: join("r", "repo") }) as { dir: string; why: string }[];
	assert.deepEqual(c.map((x) => x.why), ["BIMCRAFT_SOURCE", "opensrc mirror", "next to the repo"]);
	assert.equal(c[0].dir, join("own", "bc"));
	assert.equal(c[1].dir, join("h", "u", ".opensrc", "repos", "github.com", "getcadcraft", "bimcraft"));
	assert.equal(bimcraftCandidates({ env: {}, home: join("h", "u"), root: join("r", "repo") }).length, 2);
});

test("first folder that holds app/bimcraft.js wins; none → null with every path tried", () => {
	const mirror = tmp();
	mk(mirror, { ".opensrc/repos/github.com/getcadcraft/bimcraft/app/bimcraft.js": "//" });
	const hit = findBimcraftSource({ env: {}, home: mirror, root: join(tmp(), "repo") }) as { dir: string; why: string; tried: string[] };
	assert.equal(hit.why, "opensrc mirror");
	const none = findBimcraftSource({ env: { BIMCRAFT_SOURCE: join(tmp(), "nope") }, home: tmp(), root: join(tmp(), "repo") }) as { dir: string | null; tried: string[] };
	assert.equal(none.dir, null);
	assert.equal(none.tried.length, 3);
});

test("a checkout with unfetched vendor libraries is reported by name and version", () => {
	const src = tmp();
	mk(src, { "devshell/app.json": JSON.stringify({ vendor: { three: "1.0.0", pdfjs: "2.0.0" } }), "devshell/vendor/three/1.0.0/three.js": "//" });
	assert.deepEqual(missingVendor(src), [["pdfjs", "2.0.0"]]);
});

test("settings row: no copy → nav konfigurēts; copy without our add-on → nav tilta; with it → gatavs", () => {
	const site = tmp();
	const app = join(site, "app");
	assert.equal(bimcraftStatus(app).state, "nav konfigurēts");

	mk(site, { "index.html": "<html/>", "app/bimcraft.js": "//", "app/addons/index.json": JSON.stringify({ addons: ["other"] }) });
	assert.equal(bimcraftStatus(app).state, "nav tilta");

	const pins = JSON.stringify({ three: "1", pdfjs: "2" });
	mk(site, { "app/addons/projektesana/addon.js": "//", "app/addons/index.json": JSON.stringify({ addons: ["projektesana", "other"] }), "SOURCE.txt": `BimCraft copied from D:/bc on 2026-11-13T06:09:48.706Z; vendor pins: ${pins}
` });
	const s = bimcraftStatus(app);
	assert.equal(s.state, "gatavs");
	assert.equal(s.source, "D:/bc");
	assert.equal(s.copiedAt, "2026-11-13T06:09:48.706Z");
	assert.equal(s.vendor, 2);
	assert.equal(s.addon, true);
});

test("the real copy the build made (when there is one) is ready with our bridge", () => {
	const site = join(import.meta.dirname, "..", "resources", "bimcraft");
	const s = bimcraftStatus(join(site, "app"));
	if (s.state === "nav konfigurēts") return; // no build on this PC yet; the packaged smoke test covers shipping
	assert.equal(s.state, "gatavs", s.message);
});
