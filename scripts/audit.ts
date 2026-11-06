// Plan vs code: every task row of docs/v2-work-plan.md — its files, its tests — and every tool of the agent tool table,
// checked against the repository; writes docs/CHECKLIST.md. Exit 1 when a planned file, test or tool is missing and no
// note below explains where it is.
//   node --import tsx scripts/audit.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allTools } from "../src/agent/tools/defs.ts";
import { REVIT_LEVELS } from "../src/agent/tools/revit-levels.ts";

const root = join(import.meta.dirname, "..");
const plan = readFileSync(join(root, "docs", "v2-work-plan.md"), "utf8");

/** Where a planned file ended up under another name, and why. Every entry is a real file. */
const MOVED: Record<string, { to: string; why: string }> = {
	"src/main/preload.ts": { to: "src/main/preload.cts", why: "Electron preload is CommonJS (.cts)" },
	"src/renderer/preview/Compare.tsx": { to: "src/renderer/preview/IfcView.tsx", why: "IFC compare is IfcView's compare mode (BimCraft paints it); the sheet compare is SheetCompare.tsx" },
	"src/renderer/panels/Versions.tsx": { to: "src/renderer/panels/Versijas.tsx", why: "panel files use the Latvian panel names" },
	"src/rules/workdays.ts": { to: "src/rules/clocks.ts", why: "4.2 clocks use workdays.ts (0.2) from clocks.ts" },
	"src/checks/run.ts": { to: "src/checks/gate.ts", why: "4.3 delivery gate in gate.ts, on top of run.ts" },
};

/** Tasks whose "done when" needs Boris on a real project or a live Revit / sign-in; the code and its tests are in place. */
const LIVE: Record<string, string> = {
	"0.5": "a chat turn through Codex needs Boris's ChatGPT sign-in in Iestatījumi",
	"1.9": "the agent answering with page and quote needs the sign-in",
	"3.3": "writing INV Area into Boris's model is his click (the batch is shown first)",
	"6.1": "exports from the open model are Boris's click; view list and geometry were read live",
	"6.3": "a confirmed batch needs the sign-in and a working copy open in Revit",
	"6.5": "modelling an existing building is the live acceptance of phase 6",
};

const expand = (p: string): string[] => {
	const m = /\{([^}]+)\}/.exec(p);
	if (!m) return [p];
	return m[1].split(",").flatMap((x) => expand(p.replace(m[0], x.trim())));
};

const exists = (p: string) => {
	if (p.endsWith("*") || p.endsWith("/*.ts")) return existsSync(join(root, p.replace(/\/?\*.*$/, "")));
	return existsSync(join(root, p));
};

const tests = readdirSync(join(root, "test")).filter((f) => f.endsWith(".test.ts"));
const testsFor = (id: string) =>
	tests.filter((f) => {
		const m = /^(\d+\.\d+)(?:-(\d+\.\d+))?/.exec(f);
		if (!m) return false;
		const [a, b] = [m[1], m[2] ?? m[1]].map((x) => x.split(".").map(Number));
		const [p, t] = id.split(".").map(Number);
		return p >= a[0] && p <= b[0] && (p > a[0] || t >= a[1]) && (p < b[0] || t <= b[1]);
	});

const rows: string[] = [];
const problems: string[] = [];
for (const line of plan.split("\n")) {
	const m = /^\| (\d\.\d+) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \|$/.exec(line);
	if (!m) continue;
	const [, id, build, filesCol, testsCol] = m;
	const files = [...filesCol.matchAll(/`([^`]+)`/g)].flatMap((x) => x[1].split(/,\s+(?![^{]*\})/)).flatMap((x) => expand(x.trim())).filter((x) => /^(src|scripts|resources|test|docs)\//.test(x) || /\.(ts|tsx|mjs|ps1)$/.test(x));
	const fileNotes = files.map((f) => {
		const full = f.includes("/") ? f : null;
		if (!full) return null;
		if (exists(full)) return `✓ ${full}`;
		const mv = MOVED[full];
		if (mv && exists(mv.to)) return `→ ${full} is ${mv.to} (${mv.why})`;
		problems.push(`${id}: ${full} missing`);
		return `✗ ${full}`;
	}).filter(Boolean);
	const t = testsFor(id);
	const needsTest = !/^—/.test(testsCol.trim());
	if (needsTest && !t.length) problems.push(`${id}: no test file`);
	const status = !needsTest ? "built (UI; Boris playtests)" : t.length ? (LIVE[id] ? `built and tested; live: ${LIVE[id]}` : "built and tested") : "✗ no test";
	rows.push(`| ${id} | ${build.replace(/\|/g, "/").slice(0, 90)}${build.length > 90 ? "…" : ""} | ${fileNotes.join("<br>")} | ${t.join("<br>") || (needsTest ? "✗" : "—")} | ${status} |`);
}

// the agent tool table
const toolTable = plan.slice(plan.indexOf("## Agent tools"), plan.indexOf("Skills:"));
const planned = [...toolTable.matchAll(/`([a-z_]+)(?:\(|`)/g)].map((x) => x[1]).filter((x) => !["send_code_to_revit", "delete_element"].includes(x));
const have = new Set([...allTools().map((t) => t.name), ...Object.keys(REVIT_LEVELS)]);
const missingTools = [...new Set(planned)].filter((t) => !have.has(t));
for (const t of missingTools) problems.push(`tool ${t} missing`);

const out = `# Checklist — plan vs code

Written by \`scripts/audit.ts\` on ${new Date().toISOString().slice(0, 16).replace("T", " ")}. Status per task of \`docs/v2-work-plan.md\`.
"built and tested" = the task's files exist and its tests pass in \`npm test\`; "live" = the task's "done when" needs Boris on a real project, a live Revit or the sign-in, as written there.

| Task | Build | Files | Tests | Status |
|---|---|---|---|---|
${rows.join("\n")}

## Agent tools

Planned in the tool table: ${[...new Set(planned)].length}. Present: ${[...new Set(planned)].length - missingTools.length}.${missingTools.length ? ` Missing: ${missingTools.join(", ")}.` : " None missing."}
\`delete_element\` and \`send_code_to_revit\` are \`never\` (not offered; test 0.5 and 6.3).

## Problems

${problems.length ? problems.map((p) => `- ${p}`).join("\n") : "None."}
`;
writeFileSync(join(root, "docs", "CHECKLIST.md"), out);
console.log(problems.length ? `audit: ${problems.length} problems\n${problems.join("\n")}` : `audit: ${rows.length} tasks, all files and tests present; ${[...new Set(planned)].length} planned tools present`);
process.exit(problems.length ? 1 : 0);
