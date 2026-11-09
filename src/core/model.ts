// The data model: the shapes every panel, check and agent tool uses (work plan, "Data model").
// Plain types and a few pure helpers, no I/O, so the renderer imports the same file.

/** Who did it: "user" is the person at the app (the one who decides), "agent" the AI, "app" the code itself.
 *  The person's name is not part of the role: it comes from the settings and is stamped where a decision is shown
 *  with attribution (Decision.name, a fact the user wrote). */
export type Who = "user" | "agent" | "app";

/** Shown where a decision has no stamped name (data written before names were kept, or no name in the settings). */
export const USER_LABEL = "lietotājs";

/** Data written before 2026-11-09 calls the user "boris". Mapped on read, in place, on freshly parsed JSON; the files on
 *  disk are not rewritten (the log is append-only, and each collection moves to "user" the next time it is written).
 *  Only the fields that hold an actor are touched: `by`, `plannedFrom`, and the `kind` of a user-written fact source. */
export function upgradeWho<T>(v: T): T {
	if (Array.isArray(v)) {
		for (const x of v) upgradeWho(x);
		return v;
	}
	if (v && typeof v === "object") {
		const o = v as Record<string, unknown>;
		for (const k of Object.keys(o)) {
			if (o[k] === "boris" && (k === "by" || k === "plannedFrom" || k === "kind")) o[k] = "user";
			else if (o[k] && typeof o[k] === "object") upgradeWho(o[k]);
		}
	}
	return v;
}

/** BIM stages of the timeline (design doc 0). */
export const BIM_STAGES = ["Koncept", "Skice", "Tehniskais", "Detalizācijas", "Būvniecība", "As-Built"] as const;
export type BimStage = (typeof BIM_STAGES)[number];

export interface Project {
	/** BD code, e.g. BD999 — the id of the data folder */
	id: string;
	name: string;
	/** office project folder (read-only source root) */
	root: string;
	createdAt: string;
}

// ---- sources -------------------------------------------------------------------------

export type SourceKind = "law" | "document" | "photoSurvey";
export type TextState = "ok" | "ocr" | "empty" | "unsupported" | "error" | "pending";

export interface Version {
	sha256: string;
	size: number;
	mtime: string;
	seenAt: string;
	textState: TextState;
	/** why the text state is not ok */
	textReason?: string;
	/** text cache file name under text\ (sha + .json) when text was read */
	textCache?: string;
	pages?: number;
}

export interface Signer {
	name: string;
	/** signing time as written in the signature */
	at: string | null;
	/** which signature file it came from */
	file: string;
}

export interface Source {
	id: string;
	kind: SourceKind;
	/** office folder key: 1.1.1 … 1.1.7 fixed, 1.1.8+ free */
	folderKey: string;
	/** relative to the project root; duplicates (same sha) share one Source */
	paths: string[];
	title: string;
	role: string;
	/** role came from the fixed folder map, from a remembered confirmation, or still needs the user */
	/** "document": the user set the role on this one document (Avoti); it wins over the folder's role */
	roleFrom: "folder" | "confirmed" | "unconfirmed" | "document";
	versions: Version[];
	signers: Signer[];
	/** for a file inside an .edoc: the container's relative path and the inner name */
	container?: { path: string; inner: string; containerSha?: string };
	/** photo survey: one Source per YYMMDD_FF folder */
	survey?: { date: string | null; count: number; folder: string };
}

// ---- facts and profile -----------------------------------------------------------------

export type FactState = "proposed" | "confirmed" | "rejected";

export type FactSource = { sourceId: string; sha: string; page: number; quote: string } | { kind: "user"; at: string; name?: string };

export interface Fact {
	id: string;
	key: string;
	value: string;
	source: FactSource;
	state: FactState;
	by: Who;
	at: string;
}

/** Profile keys (design doc 3). Each value in the profile is a Fact. */
export const PROFILE_KEYS = ["workType", "group", "procedure", "stagesInContract", "sections", "funding", "bim.bipPresent", "bim.lodByStage", "use", "totalAreaM2", "floorsAbove", "floorsBelow", "address", "cadastralNo"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export type Profile = Partial<Record<ProfileKey, Fact>>;

/** The profile is the newest non-rejected fact per profile key; a confirmed fact wins over a proposed one. */
export function profileOf(facts: Fact[]): Profile {
	const out: Profile = {};
	for (const key of PROFILE_KEYS) {
		const k = `profile.${key}`;
		const live = facts.filter((f) => f.key === k && f.state !== "rejected").sort((a, b) => (a.state === b.state ? b.at.localeCompare(a.at) : a.state === "confirmed" ? -1 : 1));
		if (live[0]) out[key] = live[0];
	}
	return out;
}

// ---- requirements, findings ------------------------------------------------------------

export type RequirementOrigin = "law" | "pu" | "bip" | "tn" | "permit" | "office";

export type Citation =
	| { kind: "law"; act: string; actId: string; actVersionDate: string | null; readOn: string; point: string; url: string; quote: string }
	| { kind: "document"; sourceId: string; sha: string; page: number; quote: string }
	/** the office standard document, read at run time from the file the user set (never shipped: it is company-internal) */
	| { kind: "office"; file: string; page: number; quote: string };

export interface AppliesTo {
	stages?: BimStage[];
	deliveries?: string[];
	sections?: string[];
	sheets?: string[];
}

export type RequirementStatus = "open" | "met" | "failed" | "justified";

export interface Requirement {
	id: string;
	origin: RequirementOrigin;
	citation: Citation;
	text: string;
	appliesTo: AppliesTo;
	checkId: string | null;
	status: RequirementStatus;
	evidence: string[];
	state: FactState;
	by: Who;
	at: string;
}

export type Severity = "error" | "warning" | "info";

export interface Where {
	sourceId?: string;
	page?: number;
	sheet?: string;
	elementGuid?: string;
	roomNo?: string;
	deliveryId?: string;
	path?: string;
}

export interface Decision {
	by: Who;
	/** the user's name from the settings when the decision was made (absent in older data) */
	name?: string;
	at: string;
	reason: string;
}

export interface Finding {
	id: string;
	checkId: string;
	requirementId: string | null;
	severity: Severity;
	where: Where;
	message: string;
	/** a stable key per check so a re-run updates the same finding instead of adding a copy */
	key: string;
	state: "open" | "closed" | "overridden";
	decision?: Decision;
	/** an agent's proposed justification, waiting for the user */
	proposal?: { reason: string; at: string };
	firstSeen: string;
	lastSeen: string;
}

// ---- deliveries, revisions, pins, notes, events -------------------------------------------------

/** PR = paskaidrojuma raksts (MK 529 route for simpler works) */
export type DeliveryKind = "SKICE" | "MBP" | "BP" | "PR" | "DT" | "STARP" | "custom";

export interface DeliveryItem {
	sheetNo: string | null;
	title: string;
	file: string;
	sha: string | null;
}

export interface Delivery {
	id: string;
	stage: BimStage;
	kind: DeliveryKind;
	label: string;
	plannedDate: string | null;
	plannedFrom?: "bip" | "user";
	submittedDate: string | null;
	folder: string | null;
	items: DeliveryItem[];
	checksRun: { at: string; open: number }[];
	sent?: { at: string; by: "user" };
}

export interface Revision {
	id: string;
	at: string;
	trigger: "agentBatch" | "manualSave";
	ifc: string | null;
	sheets: string[];
	roomTable: string | null;
	summary: string;
	diffFromPrev: { added: number; removed: number; changed: number } | null;
}

export type PinTarget = { sheet?: string; sourceId?: string; page?: number; x: number; y: number; viewId?: string } | { elementGuid: string };

export interface Pin {
	id: string;
	target: PinTarget;
	text: string;
	comments: { by: Who; at: string; text: string }[];
	by: Who;
	at: string;
	/** open → resolved (agent says done) → closed (the user) */
	state: "open" | "resolved" | "closed";
	findingId: string | null;
	requirementId: string | null;
}

export type NoteType = "decision" | "answer" | "learning" | "question";

export interface Note {
	id: string;
	type: NoteType;
	title: string;
	body: string;
	refs: string[];
	by: Who;
	at: string;
}

export interface Event {
	seq: number;
	at: string;
	by: string;
	kind: string;
	data?: Record<string, unknown>;
}

/** The JSON collections of a project's data folder. */
export interface Collections {
	sources: Source[];
	facts: Fact[];
	requirements: Requirement[];
	findings: Finding[];
	deliveries: Delivery[];
	pins: Pin[];
	revisions: Revision[];
}

export type CollectionName = keyof Collections;
export const COLLECTIONS: CollectionName[] = ["sources", "facts", "requirements", "findings", "deliveries", "pins", "revisions"];

/** BD code from an office folder name: "BD427-2026_Pilseta_Iela 9" → "BD427"; a prefix such as "AU_" (autoruzraudzība)
 *  before the code is allowed. */
export function bdCodeOf(folderName: string): string | null {
	const m = /^\s*(?:[A-Z]{1,4}_)?(BD\s?\d{3,4})(?![\d])/i.exec(folderName);
	return m ? m[1].replace(/\s/, "").toUpperCase() : null;
}

export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
