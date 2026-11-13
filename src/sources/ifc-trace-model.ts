// A model as the sheet trace (8.11) needs it: the labelled elements (spaces, doors, windows, and solids by their names) with the
// strings a sheet label can match — name, long name, tag, object type and the number / mark properties — a space's area from its
// quantities, what bounds a space, where an element sits in plan, and, only when asked, its box from its own mesh. Read through
// BimCraft's engine (ifc-engine.ts); nothing is computed for an element until the trace looks at it.
import type { Box, TraceElement, TraceModel } from "./sheets/trace.js";
import { norm } from "./sheets/trace.js";
import { withIfc, type IfcApi, type IfcEngine } from "./ifc-engine.js";

const LABELLED = ["IFCSPACE", "IFCDOOR", "IFCWINDOW"];
const SOLIDS = ["IFCWALL", "IFCWALLSTANDARDCASE", "IFCCURTAINWALL", "IFCCOLUMN", "IFCSLAB", "IFCBEAM"];
const PSET_KEYS = new Set(["number", "mark", "reference", "nr", "tag", "type mark", "room number", "numurs"]);
const BOUNDARIES = ["IFCRELSPACEBOUNDARY", "IFCRELSPACEBOUNDARY1STLEVEL", "IFCRELSPACEBOUNDARY2NDLEVEL"];

const idOf = (h: unknown): number | null => {
	const v = (h as { value?: unknown } | null | undefined)?.value;
	return typeof v === "number" ? v : null;
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Reads a model, runs `fn` on the trace view of it, and closes it (the view is valid only inside `fn`). */
export function withTraceModel<T>(appDir: string, bytes: Uint8Array, name: string, fn: (m: TraceModel) => T | Promise<T>): Promise<T> {
	return withIfc(appDir, bytes, name, (api, mid, E) => fn(traceModelOf(api, mid, E)));
}

export function traceModelOf(api: IfcApi, mid: number, E: IfcEngine): TraceModel {
	const unit = E.lengthUnitMm(api, mid);
	const text = (v: unknown) => {
		const x = E.val(v);
		return typeof x === "string" ? x : x == null ? "" : String(x);
	};
	const cache = new Map<number, TraceElement>();

	// number / mark properties and areas, only for the elements a label can name
	const labelled = LABELLED.flatMap((c) => E.ids(api, mid, c));
	const wanted = new Set([...labelled, ...SOLIDS.flatMap((c) => E.ids(api, mid, c))]);
	const props = new Map<number, { keys: string[]; areas: Record<string, number> }>();
	for (const relId of E.ids(api, mid, "IFCRELDEFINESBYPROPERTIES")) {
		const rel = api.GetLine(mid, relId, false);
		if (!rel) continue;
		const objs = list(rel.RelatedObjects).map(idOf).filter((x): x is number => x !== null && wanted.has(x));
		const def = idOf(rel.RelatingPropertyDefinition);
		if (!objs.length || def === null) continue;
		const d = api.GetLine(mid, def, false);
		if (!d) continue;
		const keys: string[] = [];
		const areas: Record<string, number> = {};
		for (const ref of list(d.HasProperties)) {
			const pid = idOf(ref);
			const p = pid === null ? null : api.GetLine(mid, pid, false);
			if (p && PSET_KEYS.has(norm(text(p.Name))) && text(p.NominalValue)) keys.push(norm(text(p.NominalValue)));
		}
		for (const ref of list(d.Quantities)) {
			const qid = idOf(ref);
			const q = qid === null ? null : api.GetLine(mid, qid, false);
			const a = q ? Number(E.val(q.AreaValue)) : NaN;
			if (q && Number.isFinite(a)) areas[text(q.Name)] = a;
		}
		for (const o of objs) {
			const cur = props.get(o) ?? { keys: [], areas: {} };
			cur.keys.push(...keys);
			Object.assign(cur.areas, areas);
			props.set(o, cur);
		}
	}

	// what bounds each space
	const bounds = new Map<number, number[]>();
	for (const cls of BOUNDARIES)
		for (const relId of E.ids(api, mid, cls)) {
			const rel = api.GetLine(mid, relId, false);
			const sp = idOf(rel?.RelatingSpace);
			const el = idOf(rel?.RelatedBuildingElement);
			if (sp !== null && el !== null) bounds.set(sp, [...new Set([...(bounds.get(sp) ?? []), el])]);
		}

	const guidOf = (id: number) => text(api.GetLine(mid, id, false)?.GlobalId);
	const originOf = (id: number): [number, number] | null => {
		const p = idOf(api.GetLine(mid, id, false)?.ObjectPlacement);
		if (p === null) return null;
		const M = api.GetWorldTransformMatrix(mid, p);
		return [(M[12] * unit) / 1000, (M[13] * unit) / 1000];
	};
	const boxOf = (id: number): Box | null => {
		try {
			const { positions } = E.productTriangles(api, mid, id, unit);
			if (!positions.length) return null;
			const lo = [Infinity, Infinity, Infinity];
			const hi = [-Infinity, -Infinity, -Infinity];
			for (let i = 0; i < positions.length; i += 3)
				for (let k = 0; k < 3; k++) {
					const v = (positions[i + k] * unit) / 1000;
					if (v < lo[k]) lo[k] = v;
					if (v > hi[k]) hi[k] = v;
				}
			return [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]];
		} catch {
			return null;
		}
	};
	const area = (id: number): number | null => {
		const a = props.get(id)?.areas;
		if (!a) return null;
		for (const k of ["NetFloorArea", "GrossFloorArea"]) if (typeof a[k] === "number") return a[k];
		const any = Object.entries(a).find(([k]) => /area/i.test(k));
		return any ? any[1] : null;
	};

	const make = (id: number): TraceElement => {
		const hit = cache.get(id);
		if (hit) return hit;
		const l = api.GetLine(mid, id, false);
		const name = text(l?.Name) || null;
		const longName = text(l?.LongName) || null;
		const keys = [...new Set([name, longName, text(l?.Tag), text(l?.ObjectType)].filter(Boolean).map((s) => norm(s as string)).concat(props.get(id)?.keys ?? []))].filter(Boolean);
		const el: TraceElement = {
			guid: guidOf(id),
			cls: className(api, mid, id),
			name,
			longName,
			keys,
			area: area(id),
			boundedBy: (bounds.get(id) ?? []).map(guidOf).filter(Boolean),
			origin: originOf(id),
			box: () => boxOf(id),
		};
		cache.set(id, el);
		return el;
	};

	let byGuid: Map<string, number> | null = null;
	const index = () => {
		if (byGuid) return byGuid;
		byGuid = new Map();
		for (const id of [...E.ids(api, mid, "IFCELEMENT", true), ...E.ids(api, mid, "IFCSPACE")]) {
			const g = guidOf(id);
			if (g) byGuid.set(g, id);
		}
		return byGuid;
	};

	const elements = [...labelled.map(make), ...SOLIDS.flatMap((c) => E.ids(api, mid, c)).map(make)].filter((e) => e.keys.length);
	return {
		elements,
		find: (guid) => {
			const id = index().get(guid);
			return id === undefined ? undefined : make(id);
		},
		solids: ["IFCWALL", "IFCWALLSTANDARDCASE", "IFCCURTAINWALL", "IFCCOLUMN"].flatMap((c) => E.ids(api, mid, c)).map(make).filter((e) => e.origin),
	};
}

/** "IfcWall", "IfcSpace": the class of a line, from its type code. */
function className(api: IfcApi, mid: number, id: number): string {
	const a = api as unknown as { GetLineType(m: number, id: number): number; GetNameFromTypeCode(c: number): string };
	return `Ifc${a.GetNameFromTypeCode(a.GetLineType(mid, id)).replace(/^ifc/i, "")}`;
}
