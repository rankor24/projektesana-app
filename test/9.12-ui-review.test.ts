// 9.12 the board review of phase 9: a closed window reopens where the page keeps it and every page lists all its windows;
// 2D compare picks its view by file kind, diffs two texts word by word, chains DWG and document reissues in Versijas, and
// reads / compares real DWG through CadCraft; colour goes with a comment; the matrix counts open questions; the dashboard's
// folders count models and recent changes; the BimCraft bridge makes the frame compact without touching a user's choice.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as L from "../src/shared/layout.ts";
import { defaultLayout, PAGES, pageWindows } from "../src/shared/pages.ts";
import { modeOfFile, pairMode, textDiff } from "../src/shared/compare2d.ts";
import { buildPin, toolsFor } from "../src/shared/comment-tools.ts";
import { rowQuestions, type MatrixRow } from "../src/shared/coordination-matrix.ts";
import { folderCounts } from "../src/core/summary.ts";
import { seriesPrev } from "../src/core/versions.ts";
import type { Source } from "../src/core/model.ts";

const VP = { w: 1600, h: 900 };

const src = (id: string, title: string, file: string, mtime: string): Source =>
	({ id, title, kind: "document", role: "cits", folderKey: "02", paths: [`D:/P/${file}`], versions: [{ sha256: id.padEnd(64, "0"), mtime, size: 1, seenAt: mtime }] }) as unknown as Source;

// ---- DWG through CadCraft: its own public fixture (fixtures/dwg/base-plan.dwg), skipped when the checkout is not there ----
const CADCRAFT = [process.env.CADCRAFT_SOURCE, join(homedir(), ".opensrc", "repos", "github.com", "getcadcraft", "cadcraft")].find((d) => d && existsSync(join(d, "app", "drawing-compare.js")));
const FIXTURE = CADCRAFT && join(CADCRAFT, "fixtures", "dwg", "base-plan.dwg");

// ---- CadCraft in the app: its site under cadcraft://, the bridge's marks and look, the agent's compare ----
import { craftSite, mapBimcraftPath } from "../src/main/bimcraft-protocol.ts";
import { checkViewerAction } from "../src/shared/ui-instruction.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmp } from "./helpers.ts";

test("cadcraft:// serves CadCraft's copy with the same layout as BimCraft's, and nothing outside it", () => {
	const dir = tmp("cadsite");
	mkdirSync(join(dir, "app"), { recursive: true });
	writeFileSync(join(dir, "index.html"), "<html></html>");
	writeFileSync(join(dir, "app", "cadcraft.js"), "");
	writeFileSync(join(dir, "app.json"), JSON.stringify({ vendor: { three: "0.186.1" } }));
	const site = craftSite(dir, "cadcraft")!;
	assert.ok(site);
	assert.equal(craftSite(dir, "bimcraft"), null);
	assert.equal(mapBimcraftPath(site, "/assets/apps/cadcraft/dev/cadcraft.js"), join(dir, "app", "cadcraft.js"));
	assert.equal(mapBimcraftPath(site, "/assets/apps/bimcraft/dev/bimcraft.js"), null);
	assert.equal(mapBimcraftPath(site, "/assets/vendor/three/current/three.module.js"), join(dir, "vendor", "three", "0.186.1", "three.module.js"));
	assert.equal(mapBimcraftPath(site, "/assets/apps/cadcraft/dev/../../../../secret.txt"), null);
});

