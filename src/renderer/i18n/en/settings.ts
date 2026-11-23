// Settings tabs, the drawing sets of Lapu izmaiņas and the Revit file list (2.6.6); the icon-only comment tools (2.6.7).
export const settings: Record<string, string> = {
	"Vispārīgi": "General",
	"Integrācijas": "Integrations",
	"Ceļi": "Paths",
	"Komponentes": "Components",
	"Komponente": "Component",
	"Kas tas ir": "What it is",
	"Lasa un raksta atvērto Revit modeli.": "Reads and writes the model open in Revit.",
	"3D skats un IFC salīdzināšana.": "3D view and IFC comparison.",
	"Tilts uz lietotni ieslēgts.": "Bridge to the app is on.",
	"Tilts uz lietotni nav ieslēgts.": "Bridge to the app is off.",
	"nav iekļauts": "not included",
	"DWG skats un DWG salīdzināšana.": "DWG view and DWG comparison.",
	"Bez tā DWG rāda vienkāršā līniju skatā.": "Without it, DWG shows in the plain line view.",
	"salīdzina lapas…": "comparing sheets…",
	"{k}: nav": "{k}: none",
	"1. izd.": "1st issue",
	"Rasējumi (visi projekta PDF un DWG, pa rasējumiem: PDF salīdzina ar PDF, DWG ar DWG)": "Drawings (all PDF and DWG of the project, per drawing: PDF is compared with PDF, DWG with DWG)",
	"visi {n}": "all {n}",
	"ar vairākām versijām {n}": "with several versions {n}",
	"PDF ≠ DWG {n}": "PDF ≠ DWG {n}",
	"pārlasīt mapi": "re-read folder",
	"Salīdzināt {a} → {b}": "Compare {a} → {b}",
	"lasa projekta mapi…": "reading the project folder…",
	"no data: projekta mapē PDF un DWG failu nav.": "no data: no PDF or DWG files in the project folder.",
	"PDF = DWG pārbauda nosaukuma versiju un datumu, ne rasējuma saturu.": "PDF = DWG checks the version in the name and the date, not the drawing's content.",
	"pēdējās divas PDF versijas": "the last two PDF versions",
	"pēdējās divas DWG versijas": "the last two DWG versions",
	"Revit faili projekta mapē": "Revit files in the project folder",
	"Revit atvērts:": "Open in Revit:",
	"šis projekta fails": "this project file",
	"sakrīt tikai nosaukums": "only the name matches",
	"nav no šī projekta mapes": "not from this project folder",
	"pārbauda Revit…": "checking Revit…",
	"no data: projekta mapē RVT failu nav.": "no data: no RVT files in the project folder.",
	"atvērts Revit": "open in Revit",
	"Atver failu Revit (datora programmā)": "Opens the file in Revit (the PC's program)",
	"{n} Revit rezerves kopijas (.0001.rvt) nav uzskaitītas.": "{n} Revit backup copies (.0001.rvt) not listed.",
	"sakrīt": "match",
	"tikai PDF": "PDF only",
	"tikai DWG": "DWG only",
	"versijas nesakrīt": "versions differ",
	"DWG jaunāks": "DWG newer",
	"Revit MCP serveris nav atrasts (Iestatījumi → Integrācijas).": "Revit MCP server not found (Settings → Integrations).",
	"DWG ar šo nosaukumu projekta mapē nav.": "No DWG with this name in the project folder.",
	"PDF ar šo nosaukumu projekta mapē nav.": "No PDF with this name in the project folder.",
	"klikšķis: notīrīt": "click: clear",
	"Vilkt, lai pārvietotu": "Drag to move",
	"nolasīts no skenēta dokumenta": "read from a scanned document",
	"Rindas var būt kļūdainas vai trūkt; pārbaudi pret lapām.": "Rows may be wrong or missing; check them against the pages.",
	"Lūgt aģentam pārbaudīt un salabot": "Ask the agent to check and fix",
	"labojis aģents": "corrected by the agent",
	"labots": "corrected",
	"Šīs rindas aizstāj no dokumenta nolasītās visur: salīdzinājumā ar modeli un pārbaudēs.": "These rows replace the ones read from the document everywhere: in the comparison with the model and in the checks.",
	"Rādīt piezīmes": "Show notes",
	"Vilkt, lai mainītu platumu": "Drag to change the width",
	"Sakļaut piezīmes": "Fold the notes",
	"Claude abonements: pieteikšanās": "Claude subscription: sign-in",
	"statuss nav nolasīts": "status not read",
	"pieteicies": "signed in",
	"nav pieteicies": "not signed in",
	"statuss nav zināms": "status unknown",
	"Claude Code neatbildēja uz statusa pārbaudi; tas nenozīmē, ka pieteikšanās nav.": "Claude Code did not answer the status check; that does not mean there is no sign-in.",
	"Pieteikties ar Claude": "Sign in with Claude",
	"Atteikties": "Sign out",
	"Pārbaudīt": "Check",
	"Ielīmēta setup-token atslēga ir spēkā un ir svarīgāka par pieteikšanos. Lai izmantotu pieteikšanos, izdzēs atslēgu.": "A pasted setup-token key is in use and takes priority over the sign-in. To use the sign-in, delete the key.",
	"Palaiž Claude Code…": "Starting Claude Code…",
	"Atver Anthropic lapu, piesakies ar savu Claude abonementu un ielīmē šeit kodu, ko lapa parāda. Ja pārlūks pats pabeidza pieteikšanos, kods nav vajadzīgs.": "Open Anthropic's page, sign in with your own Claude subscription and paste the code the page shows here. If the browser finished the sign-in by itself, no code is needed.",
	"Atvērt pieteikšanās lapu": "Open the sign-in page",
	"Gaida saiti no Claude Code…": "Waiting for the link from Claude Code…",
	"Kods no Anthropic lapas": "Code from Anthropic's page",
	"Kods nosūtīts, gaida apstiprinājumu…": "Code sent, waiting for confirmation…",
	"Nodaļa": "Department",
	"bez nodaļas": "no department",
	"Pēc noklusējuma raksta visu projektēšanas nodaļu aģentiem un BPV; Kvalitāte (EKS) ir atsevišķi (skat. «Drīkst rakstīt» zemāk).": "By default it writes to the agents of every design department and to BPV; Kvalitāte (EKS) stays apart (see «May write to» below).",
	"Rezerve": "Backup",
	"izvēlies modeli": "pick a model",
	"Bez modeļa rezerve netiks saglabāta.": "Without a model the backup is not saved.",
	"Kur turpināt, ja pakalpojumam ir limits vai tas nav pieslēgts.": "Where to carry on when the provider is at a limit or signed out.",
	"Bez nodaļas": "No department",
	"Sarunas nosaukums": "Conversation title",
	"Arhivēt": "Archive",
	"Nevar arhivēt, kamēr saruna strādā": "Cannot archive while the conversation is working",
	"Slēdz sarunu; pieraksts paliek": "Closes the conversation; its record stays",
	"Sarunas darbības": "Conversation actions",
	"Sakļaut sarunas": "Fold the conversations",
	"Rādīt sarunas": "Show the conversations",
	"Meklēt sarunās, aģentos un nodaļās": "Search conversations, agents and departments",
	"Nodaļas nosaukums": "Department name",
	"Atvērt nodaļu": "Open the department",
	"Sakļaut nodaļu": "Fold the department",
	"Nodaļas darbības": "Department actions",
	"Dzēst nodaļu": "Delete department",
	"Nodaļā ir aģenti: vispirms pārvieto tos citur": "The department has agents: move them elsewhere first",
	"Noņem tukšo nodaļu": "Removes the empty department",
	"Atlaid šeit": "Drop here",
	"nav aģentu": "no agents",
	"atlaid šeit, lai izņemtu no nodaļas": "drop here to take out of its department",
	"Noņemtie aģenti": "Removed agents",
	"Nekas nav atrasts.": "Nothing found.",
	"Jauna nodaļa": "New department",
	"+ nodaļa": "+ department",
	"Rādīt arhivētās": "Show archived",
	"Rezerves AI": "Backup AI",
	"Kad aģenta pakalpojums sasniedz lietojuma limitu vai tā pieteikšanās beidzas, aģenta jaunie darbi sākas ar rezerves AI, līdz limits atjaunojas. Aģenta paša rezerve (Aģenti) ir svarīgāka par šo.":
		"When an agent's provider reaches its usage limit or its sign-in expires, the agent's new work starts on the backup AI until the limit resets. An agent's own backup (Agents) wins over this one.",
	"Rezerves pakalpojums": "Backup provider",
	"nav": "none",
	"Tas pats pakalpojums nepārņem darbu, kad limits ir visam kontam; tas palīdz tikai tad, ja limits skar vienu modeli.":
		"The same provider does not take over when the limit is on the whole account; it helps only when the limit is on one model.",
	"Automātiskā atkopšana": "Automatic recovery",
	"Ieslēgta: ja gājiens neizdodas, pirms kāds rīks ir darbojies (limits, beigusies pieteikšanās, pakalpojums nedarbojas), to mēģina vēlreiz vienu reizi ar rezerves AI. Izslēgta: tu nosūti ziņu vēlreiz. Cita aģenta uzdevumu pēc limita pārsūta uz rezervi vienmēr, ar tām pašām tiesībām.":
		"On: when a run fails before any tool has run (a limit, an expired sign-in, a provider that is down), it is tried once more on the backup AI. Off: you send the message again. Another agent's task is resent to the backup after a limit in any case, with the same rights.",
	"Aizturēts": "On hold",
	"Iemesls": "Reason",
	"Mēģina vēlreiz": "Tried again",
	"pieteikšanās beigusies": "sign-in expired",
	"kredīti iztērēti": "credits used up",
	"lietojuma limits": "usage limit",
	"Atbrīvot": "Release",
	// Aģenti: the team by department, the agent dialog, the team import, MCP servers
	"Identifikators: mazie burti, cipari un domuzīme, 2–31 zīmes (piem. dokumenti).":
		"Identifier: lower case letters, digits and hyphens, 2–31 characters (e.g. dokumenti).",
	"Izņemt aģentu {name}? Tā sarunas paliek, lomas fails paliek mapē agents.":
		"Remove the agent {name}? Its conversations stay and its role file stays in the agents folder.",
	"Lomas apraksts (.md)":
		"Role description (.md)",
	"Modelis un rezerve":
		"Model and backup",
	"Rīki":
		"Tools",
	"Sazināšanās":
		"Messaging",
	"MCP serveri":
		"MCP servers",
	"Pārbaude pirms nodošanas":
		"Check before done",
	"Aģenta iestatījumi":
		"Agent settings",
	"Jauns aģents":
		"New agent",
	"Vispirms ieraksti nosaukumu un identifikatoru (Vispārīgi)":
		"Enter a name and an identifier first (General)",
	"Esoša aģenta identifikators nav maināms: pie tā ir sarunas un lomas fails":
		"The identifier of an existing agent cannot be changed: its conversations and role file belong to it",
	"Šīs nodaļas vadītājs":
		"Lead of this department",
	"Vadītājs uzdod darbus savā nodaļā un uztur tās atmiņu; bez vadītāja to dara BPV. Katrai nodaļai ir viens.":
		"The lead hands out work in its department and keeps its memory; without a lead BPV does. A department has one.",
	"Meklēt prasmi":
		"Search skills",
	"{n} izvēlētas":
		"{n} chosen",
	"Aģents zina tikai gatavās prasmes (bez vietturiem un ar tavu atzīmi «pārbaudīta» lapā Prasmes). Melnraksta prasmi var piešķirt jau tagad.":
		"An agent knows only ready skills (no placeholders and marked tested by you on the Skills page). A draft skill can be assigned now.",
	"Ielādē…":
		"Loading…",
	"Prasmju bibliotēka ir tukša: importē prasmes lapā Prasmes vai importē komandu.":
		"The skills library is empty: import skills on the Skills page or import the team.",
	"gatava":
		"ready",
	"Pirms aģents nodod atbildi, to izlasa pārbaudītājs un salīdzina ar pieprasījumu: līdz {n} pārbaudēm. Labāk citam pakalpojumam nekā autoram: modelis reti ievēro savas kļūdas.":
		"Before the agent hands over an answer, a checker reads it against the request: up to {n} checks. Better another provider than the author's: a model rarely notices its own mistakes.",
	"cits aģents":
		"another agent",
	"modelis":
		"model",
	"pakalpojuma noklusējums":
		"provider default",
	"Pārbaužu skaits":
		"Number of checks",
	"Katra pārbaude ir pilns modeļa gājiens (izmaksas redzamas darba kartītē).":
		"Each check is a full model turn (the cost shows in the run card).",
	"Izņemt aģentu":
		"Remove agent",
	"Komandas imports":
		"Team import",
	"Izveidoti: {n}":
		"Created: {n}",
	"Atjaunoti (tavi iestatījumi paturēti): {n}":
		"Updated (your own settings kept): {n}",
	"Izlaisti: {n}":
		"Skipped: {n}",
	"Mapē nav lomu failu ar numuriem: {list}":
		"The folder has no role files with the numbers: {list}",
	"Prasmes: importētas {a}, jau bija bibliotēkā {b}, atteiktas {c}; aģentiem piešķirti nosaukumi kopā: {d}":
		"Skills: imported {a}, already in the library {b}, refused {c}; skill names now on the agents' lists: {d}",
	"{n} prasmes vēl ir melnraksti: aģents tās zinās pēc tam, kad tās atzīmēsi kā pārbaudītas.":
		"{n} skills are still drafts: the agent will know them once you mark them as tested.",
	"Nodaļas vadītājs":
		"Department lead",
	"vadītājs":
		"lead",
	"nav apraksta":
		"no description",
	"Pakalpojums un modelis":
		"Provider and model",
	"rezerve":
		"backup",
	"prasmes":
		"skills",
	"pārbaude":
		"check",
	"Mape ar BD komandu (01_….md … 16_….md un mape skilli)":
		"Folder with the BD team (01_….md … 16_….md and the skilli folder)",
	"noklusējuma modelis":
		"default model",
	" Šobrīd ir piegādātais saraksts; tas saglabājas, kad saglabā kādu aģentu vai importē komandu.":
		" The shipped list is in use now; it is saved when you save an agent or import the team.",
	"Nolasa mapi ar 16 lomu failiem un prasmēm un izveido vai atjauno aģentus":
		"Reads a folder with the 16 role files and the skills and creates or updates the agents",
	"Importē…":
		"Importing…",
	"Importēt BD komandu…":
		"Import the BD team…",
	"Vēlreiz no pēdējās mapes":
		"Again from the last folder",
	"Vadītājs uzdod darbus savā nodaļā un uztur tās atmiņu; bez vadītāja to dara BPV.":
		"The lead hands out work in its department and keeps its memory; without a lead BPV does.",
	"BPV (noklusējums)":
		"BPV (default)",
	"Augstāk":
		"Higher",
	"Zemāk":
		"Lower",
	"Nodaļa nav tukša: vispirms pārvieto aģentus":
		"The department is not empty: move its agents first",
	"Izņemt tukšo nodaļu":
		"Remove the empty department",
	"Izņemt nodaļu {name}?":
		"Remove the department {name}?",
	"+ aģents":
		"+ agent",
	"Nomet šeit":
		"Drop here",
	"Pievieno piegādātos trīs speciālistus, kuru vēl nav sarakstā (esošie netiek mainīti)":
		"Adds the three shipped specialists that are not in the list yet (existing ones are not changed)",
	"iestatīts":
		"set",
	"nav iestatīts":
		"not set",
	"jauna vērtība (tukšs = atstāt)":
		"new value (empty = keep)",
	"ievadi vērtību":
		"enter a value",
	"Šī aģenta paša MCP serveri: citi aģenti to rīkus neredz. Katrs rīks prasa tavu apstiprinājumu (pa partijām), ja neatzīmē «tikai lasa».":
		"This agent's own MCP servers: other agents do not see their tools. Every tool asks for your confirmation (per batch) unless it is marked \"read only\".",
	"Ielīmē claude mcp add …, claude mcp add-json …, npx/uvx/docker run rindu, servera adresi vai mcpServers JSON":
		"Paste claude mcp add …, claude mcp add-json …, an npx/uvx/docker run line, a server address or mcpServers JSON",
	"Nav pievienotu MCP serveru.":
		"No MCP servers added.",
	"adrese":
		"address",
	"programma":
		"program",
	"{n} rīki":
		"{n} tools",
	"Vispirms ievadi trūkstošās vērtības":
		"Enter the missing values first",
	"Pārbauda…":
		"Checking…",
	"Ielīmētajā tekstā nebija vērtību: {names}. Ievadi tās zemāk.":
		"The pasted text had no values for: {names}. Enter them below.",
	"Serveris neatbild:":
		"The server does not answer:",
	"Rīks":
		"Tool",
	"dot aģentam":
		"give to agent",
	"tikai lasa":
		"read only",
	"Rīks, kas nav atzīmēts «tikai lasa», prasa apstiprinājumu pirms katras partijas. Serveris var vēlāk pievienot jaunus rīkus: tie netiek doti, kamēr nenospied «Pārbaudīt».":
		"A tool not marked \"read only\" asks for confirmation before each batch. The server may add new tools later: they are not given until you press \"Check\".",
};
