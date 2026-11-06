// The delivery gate (task 4.3): preparing a delivery runs the checks for it; marking it sent needs no open findings
// that concern it (or the whole project) and Boris's click. The agent has no tool for this.
import type { ProjectStore } from "../core/store.js";
import type { Who } from "../core/model.js";
import { runChecks } from "./run.js";

export async function prepareDelivery(store: ProjectStore, deliveryId: string, opts: { dataDir: string; today: string }): Promise<{ open: number }> {
	if (!store.read("deliveries").some((d) => d.id === deliveryId)) throw new Error(`Nodevums ${deliveryId} nav atrasts.`);
	await runChecks(store, "delivery", { ...opts, deliveryId });
	const open = blocking(store, deliveryId).length;
	store.update("deliveries", (all) => all.map((d) => (d.id === deliveryId ? { ...d, checksRun: [...d.checksRun, { at: new Date().toISOString(), open }] } : d)), { kind: "delivery.prepared", by: "boris", data: { deliveryId, open } });
	return { open };
}

/** Open findings that stop this delivery: its own, and project-wide errors (one truth, citations, rooms, programme). */
export function blocking(store: ProjectStore, deliveryId: string) {
	return store.read("findings").filter((f) => f.state === "open" && f.severity === "error" && (f.where.deliveryId === deliveryId || !f.where.deliveryId));
}

export function markSent(store: ProjectStore, deliveryId: string, by: Who): void {
	if (by !== "boris") throw new Error("Nodevumu kā nosūtītu atzīmē tikai Boris.");
	const d = store.read("deliveries").find((x) => x.id === deliveryId);
	if (!d) throw new Error(`Nodevums ${deliveryId} nav atrasts.`);
	if (!d.checksRun.length) throw new Error("Vispirms sagatavo nodevumu (palaiž pārbaudes).");
	const open = blocking(store, deliveryId);
	if (open.length) throw new Error(`Nodevumu nevar atzīmēt kā nosūtītu: ${open.length} atvērti atradumi (${open.slice(0, 3).map((f) => f.message).join("; ")}${open.length > 3 ? " …" : ""}). Novērs vai pieņem tos ar pamatojumu.`);
	store.update("deliveries", (all) => all.map((x) => (x.id === deliveryId ? { ...x, sent: { at: new Date().toISOString(), by: "boris" as const }, submittedDate: x.submittedDate ?? new Date().toISOString().slice(0, 10) } : x)), { kind: "delivery.sent", by, data: { deliveryId } });
}
