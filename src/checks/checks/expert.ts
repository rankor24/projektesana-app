// Ekspertīze (task 8.14): every open remark of an expert review is a finding, filed on its source and page. A critical remark is an
// error, the rest warnings. The finding closes when the user marks the remark done or not applicable (with a reason), so the review's
// open list and the findings list are one list. Nothing here blocks a delivery: the remarks name no delivery.
import { readRemarks } from "../../core/expertise.js";
import type { Check, CheckResult } from "../registry.js";

export const expertCheck: Check = {
	id: "expert",
	title: "Ekspertīzes atzinuma piezīmes",
	on: ["sources", "delivery"],
	run: (ctx) => {
		const remarks = readRemarks(ctx.store);
		if (!remarks.length) return { results: [], skipped: "nav nolasīta ekspertīzes atzinuma (Prasības → Ekspertīze)" };
		const titles = new Map(ctx.store.read("sources").map((s) => [s.id, s.title] as const));
		const results: CheckResult[] = remarks
			.filter((r) => r.state === "open")
			.map((r) => ({
				key: `expert|${r.id}`,
				severity: r.critical ? "error" : "warning",
				message: `Ekspertīze${r.daļa ? ` (${r.daļa})` : ""}${r.code ? ` ${r.code}` : ""}, ${titles.get(r.sourceId) ?? r.sourceId} ${r.page}. lpp.: «${r.quote.length > 240 ? `${r.quote.slice(0, 237)}…` : r.quote}»${r.responsible ? ` — atbildīgais: ${r.responsible}` : ""}`,
				where: { sourceId: r.sourceId, page: r.page },
			}));
		return { results };
	},
};
