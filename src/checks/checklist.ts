// The checklist of a delivery being made (work plan 7.2): what this delivery must contain and whether the staged set has it.
// Derived on every read, never stored, so it cannot drift from the staging folder. Rows:
// - Lapas: the staged sheets against the open model's sheet list (when Revit answers);
// - Modelis: the IFC;
// - Likums: every law requirement the completeness check reads for this kind, met by the same covering() rule;
// - Saskaņojumi: the TN and approval clocks.
import { basename } from "node:path";
import type { Delivery, Finding, Requirement } from "../core/model.js";
import type { ProjectStore } from "../core/store.js";
import { clockOf, type ClockItem } from "../rules/clocks.js";
import { covering } from "./checks/completeness.js";
import type { ChecklistRow, RowStatus, SheetRow } from "../shared/nodevums.js";

export type { ChecklistGroup, ChecklistRow, RowAction, RowStatus, SheetRow } from "../shared/nodevums.js";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\s]+/g, " ").trim();
const normNo = (s: string) => s.toUpperCase().replace(/[\s_]+/g, "-");
const IFC_KINDS = new Set(["MBP", "BP", "DT"]);

/** Staged sheets against the model's sheets: by number; same number with another name is "renamed". */
export function compareSheets(d: Delivery, sheets: SheetRow[]): { matched: string[]; missing: SheetRow[]; extra: string[]; renamed: { number: string; staged: string; model: string }[] } {
	// a staged PDF is a sheet of this model only when its number prefix is one the model's sheets use ("AR", "BK"): a TN or an
	// approval named "TN-1_…" is a document of the delivery, not a missing sheet
	const prefix = (no: string) => /^[A-Z]+/.exec(normNo(no))?.[0] ?? "";
	const prefixes = new Set(sheets.map((s) => prefix(s.number)));
	const staged = d.items.filter((i) => i.sheetNo && /\.pdf$/i.test(i.file) && prefixes.has(prefix(i.sheetNo)));
	const byNo = new Map(sheets.map((s) => [normNo(s.number), s]));
	const matched: string[] = [];
	const extra: string[] = [];
	const renamed: { number: string; staged: string; model: string }[] = [];
	for (const i of staged) {
		const s = byNo.get(normNo(i.sheetNo!));
		if (!s) extra.push(basename(i.file));
		else {
			matched.push(basename(i.file));
			if (fold(i.title) !== fold(s.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\\/:*?"<>|]+/g, " "))) renamed.push({ number: s.number, staged: i.title, model: s.name });
		}
	}
	const have = new Set(staged.map((i) => normNo(i.sheetNo!)));
	return { matched, missing: sheets.filter((s) => !have.has(normNo(s.number))), extra, renamed };
}

function sheetsRow(d: Delivery, sheets: SheetRow[] | null, revitNote: string | null): ChecklistRow {
	const pdfs = d.items.filter((i) => /\.pdf$/i.test(i.file) && i.sheetNo);
	const files = pdfs.map((i) => basename(i.file));
	const row: ChecklistRow = { id: "sheets", group: "Lapas", label: "Rasējumu lapas no Revit (PDF, viena lapa — viens fails)", status: "trūkst", action: "revit_sheets", files };
	if (!sheets) {
		row.status = pdfs.length ? "pārbaudi" : "trūkst";
		row.detail = `${revitNote ?? "Revit nav pieslēgts"} — lapu saraksts nav salīdzināts ar modeli.`;
		return row;
	}
	const c = compareSheets(d, sheets);
	const parts = [`${c.matched.length} no ${sheets.length} modeļa lapām nodevumā`];
	if (c.renamed.length) parts.push(`citāds nosaukums: ${c.renamed.slice(0, 3).map((r) => `${r.number} “${r.staged}” ≠ “${r.model}”`).join("; ")}`);
	if (c.extra.length) parts.push(`nav modelī: ${c.extra.slice(0, 3).join(", ")}${c.extra.length > 3 ? " …" : ""}`);
	row.detail = parts.join(" · ");
	row.status = !c.matched.length ? "trūkst" : c.renamed.length || c.extra.length ? "pārbaudi" : "gatavs";
	return row;
}

function ifcRow(d: Delivery): ChecklistRow {
	const files = d.items.filter((i) => /\.ifc$/i.test(i.file)).map((i) => basename(i.file));
	const required = IFC_KINDS.has(d.kind);
	return {
		id: "ifc",
		group: "Modelis",
		label: "Informācijas modelis (IFC)",
		status: files.length ? (files.length > 1 ? "pārbaudi" : "gatavs") : required ? "trūkst" : "neobligāts",
		action: "revit_ifc",
		files,
		detail: files.length > 1 ? `${files.length} IFC faili — vai visi vajadzīgi?` : undefined,
	};
}

function lawRows(d: Delivery, reqs: Requirement[], findings: Finding[]): ChecklistRow[] {
	const out: ChecklistRow[] = [];
	for (const r of reqs) {
		if (r.origin !== "law" || r.state === "rejected" || !r.appliesTo.deliveries?.includes(d.kind)) continue;
		const citation = r.citation.kind === "law" ? `${r.citation.act} ${r.citation.point}` : undefined;
		const files = covering(r, d).map((f) => basename(f));
		const overridden = findings.some((f) => f.requirementId === r.id && f.where.deliveryId === d.id && f.state === "overridden");
		const conditional = /attiecas, ja:/.test(r.text);
		const status: RowStatus = r.status === "justified" || overridden ? "pamatots" : files.length ? "gatavs" : conditional ? "pārbaudi" : "trūkst";
		out.push({ id: `req:${r.id}`, group: "Likums", label: r.text, status, action: files.length || status === "pamatots" ? "file" : "justify", citation, requirementId: r.id, files, detail: conditional && status === "pārbaudi" ? "attiecas tikai ar nosacījumu — pārbaudi, vai attiecas" : undefined });
	}
	if (!out.length && (d.kind === "MBP" || d.kind === "BP"))
		out.push({ id: "req:none", group: "Likums", label: `Likuma prasības ${d.kind} saturam nav ielādētas`, status: "pārbaudi", action: "requirements", files: [], detail: "Prasību panelī atjauno prasības (MK 529 saturs pēc profila)." });
	return out;
}

function clockRows(store: ProjectStore, today: string): ChecklistRow[] {
	return store.readMeta<ClockItem[]>("clocks", []).map((c) => {
		const r = clockOf(c, today);
		return {
			id: `clock:${c.id}`,
			group: "Saskaņojumi" as const,
			label: r.label,
			status: r.state === "saņemts" ? ("gatavs" as const) : ("trūkst" as const),
			action: "clock" as const,
			citation: r.point,
			files: [],
			detail: r.state === "saņemts" ? `saņemts ${r.receivedOn}` : r.state === "kavē" ? `kavē ${-r.daysLeft} d.d. (termiņš ${r.due})` : `termiņš ${r.due}, ${r.daysLeft} d.d.`,
		};
	});
}

export function checklistOf(store: ProjectStore, deliveryId: string, opts: { today: string; sheets: SheetRow[] | null; revitNote?: string | null }): ChecklistRow[] {
	const d = store.read("deliveries").find((x) => x.id === deliveryId);
	if (!d) throw new Error(`Nodevums ${deliveryId} nav atrasts.`);
	return [sheetsRow(d, opts.sheets, opts.revitNote ?? null), ifcRow(d), ...lawRows(d, store.read("requirements"), store.read("findings")), ...clockRows(store, opts.today)];
}

/** One line per status for the agent and the page header. */
export function checklistSummary(rows: ChecklistRow[]): Record<RowStatus, number> {
	const s: Record<RowStatus, number> = { trūkst: 0, gatavs: 0, pamatots: 0, pārbaudi: 0, neobligāts: 0 };
	for (const r of rows) s[r.status]++;
	return s;
}
