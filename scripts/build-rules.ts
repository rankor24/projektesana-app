// Builds data/rules.json from the likumi.lv snapshots. Quotes are cut out of the snapshot by code,
// never typed, so a rule cannot carry words the law does not contain.
// Run: node --import tsx scripts/build-rules.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACTS, type ActId, type Rule, type Section } from "../src/main/rules/types.ts";

const SNAP = join(import.meta.dirname, "..", "data", "law-snapshots");
const READ_ON = "2026-11-03";

interface Spec {
	id: string;
	actId: ActId;
	/** the paragraph starts with this text (whitespace normalised) */
	prefix: string;
	article: string;
	when?: Rule["applies_when"];
	requires?: string[];
	section?: Section;
	/** n-th paragraph with that prefix (0-based) */
	nth?: number;
	valid_from?: string;
}

const A = "269069";
const B = "269164";

const specs: Spec[] = [
	// --- Būvniecības likums: deviations from the building codes need a separate approval, never the PU alone ---
	{ id: "law-9-1-new", actId: "258572", prefix: "(3) Jaunas būvniecības gadījumā atkāpes no būvnormatīvu tehniskajām prasībām", article: "9.1 panta trešā daļa", when: { work: "new_build" }, requires: ["Atkāpju saskaņošana (jauna būvniecība)"] },
	{ id: "law-9-1-reconstr", actId: "258572", prefix: "(4) Atjaunošanas, pārbūves vai restaurācijas gadījumā atkāpes no būvnormatīvu tehniskajām prasībām", article: "9.1 panta ceturtā daļa", when: { work: "reconstruction" }, requires: ["Atkāpju saskaņošana (pārbūve, atjaunošana)"] },

	// --- public holidays: the working-day count of the technical-rules deadline skips them ---
	{ id: "hol-list", actId: "72608", prefix: "1. Noteikt par svētku dienām:", article: "1. punkts (svētku dienu saraksts)", when: { deadlineWorkdays: 11 } },
	{ id: "hol-easter", actId: "72608", prefix: "Lielo Piektdienu un Pirmās Lieldienas", article: "1. punkts (Lieldienas)", when: { deadlineWorkdays: 11 } },
	{ id: "hol-christmas", actId: "72608", prefix: "24., 25. un 26. decembri", article: "1. punkts (Ziemassvētki)", when: { deadlineWorkdays: 11 } },
	{ id: "hol-move", actId: "72608", prefix: "Ja svētku dienas — 4.maijs", article: "1. punkts (pārcelšana uz nākamo darbdienu)", when: { deadlineWorkdays: 11 } },

	// --- building group (MK 500, 1. pielikums) ---
	{ id: "grp1-single-storey", actId: A, prefix: "2.1.1. vienstāva ēkas ar apbūves laukumu līdz 60 m2", article: "1. pielikums 2.1.1. apakšpunkts", when: { group: 1 } },
	{ id: "grp3-floors-above", actId: A, prefix: "2.2.1. ēkas, kurām ir vairāk nekā seši virszemes stāvi", article: "1. pielikums 2.2.1. apakšpunkts", when: { group: 3 } },
	{ id: "grp3-floors-below", actId: A, prefix: "2.2.2. ēkas, kurām ir vairāk nekā viens apakšzemes stāvs", article: "1. pielikums 2.2.2. apakšpunkts", when: { group: 3 } },
	{ id: "grp3-public-area", actId: A, prefix: "2.2.3. publiskas ēkas ar kopējo platību, lielāku par 1000 m2", article: "1. pielikums 2.2.3. apakšpunkts", when: { group: 3 } },
	{ id: "grp3-prod-fire", actId: A, prefix: "2.2.4. rūpnieciskās ražošanas ēkas ar paredzēto ugunsslodzi", article: "1. pielikums 2.2.4. apakšpunkts", when: { group: 3 } },
	{ id: "grp3-prod-area", actId: A, prefix: "2.2.5. rūpnieciskās ražošanas ēkas ar kopējo platību", article: "1. pielikums 2.2.5. apakšpunkts", when: { group: 3 } },
	{ id: "grp3-wh-fire", actId: A, prefix: "2.2.6. noliktavas ēkas ar paredzēto ugunsslodzi", article: "1. pielikums 2.2.6. apakšpunkts", when: { group: 3 } },
	{ id: "grp3-wh-area", actId: A, prefix: "2.2.7. noliktavas ēkas ar kopējo platību", article: "1. pielikums 2.2.7. apakšpunkts", when: { group: 3 } },
	{ id: "grp2-rest", actId: A, prefix: "2.3. otrās grupas ēkas ir ēkas", article: "1. pielikums 2.3. apakšpunkts", when: { group: 2 } },

	// --- stages and PU (MK 500) ---
	{ id: "pu-stages", actId: A, prefix: "18.3 Projektēšanas uzdevumā norāda", article: "18.3 punkts", requires: ["PU: būvprojekta stadijas"] },
	{ id: "stage-koncepcija", actId: A, prefix: "26.11. projekta koncepcija", article: "26.11. apakšpunkts", when: { stage: "koncepcija" } },
	{ id: "stage-skice", actId: A, prefix: "26.12. skiču projekts", article: "26.12. apakšpunkts", when: { stage: "skice" } },
	{ id: "stage-tehniskais", actId: A, prefix: "26.13. tehniskais projekts", article: "26.13. apakšpunkts", when: { stage: "bp" } },
	{ id: "stage-darba", actId: A, prefix: "26.14. darba projekts", article: "26.14. apakšpunkts", when: { stage: "bp" } },
	{ id: "tr-request", actId: A, prefix: "27. Pirms būvprojekta izstrādāšanas", article: "27. punkts", requires: ["Tehniskie noteikumi: pieprasīt"] },
	{ id: "tr-deadline-state", actId: A, prefix: "27.1 Valsts un pašvaldību institūcijas tehniskos", article: "27.1 punkts", when: { deadlineWorkdays: 11, issuer: "state_municipal" } },
	{ id: "tr-deadline-network", actId: A, prefix: "27.2 Inženierbūvju īpašnieki vai tiesiskie valdītāji tehniskos", article: "27.2 punkts", when: { deadlineWorkdays: 11, issuer: "network_owner" } },
	{ id: "mark-design-conditions", actId: A, prefix: "12.24. 15 darbdienu laikā", article: "12.24. apakšpunkts", when: { deadlineWorkdays: 15 } },

	// --- procedures (MK 529 §7) ---
	{ id: "proc-notice-simplified-renov", actId: B, prefix: "7.1 1. otrās vai trešās grupas ēkas vai tās daļas vienkāršota atjaunošana", article: "7.1 1. apakšpunkts", when: { procedure: "pazinojums", work: "simplified_renovation" } },
	{ id: "proc-notice-demolish", actId: B, prefix: "7.1 3. pirmās grupas ēkas nojaukšana", article: "7.1 3. apakšpunkts", when: { procedure: "pazinojums", work: "demolition", group: 1 } },
	{ id: "proc-notice-new-g1", actId: B, prefix: "7.1 4. pirmās grupas dzīvojamās ēkas, palīgēkas", article: "7.1 4. apakšpunkts", when: { procedure: "pazinojums", work: "new_build", group: 1 } },
	{ id: "proc-notice-reconstr-g2", actId: B, prefix: "7.1 6. otrās grupas viena vai divu dzīvokļu dzīvojamās ēkas atjaunošana vai pārbūve", article: "7.1 6. apakšpunkts", when: { procedure: "pazinojums", work: "reconstruction", group: 2 } },
	{ id: "proc-expl-new-small", actId: B, prefix: "7.2 1. pirmās grupas ēkas vai otrās grupas viena dzīvokļa dzīvojamās ēkas ar kopējo platību", article: "7.2 1. apakšpunkts", when: { procedure: "paskaidrojuma_raksts", work: "new_build" } },
	{ id: "proc-expl-seasonal", actId: B, prefix: "7.2 2. otrās vai trešās grupas sezonas ēkas jauna būvniecība", article: "7.2 2. apakšpunkts", when: { procedure: "paskaidrojuma_raksts", work: "new_build", seasonal: true } },
	{ id: "proc-expl-g1-reconstr", actId: B, prefix: "7.2 4. pirmās grupas ēkas vai tās daļas pārbūve", article: "7.2 4. apakšpunkts", when: { procedure: "paskaidrojuma_raksts", work: "reconstruction", group: 1 } },
	{ id: "proc-expl-demolish", actId: B, prefix: "7.2 5. otrās vai trešās grupas ēkas nojaukšana", article: "7.2 5. apakšpunkts", when: { procedure: "paskaidrojuma_raksts", work: "demolition" } },
	{ id: "proc-expl-renov", actId: B, prefix: "7.2 6. pirmās, otrās vai trešās grupas ēkas vai tās daļas atjaunošana", article: "7.2 6. apakšpunkts", when: { procedure: "paskaidrojuma_raksts", work: "renovation" } },
	{ id: "proc-expl-use-change", actId: B, prefix: "7.2 7. pirmās, otrās vai trešās grupas ēkas vai telpu grupas lietošanas veida maiņa", article: "7.2 7. apakšpunkts", when: { procedure: "paskaidrojuma_raksts", work: "use_change" } },
	{ id: "proc-expl-simple-reconstr", actId: B, prefix: "7.2 8. pirmās, otrās vai trešās grupas ēkas vai tās daļas vienkāršota pārbūve", article: "7.2 8. apakšpunkts", when: { procedure: "paskaidrojuma_raksts", work: "simple_reconstruction" } },
	{ id: "proc-mbp", actId: B, prefix: "7.3 Pārējos gadījumos", article: "7.3 punkts", when: { procedure: "mbp_buvatlauja" } },

	// --- MBP content (MK 529 §26) ---
	{ id: "mbp-intro", actId: B, prefix: "26. Ierosinot būvniecību šo noteikumu 7.3 punktā minētajā gadījumā", article: "26. punkts", when: { stage: "mbp" } },
	{ id: "mbp-description", actId: B, prefix: "26.1. skaidrojošu aprakstu par plānoto būvniecības ieceri", article: "26.1. apakšpunkts", when: { stage: "mbp" }, requires: ["Skaidrojošs apraksts"], section: "VISPARIGA" },
	{ id: "mbp-gp", actId: B, prefix: "26.2. ģenerālplānu, kurā norādīta projektējamo būvju eksplikācija", article: "26.2. apakšpunkts", when: { stage: "mbp" }, requires: ["Ģenerālplāns"], section: "GP" },
	{ id: "mbp-plans", actId: B, prefix: "26.4.1. ēkas stāvu un jumta plānus", article: "26.4.1. apakšpunkts", when: { stage: "mbp", work: "new_build" }, requires: ["Stāvu plāni ar telpu eksplikāciju", "Jumta plāns"], section: "AR" },
	{ id: "mbp-facades", actId: B, prefix: "26.4.2. ēkas fasādes ar augstuma atzīmēm", article: "26.4.2. apakšpunkts", when: { stage: "mbp", work: "new_build" }, requires: ["Fasādes ar augstuma atzīmēm"], section: "AR" },
	{ id: "mbp-sections", actId: B, prefix: "26.4.3. raksturīgos griezumus ar augstuma atzīmēm", article: "26.4.3. apakšpunkts", when: { stage: "mbp", work: "new_build" }, requires: ["Raksturīgie griezumi ar augstuma atzīmēm"], section: "AR" },
	{ id: "mbp-reconstr", actId: B, prefix: "26.6. ja paredzēta pārbūve, papildus ietver grafisko dokumentu", article: "26.6. apakšpunkts", when: { stage: "mbp", work: "reconstruction" }, requires: ["Grafiskais dokuments ar plānotajām izmaiņām"], section: "AR" },

	// --- BP composition (MK 529 §71, §72) ---
	{ id: "bp2-gp", actId: B, prefix: "71.1.5. ģenerālplāns", article: "71.1.5. apakšpunkts", when: { stage: "bp", group: 2 }, requires: ["Ģenerālplāns"], section: "GP" },
	{ id: "bp2-ar-plans", actId: B, prefix: "71.2.1. ēkas jumta un stāvu plāni", article: "71.2.1. apakšpunkts", when: { stage: "bp", group: 2 }, requires: ["Jumta un stāvu plāni ar telpu eksplikāciju"], section: "AR" },
	{ id: "bp2-ar-facades", actId: B, prefix: "71.2.2. ēkas fasādes ar augstuma atzīmēm", article: "71.2.2. apakšpunkts", when: { stage: "bp", group: 2 }, requires: ["Fasādes ar augstuma atzīmēm"], section: "AR" },
	{ id: "bp2-ar-sections", actId: B, prefix: "71.2.3. raksturīgie griezumi ar augstuma atzīmēm", article: "71.2.3. apakšpunkts", when: { stage: "bp", group: 2 }, requires: ["Raksturīgie griezumi ar augstuma atzīmēm"], section: "AR" },
	{ id: "bp2-ar-spec", actId: B, prefix: "71.2.5. būvizstrādājumu specifikācijas", article: "71.2.5. apakšpunkts", when: { stage: "bp", group: 2 }, requires: ["Būvizstrādājumu specifikācijas (AR)"], section: "AR" },
	{ id: "bp3-gp", actId: B, prefix: "72.1.5. ģenerālplāns", article: "72.1.5. apakšpunkts", when: { stage: "bp", group: 3 }, requires: ["Ģenerālplāns"], section: "GP" },
	{ id: "bp3-ar-plans", actId: B, prefix: "72.2.1. ēkas jumta un stāvu plāni", article: "72.2.1. apakšpunkts", when: { stage: "bp", group: 3 }, requires: ["Jumta un stāvu plāni ar telpu eksplikāciju"], section: "AR" },
	{ id: "bp3-ar-facades", actId: B, prefix: "72.2.2. ēkas fasādes ar būtisko elementu", article: "72.2.2. apakšpunkts", when: { stage: "bp", group: 3 }, requires: ["Fasādes ar augstuma atzīmēm un apdares norādēm"], section: "AR" },
	{ id: "bp3-ar-sections", actId: B, prefix: "72.2.3. raksturīgie griezumi ar esošā", article: "72.2.3. apakšpunkts", when: { stage: "bp", group: 3 }, requires: ["Raksturīgie griezumi ar augstuma atzīmēm un konstrukciju slāņiem"], section: "AR" },
	{ id: "bp3-ar-spec", actId: B, prefix: "72.2.5. būvizstrādājumu specifikācijas", article: "72.2.5. apakšpunkts", when: { stage: "bp", group: 3 }, requires: ["Būvizstrādājumu specifikācijas (AR)"], section: "AR" },
	{ id: "bp3-ar-details", actId: B, prefix: "72.2.6. galveno ēkas detaļu mezglu risinājumi", article: "72.2.6. apakšpunkts", when: { stage: "bp", group: 3 }, requires: ["Galveno detaļu mezgli"], section: "AR" },

	// --- BIM model (MK 529 §74.1) ---
	{ id: "bim-model", actId: B, prefix: "74.1 No publisko tiesību juridiskās personas līdzekļiem finansētu trešās grupas ēku jaunai būvniecībai", article: "74.1 punkts", when: { stage: "bp", group: 3, publicFunded: true, work: "new_build" }, requires: ["Būves informācijas modelis (atvērtais formāts) caur BIS"] },

	// --- formatting (LBN 202-18) ---
	{ id: "lbn202-scope", actId: "301303", prefix: "2. Būvnormatīvs neattiecas uz būvniecības ieceres metu", article: "2. punkts", when: { stage: "skice" } },
	{ id: "lbn202-pdf", actId: "301303", prefix: "3. Būvniecības ieceres dokumentācijas teksta un grafiskās datnes", article: "3. punkts", when: { stage: "mbp" }, requires: ["PDF formāts BIS"] },
];

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const cache = new Map<string, string[]>();
function lines(actId: string): string[] {
	if (!cache.has(actId)) cache.set(actId, readFileSync(join(SNAP, `${actId}.txt`), "utf8").split("\n").map(norm));
	return cache.get(actId)!;
}

const rules: Rule[] = specs.map((s) => {
	const hits = lines(s.actId).filter((l) => l.startsWith(norm(s.prefix)));
	const q = hits[s.nth ?? 0];
	if (!q) throw new Error(`Rule ${s.id}: no paragraph starts with "${s.prefix}" in ${s.actId}`);
	return {
		id: s.id,
		act: ACTS[s.actId].short,
		actId: s.actId,
		article: s.article,
		url: `https://likumi.lv/ta/id/${s.actId}`,
		read_on: READ_ON,
		valid_from: s.valid_from ?? null,
		valid_to: null,
		applies_when: s.when ?? {},
		requires: s.requires ?? [],
		section: s.section ?? null,
		quote: q,
	};
});

writeFileSync(join(import.meta.dirname, "..", "data", "rules.json"), JSON.stringify(rules, null, 1), "utf8");
console.log(`rules.json: ${rules.length} rules`);
