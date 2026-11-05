// The core loop (spec §6): agent batch → Revit exports → revision folder → review.
// A revision = IFC + view PDFs + JSON summary + diff + log. The agent edits a working copy; only approved revisions leave it.
import { copyFileSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { appendLog } from "../../kernel/log.js";
import { ifcDiff, roomDiff } from "../../kernel/diff.js";
import { initReview, loadReview, openPins, revisionComplete, type ViewGeometry } from "../../kernel/pins.js";
import { ensureActiveDocument, exportIfc, exportPdf, listViews, modelSummary, saveWork, viewGeometry, type ModelSummary, type RevitCaller } from "../revit/commands.js";
import { pdfContentRect } from "./pdfrect.js";
import { loadBrief } from "../chat/brief.js";
import { buildPrompt } from "./prompt.js";
import type { Engine, McpLaunch } from "../engines/types.js";
import { REVIT_SERVER, TOOLS_SERVER } from "../engines/types.js";
import type { RunEvent } from "../../shared/types.js";

export const revisionsDir = (root: string) => join(root, ".bv", "revisions");
export const revisionDir = (root: string, id: string) => join(revisionsDir(root), id);

export function nextRevisionId(root: string): string {
	const d = revisionsDir(root);
	const n = existsSync(d) ? readdirSync(d).filter((x) => /^r\d+$/.test(x)).map((x) => Number(x.slice(1))) : [];
	return `r${(n.length ? Math.max(...n) : 0) + 1}`;
}

export function previousRevisionId(root: string, id: string): string | null {
	const n = Number(id.slice(1)) - 1;
	return n >= 1 && existsSync(revisionDir(root, `r${n}`)) ? `r${n}` : null;
}

const safe = (s: string) => s.replace(/[^\p{L}\p{N}._ -]+/gu, "_").trim() || "skats";

export interface Manifest {
	id: string;
	createdAt: string;
	workPath: string;
	prev: string | null;
	pages: { file: string; viewId: string; viewName: string; viewType: string }[];
	model: string;
}

/** Exports everything Boris reviews. Throws on the first failure; nothing is half-written as "complete". */
export async function captureRevision(d: { root: string; revit: RevitCaller; id: string; workPath: string; viewIds?: string[] }): Promise<Manifest> {
	const dir = revisionDir(d.root, d.id);
	mkdirSync(dir, { recursive: true });
	await ensureActiveDocument(d.revit, d.workPath);
	const all = await listViews(d.revit);
	const views = (d.viewIds ? all.filter((v) => d.viewIds!.includes(v.id)) : all.filter((v) => v.type !== "ThreeD")).filter((v) => v.type !== "ThreeD");
	if (!views.length) throw new Error("Modelī nav skatu, ko eksportēt (stāvu plāni, fasādes, griezumi).");

	const pages: Manifest["pages"] = [];
	const geometry: Record<string, ViewGeometry> = {};
	for (const v of views) {
		const name = safe(v.name);
		await exportPdf(d.revit, dir, name, v.id);
		const file = `${name}.pdf`;
		if (!existsSync(join(dir, file))) throw new Error(`Revit neizveidoja ${file} mapē ${dir}.`);
		geometry[file] = await viewGeometry(d.revit, v.id, await pdfContentRect(join(dir, file)));
		pages.push({ file, viewId: v.id, viewName: v.name, viewType: v.type });
	}
	await exportIfc(d.revit, dir, "model");
	if (!existsSync(join(dir, "model.ifc"))) throw new Error(`Revit neizveidoja model.ifc mapē ${dir}.`);
	const summary = await modelSummary(d.revit);
	writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 1), "utf8");
	writeFileSync(join(dir, "geometry.json"), JSON.stringify(geometry, null, 1), "utf8");

	const prev = previousRevisionId(d.root, d.id);
	if (prev && existsSync(join(revisionDir(d.root, prev), "model.ifc"))) {
		const prevSummary = JSON.parse(readFileSync(join(revisionDir(d.root, prev), "summary.json"), "utf8")) as ModelSummary;
		const diff = { against: prev, ifc: ifcDiff(readFileSync(join(revisionDir(d.root, prev), "model.ifc"), "utf8"), readFileSync(join(dir, "model.ifc"), "utf8")), rooms: roomDiff(prevSummary.rooms, summary.rooms) };
		writeFileSync(join(dir, "diff.json"), JSON.stringify(diff, null, 1), "utf8");
	}

	const manifest: Manifest = { id: d.id, createdAt: new Date().toISOString(), workPath: d.workPath, prev, pages, model: "model.ifc" };
	writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1), "utf8");
	initReview(d.root, d.id, [...pages.map((p) => ({ item: p.file, kind: "page" as const })), { item: "model.ifc", kind: "model" as const }]);
	appendLog(d.root, { kind: "revision.created", by: "app", data: { id: d.id, pages: pages.length, prev } });
	return manifest;
}

/** Saves the working copy and copies the file beside it, so a bad batch can be undone by hand. Never overwrites a snapshot. */
export async function snapshotWork(root: string, revit: RevitCaller, workPath: string, id: string): Promise<string> {
	await saveWork(revit);
	const target = join(root, "snapshots", `${basename(workPath, ".rvt")}_before_${id}.rvt`);
	mkdirSync(dirname(target), { recursive: true });
	copyFileSync(workPath, target, constants.COPYFILE_EXCL);
	appendLog(root, { kind: "snapshot.created", by: "app", data: { id, target } });
	return target;
}

export interface BatchDeps {
	root: string;
	engine: Engine;
	revit: RevitCaller;
	workPath: string;
	/** tools is built per batch: the server must know the revision id for finish_revision */
	mcp: { revit: McpLaunch; tools: (revisionId: string) => McpLaunch };
	instruction: string;
	signal: AbortSignal;
	onEvent: (e: RunEvent) => void;
}

export type BatchResult = { ok: true; manifest: Manifest } | { ok: false; reason: string; id: string };

/** One agent batch → one revision. */
export async function runAgentBatch(d: BatchDeps): Promise<BatchResult> {
	const id = nextRevisionId(d.root);
	const dir = revisionDir(d.root, id);
	mkdirSync(dir, { recursive: true });
	try {
		await ensureActiveDocument(d.revit, d.workPath);
		await snapshotWork(d.root, d.revit, d.workPath, id);
	} catch (e) {
		return { ok: false, id, reason: (e as Error).message };
	}
	const prompt = buildPrompt({ instruction: d.instruction, brief: loadBrief(d.root), pins: openPins(d.root) });
	appendLog(d.root, { kind: "agent.run", by: `agent:${d.engine.id}`, data: { id, instruction: d.instruction } });
	let failed: string | null = null;
	await d.engine.run({
		prompt,
		runDir: join(dir, "run"),
		mcp: { [REVIT_SERVER]: d.mcp.revit, [TOOLS_SERVER]: d.mcp.tools(id) },
		signal: d.signal,
		onEvent: (e) => {
			appendFileSync(join(dir, "transcript.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n", "utf8");
			if (e.type === "tool" && e.name.startsWith(`mcp__${REVIT_SERVER}__`)) appendLog(d.root, { kind: "agent.revit", by: `agent:${d.engine.id}`, data: { id, tool: e.name, detail: e.detail } });
			if (e.type === "error") failed = e.message;
			d.onEvent(e);
		},
	});
	if (failed) return { ok: false, id, reason: failed };
	if (!existsSync(join(dir, "agent-done.json"))) {
		appendLog(d.root, { kind: "revision.unfinished", by: "app", data: { id } });
		return { ok: false, id, reason: "Aģents nepabeidza partiju (nav finish_revision). Eksports netika veikts." };
	}
	try {
		return { ok: true, manifest: await captureRevision({ root: d.root, revit: d.revit, id, workPath: d.workPath }) };
	} catch (e) {
		appendLog(d.root, { kind: "revision.capture_failed", by: "app", data: { id, error: (e as Error).message } });
		return { ok: false, id, reason: (e as Error).message };
	}
}

/** Copies an approved revision out to <root>/approved/<id>/ — only when every page and the model are approved. Never overwrites. */
export async function publishApproved(root: string, id: string, rvt?: { revit: RevitCaller; workPath: string }): Promise<string> {
	if (!revisionComplete(loadReview(root, id))) throw new Error(`Revīzija ${id} nav pilnībā apstiprināta.`);
	const out = join(root, "approved", id);
	mkdirSync(out, { recursive: true });
	const man = JSON.parse(readFileSync(join(revisionDir(root, id), "manifest.json"), "utf8")) as Manifest;
	for (const f of [...man.pages.map((p) => p.file), man.model]) copyFileSync(join(revisionDir(root, id), f), join(out, f), constants.COPYFILE_EXCL);
	if (rvt) {
		await ensureActiveDocument(rvt.revit, rvt.workPath);
		await saveWork(rvt.revit);
		copyFileSync(rvt.workPath, join(out, `${basename(rvt.workPath, ".rvt").replace(/_WORK$/, "")}_${id}.rvt`), constants.COPYFILE_EXCL);
	}
	appendLog(root, { kind: "revision.published", by: "app", data: { id, out } });
	return out;
}
