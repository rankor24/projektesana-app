// Cross-checks docs/CHECKLIST.md: evidence files exist, `::` test names exist in that file, `done` rows have evidence,
// and every spec section 3–11 requirement id prefix is present. Fails (exit 1) on any gap.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const rows = readFileSync(join(root, "docs", "CHECKLIST.md"), "utf8")
	.split("\n")
	.filter((l) => /^\| [A-Z]\w* \|/.test(l))
	.map((l) => l.split("|").map((c) => c.trim()).slice(1, -1));

const STATUS = /^(done|done, not run live|not verified|partial|not done|later|waiting Boris)$/;
const problems: string[] = [];
const counts: Record<string, number> = {};
for (const [id, spec, req, status, evidence] of rows) {
	counts[status] = (counts[status] ?? 0) + 1;
	if (!STATUS.test(status)) problems.push(`${id}: unknown status "${status}"`);
	if (!req || !spec) problems.push(`${id}: empty requirement/spec`);
	if (!evidence) {
		if (status.startsWith("done")) problems.push(`${id}: done without evidence`);
		continue;
	}
	const [file, test] = evidence.split("::").map((s) => s.trim());
	const abs = join(root, file);
	if (!existsSync(abs)) {
		problems.push(`${id}: evidence file missing: ${file}`);
		continue;
	}
	if (test && !readFileSync(abs, "utf8").includes(test)) problems.push(`${id}: "${test}" not found in ${file}`);
}
const ids = new Set(rows.map((r) => r[0]));
for (const must of ["G1", "G4", "A1", "S1", "R2", "V3", "C2", "F2", "X2", "X4", "D6", "B1", "B5", "Q1"]) if (!ids.has(must)) problems.push(`missing row ${must}`);

console.log(`${rows.length} rows:`, counts);
for (const p of problems) console.log("PROBLEM", p);
const open = rows.filter((r) => !r[3].startsWith("done"));
console.log(`\nNot plain "done" (${open.length}):`);
for (const r of open) console.log(` ${r[0].padEnd(4)} ${r[3].padEnd(18)} ${r[2]}`);
process.exit(problems.length ? 1 : 0);
