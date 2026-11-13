// Model coordination (task 8.9): every current model of the project measured against the project's coordination reference — the
// marker on the base point, the project / site / building names and IFC schema, the storey names and heights. One finding per
// line of the audit, phrased as an instruction to whoever opens that model. It runs when the project is read, when a delivery is
// prepared (the IFC staged in the draft is measured too) and on demand; it does nothing until the user has a reference.
import { auditLines, buildAudit } from "../../core/coordination.js";
import type { CoordReference } from "../../core/coordination-types.js";
import type { Severity } from "../../core/model.js";
import type { Check, CheckResult } from "../registry.js";

/** Where a model sits (position, marker) is an error: the models do not meet. Names and storeys are warnings to fix before sending. */
const SEVERITY: Record<string, Severity> = { Novietne: "error", Hierarhija: "warning", "Stāvi": "warning" };

export const COORDINATION_META = "coordination";

export const coordinationCheck: Check = {
	id: "coordination",
	title: "Modeļu koordinācija: pamatpunkts, hierarhija, stāvi",
	on: ["sources", "delivery"],
	run: async (ctx) => {
		const ref = ctx.store.readMeta<CoordReference | null>(COORDINATION_META, null);
		if (!ref) return { results: [], skipped: "nav koordinācijas atsauces (Prasības → Koordinācija)" };
		if (!ctx.ifcFacts) return { results: [], skipped: "BimCraft nav pieejams: modeļus nevar nolasīt" };
		const { facts, errors } = await ctx.ifcFacts(ref.cubeNames, ctx.deliveryId);
		if (!facts.length && !errors.length) return { results: [], skipped: "projektā nav IFC modeļu" };
		const results: CheckResult[] = auditLines(buildAudit(facts, ref, ctx.today)).map((l) => ({
			key: `${l.file}|${l.id}`,
			severity: SEVERITY[l.g] ?? "warning",
			message: `${l.file} (${l.g}): ${l.w}: ${l.now} → ${l.to}${l.ask ? `. ${l.ask}` : ""}`,
			where: { path: l.file },
		}));
		for (const e of errors) results.push({ key: `read|${e.file}`, severity: "warning", message: `${e.file}: modeli nevarēja nolasīt (${e.message})`, where: { path: e.file } });
		return { results };
	},
};
