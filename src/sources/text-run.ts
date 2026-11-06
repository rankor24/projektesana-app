// Runs the text worker over a list of jobs; results arrive in job order through onResult.
import { Worker } from "node:worker_threads";
import type { Extracted } from "./text/index.js";
import type { TextJob, TextMessage } from "./text-worker.js";

const workerUrl = () => new URL(import.meta.url.endsWith(".ts") ? "./text-worker.ts" : "./text-worker.js", import.meta.url);

export function readTexts(jobs: TextJob[], onResult: (job: TextJob, r: Extracted) => void): Promise<void> {
	if (!jobs.length) return Promise.resolve();
	const byId = new Map(jobs.map((j) => [j.id, j]));
	return new Promise((resolve, reject) => {
		const w = new Worker(workerUrl(), { workerData: { jobs } });
		w.on("message", (m: TextMessage) => {
			if (m.type === "done") return void w.terminate().then(() => resolve());
			onResult(byId.get(m.id)!, m.result);
		});
		w.on("error", reject);
	});
}
