// Task templates the agent dock offers (task 6.5 and the everyday ones). Each is the instruction the user would otherwise
// type; it names the tools and the order, and ends with what to report. Plain text: the Fokuss and the pins are added by
// the session as always.

export interface TaskTemplate {
	id: string;
	label: string;
	text: string;
}

/**
 * Sent by the app itself, once, when a project's first scan has finished (main/handlers/projects.ts): what the user otherwise had
 * to ask for message by message. The stage dates, planned deliveries and the room inventory the scan already read by code; the
 * agent checks them and reads what code cannot judge (which value is the project's, which issue is the newest).
 */
export const FIRST_SCAN_TASK =
	"Projekts nolasīts pirmo reizi. Izdari visu, kas pēc pirmās nolasīšanas vajadzīgs, bez papildu jautājumiem:\n" +
	"1. Avoti → fakti: list_sources; katram PU, īpašuma dokumentam, topogrāfijai, TAA un TN (tikai jaunākajam izdevumam: augstākais rev, tad jaunākais datums) extract_candidates, pārbaudi kandidātus tekstā (read_source) un ieraksti pareizos ar set_fact (lapa, burtisks citāts). Profila laukiem lieto profila atslēgas, ne savas.\n" +
	"2. No jaunākā BIP: bim.bipPresent, bim.lodByStage, koordinātas un IFC hierarhija (projekts, vieta, ēka, stāvi) ar set_fact.\n" +
	"3. Grafiks: get_schedule. Posmu datumus un plānotos nodevumus lietotne jau nolasīja no BIP; pārbaudi pret BIP un, ja kāda trūkst, ieraksti ar set_stage_dates / plan_delivery; TN termiņus ar set_clock.\n" +
	"4. Telpas: list_rooms. Ja inventarizācija tukša, pasaki, kuram dokumentam vajag citu lomu (set_source_role).\n" +
	"Dokumentus sauc nosaukumos, ne id. Beigās īsi: kas atrasts, kas trūkst, kas ir pretrunā un ko vajag izlemt lietotājam.";

export const TASKS: TaskTemplate[] = [
	{ id: "first-scan", label: "Viss pēc pirmās nolasīšanas", text: FIRST_SCAN_TASK },
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
