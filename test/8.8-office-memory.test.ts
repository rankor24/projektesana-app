// 8.8 office memory: lessons that hold for every project, in <app data>\memory. A note the user writes or lifts is standing
// at once; one the agent writes is a proposal the agent does not see as memory until the user accepts; lifting copies;
// rejecting and replacing delete nothing. A lesson lifted from one project is what the agent reads in another.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allTools, appLevels } from "../src/agent/tools/defs.ts";
import type { ToolCtx } from "../src/agent/tools/context.ts";
import { SYSTEM_PROMPT } from "../src/agent/prompt.ts";
import type { Note } from "../src/core/model.ts";
import { parseNote, readNotes, serializeNote } from "../src/core/notes.ts";
import { OfficeMemory } from "../src/core/office-memory.ts";
import { ProjectStore } from "../src/core/store.ts";
import { tmp } from "./helpers.ts";

const mkStore = (id: string, projectsDir = tmp()) => ProjectStore.open(projectsDir, { id, name: id, root: tmp(), createdAt: "2026-11-13T00:00:00Z" });
const note = (o: Partial<Note> = {}): Note => ({ id: "n1", type: "learning", title: "Fasāžu apmetums", body: "Pirms krāsošanas pārbaudīt mitrumu.", refs: [], by: "user", at: "2026-11-13T10:00:00.000Z", ...o });

test("a note is a file: front matter and body round-trip, with where it came from and its state; a broken file is skipped", () => {
	const n = note({ from: { project: "BD1", note: "n9" }, state: "proposed", refs: ["f1"] });
	assert.deepEqual(parseNote(serializeNote(n)), n);
	assert.deepEqual(parseNote(serializeNote(note())), note(), "no from or state: none appear");
	assert.deepEqual(parseNote(serializeNote(note()).replace(/\n/g, "\r\n")), note(), "Windows line ends");
	assert.equal(parseNote("nav piezīme"), null);
	assert.equal(parseNote("---\n{bojāts\n---\nteksts\n"), null, "damaged front matter");
	const dir = tmp();
	writeFileSync(join(dir, "n1.md"), serializeNote(note()));
	writeFileSync(join(dir, "n2.md"), "bojāts");
	writeFileSync(join(dir, "n3.txt"), "nav md");
	assert.deepEqual(readNotes(dir).map((x) => x.id), ["n1"]);
	assert.deepEqual(readNotes(join(dir, "nav-tādas-mapes")), []);
});

test("the project store's notes work as before, newest first, a replaced note kept in versions", () => {
	const s = mkStore("BD1");
	s.writeNote(note({ id: "a", at: "2026-11-10T00:00:00.000Z" }));
	s.writeNote(note({ id: "b", at: "2026-11-12T00:00:00.000Z", type: "decision" }));
	s.writeNote(note({ id: "a", at: "2026-11-10T00:00:00.000Z", body: "Labots." }));
	assert.deepEqual(s.notes().map((n) => n.id), ["b", "a"]);
	assert.deepEqual(s.notes("decision").map((n) => n.id), ["b"]);
	assert.equal(s.notes().find((n) => n.id === "a")!.body, "Labots.");
	assert.equal(readdirSync(join(s.dir, "versions")).filter((f) => f.startsWith("note.a.")).length, 1, "the earlier text is still there");
	assert.ok(s.events().some((e) => e.kind === "note.written"));
});

test("the user's note is standing at once; the agent's is a proposal; the agent sees only what stands", () => {
	const m = new OfficeMemory(join(tmp(), "memory"));
	const u = m.write({ type: "learning", title: "Mitrums pirms apmetuma", body: "Mēri." }, "user");
	const a = m.write({ type: "learning", title: "Aģenta ieteikums", body: "Kaut kas." }, "agent");
	assert.equal(u.state, undefined);
	assert.equal(a.state, "proposed");
	assert.deepEqual(m.list().map((n) => n.id).sort(), [a.id, u.id].sort(), "the user sees both");
	assert.deepEqual(m.list({ standing: true }).map((n) => n.id), [u.id], "the agent sees what stands");
	assert.deepEqual(m.list({ type: "decision" }), []);
	assert.throws(() => m.write({ type: "learning", title: "x", body: "" }, "user"), /pārāk īss/);
	assert.ok(readFileSync(join(m.dir, "log.jsonl"), "utf8").includes("memory.written"));
});

test("accepting makes a proposal standing; rejecting moves it aside and deletes nothing", () => {
	const m = new OfficeMemory(join(tmp(), "memory"));
	const a = m.write({ type: "learning", title: "Pieņemams", body: "A" }, "agent");
	const b = m.write({ type: "learning", title: "Noraidāms", body: "B" }, "agent");
	m.decide(a.id, true);
	assert.deepEqual(m.list({ standing: true }).map((n) => [n.id, n.state, n.by]), [[a.id, undefined, "agent"]]);
	m.decide(b.id, false);
	assert.deepEqual(m.list().map((n) => n.id), [a.id]);
	assert.ok(existsSync(join(m.dir, "rejected", `${b.id}.md`)), "the file is aside, not deleted");
	assert.throws(() => m.decide(a.id, false), /nav priekšlikums/, "a standing note is not a proposal");
	assert.throws(() => m.decide("o_nav", true), /nav atrasts/);
});

test("lifting copies a project note to the office, says where it came from, keeps the original, refuses twice", () => {
	const s = mkStore("BD427");
	s.writeNote(note({ id: "pn1", title: "Lifta šahta", body: "Pieprasīt TN pirms skices." }));
	const m = new OfficeMemory(join(tmp(), "memory"));
	const o = m.promote(s, "pn1");
	assert.deepEqual([o.title, o.body, o.from, o.by, o.state], ["Lifta šahta", "Pieprasīt TN pirms skices.", { project: "BD427", note: "pn1" }, "user", undefined]);
	assert.notEqual(o.id, "pn1");
	assert.equal(s.notes().length, 1, "the project's note stays");
	assert.deepEqual(m.list({ standing: true }).map((n) => n.id), [o.id], "standing at once: the user lifted it");
	assert.throws(() => m.promote(s, "pn1"), /jau ir biroja atmiņā/);
	assert.throws(() => m.promote(s, "nav"), /nav atrasta/);
	assert.ok(readFileSync(join(m.dir, "log.jsonl"), "utf8").includes("memory.promoted"));
});

function ctxOf(store: ProjectStore | null, appDir: string, projectsDir: string): ToolCtx {
	return { projectsDir, projectId: store?.project.id ?? null, dataDir: tmp(), appDir, runDir: null };
}
const tool = (name: string) => allTools().find((t) => t.name === name)!;

test("a lesson lifted from one project is what the agent reads in another; a proposal is not read until accepted", async () => {
	const projectsDir = tmp();
	const appDir = tmp();
	const a = mkStore("BD427", projectsDir);
	const b = mkStore("BD431", projectsDir);
	a.writeNote(note({ id: "pa", title: "TN pirms skices", body: "Ūdens TN jāprasa jau koncepta stadijā." }));
	b.writeNote(note({ id: "pb", title: "Cits projekts", body: "Tikai šī projekta lieta.", type: "decision" }));
	const memory = new OfficeMemory(join(appDir, "memory"));
	memory.promote(a, "pa");

	const inB = (await tool("read_notes").run(ctxOf(b, appDir, projectsDir), {} as never)) as { scope: string; title: string }[];
	assert.deepEqual(inB.map((n) => [n.scope, n.title]).sort(), [["birojs", "TN pirms skices"], ["projekts", "Cits projekts"]].sort());
	const officeOnly = (await tool("read_notes").run(ctxOf(b, appDir, projectsDir), { scope: "birojs" } as never)) as { title: string }[];
	assert.deepEqual(officeOnly.map((n) => n.title), ["TN pirms skices"]);
	const mineOnly = (await tool("read_notes").run(ctxOf(b, appDir, projectsDir), { scope: "projekts" } as never)) as { title: string }[];
	assert.deepEqual(mineOnly.map((n) => n.title), ["Cits projekts"], "the project's own memory does not leak across projects");
	// no project open: the office memory is still readable
	const none = (await tool("read_notes").run(ctxOf(null, appDir, projectsDir), {} as never)) as { scope: string }[];
	assert.deepEqual(none.map((n) => n.scope), ["birojs"]);

	// the agent proposes an office note: written, but not memory until the user accepts
	const w = (await tool("write_note").run(ctxOf(b, appDir, projectsDir), { type: "learning", title: "Aģenta mācība", body: "Mitrumu mēra pirms apmetuma.", scope: "birojs" } as never)) as { ok: boolean; state: string; note: string };
	assert.deepEqual([w.ok, w.state], [true, "proposed"]);
	const before = (await tool("read_notes").run(ctxOf(b, appDir, projectsDir), { scope: "birojs" } as never)) as { title: string }[];
	assert.deepEqual(before.map((n) => n.title), ["TN pirms skices"], "a proposal is not read as memory");
	assert.equal(b.notes().length, 1, "and it did not land in the project's memory");
	memory.decide(w.note, true);
	const after = (await tool("read_notes").run(ctxOf(a, appDir, projectsDir), { scope: "birojs" } as never)) as { title: string }[];
	assert.deepEqual(after.map((n) => n.title).sort(), ["Aģenta mācība", "TN pirms skices"].sort());
});

test("write_note without a scope still writes to the project; no note tool accepts, rejects or lifts", async () => {
	const projectsDir = tmp();
	const appDir = tmp();
	const s = mkStore("BD1", projectsDir);
	await tool("write_note").run(ctxOf(s, appDir, projectsDir), { type: "decision", title: "Projekta lēmums", body: "Jā." } as never);
	assert.deepEqual(s.notes().map((n) => [n.title, n.by]), [["Projekta lēmums", "agent"]]);
	assert.equal(existsSync(join(appDir, "memory")), false, "the office memory was not touched");
	assert.deepEqual([appLevels().read_notes, appLevels().write_note], ["read", "propose"]);
	assert.equal(allTools().some((t) => /promote|decide_note|accept_note|reject_note|lift/.test(t.name)), false);
});

test("the standing rules tell the agent about the office memory and that it can only propose to it", () => {
	assert.match(SYSTEM_PROMPT, /9\. Atmiņa:/);
	assert.match(SYSTEM_PROMPT, /scope projekts \/ birojs \/ visi/);
	assert.match(SYSTEM_PROMPT, /tikai kā priekšlikumu/);
});

