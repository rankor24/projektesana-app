// Copies CadCraft (getcadcraft/cadcraft, Apache-2.0, the 2D drafting app that opens DWG and DXF) into resources/cadcraft/ for
// the DWG view, as scripts/sync-bimcraft.mjs does for BimCraft: app/, the shared site shell, the pre-rendered page, the vendor
// libraries its app.json pins (fetched and sha256-checked by CadCraft's own devshell/fetch-vendor.mjs; the ones only a plot
// or a test loads, like the 10 MB CJK font, stay out), plus our bridge add-on (src/cadcraft-addon/projektesana) listed first
// in its add-on index. Main also imports CadCraft's DOM-free reader and compare from the same copy (src/sources/dwg.ts), so
// the folder is marked as ES modules. The copy is build output and git-ignored; CadCraft's checkout is never changed.
//   CADCRAFT_SOURCE=<path> node scripts/sync-cadcraft.mjs [--optional]
// Where it looks: CADCRAFT_SOURCE, the opensrc mirror, a sibling checkout. Strict by default (a setup without CadCraft would
// ship a DWG view that answers 404); --optional only warns.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyCadcraftPatches } from "./cadcraft-patches.mjs";

const root = join(import.meta.dirname, "..");
const out = join(root, "resources", "cadcraft");
const optional = process.argv.includes("--optional");
const stop = (msg) => {
	if (optional) {
		console.warn(`cadcraft: ${msg} — skipped (--optional); the DWG view falls back to plain lines`);
		process.exit(0);
	}
	console.error(`cadcraft: ${msg}`);
	process.exit(1);
};

const candidates = [
	...(process.env.CADCRAFT_SOURCE ? [process.env.CADCRAFT_SOURCE] : []),
	join(homedir(), ".opensrc", "repos", "github.com", "getcadcraft", "cadcraft"),
	join(root, "..", "getcadcraft", "cadcraft"),
];
const src = candidates.find((c) => existsSync(join(c, "app", "cadcraft.js")));
if (!src) stop(`CadCraft not found. Looked for app/cadcraft.js in:\n  ${candidates.join("\n  ")}\nSet CADCRAFT_SOURCE to the checkout.`);
const meta = JSON.parse(readFileSync(join(src, "devshell", "app.json"), "utf8"));
const pins = Object.entries(meta.vendor ?? {});
const missing = pins.filter(([lib, ver]) => !existsSync(join(src, "devshell", "vendor", lib, ver)));
if (missing.length) stop(`vendor libraries not fetched: ${missing.map(([l, v]) => `${l}@${v}`).join(", ")} — run node devshell/fetch-vendor.mjs in ${src}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, "app"), join(out, "app"), { recursive: true, filter: (p) => !/[\\/](test|tests)[\\/]?$/.test(p) && !p.endsWith(".md") });
cpSync(join(src, "devshell", "site"), join(out, "site"), { recursive: true });
for (const [lib, ver] of pins) cpSync(join(src, "devshell", "vendor", lib, ver), join(out, "vendor", lib, ver), { recursive: true });
for (const f of ["index.html", "app.json"]) cpSync(join(src, "devshell", f), join(out, f));
for (const f of ["LICENSE", "NOTICE", "THIRD_PARTY.md"]) if (existsSync(join(src, f))) cpSync(join(src, f), join(out, f));
// our fixes to the copy (scripts/cadcraft-patches.mjs); a CadCraft change that moved the patched code stops the sync
try {
	console.log(`cadcraft: ${applyCadcraftPatches(out)} patch(es) applied`);
} catch (e) {
	stop(e.message);
}

// the shell's icon font, as for BimCraft (Bootstrap Icons, MIT, from the npm package)
const icons = join(root, "node_modules", "bootstrap-icons", "font");
if (existsSync(icons)) {
	const to = join(out, "site", "assets", "vendor", "bootstrap-icons", "current");
	mkdirSync(to, { recursive: true });
	cpSync(join(icons, "bootstrap-icons.min.css"), join(to, "bootstrap-icons.min.css"));
	cpSync(join(icons, "fonts"), join(to, "fonts"), { recursive: true });
	cpSync(join(root, "node_modules", "bootstrap-icons", "LICENSE"), join(to, "LICENSE"));
} else console.warn("cadcraft: bootstrap-icons not installed (npm install): CadCraft's icons will be missing");

// our bridge add-on, switched on, listed first
cpSync(join(root, "src", "cadcraft-addon", "projektesana"), join(out, "app", "addons", "projektesana"), { recursive: true });
cpSync(join(root, "src", "craft-style", "compact.css"), join(out, "app", "addons", "projektesana", "compact.css"));
const idx = join(out, "app", "addons", "index.json");
const list = JSON.parse(readFileSync(idx, "utf8"));
list.addons = ["projektesana", ...(list.addons ?? []).filter((a) => a !== "projektesana")];
writeFileSync(idx, JSON.stringify(list, null, 2));
// main imports the reader from here in Node; the browser never reads this file
writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module", private: true }, null, 2));
writeFileSync(join(out, "SOURCE.txt"), `CadCraft copied from ${src} on ${new Date().toISOString()}; vendor pins: ${JSON.stringify(meta.vendor)}\n`);
console.log(`cadcraft: synced from ${src}`);
