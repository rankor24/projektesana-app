// Spec v2 for agents (task 13.1): validation of the settings page's specs, and the role text files that sit beside agents.json.
//   <appDir>\agents\<id>.md        the role text of an agent whose spec has roleFile: true
//   <appDir>\agents\_kopejie.md    rules every agent gets
//   <appDir>\agents\versions\      every text a write replaced; nothing here is ever deleted
// Plain text on disk, so the user can open and edit it in any editor; the app only reads it at run time.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OfficeMemory } from "../core/office-memory.js";
import { LEAD_FIXED_MAX, ROLE_MAX, SHARED_MAX, SPECIALIST_FIXED_MAX, type AgentSpec } from "../shared/agent-types.js";
import { LEAD_ID } from "../shared/thread-types.js";
import { estimateTextTokens } from "./context.js";
import { LEADER, PROCESS_OWN_TOOLS, STAGES, stageCard } from "../core/process-def.js";
import { STATUS_MAX } from "../core/process.js";
import { MAIL_RULES, MAIL_TOOL_LEVELS } from "./mail.js";
import { EFFORTS } from "./pi/models.js";
import { isKnownProvider } from "./failover/plan.js";
import { SYSTEM_PROMPT, userLine } from "./prompt.js";
import { LEAD_SKILL_DESC_MAX, skillsFor, skillsText, type SkillInfo } from "./skills.js";
import { LEAD_ROSTER_DESC_MAX, LEVEL_RANK, MAIN_TOOLS, RULES, SPECIALIST_CAP, rosterText } from "./subagents.js";
import type { LevelOf } from "./tools/levels.js";
import { REVIT_RULES } from "./tools/revit.js";
import { APP_MAP } from "./app-map.js";
import { REVIT_LEVELS } from "./tools/revit-levels.js";

// subagents.ts re-exports validateSpec from here and this file reads its level tables: the bindings are only used inside functions, so the cycle is safe.

export { LEAD_FIXED_MAX, ROLE_MAX, SHARED_MAX, SPECIALIST_FIXED_MAX };

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
		if (PROCESS_OWN_TOOLS.has(t)) return { ok: false, error: `${t} tiek dots aģentam bpv/eks automātiski; to nevajag norādīt.` };
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

	// the provider this agent runs on, and the backup it carries on with when that is at its limit or signed out (Phase A); both are looked up when a run starts, not on save
	if (r.provider !== undefined && typeof r.provider !== "string") return { ok: false, error: "Pakalpojums: teksts." };
	const provider = str(r.provider);
	if (provider) {
		if (!isKnownProvider(provider)) return { ok: false, error: `Nezināms pakalpojums: ${provider}.` };
		spec.provider = provider;
	}
	if (r.backup !== undefined && r.backup !== null) {
		const b = r.backup as { provider?: unknown; model?: unknown };
		if (typeof b !== "object" || typeof b.provider !== "string" || (b.model !== undefined && typeof b.model !== "string")) return { ok: false, error: "Rezerves AI: pakalpojums un modelis." };
		const bp = b.provider.trim();
		if (bp) {
			if (!isKnownProvider(bp)) return { ok: false, error: `Rezerves AI: nezināms pakalpojums ${bp}.` };
			spec.backup = { provider: bp, model: (b.model as string | undefined)?.trim() ?? "" };
		}
	}

	for (const key of ["mayMessage", "acceptsFrom"] as const) {
		const v = r[key];
		if (v === undefined) continue;
		if (!Array.isArray(v)) return { ok: false, error: `${key}: saraksts ar aģentu identifikatoriem.` };
		const list = [...new Set((v as unknown[]).map(str).filter(Boolean))];
		// `[]` means nobody; a list of blanks is a form left half filled, not that choice
		if (v.length > 0 && list.length === 0) return { ok: false, error: `Saraksts ${key} ir tukšs; atstāj to neiestatītu, ja drīkst visi, vai ieraksti ids.` };
		const bad = ids ? list.find((x) => x !== LEAD_ID && !ids.includes(x)) : undefined;
		if (bad) return { ok: false, error: `${key}: nezināms aģents ${bad}.` };
		spec[key] = list;
	}

	if (r.skills !== undefined) {
		if (!Array.isArray(r.skills)) return { ok: false, error: "skills: saraksts ar prasmju nosaukumiem." };
		// stored as given: a name the library lacks (yet), or a draft, is simply not listed to the agent (skillsFor), so assigning ahead is allowed
		spec.skills = [...new Set((r.skills as unknown[]).map(str).filter(Boolean))];
	}
	return { ok: true, spec };
}

// ---- knowledge (13.4) ----

/** The most characters of an agent's office knowledge a run carries. */
export const KNOWLEDGE_MAX = 4000;
/** What one Revit tool's declaration is counted at in a save (R47): the declarations come from the Revit MCP at run time, so the settings page cannot read them. */
export const REVIT_DECLARATION_TOKENS = 150;

/** What the office has written down for one agent: its accepted `learning` notes, newest first, each as "### title" and the body, cut at whole notes
 *  under `maxChars`. A proposal is not knowledge until the user accepts it, and a note without `agent` (written before 13.4, or by the user) belongs
 *  to no agent; it stays in the shared office memory the agents read with read_notes. */
export function knowledgeFor(mem: OfficeMemory, agent: string, maxChars = KNOWLEDGE_MAX): string {
	const blocks: string[] = [];
	let used = 0;
	for (const n of mem.list({ type: "learning", standing: true, agent })) {
		const block = `### ${n.title}\n${n.body}`;
		const cost = block.length + (blocks.length ? 2 : 0); // the blank line between notes
		// newest first: the first note that does not fit ends the text, so an older short note never jumps the queue
		if (used + cost > maxChars) break;
		blocks.push(block);
		used += cost;
	}
	return blocks.join("\n\n");
}

// ---- standing text -------------------------------------------------------------------------------------------------------------

export interface StandingDeps {
	appDir: string;
	userName: string;
	/** the specialists as they are now: the roster is made from them */
	specs: readonly AgentSpec[];
	/** the library as it is now (synced and the office's, `listSkills`); a specialist lists only the ready ones it names, the lead the synced ones */
	skills: SkillInfo[];
	/** 13.4: what the office has written down for this agent; "" until then */
	knowledge: string;
	/** 14.x: the card of the stage this agent works in, and the project's status line */
	processCard?: string;
	status?: string;
	/** the Revit tools this run really has (connected); absent = every Revit tool counts, which is the worst case for a measurement */
	revitTools?: ReadonlySet<string>;
	/** a role text or the shared rules that are not saved yet: a measurement of what a save would do (R47). Without them the files are read. */
	roleText?: { id: string; text: string };
	sharedText?: string;
	/** a `delegate` lane of a specialist (13.3 review): it has no mail tools and nobody to write to, and `delegate` adds the common rules itself,
	 *  so the text leaves out the rules, the mail lines and the roster */
	lane?: boolean;
}

/** Whom an agent may write to, one line each. The lead's is the specialists' list as before (it delegates to them); a specialist's holds the agents
 *  its `mayMessage` allows (absent = everyone), never itself, and `lead`. "" when it may write to nobody. */
export function rosterFor(spec: AgentSpec | null, specs: readonly AgentSpec[]): string {
	if (!spec) return rosterText(specs, LEAD_ROSTER_DESC_MAX);
	const may = (id: string) => !spec.mayMessage || spec.mayMessage.includes(id);
	const lines = [...specs.filter((s) => s.id !== spec.id && may(s.id)).map((s) => `- ${s.id}: ${s.description || s.name}`), ...(may(LEAD_ID) ? [`- ${LEAD_ID}: galvenais aģents`] : [])];
	return lines.length ? `Aģenti, kuriem vari rakstīt ar send_message (id: apraksts):\n${lines.join("\n")}` : "";
}

/** What every request of this agent starts with. The lead (`spec` null): SYSTEM_PROMPT, mail lines, user line, Revit rules, roster, the skills list.
 *  A specialist: the shared rules, its role file (or prompt), RULES, the mail lines, the user line, Revit rules only with a Revit tool, its roster,
 *  its own skills (those it names that are ready, synced or the office's), then knowledge, the process card and the status. A `lane` text has no RULES, mail lines or roster. */
export function standingFor(spec: AgentSpec | null, d: StandingDeps): string {
	// the lead's process text is empty unless it is in the profile (the caller decides), so a co-work text stays byte for byte what it was
	if (!spec) return [SYSTEM_PROMPT, APP_MAP, MAIL_RULES, userLine(d.userName), REVIT_RULES, rosterFor(null, d.specs), skillsText(d.skills.filter((s) => s.origin === "synced"), LEAD_SKILL_DESC_MAX), d.processCard ?? "", d.status ?? ""].filter(Boolean).join("\n\n");
	const role = spec.roleFile ? ((d.roleText?.id === spec.id ? d.roleText.text : readRole(d.appDir, spec.id)) ?? "").trim() : "";
	const own = role ? [role, spec.prompt].filter(Boolean).join("\n\n") : spec.prompt;
	const hasRevit = spec.tools.some((n) => (d.revitTools ? d.revitTools.has(n) : Object.hasOwn(REVIT_LEVELS, n)));
	const skills = skillsFor(spec, d.skills);
	const talk = !d.lane;
	return [(d.sharedText ?? readShared(d.appDir)).trim(), own, talk ? RULES.trim() : "", APP_MAP, talk ? MAIL_RULES : "", userLine(d.userName), hasRevit ? REVIT_RULES : "", talk ? rosterFor(spec, d.specs) : "", skills.length ? skillsText(skills) : "", d.knowledge, d.processCard ?? "", d.status ?? ""].filter(Boolean).join("\n\n");
}

/** What a run adds to an agent's standing text later, at its largest: the office knowledge (KNOWLEDGE_MAX characters) and, in process mode, a status of STATUS_MAX characters
 *  and, for a stage leader, the longest card of the stages it leads. The save limit (SPECIALIST_FIXED_MAX) is measured with it, so an agent that fits today cannot run over
 *  the limit once the office has taught it or a process fills its status. */
export function processReserve(spec: AgentSpec): Pick<StandingDeps, "processCard" | "status" | "knowledge"> {
	const cards = STAGES.filter((st) => LEADER[st] === spec.id).map(stageCard);
	const longest = cards.reduce((a, b) => (b.length > a.length ? b : a), "");
	return { knowledge: "x".repeat(KNOWLEDGE_MAX), status: "x".repeat(STATUS_MAX), ...(longest ? { processCard: longest } : {}) };
}

/** The declarations of the Revit tools a spec names, which `declarationTokens` does not count (they come from the Revit MCP when it is connected): REVIT_DECLARATION_TOKENS each. */
export function revitReserve(spec: AgentSpec): number {
	return spec.tools.filter((n) => Object.hasOwn(REVIT_LEVELS, n)).length * REVIT_DECLARATION_TOKENS;
}

/** The standing text plus the tool declarations (`toolDeclarations`, from declarations.ts): what the agent's request weighs before anyone speaks. */
export function fixedTokens(spec: AgentSpec | null, d: StandingDeps, toolDeclarations: number): number {
	return estimateTextTokens(standingFor(spec, d)) + toolDeclarations;
}
