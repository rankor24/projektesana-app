// Citation still valid: every law requirement's quote is still in the act's text the app holds; a quote that is gone means
// the law changed and the requirement must be re-read. Points that take effect later are listed as information.
import { citationOf, snapshotOf } from "../../rules/citations.js";
import { loadRules } from "../../rules/rules.js";
import type { Check, CheckResult } from "../registry.js";

export const citationCheck: Check = {
	id: "citations",
	title: "Likuma citāti joprojām spēkā",
	on: ["requirements", "manual"],
	run: ({ store, dataDir, today }) => {
		const rules = new Map(loadRules(dataDir).map((r) => [r.id, r]));
		const results: CheckResult[] = [];
		const met: string[] = [];
		for (const req of store.read("requirements")) {
			if (req.citation.kind !== "law" || req.state === "rejected") continue;
			const ruleId = req.id.startsWith("law:") ? req.id.split(":")[1] : null;
			const rule = ruleId ? rules.get(ruleId) : [...rules.values()].find((r) => r.quote === (req.citation.kind === "law" ? req.citation.quote : ""));
			if (!rule) {
				results.push({ key: `${req.id}:rule`, severity: "warning", message: `${req.citation.act} ${req.citation.point}: likuma noteikums vairs nav lietotnes datos — pārlasi`, where: {}, requirementId: req.id });
				continue;
			}
			const c = citationOf(rule, snapshotOf(dataDir, rule.actId), today);
			if (c.status === "teksts mainījies") results.push({ key: `${req.id}:changed`, severity: "error", message: `${c.act} ${c.point}: citāts vairs nav akta tekstā — likums mainījies, prasība jāpārlasa (${c.url})`, where: {}, requirementId: req.id });
			else if (c.status === "vēl nav spēkā") results.push({ key: `${req.id}:upcoming`, severity: "info", message: `${c.act} ${c.point} stājas spēkā ${c.validFrom}`, where: {}, requirementId: req.id });
			else if (c.status === "nav pārbaudīts") results.push({ key: `${req.id}:unchecked`, severity: "warning", message: `${c.act}: akta teksts nav lietotnē — citāts nav pārbaudāms`, where: {}, requirementId: req.id });
			else met.push(req.id);
		}
		// "met" here means only that the citation holds, so it does not mark the requirement met
		void met;
		return { results };
	},
};
