// Copies the Revit MCP payload (node-server, node-runtime, addins/<year>) from a built Revit MCP bundle into resources/revit-mcp/,
// so the app ships its own server and add-in. The copy is build output and git-ignored; the bundle is never changed.
//   REVIT_MCP_BUNDLE=<folder with payload\> node scripts/sync-revit-mcp.mjs [--strict]
// Where it looks: REVIT_MCP_BUNDLE, else the newest Revit-MCP-Bundle-* in the user's Downloads (the folder
// D:\Code\BIM\revit-mcp\packaging\Build-Bundle.ps1 writes). Not found = a warning and a build without it (Settings then says so);
// --strict stops the build instead.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const out = join(root, "resources", "revit-mcp");
const strict = process.argv.includes("--strict");
const stop = (msg) => {
	if (strict) {
		console.error(`revit-mcp: ${msg}`);
		process.exit(1);
	}
	console.warn(`revit-mcp: ${msg} — skipped; the app will say the Revit MCP server is not included`);
	process.exit(0);
};

const downloads = join(process.env.USERPROFILE || homedir(), "Downloads");
const candidates = [];
if (process.env.REVIT_MCP_BUNDLE) candidates.push(process.env.REVIT_MCP_BUNDLE);
else if (existsSync(downloads)) {
	const found = readdirSync(downloads)
		.filter((n) => /^Revit-MCP-Bundle-.+/.test(n) && !/\.(zip|sha256)$/.test(n))
		.map((n) => join(downloads, n))
		.filter((p) => statSync(p).isDirectory())
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	candidates.push(...found);
}
const bundle = candidates.find((c) => existsSync(join(c, "payload", "node-server", "build", "index.js")));
if (!bundle) stop(`no Revit MCP bundle found (looked in: ${candidates.join(", ") || downloads}). Set REVIT_MCP_BUNDLE to the folder that holds payload\.`);

const payload = join(bundle, "payload");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const name of ["node-runtime", "node-server", "addins"]) {
	if (existsSync(join(payload, name))) cpSync(join(payload, name), join(out, name), { recursive: true });
}
// the licenses the bundle carries (Node, mcp-servers-for-revit)
if (existsSync(join(bundle, "licenses"))) cpSync(join(bundle, "licenses"), join(out, "licenses"), { recursive: true });
console.log(`revit-mcp: copied from ${bundle}`);
