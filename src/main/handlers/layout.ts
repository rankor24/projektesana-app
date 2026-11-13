// The window layout, kept in the app's data folder (task 9.0): one JSON file, replaced whole on every write. It is the
// renderer's own state, not a project store, and is never sent to the agent. A missing or damaged file is an empty store:
// every page then uses its default layout.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyStore, parseStore, type LayoutStore, type Vp } from "../../shared/layout.js";
import type { EventName, EventSpec, Handlers } from "../../shared/api.js";
import { checkRelay } from "../../shared/popout.js";
import type { PopoutManager } from "../windows.js";

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

type K = "layout.get" | "layout.set" | "layout.popOut" | "layout.popIn" | "layout.relay";

export function layoutHandlers(d: { settings: { dir: string }; emit?: <E extends EventName>(event: E, payload: EventSpec[E]) => void; popouts?: PopoutManager }): Pick<Handlers, K> {
	const f = new LayoutFile(d.settings.dir);
	const mgr = () => {
		if (!d.popouts) throw new Error("Šajā palaišanā logus nevar iznest.");
		return d.popouts;
	};
	return {
		"layout.get": () => f.read(),
		"layout.set": (s, origin) => {
			const clean = parseStore(JSON.stringify(s), WIDE);
			f.write(clean);
			// one store for every window: the others adopt what was saved
			d.emit?.("layout.changed", { store: clean, origin: typeof origin === "string" ? origin : "" });
		},
		"layout.popOut": (id) => void mgr().popOut(id),
		"layout.popIn": (id) => void mgr().popIn(id),
		"layout.relay": (msg) => {
			const bad = checkRelay(msg);
			if (bad) throw new Error(bad);
			d.emit?.("layout.relay", { msg });
		},
	};
}
