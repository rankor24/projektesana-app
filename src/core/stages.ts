// Office delivery folders ↔ BIM stages of the timeline (design doc 0, Boris's answer 1: MBP is approximately the BIM
// Skiču stadija; BP is approximately Tehniskais projekts to Detalizācijas). Pure: the renderer uses it too.
//
// Real 1.4_Nodevumi folders (read on this PC, 2026-11-06) are looser than the standard: "1.4.1_Skices", "1.4.2_MBP",
// "1.4.3_BP_260109", "1.4.4_BP_65%", "BP_Nodevums_260320", "1.4.1_Paskaidrojuma raksts 260119", "2.starpziņojums".
// So the numbering prefix is dropped, the kind is a word anywhere in the name, and a date can sit anywhere in it.
import type { BimStage, DeliveryKind } from "./model.js";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/** "1.4.3_BP_260109" → "BP_260109" */
export const stripNumbering = (name: string) => name.trim().replace(/^1\.4(?:\.\d+)*[_\s.-]*/, "");

export function deliveryKindOf(folderName: string): DeliveryKind {
	const n = fold(stripNumbering(folderName)).replace(/[_\-.]+/g, " ");
	if (/\bSKIC|SKICU PROJ|PIRMAS SKICES/.test(n)) return "SKICE";
	if (/\bMBP\b|MINIMAL/.test(n)) return "MBP";
	if (/PASKAIDROJUMA RAKST/.test(n)) return "PR";
	if (/STARP(NODEVUM|ZINOJUM)|\bSTARP\b/.test(n)) return "STARP";
	if (/^DT\b|\bDT\b|DARBA (RASEJ|PROJ)/.test(n)) return "DT";
	if (/\bBP\b|BUVPROJ/.test(n)) return "BP";
	return "custom";
}

/** The stages a delivery kind covers on the timeline: first = where its chip sits. */
export const STAGES_OF: Record<DeliveryKind, BimStage[]> = {
	SKICE: ["Skice"],
	MBP: ["Skice"],
	BP: ["Tehniskais", "Detalizācijas"],
	PR: ["Tehniskais"],
	DT: ["Detalizācijas"],
	STARP: [],
	custom: [],
};

/** The stage a delivery sits in: its kind's first stage; an interim delivery (STARP) sits in the stage of the next real kind
 *  delivered after it, else the stage of the last one before it, else Koncept. */
export function stageOfDelivery(kind: DeliveryKind, context: { before?: DeliveryKind; after?: DeliveryKind } = {}): BimStage {
	const own = STAGES_OF[kind][0];
	if (own) return own;
	const near = (context.after && STAGES_OF[context.after][0]) || (context.before && STAGES_OF[context.before][0]);
	return near || "Koncept";
}

const valid = (iso: string) => {
	const t = Date.parse(`${iso}T00:00:00Z`);
	return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso;
};

/** "261005" / "2026-10-05" / "20261005_iesniegts" at the start of a folder name → ISO date. */
export function dateOfFolder(name: string): string | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})|^(\d{8})|^(\d{6})(?!\d)/.exec(name.trim());
	if (!m) return null;
	const iso = m[1] ? `${m[1]}-${m[2]}-${m[3]}` : m[4] ? `${m[4].slice(0, 4)}-${m[4].slice(4, 6)}-${m[4].slice(6, 8)}` : `20${m[5].slice(0, 2)}-${m[5].slice(2, 4)}-${m[5].slice(4, 6)}`;
	return valid(iso) ? iso : null;
}

/** A YYMMDD / YYYY-MM-DD anywhere in the name after the numbering ("BP_Nodevums_260320", "Paskaidrojuma raksts 260119"). */
export function dateInName(name: string): string | null {
	const s = stripNumbering(name);
	const m = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)|(?<!\d)(\d{6})(?!\d)/.exec(s);
	if (!m) return null;
	const iso = m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `20${m[4].slice(0, 2)}-${m[4].slice(2, 4)}-${m[4].slice(4, 6)}`;
	return valid(iso) ? iso : null;
}
