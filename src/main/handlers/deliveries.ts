// Deliveries (prepare = run checks, mark sent = the gate, planned dates) and the timeline clocks.
import { markSent, prepareDelivery } from "../../checks/gate.js";
import { newId, type DeliveryKind } from "../../core/model.js";
import type { Registry } from "../../core/registry.js";
import { clockOf, type ClockItem } from "../../rules/clocks.js";
import { withStages } from "../../sources/deliveries.js";
import { draftOf, stageFile, startDraft, unstageFile } from "../../sources/staging.js";
import { checklistOf, type SheetRow } from "../../checks/checklist.js";
import { revitExport } from "../../revit/exports.js";
import { stageRevitIfc, stageRevitSheets } from "../../revit/stage.js";
import type { RevitClient } from "../../revit/client.js";
import { copyDelivery, copyPlan } from "../../sources/deliver-copy.js";
import { refreshDeliveries } from "../../sources/pipeline.js";
import { runChecks } from "../../checks/run.js";
import { renamePlan, renameStaged, undoRenameBatch } from "../../sources/staging-rename.js";
import type { EventName, EventSpec, Handlers } from "../../shared/api.js";

export interface DeliveryDeps {
	registry: Registry;
	dataDir: string;
	emit<E extends EventName>(event: E, payload: EventSpec[E]): void;
	revit: RevitClient;
	openPath(p: string): Promise<string>;
}

type K = "deliveries.copyPlan" | "deliveries.copy" | "deliveries.checklist" | "deliveries.stageSheets" | "deliveries.stageIfc" | "deliveries.stageFile" | "deliveries.unstage" | "deliveries.renamePlan" | "deliveries.renameApply" | "deliveries.renameUndo" | "deliveries.openStaging" | "deliveries.start" | "deliveries.prepare" | "deliveries.markSent" | "deliveries.setPlanned" | "deliveries.addPlanned" | "timeline.clocks" | "clocks.add" | "clocks.update";

const today = () => new Date().toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The model's sheets for the checklist, or why not: a page load does not wait the 120 s a Revit call may take. */
async function sheetsOrNote(revit: RevitClient, ms = 8000): Promise<{ sheets: SheetRow[] | null; note: string | null }> {
	if (!revit.where()) return { sheets: null, note: "Revit MCP nav konfigurēts" };
	let timer: NodeJS.Timeout | undefined;
	try {
		const sheets = await Promise.race([revitExport.listSheets(revit), new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("Revit neatbild")), ms)))]);
		return { sheets, note: null };
	} catch (e) {
		return { sheets: null, note: (e as Error).message.split("\n")[0].slice(0, 160) };
	} finally {
		clearTimeout(timer);
	}
}

export function deliveryHandlers(d: DeliveryDeps): Pick<Handlers, K> {
	const changed = (id: string) => d.emit("data.changed", { projectId: id, what: ["deliveries", "findings"] });
	const progress = (id: string, run: string, done: number, total: number, current: string) =>
		d.emit("activity", { run, project: id, who: "app", at: new Date().toISOString(), kind: done >= total ? "done" : "note", text: done >= total ? `Lapas eksportētas: ${total}` : `Eksportē lapas: ${done + 1} no ${total} — ${current}`, step: "sheets", progress: { done, total } });
	return {
		"deliveries.checklist": async (id, deliveryId, withRevit) => {
			const store = d.registry.store(id);
			const r = withRevit ? await sheetsOrNote(d.revit) : { sheets: null, note: "lapu saraksts no Revit nav prasīts" };
			return { rows: checklistOf(store, deliveryId, { today: today(), sheets: r.sheets, revitNote: r.note }), revitNote: r.note };
		},
		"deliveries.stageSheets": async (id, deliveryId, opts) => {
			const run = `sheets-${Date.now().toString(36)}`;
			try {
				return await stageRevitSheets(d.registry.store(id), d.revit, deliveryId, { ...opts, onProgress: (n, t, c) => progress(id, run, n, t, c) }, "user");
			} finally {
				changed(id);
			}
		},
		"deliveries.stageIfc": async (id, deliveryId, opts) => {
			try {
				return await stageRevitIfc(d.registry.store(id), d.revit, deliveryId, opts, "user");
			} finally {
				changed(id);
			}
		},
		"deliveries.stageFile": (id, deliveryId, from, name) => {
			const r = stageFile(d.registry.store(id), deliveryId, from, name, "user", true);
			changed(id);
			return r;
		},
		"deliveries.unstage": (id, deliveryId, name) => {
			unstageFile(d.registry.store(id), deliveryId, name, "user");
			changed(id);
		},
		"deliveries.renamePlan": (id, deliveryId, mode, revision) => renamePlan(d.registry.store(id), deliveryId, mode, revision),
		"deliveries.renameApply": async (id, deliveryId, pairs) => {
			const store = d.registry.store(id);
			const r = renameStaged(store, deliveryId, pairs, "user");
			// the names are what the filenames check reads: say at once whether they are right now
			if (r.applied) await runChecks(store, "delivery", { dataDir: d.dataDir, today: today(), deliveryId, only: ["filenames"] }).catch(() => undefined);
			changed(id);
			return r;
		},
		"deliveries.renameUndo": async (id, deliveryId, batch) => {
			const store = d.registry.store(id);
			const r = undoRenameBatch(store, deliveryId, batch);
			if (r.reverted) await runChecks(store, "delivery", { dataDir: d.dataDir, today: today(), deliveryId, only: ["filenames"] }).catch(() => undefined);
			changed(id);
			return r;
		},
		"deliveries.openStaging": async (id, deliveryId) => {
			const err = await d.openPath(draftOf(d.registry.store(id), deliveryId).draft.stagingDir);
			if (err) throw new Error(err);
		},
		"deliveries.copyPlan": (id, deliveryId) => copyPlan(d.registry.store(id), deliveryId),
		"deliveries.copy": async (id, deliveryId) => {
			const store = d.registry.store(id);
			try {
				const r = await copyDelivery(store, deliveryId, "user");
				await refreshDeliveries(store, store.project.root);
				return r;
			} finally {
				changed(id);
			}
		},
		"deliveries.start": (id, kind, date) => {
			const row = startDraft(d.registry.store(id), kind, date, "user");
			changed(id);
			return row;
		},
		"deliveries.prepare": async (id, deliveryId) => {
			const r = await prepareDelivery(d.registry.store(id), deliveryId, { dataDir: d.dataDir, today: today() });
			changed(id);
			return r;
		},
		"deliveries.markSent": (id, deliveryId) => {
			markSent(d.registry.store(id), deliveryId, "user");
			changed(id);
		},
		"deliveries.setPlanned": (id, deliveryId, date) => {
			if (date !== null && !ISO.test(date)) throw new Error("Datums formā GGGG-MM-DD.");
			d.registry.store(id).update("deliveries", (all) => all.map((x) => (x.id === deliveryId ? { ...x, plannedDate: date, plannedFrom: "user" as const } : x)), { kind: "delivery.planned", by: "user", data: { deliveryId, date } });
			changed(id);
		},
		"deliveries.addPlanned": (id, kind, date) => {
			if (!ISO.test(date)) throw new Error("Datums formā GGGG-MM-DD.");
			const k = kind as DeliveryKind;
			const row = { id: `plan_${k}_${date}`, kind: k, label: `${k} (plānots)`, plannedDate: date, plannedFrom: "user" as const, submittedDate: null, folder: null, items: [], checksRun: [] };
			d.registry.store(id).update("deliveries", (all) => withStages([...all.filter((x) => x.id !== row.id), row]), { kind: "delivery.planned", by: "user", data: { id: row.id } });
			changed(id);
		},
		"timeline.clocks": (id) => d.registry.store(id).readMeta<ClockItem[]>("clocks", []).map((c) => clockOf(c, today())),
		"clocks.add": (id, c) => {
			if (!ISO.test(c.requestedOn)) throw new Error("Pieprasījuma datums formā GGGG-MM-DD.");
			if (!c.issuer.trim()) throw new Error("Norādi izdevēju.");
			const store = d.registry.store(id);
			const item: ClockItem = { id: newId("c"), kind: c.kind, issuer: c.issuer.trim(), issuerKind: c.issuerKind, requestedOn: c.requestedOn, extended: false, receivedOn: null, sourceId: null, by: "user" };
			store.writeMeta("clocks", [...store.readMeta<ClockItem[]>("clocks", []), item], { kind: "clock.added", by: "user", data: { id: item.id } });
			d.emit("data.changed", { projectId: id, what: ["clocks"] });
		},
		"clocks.update": (id, clockId, patch) => {
			if (patch.receivedOn && !ISO.test(patch.receivedOn)) throw new Error("Datums formā GGGG-MM-DD.");
			const store = d.registry.store(id);
			const all = store.readMeta<ClockItem[]>("clocks", []);
			if (!all.some((c) => c.id === clockId)) throw new Error(`Termiņš ${clockId} nav atrasts.`);
			store.writeMeta("clocks", all.map((c) => (c.id === clockId ? { ...c, ...("receivedOn" in patch ? { receivedOn: patch.receivedOn ?? null } : {}), ...("extended" in patch ? { extended: !!patch.extended } : {}) } : c)), { kind: "clock.updated", by: "user", data: { id: clockId } });
			d.emit("data.changed", { projectId: id, what: ["clocks"] });
		},
	};
}
