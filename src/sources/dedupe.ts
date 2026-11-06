// Turns hashed files into Sources. Same bytes = one Source with several paths (v1 listed the same PDF twice under two
// names — design doc 1, cause 5). A path whose bytes changed keeps its Source and gains a Version. Pure: no I/O.
import { basename, extname } from "node:path";
import type { Source, Version } from "../core/model.js";
import type { HashOutput } from "./hash.js";
import type { FolderInfo, ScannedSurvey } from "./scan.js";

const titleOf = (rel: string) => basename(rel, extname(rel));
const iso = (ms: number) => new Date(ms).toISOString();
const latest = (s: Source) => s.versions[s.versions.length - 1];

export interface MergeResult {
	sources: Source[];
	added: string[];
	changed: string[];
	/** sources none of whose paths were found this time */
	gone: string[];
}

export function mergeSources(prev: Source[], files: HashOutput[], surveys: ScannedSurvey[], folders: FolderInfo[], now = new Date()): MergeResult {
	const seenAt = now.toISOString();
	const roleOf = (key: string) => folders.find((f) => f.folderKey === key);
	const docs = prev.filter((s) => s.kind === "document" && !s.container);
	const inner = prev.filter((s) => s.container);
	const byPath = new Map<string, Source>();
	for (const s of docs) for (const p of s.paths) byPath.set(p.toLowerCase(), s);
	const bySha = new Map<string, Source>();
	for (const s of docs) for (const v of s.versions) bySha.set(v.sha256, s);

	// group the hashed files by content
	const groups = new Map<string, HashOutput[]>();
	for (const f of files) {
		if (!f.sha256) continue;
		const g = groups.get(f.sha256) ?? [];
		g.push(f);
		groups.set(f.sha256, g);
	}

	const next = new Map<string, Source>();
	const added: string[] = [];
	const changed: string[] = [];
	for (const [sha, group] of groups) {
		const paths = group.map((g) => g.rel).sort((a, b) => a.localeCompare(b, "lv"));
		// same content seen before → that source; else a path seen before → that source gets a new version
		const existing = bySha.get(sha) ?? paths.map((p) => byPath.get(p.toLowerCase())).find((s) => s && !next.has(s.id));
		const first = group[0];
		const version: Version = { sha256: sha, size: first.size, mtime: iso(first.mtimeMs), seenAt, textState: "pending" };
		const info = roleOf(first.folderKey);
		const role = info?.role ?? "Cits";
		const roleFrom = info?.roleFrom ?? "unconfirmed";
		if (existing && !next.has(existing.id)) {
			// `<container>::<inner>` references stay while their container is still there (containers are not reopened on every scan)
			const present = new Set(files.map((f) => f.rel.toLowerCase()));
			const refs = existing.paths.filter((p) => p.includes("::") && present.has(p.split("::")[0].toLowerCase()));
			const s: Source = { ...existing, paths: [...paths, ...refs], folderKey: first.folderKey, role, roleFrom, title: titleOf(paths[0]) };
			if (latest(existing)?.sha256 !== sha) {
				const known = existing.versions.find((v) => v.sha256 === sha);
				s.versions = known ? [...existing.versions.filter((v) => v.sha256 !== sha), { ...known, seenAt }] : [...existing.versions, version];
				changed.push(s.id);
			} else s.versions = existing.versions.map((v, i, a) => (i === a.length - 1 ? { ...v, seenAt } : v));
			next.set(s.id, s);
		} else {
			const id = `s_${sha.slice(0, 12)}`;
			if (next.has(id)) continue;
			next.set(id, { id, kind: "document", folderKey: first.folderKey, paths, title: titleOf(paths[0]), role, roleFrom, versions: [version], signers: [] });
			added.push(id);
		}
	}

	// files that could not be hashed stay visible with their error
	for (const f of files.filter((x) => !x.sha256)) {
		const id = `s_err_${Buffer.from(f.rel.toLowerCase()).toString("base64url").slice(0, 16)}`;
		const info = roleOf(f.folderKey);
		next.set(id, { id, kind: "document", folderKey: f.folderKey, paths: [f.rel], title: titleOf(f.rel), role: info?.role ?? "Cits", roleFrom: info?.roleFrom ?? "unconfirmed", versions: [{ sha256: "", size: f.size, mtime: iso(f.mtimeMs), seenAt, textState: "error", textReason: f.error }], signers: [] });
	}

	for (const sv of surveys) {
		const id = `ff_${Buffer.from(sv.rel.toLowerCase()).toString("base64url").slice(-20)}`;
		const info = roleOf(sv.folderKey);
		next.set(id, {
			id,
			kind: "photoSurvey",
			folderKey: sv.folderKey,
			paths: [sv.rel],
			title: basename(sv.rel),
			role: info?.role ?? "Fotofiksācija",
			roleFrom: info?.roleFrom ?? "folder",
			versions: [{ sha256: "", size: sv.bytes, mtime: iso(sv.latestMtimeMs || now.getTime()), seenAt, textState: "unsupported", textReason: "fotofiksācija" }],
			signers: [],
			survey: { date: sv.date, count: sv.images + sv.videos, folder: sv.rel },
		});
	}

	// inner files of a container stay while their container stays
	for (const s of inner) {
		const parent = [...next.values()].find((p) => p.paths.some((x) => x.toLowerCase() === s.container!.path.toLowerCase()));
		if (parent) next.set(s.id, { ...s, folderKey: parent.folderKey, role: parent.role, roleFrom: parent.roleFrom });
	}

	const gone = prev.filter((s) => !next.has(s.id) && s.kind !== "law").map((s) => s.id);
	// a source whose files are gone keeps its history, with no paths
	for (const id of gone) {
		const s = prev.find((x) => x.id === id)!;
		next.set(id, { ...s, paths: [] });
	}
	return { sources: [...next.values()], added, changed, gone };
}
