// Office delivery folders ↔ BIM stages of the timeline (design doc 0, Boris's answer 1: MBP is approximately the BIM
// Skiču stadija; BP is approximately Tehniskais projekts to Detalizācijas). Pure: the renderer uses it too.
import type { BimStage, DeliveryKind } from "./model.js";

/** "SKICE", "MBP", "BP", "Starpnodevums", "DT", … (folder names in 1.4_Nodevumi) → delivery kind. */
export function deliveryKindOf(folderName: string): DeliveryKind {
	const n = folderName.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
	if (/^SKIC|SKICU\s*PROJ/.test(n)) return "SKICE";
	if (/^MBP|MINIMAL/.test(n)) return "MBP";
	if (/^STARP/.test(n)) return "STARP";
	if (/^DT|DARBA/.test(n)) return "DT";
	if (/^BP|BUVPROJ/.test(n)) return "BP";
	return "custom";
}

/** The stages a delivery kind covers on the timeline: first = where its chip sits. */
export const STAGES_OF: Record<DeliveryKind, BimStage[]> = {
	SKICE: ["Skice"],
	MBP: ["Skice"],
	BP: ["Tehniskais", "Detalizācijas"],
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

/** "261005" / "2026-10-05" / "20261005" at the start of a folder name → ISO date. */
export function dateOfFolder(name: string): string | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})|^(\d{8})|^(\d{6})(?!\d)/.exec(name.trim());
	if (!m) return null;
	const iso = m[1] ? `${m[1]}-${m[2]}-${m[3]}` : m[4] ? `${m[4].slice(0, 4)}-${m[4].slice(4, 6)}-${m[4].slice(6, 8)}` : `20${m[5].slice(0, 2)}-${m[5].slice(2, 4)}-${m[5].slice(4, 6)}`;
	const t = Date.parse(`${iso}T00:00:00Z`);
	return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso ? null : iso;
}
