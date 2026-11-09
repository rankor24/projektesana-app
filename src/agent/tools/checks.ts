// The agent's check tools: read the findings, run a check. Closing or overriding a finding is never an agent tool.
import { z } from "zod";
import { registerAppChecks } from "../../checks/index.js";
import { allChecks } from "../../checks/registry.js";
import { runChecks } from "../../checks/run.js";
import { storeOf } from "./context.js";
import { tool, type ToolDef } from "./tool.js";

export const checkTools: ToolDef[] = [
	tool({
		name: "list_findings",
		level: "read",
		description: "Findings of the code checks: id, check, severity, message, where, the requirement it concerns, state (open / overridden with the user's reason / closed), and any justification proposed.",
		input: { state: z.enum(["open", "overridden", "closed"]).optional(), checkId: z.string().optional() },
		run: (ctx, f) => {
			const rows = storeOf(ctx)
				.read("findings")
				.filter((x) => (!f.state || x.state === f.state) && (!f.checkId || x.checkId === f.checkId));
			return rows.length ? rows : "no data: atradumu nav.";
		},
	}),
	tool({
		name: "run_check",
		level: "run",
		description: "Run one code check (or all with checkId \"all\") and return the open findings. Checks: completeness, one-truth, citations, filenames, rooms, programme.",
		input: { checkId: z.string() },
		run: async (ctx, { checkId }) => {
			registerAppChecks();
			const ids = checkId === "all" ? undefined : [checkId];
			if (ids && !allChecks().some((c) => c.id === checkId)) throw new Error(`Nezināma pārbaude ${checkId}. Ir: ${allChecks().map((c) => c.id).join(", ")}`);
			const store = storeOf(ctx);
			const r = await runChecks(store, "manual", { dataDir: ctx.dataDir, today: new Date().toISOString().slice(0, 10), only: ids });
			return { ran: r.ran, open: store.read("findings").filter((f) => f.state === "open" && (!ids || ids.includes(f.checkId))) };
		},
	}),
];
