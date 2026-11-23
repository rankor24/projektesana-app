// 17.1 app settings: the registry of settings an agent may find / change (main/app-settings), the tiers (safe applies and can be undone, secret never
// gets or gives a value, owner-only is only explained), Undo that refuses when the value has moved on, the 10-writes-per-run budget, the search index
// of the Settings window (Latvian + English words) and the agent tool over the real bridge.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allTools } from "../src/agent/tools/defs.ts";
import { AppSettings } from "../src/main/settings.ts";
import { startAgentBridge } from "../src/main/agent-bridge.ts";
import { createAppSettingsHost, WRITE_BUDGET, UNDO_STALE } from "../src/main/app-settings/host.ts";
import { buildRegistry } from "../src/main/app-settings/registry.ts";
import type { HoldRow, ProviderRow } from "../src/shared/api.ts";
import type { AppSettingEvent } from "../src/shared/app-settings.ts";
import { APP_CALL_LEVEL } from "../src/shared/app-calls.ts";
import { registerEn, trDyn, setLang, getLang } from "../src/shared/i18n.ts";
import { entryById, searchSettings, SETTINGS_GROUPS, SETTINGS_INDEX, SETTINGS_PAGES, settingWhere } from "../src/shared/settings-index.ts";
import { core } from "../src/renderer/i18n/en/core.ts";
import { part1 } from "../src/renderer/i18n/en/part1.ts";
import { part2 } from "../src/renderer/i18n/en/part2.ts";
import { part3 } from "../src/renderer/i18n/en/part3.ts";
import { part4 } from "../src/renderer/i18n/en/part4.ts";
import { part5 } from "../src/renderer/i18n/en/part5.ts";
import { part6 } from "../src/renderer/i18n/en/part6.ts";
import { part7 } from "../src/renderer/i18n/en/part7.ts";
import { settings as enSettings } from "../src/renderer/i18n/en/settings.ts";
import { tmp } from "./helpers.ts";

const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
const SECRET_KEY = "sk-live-THIS-MUST-NEVER-APPEAR-123456";

const models = [
	{ id: "m-small", name: "Small", legacy: false, efforts: ["low", "medium", "high"], defaultEffort: "medium" },
	{ id: "m-big", name: "Big", legacy: false, efforts: ["medium", "high", "xhigh"], defaultEffort: "high" },
];
const rows: ProviderRow[] = [
	{ id: "openai-codex", label: "ChatGPT (abonements)", auth: ["oauth"], configured: true, method: "oauth", models },
	{ id: "anthropic", label: "Anthropic", auth: ["api_key"], configured: true, method: "api_key", models },
	{ id: "openai", label: "OpenAI", auth: ["api_key"], configured: false, models },
];

function setup() {
	const dir = tmp();
	const settings = new AppSettings(dir, plainCrypto);
	// a key is stored for a provider: it must never reach the agent
	settings.setApiKey("anthropic", SECRET_KEY);
	const events: AppSettingEvent[] = [];
	let changed = 0;
	const holds: HoldRow[] = [];
	const host = createAppSettingsHost({ settings, providers: async () => rows, holds: async () => holds, emit: (e) => events.push(e), changed: () => changed++ });
	return { dir, settings, host, events, changed: () => changed };
}
const set = (h: ReturnType<typeof setup>["host"], id: string, value: unknown, run = "run-1") => h.handle({ action: "set", id, value, run, agent: "BPV" });

test("every registry setting has a place in the Settings index, and every index text has an English entry", async () => {
	const { settings } = setup();
	const entries = await buildRegistry({ settings, providers: async () => rows, holds: async () => [] });
	for (const e of entries) {
		const base = e.id.startsWith("keys.") ? "keys" : e.id;
		assert.ok(entryById(base), `${e.id} has no entry in settings-index.ts`);
		assert.equal(e.where, settingWhere(base));
		assert.match(e.where, /^Iestatījumi → /);
		assert.ok(["safe", "secret", "owner-only"].includes(e.tier));
		if (e.tier === "safe") assert.ok(e.value && typeof e.write === "function" && typeof e.current === "function", `${e.id}: a safe entry carries its schema, current and write`);
		else assert.equal("write" in e, false, `${e.id}: ${e.tier} has no write`);
	}
	// four groups, every page in one of them, every index entry on a page
	assert.deepEqual(SETTINGS_GROUPS.map((g) => g.label), ["Projekts", "AI", "Aģenti", "Lietotne"]);
	for (const p of SETTINGS_PAGES) assert.ok(SETTINGS_GROUPS.some((g) => g.id === p.group), p.id);
	for (const e of SETTINGS_INDEX) assert.ok(SETTINGS_PAGES.some((p) => p.id === e.page), e.id);
	// the window shows these through trDyn: each needs its English text
	const was = getLang();
	for (const d of [core, enSettings, part1, part2, part3, part4, part5, part6, part7]) registerEn(d);
	setLang("en");
	const lacking: string[] = [];
	for (const g of SETTINGS_GROUPS) if (trDyn(g.label) === g.label && g.label !== "AI") lacking.push(g.label);
	for (const p of SETTINGS_PAGES) for (const s of [p.label, p.intro]) if (trDyn(s) === s) lacking.push(s);
	for (const e of SETTINGS_INDEX) if (trDyn(e.label) === e.label && !["Revit MCP", "Revit MCP node.exe", "BimCraft", "CadCraft"].includes(e.label)) lacking.push(e.label);
	setLang(was);
	assert.deepEqual(lacking, []);
});

test("search: Latvian and English words find the setting; every setting is found by its own label", () => {
	const top = (q: string) => searchSettings(q)[0]?.entry.id;
	assert.equal(top("dark mode"), "app.theme");
	assert.equal(top("tumšs"), "app.theme");
	assert.equal(top("rezerve"), "ai.backup");
	assert.equal(top("backup"), "ai.backup");
	assert.equal(top("api key"), "keys");
	assert.equal(top("parallel"), "agents.maxParallel");
	assert.equal(top("valoda"), "app.language");
	assert.equal(top("skills"), "agents.skills");
	assert.equal(searchSettings("zzzzqq").length, 0);
	assert.equal(searchSettings("   ").length, 0);
	for (const e of SETTINGS_INDEX) assert.ok(searchSettings(e.label).some((h) => h.entry.id === e.id), `${e.label} is not found by its own name`);
	// a page's name leads to its settings
	assert.ok(searchSettings("ierobežojumi").some((h) => h.entry.page === "limits"));
});

test("safe: a value is validated, applied at once, logged with before and after, announced; Undo puts it back", async () => {
	const { settings, host, events, dir } = setup();
	assert.equal(settings.get().theme, "auto");
	const r = await set(host, "app.theme", "dark");
	assert.equal(r.ok, true, r.text);
	assert.equal(settings.get().theme, "dark");
	assert.equal(r.change?.before, "auto");
	assert.equal(r.change?.after, "dark");
	const ev = events.find((e) => e.kind === "change");
	assert.ok(ev && ev.kind === "change" && ev.change.settingId === "app.theme");
	assert.equal(host.recent().length, 1);
	// the change is in the append-only log with before and after
	const log = readFileSync(join(dir, "logs", "app-settings.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
	assert.equal(log.length, 1);
	assert.equal(log[0].kind, "app-settings.change");
	assert.equal(log[0].by, "agent:BPV");
	assert.equal(log[0].data.before, "auto");
	assert.equal(log[0].data.after, "dark");
	// Undo through the user's call
	const undone = await host.undo(r.change!.id, "user");
	assert.equal(undone.undone, true);
	assert.equal(settings.get().theme, "auto");
	assert.ok(events.some((e) => e.kind === "undone"));
	await assert.rejects(() => host.undo(r.change!.id, "user"), /jau ir atsaukta|nevar atsaukt/);
});

test("safe: values that do not fit, unknown providers and models, a provider that is not signed in are refused and change nothing", async () => {
	const { settings, host, events } = setup();
	const before = JSON.stringify(settings.get());
	for (const [id, value] of [
		["app.theme", "purple"],
		["agents.maxParallel", 99],
		["agents.maxParallel", 2.5],
		["agents.limits.chainDepth", 0],
		["agents.limits.waveCost", -3],
		["ai.provider", "nope"],
		["ai.provider", "openai"], // known, but not signed in
		["ai.model", "no-such-model"],
		["ai.effort", "max"], // the model does not take it
		["ai.backup", { provider: "nope" }],
		["ai.automaticRecovery", "maybe"],
	] as const) {
		const r = await set(host, id, value);
		assert.equal(r.ok, false, `${id} = ${JSON.stringify(value)} should be refused`);
	}
	assert.equal(JSON.stringify(settings.get()), before);
	assert.equal(host.recent().length, 0);
	assert.equal(events.length, 0);
	// a string that holds JSON is understood (agents send numbers as text)
	assert.equal((await set(host, "agents.maxParallel", "4")).ok, true);
	assert.equal(settings.get().maxParallelAgents, 4);
});

test("safe: provider, model and effort keep their order; Undo of the provider gives back all three", async () => {
	const { settings, host } = setup();
	settings.set({ provider: "anthropic", model: "m-small", effort: "high" });
	const r = await set(host, "ai.provider", "openai-codex");
	assert.equal(r.ok, true, r.text);
	assert.deepEqual([settings.get().provider, settings.get().model, settings.get().effort], ["openai-codex", "", ""]);
	await host.undo(r.change!.id, "user");
	assert.deepEqual([settings.get().provider, settings.get().model, settings.get().effort], ["anthropic", "m-small", "high"]);
	// limits merge into the other limits; the cost limit takes null
	assert.equal((await set(host, "agents.limits.runsPerWave", 50)).ok, true);
	assert.equal((await set(host, "agents.limits.waveCost", 12.5)).ok, true);
	assert.equal((await set(host, "agents.limits.waveCost", null)).ok, true);
	assert.equal(settings.get().limits.runsPerWave, 50);
	assert.equal(settings.get().limits.waveCost, null);
	assert.equal(settings.get().limits.chainDepth, 6);
	// the backup
	assert.equal((await set(host, "ai.backup", { provider: "anthropic", model: "m-big" })).ok, true);
	assert.deepEqual(settings.get().backup, { provider: "anthropic", model: "m-big" });
	assert.equal((await set(host, "ai.backup", null)).ok, true);
	assert.equal(settings.get().backup, null);
});

test("undo is stale-safe: it goes ahead only while the setting still holds what the change set", async () => {
	const { settings, host } = setup();
	const r = await set(host, "app.theme", "dark");
	// the user changes it by hand afterwards
	settings.set({ theme: "light" });
	await assert.rejects(() => host.undo(r.change!.id, "user"), (e: Error) => e.message === UNDO_STALE);
	assert.equal(settings.get().theme, "light", "the user's newer value is kept");
	// through the agent's tool the same answer, as a refusal
	const via = await host.handle({ action: "undo", id: r.change!.id, agent: "BPV" });
	assert.equal(via.ok, false);
	assert.match(via.text, /mainīta|nevar atsaukt/);
	// two changes of one setting: the older one cannot be undone over the newer one
	const a = await set(host, "app.language", "lv");
	const b = await set(host, "app.language", "en");
	await assert.rejects(() => host.undo(a.change!.id, "user"), (e: Error) => e.message === UNDO_STALE);
	await host.undo(b.change!.id, "user");
	assert.equal(settings.get().language, "lv");
});

test("secret: no value ever goes in or out; the agent is told where the user types it, and the user is shown a notice", async () => {
	const { settings, host, events } = setup();
	const find = await host.handle({ action: "find", query: "api key" });
	assert.equal(find.ok, true);
	assert.match(find.text, /keys\.anthropic/);
	const get = await host.handle({ action: "get", id: "keys.anthropic" });
	const r = await host.handle({ action: "set", id: "keys.anthropic", value: "sk-agent-wrote-this", run: "r", agent: "BPV" });
	assert.equal(r.ok, true);
	assert.match(r.text, /Iestatījumi → AI → Pakalpojums un modelis/);
	// the stored key is untouched and appears in nothing the agent reads
	assert.equal(settings.apiKey("anthropic"), SECRET_KEY);
	assert.equal(settings.apiKey("openai"), null);
	for (const text of [find.text, get.text, r.text, JSON.stringify(events), JSON.stringify(host.recent())]) {
		assert.equal(text.includes(SECRET_KEY), false);
		assert.equal(text.includes("sk-agent-wrote-this"), false);
	}
	const ask = events.find((e) => e.kind === "ask");
	assert.ok(ask && ask.kind === "ask" && ask.tier === "secret" && ask.settingId === "keys.anthropic");
	assert.equal(host.recent().length, 0, "a request is not a change");
	// reading says set / not set only
	assert.match(get.text, /atslēga ir ievadīta/);
	assert.match((await host.handle({ action: "get", id: "keys.openai" })).text, /nav iestatīts/);
});

test("owner-only: readable and explained, never written", async () => {
	const { settings, host, events } = setup();
	settings.set({ userName: "Boriss", officeStandardPdf: "D:\\a.pdf", revitServerJs: "D:\\srv\\index.js" });
	const before = JSON.stringify(settings.get());
	for (const [id, value] of [["app.userName", "Cits Cilvēks"], ["paths.officeStandardPdf", "C:\\evil.pdf"], ["paths.revitServerJs", "C:\\evil.js"], ["paths.revitNode", "C:\\evil.exe"], ["ai.signIn", "x"]] as const) {
		const r = await set(host, id, value);
		assert.equal(r.ok, true, id);
		assert.match(r.text, /tikai lietotājs/);
	}
	assert.equal(JSON.stringify(settings.get()), before);
	assert.equal(events.filter((e) => e.kind === "ask").length, 5);
	assert.match((await host.handle({ action: "get", id: "app.userName" })).text, /Boriss/);
});

test(`budget: ${WRITE_BUDGET} accepted sets per run, then refused; a refused value costs nothing; another run has its own`, async () => {
	const { settings, host } = setup();
	for (let i = 0; i < WRITE_BUDGET; i++) assert.equal((await set(host, "agents.maxParallel", (i % 5) + 1, "run-A")).ok, true, `write ${i}`);
	// the 11th, even a value that would be fine
	const over = await set(host, "app.theme", "dark", "run-A");
	assert.equal(over.ok, false);
	assert.match(over.text, new RegExp(String(WRITE_BUDGET)));
	assert.equal(settings.get().theme, "auto");
	// a request for a secret counts too (it posts a notice)
	assert.equal((await set(host, "keys.anthropic", "x", "run-A")).ok, false);
	// a new run is a new budget
	assert.equal((await set(host, "app.theme", "dark", "run-B")).ok, true);
	// a value that fails validation costs nothing
	for (let i = 0; i < 20; i++) await set(host, "app.theme", "purple", "run-C");
	assert.equal((await set(host, "app.theme", "light", "run-C")).ok, true);
});

test("the tool: app_settings is offered at level run, short, and speaks to the real bridge; settings.set is never for agents", async () => {
	assert.equal(APP_CALL_LEVEL["settings.set"], "never");
	assert.equal(APP_CALL_LEVEL["appSettings.undo"], "never", "Undo of the user is not an agent call");
	assert.equal(APP_CALL_LEVEL["appSettings.recent"], "read");
	const t = allTools().find((x) => x.name === "app_settings");
	assert.ok(t);
	assert.equal(t.level, "run");
	assert.ok(t.description.length < 520, "the description stays short");

	const { settings, host } = setup();
	const b = await startAgentBridge({ handlers: {} as never, registry: {} as never, renderer: {} as never, appSettings: host });
	try {
		const ctx = { projectsDir: "", projectId: null, dataDir: "", appDir: "", runDir: "C:\\runs\\run-42", agent: "BPV", thread: null, bridge: { url: b.url, token: b.token } };
		const out = await t.run(ctx as never, { action: "set", id: "app.theme", value: "light" } as never);
		assert.match(String(out), /Atsaukšanas id: chg-/);
		assert.equal(settings.get().theme, "light");
		const id = /chg-[0-9a-f]+/.exec(String(out))![0];
		assert.match(String(await t.run(ctx as never, { action: "undo", id } as never)), /Atsaukts/);
		assert.equal(settings.get().theme, "auto");
		assert.match(String(await t.run(ctx as never, { action: "find", query: "dark mode" } as never)), /app\.theme/);
		await assert.rejects(() => t.run(ctx as never, { action: "get", id: "no.such" } as never), /Nav iestatījuma/);
		// no token, no call
		const res = await fetch(`${b.url}/app-settings`, { method: "POST", headers: { "x-bridge-token": "wrong" }, body: JSON.stringify({ action: "find", query: "x" }) });
		assert.equal(res.status, 403);
	} finally {
		b.close();
	}
});
