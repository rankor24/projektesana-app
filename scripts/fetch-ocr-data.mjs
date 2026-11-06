// Fetches the Latvian tesseract model once into resources/tessdata/ (git-ignored; packed with the app).
// Source: the tesseract.js data packages on jsdelivr (@tesseract.js-data/lav, LSTM "best_int", Apache-2.0),
// the same file tesseract.js would otherwise download at run time. Nothing is fetched when the file is already there.
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "resources", "tessdata");
const file = join(dir, "lav.traineddata.gz");
const url = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/lav/4.0.0_best_int/lav.traineddata.gz";

if (existsSync(file) && statSync(file).size > 100_000) {
	console.log(`ocr data: present (${statSync(file).size} bytes)`);
} else {
	mkdirSync(dir, { recursive: true });
	const res = await fetch(url);
	if (!res.ok) throw new Error(`ocr data: ${url} answered ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf[0] !== 0x1f || buf[1] !== 0x8b) throw new Error("ocr data: not a gzip file");
	writeFileSync(file, buf);
	console.log(`ocr data: fetched ${buf.length} bytes from ${url}`);
}
