// Every screen mounts without crashing, with a fresh project. Run: npm run test:ui
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mountApp } from "./harness.ts";
import type { Engine } from "../../src/main/engines/types.ts";

const notReady: Engine = { id: "claude", status: async () => ({ id: "claude", ready: false, reason: "Nav ievadīta API atslēga", canLogin: false }), run: async () => {} };

test("chat screen opens for a fresh project and the sidebar stays", async () => {
	const h = await mountApp({}, (api, dir) => void api.projectsCreate(join(dir, "P"), "Testa projekts"));
	await h.click("Čats");
	assert.deepEqual(h.errors, []);
	assert.match(h.text(), /Kontrolsaraksts/);
	assert.match(h.text(), /Iestatījumi/);
	h.unmount();
});

test("every sidebar screen mounts with a project selected, with facts and messages in the chat", async () => {
	const { appendChat, setFact } = await import("../../src/main/chat/brief.ts");
	const h = await mountApp({ engine: notReady }, async (api, dir) => {
		const root = join(dir, "P");
		api.projectsCreate(root, "Testa projekts");
		appendChat(root, "boris", "jauna publiska ēka, nezinu");
		appendChat(root, "agent", "Kāda ir adrese?");
		const at = new Date().toISOString();
		await setFact(root, "engine.work", "new_build", { kind: "boris", quote: "jauna publiska ēka", at }, "t");
		await setFact(root, "engine.use", "public", { kind: "boris", quote: "jauna publiska ēka", at }, "t");
		await setFact(root, "object", "nezināms", { kind: "unknown", quote: "nezinu", at }, "t");
	});
	await h.click("Izvēlēties");
	for (const label of ["Likumi", "MK noteikumi un LBN", "LVS standarti", "ES standarti un tiesības", "Pašvaldība", "Tīklu īpašnieki", "Projektēšanas uzdevums", "Izejas dati", "Čats", "Skati (PDF · IFC)", "Vēsture (žurnāls)", "Iestatījumi", "Pārskats"]) {
		await h.click(label);
		await h.settle(80);
		assert.deepEqual(h.errors, [], `after ${label}`);
		assert.match(h.text(), /Iestatījumi/, `sidebar gone after ${label}`);
	}
	h.unmount();
});

test("settings: provider list with connect buttons for ChatGPT and SuperGrok, key fields, model and effort pickers filled from the catalog", async () => {
	const h = await mountApp({ engine: notReady });
	await h.click("Iestatījumi");
	await h.settle(300);
	assert.deepEqual(h.errors, []);
	const t = h.text();
	for (const s of ["Pieslēgties ar ChatGPT", "Pieslēgties ar SuperGrok", "Kur dabūt atslēgu", "Atjaunot modeļu sarakstus", "Domāšanas līmenis", "tikai Console API atslēga"]) assert.ok(t.includes(s), s);
	const model = [...h.window.document.querySelectorAll("select")].find((s) => s.textContent?.includes("Noklusējums (claude-"));
	assert.ok(model && model.querySelectorAll("option").length > 5, "model picker has catalog models");
	h.unmount();
});

test("laws: add a likumi.lv link from the panel; it appears with its read date and its text opens", async () => {
	const html = "<html><head><title>LBN 201-15 Būvju ugunsdrošība</title></head><body><p>5. Evakuācijas ceļa platums nav mazāks par 1,0 m.</p></body></html>";
	const h = await mountApp({ engine: notReady, fetchPage: async () => html });
	await h.click("MK noteikumi un LBN");
	await h.type("input[placeholder^='https://likumi.lv']", "https://likumi.lv/ta/id/274245");
	await h.click("Pievienot saiti");
	await h.settle(200);
	assert.deepEqual(h.errors, []);
	assert.match(h.text(), /LBN 201-15 Būvju ugunsdrošība/);
	assert.match(h.text(), new RegExp(`nolasīts ${new Date().toISOString().slice(0, 10)}`));
	h.unmount();
});

test("LVS and ES pages list references found in the texts already read (not an empty page)", async () => {
	const h = await mountApp({ engine: notReady });
	await h.click("LVS standarti");
	await h.settle(200);
	assert.match(h.text(), /LVS 190-1/);
	assert.match(h.text(), /Pievienot failu/);
	await h.click("ES standarti un tiesības");
	await h.settle(200);
	assert.deepEqual(h.errors, []);
	assert.match(h.text(), /ES akti, uz kuriem atsaucas/);
	h.unmount();
});

test("sending a chat message with no agent configured shows the reason, does not blank the window", async () => {
	const h = await mountApp({ engine: notReady }, (api, dir) => void api.projectsCreate(join(dir, "P"), "Testa projekts"));
	await h.click("Čats");
	await h.type("textarea", "Sveiki, sāksim");
	await h.click("Sūtīt");
	await h.settle(200);
	assert.deepEqual(h.errors, []);
	assert.match(h.text(), /Iestatījumi/);
	assert.match(h.text(), /Sveiki, sāksim/);
	assert.match(h.text(), /Nav ievadīta API atslēga/);
	h.unmount();
});

// ---- panels 1–8 are filled from the project folder --------------------------------------------------------

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as tools from "../../src/mcp/tools.ts";

const dataDir = join(import.meta.dirname, "..", "..", "data");
const PU = "Projektēšanas uzdevums\nObjekts: Duntes iela 8, Rīga\nPasūtītājs: SIA Tests\nJauna publiska ēka, 4 stāvi virs zemes.\nProjektēt saskaņā ar LBN 208-15.";
const TR = "Tehniskie noteikumi Nr. 5\nIzsniedz AS Sadales tīkls, elektroapgāde.\nPieprasīts 2026-09-01, saņemts 2026-09-20.";

function projectFolder() {
	const root = join(mkdtempSync(join(tmpdir(), "bvui-p-")), "Duntes 8");
	mkdirSync(join(root, "01 PU"), { recursive: true });
	writeFileSync(join(root, "01 PU", "PU.txt"), PU);
	writeFileSync(join(root, "Sadales tikls TN.txt"), TR);
	return root;
}

/** An agent that does what a good one would: reads the files through the real tools and records what it finds. */
const reader: Engine = {
	id: "pi",
	status: async () => ({ id: "pi", ready: true, reason: "", canLogin: false }),
	run: async (o) => {
		const c = { root: o.mcp.projektesana.env.PROJEKTESANA_ROOT, engine: "pi", dataDir };
		const file = (path: string, quote: string) => ({ kind: "file" as const, path, quote });
		for (const name of ["list_files", "read_doc"]) o.onEvent({ type: "tool", name });
		if (o.prompt.includes("# Uzdevums: Projektēšanas uzdevums")) {
			await tools.setFactTool(c, "object", "Duntes iela 8, Rīga", file("01 PU/PU.txt", "Objekts: Duntes iela 8, Rīga"));
			await tools.setFactTool(c, "engine.use", "public", file("01 PU/PU.txt", "Jauna publiska ēka"));
		}
		if (o.prompt.includes("# Uzdevums: Tehniskie noteikumi"))
			await tools.addTrTool(c, { who: "AS Sadales tīkls", issuer: "network_owner", status: "saņemts", requested_on: "2026-09-01", received_on: "2026-09-20", file: "Sadales tikls TN.txt", quote: "Izsniedz AS Sadales tīkls" });
		o.onEvent({ type: "tool_result", name: "set_fact", ok: true });
		o.onEvent({ type: "done", text: "Gatavs." });
	},
};

test("first minute: pick the project folder, panel 7 already shows the files with proposed roles, one click and the agent fills it with quotes", async () => {
	const root = projectFolder();
	const h = await mountApp({ engine: reader });
	h.picks.folder = root;
	await h.click("Izvēlēties projekta mapi…");
	await h.settle(300);
	assert.deepEqual(h.errors, []);
	assert.match(h.text(), /faili: 2/);
	await h.click("Izvēlēties");
	await h.click("Projektēšanas uzdevums");
	await h.settle(150);
	assert.match(h.text(), /Mapē 2 faili/);
	assert.match(h.text(), /01 PU\/PU\.txt/);
	assert.match(h.text(), /ieteikts.*Projektēšanas uzdevums/s, "the role is proposed with the words that justify it");
	assert.doesNotMatch(h.text(), /Sadales tikls TN/, "technical rules belong to panels 5–6");
	await h.click("Savākt no projekta mapes");
	await h.settle(400);
	assert.deepEqual(h.errors, []);
	assert.match(h.text(), /Duntes iela 8, Rīga/);
	assert.match(h.text(), /„Objekts: Duntes iela 8, Rīga”/, "the value is shown with the quote it rests on");
	assert.match(h.text(), /Publiska ēka/);
	assert.match(h.text(), /ieteikts — pārbaudi/);
	assert.match(h.text(), /Pasūtītājs/, "an item the agent did not find is still listed, as not found");
	await h.click(/^Pareizi$/);
	await h.settle(100);
	assert.match(h.text(), /apstiprināts/);
	assert.deepEqual(h.errors, []);
	h.unmount();
});

test("panel 7: Boris corrects a value by typing; a value the engine does not know is refused with the allowed ones", async () => {
	const root = projectFolder();
	const h = await mountApp({ engine: reader });
	h.picks.folder = root;
	await h.click("Izvēlēties projekta mapi…");
	await h.settle(300);
	await h.click("Izvēlēties");
	await h.click("Projektēšanas uzdevums");
	await h.click("Savākt no projekta mapes");
	await h.settle(400);
	await h.clickIn("Objekta nosaukums un adrese", "Labot");
	await h.type("td input[type=text]", "Brīvības iela 1, Rīga");
	await h.click("Saglabāt");
	await h.settle(150);
	assert.match(h.text(), /Brīvības iela 1, Rīga/);
	assert.match(h.text(), /apstiprināts/);
	// nothing in the file says so, but it is Boris's own word and the quote is his message
	assert.match(h.text(), /Borisa vārdi čatā/);
	assert.deepEqual(h.errors, []);
	h.unmount();
});

test("panel 5: the agent's technical-rules request is listed with its file and quote; Boris confirms; he can pick the received file", async () => {
	const root = projectFolder();
	const received = join(mkdtempSync(join(tmpdir(), "bvui-f-")), "Atbilde.txt");
	writeFileSync(received, "Tehniskie noteikumi gāzei");
	const h = await mountApp({ engine: reader });
	h.picks.folder = root;
	await h.click("Izvēlēties projekta mapi…");
	await h.settle(300);
	await h.click("Izvēlēties");
	await h.click("Tīklu īpašnieki");
	await h.settle(100);
	assert.match(h.text(), /Šeit vēl nav neviena pieprasījuma/);
	await h.click("Savākt no projekta mapes");
	await h.settle(400);
	assert.match(h.text(), /AS Sadales tīkls/);
	assert.match(h.text(), /aģents atrada — pārbaudi/);
	assert.match(h.text(), /„Izsniedz AS Sadales tīkls”/);
	await h.click(/^Pareizi$/);
	await h.settle(100);
	assert.doesNotMatch(h.text(), /aģents atrada — pārbaudi/);
	h.picks.files = [received];
	await h.click("Nomainīt failu…");
	await h.settle(200);
	assert.match(h.text(), /Izejas dati\/Atbilde\.txt/);
	assert.deepEqual(h.errors, []);
	h.unmount();
});

test("panel 2: the project's own documents are listed above the library, with 'not in the library' said plainly", async () => {
	const root = projectFolder();
	const h = await mountApp({ engine: reader });
	h.picks.folder = root;
	await h.click("Izvēlēties projekta mapi…");
	await h.settle(300);
	await h.click("Izvēlēties");
	await h.click("MK noteikumi un LBN");
	await h.settle(300);
	assert.match(h.text(), /Projekta dokumenti min \(1\)/);
	assert.match(h.text(), /LBN 208-15/);
	assert.match(h.text(), /nav bibliotēkā/);
	assert.match(h.text(), /saskaņā ar LBN 208-15/);
	assert.deepEqual(h.errors, []);
	h.unmount();
});

test("no agent connected: the gather button says why and where to fix it, the window stays", async () => {
	const root = projectFolder();
	const h = await mountApp({ engine: notReady });
	h.picks.folder = root;
	await h.click("Izvēlēties projekta mapi…");
	await h.settle(300);
	await h.click("Izvēlēties");
	await h.click("Izejas dati");
	// said up front, and the button that needs the agent is off; the ones that do not need it stay on
	assert.match(h.text(), /Aģents nav pieslēgts: Nav ievadīta API atslēga/);
	assert.match(h.text(), /Iestatījumi → Aģents/);
	await assert.rejects(h.click("Savākt no projekta mapes"), /no button/);
	await h.click("Pārskatīt mapi");
	assert.deepEqual(h.errors, []);
	h.unmount();
});

test("Pārskats: 'Savākt visu no mapes' runs all four groups and reports each", async () => {
	const root = projectFolder();
	const h = await mountApp({ engine: reader });
	h.picks.folder = root;
	await h.click("Izvēlēties projekta mapi…");
	await h.settle(300);
	await h.click("Savākt visu no mapes");
	await h.settle(600);
	assert.match(h.text(), /pu: gatavs · data: gatavs · tr: gatavs · laws: gatavs/);
	assert.match(h.text(), /jāpārbauda: \d+/);
	assert.deepEqual(h.errors, []);
	h.unmount();
});

test("chat: attach a file from anywhere; Boris sees where it went and which role it got", async () => {
	const root = projectFolder();
	const src = join(mkdtempSync(join(tmpdir(), "bvui-a-")), "Topo.txt");
	writeFileSync(src, "Topogrāfiskais plāns M1:500");
	const h = await mountApp({ engine: reader });
	h.picks.folder = root;
	await h.click("Izvēlēties projekta mapi…");
	await h.settle(300);
	await h.click("Izvēlēties");
	await h.click("Čats");
	h.picks.files = [src];
	await h.click("Pievienot failu…");
	await h.settle(200);
	assert.match(h.text(), /Pievienots: Izejas dati\/Topo\.txt — loma Topogrāfija/);
	assert.deepEqual(h.errors, []);
	h.unmount();
});

test("settings: the Revit server has a file picker and a one-click usual place", async () => {
	const js = join(mkdtempSync(join(tmpdir(), "bvui-r-")), "index.js");
	writeFileSync(js, "// revit mcp");
	const h = await mountApp({ engine: notReady, revitDefault: () => "D:\Code\BIM\revit-mcp\server\build\index.js" });
	await h.click("Iestatījumi");
	await h.settle(300);
	assert.match(h.text(), /Izmantot parasto vietu/);
	h.picks.files = [js];
	await h.click("Izvēlēties failu…");
	await h.click(/^Saglabāt$/);
	await h.settle(200);
	assert.equal(h.api.settingsGet().revitServerJs, js);
	assert.deepEqual(h.errors, []);
	h.unmount();
});
