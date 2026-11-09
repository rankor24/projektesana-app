// Deliveries (prepare = run checks, mark sent = the gate, planned dates) and the timeline clocks.
import { markSent, prepareDelivery } from "../../checks/gate.js";
import { newId, type DeliveryKind } from "../../core/model.js";
import type { Registry } from "../../core/registry.js";
import { clockOf, type ClockItem } from "../../rules/clocks.js";
import { withStages } from "../../sources/deliveries.js";
import type { EventName, EventSpec, Handlers } from "../../shared/api.js";

export interface DeliveryDeps {
	registry: Registry;
	dataDir: string;
	emit<E extends EventName>(event: E, payload: EventSpec[E]): void;
}

type K = "deliveries.prepare" | "deliveries.markSent" | "deliveries.setPlanned" | "deliveries.addPlanned" | "timeline.clocks" | "clocks.add" | "clocks.update";

const today = () => new Date().toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function deliveryHandlers(d: DeliveryDeps): Pick<Handlers, K> {
	const changed = (id: string) => d.emit("data.changed", { projectId: id, what: ["deliveries", "findings"] });
	return {
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
