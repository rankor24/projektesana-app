// Avoti → Normatīvi: the law library over IPC (likumi.lv only, fetched in main with the read date; the user's own file;
// remove; re-read flags a changed text) and "Piemērojamie normatīvi" from CONFIRMED profile facts through the curated
// data/applicable-acts.json. No network: the page fetcher is injected and every page and file below is invented.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Fact } from "../src/core/model.ts";
import { Registry } from "../src/core/registry.ts";
import { libraryHandlers, likumiUrl } from "../src/main/handlers/library.ts";
import { AppSettings } from "../src/main/settings.ts";
import { applicableActs, holdsStandard, loadActMap, type ActMap } from "../src/rules/applicable.ts";
import { BUILTIN, Library, toParagraphs } from "../src/rules/library.ts";
import { tmp } from "./helpers.ts";

const DATA = join(import.meta.dirname, "..", "data");
const plainCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
const today = new Date().toISOString().slice(0, 10);

const page = (title: string, ...paras: string[]) => `<html><head><title>${title}</title></head><body><nav>izvēlne</nav>${paras.map((p) => `<p>${p}</p>`).join("")}</body></html>`;

function setup(pages: Record<string, string>) {
	const dir = tmp();
	const settings = new AppSettings(dir, plainCrypto);
	const registry = new Registry(join(dir, "projects.json"), join(dir, "projects"));
	const root = join(tmp(), "BD997 Izdomāta iela 2");
	mkdirSync(root, { recursive: true });
	const p = registry.add(root);
	const fetched: string[] = [];
	const events: string[][] = [];
	const h = libraryHandlers({
		settings,
		dataDir: DATA,
		registry,
		emit: (_e, payload) => events.push((payload as { what: string[] }).what),
		fetchPage: async (url) => {
			fetched.push(url);
			const html = pages[url];
			if (html === undefined) throw new Error(`nav lapas ${url}`);
			return html;
		},
	});
	return { h, dir, settings, registry, projectId: p.id, store: registry.store(p.id), fetched, events, pages };
}

const fact = (key: string, value: string, state: Fact["state"]): Fact => ({
	id: `f-${key}-${value}`,
	key,
	value,
	source: state === "confirmed" ? { kind: "user", at: "2026-11-09T08:00:00.000Z" } : ({ sourceId: "pu", sha: "a".repeat(64), page: 1, quote: value } as Fact["source"]),
	state,
	by: state === "confirmed" ? "user" : "agent",
	at: "2026-11-09T08:00:00.000Z",
});

test("likumiUrl: likumi.lv addresses become /ta/id/<n>; anything else, paid catalogues too, is refused", () => {
	assert.deepEqual(likumiUrl(" https://likumi.lv/ta/id/900001-izdomats-akts#p3 "), { actId: "900001", url: "https://likumi.lv/ta/id/900001" });
	assert.equal(likumiUrl("https://www.likumi.lv/doc.php?id=900002").url, "https://likumi.lv/ta/id/900002");
	for (const bad of ["http://likumi.lv/ta/id/1", "https://www.lvs.lv/lv/products/index", "https://likumi.lv.evil.example/ta/id/1", "https://eur-lex.europa.eu/x"]) assert.throws(() => likumiUrl(bad), /tikai likumi\.lv/);
});

test("library.addUrl fetches in main, saves the read date, refuses a second copy and non-likumi links without fetching", async () => {
	const url = "https://likumi.lv/ta/id/900001";
	const t = setup({ [url]: page("Izdomāts būvnormatīvs LBN 999-26", "1. Būvnormatīvs nosaka izdomātas prasības testa ēkām.", "2. Otrā izdomātā rindkopa par kāpnēm.") });
	const s = await t.h["library.addUrl"](`${url}-izdomats`, "mk");
	assert.equal(s.title, "Izdomāts būvnormatīvs LBN 999-26");
	assert.equal(s.url, url);
	assert.equal(s.kind, "url");
	assert.equal(s.readOn, today);
	assert.deepEqual(t.fetched, [url]);
	assert.deepEqual(t.events.at(-1), ["library"]);
	const list = await t.h["library.list"]();
	assert.ok(list.some((x) => x.id === s.id));
	assert.ok(list.some((x) => x.kind === "builtin"), "the six built-in acts stay listed");
	const { paragraphs } = await t.h["library.paragraphs"](s.id);
	assert.ok(paragraphs.includes("2. Otrā izdomātā rindkopa par kāpnēm."));
	await assert.rejects(t.h["library.addUrl"](url, "mk"), /jau ir bibliotēkā/);
	await assert.rejects(t.h["library.addUrl"]("https://likumi.lv/ta/id/258572", "likums"), /jau ir bibliotēkā: Būvniecības likums/);
	await assert.rejects(t.h["library.addUrl"]("https://www.lvs.lv/lv/products/index?x=1", "lvs"), /tikai likumi\.lv/);
	assert.equal(t.fetched.length, 1, "refused links are never fetched");
	// the library is the one the agent's search_law reads: same folder, same text
	assert.equal(new Library(t.settings.libraryDir(), join(DATA, "law-snapshots")).search("izdomātas prasības")[0].source, s.id);
});

test("library.reread: same text keeps the version; a changed text sets changedOn and keeps the old file", async () => {
	const url = "https://likumi.lv/ta/id/900003";
	const t = setup({ [url]: page("Izdomāts akts", "1. Sākotnējā izdomātā redakcija ar pietiekami garu tekstu.") });
	const s = await t.h["library.addUrl"](url, "likums");
	const same = await t.h["library.reread"](s.id);
	assert.equal(same.changed, false);
	assert.equal(same.source.changedOn, undefined);
	t.pages[url] = page("Izdomāts akts", "1. Grozītā izdomātā redakcija ar pietiekami garu tekstu.");
	const diff = await t.h["library.reread"](s.id);
	assert.equal(diff.changed, true);
	assert.equal(diff.source.changedOn, today);
	assert.equal((await t.h["library.list"]()).find((x) => x.id === s.id)?.changedOn, today);
	assert.match(readFileSync(join(t.settings.libraryDir(), `${s.id}.${today}.txt`), "utf8"), /Sākotnējā/);
	const now = (await t.h["library.paragraphs"](s.id)).paragraphs;
	assert.ok(now.some((p) => p.startsWith("1. Grozītā")) && !now.some((p) => p.includes("Sākotnējā")));
});

test("library.addFile keeps the user's own standard; remove hides it; built-in acts cannot be removed", async () => {
	const t = setup({});
	const f = join(tmp(), "LVS EN ISO 99999-2026 izdomāts.txt");
	writeFileSync(f, "Izdomāts standarts testam\n1. Izdomātā aprēķina metode siltumcaurlaidībai.\n", "utf8");
	const s = await t.h["library.addFile"](f, "lvs", "LVS EN ISO 99999 Izdomāts standarts");
	assert.equal(s.kind, "file");
	assert.equal(s.file, "LVS EN ISO 99999-2026 izdomāts.txt");
	assert.ok(holdsStandard(s, "LVS EN ISO 99999"));
	assert.ok(!holdsStandard(s, "LVS EN ISO 9999"));
	await t.h["library.remove"](s.id);
	assert.ok(!(await t.h["library.list"]()).some((x) => x.id === s.id));
	assert.throws(() => t.h["library.remove"]("builtin-258572"), /Iebūvētos aktus noņemt nevar/);
	await assert.rejects(async () => t.h["library.addFile"](f, "nav" as never), /Nezināma kategorija/);
});

// an invented map, so the rule logic is tested apart from the real data file
const MAP: ActMap = {
	about: "tests",
	readOn: "2026-11-09",
	notRead: "—",
	rows: [
		{ id: "all", title: "Visām ēkām", category: "likums", source: { kind: "likumi", actId: "258572" }, when: {}, why: { act: "Būvniecības likums", actId: "258572", point: "3. pants", url: "https://likumi.lv/ta/id/258572", quote: "Likumu piemēro jaunu būvju būvniecībai" } },
		{ id: "pub", title: "Publiskām", category: "mk", source: { kind: "likumi", actId: "900010" }, when: { work: ["new_build"], use: ["public"] }, why: { act: "X", actId: "900010", point: "1.", url: "https://likumi.lv/ta/id/900010", quote: "nav bibliotēkā" } },
		{ id: "grp", title: "3. grupai MBP", category: "mk", source: { kind: "likumi", actId: "900011" }, when: { group: ["3"], stages: ["MBP"] }, why: { act: "X", actId: "900011", point: "1.", url: "https://likumi.lv/ta/id/900011", quote: "x" } },
		{ id: "std", title: "LVS EN ISO 99999", category: "lvs", source: { kind: "paid", ref: "LVS EN ISO 99999", catalogue: "https://www.lvs.lv/lv/products/index" }, when: { work: ["new_build"] }, why: { act: "Būvniecības likums", actId: "258572", point: "3. pants", url: "https://likumi.lv/ta/id/258572", quote: "šī teikuma likumā nav" } },
	],
};

test("applicable: only confirmed facts decide; proposed = unknown; a confirmed mismatch is kept as neattiecas with the reason", () => {
	const lib = new Library(tmp(), join(DATA, "law-snapshots"));
	const by = (facts: Fact[]) => Object.fromEntries(applicableActs(MAP, facts, lib).map((r) => [r.id, r]));

	const none = by([]);
	assert.equal(none.all.state, "attiecas");
	assert.deepEqual(none.all.because, ["visām ēkām"]);
	assert.equal(none.pub.state, "nav zināms");
	assert.deepEqual(none.pub.missing, ["būvniecības veids — profilā nav", "lietošanas veids — profilā nav"]);

	const proposed = by([fact("profile.workType", "new_build", "proposed"), fact("profile.use", "public", "proposed")]);
	assert.equal(proposed.pub.state, "nav zināms", "a proposal from the PU is not enough");
	assert.match(proposed.pub.missing[0], /tikai piedāvāts/);

	const yes = by([fact("profile.workType", "new_build", "confirmed"), fact("profile.use", "public", "confirmed"), fact("profile.group", "3", "confirmed"), fact("profile.stagesInContract", "SKICE", "confirmed"), fact("profile.stagesInContract", "MBP", "confirmed")]);
	assert.equal(yes.pub.state, "attiecas");
	assert.deepEqual(yes.pub.because, ["būvniecības veids: jaunbūve", "lietošanas veids: publiska ēka"]);
	assert.equal(yes.grp.state, "attiecas", "one of several confirmed stages is enough");
	assert.deepEqual(yes.grp.because, ["ēkas grupa: 3. grupa", "stadijas līgumā: MBP"]);

	const no = by([fact("profile.workType", "renovation", "confirmed"), fact("profile.use", "public", "confirmed")]);
	assert.equal(no.pub.state, "neattiecas");
	assert.deepEqual(no.pub.notMatched, ["būvniecības veids: atjaunošana"]);
	assert.equal(no.std.state, "neattiecas");
});

test("applicable: library state per row — built-in in library with its quote checked, missing act nav bibliotēkā, paid standard held by the user's file", async () => {
	const lib = new Library(tmp(), join(DATA, "law-snapshots"));
	let rows = applicableActs(MAP, [], lib);
	const all = rows.find((r) => r.id === "all")!;
	assert.deepEqual(all.inLibrary, { id: "builtin-258572", readOn: "2026-11-03", changedOn: null });
	assert.equal(all.quoteFound, true);
	const pub = rows.find((r) => r.id === "pub")!;
	assert.equal(pub.inLibrary, null);
	assert.equal(pub.quoteFound, null, "the citing act is not in the library: unknown, not false");
	assert.equal(pub.url, "https://likumi.lv/ta/id/900010");
	const std = rows.find((r) => r.id === "std")!;
	assert.equal(std.kind, "paid");
	assert.equal(std.url, null);
	assert.equal(std.catalogue, "https://www.lvs.lv/lv/products/index");
	assert.equal(std.inLibrary, null);
	assert.equal(std.quoteFound, false, "a quote that is not in the citing act's text is flagged");
	const f = join(tmp(), "standarts.txt");
	writeFileSync(f, "Izdomāts standarts EN ISO 99999\n1. Izdomāta prasība testam par siltumu.\n", "utf8");
	await lib.addFile(f, "lvs", "LVS EN ISO 99999:2026 Izdomāts");
	rows = applicableActs(MAP, [], lib);
	assert.ok(rows.find((r) => r.id === "std")!.inLibrary);
});

test("library.applicable over IPC uses the project's facts and the shipped mapping", async () => {
	const t = setup({});
	t.store.write("facts", [fact("profile.workType", "new_build", "confirmed"), fact("profile.use", "residential_other", "confirmed")], { kind: "t", by: "app" });
	const r = await t.h["library.applicable"](t.projectId);
	const row = (id: string) => r.rows.find((x) => x.id === id)!;
	assert.equal(r.readOn, "2026-11-09");
	assert.equal(row("lbn-201-15").state, "attiecas");
	assert.equal(row("lbn-201-15").inLibrary, null);
	assert.equal(row("lbn-016-15").state, "attiecas", "būvakustika: dzīvojamās ēkas");
	assert.equal(row("lbn-200-21").inLibrary?.id, "builtin-326992");
	assert.equal(row("lbn-200-21").quoteFound, true);
	assert.equal(row("lvs-en-iso-6946").kind, "paid");
	const prod = setup({});
	prod.store.write("facts", [fact("profile.workType", "new_build", "confirmed"), fact("profile.use", "production", "confirmed")], { kind: "t", by: "app" });
	assert.equal((await prod.h["library.applicable"](prod.projectId)).rows.find((x) => x.id === "lbn-016-15")!.state, "neattiecas");
});

test("data/applicable-acts.json: every row cited; quotes of built-in acts are verbatim in their snapshots; paid standards never point at a download", () => {
	const map = loadActMap(DATA);
	const ids = new Set<string>();
	const builtin = new Set(BUILTIN.map((b) => b.actId));
	const squash = (s: string) => s.replace(/\s+/g, " ").trim();
	for (const r of map.rows) {
		assert.ok(!ids.has(r.id), `duplicate ${r.id}`);
		ids.add(r.id);
		assert.ok(r.why.quote.length > 20 && r.why.point && r.why.act, r.id);
		assert.equal(r.why.url, `https://likumi.lv/ta/id/${r.why.actId}`, r.id);
		for (const [k, v] of Object.entries(r.when)) assert.ok(["work", "use", "group", "stages"].includes(k) && Array.isArray(v) && v.length, `${r.id}.${k}`);
		if (r.source.kind === "paid") {
			assert.equal(r.category, "lvs", r.id);
			assert.match(r.source.catalogue, /^https:\/\/www\.lvs\.lv\/lv\/products\/index\?/, r.id);
			assert.ok(squash(r.why.quote).includes(r.source.ref.replace(/^LVS /, "")), `${r.id}: the citing paragraph names the standard`);
		} else assert.match(r.source.actId, /^\d+$/);
		if (builtin.has(r.why.actId)) {
			const text = squash(toParagraphs(readFileSync(join(DATA, "law-snapshots", `${r.why.actId}.txt`), "utf8")).join(" "));
			assert.ok(text.includes(squash(r.why.quote)), `${r.id}: quote not in snapshot ${r.why.actId}`);
		}
	}
	// LBN 208-15 (274995) and LBN 211-15 (275016) were repealed by LBN 200-21 174. punkts: never offered as applicable
	assert.ok(!map.rows.some((r) => r.source.kind === "likumi" && ["274995", "275016"].includes(r.source.actId)));
	assert.ok(squash(readFileSync(join(DATA, "law-snapshots", "326992.txt"), "utf8")).includes('174. Atzīt par spēku zaudējušiem Ministru kabineta 2015. gada 30. jūnija noteikumus Nr. 331 "Noteikumi par Latvijas būvnormatīvu LBN 208-15'));
});
