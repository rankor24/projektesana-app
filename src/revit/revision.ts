// Working copy and revisions (task 6.2). Read and cleaned from v1 src/main/loop/revision.ts: the agent edits a working copy
// (<name>_WORK.rvt in the project's data folder, never the office file); after each batch the user confirmed, a revision is
// captured: IFC, the room table, optional sheets PDF, a summary and the diff from the previous revision (BimCraft's
// compareModels by GlobalId). Changed from v1: data folder instead of .bv in the project, nonce on every Revit call,
// BimCraft's IFC diff instead of v1's line diff, revision ids from the stored list.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Revision } from "../core/model.js";
import type { ProjectStore } from "../core/store.js";
import { diffIfc } from "../sources/ifc-diff.js";
import type { RevitCaller } from "./client.js";
import { revitRead } from "./commands.js";
import { revitExport, workName } from "./exports.js";

export const workDir = (store: ProjectStore) => join(store.dir, "work");
export const revisionDir = (store: ProjectStore, id: string) => join(store.dir, "revisions", id);

export function nextRevisionId(existing: Revision[]): string {
	const n = existing.map((r) => Number(/^r(\d+)$/.exec(r.id)?.[1] ?? 0));
	return `r${(n.length ? Math.max(...n) : 0) + 1}`;
}

const norm = (p: string) => resolve(p).toLowerCase();

/** Is the active Revit document this project's working copy? */
export function isWorkCopy(store: ProjectStore, docPath: string): boolean {
	return !!docPath && /_WORK\.rvt$/i.test(docPath) && norm(docPath).startsWith(norm(workDir(store)));
}

/** Saves the open document as the working copy in the data folder (the user's click). The office file stays as it was. */
export async function makeWorkCopy(store: ProjectStore, revit: RevitCaller): Promise<string> {
	const doc = await revitExport.docInfo(revit);
	if (isWorkCopy(store, doc.path)) return doc.path;
	mkdirSync(workDir(store), { recursive: true });
	const target = join(workDir(store), workName(doc.title));
	if (existsSync(target)) throw new Error(`Darba kopija jau ir: ${target}. Atver to Revit un turpini tajā.`);
	const path = await revitExport.saveAsWork(revit, target);
	store.log({ kind: "revit.workCopy", by: "user", data: { from: doc.title, to: target } });
	return path;
}

export interface CaptureOptions {
	trigger: Revision["trigger"];
	summary: string;
	/** sheet view ids to export into sheets.pdf; empty = no sheets */
	sheetIds?: string[];
	/** BimCraft's app folder (IFC diff) */
	bimcraftApp: string;
}

/** Exports everything the user reviews; throws on the first failure, nothing half-written is stored as a revision. */
export async function captureRevision(store: ProjectStore, revit: RevitCaller, o: CaptureOptions): Promise<Revision> {
	const doc = await revitExport.docInfo(revit);
	if (!isWorkCopy(store, doc.path)) throw new Error(`Aktīvais Revit dokuments nav šī projekta darba kopija (${doc.title}). Revīziju nefiksē.`);
	const all = store.read("revisions");
	const id = nextRevisionId(all);
	const dir = revisionDir(store, id);
	mkdirSync(dir, { recursive: true });
	await revitExport.exportIfc(revit, dir, "model.ifc");
	if (!existsSync(join(dir, "model.ifc"))) throw new Error(`Revit neizveidoja model.ifc mapē ${dir}.`);
	const rooms = await revitRead.rooms(revit);
	writeFileSync(join(dir, "rooms.json"), JSON.stringify(rooms, null, 1), "utf8");
	const sheets: string[] = [];
	if (o.sheetIds?.length) {
		await revitExport.exportPdf(revit, dir, "sheets", o.sheetIds);
		if (!existsSync(join(dir, "sheets.pdf"))) throw new Error(`Revit neizveidoja sheets.pdf mapē ${dir}.`);
		sheets.push(`revisions/${id}/sheets.pdf`);
	}
	const prev = [...all].reverse().find((r) => r.ifc);
	let diffFromPrev: Revision["diffFromPrev"] = null;
	if (prev?.ifc && existsSync(join(store.dir, prev.ifc))) {
		const d = await diffIfc(o.bimcraftApp, new Uint8Array(readFileSync(join(store.dir, prev.ifc))), new Uint8Array(readFileSync(join(dir, "model.ifc"))));
		writeFileSync(join(dir, "diff.json"), JSON.stringify({ against: prev.id, ...d }, null, 1), "utf8");
		diffFromPrev = { added: d.added.length, removed: d.removed.length, changed: d.changed.length };
	}
	const rev: Revision = { id, at: new Date().toISOString(), trigger: o.trigger, ifc: `revisions/${id}/model.ifc`, sheets, roomTable: `revisions/${id}/rooms.json`, summary: o.summary, diffFromPrev };
	store.write("revisions", [...all, rev], { kind: "revision.created", by: "app", data: { id, prev: prev?.id ?? null } });
	return rev;
}

/** The difference between two revision IFCs as counts (for the summary line). */
export async function revisionDiff(bimcraftApp: string, prevIfc: Uint8Array, ifc: Uint8Array): Promise<NonNullable<Revision["diffFromPrev"]>> {
	const d = await diffIfc(bimcraftApp, prevIfc, ifc);
	return { added: d.added.length, removed: d.removed.length, changed: d.changed.length };
}
