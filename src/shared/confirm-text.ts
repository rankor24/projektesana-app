// What a guarded approval card says in plain words, above the raw batch. Auto mode answers every other card by itself; these it never does
// (agent/tools/levels.ts AUTO_STILL_ASKS_*), so the user must be able to read at a glance what he is allowing. Latvian text with {vars}: the window passes it through tr().
import { AUTO_STILL_ASKS_CALLS, AUTO_STILL_ASKS_TOOLS } from "./auto-mode.js";

export interface ConfirmNote {
	text: string;
	vars: Record<string, string>;
}

const short = (v: unknown, n = 120): string => (typeof v === "string" ? v.trim().slice(0, n) : "");

const CALL_TEXT: Record<string, string> = {
	"deliveries.copy": "Kopē nodevumu uz biroja mapi 1.4_Nodevumi (vienīgā atļautā ierakstīšana biroja mapē).",
	"deliveries.markSent": "Atzīmē nodevumu kā nosūtītu (tavs paziņojums par to, ko esi nosūtījis).",
};
const AGENT_CALL = "Saglabā aģenta, nodaļas, lomas vai prasmes izmaiņas ({call}): aģents maina, kas aģenti ir un ko tie drīkst.";

/** One plain sentence per guarded call of a batch (the batch as the card carries it: JSON, cut at 4000 characters); nothing for the calls Auto mode answers. */
export function confirmNotes(batchJson: string): ConfirmNote[] {
	let batch: unknown;
	try {
		batch = JSON.parse(batchJson);
	} catch {
		return [];
	}
	if (!Array.isArray(batch)) return [];
	const out: ConfirmNote[] = [];
	for (const b of batch as { tool?: unknown; args?: unknown }[]) {
		const tool = typeof b?.tool === "string" ? b.tool : "";
		const args = (b?.args ?? {}) as Record<string, unknown>;
		if (tool === "agent_configure") {
			out.push({ text: "Maina aģenta {agent} iestatījumus, tiesības vai lomas tekstu. Iemesls: {reason}", vars: { agent: short(args.agent, 40) || "?", reason: short(args.reason) || "—" } });
		} else if (tool === "app_confirm" && typeof args.call === "string" && AUTO_STILL_ASKS_CALLS.has(args.call)) {
			const text = CALL_TEXT[args.call];
			out.push(text ? { text, vars: {} } : { text: AGENT_CALL, vars: { call: args.call } });
		} else if (AUTO_STILL_ASKS_TOOLS.has(tool)) {
			out.push({ text: "{tool}: šo Auto režīms nekad neatļauj pats.", vars: { tool } });
		}
	}
	return out;
}
