// Worker thread: streams each file through SHA-256 and posts progress. The main thread never reads file bytes for hashing,
// so the window stays responsive while a network drive is read (design doc 1, cause 2: v1 hashed synchronously on main).
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

export interface HashJob {
	id: number;
	abs: string;
}

export type HashMessage = { type: "hashed"; id: number; sha256: string } | { type: "failed"; id: number; reason: string } | { type: "done" };

function sha256(abs: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const h = createHash("sha256");
		createReadStream(abs, { highWaterMark: 1 << 20 })
			.on("data", (c) => h.update(c))
			.on("error", reject)
			.on("end", () => resolve(h.digest("hex")));
	});
}

const jobs = (workerData as { jobs: HashJob[] }).jobs;
for (const j of jobs) {
	try {
		parentPort!.postMessage({ type: "hashed", id: j.id, sha256: await sha256(j.abs) } satisfies HashMessage);
	} catch (e) {
		parentPort!.postMessage({ type: "failed", id: j.id, reason: (e as Error).message } satisfies HashMessage);
	}
}
parentPort!.postMessage({ type: "done" } satisfies HashMessage);
