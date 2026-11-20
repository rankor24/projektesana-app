// The project's planning data that the user sets on the screen and the agent may set too (2.6.8: the agent had no tool for
// them): a delivery's planned date, a planned delivery, a TN / approval clock, a document's role. One function each, so the
// IPC handlers and the agent's tools write the same way; `by` says who did it (the event log and the row keep it).
import type { ProjectStore } from "./store.js";
import type { DeliveryKind } from "./model.js";
import { newId } from "./model.js";
import type { ClockItem } from "../rules/clocks.js";
import { withStages } from "../sources/deliveries.js";
import { DOC_ROLES } from "../sources/roles.js";
import type { ScanSummaryRow } from "../shared/api.js";

type Who = "user" | "agent";
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const DELIVERY_KINDS: readonly DeliveryKind[] = ["SKICE", "MBP", "BP", "PR", "DT", "STARP"];

/** A delivery's planned date (null clears it). */
export function setPlannedDate(store: ProjectStore, deliveryId: string, date: string | null, by: Who): void {
	if (date !== null && !ISO.test(date)) throw new Error("Datums formā GGGG-MM-DD.");
	if (!store.read("deliveries").some((x) => x.id === deliveryId)) throw new Error(`Nodevums ${deliveryId} nav atrasts.`);
	store.update("deliveries", (all) => all.map((x) => (x.id === deliveryId ? { ...x, plannedDate: date, plannedFrom: by } : x)), { kind: "delivery.planned", by, data: { deliveryId, date } });
}

/** A planned delivery of a kind on a date (one per kind and date: the same again replaces it). */
export function addPlannedDelivery(store: ProjectStore, kind: DeliveryKind, date: string, by: Who): string {
	if (!ISO.test(date)) throw new Error("Datums formā GGGG-MM-DD.");
	const row = { id: `plan_${kind}_${date}`, kind, label: `${kind} (plānots)`, plannedDate: date, plannedFrom: by, submittedDate: null, folder: null, items: [], checksRun: [] };
	store.update("deliveries", (all) => withStages([...all.filter((x) => x.id !== row.id), row]), { kind: "delivery.planned", by, data: { id: row.id } });
	return row.id;
}

/** A TN or approval clock from the day it was requested. */
export function addClock(store: ProjectStore, c: { kind: ClockItem["kind"]; issuer: string; issuerKind: ClockItem["issuerKind"]; requestedOn: string; sourceId?: string | null }, by: Who): ClockItem {
	if (!ISO.test(c.requestedOn)) throw new Error("Pieprasījuma datums formā GGGG-MM-DD.");
	if (!c.issuer.trim()) throw new Error("Norādi izdevēju.");
	const item: ClockItem = { id: newId("c"), kind: c.kind, issuer: c.issuer.trim(), issuerKind: c.issuerKind, requestedOn: c.requestedOn, extended: false, receivedOn: null, sourceId: c.sourceId ?? null, by };
	store.writeMeta("clocks", [...store.readMeta<ClockItem[]>("clocks", []), item], { kind: "clock.added", by, data: { id: item.id } });
	return item;
}

/** The day a clock's answer came, or that the issuer extended it. */
export function updateClock(store: ProjectStore, clockId: string, patch: { receivedOn?: string | null; extended?: boolean }, by: Who): void {
	if (patch.receivedOn && !ISO.test(patch.receivedOn)) throw new Error("Datums formā GGGG-MM-DD.");
	const all = store.readMeta<ClockItem[]>("clocks", []);
	if (!all.some((c) => c.id === clockId)) throw new Error(`Termiņš ${clockId} nav atrasts.`);
	store.writeMeta(
		"clocks",
		all.map((c) => (c.id === clockId ? { ...c, ...("receivedOn" in patch ? { receivedOn: patch.receivedOn ?? null } : {}), ...("extended" in patch ? { extended: !!patch.extended } : {}) } : c)),
		{ kind: "clock.updated", by, data: { id: clockId } },
	);
}

/** A document's own role (null = back to its folder's role, the one the last scan gave the folder). */
export function setSourceRole(store: ProjectStore, sourceId: string, role: string | null, by: Who): void {
	if (role !== null && !DOC_ROLES.includes(role)) throw new Error(`Nezināma loma: ${role}. Lomas: ${DOC_ROLES.join(", ")}`);
	const src = store.read("sources").find((s) => s.id === sourceId);
	if (!src) throw new Error(`Avots ${sourceId} nav atrasts.`);
	const byDoc = { ...store.readMeta<Record<string, string>>("source-roles", {}) };
	if (role) byDoc[sourceId] = role;
	else delete byDoc[sourceId];
	store.writeMeta("source-roles", byDoc, { kind: "source.role", by, data: { sourceId, role } });
	const folder = store.readMeta<ScanSummaryRow | null>("scan", null)?.folders.find((f) => f.folderKey === src.folderKey);
	store.update(
		"sources",
		(all) => all.map((s) => (s.id !== sourceId ? s : role ? { ...s, role, roleFrom: "document" as const } : { ...s, role: folder?.role ?? "Cits", roleFrom: folder?.roleFrom ?? ("unconfirmed" as const) })),
		{ kind: "sources.role", by, data: { sourceId, role } },
	);
}
