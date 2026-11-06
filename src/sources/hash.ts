// Runs the hash worker over a list of files. Files whose size and mtime match a known version reuse its hash (a re-scan of
// an unchanged network folder reads no bytes). Progress arrives in file order.
import { Worker } from "node:worker_threads";
import type { HashJob, HashMessage } from "./hash-worker.js";

export interface HashInput {
	abs: string;
	rel: string;
	size: number;
	mtimeMs: number;
}

export interface HashOutput extends HashInput {
	folderKey: string;
	sha256: string | null;
	error?: string;
	cached: boolean;
}

export type Known = (rel: string, size: number, mtimeMs: number) => string | null;

/** The worker file next to this one: .ts under tsx (tests), .js in the built app. */
const workerUrl = () => new URL(import.meta.url.endsWith(".ts") ? "./hash-worker.ts" : "./hash-worker.js", import.meta.url);

export async function hashFiles(files: (HashInput & { folderKey: string })[], known: Known, onProgress?: (done: number, total: number, current: string) => void): Promise<HashOutput[]> {
	const out: HashOutput[] = files.map((f) => {
		const sha = known(f.rel, f.size, f.mtimeMs);
		return { ...f, sha256: sha, cached: !!sha };
	});
	const todo = out.map((f, id) => ({ f, id })).filter((x) => !x.f.cached);
	let done = out.length - todo.length;
	onProgress?.(done, out.length, "");
	if (!todo.length) return out;
	await new Promise<void>((resolve, reject) => {
		const jobs: HashJob[] = todo.map((x) => ({ id: x.id, abs: x.f.abs, size: x.f.size }));
		const w = new Worker(workerUrl(), { workerData: { jobs } });
		w.on("message", (m: HashMessage) => {
			if (m.type === "done") return void w.terminate().then(() => resolve());
			const f = out[m.id];
			if (m.type === "hashed") f.sha256 = m.sha256;
			else f.error = m.reason;
			onProgress?.(++done, out.length, f.rel);
		});
		w.on("error", reject);
		w.on("exit", (code) => (code !== 0 && code !== 1 ? reject(new Error(`hash worker exited ${code}`)) : undefined));
	});
	return out;
}
