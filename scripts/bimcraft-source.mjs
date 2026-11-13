// Where BimCraft's checkout is: one lookup shared by the sync script, the tests and the settings row, so they cannot
// disagree (they once did: the sync and four tests all looked in a folder that never existed and skipped without a word).
// Order: BIMCRAFT_SOURCE, the opensrc mirror, a sibling checkout next to the repo's parent.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const here = import.meta.dirname;

/** Candidate checkout folders, best first. `env`, `home` and `root` are injectable for tests. */
export function bimcraftCandidates({ env = process.env, home = homedir(), root = resolve(here, "..") } = {}) {
	const list = [];
	if (env.BIMCRAFT_SOURCE) list.push({ dir: env.BIMCRAFT_SOURCE, why: "BIMCRAFT_SOURCE" });
	list.push({ dir: join(home, ".opensrc", "repos", "github.com", "getcadcraft", "bimcraft"), why: "opensrc mirror" });
	list.push({ dir: join(root, "..", "getcadcraft", "bimcraft"), why: "next to the repo" });
	return list;
}

/** The first candidate that holds app/bimcraft.js. `tried` lists every folder looked at, for the error message. */
export function findBimcraftSource(opts = {}, exists = existsSync) {
	const cands = bimcraftCandidates(opts);
	for (const c of cands) if (exists(join(c.dir, "app", "bimcraft.js"))) return { dir: c.dir, why: c.why, tried: cands.map((x) => x.dir) };
	return { dir: null, why: null, tried: cands.map((x) => x.dir) };
}

/** Vendor libraries the checkout pins (devshell/app.json) that are not fetched yet: [[lib, version], …]. */
export function missingVendor(src, exists = existsSync, readText = (p) => readFileSync(p, "utf8")) {
	const meta = JSON.parse(readText(join(src, "devshell", "app.json")));
	return Object.entries(meta.vendor ?? {}).filter(([lib, ver]) => !exists(join(src, "devshell", "vendor", lib, ver)));
}

/** For tests: the folder of the checkout, or null (the test then skips with the tried paths in its reason). */
export function bimcraftForTests() {
	const r = findBimcraftSource();
	return { dir: r.dir, tried: r.tried };
}
