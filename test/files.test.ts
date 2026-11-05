import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../src/kernel/project.ts";
import { registerFile, rescan, writeVersion, loadFiles, acknowledgeChange } from "../src/kernel/files.ts";
import { textDiff, ifcDiff, roomDiff } from "../src/kernel/diff.ts";
import { readLog } from "../src/kernel/log.ts";

function proj() {
	const root = mkdtempSync(join(tmpdir(), "bv-"));
	createProject(root, "T");
	return root;
}

test("register hashes once; changed source is flagged, new version, original bytes untouched by the app", () => {
	const root = proj();
	const p = join(root, "PU.txt");
	writeFileSync(p, "v1");
	const a = registerFile(root, "PU.txt", "PU");
	assert.equal(a.versions.length, 1);
	assert.equal(registerFile(root, "PU.txt").versions.length, 1);
	writeFileSync(p, "v1 edited elsewhere");
	const [f] = rescan(root);
	assert.equal(f.status, "changed");
	assert.equal(f.versions.length, 2);
	assert.equal(readFileSync(p, "utf8"), "v1 edited elsewhere");
	acknowledgeChange(root, "PU.txt");
	assert.equal(loadFiles(root)[0].status, "ok");
	assert.ok(readLog(root).entries.some((e) => e.kind === "file.changed"));
});

test("registerFile rejects paths outside the project and missing files", () => {
	const root = proj();
	assert.throws(() => registerFile(root, "..\\..\\Windows\\win.ini"));
	assert.throws(() => registerFile(root, "nope.pdf"));
});

test("writeVersion never overwrites: _v2, _v3", () => {
	const root = proj();
	writeFileSync(join(root, "plan.txt"), "orig");
	registerFile(root, "plan.txt");
	const a = writeVersion(root, "plan.txt", "one", "out");
	const b = writeVersion(root, "plan.txt", "two", "out");
	assert.deepEqual(readdirSync(join(root, "out")).sort(), ["plan_v2.txt", "plan_v3.txt"]);
	assert.equal(readFileSync(a, "utf8"), "one");
	assert.equal(readFileSync(b, "utf8"), "two");
	assert.equal(readFileSync(join(root, "plan.txt"), "utf8"), "orig");
});

test("textDiff marks added and removed lines", () => {
	const d = textDiff("a\nb\nc", "a\nc\nd");
	assert.deepEqual(d.filter((x) => x.op !== " ").map((x) => x.op + x.line), ["-b", "+d"]);
});

const G1 = "0abcdefghijklmnopqrstu";
const G2 = "1abcdefghijklmnopqrstu";
const G3 = "2abcdefghijklmnopqrstu";
const ifc = (x: number, extra = "") => `
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCLOCALPLACEMENT($,#2);
#4=IFCCARTESIANPOINT((${x}.,0.,0.));
#5=IFCAXIS2PLACEMENT3D(#4,$,$);
#6=IFCLOCALPLACEMENT(#3,#5);
#7=IFCWALL('${G1}',$,'W1',$,$,#6,$,$,$);
${extra}`;

test("ifcDiff by GlobalId: moved, added, removed", () => {
	const a = ifc(1000);
	const b = ifc(3000, `#8=IFCDOOR('${G2}',$,'D1',$,$,#6,$,$,$,$);`);
	const d = ifcDiff(a, b);
	assert.equal(d.moved.length, 1);
	assert.equal(d.moved[0].guid, G1);
	assert.equal(d.moved[0].to, "3000,0,0");
	assert.deepEqual(d.added.map((x) => x.guid), [G2]);
	const d2 = ifcDiff(b, ifc(3000, `#8=IFCSLAB('${G3}',$,'S',$,$,#6,$,$,$);`));
	assert.deepEqual(d2.removed.map((x) => x.guid), [G2]);
	assert.deepEqual(d2.added.map((x) => x.guid), [G3]);
});

test("ifcDiff: identical model gives an empty diff even when entity numbers shift", () => {
	const d = ifcDiff(ifc(1000), ifc(1000).replace(/#(\d+)/g, (_, n) => `#${Number(n) + 100}`));
	assert.deepEqual(d, { added: [], removed: [], moved: [], changed: [] });
});

test("roomDiff reports area change above 0.005 m2", () => {
	const a = [{ id: "1", name: "Foajē", level: "L1", areaM2: 20 }];
	const b = [{ id: "1", name: "Foajē", level: "L1", areaM2: 22.5 }, { id: "2", name: "WC", level: "L1", areaM2: 3 }];
	const d = roomDiff(a, b);
	assert.equal(d.areaChanged[0].to, 22.5);
	assert.equal(d.added[0].name, "WC");
});
