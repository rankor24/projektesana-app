// "Kas mainījās starp" (task 5.5): sources, deliveries, revisions and the app's own data between two dates in one list,
// newest first, each row with what to compare it against. Compare references: "blob:<sha>" (a kept PDF version),
// "rev:<id>" (a revision's IFC), or a file path relative to the project folder.
// A reissue is usually a new file next to the old one ("…_01.pdf" → "…_02.pdf", or the same name in another folder), not new
// bytes under the same path, so the scan makes it a separate Source. Sources whose names differ only by the revision suffix
// form a series here, and each later one is compared with the one before it ("src:<sourceId>" refs).
import type { ProjectStore } from "./store.js";
import type { Source } from "./model.js";
import { modeOfFile } from "../shared/compare2d.js";
import { seriesKey } from "../shared/drawing-sets.js";
import type { VersionRow } from "../shared/api.js";
export type { VersionRow };
import { existsSync } from "node:fs";
import { join } from "node:path";


const inRange = (iso: string | null | undefined, from: string, to: string) => !!iso && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;

export { seriesKey };

const fileOf = (s: Source) => s.container?.inner ?? s.paths[0]?.split("::").pop() ?? "";
/** The compare a reissue opens in: PDF sheets, DWG drawings (CadCraft) or documents word by word; null = not chained. */
export const seriesMode = (s: Source): "sheet" | "dwg" | "text" | null => {
	const m = modeOfFile(fileOf(s));
	return m === "sheet" || m === "dwg" || m === "text" ? m : null;
};
const firstSeen = (s: Source) => s.versions[0]?.mtime ?? "";

/**
 * For each PDF, DWG or document source, the source it reissues: the previous one of its series by first date (then by name).
 * A series is one kind of file: a DOCX and the PDF printed from it never chain.
 */
export function seriesPrev(sources: Source[]): Map<string, Source> {
	const groups = new Map<string, Source[]>();
	for (const s of sources) {
		const m = seriesMode(s);
		if (s.survey || !s.versions.length || !m) continue;
		const k = `${m}:${seriesKey(s.title)}`;
		groups.set(k, [...(groups.get(k) ?? []), s]);
	}
	const prev = new Map<string, Source>();
	for (const g of groups.values()) {
		g.sort((a, b) => firstSeen(a).localeCompare(firstSeen(b)) || a.title.localeCompare(b.title));
		g.forEach((s, i) => i > 0 && prev.set(s.id, g[i - 1]));
	}
	return prev;
}

export function versionsBetween(store: ProjectStore, from: string, to: string): VersionRow[] {
	const out: VersionRow[] = [];
	const blob = (sha: string) => existsSync(join(store.dir, "blobs", `${sha}.pdf`));
	const sources = store.read("sources");
	const reissues = seriesPrev(sources);
	for (const s of sources) {
		s.versions.forEach((v, i) => {
			if (!inRange(v.mtime, from, to) && !inRange(v.seenAt, from, to)) return;
			const prev = s.versions[i - 1];
			const before = i === 0 ? reissues.get(s.id) : undefined;
			const places = s.paths.length > 1 ? ` · ${s.paths.length} vietās` : "";
			if (before) {
				const day = firstSeen(before).slice(0, 10);
				out.push({
					at: v.mtime,
					kind: "source",
					label: `${s.title} — jauna versija`,
					detail: `${s.role}${places} · iepriekšējā: ${before.title} (${day})`,
					compare: { a: `src:${before.id}`, b: `src:${s.id}`, mode: seriesMode(s) ?? "sheet", aLabel: `${before.title} · ${day}`, bLabel: `${s.title} · ${v.mtime.slice(0, 10)}` },
					open: { sourceId: s.id },
				});
				return;
			}
			out.push({
				at: v.mtime,
				kind: "source",
				label: `${s.title} — ${i === 0 ? "pirmā versija" : `versija ${i + 1}`}`,
				detail: `${s.role}${places}`,
				compare: prev && blob(prev.sha256) && blob(v.sha256) ? { a: `blob:${prev.sha256}`, b: `blob:${v.sha256}`, mode: "sheet", aLabel: `${s.title} v${i}`, bLabel: `${s.title} v${i + 1}` } : undefined,
				open: { sourceId: s.id },
			});
		});
	}
	const deliveries = store.read("deliveries");
	for (const d of deliveries) {
		if (!inRange(d.submittedDate ?? d.sent?.at, from, to)) continue;
		const prev = deliveries.filter((x) => x.kind === d.kind && x.id !== d.id && (x.submittedDate ?? "") < (d.submittedDate ?? "")).sort((a, b) => (b.submittedDate ?? "").localeCompare(a.submittedDate ?? ""))[0];
		// the first sheet both deliveries have, by sheet number: compare that one; the Nodevumi panel lists the rest
		const pair = prev ? d.items.map((it) => [prev.items.find((p) => p.sheetNo && p.sheetNo === it.sheetNo), it] as const).find(([p, it]) => p && /\.pdf$/i.test(it.file)) : undefined;
		out.push({
			at: d.submittedDate ?? d.sent!.at,
			kind: "delivery",
			label: `${d.label} (${d.stage})`,
			detail: `${d.items.length} faili${d.sent ? " · nosūtīts" : ""}${prev ? ` · iepriekšējais ${prev.label}` : ""}`,
			compare: pair && pair[0] ? { a: pair[0].file, b: pair[1].file, mode: "sheet", aLabel: `${prev!.label} ${pair[0].sheetNo}`, bLabel: `${d.label} ${pair[1].sheetNo}` } : undefined,
		});
	}
	const revs = store.read("revisions");
	revs.forEach((r, i) => {
		if (!inRange(r.at, from, to)) return;
		const prev = revs.slice(0, i).reverse().find((x) => x.ifc);
		out.push({
			at: r.at,
			kind: "revision",
			label: `Revīzija ${r.id}${r.trigger === "agentBatch" ? " (aģenta partija)" : ""}`,
			detail: r.summary + (r.diffFromPrev ? ` · +${r.diffFromPrev.added} −${r.diffFromPrev.removed} ~${r.diffFromPrev.changed}` : ""),
			compare: r.ifc && prev?.ifc ? { a: `rev:${prev.id}`, b: `rev:${r.id}`, mode: "ifc", aLabel: `rev ${prev.id}`, bLabel: `rev ${r.id}` } : undefined,
			open: r.ifc ? { ifc: `rev:${r.id}` } : undefined,
		});
	});
	// the app's own data: what the user and the agent decided, counted per day and kind
	const days = new Map<string, Map<string, number>>();
	for (const e of store.events()) {
		if (!inRange(e.at, from, to) || /^(sources\.|project\.created|checks\.ran|requirements\.(refreshed|status)|deliveries\.read|test\.)/.test(e.kind)) continue;
		const day = e.at.slice(0, 10);
		const m = days.get(day) ?? new Map<string, number>();
		m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
		days.set(day, m);
	}
	for (const [day, m] of days) out.push({ at: `${day}T23:59:59.000Z`, kind: "data", label: `Lietotnes dati ${day}`, detail: [...m].map(([k, n]) => `${k} ×${n}`).join(", ") });
	return out.sort((a, b) => b.at.localeCompare(a.at));
}
