// one-off: hand edits for template literals and a few mixed lines (see scripts/i18n-keys.mjs --lines)
import { readFileSync, writeFileSync } from "node:fs";
const edits = [
	["src/renderer/attach.ts", "`Attēls \"${f.name}\" ir par lielu arī pēc samazināšanas.`", "tr(\"Attēls “{name}” ir par lielu arī pēc samazināšanas.\", { name: f.name })"],
	["src/renderer/attach.ts", "`\"${name}\" nav nolasāms attēls.`", "tr(\"“{name}” nav nolasāms attēls.\", { name })"],
	["src/renderer/attach.ts", "`\"${name}\" ir ${(f.size / 1024 / 1024).toFixed(1)} MB; pieņem līdz 30 MB.`", "tr(\"“{name}” ir {mb} MB; pieņem līdz 30 MB.\", { name, mb: (f.size / 1024 / 1024).toFixed(1) })"],
	["src/renderer/offscreen/render.ts", "`Lapa ${n} nav dokumentā (${doc.numPages} lapas).`", "tr(\"Lapa {n} nav dokumentā ({pages} lapas).\", { n, pages: doc.numPages })"],
	["src/renderer/preview/pixel-diff.ts", "`Izmēri nesakrīt: ${a.width}×${a.height} pret ${b.width}×${b.height}`", "tr(\"Izmēri nesakrīt: {aw}×{ah} pret {bw}×{bh}\", { aw: a.width, ah: a.height, bw: b.width, bh: b.height })"],
	["src/renderer/panels/Agenti.tsx", "`Importēts: ${nf(chars)} zīmes. Nospied «Saglabāt», lai aģents lietotu šo lomu.`", "tr(\"Importēts: {chars} zīmes. Nospied «Saglabāt», lai aģents lietotu šo lomu.\", { chars: nf(chars) })"],
	["src/renderer/panels/Dashboard.tsx", "`kavējas ${-days} d.`", "tr(\"kavējas {days} d.\", { days: -days })"],
	["src/renderer/panels/Dashboard.tsx", "days === 0 ? \"šodien\" : `pēc ${days} d.`", "days === 0 ? tr(\"šodien\") : tr(\"pēc {days} d.\", { days })"],
	["src/renderer/panels/Ekspertize.tsx", "`Atrastas ${r.found} piezīmes${r.added < r.found ? `, jaunas ${r.added}` : \"\"}${r.meta.auditor ? `. Eksperts: ${r.meta.auditor}` : \"\"}.`", "tr(\"Atrastas {found} piezīmes{added}{auditor}.\", { found: r.found, added: r.added < r.found ? tr(\", jaunas {n}\", { n: r.added }) : \"\", auditor: r.meta.auditor ? tr(\". Eksperts: {name}\", { name: r.meta.auditor }) : \"\" })"],
	["src/renderer/panels/Nodevumi.tsx", "run(\"Pārbauda\", () => call(\"deliveries.prepare\", projectId, d.id), (r) => `Pārbaudīts: ${(r as { open: number }).open} atvērti atradumi`)", "run(tr(\"Pārbauda\"), () => call(\"deliveries.prepare\", projectId, d.id), (r) => tr(\"Pārbaudīts: {open} atvērti atradumi\", { open: (r as { open: number }).open }))"],
	["src/renderer/panels/Nodevumi.tsx", "run(\"Atzīmē\", ", "run(tr(\"Atzīmē\"), "],
	["src/renderer/panels/Nodevumi.tsx", "run(\"Kopē\", () => call(\"deliveries.copy\", projectId, d.id), (r) => `Nokopēti ${(r as { files: number }).files} faili`)", "run(tr(\"Kopē\"), () => call(\"deliveries.copy\", projectId, d.id), (r) => tr(\"Nokopēti {files} faili\", { files: (r as { files: number }).files }))"],
	["src/renderer/panels/Nodevumi.tsx", "return `Lapas: eksportētas ${s.exported.length}, atstātas ${s.kept.length} (no ${s.total})`;", "return tr(\"Lapas: eksportētas {exported}, atstātas {kept} (no {total})\", { exported: s.exported.length, kept: s.kept.length, total: s.total });"],
	["src/renderer/panels/Nodevumi.tsx", "(x) => `IFC: ${fileName((x as { file: string }).file)}`", "(x) => tr(\"IFC: {file}\", { file: fileName((x as { file: string }).file) })"],
	["src/renderer/panels/Nodevumi.tsx", "window.confirm(`Izņemt “${fileName(i.file)}” no nodevuma?`) && run(\"Izņem\", ", "window.confirm(tr(\"Izņemt “{file}” no nodevuma?\", { file: fileName(i.file) })) && run(tr(\"Izņem\"), "],
	["src/renderer/panels/Nodevumi.tsx", "const RENAME_LABEL = { same: \"kārtībā\", rename: \"pārdēvēs\", input: \"jānorāda\", conflict: \"konflikts\" } as const;", "const RENAME_LABEL = { same: tr(\"kārtībā\"), rename: tr(\"pārdēvēs\"), input: tr(\"jānorāda\"), conflict: tr(\"konflikts\") } as const;"],
	["src/renderer/panels/Nodevumi.tsx", "return `Pārdēvēti ${x.applied}${x.errors.length ? `; ${x.errors.join(\"; \")}` : \"\"}`;", "return tr(\"Pārdēvēti {applied}{errors}\", { applied: x.applied, errors: x.errors.length ? `; ${x.errors.join(\"; \")}` : \"\" });"],
	["src/renderer/panels/Normativi.tsx", "...r.missing.map((m) => `nav zināms: ${m}`), ...r.notMatched.map((m) => `neattiecas: ${m}`)", "...r.missing.map((m) => tr(\"nav zināms: {m}\", { m })), ...r.notMatched.map((m) => tr(\"neattiecas: {m}\", { m }))"],
	["src/renderer/panels/Prasibas.tsx", "alert(`Importētas ${r.topics} tēmas: ${Object.entries(r.byDiscipline).map(([k, n]) => `${k} ${n}`).join(\", \")}`)", "alert(tr(\"Importētas {topics} tēmas: {byDiscipline}\", { topics: r.topics, byDiscipline: Object.entries(r.byDiscipline).map(([k, n]) => `${k} ${n}`).join(\", \") }))"],
	["src/renderer/panels/Prasibas.tsx", "confirm(`Noņemt atradumu?\\n\\n${f.message.slice(0, 200)}`)", "confirm(tr(\"Noņemt atradumu?\") + \"\\n\\n\" + f.message.slice(0, 200))"],
	["src/renderer/panels/Prasmes.tsx", "`Importētas ${r.imported.length} prasmes; nav importētas ${r.refused.length}.` : \"Mapē nav neviena SKILL.md.\"", "tr(\"Importētas {imported} prasmes; nav importētas {refused}.\", { imported: r.imported.length, refused: r.refused.length }) : tr(\"Mapē nav neviena SKILL.md.\")"],
	["src/renderer/panels/ProcessBlock.tsx", "`${m} (Iestatījumi → Aģenti)`", "`${m} (${tr(\"Iestatījumi\")} → ${tr(\"Aģenti\")})`"],
	["src/renderer/panels/ProcessBlock.tsx", "name: `${a} (nav iestatījumos)`", "name: tr(\"{a} (nav iestatījumos)\", { a })"],
	["src/renderer/panels/ProcessBlock.tsx", "`Pajautāti: ${(await call(\"process.learn\", projectId)).asked.join(\", \") || \"neviens\"}`", "tr(\"Pajautāti: {asked}\", { asked: (await call(\"process.learn\", projectId)).asked.join(\", \") || tr(\"neviens\") })"],
	["src/renderer/panels/ProcessBlock.tsx", "return `Izmaiņa nosūtīta aģentam bpv (piezīme ${n.id}).`;", "return tr(\"Izmaiņa nosūtīta aģentam bpv (piezīme {id}).\", { id: n.id });"],
	["src/renderer/panels/Projekts.tsx", "confirm(`Noņemt ${id} no saraksta? Biroja mape un app dati paliek.`)", "confirm(tr(\"Noņemt {id} no saraksta? Biroja mape un app dati paliek.\", { id }))"],
	["src/renderer/panels/Telpas.tsx", "setDone(`ierakstītas ${r.written}${r.noParam.length ? `; bez parametra: ${r.noParam.join(\", \")}` : \"\"}`)", "setDone(tr(\"ierakstītas {written}{noParam}\", { written: r.written, noParam: r.noParam.length ? tr(\"; bez parametra: {list}\", { list: r.noParam.join(\", \") }) : \"\" }))"],
	["src/renderer/preview/IfcView.tsx", "setMsg(`${m.models.length} modeļi vienā ainā`)", "setMsg(tr(\"{n} modeļi vienā ainā\", { n: m.models.length }))"],
	["src/renderer/preview/IfcView.tsx", "setMsg(m.name ? `rādīts tikai ${m.name}` : \"rādīti visi modeļi\")", "setMsg(m.name ? tr(\"rādīts tikai {name}\", { name: m.name }) : tr(\"rādīti visi modeļi\"))"],
	["src/renderer/preview/IfcView.tsx", "setMsg(m.action === \"isolate\" ? `izolēti ${m.found} no ${m.asked}` : m.action === \"show_all\" ? \"rādīts viss modelis\" : \"krāsas noņemtas\")", "setMsg(m.action === \"isolate\" ? tr(\"izolēti {found} no {asked}\", { found: m.found, asked: m.asked }) : m.action === \"show_all\" ? tr(\"rādīts viss modelis\") : tr(\"krāsas noņemtas\"))"],
	["src/renderer/preview/IfcView.tsx", "setMsg(`krāsots pēc ${m.property}: ${m.painted} no ${m.total}${m.partial ? \" (tikai sākums)\" : \"\"}`)", "setMsg(tr(\"krāsots pēc {property}: {painted} no {total}{partial}\", { property: m.property, painted: m.painted, total: m.total, partial: m.partial ? tr(\" (tikai sākums)\") : \"\" }))"],
	["src/renderer/preview/IfcView.tsx", "setMsg(`iezīmēti ${m.found} no ${m.asked}`)", "setMsg(tr(\"iezīmēti {found} no {asked}\", { found: m.found, asked: m.asked }))"],
	["src/renderer/preview/IfcView.tsx", "setMsg(`${m.asked - m.drawn} piezīmju elementu šajā modelī nav (cita versija?)`)", "setMsg(tr(\"{n} piezīmju elementu šajā modelī nav (cita versija?)\", { n: m.asked - m.drawn }))"],
	["src/renderer/shell/AgentDock.tsx", "text: `Saruna ir ${fmtTokens(e.before)} tokenu — saspiež vecāko daļu…`", "text: tr(\"Saruna ir {tokens} tokenu — saspiež vecāko daļu…\", { tokens: fmtTokens(e.before) })"],
	["src/renderer/shell/AgentDock.tsx", "text: `Saspiešana neizdevās, darbs turpinās bez tās: ${e.message ?? \"\"}`", "text: tr(\"Saspiešana neizdevās, darbs turpinās bez tās: {message}\", { message: e.message ?? \"\" })"],
	["src/renderer/shell/AgentDock.tsx", "text: `Savienojums pārtrūka (${e.message}). Atkārto ${e.attempt}/${e.of} pēc ${Math.round(e.delayMs / 1000)} s…`", "text: tr(\"Savienojums pārtrūka ({message}). Atkārto {attempt}/{of} pēc {s} s…\", { message: e.message, attempt: e.attempt, of: e.of, s: Math.round(e.delayMs / 1000) })"],
	["src/renderer/shell/KoordScene.tsx", "name={`${files.length} modeļi`}", "name={tr(\"{n} modeļi\", { n: files.length })}"],
	["src/renderer/shell/RunCard.tsx", "`${running ? \"Līdz šim: \" : \"Izmaiņas: \"}${changed}`", "`${running ? tr(\"Līdz šim: \") : tr(\"Izmaiņas: \")}${changed}`"],
];
const files = new Map();
let bad = 0;
for (const [f, a, b] of edits) {
	let s = files.get(f) ?? readFileSync(f, "utf8");
	if (!s.includes(a)) {
		console.error("NOT FOUND", f, a.slice(0, 70));
		bad++;
		continue;
	}
	files.set(f, s.replace(a, b));
}
for (const [f, s] of files) writeFileSync(f, s, "utf8");
console.log(`applied to ${files.size} files, ${bad} not found`);
