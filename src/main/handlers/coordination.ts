// The coordination audit for the panel (task 8.9): the project's reference, the audit of its models against it, the warnings a
// seeded reference leaves behind, and the HTML report. The reference is stored per project (it is edited by hand: BIPs contradict
// themselves) and is the only thing written here, besides the report file in the draft's staging folder or the exports folder.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildAudit, EMPTY_REFERENCE, factsFromRevit, referenceWarnings, seedReference } from "../../core/coordination.js";
import { renderAuditHtml } from "../../core/coordination-html.js";
import type { CoordReference, ModelFacts } from "../../core/coordination-types.js";
import { checkWrite } from "../../core/guard.js";
import type { Registry } from "../../core/registry.js";
import type { ProjectEngine } from "../engine.js";
import type { Handlers } from "../../shared/api.js";
import { COORDINATION_META } from "../../checks/checks/coordination.js";
import { revitRead } from "../../revit/commands.js";
import type { RevitClient } from "../../revit/client.js";
import { revitExport } from "../../revit/exports.js";
import { auditedModels, projectFacts } from "../../sources/ifc-facts.js";
import { draftOf, refreshDraft } from "../../sources/staging.js";
import { coordinatesGuide, guideInput } from "../../rules/coordinates-guide.js";

type K = "coordination.get" | "coordination.save" | "coordination.seed" | "coordination.report" | "coordination.guide";

const today = () => new Date().toISOString().slice(0, 10);

/** The Revit document's levels as a model, or why not: a page load does not wait the long time a Revit call may take. */
async function revitModel(revit: RevitClient, ms = 8000): Promise<{ facts: ModelFacts | null; note: string | null }> {
	if (!revit.where()) return { facts: null, note: "Revit MCP nav konfigurēts" };
	let timer: NodeJS.Timeout | undefined;
	try {
		const both = Promise.all([revitExport.docInfo(revit), revitRead.levels(revit)]);
		const [doc, levels] = await Promise.race([both, new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("Revit neatbild")), ms)))]);
		return { facts: factsFromRevit(doc.title, levels, today()), note: null };
	} catch (e) {
		return { facts: null, note: (e as Error).message.split("\n")[0].slice(0, 160) };
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export function coordinationHandlers(d: { registry: Registry; engine: ProjectEngine; revit: RevitClient; bimcraftApp: string; emit: (e: "data.changed", p: { projectId: string | null; what: string[] }) => void }): Pick<Handlers, K> {
	const changed = (id: string) => d.emit("data.changed", { projectId: id, what: ["coordination", "findings"] });
	return {
		"coordination.get": async (id, withRevit) => {
			const store = d.registry.store(id);
			const reference = store.readMeta<CoordReference | null>(COORDINATION_META, null);
			const models = (await auditedModels(store)).length;
			if (!reference) return { reference: null, audit: null, warnings: [], models, errors: [], revit: null };
			const { facts, errors } = await projectFacts(d.bimcraftApp, store, reference.cubeNames);
			const rv = withRevit ? await revitModel(d.revit) : { facts: null, note: null };
			const all = rv.facts ? [...facts, rv.facts] : facts;
			return { reference, audit: buildAudit(all, reference, today()), warnings: referenceWarnings(reference, facts), models, errors, revit: rv.note };
		},
		"coordination.save": async (id, reference) => {
			if (!Number.isFinite(reference.tolerance) || reference.tolerance < 0) throw new Error("Pielaide ir skaitlis, 0 vai lielāks (mm).");
			if (!reference.cubeNames.some((n) => n.trim())) throw new Error("Norādi vismaz vienu kuba nosaukumu.");
			if (!reference.storeySchemes.length) throw new Error("Vajag vismaz vienu stāvu shēmu.");
			const store = d.registry.store(id);
			const saved: CoordReference = { ...EMPTY_REFERENCE, ...reference, cubeNames: reference.cubeNames.map((n) => n.trim()).filter(Boolean), updatedAt: new Date().toISOString() };
			store.writeMeta(COORDINATION_META, saved, { kind: "coordination.saved", by: "user" });
			await d.engine.afterChange(store, "manual", { only: ["coordination"] });
			changed(id);
		},
		"coordination.seed": async (id, declared) => {
			const store = d.registry.store(id);
			const prev = store.readMeta<CoordReference | null>(COORDINATION_META, null);
			const { facts } = await projectFacts(d.bimcraftApp, store, prev?.cubeNames ?? EMPTY_REFERENCE.cubeNames);
			if (!facts.length) throw new Error("Projektā nav IFC modeļu, no kuriem sākt (1.2_Projekta dalas).");
			// a second pass with the marker names the models actually use, so the base point can be read from them
			const names = seedReference(facts, declared).cubeNames;
			const again = (await projectFacts(d.bimcraftApp, store, names)).facts;
			const ref = seedReference(again, declared);
			store.writeMeta(COORDINATION_META, ref, { kind: "coordination.seeded", by: "user" });
			await d.engine.afterChange(store, "manual", { only: ["coordination"] });
			changed(id);
			return ref;
		},
		"coordination.guide": (id) => {
			const store = d.registry.store(id);
			const input = guideInput(store, today());
			if (!input) throw new Error("Vispirms izveido koordinācijas atsauci.");
			const md = coordinatesGuide(input);
			// one note, replaced each time (the earlier text is kept in versions), not a new note per click
			store.writeNote({ id: "n_coords_guide", type: "learning", title: "Koplietotās koordinātes: instrukcija Revit", body: md, refs: [], by: "app", at: new Date().toISOString() });
			d.emit("data.changed", { projectId: id, what: ["notes"] });
			return md;
		},
		"coordination.report": async (id, deliveryId) => {
			const store = d.registry.store(id);
			const reference = store.readMeta<CoordReference | null>(COORDINATION_META, null);
			if (!reference) throw new Error("Vispirms izveido koordinācijas atsauci.");
			const { facts } = await projectFacts(d.bimcraftApp, store, reference.cubeNames, deliveryId ?? undefined);
			const html = renderAuditHtml(buildAudit(facts, reference, today()), { title: "Modeļu koordinācijas atskaite", project: `${store.project.id} ${store.project.name}` });
			const file = deliveryId ? join(draftOf(store, deliveryId).draft.stagingDir, `Koordinacijas_atskaite_${today()}.html`) : join(store.dir, "exports", `${store.project.id}_koordinacija_${today()}.html`);
			const g = checkWrite(store.guard, file);
			if (!g.ok) throw new Error(g.reason);
			mkdirSync(join(g.path, ".."), { recursive: true });
			writeFileSync(g.path, html, "utf8");
			if (deliveryId) refreshDraft(store, deliveryId, "user");
			store.log({ kind: "coordination.report", by: "user", data: { file: g.path, lines: buildAudit(facts, reference, today()).totalLines } });
			return g.path;
		},
	};
}
