// App-level list of projects: BD code → office folder. Carried from v1 src/kernel/registry.ts (roots only) and extended:
// the BD code is parsed from the folder name and is the project's id; adding a project creates its data folder.
// Forgetting a project removes it from this list only. Neither the office folder nor the data folder is ever touched.
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { bdCodeOf, type Project } from "./model.js";
import { readJson, writeAtomic } from "./safe-file.js";
import { ProjectStore } from "./store.js";

export class Registry {
	constructor(
		private file: string,
		private projectsDir: string,
	) {}

	list(): Project[] {
		const v = readJson<Project[]>(this.file, Array.isArray);
		return (v ?? []).filter((p) => p && typeof p.id === "string" && typeof p.root === "string");
	}

	private save(l: Project[]) {
		writeAtomic(this.file, JSON.stringify(l, null, 1));
	}

	get(id: string): Project {
		const p = this.list().find((x) => x.id === id);
		if (!p) throw new Error(`Projekts ${id} nav sarakstā.`);
		return p;
	}

	/** Adds the office folder of a project. The folder name must start with its BD code. */
	add(root: string, now = new Date()): Project {
		const r = resolve(root);
		if (!existsSync(r)) throw new Error(`Mape nav atrasta: ${r}`);
		const id = bdCodeOf(basename(r));
		if (!id) throw new Error(`Mapes nosaukumā nav BD koda (piemēram, "BD427 …"): ${basename(r)}`);
		const all = this.list();
		const same = all.find((p) => p.id === id);
		if (same && resolve(same.root).toLowerCase() !== r.toLowerCase()) throw new Error(`${id} jau ir sarakstā ar citu mapi: ${same.root}`);
		if (same) return same;
		const p: Project = { id, name: basename(r), root: r, createdAt: now.toISOString() };
		ProjectStore.open(this.projectsDir, p);
		this.save([...all, p]);
		return p;
	}

	/** Removes the project from the list. Its data folder and its office folder stay as they are. */
	forget(id: string): void {
		this.save(this.list().filter((p) => p.id !== id));
	}

	store(id: string): ProjectStore {
		return ProjectStore.open(this.projectsDir, this.get(id));
	}
}
