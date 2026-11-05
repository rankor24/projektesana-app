// Rules are data (spec §5): every rule carries its source, a read date and a verbatim quote.

export type ActId = "258572" | "269069" | "269164" | "301303" | "326992" | "72608";

export const ACTS: Record<ActId, { short: string; title: string }> = {
	"72608": { short: "Svētku dienu likums", title: "Likums „Par svētku, atceres un atzīmējamām dienām”" },
	"258572": { short: "Būvniecības likums", title: "Būvniecības likums" },
	"269069": { short: "MK 500", title: "Vispārīgie būvnoteikumi (MK 19.08.2014. noteikumi Nr. 500)" },
	"269164": { short: "MK 529", title: "Ēku būvnoteikumi (MK noteikumi Nr. 529)" },
	"301303": { short: "LBN 202-18", title: "LBN 202-18 Būvniecības ieceres dokumentācijas noformēšana (MK Nr. 545)" },
	"326992": { short: "LBN 200-21", title: "LBN 200-21 Ēku būvnoteikumi un būvnormatīvs (MK Nr. 693)" },
};

export type Stage = "koncepcija" | "skice" | "mbp" | "bp";
export type Section = "GP" | "AR" | "VISPARIGA" | "PROCESS";

export interface Rule {
	id: string;
	act: string;
	actId: ActId;
	/** e.g. "7.3 punkts" */
	article: string;
	url: string;
	/** ISO date the text was read from likumi.lv */
	read_on: string;
	valid_from: string | null;
	valid_to: string | null;
	/** machine-readable condition the engine uses, free keys */
	applies_when: Record<string, string | number | boolean>;
	/** content item or sadaļa this rule requires; empty for definitional rules */
	requires: string[];
	section: Section | null;
	/** verbatim text of the paragraph, exactly as in the snapshot */
	quote: string;
}

/** Rules in the law that take effect later and whose text is not visible yet: shown as `not read`, never as a rule. */
export const PENDING_UNREAD = [
	{ act: "Būvniecības likums", item: "15.1 pants — ieceres realizācija posmos", from: "2027-03-01" },
	{ act: "MK 500", item: "26.12.1 apakšpunkts", from: "2027-03-01" },
	{ act: "MK 529", item: "26.3.1 apakšpunkts (MBP), 74.2 punkts un 87.1 punkts", from: "2027-03-01" },
];

/** Acts and regulations the module has not read yet. */
export const NOT_READ = ["LBN 201-15", "LBN 208-15", "LBN 211-15", "LBN 016-15", "TIAN (teritorijas izmantošanas un apbūves noteikumi)", "LVS standartu saraksts"];
