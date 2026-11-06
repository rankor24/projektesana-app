// Builds the PDF fixtures from invented HTML in test/fixtures/src/*.html, with Electron's own Chromium (real fonts, real
// Latvian diacritics, real vector paths). Every name, number and address in those HTML files is made up.
//   npx electron scripts/make-fixtures.mjs            → all
//   npx electron scripts/make-fixtures.mjs scan       → only the ones whose name contains "scan"
// `*.image.html` files are rendered to a JPEG and wrapped in an image-only PDF (no text layer): the OCR fixtures.
import { app, BrowserWindow } from "electron";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "test", "fixtures");
const only = process.argv.slice(2).find((a) => !a.startsWith("-") && !a.endsWith(".mjs") && a !== ".");

/** Minimal PDF with one JPEG per page, drawn full-page. No fonts, no text: what a scanner produces. */
function imagePdf(jpegs) {
	const objs = [];
	const add = (body) => (objs.push(body), objs.length);
	const pages = [];
	const catalog = add(null);
	const pagesObj = add(null);
	for (const { data, w, h } of jpegs) {
		// A4 at the image's aspect
		const pw = 595.28;
		const ph = (pw * h) / w;
		const img = add({ stream: data, dict: `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode` });
		const content = Buffer.from(`q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im0 Do Q`);
		const c = add({ stream: content, dict: "" });
		pages.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${c} 0 R >>`));
	}
	objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
	objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pages.map((p) => `${p} 0 R`).join(" ")}] /Count ${pages.length} >>`;
	const parts = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
	const offsets = [];
	let len = parts[0].length;
	objs.forEach((o, i) => {
		offsets.push(len);
		let b;
		if (typeof o === "string") b = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, "binary");
		else b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< ${o.dict} /Length ${o.stream.length} >>\nstream\n`, "binary"), o.stream, Buffer.from("\nendstream\nendobj\n")]);
		parts.push(b);
		len += b.length;
	});
	const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${len}\n%%EOF\n`;
	parts.push(Buffer.from(xref, "binary"));
	return Buffer.concat(parts);
}

app.whenReady().then(async () => {
	const files = readdirSync(join(root, "src")).filter((f) => f.endsWith(".html") && (!only || f.includes(only)));
	for (const f of files) {
		const win = new BrowserWindow({ show: false, width: 1240, height: 1754, webPreferences: { offscreen: true } });
		await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(readFileSync(join(root, "src", f), "utf8"))}`);
		await new Promise((r) => setTimeout(r, 300));
		if (f.endsWith(".image.html")) {
			const img = await win.webContents.capturePage();
			const { width, height } = img.getSize();
			writeFileSync(join(root, f.replace(".image.html", ".pdf")), imagePdf([{ data: img.toJPEG(92), w: width, h: height }]));
		} else {
			const pdf = await win.webContents.printToPDF({ pageSize: "A4", printBackground: true, margins: { marginType: "none" } });
			writeFileSync(join(root, f.replace(".html", ".pdf")), pdf);
		}
		win.destroy();
		console.log(`fixture ${f}`);
	}
	app.quit();
});
