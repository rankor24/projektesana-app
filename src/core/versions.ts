// "Kas mainījās starp" (task 5.5): sources, deliveries, revisions and the app's own data between two dates in one list,
// newest first, each row with what to compare it against. Compare references: "blob:<sha>" (a kept PDF version),
// "rev:<id>" (a revision's IFC), or a file path relative to the project folder.
import type { ProjectStore } from "./store.js";
import type { VersionRow } from "../shared/api.js";
export type { VersionRow };
import { existsSync } from "node:fs";
import { join } from "node:path";


const inRange = (iso: string | null | undefined, from: string, to: string) => !!iso && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;

export function versionsBetween(store: ProjectStore, from: string, to: string): VersionRow[] {
	const out: VersionRow[] = [];
	const blob = (sha: string) => existsSync(join(store.dir, "blobs", `${sha}.pdf`));
	for (const s of store.read("sources")) {
		s.versions.forEach((v, i) => {
			if (!inRange(v.mtime, from, to) && !inRange(v.seenAt, from, to)) return;
			const prev = s.versions[i - 1];
			out.push({
				at: v.mtime,
				kind: "source",
				label: `${s.title} — ${i === 0 ? "pirmā versija" : `versija ${i + 1}`}`,
				detail: `${s.role}${s.paths.length > 1 ? ` · ${s.paths.length} vietās` : ""}`,
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
	// the app's own data: what Boris and the agent decided, counted per day and kind
	const days = new Map<string, Map<string, number>>();
	for (const e of store.events()) {
		if (!inRange(e.at, from, to) || /^(sources\.|checks\.ran|requirements\.(refreshed|status)|deliveries\.read|test\.)/.test(e.kind)) continue;
		const day = e.at.slice(0, 10);
		const m = days.get(day) ?? new Map<string, number>();
		m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
		days.set(day, m);
	}
	for (const [day, m] of days) out.push({ at: `${day}T23:59:59.000Z`, kind: "data", label: `Lietotnes dati ${day}`, detail: [...m].map(([k, n]) => `${k} ×${n}`).join(", ") });
	return out.sort((a, b) => b.at.localeCompare(a.at));
}
