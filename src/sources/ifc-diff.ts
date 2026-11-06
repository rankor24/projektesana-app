// What changed between two IFC files, element by element through their GlobalIds — BimCraft's own compareModels
// (getcadcraft/bimcraft app/ifc-compare.js) on BimCraft's own IFC engine, loaded at run time from the synced copy
// (resources/bimcraft/app). Used for the revision summary (6.2) and the compare panel's numbers (5.2); the painting is done
// by BimCraft in the preview. No IFC code of our own.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface IfcDiff {
	added: string[];
	removed: string[];
	changed: { guid: string; props: string[]; moved: number; reshaped: boolean }[];
	same: number;
	dupes: number;
}

type Engine = { WebIFC: unknown; IfcModel: { create(W: unknown, wasm: null, o: object): Promise<{ load(b: Uint8Array): Promise<unknown>; api: unknown; modelID: number; close(): void }> }; propertyIndex: (W: unknown, api: unknown, mid: number, model: unknown) => { keyBase?: number }; compareModels: (A: unknown, B: unknown, o?: object) => { added: number[]; removed: number[]; changed: { guid: string; props: { field: string }[]; moved: number; reshaped: boolean }[]; same: number; dupes: string[] } };

const engines = new Map<string, Promise<Engine>>();

function engine(appDir: string): Promise<Engine> {
	let e = engines.get(appDir);
	if (!e) {
		e = (async () => {
			(globalThis as { document?: unknown }).document ??= { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
			const imp = (f: string) => import(pathToFileURL(join(appDir, f)).href);
			const i18n = await imp("i18n.js");
			i18n.init({ locale: "en", strings: JSON.parse(readFileSync(join(appDir, "lang", "en.json"), "utf8")) });
			const WebIFC = await imp("ifc/api.js");
			const { IfcModel } = await imp("ifc-model.js");
			const { propertyIndex } = await imp("ifc-props.js");
			const { compareModels } = await imp("ifc-compare.js");
			return { WebIFC, IfcModel, propertyIndex, compareModels } as Engine;
		})();
		engines.set(appDir, e);
	}
	return e;
}

/** a = older, b = newer. */
export async function diffIfc(appDir: string, a: Uint8Array, b: Uint8Array): Promise<IfcDiff> {
	const E = await engine(appDir);
	const side = async (bytes: Uint8Array) => {
		const m = await E.IfcModel.create(E.WebIFC, null, {});
		const model = await m.load(bytes);
		return { m, model, ix: E.propertyIndex(E.WebIFC, m.api, m.modelID, model) };
	};
	const A = await side(a);
	const B = await side(b);
	try {
		const r = E.compareModels({ ix: A.ix, model: A.model, matrix: null }, { ix: B.ix, model: B.model, matrix: null });
		const guidOf = (s: typeof A, key: number) => {
			const id = key - (s.ix.keyBase ?? 0);
			const l = (s.m.api as { GetLine(mid: number, id: number, f: boolean): { GlobalId?: { value?: string } } | null }).GetLine(s.m.modelID, id, false);
			return l?.GlobalId?.value ?? String(id);
		};
		return {
			added: r.added.map((k) => guidOf(B, k)),
			removed: r.removed.map((k) => guidOf(A, k)),
			changed: r.changed.map((c) => ({ guid: c.guid, props: c.props.map((p) => p.field), moved: c.moved, reshaped: c.reshaped })),
			same: r.same,
			dupes: r.dupes.length,
		};
	} finally {
		A.m.close();
		B.m.close();
	}
}
