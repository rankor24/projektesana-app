// DWG for the viewer and the compare (A | B): CadCraft's own DOM-free reader and DWGCOMPARE (getcadcraft/cadcraft,
// Apache-2.0; copied by scripts/sync-cadcraft.mjs into resources/cadcraft/app). The same pipeline as CadCraft's tests:
// readDwg(bytes) → importDwg(model) → new Doc().load(...) → compareDrawings(older, newer), and prims() / markPrims() for the
// lines. What leaves here is plain numbers: per space (model space "", then each sheet) flat line lists [x1, y1, x2, y2, …]
// with arcs cut into short segments, so the renderer only draws.
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Bounds, DwgChange, DwgCompare, DwgCompareSpace, DwgView, Lines } from "../shared/compare2d.js";
export type { DwgCompare, DwgView };

/** What one change list carries at most: the colours on the drawing show all of them (CadCraft's History panel: 300). */
const MAX_CHANGES = 300;
/** Lines per space at most, so a huge drawing does not stall the window: the rest is counted, not drawn. */
const MAX_LINES = 400_000 * 4;
const ARC_STEP = Math.PI / 24;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cad = { readDwg: any; importDwg: any; Doc: any; prims: any; markPrims: any; compareDrawings: any; describe: any };
let loaded: { dir: string; cad: Promise<Cad> } | null = null;

/** CadCraft's modules from `dir` (resources/cadcraft/app), loaded once. */
export function cadcraft(dir: string): Promise<Cad> {
	if (loaded?.dir === dir) return loaded.cad;
	if (!existsSync(join(dir, "drawing-compare.js"))) throw new Error("DWG skats nav uzstādīts: trūkst CadCraft moduļu (npm run build vai node scripts/sync-cadcraft.mjs).");
	const imp = (f: string) => import(pathToFileURL(join(dir, f)).href);
	const cad = Promise.all([imp("dwg/read.js"), imp("dwg-import.js"), imp("doc.js"), imp("geom.js"), imp("drawing-compare.js")]).then(([r, i, d, g, c]) => ({
		readDwg: r.readDwg,
		importDwg: i.importDwg,
		Doc: d.Doc,
		prims: g.prims,
		markPrims: c.markPrims,
		compareDrawings: c.compareDrawings,
		describe: c.describe,
	}));
	loaded = { dir, cad };
	return cad;
}

export async function readDrawing(dir: string, bytes: Uint8Array) {
	const cad = await cadcraft(dir);
	const doc = new cad.Doc();
	doc.load(cad.importDwg(cad.readDwg(bytes)));
	return { cad, doc };
}

// ---- prims → flat lines ----

interface Acc {
	out: Lines;
	b: [number, number, number, number];
}
const acc = (): Acc => ({ out: [], b: [Infinity, Infinity, -Infinity, -Infinity] });
function seg(a: Acc, x1: number, y1: number, x2: number, y2: number) {
	if (a.out.length >= MAX_LINES || ![x1, y1, x2, y2].every(Number.isFinite)) return;
	a.out.push(x1, y1, x2, y2);
	const b = a.b;
	b[0] = Math.min(b[0], x1, x2);
	b[1] = Math.min(b[1], y1, y2);
	b[2] = Math.max(b[2], x1, x2);
	b[3] = Math.max(b[3], y1, y2);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addPrims(a: Acc, ps: any[]): number {
	let n = 0;
	for (const p of ps) {
		if (Array.isArray(p) && p.length === 4) (seg(a, p[0], p[1], p[2], p[3]), n++);
		else if (p?.k === "L") (seg(a, p.x1, p.y1, p.x2, p.y2), n++);
		else if (p?.k === "A") {
			const a0 = p.full ? 0 : p.a0;
			let a1 = p.full ? Math.PI * 2 : p.a1;
			if (a1 < a0) a1 += Math.PI * 2;
			const steps = Math.max(2, Math.ceil((a1 - a0) / ARC_STEP));
			for (let i = 0; i < steps; i++) {
				const t0 = a0 + ((a1 - a0) * i) / steps, t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
				seg(a, p.cx + p.r * Math.cos(t0), p.cy + p.r * Math.sin(t0), p.cx + p.r * Math.cos(t1), p.cy + p.r * Math.sin(t1));
			}
			n++;
		}
	}
	return n;
}
const boundsOf = (a: Acc): Bounds | null => (Number.isFinite(a.b[0]) ? [a.b[0], a.b[1], a.b[2], a.b[3]] : null);
function joinBounds(...bs: (Bounds | null)[]): Bounds | null {
	const ok = bs.filter((b): b is Bounds => !!b);
	if (!ok.length) return null;
	return [Math.min(...ok.map((b) => b[0])), Math.min(...ok.map((b) => b[1])), Math.max(...ok.map((b) => b[2])), Math.max(...ok.map((b) => b[3]))];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spacesOf = (doc: any): { name: string; list: any[] }[] => [
	{ name: "", list: [...doc.model.values()] },
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	...(doc.layouts ?? []).map((l: any) => ({ name: l.name, list: [...(l.entities?.values?.() ?? l.entities ?? [])] })),
];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safe(f: () => any[]): any[] {
	try {
		return f() ?? [];
	} catch {
		return [];
	}
}

/** One drawing, every space as lines (model space first). */
export async function dwgView(dir: string, bytes: Uint8Array): Promise<DwgView> {
	const { cad, doc } = await readDrawing(dir, bytes);
	let objects = 0, silent = 0;
	const spaces = spacesOf(doc).map((s) => {
		const a = acc();
		for (const e of s.list) {
			objects++;
			if (!addPrims(a, safe(() => cad.markPrims(e, doc.blocks)))) silent++;
		}
		return { name: s.name, lines: a.out, bounds: boundsOf(a) };
	});
	return { spaces: spaces.filter((s) => s.name === "" || s.lines.length), objects, silent };
}

/** Two drawings: `a` the older, `b` the newer. Marks per space, B drawn as the base. */
export async function dwgCompare(dir: string, aBytes: Uint8Array, bBytes: Uint8Array): Promise<DwgCompare> {
	const A = await readDrawing(dir, aBytes);
	const B = await readDrawing(dir, bBytes);
	const cad = A.cad;
	const r = cad.compareDrawings(A.doc, B.doc);
	const bSpaces = spacesOf(B.doc);
	const aSpaces = spacesOf(A.doc);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const centre = (lines: Lines, fallback: Bounds | null): { x: number; y: number } => {
		if (lines.length >= 4) {
			let x = 0, y = 0;
			for (let i = 0; i < lines.length; i += 2) (x += lines[i]), (y += lines[i + 1]);
			const n = lines.length / 2;
			return { x: x / n, y: y / n };
		}
		return fallback ? { x: (fallback[0] + fallback[2]) / 2, y: (fallback[1] + fallback[3]) / 2 } : { x: 0, y: 0 };
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const label = (e: any) => {
		try {
			return String(cad.describe(e));
		} catch {
			return String(e?.type ?? "objekts");
		}
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const spaces: DwgCompareSpace[] = r.spaces.map((s: any) => {
		const base = acc(), baseA = acc(), add = acc(), rem = acc(), cOld = acc(), cNew = acc();
		for (const e of aSpaces.find((x) => x.name === s.name)?.list ?? []) addPrims(baseA, safe(() => cad.markPrims(e, A.doc.blocks)));
		const listB = bSpaces.find((x) => x.name === s.name)?.list ?? (s.onlyIn === "a" ? aSpaces.find((x) => x.name === s.name)?.list ?? [] : []);
		for (const e of listB) addPrims(base, safe(() => cad.markPrims(e, (s.onlyIn === "a" ? A : B).doc.blocks)));
		const changes: DwgChange[] = [];
		const note = (what: DwgChange["what"], e: unknown, lines: Acc, from: number, detail: string[] = []) => {
			if (changes.length >= MAX_CHANGES) return;
			const own = lines.out.slice(from);
			changes.push({ what, label: label(e), detail, ...centre(own, boundsOf(lines)) });
		};
		for (const e of s.added) {
			const k = add.out.length;
			addPrims(add, safe(() => cad.markPrims(e, B.doc.blocks)));
			note("added", e, add, k);
		}
		for (const e of s.removed) {
			const k = rem.out.length;
			addPrims(rem, safe(() => cad.markPrims(e, A.doc.blocks)));
			note("removed", e, rem, k);
		}
		for (const c of s.changed) {
			addPrims(cOld, safe(() => cad.markPrims(c.a, A.doc.blocks)));
			const k = cNew.out.length;
			addPrims(cNew, safe(() => cad.markPrims(c.b, B.doc.blocks)));
			note("changed", c.b, cNew, k, Array.isArray(c.what) ? c.what.map(String) : []);
		}
		return {
			name: s.name,
			base: base.out,
			baseA: baseA.out,
			added: add.out,
			removed: rem.out,
			changedOld: cOld.out,
			changedNew: cNew.out,
			bounds: joinBounds(boundsOf(base), boundsOf(baseA), boundsOf(add), boundsOf(rem), boundsOf(cOld), boundsOf(cNew)),
			changes,
			onlyIn: s.onlyIn ?? null,
		};
	});
	return {
		spaces: spaces.filter((s) => s.name === "" || s.base.length || s.added.length || s.removed.length || s.changedNew.length),
		totals: r.totals,
		layersAdded: r.layersAdded ?? [],
		layersRemoved: r.layersRemoved ?? [],
	};
}
