// Prompt order matters: the model prompt holds about 700k characters and CUTS THE END (lesson from the Konkursu App).
// So the short, important material goes first — working rules, Boris's open pins, brief — and the long rule text last.
import type { Brief } from "../chat/brief.js";
import type { Pin } from "../../kernel/pins.js";

export const PROMPT_MAX = 600_000;

const RULES = [
	"Tu esi arhitektūras projektēšanas aģents. Tu zīmē un modelē Revit caur Revit MCP rīkiem. Citus rīkus tev nav.",
	"Tu strādā darba kopijā. Neko neizdzēs un nelabo ārpus modeļa. Aizliegts: dzēst elementus, sūtīt C# kodu.",
	"Neko nenorādi kā apstiprinātu: apstiprina tikai Boriss. Kad partija gatava, izsauc finish_revision.",
	"Katrs likuma fakts, ko pieminēsi, nāk no rules_for_stage ar pantu. Nezināmu neizdomā — jautā Borisam.",
	"Veidojot daudz elementu, izmanto masīvu ievadi (viena izsaukuma laikā var izveidot daudzus).",
];

export function buildPrompt(p: { instruction: string; brief: Brief; pins: Pin[]; rulesJson?: string }): string {
	const parts: string[] = [];
	parts.push("# Noteikumi\n" + RULES.map((r) => `- ${r}`).join("\n"));
	parts.push(
		"# Boriss atstājis (atvērtie pin / komentāri) — tas ir tavs uzdevums\n" +
			(p.pins.length
				? p.pins.map((x) => `- ${x.id} [${x.target.kind === "pdf" ? `${x.target.sheet} lpp.${x.target.page} (${x.target.x.toFixed(3)}, ${x.target.y.toFixed(3)})` : `IFC ${x.target.guid}`}]: ${x.text}`).join("\n")
				: "nav atvērtu pin"),
	);
	parts.push("# Uzdevums\n" + p.instruction.trim());
	parts.push("# Projekta brief (fakti ar avotiem)\n" + JSON.stringify(p.brief, null, 1));
	if (p.rulesJson) parts.push("# Likuma prasības šai stadijai\n" + p.rulesJson);
	const out = parts.join("\n\n");
	return out.length > PROMPT_MAX ? out.slice(0, PROMPT_MAX) : out;
}
