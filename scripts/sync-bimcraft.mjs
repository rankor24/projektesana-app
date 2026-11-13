// Copies BimCraft (getcadcraft/bimcraft, Apache-2.0) into resources/bimcraft/ for the preview: app/, the shared site shell,
// the pre-rendered page and the pinned vendor libraries (fetched and sha256-checked by BimCraft's own
// devshell/fetch-vendor.mjs), plus our bridge add-on (src/bimcraft-addon/projektesana) listed in its add-on index.
// The copy is build output and git-ignored; BimCraft's checkout is never changed.
//   BIMCRAFT_SOURCE=<path> node scripts/sync-bimcraft.mjs [--optional]
// Where it looks: scripts/bimcraft-source.mjs (BIMCRAFT_SOURCE, the opensrc mirror, a sibling checkout). Strict by default:
// a build without BimCraft would ship a preview that answers 404, so a missing checkout or missing vendor libraries stop
// the build with the paths tried. --optional only warns (a machine that runs typecheck or tests, not the app).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findBimcraftSource, missingVendor } from "./bimcraft-source.mjs";

const root = join(import.meta.dirname, "..");
const out = join(root, "resources", "bimcraft");
const optional = process.argv.includes("--optional");
const stop = (msg) => {
	if (optional) {
		console.warn(`bimcraft: ${msg} — skipped (--optional); the IFC preview will say "nav konfigurēts"`);
		process.exit(0);
	}
	console.error(`bimcraft: ${msg}`);
	process.exit(1);
};

const found = findBimcraftSource();
if (!found.dir) stop(`BimCraft not found. Looked for app/bimcraft.js in:\n  ${found.tried.join("\n  ")}\nSet BIMCRAFT_SOURCE to the checkout.`);
const src = found.dir;
const vendor = join(src, "devshell", "vendor");
const meta = JSON.parse(readFileSync(join(src, "devshell", "app.json"), "utf8"));
const missing = missingVendor(src);
if (missing.length) stop(`vendor libraries not fetched: ${missing.map(([l, v]) => `${l}@${v}`).join(", ")} — run node devshell/fetch-vendor.mjs in ${src}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, "app"), join(out, "app"), { recursive: true, filter: (p) => !/[\\/](test|tests)[\\/]?$/.test(p) && !p.endsWith(".md") });
cpSync(join(src, "devshell", "site"), join(out, "site"), { recursive: true });
cpSync(vendor, join(out, "vendor"), { recursive: true });
for (const f of ["index.html", "app.json"]) cpSync(join(src, "devshell", f), join(out, f));
for (const f of ["LICENSE", "NOTICE", "THIRD_PARTY.md"]) if (existsSync(join(src, f))) cpSync(join(src, f), join(out, f));

// the shell's icon font (BimCraft's edition kit takes Bootstrap Icons 1.13.2, MIT, from the release; the checkout's site/
// folder does not carry it): the same files from the npm package of that version
const icons = join(root, "node_modules", "bootstrap-icons", "font");
if (existsSync(icons)) {
	const to = join(out, "site", "assets", "vendor", "bootstrap-icons", "current");
	mkdirSync(to, { recursive: true });
	cpSync(join(icons, "bootstrap-icons.min.css"), join(to, "bootstrap-icons.min.css"));
	cpSync(join(icons, "fonts"), join(to, "fonts"), { recursive: true });
	cpSync(join(root, "node_modules", "bootstrap-icons", "LICENSE"), join(to, "LICENSE"));
} else console.warn("bimcraft: bootstrap-icons not installed (npm install): BimCraft's icons will be missing");

// our bridge add-on, switched on, listed first
cpSync(join(root, "src", "bimcraft-addon", "projektesana"), join(out, "app", "addons", "projektesana"), { recursive: true });
const idx = join(out, "app", "addons", "index.json");
const list = JSON.parse(readFileSync(idx, "utf8"));
list.addons = ["projektesana", ...(list.addons ?? []).filter((a) => a !== "projektesana")];
writeFileSync(idx, JSON.stringify(list, null, 2));
writeFileSync(join(out, "SOURCE.txt"), `BimCraft copied from ${src} on ${new Date().toISOString()}; vendor pins: ${JSON.stringify(meta.vendor)}\n`);
console.log(`bimcraft: synced from ${src} (${found.why})`);
