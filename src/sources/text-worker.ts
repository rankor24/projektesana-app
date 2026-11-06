// Worker thread: reads the text layer of each job (pdfjs, docx, xlsx; a file inside an .edoc zip by its inner name).
// pdfjs runs here, not on the main thread, so a 300-page PDF does not stall the window.
import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { unzipSync } from "fflate";
import { extractBytes, type Extracted } from "./text/index.js";

export interface TextJob {
	id: number;
	abs: string;
	ext: string;
	/** name of the entry inside a zip container (.edoc) */
	inner?: string;
}

export type TextMessage = { type: "text"; id: number; result: Extracted } | { type: "done" };

const jobs = (workerData as { jobs: TextJob[] }).jobs;
for (const j of jobs) {
	let result: Extracted;
	try {
		let bytes = new Uint8Array(readFileSync(j.abs));
		if (j.inner) {
			const inner = j.inner;
			const entry = unzipSync(bytes, { filter: (f) => f.name === inner })[inner];
			if (!entry) throw new Error(`Konteinerā nav ${inner}`);
			bytes = entry;
		}
		result = await extractBytes(j.ext, bytes);
	} catch (e) {
		result = { state: "error", pages: [], reason: (e as Error).message };
	}
	parentPort!.postMessage({ type: "text", id: j.id, result } satisfies TextMessage);
}
parentPort!.postMessage({ type: "done" } satisfies TextMessage);
