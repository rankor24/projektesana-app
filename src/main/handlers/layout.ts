// The window layout, kept in the app's data folder (task 9.0): one JSON file, replaced whole on every write. It is the
// renderer's own state, not a project store, and is never sent to the agent. A missing or damaged file is an empty store:
// every page then uses its default layout.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyStore, parseStore, type LayoutStore, type Vp } from "../../shared/layout.js";
import type { Handlers } from "../../shared/api.js";

/** The renderer clamps to its real window; the file is read without clamping to any particular size. */
const WIDE: Vp = { w: 100000, h: 100000 };

export class LayoutFile {
	private readonly file: string;
	constructor(private readonly dir: string) {
		this.file = join(dir, "layout.json");
	}
	read(vp: Vp = WIDE): LayoutStore {
		if (!existsSync(this.file)) return emptyStore();
		try {
			return parseStore(readFileSync(this.file, "utf8"), vp);
		} catch {
			return emptyStore();
		}
	}
	write(s: LayoutStore): void {
		mkdirSync(this.dir, { recursive: true });
		const tmp = `${this.file}.tmp`;
		writeFileSync(tmp, JSON.stringify(s), "utf8");
		renameSync(tmp, this.file);
	}
}

type K = "layout.get" | "layout.set";

export function layoutHandlers(d: { settings: { dir: string } }): Pick<Handlers, K> {
	const f = new LayoutFile(d.settings.dir);
	return {
		"layout.get": () => f.read(),
		"layout.set": (s) => f.write(parseStore(JSON.stringify(s), WIDE)),
	};
}
