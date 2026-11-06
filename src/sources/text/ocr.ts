// OCR of page images with tesseract.js and the Latvian model (lav, LSTM best_int; scripts/fetch-ocr-data.mjs puts it in
// resources/tessdata). tesseract.js runs its engine in a worker thread, so recognition does not stall the main process.
// Windows has no Latvian OCR pack (DISM: Language.OCR~~~lv-LV does not exist), which is why this is not Windows OCR.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createWorker, OEM, type Worker } from "tesseract.js";

export interface OcrPage {
	text: string;
	/** tesseract's mean word confidence, 0–100 */
	confidence: number;
}

export class Ocr {
	private worker: Promise<Worker> | null = null;

	/** @param langDir folder holding lav.traineddata.gz */
	constructor(private langDir: string) {}

	available(): boolean {
		return existsSync(join(this.langDir, "lav.traineddata.gz")) || existsSync(join(this.langDir, "lav.traineddata"));
	}

	private start(): Promise<Worker> {
		if (!this.available()) return Promise.reject(new Error(`Latviešu OCR modelis nav atrasts: ${this.langDir} (npm run build to ielādē)`));
		return (this.worker ??= createWorker("lav", OEM.LSTM_ONLY, {
			langPath: this.langDir,
			cachePath: this.langDir,
			gzip: existsSync(join(this.langDir, "lav.traineddata.gz")),
			// the model is local: never reach the network for it
			cacheMethod: "none",
		}));
	}

	async recognize(image: Uint8Array): Promise<OcrPage> {
		const w = await this.start();
		const r = await w.recognize(Buffer.from(image));
		return { text: r.data.text.replace(/[ \t]+\n/g, "\n").trim(), confidence: r.data.confidence };
	}

	async close(): Promise<void> {
		const w = this.worker;
		this.worker = null;
		if (w) await (await w).terminate();
	}
}
