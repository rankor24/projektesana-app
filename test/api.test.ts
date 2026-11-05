import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppApi } from "../src/main/api.ts";
import { Store } from "../src/main/store.ts";
import { appendChat, setFact } from "../src/main/chat/brief.ts";
import { buildSetupPrompt } from "../src/main/chat/setup.ts";
import { completeness } from "../src/main/chat/brief.ts";
import { fakeRevit, piFor } from "./helpers.ts";
import type { Engine } from "../src/main/engines/types.ts";

const dataDir = join(import.meta.dirname, "..", "data");
const crypto = { available: () => true, encrypt: (s: string) => Buffer.from(s, "utf8").reverse(), decrypt: (b: Buffer) => Buffer.from(b).reverse().toString("utf8") };

function mk(engineRun?: Engine["run"]) {
	const dir = mkdtempSync(join(tmpdir(), "bvapp-"));
	const store = new Store(join(dir, "data"), crypto);
	const events: unknown[] = [];
	const eng: Engine = { id: "claude", status: async () => ({ id: "claude", ready: true, reason: "", canLogin: false }), run: engineRun ?? (async (o) => o.onEvent({ type: "done", text: "" })) };
	const api = new AppApi({ store, engine: eng, pi: piFor(store), serverJs: "server.js", dataDir, emit: (_c, e) => events.push(e) });
	return { api, store, events, dir };
}

test("create, list, forget: forgetting never deletes the folder", () => {
	const { api, dir } = mk();
	const root = join(dir, "Duntes 8");
	api.projectsCreate(root, "Duntes 8");
	const l = api.projectsList();
	assert.equal(l.length, 1);
	assert.equal((l[0] as { setup: string }).setup, "not started");
	api.projectsForget(root);
	assert.equal(api.projectsList().length, 0);
	assert.ok(existsSync(join(root, ".bv", "project.json")));
	assert.doesNotThrow(() => api.projectsAdd(root));
	assert.throws(() => api.projectsAdd(dir), /nav projekts/);
});

test("a project whose folder vanished is listed as missing, not dropped or faked", () => {
	const { api, dir } = mk();
	const root = join(dir, "P");
	api.projectsCreate(root, "P");
	const gone = join(dir, "Q");
	api.projectsCreate(gone, "Q");
	// simulate the folder missing: registry keeps the path
	(api as unknown as { registry: { add(p: string): void } }).registry.add(join(dir, "nope"));
	const l = api.projectsList() as { missing: boolean; root: string }[];
	assert.equal(l.find((x) => x.root.endsWith("nope"))?.missing, true);
});

test("importing files copies them in, leaves the original, never overwrites a same-named file", () => {
	const { api, dir } = mk();
	const root = join(dir, "P");
	api.projectsCreate(root, "P");
	const src = join(dir, "PU.txt");
	writeFileSync(src, "Objekts: Duntes iela 8");
	const [a] = api.filesImport(root, [src], "PU");
	const [b] = api.filesImport(root, [src], "PU");
	assert.equal(a.path, "Izejas dati/PU.txt");
	assert.equal(b.path, "Izejas dati/PU (2).txt");
	assert.equal(readFileSync(src, "utf8"), "Objekts: Duntes iela 8");
	assert.equal(api.filesList(root).length, 2);
});

test("file diff shows what changed outside the app", async () => {
	const { api, dir } = mk();
	const root = join(dir, "P");
	api.projectsCreate(root, "P");
	const [f] = api.filesImport(root, [(() => { const p = join(dir, "a.txt"); writeFileSync(p, "x: 1\ny: 2"); return p; })()], "PU");
	writeFileSync(join(root, f.path), "x: 1\ny: 3");
	api.filesRescan(root);
	const d = await api.filesDiff(root, f.path, 0, 1);
	assert.deepEqual(d.filter((x) => x.op !== " ").map((x) => x.op + x.line), ["-y: 2", "+y: 3"]);
	assert.throws(() => api.fileRead(root, "..\\..\\Windows\\win.ini"), /Ārpus projekta/);
});

test("API keys are stored encrypted per provider, never in settings.json; pi sees them, clearing removes them", async () => {
	const { api, store, dir } = mk();
	const before = await api.providersStatus();
	assert.equal(before.find((p) => p.id === "anthropic")?.configured, false);
	api.keySet("anthropic", "sk-ant-test-123");
	api.keySet("xai", "xai-test-1");
	assert.equal(store.apiKey("anthropic"), "sk-ant-test-123");
	api.settingsSave({ theme: "dark" });
	assert.ok(!readFileSync(join(dir, "data", "settings.json"), "utf8").includes("sk-ant"));
	assert.ok(!readFileSync(join(dir, "data", "keys", "anthropic.key"), "utf8").includes("sk-ant"));
	const after = await api.providersStatus();
	assert.deepEqual(
		after.filter((p) => p.configured).map((p) => [p.id, p.method]),
		[["anthropic", "api_key"], ["xai", "api_key"]],
	);
	api.keyClear("xai");
	assert.equal((await api.providersStatus()).find((p) => p.id === "xai")?.configured, false);
	assert.throws(() => api.keySet("../evil", "x"), /Nederīgs/);
});

test("old settings (engine claude/codex) migrate to a provider; the old claude.key still works", () => {
	const { store, dir } = mk();
	writeFileSync(join(dir, "data", "settings.json"), JSON.stringify({ engine: "codex", theme: "dark", revitServerJs: null }));
	assert.equal(store.settings().provider, "openai-codex");
	writeFileSync(join(dir, "data", "claude.key"), crypto.encrypt("sk-ant-old"));
	assert.equal(store.apiKey("anthropic"), "sk-ant-old");
});

test("model list comes from pi's catalog (no typed names), newest first, with effort levels per model", async () => {
	const { api } = mk();
	const r = await api.modelsList("anthropic");
	assert.ok(r.models.length > 5);
	assert.ok(r.defaultModel);
	const reasoning = r.models.find((m) => m.reasoning && m.efforts.length > 0)!;
	assert.ok(reasoning.efforts.includes(reasoning.defaultEffort));
	assert.ok(r.models.every((m) => typeof m.legacy === "boolean"));
	await assert.rejects(api.modelsList("nope"), /Nezināms/);
});

test("a model the provider lists live but pi does not know becomes selectable and resolvable", async () => {
	const { api, store } = mk();
	const pi = await piFor(store)();
	pi.live.providers.anthropic = [{ id: "claude-opus-9-9", name: "Claude Opus 9.9", created: 4_000_000_000 }];
	const api2 = new AppApi({ store, engine: (api as unknown as { d: { engine: never } }).d.engine, pi: async () => pi, serverJs: "s", dataDir, emit: () => {} });
	const r = await api2.modelsList("anthropic");
	assert.equal(r.models[0].id, "claude-opus-9-9");
	assert.equal(r.models[0].live, true);
	const { lookupPiModel } = await import("../src/agent-pi/index.ts");
	assert.equal(lookupPiModel(pi, "anthropic", "claude-opus-9-9").id, "claude-opus-9-9");
	assert.throws(() => lookupPiModel(pi, "anthropic", "claude-nav-tada"), /Unknown model/);
});

test("model refresh without keys reports per provider and never throws", async () => {
	const { api } = mk();
	const r = await api.modelsRefresh();
	assert.match(r.anthropic, /pi katalogs/);
	assert.match(r["openai-codex"], /pi katalogs/);
});

test("setup chat: Boris's message is stored first, the agent's answer after; one run at a time", async () => {
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const { api, dir } = mk(async (o) => {
		o.onEvent({ type: "text", text: "Kāds ir objekta nosaukums un adrese?" });
		await gate;
		o.onEvent({ type: "done", text: "" });
	});
	const root = join(dir, "P");
	api.projectsCreate(root, "P");
	const first = api.chatSend(root, "Sāksim jaunu projektu");
	await new Promise((r) => setTimeout(r, 20));
	await assert.rejects(api.chatSend(root, "vēl"), /jau strādā/);
	release();
	assert.deepEqual(await first, { ok: true });
	assert.deepEqual(api.chatHistory(root).messages.map((m) => m.role), ["boris", "agent"]);
});

test("setup chat reports an engine that is not ready instead of faking an answer", async () => {
	const { api, dir, store } = mk();
	const root = join(dir, "P");
	api.projectsCreate(root, "P");
	const eng: Engine = { id: "claude", status: async () => ({ id: "claude", ready: false, reason: "Nav ievadīta API atslēga", canLogin: false }), run: async () => assert.fail("must not run") };
	const api2 = new AppApi({ store, engine: eng, pi: piFor(store), serverJs: "s", dataDir, emit: () => {} });
	api2.projectsAdd(root);
	assert.deepEqual(await api2.chatSend(root, "labdien"), { ok: false, reason: "Nav ievadīta API atslēga" });
});

test("modelling is refused until setup is complete, then until a work copy exists", async () => {
	const { api, dir } = mk();
	const root = join(dir, "P");
	api.projectsCreate(root, "P");
	await assert.rejects(api.batchRun(root, "skice"), /Uzstādīšana nav pabeigta/);
});

test("the work copy must be a _WORK file inside the project; the original is refused", async () => {
	const { api, store, dir } = mk();
	const root = join(dir, "P");
	api.projectsCreate(root, "P");
	store.saveSettings({ revitServerJs: "x" });
	const workPath = join(root, "Modelis", "A_WORK.rvt");
	const state = { exports: 0 };
	const a2 = new AppApi({ store, engine: (api as unknown as { d: { engine: never } }).d.engine, pi: piFor(store), serverJs: "s", dataDir, emit: () => {}, revitFactory: async () => fakeRevit({ workPath, state }) });
	a2.projectsAdd(root);
	assert.deepEqual(await a2.modellingUseActive(root), { workPath });
	assert.deepEqual(a2.modellingGet(root), { workPath });
	const a3 = new AppApi({ store, engine: (api as unknown as { d: { engine: never } }).d.engine, pi: piFor(store), serverJs: "s", dataDir, emit: () => {}, revitFactory: async () => fakeRevit({ workPath: join(root, "Original.rvt"), state }) });
	await assert.rejects(a3.modellingUseActive(root), /_WORK\.rvt/);
});

test("Revit not configured / not connected are reported as such", async () => {
	const { api, store } = mk();
	assert.deepEqual(await api.revitStatus(), { state: "not configured" });
	store.saveSettings({ revitServerJs: "C:\\nope\\index.js" });
	const s = await api.revitStatus();
	assert.equal(s.state, "not connected");
});

test("setup prompt: rules and checklist come before the chat history and the file list", async () => {
	const { dir } = mk();
	const root = join(dir, "P");
	new AppApi({ store: new Store(join(dir, "d2"), crypto), engine: {} as never, pi: async () => { throw new Error("no pi"); }, serverJs: "s", dataDir, emit: () => {} }).projectsCreate(root, "P");
	appendChat(root, "boris", "jauna publiska ēka");
	await setFact(root, "engine.work", "new_build", { kind: "boris", quote: "jauna publiska ēka", at: new Date().toISOString() }, "t");
	const p = buildSetupPrompt({ completeness: completeness(root), history: [{ role: "boris", text: "jauna publiska ēka" }], files: [{ path: "PU.pdf", role: "PU" }] });
	assert.ok(p.indexOf("# Noteikumi") < p.indexOf("# Kontrolsaraksts") && p.indexOf("# Kontrolsaraksts") < p.indexOf("# Čats") && p.indexOf("# Čats") < p.indexOf("# Reģistrētie faili"));
	assert.match(p, /engine\.use/);
});
