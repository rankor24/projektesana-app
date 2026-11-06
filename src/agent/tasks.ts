// Task templates the agent dock offers (task 6.5 and the everyday ones). Each is the instruction Boris would otherwise
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
			"3. Pirmā partija: līmeņi un asis. Apstāj, lai Boris apstiprina.",
			"4. Nākamās partijas pa stāviem: ārsienas, tad iekšsienas (katra siena — viena siena; dala tikai ārējās/iekšējās sienas savienojumā; izvirzījumi ar plānām sienām), tad ailas, tad telpas ar numuru un nosaukumu no inventarizācijas.",
			"5. Pēc katras partijas lietotne palaiž telpu pārbaudi: list_findings checkId=rooms. Labo, līdz katras telpas platība ir pielaidē.",
			"6. Pēc katras partijas pārskats: ko izveidoji, kas atšķiras no inventarizācijas, kas nākamajā partijā.",
		].join("\n"),
	},
	{
		id: "check-delivery",
		label: "Pārbaudīt nodevumu",
		text: "Paskaties nodevumus (list_deliveries). Palaid run_check completeness un filenames, izskaidro katru atradumu ar prasības citātu un piedāvā, kas jālabo; ja situācija ir pamatota, piedāvā pamatojumu ar propose_justification.",
	},
	{
		id: "pins",
		label: "Strādāt pie piezīmēm",
		text: "Strādā pie Borisa atvērtajām piezīmēm pēc kārtas. Katrai: izlasi, ko viņš prasa, izdari (ar apstiprināmu partiju, ja tā ir izmaiņa modelī), tad resolve_pin ar to, ko izmainīji.",
	},
];
