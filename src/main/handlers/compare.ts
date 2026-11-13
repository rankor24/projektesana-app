// Comparisons for the preview: sheets (two PDFs: sources or files of the project) and models (two IFCs: project files or
// revisions). Refs: "src:<sourceId>", "rev:<revisionId>", or a path relative to the project folder.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkRead } from "../../core/guard.js";
import type { Registry } from "../../core/registry.js";
import type { ProjectStore } from "../../core/store.js";
import type { Handlers } from "../../shared/api.js";
import { sourceBytes } from "../../sources/bytes.js";
import { versionsBetween } from "../../core/versions.js";
import { findingOfTopic, findingsToBcf, readBcfFile } from "../../checks/bcf.js";
import { checkWrite } from "../../core/guard.js";
import { listModels } from "../../sources/models.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { diffIfc } from "../../sources/ifc-diff.js";
import { bimcraftStatus } from "../bimcraft-status.js";
import { pairPages, diffPages, readSheet, whereOnA } from "../../sources/sheets/vector-diff.js";

type K = "sheets.bytes" | "sheets.diff" | "models.diff" | "versions.between" | "bcf.export" | "bcf.import" | "bimcraft.status";

export function refBytes(store: ProjectStore, ref: string, ext: RegExp): Uint8Array {
	if (ref.startsWith("src:")) return sourceBytes(store, ref.slice(4));
	if (ref.startsWith("blob:")) {
		if (!/^blob:[0-9a-f]{64}$/.test(ref)) throw new Error("Nederīga atsauce.");
		return new Uint8Array(readFileSync(join(store.dir, "blobs", `${ref.slice(5)}.pdf`)));
	}
	if (ref.startsWith("rev:")) {
		const r = store.read("revisions").find((x) => x.id === ref.slice(4));
		if (!r?.ifc) throw new Error(`Revīzijai ${ref.slice(4)} nav IFC.`);
		const g = checkRead(store.guard, join(store.dir, r.ifc));
		if (!g.ok) throw new Error(g.reason);
		return new Uint8Array(readFileSync(g.path));
	}
	const g = checkRead(store.guard, ref);
	if (!g.ok) throw new Error(g.reason);
	if (!ext.test(g.path)) throw new Error(`Nepareizs faila veids: ${ref}`);
	return new Uint8Array(readFileSync(g.path));
}

export function compareHandlers(d: { registry: Registry; bimcraftApp: string; openPath(p: string): Promise<string> }): Pick<Handlers, K> {
	return {
		"bcf.export": async (id, ids) => {
			const store = d.registry.store(id);
			const all = store.read("findings");
			const pick = ids ? all.filter((f) => ids.includes(f.id)) : all.filter((f) => f.state !== "closed");
			if (!pick.length) throw new Error("Nav atradumu eksportam.");
			const models = await listModels(store.project.root);
			const bytes = await findingsToBcf(d.bimcraftApp, pick, store.read("requirements"), models[0] ? { name: models[0].name } : null);
			const file = join(store.dir, "exports", `${id}_atradumi_${new Date().toISOString().slice(0, 10)}.bcf`);
			const g = checkWrite(store.guard, file);
			if (!g.ok) throw new Error(g.reason);
			mkdirSync(join(store.dir, "exports"), { recursive: true });
			writeFileSync(g.path, bytes);
			store.log({ kind: "bcf.exported", by: "user", data: { topics: pick.length } });
			await d.openPath(join(store.dir, "exports"));
			return g.path;
		},
		"bcf.import": async (id, file) => {
			const store = d.registry.store(id);
			if (!/\.bcf(zip)?$/i.test(file)) throw new Error("Tikai .bcf / .bcfzip.");
			const models = await listModels(store.project.root);
			const r = await readBcfFile(d.bimcraftApp, new Uint8Array(readFileSync(file)), models.map((m) => m.name));
			const incoming = r.topics.map((t) => findingOfTopic(t));
			store.update("findings", (all) => [...all.filter((f) => !incoming.some((x) => x.key === f.key)), ...incoming], { kind: "bcf.imported", by: "user", data: { topics: incoming.length } });
			return { topics: incoming.length, byDiscipline: r.byDiscipline, notes: r.notes };
		},
		"sheets.bytes": (id, ref) => refBytes(d.registry.store(id), ref, /\.pdf$/i),
		"sheets.diff": async (id, a, b) => {
			const store = d.registry.store(id);
			const [pa, pb] = await Promise.all([readSheet(refBytes(store, a, /\.pdf$/i)), readSheet(refBytes(store, b, /\.pdf$/i))]);
			return pairPages(pa, pb).map(([x, y]) => {
				const r = diffPages(x, y);
				return { a: r.a, b: r.b, sheetNo: r.sheetNo, summary: r.summary, where: r.changes.map((c) => whereOnA(c, x)), frameA: x.frame, frameB: y.frame };
			});
		},
		"versions.between": (id, from, to) => versionsBetween(d.registry.store(id), from, to),
		"bimcraft.status": () => bimcraftStatus(d.bimcraftApp),
		"models.diff": (id, a, b) => {
			const store = d.registry.store(id);
			return diffIfc(d.bimcraftApp, refBytes(store, a, /\.ifc$/i), refBytes(store, b, /\.ifc$/i));
		},
	};
}
