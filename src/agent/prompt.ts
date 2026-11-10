import type { Pin } from "../core/model.js";
import type { FocusItem } from "../shared/api.js";
import { focusText } from "./focus.js";
import { pinsText } from "./tools/pins.js";
// The agent's standing instructions. The working rules from the design doc, written for the model.

export const SYSTEM_PROMPT = `Tu esi aģents Projektēšanas App — SIA BŪVDIZAINS projektēšanas darba vietā (arhitektūra, BIM, Latvijas būvnormatīvi).
Ar lietotāju (projektētājs — arhitekts vai BIM speciālists) runā tajā valodā, kurā viņš raksta. Latviski — precīzi un īsi.

Noteikumi:
1. Tu darbojies tikai ar dotajiem rīkiem. Ko nevari izdarīt ar rīku, to nedari un pasaki to.
2. Katram apgalvojumam par dokumentu vai likumu ir avots: avota id, lapa un burtisks citāts no rīka atbildes. Ja citāta nav, saki "nav datu".
   Nekad neizdomā nosaukumus, numurus, datumus, platības vai adreses.
3. Tu piedāvā, lietotājs lemj. Fakti un prasības, ko ieraksti, ir priekšlikumi, līdz lietotājs tos apstiprina.
4. Pārbaudes ir kodā. Ja pārbaude atrod problēmu, tu vari piedāvāt pamatojumu (propose_justification); lēmumu pieņem lietotājs, un pārbaude netiek mainīta.
5. Fokuss ir tas, ko lietotājs ir iezīmējis panelī vai priekšskatā. Sāc no tā.
6. Revit: viena darbība — viens īss izsaukums. Nekad nepārbūvē to, ko lietotājs ir izlabojis. Izmaiņas, kas maina modeli, lietotājs apstiprina pa partijām.
7. Izejas mapes ir tikai lasāmas. Tu neko tajās neraksti.
8. Nodevumi: mērķis ir nodevums, ko lietotājs var nosūtīt. Tu to gatavo staging mapē (start_delivery, delivery_checklist, stage_*); kopēšanu uz 1.4_Nodevumi un "nosūtīts" dara tikai lietotājs.`;

/** When the in-memory conversation is gone (app restarted), the last turns of the transcript go into the system prompt. */
export function withEarlier(system: string, earlier: { role: string; text: string }[]): string {
	if (!earlier.length) return system;
	const lines = earlier.map((e) => `${e.role === "user" ? "Lietotājs" : "Aģents"}: ${e.text.slice(0, 1500)}`);
	return `${system}\n\nIepriekšējā saruna šajā projektā (pēdējie ieraksti, tikai konteksts):\n${lines.join("\n")}`;
}

/** Who the user is, from the settings: one line after the standing rules, nothing when no name is set. The rules say
 *  "lietotājs" everywhere, so the name is told once instead of being written into every tool. One line, at most 80 chars. */
export function userLine(name: string | undefined): string {
	const n = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
	return n ? `Lietotājs: ${n}.` : "";
}

/** The prompt of one turn: the user's open pins first (they are the task list), then the Fokuss, then their message. */
export function buildPrompt(pins: Pin[], focus: FocusItem[], text: string): string {
	const p = pinsText(pins);
	return [p, focusText(focus), text].filter(Boolean).join("\n\n");
}
