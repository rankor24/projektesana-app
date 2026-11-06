// Worker thread: streams each file through SHA-256 and posts progress. The main thread never reads file bytes for hashing,
// so the window stays responsive while a network drive is read (design doc 1, cause 2: v1 hashed synchronously on main).
//
// Big binaries (point clouds, models, anything over FAST_OVER bytes) get a fast identity instead of a full hash:
// SHA-256 of size + first 4 MB + last 4 MB, written as "q:<hex>". Found on a real project: 12 point-cloud files of 84 GB
// in 1.1.09 on the office network share would have been read end to end. Their content is never read as text, and
// two copies of the same scan still get the same identity.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

export interface HashJob {
	id: number;
	abs: string;
	size: number;
}

export type HashMessage = { type: "hashed"; id: number; sha256: string } | { type: "failed"; id: number; reason: string } | { type: "done" };

export const FAST_OVER = 256 * 1024 * 1024;
const EDGE = 4 * 1024 * 1024;
export const FAST_EXT = /\.(e57|las|laz|rcp|rcs|pts|ptx|xyz|ply|rvt|rfa|nwd|nwc|dwg|zip|7z|rar|mp4|mov|avi|iso)$/i;

function fullHash(abs: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const h = createHash("sha256");
		createReadStream(abs, { highWaterMark: 1 << 20 })
			.on("data", (c) => h.update(c))
			.on("error", reject)
			.on("end", () => resolve(h.digest("hex")));
	});
}

async function fastHash(abs: string, size: number): Promise<string> {
	const fh = await open(abs, "r");
	try {
		const h = createHash("sha256").update(`size:${size};`);
		const head = Buffer.alloc(Math.min(EDGE, size));
		await fh.read(head, 0, head.length, 0);
		h.update(head);
		if (size > EDGE) {
			const tail = Buffer.alloc(Math.min(EDGE, size - EDGE));
			await fh.read(tail, 0, tail.length, size - tail.length);
			h.update(tail);
		}
		return `q:${h.digest("hex")}`;
	} finally {
		await fh.close();
	}
}

export const useFast = (abs: string, size: number) => size > FAST_OVER || (FAST_EXT.test(abs) && size > 2 * EDGE);

const jobs = (workerData as { jobs?: HashJob[] } | null)?.jobs;
if (jobs && parentPort) {
	for (const j of jobs) {
		try {
			const sha256 = useFast(j.abs, j.size) ? await fastHash(j.abs, j.size) : await fullHash(j.abs);
			parentPort.postMessage({ type: "hashed", id: j.id, sha256 } satisfies HashMessage);
		} catch (e) {
			parentPort.postMessage({ type: "failed", id: j.id, reason: (e as Error).message } satisfies HashMessage);
		}
	}
	parentPort.postMessage({ type: "done" } satisfies HashMessage);
}
