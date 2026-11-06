// Bytes of a source's latest file: a loose file through the guard, a file inside a container from its zip.
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { checkRead } from "../core/guard.js";
import type { ProjectStore } from "../core/store.js";

export function sourceBytes(store: ProjectStore, sourceId: string): Uint8Array {
	const s = store.read("sources").find((x) => x.id === sourceId);
	if (!s) throw new Error(`Avots ${sourceId} nav atrasts.`);
	const loose = s.paths.find((p) => !p.includes("::"));
	if (loose) {
		const g = checkRead(store.guard, loose);
		if (!g.ok) throw new Error(g.reason);
		return new Uint8Array(readFileSync(g.path));
	}
	const ref = s.container ? { path: s.container.path, inner: s.container.inner } : s.paths[0] ? { path: s.paths[0].split("::")[0], inner: s.paths[0].split("::")[1] } : null;
	if (!ref) throw new Error("Avotam vairs nav faila mapē.");
	const g = checkRead(store.guard, ref.path);
	if (!g.ok) throw new Error(g.reason);
	const inner = unzipSync(new Uint8Array(readFileSync(g.path)), { filter: (f) => f.name === ref.inner })[ref.inner];
	if (!inner) throw new Error(`Konteinerā nav ${ref.inner}`);
	return inner;
}

