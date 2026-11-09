// The agent and Revit (task 6.3). The Revit tools themselves come from the Revit MCP server, gated by REVIT_LEVELS
// (revit-levels.ts): read tools at once, every create / modify tool waits for the user per batch, delete and code never.
// Here: the user's modelling rules as standing text, the skill tools, and the rule that a batch only runs on the project's
// working copy.
import { z } from "zod";
import { listSkills, readSkill } from "../skills.js";
import { tool, type ToolDef } from "./tool.js";

/** The user's rules for modelling through the agent (design doc, work plan 6.3). */
export const REVIT_RULES = `Revit noteikumi:
1. Viena darbība — viens īss izsaukums. Nekad garu kodu; send_code_to_revit un delete_element tev nav pieejami.
2. Vispirms asis un līmeņi, tad sienas. Katra siena ir viena siena (viens elements no stūra līdz stūrim).
3. Sienas sadala tikai ārējās un iekšējās sienas savienojumā. Izvirzījumiem (pilastri, nišas) lieto plānas sienas, nevis sienas sadalīšanu.
4. Nekad nepārbūvē to, ko lietotājs ir izlabojis: pirms izmaiņām nolasi esošo (get_current_view_elements, get_selected_elements); ja elements ir, maini to tikai tad, ja lietotājs to lūdz.
5. Izmaiņas notiek tikai darba kopijā (<nosaukums>_WORK.rvt projekta datu mapē); lietotājs apstiprina katru partiju.
6. Pēc katras partijas lietotne fiksē revīziju un palaiž telpu pārbaudi pret inventarizāciju; atradumus labo nākamajā partijā.
7. Vienības: mm. Līmeņu augstumi no inventarizācijas vai lietotāja; ja nav datu, jautā.`;

export const skillTools: ToolDef[] = [
		tool({
			name: "list_skills",
			level: "read",
			description: "The Revit skills available (revit-modeling, revit-drafting, revit-dimensioning, revit-api, …) with what each is for and its files.",
			input: {},
			run: (ctx) => {
				const s = listSkills(ctx.skillsDir ?? "");
				return s.length ? s : "no data: prasmes nav sinhronizētas (npm run build).";
			},
		}),
		tool({
			name: "read_skill",
			level: "read",
			description: "Read a skill's SKILL.md (default) or one of its files (path relative to the skill). Follow it for the matching task.",
			input: { name: z.string(), path: z.string().optional() },
			run: (ctx, { name, path }) => {
				if (!ctx.skillsDir) throw new Error("Prasmes nav sinhronizētas.");
				return readSkill(ctx.skillsDir, name, path);
			},
		}),
];
