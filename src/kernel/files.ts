// File registry (spec §8). Source files are registered by SHA-256 and never written.
// A source that changed on disk is flagged and registered as a new version; the original stays as it was.
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { appendLog } from "./log.js";
import { checkRead } from "./guard.js";

export interface FileVersion {
	sha256: string;
	size: number;
	at: string;
}

export interface FileRecord {
	/** relative to project root, forward slashes */
	path: string;
	role?: string;
	/** Why the role was proposed (verbatim words) and by whom. `confirmed` only when a person set or confirmed it. */
	roleSource?: { by: string; quote: string; confirmed: boolean };
	status: "ok" | "changed" | "missing";
	versions: FileVersion[];
}

const filesJson = (root: string) => join(root, ".bv", "files.json");

export function loadFiles(root: string): FileRecord[] {
	const p = filesJson(root);
	if (!existsSync(p)) return [];
	return (JSON.parse(readFileSync(p, "utf8")) as { files: FileRecord[] }).files;
}

function saveFiles(root: string, files: FileRecord[]) {
	writeFileSync(filesJson(root), JSON.stringify({ files }, null, 2), "utf8");
}

export function hashFile(abs: string): FileVersion {
	const buf = readFileSync(abs);
	return { sha256: createHash("sha256").update(buf).digest("hex"), size: buf.length, at: new Date().toISOString() };
}

const BLOB_MAX = 100 * 1024 * 1024;

/** Keeps a copy of each version's bytes under .bv/blobs so a later diff has both sides. Never overwrites. */
function storeBlob(root: string, abs: string, v: FileVersion) {
	if (v.size > BLOB_MAX) return;
	const dir = join(root, ".bv", "blobs");
	mkdirSync(dir, { recursive: true });
	const target = join(dir, `${v.sha256}${extname(abs).toLowerCase()}`);
	if (!existsSync(target)) copyFileSync(abs, target, constants.COPYFILE_EXCL);
}

/** Path of the stored bytes of one version, or null when it was too large to keep. */
export function versionBlob(root: string, path: string, index: number): string | null {
	const f = loadFiles(root).find((x) => x.path === path);
	const v = f?.versions[index];
	if (!f || !v) return null;
	const p = join(root, ".bv", "blobs", `${v.sha256}${extname(f.path).toLowerCase()}`);
	return existsSync(p) ? p : null;
}

const rel = (root: string, abs: string) => relative(resolve(root), abs).split("\\").join("/");

/** Registers a file once; registering it again returns the existing record. */
export function registerFile(root: string, raw: string, role?: string): FileRecord {
	const g = checkRead({ root }, raw);
	if (!g.ok) throw new Error(g.reason);
	if (!existsSync(g.path) || !statSync(g.path).isFile()) throw new Error(`Fails nav atrasts: ${g.path}`);
	const files = loadFiles(root);
	const key = rel(root, g.path);
	const hit = files.find((f) => f.path === key);
	if (hit) return hit;
	const rec: FileRecord = { path: key, role, status: "ok", versions: [hashFile(g.path)] };
	storeBlob(root, g.path, rec.versions[0]);
	saveFiles(root, [...files, rec]);
	appendLog(root, { kind: "file.registered", by: "app", data: { path: key, sha256: rec.versions[0].sha256, role: role ?? null } });
	return rec;
}

/** Re-hashes every registered file. Changed ones get a new version and status `changed`. */
export function rescan(root: string): FileRecord[] {
	const files = loadFiles(root);
	for (const f of files) {
		const abs = join(root, f.path);
		if (!existsSync(abs)) {
			if (f.status !== "missing") appendLog(root, { kind: "file.missing", by: "app", data: { path: f.path } });
			f.status = "missing";
			continue;
		}
		const h = hashFile(abs);
		const last = f.versions[f.versions.length - 1];
		if (h.sha256 !== last.sha256) {
			f.versions.push(h);
			storeBlob(root, abs, h);
			f.status = "changed";
			appendLog(root, { kind: "file.changed", by: "app", data: { path: f.path, from: last.sha256, to: h.sha256, version: f.versions.length } });
		}
	}
	saveFiles(root, files);
	return files;
}

/** Boris confirms (or changes) a file's role. The file itself is not touched. */
export function setRole(root: string, path: string, role: string, by = "boris") {
	const files = loadFiles(root);
	const f = files.find((x) => x.path === path);
	if (!f) throw new Error(`Nav reģistrēts: ${path}`);
	const was = f.role ?? null;
	f.role = role;
	f.roleSource = { by, quote: f.roleSource?.quote ?? "", confirmed: true };
	saveFiles(root, files);
	appendLog(root, { kind: "file.role", by, data: { path, from: was, to: role } });
	return f;
}

/**
 * The app or the agent proposes a role with the words that justify it. A role a person already set or confirmed is
 * never replaced; the proposal waits until Boris confirms it (`confirmRole`) or sets another.
 */
export function proposeRoleFor(root: string, path: string, role: string, quote: string, by: string): FileRecord {
	const files = loadFiles(root);
	const f = files.find((x) => x.path === path);
	if (!f) throw new Error(`Nav reģistrēts: ${path}`);
	if (f.roleSource?.confirmed) return f;
	f.role = role;
	f.roleSource = { by, quote, confirmed: false };
	saveFiles(root, files);
	appendLog(root, { kind: "file.role.proposed", by, data: { path, role, quote } });
	return f;
}

/** A rescan with better rules found no role: an unconfirmed guess is withdrawn, a confirmed role stays. */
export function dropProposedRole(root: string, path: string): void {
	const files = loadFiles(root);
	const f = files.find((x) => x.path === path);
	if (!f || !f.roleSource || f.roleSource.confirmed) return;
	delete f.role;
	delete f.roleSource;
	saveFiles(root, files);
}

export function confirmRole(root: string, path: string, by = "boris"): FileRecord {
	const files = loadFiles(root);
	const f = files.find((x) => x.path === path);
	if (!f?.role) throw new Error(`Failam nav lomas: ${path}`);
	f.roleSource = { by, quote: f.roleSource?.quote ?? "", confirmed: true };
	saveFiles(root, files);
	appendLog(root, { kind: "file.role.confirmed", by, data: { path, role: f.role } });
	return f;
}

/** The user has looked at a changed file; it counts as the current version again. */
export function acknowledgeChange(root: string, path: string) {
	const files = loadFiles(root);
	const f = files.find((x) => x.path === path);
	if (!f) throw new Error(`Nav reģistrēts: ${path}`);
	f.status = "ok";
	saveFiles(root, files);
	appendLog(root, { kind: "file.change.acknowledged", by: "boris", data: { path } });
}

/** Next free `name_vN.ext` in outDir. Never overwrites: the file is created with the `wx` flag. */
export function writeVersion(root: string, srcRaw: string, content: string | Buffer, outRaw: string): string {
	const src = checkRead({ root }, srcRaw);
	const out = checkRead({ root }, outRaw);
	if (!src.ok) throw new Error(src.reason);
	if (!out.ok) throw new Error(out.reason);
	mkdirSync(out.path, { recursive: true });
	const ext = extname(src.path);
	const stem = basename(src.path, ext).replace(/_v\d+$/, "");
	for (let n = 2; n < 10_000; n++) {
		const target = join(out.path, `${stem}_v${n}${ext}`);
		try {
			writeFileSync(target, content, { flag: "wx" });
			appendLog(root, { kind: "file.version.written", by: "app", data: { from: rel(root, src.path), to: rel(root, target) } });
			return target;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
		}
	}
	throw new Error("Pārāk daudz versiju.");
}

export { dirname };
