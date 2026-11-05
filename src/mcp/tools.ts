// Logic of the projektesana-tools MCP server, separate from the stdio wiring so tests can call it directly.
// This is the agent's only way to read project files or write app state (spec §9).
// There is deliberately no tool that approves anything or writes to a registered source.
import { writeFileSync, mkdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { checkRead } from "../kernel/guard.js";
import { appendLog } from "../kernel/log.js";
import { loadFiles, proposeRoleFor } from "../kernel/files.js";
import { addressPin, openPins } from "../kernel/pins.js";
import { normText } from "../main/files/text.js";
import { ROLES } from "../main/files/roles.js";
import { cachedText } from "../main/gather/scan.js";
import { addApplicable } from "../main/gather/state.js";
import { addTr, loadTr, type TrIssuer, type TrStatus } from "../main/project/work.js";
import { loadBrief, markUnknown, setFact, type Source } from "../main/chat/brief.js";
import { groupOf, procedureOf, requiredContent, bimModelRequired, type Facts } from "../main/rules/engine.js";
import { loadRules } from "../main/rules/verify.js";
import { NOT_READ, PENDING_UNREAD, type Stage } from "../main/rules/types.js";
import { Library, type Category } from "../main/library/library.js";

export interface ToolCtx {
	root: string;
	engine: string;
	dataDir: string;
	revision?: string;
	/** the app's law library (user data); without it only the built-in snapshots are searched */
	libraryDir?: string;
}

/** Verbatim paragraphs from the law library and built-in likumi.lv texts, each with title, URL and read date. */
export const searchSources = (c: ToolCtx, query: string, category?: Category) =>
	logged(c, "search_sources", { query, category }, () => {
		const lib = new Library(c.libraryDir ?? join(c.root, ".bv", "no-library"), join(c.dataDir, "law-snapshots"));
		const hits = lib.search(query, { category, limit: 30 });
		return hits.length ? hits : `Nekas neatrasts: "${query}". Bibliotēkā ir: ${lib.list().map((s) => s.title).join("; ")}`;
	});

const by = (c: ToolCtx) => `agent:${c.engine}`;
const MAX_DOC = 200_000;

async function logged<T>(c: ToolCtx, tool: string, args: unknown, fn: () => Promise<T> | T): Promise<T> {
	try {
		const r = await fn();
		appendLog(c.root, { kind: "agent.tool", by: by(c), data: { tool, args, ok: true } });
		return r;
	} catch (e) {
		appendLog(c.root, { kind: "agent.tool", by: by(c), data: { tool, args, ok: false, error: (e as Error).message } });
		throw e;
	}
}

export const listFiles = (c: ToolCtx) => logged(c, "list_files", {}, () => loadFiles(c.root).map((f) => ({ path: f.path, role: f.role ?? null, status: f.status, versions: f.versions.length })));

export const readDoc = (c: ToolCtx, path: string) =>
	logged(c, "read_doc", { path }, async () => {
		const g = checkRead({ root: c.root }, path);
		if (!g.ok) throw new Error(g.reason);
		const t = await cachedText(c.root, relative(c.root, g.path));
		return t.length > MAX_DOC ? t.slice(0, MAX_DOC) + `\n[saīsināts: ${t.length} rakstzīmes kopā]` : t;
	});

export const projectBrief = (c: ToolCtx) => logged(c, "project_brief", {}, () => loadBrief(c.root));

export const rulesForStage = (c: ToolCtx, stage: Stage) =>
	logged(c, "rules_for_stage", { stage }, () => {
		const b = loadBrief(c.root);
		if (!b.engine.work || !b.engine.use) throw new Error("Brief nav pabeigts: trūkst engine.work un engine.use.");
		const f = b.engine as Facts;
		const rules = loadRules(c.dataDir);
		const cite = (ids: string[]) => ids.flatMap((id) => rules.filter((r) => r.id === id).map((r) => ({ id: r.id, source: `${r.act} ${r.article}`, url: r.url, read_on: r.read_on, quote: r.quote })));
		const g = groupOf(f);
		const p = procedureOf(f);
		return {
			group: { value: g.value, rules: cite(g.because), check: g.check },
			procedure: { value: p.value, rules: cite(p.because), check: p.check },
			content: requiredContent(rules, f, stage),
			bimModelRequired: bimModelRequired(f),
			notRead: NOT_READ,
			pendingFrom2027: PENDING_UNREAD,
		};
	});

export const listOpenPins = (c: ToolCtx) => logged(c, "list_open_pins", {}, () => openPins(c.root));

export const resolvePin = (c: ToolCtx, pinId: string, note: string) => logged(c, "resolve_pin", { pinId, note }, () => addressPin(c.root, pinId, note, by(c)));

export const addNote = (c: ToolCtx, text: string) =>
	logged(c, "add_note", { text }, () => {
		if (!text.trim()) throw new Error("Piezīme ir tukša.");
		appendLog(c.root, { kind: "agent.note", by: by(c), data: { text, revision: c.revision ?? null } });
		return "ok";
	});

/** Marks the agent's batch as done. The app then exports and shows the revision; the agent cannot approve it. */
export const finishRevision = (c: ToolCtx, summary: string) =>
	logged(c, "finish_revision", { summary }, () => {
		if (!c.revision) throw new Error("Šajā palaišanā nav revīzijas.");
		const dir = join(c.root, ".bv", "revisions", c.revision);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "agent-done.json"), JSON.stringify({ at: new Date().toISOString(), by: by(c), summary }, null, 1), "utf8");
		return "Revīzija nodota Borisam. Apstiprināt var tikai viņš.";
	});

export const setFactTool = (c: ToolCtx, id: string, value: string, source: Source) => logged(c, "set_fact", { id, value, source }, async () => ((await setFact(c.root, id, value, source, by(c))), "ok"));

/** A quote must stand in the registered file's text (or, for a role, its name). Shared by the gather tools. */
async function quoteInFile(c: ToolCtx, path: string, quote: string, orName = false) {
	const rel = path.split("\\").join("/");
	if (!loadFiles(c.root).some((f) => f.path === rel)) throw new Error(`Fails nav reģistrēts projektā: ${path}`);
	if (!quote.trim()) throw new Error("Citāts ir tukšs.");
	const q = normText(quote);
	if (orName && normText(basename(rel)).includes(q)) return;
	const g = checkRead({ root: c.root }, rel);
	if (!g.ok) throw new Error(g.reason);
	let text = "";
	try {
		text = normText(await cachedText(c.root, rel));
	} catch (e) {
		if (!orName) throw e;
	}
	if (!text.includes(q)) throw new Error(`Citāts nav atrodams failā ${path}. Citātam jābūt burtiski no faila.`);
}

/** The agent proposes a role for a file with the words that justify it. A role Boris already confirmed stays. */
export const setFileRoleTool = (c: ToolCtx, path: string, role: string, quote: string) =>
	logged(c, "set_file_role", { path, role, quote }, async () => {
		if (!(ROLES as readonly string[]).includes(role)) throw new Error(`Nezināma loma „${role}”. Lomas: ${ROLES.join("; ")}.`);
		await quoteInFile(c, path, quote, true);
		const rec = proposeRoleFor(c.root, path.split("\\").join("/"), role, quote, by(c));
		return rec.roleSource?.confirmed && rec.roleSource.by === "boris" ? "Boriss lomu jau apstiprinājis — atstāta." : "ok (priekšlikums, Boriss apstiprina)";
	});

export interface TrArgs {
	who: string;
	issuer: TrIssuer;
	status: TrStatus;
	requested_on: string | null;
	received_on: string | null;
	file: string;
	quote: string;
	note?: string;
}

/** A technical-rules request or document found in a project file. The file and the quote prove it; Boris confirms. */
export const addTrTool = (c: ToolCtx, a: TrArgs) =>
	logged(c, "add_tr", a, async () => {
		if (a.status === "nav pieprasīts") throw new Error("„nav pieprasīts” nosaka tikai Boriss.");
		await quoteInFile(c, a.file, a.quote);
		const file = a.file.split("\\").join("/");
		const dup = loadTr(c.root).find((r) => r.who.trim().toLowerCase() === a.who.trim().toLowerCase() && r.issuer === a.issuer && r.status === a.status);
		if (dup) return `Jau ir: ${dup.id}`;
		const r = addTr(
			c.root,
			{ who: a.who, issuer: a.issuer, status: a.status, requestedOn: a.requested_on, receivedOn: a.received_on, file: a.status === "saņemts" ? file : null, note: a.note ?? "", found: { by: by(c), file, quote: a.quote, confirmed: false } },
			by(c),
		);
		return `ok ${r.id}`;
	});

/** A paragraph from the law library that applies to this project, with the reason. The quote is checked against the library. */
export const citeLawTool = (c: ToolCtx, a: { category: "likums" | "mk" | "lvs" | "es"; source_id: string; quote: string; why: string }) =>
	logged(c, "cite_law", a, () => {
		const lib = new Library(c.libraryDir ?? join(c.root, ".bv", "no-library"), join(c.dataDir, "law-snapshots"));
		return `ok ${addApplicable(c.root, lib, { category: a.category, sourceId: a.source_id, quote: a.quote, why: a.why }, by(c)).id}`;
	});

export const markUnknownTool =(c: ToolCtx, id: string, borisQuote: string) => logged(c, "mark_unknown", { id, borisQuote }, async () => ((await markUnknown(c.root, id, borisQuote, by(c))), "ok"));
