// The agent's planning tools (2.6.8): what the user sets on the Grafiks / Nodevumi / Avoti screens, the agent can read and set
// too: the stages' dates, planned deliveries, TN and approval clocks, a document's role, an expert remark's person and daļa.
// Each write goes through the same function as the screen (core/planning.ts, core/stage-dates.ts, core/expertise.ts), marked
// as the agent's. Parameter names are ASCII only (providers refuse others: "daļa" is "dala").
import { z } from "zod";
import { BIM_STAGES, type BimStage, type DeliveryKind } from "../../core/model.js";
import { readStageDates, setStageDates } from "../../core/stage-dates.js";
import { addClock, addPlannedDelivery, DELIVERY_KINDS, setPlannedDate, setSourceRole, updateClock } from "../../core/planning.js";
import { editRemark } from "../../core/expertise.js";
import { clockOf, type ClockItem } from "../../rules/clocks.js";
import { DOC_ROLES } from "../../sources/roles.js";
import { deleteRooms, editRoom, setCorrectedRooms } from "../../sources/room-table.js";
import { storeOf } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "GGGG-MM-DD");
const today = () => new Date().toISOString().slice(0, 10);

/** What each planning tool changes, for the window to reload (thread-runner sends it when the tool succeeded). */
export const PLANNING_TOOL_DATA: Record<string, string[]> = {
	set_stage_dates: ["stages"],
	plan_delivery: ["deliveries"],
	set_clock: ["clocks"],
	set_source_role: ["sources", "roles"],
	expert_edit: ["expertise", "findings"],
	set_inventory_rooms: ["rooms", "findings"],
	delete_inventory_rooms: ["rooms", "findings"],
	edit_inventory_room: ["rooms", "findings"],
};

export const planningTools: ToolDef[] = [
	tool({
		name: "set_inventory_rooms",
		level: "run",
		description:
			"Write a property document's room table as it really is, when the one code read is wrong or incomplete (list_rooms state 'skenēts'): every room of the document, read from its pages (read_source; a scan's text is OCR, so read the columns carefully: number, name without the room type, floor, area m², height m). The rows replace the parsed ones everywhere (Telpas panel, comparison with the model, checks). Leave out group totals. clear: true goes back to what code reads.",
		input: {
			sourceId: z.string(),
			rows: z
				.array(z.object({ floor: z.string().describe("stāvs as the document writes it, e.g. 1, 2, pagrabs"), no: z.string(), name: z.string(), area: z.number().positive(), height: z.number().positive().nullable().optional(), page: z.number().int().min(1) }))
				.optional(),
			clear: z.boolean().optional(),
		},
		run: (ctx, a) => {
			if (!a.clear && !a.rows?.length) throw new Error("Vajag rows (visas dokumenta telpas) vai clear: true.");
			const r = setCorrectedRooms(storeOf(ctx), a.sourceId, a.clear ? null : a.rows!.map((r) => ({ ...r, height: r.height ?? null })), "agent");
			return {
				ok: true,
				sourceId: a.sourceId,
				rooms: a.clear ? "atpakaļ pie koda nolasītā" : r.rooms,
				...(r.skipped ? { skippedDeleted: r.skipped, note: `${r.skipped} telpas netika ierakstītas: tās lietotājs vai aģents jau dzēsa. Ja tās vajag, pajautā lietotājam un izmanto clear: true.` } : {}),
			};
		},
	}),
	tool({
		name: "delete_inventory_rooms",
		level: "confirm",
		description:
			"Delete wrong rooms from a property document's room table (the Telpas panel, comparison with the model, checks): the ids of the rows (list_rooms gives each room's id), or all: true for the whole table of that document. Waits for the user's click. The deleted rooms stay deleted when the document is read again; the Telpas panel's «Atjaunot no dokumenta» (or set_inventory_rooms with clear: true) brings the document's own rows back. To fix a room instead of removing it use edit_inventory_room.",
		input: { sourceId: z.string(), rowIds: z.array(z.string()).optional().describe("room ids from list_rooms"), all: z.boolean().optional() },
		run: async (ctx, a) => {
			if (!a.all && !a.rowIds?.length) throw new Error("Vajag rowIds (telpu id no list_rooms) vai all: true.");
			const r = await deleteRooms(storeOf(ctx), a.sourceId, a.all ? "all" : a.rowIds!, "agent");
			return { ok: true, sourceId: a.sourceId, removed: r.removed, left: r.left, ...(r.unknown.length ? { unknownIds: r.unknown } : {}) };
		},
	}),
	tool({
		name: "edit_inventory_room",
		level: "run",
		description:
			"Change one room of a property document's room table (id from list_rooms): any of floor, no, name, area (m²), height (m, null clears), page. The other rooms stay. Use it for a wrong name, area or number, after checking the page (view_page); say what you changed and why.",
		input: {
			sourceId: z.string(),
			roomId: z.string().describe("the room's id from list_rooms"),
			floor: z.string().optional(),
			no: z.string().optional(),
			name: z.string().optional(),
			area: z.number().positive().optional(),
			height: z.number().positive().nullable().optional(),
			page: z.number().int().min(1).optional(),
		},
		run: async (ctx, a) => {
			const { sourceId, roomId, ...patch } = a;
			const r = await editRoom(storeOf(ctx), sourceId, roomId, patch, "agent");
			return { ok: true, sourceId, room: r };
		},
	}),
	tool({
		name: "get_schedule",
		level: "read",
		description: "The project's schedule as the Grafiks page shows it: each BIM stage's start and end (none = not set), the planned and sent deliveries with their dates, and the TN / approval clocks with their due dates.",
		input: {},
		run: (ctx) => {
			const store = storeOf(ctx);
			const dates = readStageDates(store);
			return {
				stages: BIM_STAGES.map((s) => ({ stage: s, ...(dates[s] ?? { start: null, end: null }) })),
				deliveries: store.read("deliveries").map((d) => ({ id: d.id, kind: d.kind, label: d.label, stage: d.stage, plannedDate: d.plannedDate ?? null, plannedFrom: d.plannedFrom ?? null, submittedDate: d.submittedDate })),
				clocks: store.readMeta<ClockItem[]>("clocks", []).map((c) => ({ ...c, ...clockOf(c, today()) })),
			};
		},
	}),
	tool({
		name: "set_stage_dates",
		level: "run",
		description: `Set one BIM stage's start and end on the schedule (the Gantt bar), or clear them (clear: true). Stages: ${BIM_STAGES.join(", ")}. Take the dates from a source (contract, BIP schedule) and say which.`,
		input: { stage: z.enum(BIM_STAGES), start: ISO_DATE.optional(), end: ISO_DATE.optional(), clear: z.boolean().optional() },
		run: (ctx, a) => {
			if (!a.clear && (!a.start || !a.end)) throw new Error("Vajag start un end (vai clear: true).");
			const r = setStageDates(storeOf(ctx), a.stage as BimStage, a.clear ? null : { start: a.start!, end: a.end! }, "agent");
			return { ok: true, stage: a.stage, dates: r[a.stage as BimStage] ?? null };
		},
	}),
	tool({
		name: "plan_delivery",
		level: "run",
		description: `Plan a delivery: with kind + date adds a planned delivery (${DELIVERY_KINDS.join(", ")}); with deliveryId + date sets that delivery's planned date (date null clears it). Ids from get_schedule or list_deliveries.`,
		input: { kind: z.enum(DELIVERY_KINDS as [DeliveryKind, ...DeliveryKind[]]).optional(), deliveryId: z.string().optional(), date: ISO_DATE.nullable() },
		run: (ctx, a) => {
			const store = storeOf(ctx);
			if (a.deliveryId) return setPlannedDate(store, a.deliveryId, a.date, "agent"), { ok: true, deliveryId: a.deliveryId, plannedDate: a.date };
			if (!a.kind || !a.date) throw new Error("Vajag kind un date (jaunam plānotam nodevumam) vai deliveryId (esošam).");
			return { ok: true, deliveryId: addPlannedDelivery(store, a.kind, a.date, "agent"), plannedDate: a.date };
		},
	}),
	tool({
		name: "set_clock",
		level: "run",
		description:
			"A TN or approval deadline clock: without clockId adds one (kind tn|approval, issuer, issuerKind state_municipal|network_owner, requestedOn, the source it comes from); with clockId records the answer's date (receivedOn) or that the issuer extended it. Due dates follow the law's working days.",
		input: {
			clockId: z.string().optional(),
			kind: z.enum(["tn", "approval"]).optional(),
			issuer: z.string().optional(),
			issuerKind: z.enum(["state_municipal", "network_owner"]).optional(),
			requestedOn: ISO_DATE.optional(),
			sourceId: z.string().optional(),
			receivedOn: ISO_DATE.nullable().optional(),
			extended: z.boolean().optional(),
		},
		run: (ctx, a) => {
			const store = storeOf(ctx);
			if (a.clockId) {
				updateClock(store, a.clockId, { ...(a.receivedOn !== undefined ? { receivedOn: a.receivedOn } : {}), ...(a.extended !== undefined ? { extended: a.extended } : {}) }, "agent");
				return { ok: true, clockId: a.clockId };
			}
			if (!a.kind || !a.issuer || !a.issuerKind || !a.requestedOn) throw new Error("Jaunam termiņam vajag kind, issuer, issuerKind un requestedOn.");
			const c = addClock(store, { kind: a.kind, issuer: a.issuer, issuerKind: a.issuerKind, requestedOn: a.requestedOn, sourceId: a.sourceId ?? null }, "agent");
			return { ok: true, clock: { ...c, ...clockOf(c, today()) } };
		},
	}),
	tool({
		name: "set_source_role",
		level: "run",
		description: `Set a document's role, which decides what the app reads from it (a room table needs Īpašuma dokumenti, PU, Iepirkums, Info no pasūtītāja or Cits); role null = back to its folder's role. Roles: ${DOC_ROLES.join(", ")}.`,
		input: { sourceId: z.string(), role: z.string().nullable() },
		run: (ctx, a) => {
			setSourceRole(storeOf(ctx), a.sourceId, a.role, "agent");
			return { ok: true, sourceId: a.sourceId, role: a.role, note: "Prasības un pārbaudes tiek pārrēķinātas." };
		},
	}),
	tool({
		name: "expert_edit",
		level: "propose",
		description: "Set an expert remark's responsible person or dala (the daļa: AR, BK, …) when a source says it; null clears. Never invent either.",
		input: { remarkId: z.string(), responsible: z.string().nullable().optional(), dala: z.string().nullable().optional() },
		run: (ctx, a) => {
			const r = editRemark(storeOf(ctx), a.remarkId, { ...(a.responsible !== undefined ? { responsible: a.responsible } : {}), ...(a.dala !== undefined ? { daļa: a.dala } : {}) });
			return { ok: true, id: r.id, responsible: r.responsible, dala: r.daļa };
		},
	}),
];
