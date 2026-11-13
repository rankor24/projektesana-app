// BimCraft's own IFC engine (the synced copy in resources/bimcraft/app), loaded once per folder for the readers that look inside
// an IFC without showing it: the model's facts (8.9) and the sheet-to-element trace (8.11). No IFC parsing of our own. The API
// opens a model lazily — an index of the file, no geometry until an element's mesh is asked for.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface IfcLine {
	[attribute: string]: { value?: unknown } | { value?: unknown }[] | undefined;
}

export interface IfcApi {
	Init(o?: object): Promise<unknown>;
	OpenModel(b: Uint8Array, s?: object): number;
	CloseModel(m: number): void;
	GetLine(m: number, id: number, flat: boolean): IfcLine | null;
	GetWorldTransformMatrix(m: number, placement: number): number[];
}

export interface IfcEngine {
	IfcAPI: new () => IfcApi;
	/** express ids of a class by its upper-case name; `inherited` also takes its subclasses */
	ids: (api: IfcApi, mid: number, cls: string, inherited?: boolean) => number[];
	/** the plain value of an attribute (a wrapped IfcLabel, a number, null) */
	val: (v: unknown) => unknown;
	/** millimetres per length unit of the file */
	lengthUnitMm: (api: IfcApi, mid: number) => number;
	/** every placed triangle of a product, in the file's length unit and Z up */
	productTriangles: (api: IfcApi, mid: number, id: number, unitMm: number, ci?: number[] | null) => { positions: number[]; indices: number[] };
}

const engines = new Map<string, Promise<IfcEngine>>();

export function loadEngine(appDir: string): Promise<IfcEngine> {
	let e = engines.get(appDir);
	if (!e) {
		e = (async () => {
			(globalThis as { document?: unknown }).document ??= { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
			const imp = (f: string) => import(pathToFileURL(join(appDir, f)).href);
			// the shell's strings are needed by a few of its helpers; the same language file the compare uses
			const i18n = await imp("i18n.js");
			i18n.init({ locale: "en", strings: JSON.parse(readFileSync(join(appDir, "lang", "en.json"), "utf8")) });
			const W = await imp("ifc/api.js");
			const U = await imp("ifc-util.js");
			return { IfcAPI: W.IfcAPI, ids: U.ids, val: U.val, lengthUnitMm: U.lengthUnitMm, productTriangles: U.productTriangles } as IfcEngine;
		})();
		engines.set(appDir, e);
	}
	return e;
}

/** Opens a file, runs `fn` on it and always closes it. */
export async function withIfc<T>(appDir: string, bytes: Uint8Array, name: string, fn: (api: IfcApi, mid: number, E: IfcEngine) => Promise<T> | T): Promise<T> {
	const E = await loadEngine(appDir);
	const api = new E.IfcAPI();
	await api.Init({ manifold: false });
	const mid = api.OpenModel(bytes, {});
	if (mid < 0) throw new Error(`${name}: nav IFC fails vai tas ir bojāts.`);
	try {
		return await fn(api, mid, E);
	} finally {
		api.CloseModel(mid);
	}
}
