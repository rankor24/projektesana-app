// Durable small files for the app data folder (settings.json, projects.json): a write replaces the file whole through a
// temp file and keeps the previous version as <file>.bak; a read falls back to that .bak when the file is missing its
// content or damaged. Without this, one half-written file read as "empty" and the next save wrote the empty state over
// everything. snapshotAppData() also backs up into backups/: the small files that cannot be rebuilt as a dated copy per start (last 15),
// and the work folders (projects, library, threads, chat) as one mirror that copies only what is new or changed, so it
// stays cheap with hundreds of projects. The mirror never deletes: a project removed in the app is still there.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
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

/** Small files that cannot be rebuilt: a dated copy per start. Relative to the app data folder. */
const KEEP = ["settings.json", "projects.json", "layout.json", "agents.json", "pi-credentials.bin", "keys", join("chromium", "Local State")];
/** The work: mirrored incrementally. */
const MIRROR = ["projects", "library", "threads", "chat"];
/** Inside projects/<BD>/: extracted text and blobs are rebuilt by a scan of the office folder, so they are not copied. */
const REBUILDABLE = /[\\/]projects[\\/][^\\/]+[\\/](text|blobs)([\\/]|$)/;
const KEEP_COUNT = 15;

/** Copies new and changed files (size or mtime differs) from src to dst; files only in dst stay. */
export function mirrorTree(src: string, dst: string): number {
	let n = 0;
	const st = statSync(src);
	if (st.isDirectory()) {
		mkdirSync(dst, { recursive: true });
		for (const name of readdirSync(src)) if (!REBUILDABLE.test(join(src, name))) n += mirrorTree(join(src, name), join(dst, name));
		return n;
	}
	if (existsSync(dst)) {
		const d = statSync(dst);
		if (d.size === st.size && Math.abs(d.mtimeMs - st.mtimeMs) < 2) return 0;
	}
	copyFileSync(src, dst);
	utimesSync(dst, st.atime, st.mtime);
	return 1;
}

/** Backs up the app data folder into backups/ (see the top of this file). Never throws. */
export function snapshotAppData(dir: string, now = new Date()): string | null {
	try {
		const root = join(dir, "backups");
		const mirrored = MIRROR.filter((k) => existsSync(join(dir, k)));
		for (const k of mirrored) mirrorTree(join(dir, k), join(root, "mirror", k));
		const have = KEEP.filter((k) => existsSync(join(dir, k)));
		if (!have.length) return mirrored.length ? root : null;
		const to = join(root, now.toISOString().replace(/[:.]/g, "-"));
		for (const k of have) {
			mkdirSync(dirname(join(to, k)), { recursive: true });
			cpSync(join(dir, k), join(to, k), { recursive: true });
		}
		const all = readdirSync(root).filter((x) => x !== "mirror").sort();
		for (const old of all.slice(0, Math.max(0, all.length - KEEP_COUNT))) rmSync(join(root, old), { recursive: true, force: true });
		return to;
	} catch {
		return null;
	}
}
