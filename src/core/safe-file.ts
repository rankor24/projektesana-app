// Durable small files for the app data folder (settings.json, projects.json): a write replaces the file whole through a
// temp file and keeps the previous version as <file>.bak; a read falls back to that .bak when the file is missing its
// content or damaged. Without this, one half-written file read as "empty" and the next save wrote the empty state over
// everything. snapshotAppData() also copies the files that cannot be rebuilt into backups/, one folder per start.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function writeAtomic(file: string, text: string): void {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, text, "utf8");
	if (existsSync(file)) {
		try {
			copyFileSync(file, `${file}.bak`);
		} catch {
			// a missing backup must not stop the save
		}
	}
	renameSync(tmp, file);
}

/** Parsed JSON from the file, else from its .bak, else null. `ok` rejects a value of the wrong shape. */
export function readJson<T>(file: string, ok: (v: unknown) => boolean = () => true): T | null {
	for (const f of [file, `${file}.bak`]) {
		if (!existsSync(f)) continue;
		try {
			const v = JSON.parse(readFileSync(f, "utf8")) as unknown;
			if (ok(v)) return v as T;
		} catch {
			// try the next one
		}
	}
	return null;
}

/** What the user cannot get back by reinstalling; relative to the app data folder. */
const KEEP = ["settings.json", "projects.json", "layout.json", "agents.json", "pi-credentials.bin", "keys", join("chromium", "Local State")];
const KEEP_COUNT = 15;

/** Copies the files in KEEP into backups/<stamp>/ and drops the oldest beyond the last KEEP_COUNT. Never throws. */
export function snapshotAppData(dir: string, now = new Date()): string | null {
	try {
		const have = KEEP.filter((k) => existsSync(join(dir, k)));
		if (!have.length) return null;
		const root = join(dir, "backups");
		const stamp = now.toISOString().replace(/[:.]/g, "-");
		const to = join(root, stamp);
		for (const k of have) {
			mkdirSync(dirname(join(to, k)), { recursive: true });
			cpSync(join(dir, k), join(to, k), { recursive: true });
		}
		const all = readdirSync(root).sort();
		for (const old of all.slice(0, Math.max(0, all.length - KEEP_COUNT))) rmSync(join(root, old), { recursive: true, force: true });
		return to;
	} catch {
		return null;
	}
}
