import assert from "node:assert/strict";
import { test } from "node:test";
import { LockRegistry } from "../src/agent/locks.ts";

const tick = () => new Promise((r) => setTimeout(r, 10));

test("10.3 registry: same project's store takes turns, another project's passes at once", async () => {
	const r = new LockRegistry();
	assert.deepEqual(await r.acquire("p1", "store", "a", "c1"), { ok: true });
	let got = false;
	const wait = r.acquire("p1", "store", "b", "c2").then((x) => ((got = x.ok), x));
	assert.deepEqual(await r.acquire("p2", "store", "b", "c3"), { ok: true });
	await tick();
	assert.equal(got, false);
	r.release("c1");
	assert.deepEqual(await wait, { ok: true });
	r.release("c2");
	r.release("c3");
});

test("10.3 registry: revit is one lock across projects; revitHeldBy names the holder", async () => {
	const r = new LockRegistry();
	assert.equal(r.revitHeldBy(), null);
	await r.acquire("p1", "revit", "a", "c1");
	assert.equal(r.revitHeldBy(), "a");
	let got = false;
	const w = r.acquire("p2", "revit", "b", "c2").then((x) => ((got = x.ok), x));
	await tick();
	assert.equal(got, false);
	r.release("c1");
	assert.deepEqual(await w, { ok: true });
	r.releaseOwner("b");
	assert.equal(r.revitHeldBy(), null);
});

test("10.3 registry: a batch holder's calls pass, another owner waits until endBatch, then takes the revit queue", async () => {
	const r = new LockRegistry();
	r.beginBatch("a", "Aģents A");
	assert.equal(r.revitHeldBy(), "a");
	assert.deepEqual(await r.acquire("p1", "revit", "a", "c1"), { ok: true });
	r.release("c1");
	let got = false;
	const w = r.acquire("p1", "revit", "b", "c2").then((x) => ((got = x.ok), x));
	await tick();
	assert.equal(got, false);
	assert.throws(() => r.beginBatch("b", "Aģents B"), /Revit partiju jau veic Aģents A\./);
	r.endBatch("a");
	assert.deepEqual(await w, { ok: true });
	assert.equal(r.revitHeldBy(), "b");
	r.release("c2");
});

test("10.3 registry: releaseOwner ends the batch and cancels that owner's waits in every instance", async () => {
	const r = new LockRegistry();
	r.beginBatch("a", "A");
	const w = r.acquire("p1", "revit", "b", "c2");
	r.releaseOwner("a");
	assert.deepEqual(await w, { ok: true });
	r.release("c2");
	assert.equal(r.revitHeldBy(), null);
	r.beginBatch("a", "A");
	const w2 = r.acquire("p1", "revit", "b", "c3");
	r.releaseOwner("b");
	assert.equal((await w2).ok, false);
	await r.acquire("p1", "store", "b", "s1");
	const w3 = r.acquire("p1", "store", "c", "s2");
	r.releaseOwner("c");
	assert.equal((await w3).ok, false);
	r.releaseOwner("b");
	assert.deepEqual(await r.acquire("p1", "store", "d", "s3"), { ok: true });
});

test("10.3 registry: a batch wait past waitMs names the holder's label; Stop ends it too", async () => {
	const r = new LockRegistry({ waitMs: 30 });
	r.beginBatch("a", "sienu partiju");
	const res = await r.acquire("p1", "revit", "b", "c1");
	assert.deepEqual(res, { ok: false, reason: "Revit šobrīd maina sienu partiju; gaidīts 0 s. Dari citu darbu vai mēģini vēlāk." });
	const ac = new AbortController();
	const w = r.acquire("p1", "revit", "b", "c2", ac.signal);
	ac.abort();
	assert.equal((await w).ok, false);
});
