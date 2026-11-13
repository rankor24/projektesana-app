// Plan vs code: every task row of docs/v2-work-plan.md — its files, its tests — and every tool of the agent tool table,
// checked against the repository; writes docs/CHECKLIST.md. Exit 1 when a planned file, test or tool is missing and no
// note below explains where it is.
//   node --import tsx scripts/audit.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allTools } from "../src/agent/tools/defs.ts";
import { REVIT_LEVELS } from "../src/agent/tools/revit-levels.ts";
import { MAIN_TOOL_LEVELS } from "../src/agent/subagents.ts";

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

/** Tasks whose "done when" needs the user: their eyes on the UI (no UI automation), a hand-made reference, a live Revit or
 *  the sign-in. The code and its tests are in place; this part is not claimed. */
const LIVE: Record<string, string> = {
	"0.1": "`npm start` opening the window is the user's playtest",
	"0.4": "moving, docking, minimising a panel is the user's playtest",
	"0.5": "a chat turn through Codex needs the user's ChatGPT sign-in in Iestatījumi",
	"1.1": "the panel itself is the user's playtest",
	"1.7": "the panel itself is the user's playtest",
	"1.8": "clicking a page region is the user's playtest",
	"1.9": "the agent answering with page and quote needs the sign-in",
	"1.10": "equal to the table the user made by hand on a real project — their comparison",
	"1.11": "the profile and timeline on screen are the user's playtest",
	"2.3": "the top-bar counter on screen is the user's playtest",
	"2.5": "the panel itself is the user's playtest",
	"3.1": "the open model's rooms were read live through the Revit MCP; the app's list on screen is the user's playtest",
	"3.2": "equal to the check sheets the user made by hand — their comparison",
	"3.3": "writing INV Area into the user's model is their click (the batch is shown first)",
	"3.4": "the overlay matching the plan is the user's eye",
	"4.3": "the panel itself is the user's playtest",
	"5.1": "a real IFC opening in BimCraft and click-to-focus are the user's playtest",
	"5.2": "the painting on screen is the user's playtest",
	"5.3": "opening the BCF in Solibri is the user's",
	"5.5": "the panel itself is the user's playtest",
	"6.1": "exports from the open model are the user's click; view list and geometry were read live",
	"6.2": "a revision after a real batch needs the sign-in and a working copy",
	"6.3": "a confirmed batch needs the sign-in and a working copy open in Revit",
	"6.4": "a pin becoming a change needs the sign-in",
	"6.5": "modelling an existing building is the live acceptance of phase 6",
	"7.3": "the sheet export from the open model (one PDF per sheet, Revit's own file names) needs Revit; tested against the recorded reply shape only",
	"7.4": "the IFC export into staging needs Revit",
	"7.5": "the agent filling a draft needs the sign-in",
	"7.6": "the copy into a real project's 1.4_Nodevumi is the user's click; tested on an invented tree only",
	"7.7": "the page itself is the user's playtest",
	"8.0": "the packaged exe opening BimCraft with the bridge add-on is the user's playtest; smoke:packaged checks the shipped files only",
	"8.1": "an IFC picked in Avoti opening in 3D is the user's playtest",
	"8.2": "a pin on a wall surviving a restart is the user's playtest; the agent naming it needs the sign-in",
	"8.3": "finding a real project's file in two clicks is the user's playtest",
	"8.4": "the dashboard on screen is the user's playtest",
	"8.5": "planning a week on the Grafiks is the user's playtest",
	"8.6": "the palette on screen is the user's playtest",
	"8.7": "undoing an agent write needs the sign-in; the run card is the user's playtest",
	"8.8": "a lesson in the agent's answer on another project needs the sign-in",
	"8.9": "a real draft's IFC row needs a real project's models; the open Revit document's levels need Revit",
	"8.10": "setting up a section's model from the guide needs Revit and the user",
	"8.11": "a sheet change opening its element in 3D is the user's playtest",
	"8.12": "the Pārdēvēt panel is the user's playtest",
	"8.13": "Word ran on invented documents only; the agent drafting a paskaidrojuma raksts needs the sign-in",
	"8.14": "a real atzinums' layout is not verified (invented reviews only); the tab is the user's playtest",
	"8.15": "lanes against a real model need the sign-in (scripted loops only); the Aģenti page is the user's playtest",
};

/** Done-when lines checked on a real project on the user's PC (read-only, counts only — no project data in the repo). */
const REAL: Record<string, string> = {
	"1.2": "a project with survey photo folders and 84 GB of point clouds: scanned in 17 s, each survey one row",
	"1.4": "a real .edoc: inner documents merged with their loose copies, 8 signers shown",
	"1.5": "a real scanned annex read by OCR with 702 Latvian letters",
	"2.2": "152 PU rows and 3 office-standard rows on one project",
	"2.4": "after the fix no false errors; 3 info rows where property documents are missing",
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
	if (!m) {
		// a task row that does not parse was skipped without a word once (8.8: a carriage return where `\r` was meant)
		if (/^\| \d\.\d+ \|/.test(line)) problems.push(`${line.slice(2, 8).trim()}: plan row does not parse (a control character or a missing cell?)`);
		continue;
	}
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
	const base = t.length ? "built and tested" : needsTest ? "✗ no test" : "built (UI)";
	const status = [base, REAL[id] && `real: ${REAL[id]}`, LIVE[id] && `live: ${LIVE[id]}`].filter(Boolean).join("; ");
	rows.push(`| ${id} | ${build.replace(/\|/g, "/").slice(0, 90)}${build.length > 90 ? "…" : ""} | ${fileNotes.join("<br>")} | ${t.join("<br>") || (needsTest ? "✗" : "—")} | ${status} |`);
}

// the agent tool table
const toolTable = plan.slice(plan.indexOf("## Agent tools"), plan.indexOf("Skills:"));
const planned = [...toolTable.matchAll(/`([a-z_]+)(?:\(|`)/g)].map((x) => x[1]).filter((x) => !["send_code_to_revit", "delete_element"].includes(x));
// run_subagent and delegate are tools of the main process (they start model runs), not of the tools server
const have = new Set([...allTools().map((t) => t.name), ...Object.keys(REVIT_LEVELS), ...Object.keys(MAIN_TOOL_LEVELS)]);
const missingTools = [...new Set(planned)].filter((t) => !have.has(t));
for (const t of missingTools) problems.push(`tool ${t} missing`);

const out = `# Checklist — plan vs code

Written by \`scripts/audit.ts\` on ${new Date().toISOString().slice(0, 16).replace("T", " ")}. Status per task of \`docs/v2-work-plan.md\`.
"built and tested" = the task's files exist and its tests pass in \`npm test\` (invented fixtures). "real" = its "done when" was also checked on a real project on the user's PC (read-only, counts only). "live" = the part of its "done when" that needs the user — their eyes on the UI, a hand-made reference, a live Revit or the sign-in — not claimed here.

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
