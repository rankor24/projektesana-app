// The Faili tab (task 8.3): the project's folders and files, read-only. Three roots: the office folder, the drafts' staging
// folders and the project's own data (exports, notes, revisions). Opening a file hands it to the PC's own program; the
// preview opens registered sources and IFC from the renderer. Nothing here writes.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Registry } from "../../core/registry.js";
import type { ProjectStore } from "../../core/store.js";
import type { FileRoot, Handlers, ScanSummaryRow } from "../../shared/api.js";
import { buildOverlay, insideBase, listDirectory, searchTree } from "../../sources/tree.js";

type K = "files.roots" | "files.list" | "files.search" | "files.open";

export const rootDir = (store: ProjectStore, key: FileRoot["key"]): string => (key === "projekts" ? store.project.root : key === "uzmetumi" ? join(store.dir, "nodevumi") : store.dir);

export function fileHandlers(d: { registry: Registry; openPath(p: string): Promise<string> }): Pick<Handlers, K> {
	const overlay = (store: ProjectStore, key: FileRoot["key"]) => (key === "projekts" ? buildOverlay(store.project.root, store.read("sources"), store.readMeta<ScanSummaryRow | null>("scan", null)?.folders ?? []) : undefined);
	return {
		"files.roots": (id) => {
			const store = d.registry.store(id);
			return (
				[
					["projekts", "Projekta mape (birojs, tikai lasāms)"],
					["uzmetumi", "Nodevumu uzmetumi"],
					["dati", "Lietotnes dati šim projektam"],
				] as const
			).map(([key, label]) => ({ key, label, exists: existsSync(rootDir(store, key)) }));
		},
		"files.list": async (id, root, rel) => {
			const store = d.registry.store(id);
			const base = rootDir(store, root);
			if (!existsSync(base)) throw new Error(`Mape nav pieejama: ${base}`);
			return listDirectory(base, rel, overlay(store, root));
		},
		"files.search": async (id, root, q) => {
			const store = d.registry.store(id);
			const base = rootDir(store, root);
			if (!existsSync(base)) throw new Error(`Mape nav pieejama: ${base}`);
			return searchTree(base, q, overlay(store, root));
		},
		"files.open": async (id, root, rel) => {
			const store = d.registry.store(id);
			const base = rootDir(store, root);
			// a file inside a container opens the container: the PC's program cannot open a part of a zip
			const abs = insideBase(base, rel.split("::")[0]);
			if (!abs || !existsSync(abs)) throw new Error(`Faila nav: ${rel}`);
			const err = await d.openPath(abs);
			if (err) throw new Error(err);
		},
	};
}
