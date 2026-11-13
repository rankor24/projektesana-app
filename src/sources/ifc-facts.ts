// What a model says about itself (task 8.9): the header, the project / site / building names and where the site and building are
// placed, the storeys with their heights, and the coordination marker ("kubs"). Read through BimCraft's own IFC engine (the
// synced copy in resources/bimcraft/app: no IFC parsing of our own), opened lazily, so no geometry is built. Placements are
// BimCraft's own world matrices in the file's coordinates (no coordination shift), turned to millimetres by the file's length unit.
// A model is read once per file version: the facts are cached in the project's data folder by size, time and marker names.
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { disciplineOf } from "../core/coordination.js";
import type { ModelFacts, Placed } from "../core/coordination-types.js";
import type { ProjectStore } from "../core/store.js";
import { listModels, stagedModels } from "./models.js";

type Api = {
	Init(o?: object): Promise<unknown>;
	OpenModel(b: Uint8Array, s?: object): number;
	CloseModel(m: number): void;
	GetLine(m: number, id: number, flat: boolean): Record<string, { value?: unknown } | undefined> | null;
	GetWorldTransformMatrix(m: number, placement: number): number[];
};
type Engine = { IfcAPI: new () => Api; ids: (api: Api, mid: number, cls: string) => number[]; val: (v: unknown) => unknown; lengthUnitMm: (api: Api, mid: number) => number };

const engines = new Map<string, Promise<Engine>>();
function engine(appDir: string): Promise<Engine> {
	let e = engines.get(appDir);
	if (!e) {
		e = (async () => {
			(globalThis as { document?: unknown }).document ??= { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
			const imp = (f: string) => import(pathToFileURL(join(appDir, f)).href);
			const W = await imp("ifc/api.js");
			const U = await imp("ifc-util.js");
			return { IfcAPI: W.IfcAPI, ids: U.ids, val: U.val, lengthUnitMm: U.lengthUnitMm } as Engine;
		})();
		engines.set(appDir, e);
	}
	return e;
}

/** FILE_SCHEMA, the time stamp's day and the authoring application, from the STEP header (its first kilobytes, plain text). */
export function parseIfcHeader(bytes: Uint8Array): { schema: string | null; ts: string; app: string } {
	const head = new TextDecoder("latin1").decode(bytes.subarray(0, 16384));
	const schema = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(head)?.[1] ?? null;
	const fileName = /FILE_NAME\s*\(([\s\S]*?)\)\s*;/i.exec(head)?.[1] ?? "";
	const q = [...fileName.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
	// name, time stamp, author(s), organisation(s), preprocessor, originating system, authorisation: the last two are fixed
	return { schema, ts: (q[1] ?? "").slice(0, 10), app: q.length >= 4 ? (q[q.length - 2] ?? "") : "" };
}

/** Classes a coordination marker can be modelled as. */
const MARKER_CLASSES = ["IFCBUILDINGELEMENTPROXY", "IFCCOLUMN", "IFCFURNISHINGELEMENT", "IFCGEOGRAPHICELEMENT", "IFCMEMBER", "IFCPLATE", "IFCSLAB", "IFCWALL", "IFCBEAM", "IFCDISCRETEACCESSORY", "IFCCOVERING"];

export async function readIfcFacts(appDir: string, bytes: Uint8Array, file: string, cubeNames: string[]): Promise<ModelFacts> {
	const E = await engine(appDir);
	const api = new E.IfcAPI();
	await api.Init({ manifold: false });
	const mid = api.OpenModel(bytes, {});
	if (mid < 0) throw new Error(`${file}: nav IFC fails vai tas ir bojāts.`);
	try {
		const unit = E.lengthUnitMm(api, mid);
		// a file in metres gives 9.45 * 1000 = 9450.000000000002: millimetres to a thousandth, no float noise on the screen
		const mm = (v: number) => Math.round(v * 1000) / 1000;
		const text = (v: unknown) => {
			const x = E.val(v);
			return typeof x === "string" ? x : x == null ? "" : String(x);
		};
		const world = (id: number, name: string): Placed | null => {
			const l = api.GetLine(mid, id, false);
			const p = l?.ObjectPlacement?.value;
			if (typeof p !== "number") return null;
			const M = api.GetWorldTransformMatrix(mid, p);
			return { name, x: mm(M[12] * unit), y: mm(M[13] * unit), z: mm(M[14] * unit) };
		};
		const first = (cls: string) => E.ids(api, mid, cls)[0];
		const named = (cls: string): { name: string; id: number } | null => {
			const id = first(cls);
			return id === undefined ? null : { id, name: text(api.GetLine(mid, id, false)?.Name) };
		};
		const proj = named("IFCPROJECT");
		const site = named("IFCSITE");
		const building = named("IFCBUILDING");
		const storeys = E.ids(api, mid, "IFCBUILDINGSTOREY")
			.map((id) => {
				const l = api.GetLine(mid, id, false);
				const w = world(id, "");
				const z = w ? w.z : Number(E.val(l?.Elevation)) * unit;
				return { name: text(l?.Name) || text(l?.LongName), elevation: Number.isFinite(z) ? mm(z) : null };
			})
			.sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
		const wanted = cubeNames.map((n) => n.toLowerCase()).filter(Boolean);
		const cubes: Placed[] = [];
		if (wanted.length)
			for (const cls of MARKER_CLASSES) {
				for (const id of E.ids(api, mid, cls)) {
					const l = api.GetLine(mid, id, false);
					const label = `${text(l?.Name)}:${text(l?.ObjectType)}`;
					if (wanted.some((n) => label.toLowerCase().includes(n))) {
						const w = world(id, label.replace(/:+$/, ""));
						if (w) cubes.push(w);
					}
				}
			}
		const h = parseIfcHeader(bytes);
		return {
			code: disciplineOf(file),
			file,
			source: "ifc",
			app: h.app,
			ts: h.ts,
			schema: h.schema,
			project: proj ? proj.name : null,
			site: site ? (world(site.id, site.name) ?? { name: site.name, x: 0, y: 0, z: 0 }) : null,
			building: building ? (world(building.id, building.name) ?? { name: building.name, x: 0, y: 0, z: 0 }) : null,
			storeys,
			cubes,
		};
	} finally {
		api.CloseModel(mid);
	}
}

interface CacheEntry {
	sig: string;
	facts: ModelFacts;
}

/** The models the audit measures: the current files of the section folders, and the IFC staged in the delivery being made. */
export async function auditedModels(store: ProjectStore, deliveryId?: string): Promise<{ file: string; abs: string; key: string; size: number; mtime: string }[]> {
	const office = (await listModels(store.project.root)).filter((m) => m.origin === "projekta daļas" && !m.archived).map((m) => ({ file: m.name, abs: join(store.project.root, m.rel), key: m.rel, size: m.size, mtime: m.mtime }));
	if (!deliveryId) return office;
	const d = store.read("deliveries").find((x) => x.id === deliveryId);
	const staged = d?.draft ? stagedModels(store.dir).filter((m) => m.rel.startsWith(d.draft!.stagingDir)) : [];
	return [...office, ...staged.map((m) => ({ file: m.name, abs: m.rel, key: m.rel, size: m.size, mtime: m.mtime }))];
}

/** The facts of every audited model, each file read once per version. A file that cannot be read is reported, not hidden. */
export async function projectFacts(appDir: string, store: ProjectStore, cubeNames: string[], deliveryId?: string): Promise<{ facts: ModelFacts[]; errors: { file: string; message: string }[] }> {
	const cache = store.readMeta<Record<string, CacheEntry>>("ifc-facts", {});
	const next: Record<string, CacheEntry> = {};
	const facts: ModelFacts[] = [];
	const errors: { file: string; message: string }[] = [];
	let dirty = false;
	for (const m of await auditedModels(store, deliveryId)) {
		const sig = `${m.size}:${m.mtime}:${[...cubeNames].sort().join("|")}`;
		const hit = cache[m.key];
		if (hit?.sig === sig) {
			next[m.key] = hit;
			facts.push(hit.facts);
			continue;
		}
		try {
			if (!statSync(m.abs).isFile()) continue;
			const f = await readIfcFacts(appDir, new Uint8Array(await readFile(m.abs)), m.file, cubeNames);
			next[m.key] = { sig, facts: f };
			facts.push(f);
			dirty = true;
		} catch (e) {
			errors.push({ file: m.file, message: (e as Error).message });
		}
	}
	if (dirty || Object.keys(cache).length !== Object.keys(next).length) store.writeMeta("ifc-facts", next, { kind: "ifc-facts.read", by: "app", data: { files: facts.length } });
	return { facts, errors };
}
