// The agent's requirement tools: list, add one with a verified citation (law point or document quote), and propose a
// justification for a finding. All of these are proposals; the user decides.
import { z } from "zod";
import { verifyQuote } from "../../core/facts.js";
import { newId, type Requirement } from "../../core/model.js";
import { citationOf, snapshotOf } from "../../rules/citations.js";
import { loadRules } from "../../rules/rules.js";
import { storeOf } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

const STAGE = z.enum(["Koncept", "Skice", "Tehniskais", "Detalizācijas", "Būvniecība", "As-Built"]);

export const requirementTools: ToolDef[] = [
	tool({
		name: "list_requirements",
		level: "read",
		description: "The project's requirements (law by profile, PU, BIP, TN, permit, office) with citation, status and state. Filters are optional.",
		input: { origin: z.enum(["law", "pu", "bip", "tn", "permit", "office"]).optional(), stage: STAGE.optional(), status: z.enum(["open", "met", "failed", "justified"]).optional(), q: z.string().optional() },
		run: (ctx, f) => {
			const words = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
			const rows = storeOf(ctx)
				.read("requirements")
				.filter((r) => r.state !== "rejected" && (!f.origin || r.origin === f.origin) && (!f.status || r.status === f.status) && (!f.stage || !r.appliesTo.stages || r.appliesTo.stages.includes(f.stage)))
				.filter((r) => !words.length || words.every((w) => `${r.text} ${r.citation.quote}`.toLowerCase().includes(w)))
				.map((r) => ({ id: r.id, origin: r.origin, text: r.text, status: r.status, state: r.state, cite: r.citation.kind === "law" ? `${r.citation.act} ${r.citation.point} (${r.citation.url})` : r.citation.kind === "office" ? `biroja standarts, lpp. ${r.citation.page}` : `${r.citation.sourceId} lpp. ${r.citation.page}`, appliesTo: r.appliesTo }));
			return rows.length ? rows : "no data: prasību nav (Prasības → Atjaunot).";
		},
	}),
	tool({
		name: "add_requirement",
		level: "propose",
		description:
			"Propose a requirement. Citation: either ruleId (a law rule shipped with the app) or sourceId + page + verbatim quote from a project document. The code verifies the citation. The user confirms.",
		input: {
			origin: z.enum(["law", "pu", "bip", "tn", "permit", "office"]),
			text: z.string().min(5),
			ruleId: z.string().optional(),
			sourceId: z.string().optional(),
			page: z.number().int().min(1).optional(),
			quote: z.string().optional(),
			stages: z.array(STAGE).optional(),
			sections: z.array(z.string()).optional(),
			deliveries: z.array(z.string()).optional(),
		},
		run: (ctx, a) => {
			const store = storeOf(ctx);
			let citation: Requirement["citation"];
			if (a.ruleId) {
				const r = loadRules(ctx.dataDir).find((x) => x.id === a.ruleId);
				if (!r) throw new Error(`Likuma noteikums ${a.ruleId} nav zināms. Meklē ar search_law; jaunu punktu pievieno lietotājs.`);
				const c = citationOf(r, snapshotOf(ctx.dataDir, r.actId), new Date().toISOString().slice(0, 10));
				citation = { kind: "law", act: c.act, actId: r.actId, actVersionDate: c.actVersionDate, readOn: r.read_on, point: r.article, url: c.url, quote: r.quote };
			} else {
				if (!a.sourceId || !a.page || !a.quote) throw new Error("Vajag ruleId vai sourceId + page + quote.");
				const v = verifyQuote(store, { sourceId: a.sourceId, page: a.page, quote: a.quote });
				if (!v.ok) throw new Error(v.reason);
				citation = { kind: "document", sourceId: a.sourceId, sha: v.sha, page: a.page, quote: a.quote.replace(/\s+/g, " ").trim() };
			}
			const req: Requirement = { id: newId("req"), origin: a.origin, citation, text: a.text, appliesTo: { stages: a.stages, sections: a.sections, deliveries: a.deliveries }, checkId: null, status: "open", evidence: [], state: "proposed", by: "agent", at: new Date().toISOString() };
			store.update("requirements", (all) => [...all, req], { kind: "requirement.proposed", by: "agent", data: { id: req.id } });
			return { ok: true, requirement: req.id, note: "Priekšlikums; lietotājs to apstiprina panelī Prasības." };
		},
	}),
	tool({
		name: "propose_justification",
		level: "propose",
		description: "For a finding of a check that does not fit this project's situation: propose a reason why it may stay. The user decides; the check itself is never changed.",
		input: { findingId: z.string(), reason: z.string().min(10) },
		run: (ctx, { findingId, reason }) => {
			const store = storeOf(ctx);
			let found = false;
			store.update(
				"findings",
				(all) =>
					all.map((f) => {
						if (f.id !== findingId) return f;
						found = true;
						return { ...f, proposal: { reason, at: new Date().toISOString() } };
					}),
				{ kind: "finding.justification_proposed", by: "agent", data: { findingId } },
			);
			if (!found) throw new Error(`Atradums ${findingId} nav atrasts.`);
			return { ok: true, note: "Pamatojums nodots lietotājam; atradums paliek atvērts, līdz viņš izlemj." };
		},
	}),
];
