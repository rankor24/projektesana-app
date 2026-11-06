// End-to-end OCR check inside Electron: render the pages of a PDF offscreen and OCR them in Latvian, with the app's own
// built modules (dist/). Prints JSON { pages: [{ page, text, confidence }] }. Used by test/1.5-ocr.test.ts.
//   npx electron scripts/ocr-check.mjs <file.pdf> <page,page>
import { app } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const [file, list] = process.argv.slice(2).filter((a) => !a.startsWith("-") && !a.endsWith("ocr-check.mjs") && a !== ".");
app.whenReady().then(async () => {
	try {
		const { PageRenderer } = await import(pathToFileURL(join(root, "dist", "main", "offscreen.js")).href);
		const { Ocr } = await import(pathToFileURL(join(root, "dist", "sources", "text", "ocr.js")).href);
		const r = new PageRenderer(join(root, "dist", "renderer"));
		const ocr = new Ocr(join(root, "resources", "tessdata"));
		const pages = (list ?? "1").split(",").map(Number);
		const imgs = await r.render(new Uint8Array(readFileSync(file)), pages, 3);
		const out = [];
		for (const img of imgs) out.push({ page: img.page, width: img.width, ...(await ocr.recognize(img.png)) });
		await ocr.close();
		process.stdout.write(`OCR_RESULT ${JSON.stringify({ pages: out })}\n`);
	} catch (e) {
		process.stdout.write(`OCR_ERROR ${e.stack ?? e}\n`);
	}
	app.quit();
});
