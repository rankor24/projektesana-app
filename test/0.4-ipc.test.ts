// 0.4 IPC contract: every contract method has a handler, no handler is outside the contract, preload exposes only invoke/on.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createPiRuntime } from "../src/agent/pi/models.ts";
import { AgentSession } from "../src/agent/session.ts";
import { Registry } from "../src/core/registry.ts";
import { createHandlers } from "../src/main/api.ts";
import { ProjectEngine } from "../src/main/engine.ts";
import { RevitClient } from "../src/revit/client.ts";
import { AppSettings } from "../src/main/settings.ts";
import { API_NAMES, EVENT_NAMES } from "../src/shared/api.ts";
import { tmp } from "./helpers.ts";

const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };

test("every contract method has a handler and there are no others", () => {
	const dir = tmp();
	const settings = new AppSettings(dir, plainCrypto);
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	const session = new AgentSession({ runtime: async () => rt, settings: () => settings.get(), toolsServer: () => ({ command: "node", args: [], env: {} }), revit: () => null, ctx: { projectsDir: dir, dataDir: dir, appDir: dir }, runsDir: dir, chatDir: dir, emit: () => {} });
	const h = createHandlers({ bimcraftApp: dir, revit: new RevitClient(() => null, process.execPath), engine: new ProjectEngine({ dataDir: join(import.meta.dirname, "..", "data"), officeStandardPdf: () => null }), registry: new Registry(join(dir, "projects.json"), join(dir, "projects")), hooks: () => ({}), version: "test", settings, dataDir: join(import.meta.dirname, "..", "data"), session, pi: async () => rt, emit: () => {}, pickFolder: async () => null, pickFile: async () => null, openPath: async () => "", openUrl: () => {} });
	assert.deepEqual(Object.keys(h).sort(), [...API_NAMES].sort());
	for (const k of API_NAMES) assert.equal(typeof h[k], "function", k);
});

test("contract names are unique and events are listed once", () => {
	assert.equal(new Set(API_NAMES).size, API_NAMES.length);
	assert.equal(new Set(EVENT_NAMES).size, EVENT_NAMES.length);
});

test("ipc refuses names outside the contract and preload exposes only invoke and on", () => {
	const ipc = readFileSync(join(import.meta.dirname, "..", "src", "main", "ipc.ts"), "utf8");
	assert.match(ipc, /if \(!allowed\.has\(method\)\) throw/);
	const preload = readFileSync(join(import.meta.dirname, "..", "src", "main", "preload.cts"), "utf8");
	const exposed = /exposeInMainWorld\("bv", \{([\s\S]*)\}\);/.exec(preload)![1];
	assert.deepEqual([...exposed.matchAll(/^\t(\w+):/gm)].map((m) => m[1]), ["invoke", "on"]);
});

test("settings: unknown keys are dropped, Codex is the default provider", () => {
	const s = new AppSettings(tmp(), plainCrypto);
	assert.equal(s.get().provider, "openai-codex");
	const next = s.set({ theme: "light", ...({ evil: 1 } as object) });
	assert.equal(next.theme, "light");
	assert.equal("evil" in next, false);
});
