// 2.17.2: the agent bridge's /image route (view_image) and the region of /page (view_page) exist and work, and a source whose file moved is found again.
// Before this, the tools server asked for /image and got "nezināms ceļš" for every path, and /page drew the whole page whatever the region said.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { startAgentBridge } from "../src/main/agent-bridge.ts";
import { sourceBytes } from "../src/sources/bytes.ts";
import { tmp } from "./helpers.ts";

const PDF = Buffer.from("%PDF-1.4 fake");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function fakeStore(root: string, data: string, sources: unknown[], scan: unknown = {}) {
	return { project: { root }, guard: { sourceRoot: root, dataDir: data }, read: () => sources, readMeta: (n: string, f: unknown) => (n === "scan" ? scan : f) } as never;
}

test("view_image /image: a PDF page whole, a PDF part with its region, a missing or relative path refused", async () => {
	const dir = tmp("pj-bridge-img-");
	const pdf = join(dir, "plan.pdf");
	writeFileSync(pdf, PDF);
	const calls: string[] = [];
	const renderer = {
		render: async (_b: Uint8Array, pages: number[], scale: number) => (calls.push(`page ${pages[0]} ${scale}`), [{ png: new Uint8Array([1]), width: 5, height: 6 }]),
		renderRegion: async (_b: Uint8Array, page: number, scale: number, region: unknown) => (calls.push(`region ${page} ${scale} ${JSON.stringify(region)}`), { png: new Uint8Array([2]), width: 7, height: 8, scale }),
	};
	const b = await startAgentBridge({ handlers: {} as never, registry: {} as never, renderer: renderer as never });
	const post = (path: string, body: object) => fetch(`${b.url}${path}`, { method: "POST", headers: { "x-bridge-token": b.token }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...((await r.json()) as Record<string, unknown>) }));
	try {
		const whole = await post("/image", { path: pdf, page: 2 });
		assert.equal(whole.status, 200);
		assert.equal(whole.mimeType, "image/png");
		assert.equal(whole.page, 2);
		const part = await post("/image", { path: pdf, page: 1, region: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 } });
		assert.equal(part.status, 200);
		assert.equal(part.width, 7);
		assert.deepEqual(calls, ["page 2 2", 'region 1 4 {"x":0.1,"y":0.1,"w":0.4,"h":0.2}']);
		assert.equal((await post("/image", { path: join(dir, "nav.pdf") })).status, 404);
		assert.equal((await post("/image", { path: "plan.pdf" })).status, 400, "a relative path is the tools server's to resolve");
		assert.equal((await post("/image", { path: pdf, region: { x: 2, y: 0, w: 1, h: 1 } })).status, 500, "a region outside the page is an error the agent reads");
	} finally {
		b.close();
	}
});

test("view_page /page: the region is honoured (it was dropped before)", async () => {
	const root = tmp("pj-bridge-page-");
	const data = tmp("pj-bridge-page-data-");
	writeFileSync(join(root, "a.pdf"), PDF);
	const sources = [{ id: "s_1", title: "A", kind: "document", paths: ["a.pdf"], versions: [{ sha256: sha(PDF), size: PDF.length }] }];
	const calls: string[] = [];
	const renderer = {
		render: async (_b: Uint8Array, pages: number[]) => (calls.push(`page ${pages[0]}`), [{ png: new Uint8Array([1]), width: 5, height: 6 }]),
		renderRegion: async (_b: Uint8Array, page: number, _s: number, region: unknown) => (calls.push(`region ${page} ${JSON.stringify(region)}`), { png: new Uint8Array([2]), width: 7, height: 8, scale: 4 }),
	};
	const registry = { store: () => fakeStore(root, data, sources) } as never;
	const b = await startAgentBridge({ handlers: {} as never, registry, renderer: renderer as never });
	const post = (body: object) => fetch(`${b.url}/page`, { method: "POST", headers: { "x-bridge-token": b.token }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...((await r.json()) as Record<string, unknown>) }));
	try {
		assert.equal((await post({ projectId: "P", sourceId: "s_1", page: 2 })).width, 5);
		const part = await post({ projectId: "P", sourceId: "s_1", page: 2, scale: 4, region: { x: 0.07, y: 0.06, w: 0.42, h: 0.1 } });
		assert.equal(part.width, 7);
		assert.equal(part.page, 2);
		assert.deepEqual(calls, ["page 2", 'region 2 {"x":0.07,"y":0.06,"w":0.42,"h":0.1}']);
		assert.equal((await post({ projectId: "P", sourceId: "s_9" })).status, 404);
	} finally {
		b.close();
	}
});

test("sourceBytes: a file that moved one folder up since the scan is found by its hash; a changed or missing one says to re-scan", () => {
	const root = tmp("pj-moved-");
	const data = tmp("pj-moved-data-");
	const inputs = join(root, "01_Projektesana", "1.1_Izejas dati");
	const real = join(inputs, "1.1.08_Vecais", "Mape", "AR");
	mkdirSync(real, { recursive: true });
	writeFileSync(join(real, "Projekts.pdf"), PDF);
	// the list still has the doubled folder, as when the archive was unpacked one level deeper than it is now
	const stale = join("01_Projektesana", "1.1_Izejas dati", "1.1.08_Vecais", "Mape", "Mape", "AR", "Projekts.pdf");
	const src = (size: number, sha256: string) => [{ id: "s_1", paths: [stale], versions: [{ sha256, size }] }];
	const scan = { inputsRel: join("01_Projektesana", "1.1_Izejas dati") };
	assert.deepEqual(Buffer.from(sourceBytes(fakeStore(root, data, src(PDF.length, sha(PDF)), scan), "s_1")), PDF, "same name and same hash: it is the file");
	assert.throws(() => sourceBytes(fakeStore(root, data, src(PDF.length, sha(Buffer.from("other"))), scan), "s_1"), /projects\.scan/, "a file of the same name with other content is not the source");
	assert.throws(() => sourceBytes(fakeStore(root, data, [{ id: "s_2", paths: [join("01_Projektesana", "1.1_Izejas dati", "Nav.pdf")], versions: [{ sha256: "x", size: 1 }] }], scan), "s_2"), /projects\.scan/);
});
