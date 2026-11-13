// Ekspertīze (task 8.14): the remarks of an expert review (ekspertīzes atzinums). Node-free: the panel imports this file.

export type RemarkState = "open" | "done" | "na";

/** One remark of a review: where it is, its words, and what the user has done with it. */
export interface ExpertRemark {
	/** stable: the source, the page and a hash of the quote, so reading the same review again adds nothing */
	id: string;
	sourceId: string;
	page: number;
	/** the review's own number ("A3", "2.4", "5"), when it has one */
	code: string | null;
	/** the part (daļa) it is about, as the office marks it: AR, BK, AVK, UK, EL, ESS, GP … ; null when the text does not say */
	daļa: string | null;
	/** the heading it stood under */
	section: string | null;
	/** the review's words, verbatim from the page (whitespace normalised) */
	quote: string;
	critical: boolean;
	/** who has to answer it, only when the review or the user says so; never guessed */
	responsible: string | null;
	/** the designer's reply written in the review document itself (a table's comment column), when there is one */
	reply: string | null;
	state: RemarkState;
	/** why it is not applicable, or how it was done */
	note: string | null;
	by: "app" | "agent" | "user";
	at: string;
	decidedAt: string | null;
}

export interface ReviewMeta {
	auditor?: string;
	project?: string;
}

/** What the parser finds before it is stored. */
export interface ParsedRemark {
	page: number;
	code: string | null;
	daļa: string | null;
	section: string | null;
	quote: string;
	critical: boolean;
	/** the reviewer already marks it done ([x]) */
	done: boolean;
	responsible: string | null;
	reply: string | null;
}

export interface ParsedReview {
	remarks: ParsedRemark[];
	meta: ReviewMeta;
}

export const REMARK_STATE_LABEL: Record<RemarkState, string> = { open: "atvērts", done: "izpildīts", na: "nav aktuāls" };

export interface GroupRow {
	key: string;
	total: number;
	open: number;
	critical: number;
}

export interface ExpertSummary {
	total: number;
	open: number;
	done: number;
	na: number;
	critical: number;
	openCritical: number;
	byDaļa: GroupRow[];
	byResponsible: GroupRow[];
}

/** A source the panel can read as a review, with how many remarks it already has. */
export interface ReviewSource {
	id: string;
	title: string;
	role: string;
	pages: number;
	remarks: number;
}

export interface ImportResult {
	found: number;
	added: number;
	/** already in the list (their state and edits are kept) */
	kept: number;
	meta: ReviewMeta;
}
