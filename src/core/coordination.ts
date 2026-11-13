// The coordination audit (task 8.9): what every model of a project must agree on — the coordination marker on the base point,
// the project / site / building names and the IFC schema, the storey names and heights — measured per model, and phrased as an
// instruction to the person who opens that model ("what it has now, what it must become"), because one person fixes one model.
// Ported from BIM Crew apps/server/src/ito/{reference,report}.ts. Pure: the facts come in (read from each IFC by
// sources/ifc-facts.ts), the report comes out, so the whole derivation is tested on invented models.
import type { AuditReport, CoordReference, Declared, ModelFacts, ModelReport, Placed, ReportGroup, ReportLine, StoreyScheme } from "./coordination-types.js";

export type { AuditReport, CoordReference, Declared, ModelFacts, ModelReport, Placed, ReportGroup, ReportLine, StoreyScheme } from "./coordination-types.js";

// ---- value helpers -------------------------------------------------------------------------------------------------------

/** Numeric view of a typed value, tolerating grouping spaces and comma decimals. */
export function toNumber(value: string | number | null | undefined): number | null {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (value == null) return null;
	const cleaned = value.replace(/[\s   ]/g, "").replace(",", ".").replace(/[^0-9.+-]/g, "");
	if (!cleaned || !/\d/.test(cleaned)) return null;
	const n = Number(cleaned);
	return Number.isFinite(n) ? n : null;
}

/** Comparison key: trimmed, single-spaced, case-folded. Never used for display. */
export const normalizeName = (v: string | null | undefined): string => (v ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("lv-LV");

const THIN = " ";

/** 503298283 → "503 298 283,00" (a thin space between thousands; pass a plain space for text that is pasted elsewhere). */
export function formatCoordinate(value: string | number | null | undefined, sep = THIN): string {
	const n = toNumber(value);
	if (n == null) return "—";
	const [whole, frac = "00"] = Math.abs(n).toFixed(2).split(".");
	return `${n < 0 ? "−" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep)},${frac}`;
}

/** Millimetres below a metre, metres above. */
export function formatDistance(mm: number): string {
	return Math.abs(mm) < 1000 ? `${Math.round(mm)} mm` : `${(mm / 1000).toFixed(2).replace(".", ",")} m`;
}

/** The discipline of a model from its file name: BD427_AR_261110.ifc → AR; otherwise the first short capital token. */
export function disciplineOf(file: string): string {
	const base = file.replace(/\.[^.]+$/, "");
	const parts = base.split(/[_\s-]+/).filter(Boolean);
	const second = parts[1];
	if (second && /^[A-ZĀČĒĢĪĶĻŅŠŪŽ]{2,4}\d?$/.test(second)) return second;
	return parts.find((p, i) => i > 0 && /^[A-Z]{2,4}$/.test(p)) ?? parts[0] ?? base;
}

export const EMPTY_REFERENCE: CoordReference = {
	basePoint: { x: "", y: "", z: "" },
	cubeNames: ["GVB_KUBS", "EP_KUBS", "KUBS"],
	tolerance: 1,
	hierarchy: { project: "", site: "", building: "", schema: "" },
	filePrefix: "",
	storeySchemes: [{ id: "default", label: "Pamatshēma", storeys: [], disciplines: [] }],
	seededFrom: null,
	updatedAt: null,
};

// ---- seeding the reference -----------------------------------------------------------------------------------------------

function majority<T>(values: T[], key: (v: T) => string = String): T | undefined {
	const counts = new Map<string, { v: T; n: number }>();
	for (const v of values) {
		const k = key(v);
		const c = counts.get(k);
		if (c) c.n++;
		else counts.set(k, { v, n: 1 });
	}
	return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.v;
}

const mmText = (n: number) => String(Math.round(n * 1000) / 1000);

/** The base point: the BIP's value, unless the models that carry the marker all agree on another one. */
function pickAxis(declared: string | undefined, observed: number[]): string {
	const obs = observed.map(mmText);
	const common = majority(obs);
	if (!declared) return common ?? "";
	if (!obs.length || new Set(obs).size !== 1) return declared;
	return obs[0] === mmText(toNumber(declared) ?? NaN) ? declared : obs[0];
}

/**
 * Build a project's starting reference. The models supply what they agree on; a typed-in BIP value takes precedence. A seed is a
 * starting point, not the truth: BIPs contradict themselves (BIM Crew met a BIP whose base-point Z was ten times its own level
 * table), so the reference is stored per project and edited by hand.
 */
export function seedReference(models: ModelFacts[], declared: Declared = {}, now = new Date().toISOString()): CoordReference {
	const cubes = models.flatMap((m) => m.cubes);
	const cubeNames = [...new Set(cubes.map((c) => c.name.split(":").filter(Boolean)[0]?.trim() ?? "").filter(Boolean))];
	const prefix = majority(models.map((m) => m.file.split("_")[0]).filter(Boolean));
	const names = (pick: (m: ModelFacts) => string | null | undefined) => majority(models.map(pick).filter((v): v is string => !!v?.trim()));

	let schemes: StoreyScheme[];
	if (declared.storeys?.length) {
		const by = new Map<string, { name: string; elevation?: string }[]>();
		for (const s of declared.storeys) by.set(s.building?.trim() || "Pamatshēma", [...(by.get(s.building?.trim() || "Pamatshēma") ?? []), { name: s.name, elevation: s.elevation }]);
		schemes = [...by.entries()]
			.sort((a, b) => b[1].length - a[1].length)
			.map(([building, list], i) => ({ id: i === 0 ? "default" : building, label: building, storeys: list.map((s) => s.name), ...(list.some((s) => s.elevation) ? { elevations: Object.fromEntries(list.filter((s) => s.elevation).map((s) => [s.name, s.elevation!])) } : {}), disciplines: [] }));
	} else schemes = [schemeFromModels(models)];

	return {
		basePoint: { x: pickAxis(declared.basePoint?.x, cubes.map((c) => c.x)), y: pickAxis(declared.basePoint?.y, cubes.map((c) => c.y)), z: pickAxis(declared.basePoint?.z, cubes.map((c) => c.z)) },
		cubeNames: cubeNames.length ? cubeNames : EMPTY_REFERENCE.cubeNames,
		tolerance: 1,
		hierarchy: { project: names((m) => m.project) ?? "", site: names((m) => m.site?.name) ?? "", building: names((m) => m.building?.name) ?? "", schema: declared.schema || names((m) => m.schema) || "" },
		filePrefix: prefix ?? "",
		storeySchemes: assignSchemes(schemes, models),
		seededFrom: declared.storeys?.length || declared.basePoint ? "BIP (ievadīts) + modeļi" : models.length ? "modeļi" : null,
		updatedAt: now,
	};
}

/** The storey names most models share, lowest first, each with the middle height the models give it. */
function schemeFromModels(models: ModelFacts[]): StoreyScheme {
	const seen = new Map<string, { n: number; z: number[] }>();
	for (const m of models) {
		for (const name of new Set(m.storeys.map((s) => s.name.trim()).filter(Boolean))) {
			const e = seen.get(name) ?? { n: 0, z: [] };
			e.n++;
			const z = m.storeys.find((s) => s.name.trim() === name)?.elevation;
			if (z != null) e.z.push(z);
			seen.set(name, e);
		}
	}
	const need = Math.max(1, Math.ceil(models.length / 2));
	const common = [...seen.entries()].filter(([, e]) => e.n >= need).map(([name, e]) => ({ name, z: e.z.length ? [...e.z].sort((a, b) => a - b)[Math.floor(e.z.length / 2)] : null }));
	common.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
	return { id: "default", label: "Pamatshēma", storeys: common.map((c) => c.name), ...(common.some((c) => c.z != null) ? { elevations: Object.fromEntries(common.filter((c) => c.z != null).map((c) => [c.name, mmText(c.z!)])) } : {}), disciplines: [] };
}

/** A secondary volume goes to the models that actually build it: half its storeys present is decisive. */
export function assignSchemes(schemes: StoreyScheme[], models: ModelFacts[]): StoreyScheme[] {
	if (schemes.length < 2) return schemes;
	const byCode = new Map<string, Set<string>>();
	for (const m of models) byCode.set(m.code, new Set([...(byCode.get(m.code) ?? []), ...m.storeys.map((s) => s.name.trim())]));
	return schemes.map((scheme, i) => {
		if (i === 0 || scheme.disciplines.length) return scheme;
		const owners = [...byCode].filter(([, names]) => scheme.storeys.length && scheme.storeys.filter((s) => names.has(s)).length / scheme.storeys.length >= 0.5).map(([code]) => code);
		return owners.length ? { ...scheme, disciplines: owners.sort() } : scheme;
	});
}

/** The storeys a discipline is measured against; a discipline that owns several schemes may use all of their storeys. */
export function schemeFor(reference: CoordReference, discipline: string): StoreyScheme {
	const own = reference.storeySchemes.filter((s) => s.disciplines.includes(discipline));
	if (!own.length) return reference.storeySchemes[0] ?? EMPTY_REFERENCE.storeySchemes[0];
	if (own.length === 1) return own[0];
	return { id: own.map((s) => s.id).join("+"), label: own.map((s) => s.label).join(" + "), storeys: [...new Set(own.flatMap((s) => s.storeys))], elevations: Object.assign({}, ...own.map((s) => s.elevations ?? {})), disciplines: [discipline] };
}

/** Gaps a seeded reference leaves, shown in the editor so they are corrected before the report goes out. */
export function referenceWarnings(reference: CoordReference, models: ModelFacts[], declared?: Declared["basePoint"] | null): string[] {
	const out: string[] = [];
	for (const a of ["x", "y", "z"] as const) if (!reference.basePoint[a]) out.push(`Pamatpunkta ${a.toUpperCase()} nav norādīts.`);
	const cubes = models.flatMap((m) => m.cubes);
	for (const a of ["x", "y", "z"] as const) {
		const d = declared?.[a];
		const seen = majority(cubes.map((c) => mmText(c[a])));
		if (d && seen && toNumber(d) !== toNumber(seen)) out.push(`BIP norāda pamatpunkta ${a.toUpperCase()} = ${d}, bet modeļi rāda ${seen}. Lietota modeļu vērtība: jālabo BIP.`);
	}
	// a storey the scheme lacks is a gap in the scheme only where the models that carry it otherwise follow the list
	const undeclared = new Map<string, Set<string>>();
	for (const m of models) {
		const scheme = schemeFor(reference, m.code).storeys;
		if (!scheme.length) continue;
		const names = m.storeys.map((s) => s.name.trim()).filter(Boolean);
		if (names.filter((n) => scheme.includes(n)).length / scheme.length < 0.5) continue;
		for (const n of names) if (!scheme.includes(n)) undeclared.set(n, (undeclared.get(n) ?? new Set()).add(m.code));
	}
	for (const [n, users] of undeclared) if (users.size >= 2) out.push(`«${n}» ir ${users.size} modeļos, kas citādi seko sarakstam (${[...users].sort().join(", ")}): pievienot sarakstam?`);
	if (!reference.storeySchemes[0]?.storeys.length) out.push("Stāvu saraksts ir tukšs: modeļu stāvi netiks pārbaudīti.");
	for (const s of reference.storeySchemes.slice(1)) if (!s.disciplines.length) out.push(`Shēmai «${s.label}» nav piešķirta neviena daļa.`);
	for (const k of ["project", "site", "building", "schema"] as const) if (!reference.hierarchy[k]) out.push(`IFC hierarhijā trūkst «${k}» vērtības.`);
	return out;
}

// ---- the audit -----------------------------------------------------------------------------------------------------------

const line = (code: string, group: string, kind: string, l: Omit<ReportLine, "id" | "kind">, discriminator = ""): ReportLine => ({ id: [code, group, kind, discriminator].filter(Boolean).join("|"), kind, ...l });

const basePointLabel = (r: CoordReference) => `E ${formatCoordinate(r.basePoint.x)} · N ${formatCoordinate(r.basePoint.y)} · Z ${formatCoordinate(r.basePoint.z)}`;

/** Planar distance of a placed thing from the reference base point (mm). */
function offsetFrom(r: CoordReference, p: Placed): number | null {
	const rx = toNumber(r.basePoint.x);
	const ry = toNumber(r.basePoint.y);
	return rx == null || ry == null ? null : Math.hypot(p.x - rx, p.y - ry);
}

const cubeLabel = (c: Placed) => c.name.split(":").filter(Boolean)[0]?.trim() || "kubs";

/** Novietne: the coordination marker and the placement of the site and the building. */
function placementLines(m: ModelFacts, r: CoordReference): ReportLine[] {
	const out: ReportLine[] = [];
	const tol = r.tolerance || 1;
	const code = m.code;
	const cubeName = r.cubeNames[0] ?? "KUBS";
	if (!m.cubes.length) out.push(line(code, "Novietne", "cube-missing", { w: "Pamatpunkts", now: "kuba nav", to: `${cubeName} uz bāzes punkta` }));
	else {
		const measured = m.cubes.map((c) => ({ c, off: offsetFrom(r, c) })).sort((a, b) => (a.off ?? Infinity) - (b.off ?? Infinity));
		if (measured.length === 1) {
			const { c, off } = measured[0];
			if (off != null && off > tol) out.push(line(code, "Novietne", "cube-offset", { w: "Kubs", now: `${cubeLabel(c)} · ${formatDistance(off)} nost`, to: `${cubeName} uz bāzes punkta` }));
		} else
			// duplicated markers: the nearest is the keeper, the others are strays
			measured.forEach(({ off }, i) => {
				if (i === 0) {
					if (off != null && off > tol) out.push(line(code, "Novietne", "cube-offset", { w: "Kubs 1", now: `${formatDistance(off)} nost`, to: "uz bāzes punkta" }));
					return;
				}
				out.push(line(code, "Novietne", "cube-duplicate", { w: `Kubs ${i + 1}`, now: off != null ? `${formatDistance(off)} nost` : "dublikāts", to: "dzēst" }, String(i)));
			});
	}
	const refZ = toNumber(r.basePoint.z);
	const siteOff = refZ != null && m.site != null && Math.abs(m.site.z - refZ) > tol;
	const buildingOff = refZ != null && m.building != null && Math.abs(m.building.z - refZ) > tol;
	// a building at the origin was never georeferenced: report the whole triple, not a wrong Z
	if (m.building && m.building.x === 0 && m.building.y === 0 && (toNumber(r.basePoint.x) !== 0 || toNumber(r.basePoint.y) !== 0))
		out.push(line(code, "Novietne", "building-origin", { wide: true, w: "IfcBuilding", now: `E ${formatCoordinate(m.building.x)} · N ${formatCoordinate(m.building.y)} · Z ${formatCoordinate(m.building.z)}`, to: basePointLabel(r) }));
	else if (siteOff && buildingOff && m.site!.z === m.building!.z) out.push(line(code, "Novietne", "spatial-z", { w: "Site+Building", now: `Z = ${formatCoordinate(m.site!.z)}`, to: `Z = ${formatCoordinate(refZ)} mm` }));
	else {
		if (siteOff) out.push(line(code, "Novietne", "site-z", { w: "IfcSite", now: `Z = ${formatCoordinate(m.site!.z)}`, to: `Z = ${formatCoordinate(refZ)} mm` }));
		if (buildingOff) out.push(line(code, "Novietne", "building-z", { w: "IfcBuilding", now: `Z = ${formatCoordinate(m.building!.z)}`, to: `Z = ${formatCoordinate(refZ)} mm` }));
	}
	return out;
}

/** Hierarhija: the file name, the project / site / building names and the IFC schema. */
function hierarchyLines(m: ModelFacts, r: CoordReference): ReportLine[] {
	const out: ReportLine[] = [];
	const code = m.code;
	if (r.filePrefix && m.file && !m.file.startsWith(`${r.filePrefix}_`)) out.push(line(code, "Hierarhija", "file-prefix", { w: "Faila nosaukums", now: `${m.file.split("_")[0]}_…`, to: `${r.filePrefix}_…` }));
	const names: [string, string | null | undefined, boolean, string, string][] = [
		["IfcProject", m.project, m.project === null, r.hierarchy.project, "project"],
		["IfcSite", m.site?.name, m.site === null, r.hierarchy.site, "site"],
		["IfcBuilding", m.building?.name, m.building === null, r.hierarchy.building, "building"],
	];
	for (const [label, actual, absent, expected, key] of names) {
		if (!expected || normalizeName(actual) === normalizeName(expected)) continue;
		out.push(line(code, "Hierarhija", `name-${key}`, { w: label, now: absent ? "nav eksportēts" : actual || "(tukšs)", to: expected }));
	}
	if (r.hierarchy.schema && m.schema && m.schema !== r.hierarchy.schema) out.push(line(code, "Hierarhija", "schema", { w: "Shēma", now: m.schema, to: r.hierarchy.schema }));
	return out;
}

interface StoreyMatch {
	actual: string;
	target: string | null;
	how: "exact" | "space" | "case" | "rename" | "none";
}

/** Match one storey name to the scheme. Ordered by how the fix is made, not by string distance: a trailing space and a capital
 *  letter are search-and-replace, a rename is a deliberate edit, and they read differently in a coordination note. */
export function classifyStorey(actual: string, scheme: string[]): StoreyMatch {
	const exact = scheme.find((t) => t === actual);
	if (exact) return { actual, target: exact, how: "exact" };
	const space = scheme.find((t) => t === actual.trim());
	if (space) return { actual, target: space, how: "space" };
	const key = normalizeName(actual);
	const cased = scheme.find((t) => normalizeName(t) === key);
	if (cased) return { actual, target: cased, how: "case" };
	// prefixed or annotated names ("03 3.stāvs - mg"): the longest contained name wins, so "1.stāvs" cannot take "11.stāvs"
	const contained = scheme.filter((t) => key.includes(normalizeName(t))).sort((a, b) => b.length - a.length)[0];
	return contained ? { actual, target: contained, how: "rename" } : { actual, target: null, how: "none" };
}

const abbreviate = (v: string[]) => (v.length <= 2 ? v.join(", ") : `${v[0]} … ${v[v.length - 1]}`);

/** Stāvi: storey names against the scheme, then the heights of the storeys that match. */
function storeyLines(m: ModelFacts, r: CoordReference): ReportLine[] {
	const sch = schemeFor(r, m.code);
	const scheme = sch.storeys;
	if (!scheme.length) return [];
	const code = m.code;
	if (!m.storeys.length) return [line(code, "Stāvi", "storeys-absent", { wide: true, w: "Nosaukumi", now: "neviena IfcBuildingStorey", to: scheme.join(", ") })];
	const actuals = [...new Set(m.storeys.map((s) => s.name))].filter((n) => n.trim() !== "");
	const matches = actuals.map((a) => classifyStorey(a, scheme));
	const matched = new Set(matches.filter((x) => x.target).map((x) => x.target as string));
	// nothing lines up: a different nomenclature entirely; fifteen rename lines would bury that
	if (!matched.size && actuals.length) return [line(code, "Stāvi", "storeys-scheme", { wide: true, w: "Nosaukumi", now: actuals.join(", "), to: scheme.join(", "), ask: "Jāsakrīt ar saskaņoto sarakstu" })];
	const out: ReportLine[] = [];
	for (const x of matches.filter((x) => x.how === "space")) out.push(line(code, "Stāvi", "storey-space", { w: "Lieka atstarpe", now: `«${x.actual}»`, to: `«${x.target}»` }, x.target ?? x.actual));
	const cases = matches.filter((x) => x.how === "case");
	if (cases.length === 1) out.push(line(code, "Stāvi", "storey-case", { w: "Lielais burts", now: cases[0].actual, to: cases[0].target ?? "" }, cases[0].target ?? cases[0].actual));
	else if (cases.length > 1) out.push(line(code, "Stāvi", "storey-case", { w: "Lielais burts", now: abbreviate(cases.map((x) => x.actual)), to: abbreviate(cases.map((x) => x.target ?? "")) }));
	for (const x of matches.filter((x) => x.how === "rename")) out.push(line(code, "Stāvi", "storey-rename", { w: "Pārsaukt", now: x.actual, to: x.target ?? "" }, x.actual.trim()));
	for (const x of matches.filter((x) => x.how === "none")) out.push(line(code, "Stāvi", "storey-extra", { w: "Nav sarakstā", now: x.actual, to: "dzēst vai pārsaukt" }, x.actual.trim()));
	const missing = scheme.filter((t) => !matched.has(t));
	if (missing.length) out.push(line(code, "Stāvi", "storey-missing", { wide: true, w: "Trūkst", now: "—", to: missing.join(", ") }));
	// heights: only for the storeys whose name is (or will be) right, and only where the scheme gives one
	const tol = r.tolerance || 1;
	for (const s of m.storeys) {
		const target = classifyStorey(s.name, scheme).target;
		const want = target ? toNumber(sch.elevations?.[target]) : null;
		if (target && want != null && s.elevation != null && Math.abs(s.elevation - want) > tol) out.push(line(code, "Stāvi", "storey-elevation", { w: `Augstums ${target}`, now: `${formatCoordinate(s.elevation)} mm`, to: `${formatCoordinate(want)} mm` }, target));
	}
	return out;
}

export function auditModel(m: ModelFacts, r: CoordReference): ModelReport {
	const groups: ReportGroup[] = [
		{ g: "Novietne" as const, lines: placementLines(m, r) },
		{ g: "Hierarhija" as const, lines: hierarchyLines(m, r) },
		// the open Revit document has no IFC hierarchy or marker to speak of: only its levels are measured
		{ g: "Stāvi" as const, lines: storeyLines(m, r) },
	].filter((g) => g.lines.length > 0);
	const only = m.source === "revit" ? groups.filter((g) => g.g === "Stāvi") : groups;
	return { code: m.code, file: m.file, source: m.source, app: m.app, ts: m.ts, groups: only };
}

export function buildAudit(models: ModelFacts[], r: CoordReference, date = new Date().toISOString().slice(0, 10)): AuditReport {
	const reports = [...models].sort((a, b) => a.code.localeCompare(b.code, "lv") || a.file.localeCompare(b.file, "lv")).map((m) => auditModel(m, r));
	return { models: reports, reference: r, totalLines: reports.reduce((n, m) => n + m.groups.reduce((k, g) => k + g.lines.length, 0), 0), date };
}

/** Every line of a report, flat: for counting and for the findings. */
export function auditLines(a: AuditReport): (ReportLine & { code: string; file: string; g: string })[] {
	return a.models.flatMap((m) => m.groups.flatMap((g) => g.lines.map((l) => ({ ...l, code: m.code, file: m.file, g: g.g }))));
}

/** The open Revit document as a model: only its levels are known, so only the storeys are measured. */
export function factsFromRevit(title: string, levels: { name: string; elevationMm: number }[], date: string): ModelFacts {
	return { code: disciplineOf(title), file: title, source: "revit", app: "Revit", ts: date, schema: null, project: null, site: null, building: null, storeys: levels.map((l) => ({ name: l.name, elevation: l.elevationMm })).sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0)), cubes: [] };
}
