// 2.3 checks framework: events run the subscribed checks; findings persist by key; an override records the reason and
// does not change the check (it still fails next run, the finding stays overridden); a fixed problem closes.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectStore } from "../src/core/store.ts";
import { registerCheck, unregisterCheck } from "../src/checks/registry.ts";
import { openFindings, overrideFinding, reopenFinding, runChecks } from "../src/checks/run.ts";
import { tmp } from "./helpers.ts";

const DATA = join(import.meta.dirname, "..", "data");
const store = () => ProjectStore.open(tmp(), { id: "BD999", name: "BD999", root: tmp(), createdAt: "2026-11-06T00:00:00Z" });

test("an event runs only the checks subscribed to it", async () => {
	let factsRuns = 0;
	let deliveryRuns = 0;
	registerCheck({ id: "t-facts", title: "t", on: ["facts"], run: () => (factsRuns++, { results: [] }) });
	registerCheck({ id: "t-delivery", title: "t", on: ["delivery"], run: () => (deliveryRuns++, { results: [] }) });
	try {
		const s = store();
		const r = await runChecks(s, "facts", { dataDir: DATA, today: "2026-11-06" });
		assert.ok(r.ran.includes("t-facts") && !r.ran.includes("t-delivery"));
		assert.equal(factsRuns, 1);
		assert.equal(deliveryRuns, 0);
		await runChecks(s, "manual", { dataDir: DATA, today: "2026-11-06" });
		assert.equal(deliveryRuns, 1, "manual runs all");
	} finally {
		unregisterCheck("t-facts");
		unregisterCheck("t-delivery");
	}
});

test("override closes the finding with a reason; the check still fails next run and the finding stays overridden", async () => {
	let failing = true;
	registerCheck({ id: "t-addr", title: "adrese", on: ["sources"], run: () => ({ results: failing ? [{ key: "addr", severity: "error", message: "adrese atšķiras", where: { sourceId: "s1" } }] : [] }) });
	try {
		const s = store();
		await runChecks(s, "sources", { dataDir: DATA, today: "2026-11-06" });
		const [f] = s.read("findings");
		assert.equal(f.state, "open");
		assert.equal(openFindings(s), 1);
		assert.throws(() => overrideFinding(s, f.id, ""), /obligāts/);
		assert.throws(() => overrideFinding(s, f.id, "aģents tā teica", "agent"), /tikai Boris/);
		overrideFinding(s, f.id, "Adrese mainīta ar domes lēmumu, abas pareizas.");
		const again = await runChecks(s, "sources", { dataDir: DATA, today: "2026-11-06" });
		assert.equal(again.results, 1, "the check still fails");
		const g = s.read("findings")[0];
		assert.equal(g.state, "overridden");
		assert.equal(g.decision?.reason, "Adrese mainīta ar domes lēmumu, abas pareizas.");
		assert.equal(openFindings(s), 0);
		reopenFinding(s, g.id);
		assert.equal(openFindings(s), 1);
		failing = false;
		await runChecks(s, "sources", { dataDir: DATA, today: "2026-11-06" });
		assert.equal(s.read("findings")[0].state, "closed", "fixed → closed");
		failing = true;
		await runChecks(s, "sources", { dataDir: DATA, today: "2026-11-06" });
		assert.equal(s.read("findings")[0].state, "open", "back again → reopened, same finding");
		assert.equal(s.read("findings").length, 1);
	} finally {
		unregisterCheck("t-addr");
	}
});

test("a check that crashes is a finding, never silence", async () => {
	registerCheck({ id: "t-crash", title: "t", on: ["facts"], run: () => { throw new Error("nav datu faila"); } });
	try {
		const s = store();
		const r = await runChecks(s, "facts", { dataDir: DATA, today: "2026-11-06" });
		assert.equal(r.failedChecks[0].id, "t-crash");
		assert.match(s.read("findings")[0].message, /Pārbaude neizdevās: nav datu faila/);
	} finally {
		unregisterCheck("t-crash");
	}
});
