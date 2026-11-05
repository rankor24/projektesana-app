// Diffs (spec §6, §8): text lines, IFC by GlobalId, room table.

export interface LineOp {
	op: " " | "+" | "-";
	line: string;
}

/** Line diff by longest common subsequence. */
export function textDiff(a: string, b: string): LineOp[] {
	const x = a.split("\n");
	const y = b.split("\n");
	const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
	for (let i = x.length - 1; i >= 0; i--)
		for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
	const out: LineOp[] = [];
	let i = 0;
	let j = 0;
	while (i < x.length && j < y.length) {
		if (x[i] === y[j]) out.push({ op: " ", line: x[i++] }, ...(j++, []));
		else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "-", line: x[i++] });
		else out.push({ op: "+", line: y[j++] });
	}
	while (i < x.length) out.push({ op: "-", line: x[i++] });
	while (j < y.length) out.push({ op: "+", line: y[j++] });
	return out;
}

export interface IfcEntity {
	id: number;
	type: string;
	args: string;
}

/** Minimal STEP reader: `#12=IFCWALL('guid',#5,...);` one entity per statement. */
export function parseStep(text: string): Map<number, IfcEntity> {
	const m = new Map<number, IfcEntity>();
	const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/g;
	for (const r of text.matchAll(re)) m.set(Number(r[1]), { id: Number(r[1]), type: r[2], args: r[3] });
	return m;
}

function splitArgs(args: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = "";
	let inStr = false;
	for (const c of args) {
		if (c === "'") inStr = !inStr;
		if (!inStr && c === "(") depth++;
		if (!inStr && c === ")") depth--;
		if (!inStr && depth === 0 && c === ",") {
			out.push(cur.trim());
			cur = "";
		} else cur += c;
	}
	out.push(cur.trim());
	return out;
}

const refId = (s: string | undefined) => (s && /^#\d+$/.test(s) ? Number(s.slice(1)) : null);

/** Absolute-ish position of an entity: sum of local placement points up the PlacementRelTo chain. */
function position(ents: Map<number, IfcEntity>, placementId: number | null): string | null {
	let sum = [0, 0, 0];
	let id = placementId;
	for (let guard = 0; id !== null && guard < 20; guard++) {
		const lp = ents.get(id);
		if (!lp || lp.type !== "IFCLOCALPLACEMENT") return null;
		const [rel, axis] = splitArgs(lp.args);
		const ax = ents.get(refId(axis) ?? -1);
		const pt = ax ? ents.get(refId(splitArgs(ax.args)[0]) ?? -1) : undefined;
		if (pt && pt.type === "IFCCARTESIANPOINT") {
			const nums = (pt.args.match(/-?\d+\.?\d*(?:E[+-]?\d+)?/gi) ?? []).map(Number);
			sum = sum.map((v, k) => v + (nums[k] ?? 0));
		}
		id = refId(rel);
	}
	return sum.map((v) => Math.round(v * 1000) / 1000).join(",");
}

export interface IfcDiff {
	added: { guid: string; type: string }[];
	removed: { guid: string; type: string }[];
	moved: { guid: string; type: string; from: string; to: string }[];
	changed: { guid: string; type: string }[];
}

interface Rooted {
	guid: string;
	type: string;
	norm: string;
	pos: string | null;
}

function rooted(text: string): Map<string, Rooted> {
	const ents = parseStep(text);
	const out = new Map<string, Rooted>();
	for (const e of ents.values()) {
		const a = splitArgs(e.args);
		const g = /^'([0-9A-Za-z_$]{22})'$/.exec(a[0] ?? "");
		if (!g) continue;
		// ObjectPlacement is attribute 5 (0-based) for IfcProduct subtypes
		const pos = position(ents, refId(a[5]));
		// reference numbers differ between exports; compare shape without them
		const norm = e.args.replace(/#\d+/g, "#");
		out.set(g[1], { guid: g[1], type: e.type, norm, pos });
	}
	return out;
}

export function ifcDiff(a: string, b: string): IfcDiff {
	const A = rooted(a);
	const B = rooted(b);
	const d: IfcDiff = { added: [], removed: [], moved: [], changed: [] };
	for (const [g, nb] of B) {
		const na = A.get(g);
		if (!na) d.added.push({ guid: g, type: nb.type });
		else if (na.pos !== nb.pos && na.pos && nb.pos) d.moved.push({ guid: g, type: nb.type, from: na.pos, to: nb.pos });
		else if (na.norm !== nb.norm) d.changed.push({ guid: g, type: nb.type });
	}
	for (const [g, na] of A) if (!B.has(g)) d.removed.push({ guid: g, type: na.type });
	return d;
}

export interface RoomRow {
	id: string;
	name: string;
	level: string;
	areaM2: number;
}

export interface RoomDiff {
	added: RoomRow[];
	removed: RoomRow[];
	areaChanged: { id: string; name: string; from: number; to: number }[];
}

export function roomDiff(a: RoomRow[], b: RoomRow[]): RoomDiff {
	const A = new Map(a.map((r) => [r.id, r]));
	const B = new Map(b.map((r) => [r.id, r]));
	const d: RoomDiff = { added: [], removed: [], areaChanged: [] };
	for (const [id, rb] of B) {
		const ra = A.get(id);
		if (!ra) d.added.push(rb);
		else if (Math.abs(ra.areaM2 - rb.areaM2) > 0.005) d.areaChanged.push({ id, name: rb.name, from: ra.areaM2, to: rb.areaM2 });
	}
	for (const [id, ra] of A) if (!B.has(id)) d.removed.push(ra);
	return d;
}
