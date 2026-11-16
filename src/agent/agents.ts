// Spec v2 for agents (task 13.1): validation of the settings page's specs, and the role text files that sit beside agents.json.
//   <appDir>\agents\<id>.md        the role text of an agent whose spec has roleFile: true
//   <appDir>\agents\_kopejie.md    rules every agent gets
//   <appDir>\agents\versions\      every text a write replaced; nothing here is ever deleted
// Plain text on disk, so the user can open and edit it in any editor; the app only reads it at run time.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSpec } from "../shared/agent-types.js";
import { LEAD_ID } from "../shared/thread-types.js";
import { MAIL_TOOL_LEVELS } from "./mail.js";
import { EFFORTS } from "./pi/models.js";
import { LEVEL_RANK, MAIN_TOOLS, SPECIALIST_CAP } from "./subagents.js";
import type { LevelOf } from "./tools/levels.js";

// subagents.ts re-exports validateSpec from here and this file reads its level tables: the bindings are only used inside functions, so the cycle is safe.

export const ROLE_MAX = 16_000; // characters
export const SHARED_MAX = 6_000; // characters

const ID = /^[a-z][a-z0-9-]{1,30}$/;
const SHARED_FILE = "_kopejie.md";

export const roleDir = (appDir: string): string => join(appDir, "agents");

const roleFileOf = (appDir: string, id: string): string => {
	// the id becomes a file name: only the shape validateSpec accepts, so no path can leave the folder
	if (!ID.test(id)) throw new Error("Identifikators: mazie burti, cipari un domuzīme, 2–31 zīmes (piem. dokumenti).");
	return join(roleDir(appDir), `${id}.md`);
};

const readText = (file: string): string | null => {
	try {
		return readFileSync(file, "utf8");
	} catch {
		return null;
	}
};

/** Writes `text` to `file` (the folder is made); the text it replaces is copied to agents\versions\<stem>.<timestamp>.md first. */
function writeKept(appDir: string, file: string, stem: string, text: string): void {
	const dir = roleDir(appDir);
	mkdirSync(dir, { recursive: true });
	if (existsSync(file)) {
		const vdir = join(dir, "versions");
		mkdirSync(vdir, { recursive: true });
		const stamp = new Date(Date.now()).toISOString().replace(/[:.]/g, "-");
		let kept = join(vdir, `${stem}.${stamp}.md`);
		// two writes in one millisecond must not overwrite the first copy
		for (let n = 1; existsSync(kept); n++) kept = join(vdir, `${stem}.${stamp}.${n}.md`);
		copyFileSync(file, kept);
	}
	// a temp file and a rename: a crash mid-write leaves the old text, not half of the new one
	const tmpFile = `${file}.tmp`;
	writeFileSync(tmpFile, text, "utf8");
	renameSync(tmpFile, file);
}

/** The role text of an agent, or null when it has no file. */
export function readRole(appDir: string, id: string): string | null {
	return readText(roleFileOf(appDir, id));
}

export function writeRole(appDir: string, id: string, text: string): void {
	const file = roleFileOf(appDir, id);
	if (text.length > ROLE_MAX) throw new Error(`Lomas teksts: līdz ${ROLE_MAX} zīmēm (ir ${text.length}).`);
	writeKept(appDir, file, id, text);
}

/** The rules every agent gets; "" when there is no file. */
export function readShared(appDir: string): string {
	return readText(join(roleDir(appDir), SHARED_FILE)) ?? "";
}

export function writeShared(appDir: string, text: string): void {
	if (text.length > SHARED_MAX) throw new Error(`Kopējie noteikumi: līdz ${SHARED_MAX} zīmēm (ir ${text.length}).`);
	writeKept(appDir, join(roleDir(appDir), SHARED_FILE), "_kopejie", text);
}

/** A specialist from the settings page: checked against the tools that exist and their levels.
 *  `ids`: the ids of the agents being saved; when given, `mayMessage` / `acceptsFrom` may name only those and `lead`. When omitted they are not checked.
 *  `roleExists`: when given, a spec with `roleFile` must have its file (it is how a save finds out the file is missing). */
export function validateSpec(
	raw: unknown,
	levelOf: LevelOf,
	known: readonly string[],
	ids?: readonly string[],
	roleExists?: (id: string) => boolean,
): { ok: true; spec: AgentSpec } | { ok: false; error: string } {
	const r = (raw ?? {}) as Partial<Record<keyof AgentSpec, unknown>>;
	const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
	const id = str(r.id);
	const name = str(r.name);
	const description = str(r.description);
	const prompt = str(r.prompt);
	const roleFile = r.roleFile === true;
	if (id === LEAD_ID) return { ok: false, error: `Identifikators ${LEAD_ID} ir rezervēts galvenajam aģentam.` };
	if (!ID.test(id)) return { ok: false, error: "Identifikators: mazie burti, cipari un domuzīme, 2–31 zīmes (piem. dokumenti)." };
	if (name.length < 2 || name.length > 60) return { ok: false, error: "Nosaukums: 2–60 zīmes." };
	if (description.length > 200) return { ok: false, error: "Apraksts: līdz 200 zīmēm." };
	// the role text lives in its file (up to ROLE_MAX); the prompt is then an optional addition, under the old limit
	if (prompt.length > 4000 || (prompt.length < 10 && !(roleFile && prompt.length === 0))) return { ok: false, error: "Norādījums: 10–4000 zīmes." };
	if (roleFile && roleExists && !roleExists(id)) return { ok: false, error: `Lomas fails nav atrasts: agents\\${id}.md` };
	if (r.maxLevel !== undefined && r.maxLevel !== "run" && r.maxLevel !== "confirm") return { ok: false, error: "maxLevel: tikai run vai confirm." };
	const maxLevel = r.maxLevel === "confirm" ? "confirm" : r.maxLevel === "run" ? "run" : undefined;
	if (!Array.isArray(r.tools)) return { ok: false, error: "Rīku saraksts nav derīgs." };
	const tools = [...new Set((r.tools as unknown[]).map(str).filter(Boolean))];
	const cap = maxLevel === "confirm" ? "confirm" : SPECIALIST_CAP;
	for (const t of tools) {
		if (Object.hasOwn(MAIL_TOOL_LEVELS, t)) return { ok: false, error: `${t} ir dots katram aģentam automātiski; to nevajag norādīt.` };
		if (MAIN_TOOLS.has(t)) return { ok: false, error: `Speciālists nevar palaist citus aģentus (${t}).` };
		if (!known.includes(t)) return { ok: false, error: `Nezināms rīks: ${t}.` };
		const lv = levelOf(t);
		if (lv === "never" || LEVEL_RANK[lv] > LEVEL_RANK[cap]) return { ok: false, error: `Rīks ${t} prasa lietotāja apstiprinājumu (${lv}); speciālistam to dot nevar.` };
	}

	const spec: AgentSpec = { id, name, description, prompt, tools };
	if (roleFile) spec.roleFile = true;
	if (maxLevel) spec.maxLevel = maxLevel;

	const model = str(r.model);
	if (r.model !== undefined && typeof r.model !== "string") return { ok: false, error: "Modelis: teksts." };
	if (model) spec.model = model;
	if (r.effort !== undefined && r.effort !== "" && !(EFFORTS as readonly unknown[]).includes(r.effort)) return { ok: false, error: `Domāšanas līmenis (effort): ${EFFORTS.join(", ")} vai tukšs.` };
	if (r.effort) spec.effort = r.effort as AgentSpec["effort"];

	for (const key of ["mayMessage", "acceptsFrom"] as const) {
		const v = r[key];
		if (v === undefined) continue;
		if (!Array.isArray(v)) return { ok: false, error: `${key}: saraksts ar aģentu identifikatoriem.` };
		const list = [...new Set((v as unknown[]).map(str).filter(Boolean))];
		const bad = ids ? list.find((x) => x !== LEAD_ID && !ids.includes(x)) : undefined;
		if (bad) return { ok: false, error: `${key}: nezināms aģents ${bad}.` };
		spec[key] = list;
	}

	if (r.skills !== undefined) {
		if (!Array.isArray(r.skills)) return { ok: false, error: "skills: saraksts ar prasmju nosaukumiem." };
		// stored as given; 13.6 checks the names against the library
		spec.skills = [...new Set((r.skills as unknown[]).map(str).filter(Boolean))];
	}
	return { ok: true, spec };
}
