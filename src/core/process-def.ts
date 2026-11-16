// The office's design process as data (docs: the process document, chapters 4 and 6): stages, gates, leaders, the default depth per document type and a
// short card per stage. Pure: no imports, so the state machine and the renderer can read it.

export const STAGES = ["S1", "S2", "S3", "S4", "S5", "S6", "S7"] as const;
export type Stage = (typeof STAGES)[number];
export type GateId = "H1" | "H2" | "H3" | "H4" | "H5" | "H6" | "H7";

/** The human gate that closes each stage. */
export const GATE_OF: Record<Stage, GateId> = { S1: "H1", S2: "H2", S3: "H3", S4: "H4", S5: "H5", S6: "H6", S7: "H7" };

/** The ekspertīze agent. No spec of it ships: the rules around it are code keyed on this id (R7). */
export const EKS = "eks";

/** Who leads the stage: the project leader (BPV) or the ekspertīze agent (S5). */
export const LEADER: Record<Stage, "bpv" | "eks"> = { S1: "bpv", S2: "bpv", S3: "bpv", S4: "bpv", S5: "eks", S6: "bpv", S7: "bpv" };

export type DocType = "buvprojekts" | "paskaidrojuma-raksts" | "pazinojums";
export type Depth = "pilna" | "vienkāršota" | "pēc vajadzības" | "izlaiž";

/** The table of chapter 4, cell for cell. "Parasti izlaiž" is `izlaiž`: the default, which the leader may change in the profile. */
export const DEFAULT_DEPTH: Record<DocType, Record<Stage, Depth>> = {
	buvprojekts: { S1: "pilna", S2: "pilna", S3: "pilna", S4: "pilna", S5: "pilna", S6: "pilna", S7: "pilna" },
	"paskaidrojuma-raksts": { S1: "pilna", S2: "pēc vajadzības", S3: "vienkāršota", S4: "vienkāršota", S5: "vienkāršota", S6: "pilna", S7: "pilna" },
	pazinojums: { S1: "vienkāršota", S2: "izlaiž", S3: "izlaiž", S4: "vienkāršota", S5: "vienkāršota", S6: "pilna", S7: "pilna" },
};

/** A tight Latvian summary of chapter 6 for the leader's standing text (not the 18 KB document). */
export const STAGE_CARD: Record<Stage, { title: string; goal: string; involved: string; actions: string[]; output: string[]; gate: string }> = {
	S1: {
		title: "S1 Izejas datu analīze",
		goal: "Pārredzēt saņemtos datus: ko tie satur, ko vēl vajag un kur tie pretrunā.",
		involved: "BPV un AR vienmēr; pārējie tikai tad, ja izejas datos ir viņu sadaļas dokumenti.",
		actions: [
			"Sastādīt izejas datu sarakstu ar statusu: ir, trūkst, nepilnīgs.",
			"Noteikt procesa profilu: dokumenta veids un dziļums pa stadijām.",
			"Likt iesaistītajiem aģentiem pārbaudīt tikai savas sadaļas dokumentus.",
			"Pretrunas un trūkumi jāieraksta jautājumu žurnālā.",
			"Sagatavot pieprasījumu tekstus trūkstošajiem tehniskajiem noteikumiem; pieprasa cilvēks.",
			"Apvienot jautājumus, izņemt dublikātus, sakārtot pēc svarīguma.",
		],
		output: ["Procesa profils", "Izejas datu saraksts", "Jautājumi cilvēkam un TN pieprasījumu teksti"],
		gate: "H1: cilvēks atbild uz jautājumiem un atļauj turpināt.",
	},
	S2: {
		title: "S2 Izpētes",
		goal: "Iegūt visas izpētes, kas vajadzīgas šim projektam.",
		involved: "Aģenti, kuru sadaļām izpētes vajadzīgas; izpētes organizē cilvēks.",
		actions: [
			"Noteikt vajadzīgo izpēšu sarakstu kopā ar attiecīgajiem aģentiem.",
			"Katrs aģents sagatavo darba uzdevumu savai izpētei; BPV tos apvieno.",
			"Cilvēks organizē izpētes un ieliek rezultātus projekta mapē.",
			"Aģenti apstrādā rezultātus un ziņo, kā tie ietekmē projektu.",
			"Pie daļējiem rezultātiem BPV var atļaut turpināt; pieņēmumus ieraksta risku reģistrā.",
		],
		output: ["Izpēšu saraksts un darba uzdevumi", "Rezultātu kopsavilkums ar ietekmi", "Pieņēmumu saraksts"],
		gate: "H2: cilvēks atzīst izpētes par pietiekamām un atļauj turpināt.",
	},
	S3: {
		title: "S3 Skiču stadija",
		goal: "Apstiprināts pamata risinājums un darba uzdevumi inženieriem.",
		involved: "AR galvenais; BK, ŪK, EL iespējamības pārbaudei; TAM provizoriskām izmaksām.",
		actions: [
			"Pajautāt cilvēkam, vai viņam ir savs redzējums; ja ir, AR to ņem par pamatu.",
			"AR izstrādā vienu līdz trīs alternatīvas pēc projekta sarežģītības.",
			"Inženieri katrai alternatīvai īsi pārbauda realizējamību un riskus.",
			"TAM novērtē katras alternatīvas izmaksas provizoriski.",
			"BPV sagatavo salīdzinājumu ar ieteikumu; pēc izvēles AR izvēlēto variantu precizē.",
			"Katrs iesaistītais ar BPV sagatavo savu darba uzdevumu S4.",
		],
		output: ["Apstiprināta koncepcija", "Provizoriskais izmaksu novērtējums", "Darba uzdevumi sadaļām"],
		gate: "H3: koncepciju pēc saskaņošanas ar pasūtītāju apstiprina cilvēks.",
	},
	S4: {
		title: "S4 Projekta izstrāde",
		goal: "Gatavs projekts: modeļi, rasējumi no modeļa, teksta un Excel dokumenti.",
		involved: "Visi aģenti, kas ieslēgti profilā; AR vispirms, tad BK, pēc tam inženiertīkli paralēli.",
		actions: [
			"AR izveido bāzes modeli un BPV to publicē kā bāzes IFC.",
			"BK un inženiertīklu aģenti strādā uz šīs bāzes; TAM sāk pēc tam, kad modeļi nostabilizējas.",
			"Koordinācijas cikls: IFC eksports, Solibri pārbaude, kolīziju sadale un risināšana.",
			"Vienošanās starp aģentiem ieraksta lēmumu žurnālā; nerisināta lieta pēc 3 cikliem jāizšķir vai jāeskalē.",
			"Rasējumus atvasina tikai no Revit modeļa.",
			"BPV gala pārbaude: Solibri, PU, normatīvi, sadaļu konsekvence, sastāva pilnīgums.",
		],
		output: ["Revit un IFC modeļi", "PDF rasējumi un dokumenti", "Tāme", "BPV pārbaudes protokols"],
		gate: "H4: tikai cilvēks drīkst projektu nodot ekspertīzes pārbaudei.",
	},
	S5: {
		title: "S5 Ekspertīze",
		goal: "Cilvēkam adresēts, no projekta autoriem neatkarīgs vērtējums, vai projekts atbilst normām un projektēšanas uzdevumam.",
		involved: "Ekspertīzes aģents; sadaļu autori tikai atbild uz tā jautājumiem.",
		actions: [
			"Pārbaudīt projektu pa sadaļām, tikai lasot.",
			"Informāciju pieprasīt tieši sadaļas autoram; jautājumu un atbildi ieraksta žurnālā ar atzīmi EKS.",
			"Autors atbild, bet šajā stadijā projektu nelabo.",
			"Piezīmes klasificēt: K kritiska, B būtiska, I ieteikums; katrai norādīt sadaļu, dokumentu un normu.",
		],
		output: ["Ekspertes ziņojums ar piezīmju sarakstu"],
		gate: "H5: ziņojums nonāk tieši pie cilvēka, kas izlemj, kuras piezīmes novērst.",
	},
	S6: {
		title: "S6 Nepilnību novēršana",
		goal: "Novērstas visas piezīmes, ko cilvēks apstiprinājis.",
		involved: "Autori, kuru sadaļās ir piezīmes, un aģenti, kurus labojumi skar.",
		actions: [
			"BPV sadala piezīmes atbildīgajiem aģentiem.",
			"Katrs labo un katrai piezīmei ieraksta atbildi: kas izdarīts un kur.",
			"Ja labojums skar citu sadaļu, notiek koordinācijas cikls kā S4.",
			"BPV aprēķina labotā apjomu pret visiem dokumentiem.",
			"Virs 10% ekspertīze pārbauda visu atkārtoti, citādi labotos un ar tiem saistītos dokumentus.",
		],
		output: ["Piezīmju atbilžu tabula", "Atjaunoti modeļi un dokumenti", "Ekspertīzes atkārtotas pārbaudes ziņojums"],
		gate: "H6: cilvēks dod zaļo gaismu nodevuma gatavošanai; iepriekš jābūt ekspertīzes atkārtotai pārbaudei.",
	},
	S7: {
		title: "S7 Nodevuma sagatavošana",
		goal: "Gala nodevums pēc biroja paraugiem.",
		involved: "Visi sadaļu autori savām sadaļām; BPV pārbauda kopumu.",
		actions: [
			"Katrs autors sagatavo savas sadaļas modeļus, rasējumus un dokumentus pēc paraugiem.",
			"Noformējums pēc MK noteikumiem par būvprojekta saturu un BIS prasībām.",
			"BPV pārbauda pilnīgumu, failu nosaukumus, versijas un sadaļu konsekvenci.",
			"BPV sagatavo nodevuma sarakstu un sadaļu sarakstu parakstīšanai.",
		],
		output: ["Pilns nodevuma komplekts", "Nodevuma saraksts"],
		gate: "H7: cilvēks pieņem nodevumu; parakstīšanu un iesniegšanu BIS dara cilvēks.",
	},
};

/** A stage's card as the plain text of the leader's standing text: what the stage is for, who works in it, the steps, the output and the gate. */
export function stageCard(stage: Stage): string {
	const c = STAGE_CARD[stage];
	return [c.title, `Mērķis: ${c.goal}`, `Iesaistīti: ${c.involved}`, "Darbības:", ...c.actions.map((a) => `- ${a}`), `Izeja: ${c.output.join("; ")}`, c.gate].join("\n");
}

/** The process tools of the two stage agents (R35; the write ones and, for eks, the read tool process_review_scope): added to that agent's own thread beside the mail tools, never listed in a spec, never offered
 *  to the lead, to other specialists or to a lane. The checks inside the tools stay the hard rule. */
export const PROCESS_TOOLS_OF: Readonly<Record<string, readonly string[]>> = {
	bpv: ["process_request_gate", "process_skip_stage", "process_set_profile"],
	eks: ["process_request_gate", "process_review_done", "process_review_scope"],
};
export const PROCESS_OWN_TOOLS: ReadonlySet<string> = new Set(Object.values(PROCESS_TOOLS_OF).flat());

/** A returned stage may be repeated this many times; the next return goes to the human. */
export const MAX_ITERATIONS = 3;
