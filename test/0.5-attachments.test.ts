// Chat attachments: pasted screenshots go to the model as images, documents as their text (the sources' readers),
// everything else is refused with the reason before a run starts.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createPiRuntime, lookupPiModel, seesImages } from "../src/agent/pi/models.ts";
import { ATTACH_LIMITS, prepareAttachments, safeName } from "../src/agent/attachments.ts";
import { AgentSession } from "../src/agent/session.ts";
import type { ChatAttachment } from "../src/shared/api.ts";
import { DEFAULT_SETTINGS } from "../src/shared/types.ts";
import { FIX, makeDocx, tmp } from "./helpers.ts";

// a real 1×1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString("base64");
const img = (name = "ekranuzn.png", thumb?: string): ChatAttachment => ({ name, mimeType: "image/png", data: PNG, thumb });
const doc = (name: string, body: string | Uint8Array, mimeType = "text/plain"): ChatAttachment => ({ name, mimeType, data: b64(body) });
const opts = { seesImages: true, model: "m" };

test("attachments: a screenshot goes as an image; the prompt names it; the transcript keeps the thumbnail", async () => {
	const r = await prepareAttachments([img("a.png", "data:image/jpeg;base64,xx"), img("b.png")], opts);
	assert.deepEqual(r.images, [
		{ type: "image", data: PNG, mimeType: "image/png" },
		{ type: "image", data: PNG, mimeType: "image/png" },
	]);
	assert.match(r.text, /Pievienotie attēli .*: a\.png, b\.png\./);
	assert.deepEqual(r.refs, [
		{ name: "a.png", kind: "image", thumb: "data:image/jpeg;base64,xx" },
		{ name: "b.png", kind: "image", thumb: undefined },
	]);
});

test("attachments: an image for a model that does not see images is refused, not silently dropped", async () => {
	await assert.rejects(prepareAttachments([img()], { seesImages: false, model: "teksta-modelis" }), /"teksta-modelis" neredz attēlus/);
});

test("attachments: a document goes as its text, between named markers; DOCX through the sources' reader", async () => {
	const r = await prepareAttachments([doc("piezimes.md", "Jumta slīpums 30°"), doc("TN.docx", makeDocx(["Būvniecības ieceres tehniskie noteikumi"]), "")], opts);
	assert.equal(r.images.length, 0);
	assert.match(r.text, /--- pielikums: piezimes\.md \(MD\) ---\nJumta slīpums 30°\n--- beigas: piezimes\.md ---/);
	assert.match(r.text, /--- pielikums: TN\.docx \(DOCX\) ---\n.*tehniskie noteikumi/);
	assert.deepEqual(r.refs.map((x) => x.kind), ["document", "document"]);
});

test("attachments: a PDF with a text layer gives page markers; a scanned PDF is refused with what to do", async () => {
	const pdf = await prepareAttachments([doc("text-lv.pdf", readFileSync(join(FIX, "text-lv.pdf")), "application/pdf")], opts);
	assert.match(pdf.text, /--- pielikums: text-lv\.pdf \(PDF/);
	await assert.rejects(prepareAttachments([doc("scan-lv.pdf", readFileSync(join(FIX, "scan-lv.pdf")), "application/pdf")], opts), /neizdevās nolasīt tekstu.*ekrānuzņēmumu/);
});

test("attachments: unknown formats, too many files and empty files are refused with the reason", async () => {
	await assert.rejects(prepareAttachments([doc("plans.dwg", "x", "")], opts), /Formāts \.dwg \("plans\.dwg"\) netiek lasīts\. Der attēli/);
	await assert.rejects(prepareAttachments([{ name: "a.bmp", mimeType: "image/bmp", data: PNG }], opts), /image\/bmp netiek nosūtīts/);
	await assert.rejects(prepareAttachments(Array.from({ length: ATTACH_LIMITS.files + 1 }, () => img()), opts), /Par daudz pielikumu/);
	await assert.rejects(prepareAttachments([{ name: "e.txt", mimeType: "text/plain", data: "" }], opts), /ir tukšs/);
});

test("attachments: a long document is cut, and the cut is said", async () => {
	const r = await prepareAttachments([doc("liels.txt", "ā".repeat(ATTACH_LIMITS.docChars + 500))], opts);
	assert.match(r.text, new RegExp(`\\[… saīsināts: ${ATTACH_LIMITS.docChars} no ${ATTACH_LIMITS.docChars + 500} zīmēm\\]`));
});

test("attachments: the received bytes are written to the run folder under safe names", async () => {
	const dir = join(tmp(), "attachments");
	await prepareAttachments([img("ekrāns:1?.png"), doc("a/b.txt", "teksts")], { ...opts, saveDir: dir });
	assert.deepEqual(readdirSync(dir).sort(), ["01-ekrāns_1_.png", "02-a_b.txt"]);
	assert.equal(readFileSync(join(dir, "01-ekrāns_1_.png")).toString("base64"), PNG);
	assert.equal(safeName("", 2), "pielikums-3");
});

function session() {
	const dir = tmp();
	mkdirSync(join(dir, "chat"), { recursive: true });
	const rt = createPiRuntime({ path: join(dir, "pi.json"), apiKey: () => null });
	return {
		dir,
		rt,
		s: new AgentSession({
			runtime: async () => rt,
			settings: () => ({ ...DEFAULT_SETTINGS }),
			toolsServer: () => ({ command: "node", args: [], env: {} }),
			revit: () => null,
			ctx: { projectsDir: dir, dataDir: dir, appDir: dir },
			runsDir: join(dir, "runs"),
			chatDir: join(dir, "chat"),
			emit: () => {},
		}),
	};
}

test("session: a refused attachment starts no run and writes no transcript line; the next send is not 'busy'", async () => {
	const { s, dir } = session();
	await assert.rejects(s.send("p1", "skaties", [], [doc("plans.dwg", "x", "")]), /\.dwg/);
	await assert.rejects(s.send("p1", "skaties", [], [doc("plans.dwg", "x", "")]), /\.dwg/, "not 'Aģents jau strādā'");
	assert.equal(existsSync(join(dir, "chat", "p1.jsonl")), false);
	assert.deepEqual(s.history("p1"), []);
});

test("session: a message of attachments only is not empty; status says whether the model sees images", async () => {
	const { s, rt } = session();
	await assert.rejects(s.send("p1", "  ", []), /Tukšs ziņojums/);
	const st = await s.status();
	assert.equal(st.images, seesImages(lookupPiModel(rt, DEFAULT_SETTINGS.provider, DEFAULT_SETTINGS.model)), "status reads the model's own input list");
});
