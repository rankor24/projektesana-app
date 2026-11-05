// Setup chat prompt (panel 9). Small, important material first; the long file list last (the model prompt cuts the END).
import type { Completeness } from "./brief.js";

export interface ChatMsg {
	role: "boris" | "agent";
	text: string;
}

const RULES = [
	"Tu intervē Borisu, līdz projekta uzstādīšana ir pabeigta. Uzdod VIENU jautājumu reizē, latviski, īsi.",
	"Katru faktu ieraksti ar set_fact. Avots ir burtisks citāts: vai nu no reģistrēta faila (read_doc), vai no Borisa čata ziņas. Citātu pārbauda kods; izdomātu atteiks.",
	"Ja Boriss raksta, ka kaut ko nezina, izmanto mark_unknown ar viņa burtisko citātu.",
	"Punkti ar [~] jau ir nolasīti no projekta failiem (aģents tos savāc paneļos 5–8) un gaida Borisa apstiprinājumu. Nejautā tos no jauna: parādi vērtību ar citātu un palūdz apstiprināt vai labot. Jautā tikai par punktiem ar [ ].",
	"Sāc ar engine.work un engine.use (darba veids, ēkas lietojums) — bez tiem noteikumu modulis nevar noteikt grupu un procedūru.",
	"Grupu un procedūru neizdomā: izsauc rules_for_stage un atsaucies uz pantu. Ja rezultātā ir `check`, pasaki to Borisam.",
	"Tev nav Revit. Modelēšana sākas tikai pēc Borisa pogas „Sākt modelēt”, kad kontrolsaraksts ir pilns.",
	"Telpu programmu jaunbūvei: ja PU to nesniedz, piedāvā variantu un jautā Borisam; neraksti kā faktu bez viņa vārdiem.",
];

export function buildSetupPrompt(p: { completeness: Completeness; history: ChatMsg[]; files: { path: string; role: string | null }[] }): string {
	const parts: string[] = [];
	parts.push("# Noteikumi\n" + RULES.map((r) => `- ${r}`).join("\n"));
	const c = p.completeness;
	parts.push(
		"# Kontrolsaraksts\n" +
			(c.blocked ? `Nav iespējams uzbūvēt: ${c.blocked}` : c.items.map((i) => `- [${i.status === "open" ? " " : i.status === "unknown" ? "?" : i.status === "proposed" ? "~" : "x"}] ${i.id}: ${i.label}${i.required ? "" : " (nav obligāts)"} — avots parasti: ${i.hint}${i.status === "proposed" && i.fact ? ` — nolasīts: ${i.fact.value}` : ""}`).join("\n")),
	);
	parts.push("# Čats līdz šim\n" + (p.history.length ? p.history.map((m) => `${m.role === "boris" ? "Boriss" : "Aģents"}: ${m.text}`).join("\n") : "(tukšs)"));
	parts.push("# Reģistrētie faili\n" + (p.files.length ? p.files.map((f) => `- ${f.path} (${f.role ?? "bez lomas"})`).join("\n") : "nav failu"));
	return parts.join("\n\n");
}
