// Task templates the agent dock offers (task 6.5 and the everyday ones). Each is the instruction the user would otherwise
// type; it names the tools and the order, and ends with what to report. Plain text: the Fokuss and the pins are added by
// the session as always.

export interface TaskTemplate {
	id: string;
	label: string;
	text: string;
}

export const TASKS: TaskTemplate[] = [
	{
		id: "extract",
		label: "Nolasīt izejas datus",
		text: "Izej cauri avotiem (list_sources). Katram PU, īpašuma dokumentam, topogrāfijai, TAA un TN: extract_candidates, pārbaudi kandidātus tekstā (read_source) un ieraksti pareizos ar set_fact (ar lapu un burtisku citātu). Beigās īsi uzskaiti, kas atrasts, kas trūkst un kas ir pretrunā.",
	},
	{
		id: "existing-building",
		label: "Modelēt esošo ēku no inventarizācijas",
		text: [
			"Uzdevums: esošās ēkas modelis no inventarizācijas (Kadastrālās lietas), darba kopijā.",
			"1. Nolasi telpu tabulu un stāvus (avots ar telpu eksplikāciju; Telpas panelis) un, ja ir, plāna ģeometriju no vektoru PDF.",
			"2. Nolasi esošo modeli (līmeņi, asis, telpas) ar lasīšanas rīkiem; to, kas jau ir, nepārbūvē.",
			"3. Pirmā partija: līmeņi un asis. Apstāj, lai lietotājs apstiprina.",
			"4. Nākamās partijas pa stāviem: ārsienas, tad iekšsienas (katra siena — viena siena; dala tikai ārējās/iekšējās sienas savienojumā; izvirzījumi ar plānām sienām), tad ailas, tad telpas ar numuru un nosaukumu no inventarizācijas.",
			"5. Pēc katras partijas lietotne palaiž telpu pārbaudi: list_findings checkId=rooms. Labo, līdz katras telpas platība ir pielaidē.",
			"6. Pēc katras partijas pārskats: ko izveidoji, kas atšķiras no inventarizācijas, kas nākamajā partijā.",
		].join("\n"),
	},
	{
		id: "deliver",
		label: "Nodot projektu",
		text: [
			"Mērķis: nodevums, ko lietotājs var nosūtīt. Strādā kopā ar lietotāju, soli pa solim.",
			"1. list_deliveries. Ja nav gatavojama nodevuma (draft), pajautā veidu (SKICE / MBP / BP / DT / STARP) un nodevuma datumu, tad start_delivery.",
			"2. delivery_checklist: pārskati rindas pa grupām un pasaki, kas trūkst, ar likuma punktu.",
			"3. Lapas: stage_revit_sheets (visas vai lietotāja norādītās). Ja Revit neatbild, pasaki to un turpini ar pārējo.",
			"4. Modelis: stage_ifc, ja nodevumam vajag IFC (MBP, BP, DT).",
			"5. Pārējais: faili, kas projektā jau ir (TN, saskaņojumi, topogrāfija) — stage_source_file ar nosaukumu <lapas nr>_<nosaukums>; nosaukumu saki lietotājam.",
			"6. Atkal delivery_checklist. Katru rindu, kas joprojām trūkst: izskaidro ar citātu; ja tā šim objektam neattiecas, piedāvā pamatojumu (propose_justification pēc tam, kad lietotājs ir nospiedis Sagatavot un atradums ir redzams).",
			"7. Beigās: kas ir gatavs, kas nav, un ka nākamie soļi ir lietotāja klikšķi — Sagatavot (pārbaudes), Kopēt uz 1.4_Nodevumi, Atzīmēt kā nosūtītu. Tos tu nedari.",
		].join("\n"),
	},
	{
		id: "pins",
		label: "Strādāt pie piezīmēm",
		text: "Strādā pie lietotāja atvērtajām piezīmēm pēc kārtas. Katrai: izlasi, ko viņš prasa, izdari (ar apstiprināmu partiju, ja tā ir izmaiņa modelī), tad resolve_pin ar to, ko izmainīji.",
	},
];
