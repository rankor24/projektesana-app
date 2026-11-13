// Smoke test of the PACKAGED app, with no window: the built exe runs as Node (ELECTRON_RUN_AS_NODE) and loads the app's
// own modules from inside resources/app.asar — the hash and text workers, pdfjs, tesseract with the Latvian model from
// resources/tessdata, and the tools server over MCP stdio. Invented fixtures only.
//   npm run pack && npm run smoke:packaged            (or: node scripts/smoke-packaged.mjs <win-unpacked dir>)
// The runner re-launches itself under the packaged exe; the checks run there.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "..");
const fixtures = join(repo, "test", "fixtures");

if (!process.env.PJ_SMOKE_INSIDE) {
	const dir = resolve(process.argv[2] ?? join(repo, "release", "win-unpacked"));
	const exe = join(dir, "Projektesana.exe");
	if (!existsSync(exe)) {
		console.error(`smoke: ${exe} not found — run npm run pack first`);
		process.exit(1);
	}
	const r = spawnSync(exe, [import.meta.filename], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PJ_SMOKE_INSIDE: dir }, stdio: "inherit", timeout: 180_000 });
	process.exit(r.status ?? 1);
}

const dir = process.env.PJ_SMOKE_INSIDE;
const res = join(dir, "resources");
const asar = join(res, "app.asar");
const imp = (p) => import(pathToFileURL(join(asar, "dist", p)).href);
const results = [];
const check = async (name, fn) => {
	const t0 = Date.now();
	try {
		const detail = await fn();
		results.push({ name, ok: true, detail, ms: Date.now() - t0 });
	} catch (e) {
		results.push({ name, ok: false, detail: String(e?.stack ?? e).split("\n").slice(0, 3).join(" | "), ms: Date.now() - t0 });
	}
};

await check("resources shipped", () => {
	const need = ["data", "tessdata/lav.traineddata.gz", "bimcraft/index.html", "bimcraft/app/bimcraft.js", "bimcraft/app/addons/projektesana", "bimcraft/vendor/three", "skills/index.json", "office-text.ps1"];
	const missing = need.filter((p) => !existsSync(join(res, p)));
	if (missing.length) throw new Error(`missing: ${missing.join(", ")}`);
	return need.join(", ");
});

await check("hash worker from app.asar", async () => {
	const { hashFiles } = await imp("sources/hash.js");
	const abs = join(fixtures, "text-lv.pdf");
	const s = statSync(abs);
	const out = await hashFiles([{ abs, rel: "text-lv.pdf", size: s.size, mtimeMs: s.mtimeMs, folderKey: "1.1.2" }], () => null);
	if (!/^[0-9a-f]{64}$/.test(out[0]?.sha256 ?? "")) throw new Error(`no sha: ${JSON.stringify(out[0])}`);
	return out[0].sha256.slice(0, 12);
});

await check("text worker + pdfjs from app.asar", async () => {
	const { readTexts } = await imp("sources/text-run.js");
	let got = null;
	await readTexts([{ id: 1, abs: join(fixtures, "text-lv.pdf"), ext: ".pdf" }], (_j, r) => (got = r));
	const text = (got?.pages ?? []).join(" ");
	if (!/[āčēģīķļņšūž]/i.test(text)) throw new Error(`no Latvian text: ${JSON.stringify(got).slice(0, 200)}`);
	return `${got.pages.length} pages, ${text.length} chars`;
});

await check("OCR (tesseract lav) from app.asar", async () => {
	const { Ocr } = await imp("sources/text/ocr.js");
	const pdf = readFileSync(join(fixtures, "scan-lv.pdf"));
	const jpeg = pdf.subarray(pdf.indexOf(Buffer.from([0xff, 0xd8, 0xff])), pdf.lastIndexOf(Buffer.from([0xff, 0xd9])) + 2);
	const ocr = new Ocr(join(res, "tessdata"));
	try {
		const r = await ocr.recognize(jpeg);
		const lv = (r.text.match(/[āčēģīķļņšūž]/gi) ?? []).length;
		if (lv < 5) throw new Error(`only ${lv} Latvian letters`);
		return `${lv} Latvian letters`;
	} finally {
		await ocr.close();
	}
});

// the same variables the agent session passes (src/agent/tools/context.ts ctxEnv); app and project folders are fresh temp dirs
const toolsEnv = () => {
	const app = mkdtempSync(join(tmpdir(), "pj-smoke-"));
	return { PROJEKTESANA_PROJECTS: join(app, "projects"), PROJEKTESANA_PROJECT: "", PROJEKTESANA_DATA: join(res, "data"), PROJEKTESANA_APP: app, PROJEKTESANA_RUN: "", PROJEKTESANA_SKILLS: join(res, "skills") };
};

await check("tools server over MCP stdio from app.asar", () =>
	new Promise((ok, fail) => {
		const p = spawn(process.execPath, [join(asar, "dist", "agent", "tools", "server.js")], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...toolsEnv() }, stdio: ["pipe", "pipe", "pipe"] });
		let buf = "";
		let err = "";
		const timer = setTimeout(() => (p.kill(), fail(new Error(`no answer in 30 s; stderr: ${err.slice(0, 300)}`))), 30_000);
		const send = (m) => p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
		p.stderr.on("data", (d) => (err += d));
		p.on("exit", (c) => c && (clearTimeout(timer), fail(new Error(`exit ${c}: ${err.slice(0, 300)}`))));
		p.stdout.on("data", (d) => {
			buf += d;
			for (let i; (i = buf.indexOf("\n")) >= 0; ) {
				const line = buf.slice(0, i);
				buf = buf.slice(i + 1);
				if (!line.trim()) continue;
				const m = JSON.parse(line);
				if (m.id === 1) {
					send({ method: "notifications/initialized" });
					send({ id: 2, method: "tools/list" });
				} else if (m.id === 2) {
					clearTimeout(timer);
					p.kill();
					ok(`${m.result.tools.length} tools`);
				}
			}
		});
		send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
	}),
);

for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name} (${r.ms} ms): ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `smoke: ${failed} of ${results.length} failed` : `smoke: all ${results.length} passed`);
process.exit(failed ? 1 : 0);
