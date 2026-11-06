// 0.4 IPC contract: every contract method has a handler, no handler is outside the contract, preload exposes only invoke/on.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createHandlers } from "../src/main/api.ts";
import { AppSettings } from "../src/main/settings.ts";
import { API_NAMES, EVENT_NAMES } from "../src/shared/api.ts";
import { tmp } from "./helpers.ts";

const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };

test("every contract method has a handler and there are no others", () => {
	const h = createHandlers({ version: "test", settings: new AppSettings(tmp(), plainCrypto), dataDir: join(import.meta.dirname, "..", "data"), emit: () => {}, pickFolder: async () => null, openPath: async () => "", openUrl: () => {} });
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
