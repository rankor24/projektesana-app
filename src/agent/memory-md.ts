// Memory as plain Markdown. Three kinds of file under <app data>\memory, each with ONE writer:
//   memory\agents\<id>.md        an agent's own notes (the agent keeps them; "lead" is the main agent)
//   memory\departments\<id>.md   a department's notes (kept by the department's lead, `Department.lead`, else BPV)
//   memory\office.md             the office's notes (kept by BPV; every write waits for the user's click: tool level confirm)
// The user may edit any file in the Atmiņa page or in any editor. The existing Atmiņa notes (core/office-memory.ts, one note per file in
// memory\*.md with a front matter) stay as they are; these files hold no front matter and are skipped by that reader.
//
// At the start of a run the files that belong to the agent (office, its department, its own) go into its standing text within a budget:
// pinned lines (headings and prose) first, then entries newest first, where each use by `memory_read` is worth a week of freshness, so a
// note the agent keeps reaching for stays. What does not fit is read on demand with `memory_read`. A department's memory wins over the
// agent's own where they disagree, and the injected text says so.
//
// Ported from OpenMausBot (Apache-2.0): docs/memory.md and the code behind it (server/memory-store.ts: atomic writes, size cap, secrets
// replaced with «redacted N chars», `expectedHash` refusing a save over a write the writer has not seen; server/memory-entries.ts: dated
// entries, `· until <date>` expiry, struck-through superseded entries; server/memory-journal.ts: every change with before/after and undo,
// here agent/self-journal.ts; server/memory-forget.ts; the budget of MEMORY.md, here a character budget). Not taken: the model-run upkeep
// (capture, organize, nightly tidy-up), recall by search, daily logs. Added: one writer per file and departments.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentSpec } from "../shared/agent-types.js";
import { DEFAULT_DEPARTMENTS, departmentOf, type Department } from "../shared/departments.js";
import type { MemoryFileInfo, MemoryFileText, MemoryKind } from "../shared/memory-types.js";
import { LEAD_ID } from "../shared/thread-types.js";
import { logChange } from "./self-journal.js";

export interface MemoryRef {
	kind: MemoryKind;
	id: string;
}

/** What one run's start carries of the memory, in characters (about 2 500 tokens at most): office, department, own. */
export const OFFICE_BUDGET = 1500;
export const DEPARTMENT_BUDGET = 3000;
export const AGENT_BUDGET = 3500;
/** A file never grows past this: older dated entries move to memory\archive first. */
export const FILE_MAX = 24_000;
/** One entry is at most this long, so a single note cannot push the rest out. */
export const ENTRY_MAX_CHARS = 1000;
export const ENTRY_MAX_LINES = 20;
/** Every use of an entry by memory_read is worth this many days of age when entries are ranked. */
export const USE_DAYS = 7;

const AGENT_ID = /^[a-z][a-z0-9-]{1,30}$/;
const DEPT_ID = /^[a-z0-9-]{1,40}$/;

export const memoryDir = (appDir: string): string => join(appDir, "memory");

/** The file of a memory; the id becomes a file name, so only the shapes the app itself makes are accepted (no path leaves the folder). */
export function memoryFile(appDir: string, ref: MemoryRef): string {
	if (ref.kind === "office") return join(memoryDir(appDir), "office.md");
	if (ref.kind === "agent") {
		if (ref.id !== LEAD_ID && !AGENT_ID.test(ref.id)) throw new Error(`Nederīgs aģenta identifikators: ${ref.id}`);
		return join(memoryDir(appDir), "agents", `${ref.id}.md`);
	}
	if (!DEPT_ID.test(ref.id)) throw new Error(`Nederīgs nodaļas identifikators: ${ref.id}`);
	return join(memoryDir(appDir), "departments", `${ref.id}.md`);
}

const readText = (f: string): string | null => {
	try {
		return readFileSync(f, "utf8");
	} catch {
		return null;
	}
};

export const hashText = (t: string): string => createHash("sha1").update(t).digest("hex").slice(0, 16);

/** The text of a memory file; "" when there is none. */
export function readMemory(appDir: string, ref: MemoryRef): string {
	return readText(memoryFile(appDir, ref)) ?? "";
}

// ---- who writes what -----------------------------------------------------------------------------------------------------------------------

function agentIds(appDir: string): string[] {
	try {
		const j = JSON.parse(readFileSync(join(appDir, "agents.json"), "utf8")) as { id?: unknown }[];
		return Array.isArray(j) ? j.map((a) => a.id).filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

/** The agents of the app as saved (the shipped three when nothing is saved, which carry no department). */
function savedSpecs(appDir: string): Pick<AgentSpec, "id" | "department">[] {
	try {
		const j = JSON.parse(readFileSync(join(appDir, "agents.json"), "utf8")) as Pick<AgentSpec, "id" | "department">[];
		return Array.isArray(j) ? j.filter((a) => typeof a?.id === "string") : [];
	} catch {
		return [];
	}
}

/** The saved spec of an agent (agents.json), or undefined: the shipped three are not in that file and have no role file. */
export function savedSpec(appDir: string, id: string): AgentSpec | undefined {
	try {
		const j = JSON.parse(readFileSync(join(appDir, "agents.json"), "utf8")) as AgentSpec[];
		return Array.isArray(j) ? j.find((a) => a?.id === id) : undefined;
	} catch {
		return undefined;
	}
}

/** The departments as saved (departments.json), or the plan's eight. `lead` is the optional department lead; absent = BPV keeps it. */
export function departmentsOf(appDir: string): (Department & { lead?: string })[] {
	try {
		const j = JSON.parse(readFileSync(join(appDir, "departments.json"), "utf8")) as { departments?: unknown };
		const list = Array.isArray(j.departments) ? (j.departments as Partial<Department & { lead?: string }>[]).filter((d) => typeof d?.id === "string" && typeof d.name === "string") : null;
		if (list) return list as (Department & { lead?: string })[];
	} catch {
		// none saved: the plan's departments
	}
	return DEFAULT_DEPARTMENTS;
}

/** BPV: the agent with the id bpv; an office without one (only the shipped three) is kept by the main agent. */
export const bpvOf = (appDir: string): string => (agentIds(appDir).includes("bpv") ? "bpv" : LEAD_ID);

/** The one agent that writes this file. */
export function keeperOf(appDir: string, ref: MemoryRef): string {
	if (ref.kind === "agent") return ref.id;
	if (ref.kind === "office") return bpvOf(appDir);
	const lead = (departmentsOf(appDir).find((d) => d.id === ref.id) as { lead?: string } | undefined)?.lead;
	return lead?.trim() || bpvOf(appDir);
}

/** The department an agent is in (its own setting, else the default of its id); undefined = in none. */
export function departmentOfAgent(appDir: string, agent: string, spec?: Pick<AgentSpec, "id" | "department"> | null): string | undefined {
	const s = spec ?? savedSpecs(appDir).find((x) => x.id === agent) ?? { id: agent };
	return departmentOf(s);
}

/** Why `who` may not write this file; null when it may. The user (through the page) is not an agent and is never refused. */
export function writeRefusal(appDir: string, ref: MemoryRef, who: string): string | null {
	const keeper = keeperOf(appDir, ref);
	if (who === keeper) return null;
	if (ref.kind === "agent") return `Šo atmiņu raksta tikai aģents ${ref.id}. Tavējo raksta ar scope own.`;
	if (ref.kind === "department") return `Nodaļas ${ref.id} atmiņu raksta tikai tās vadītājs (${keeper}). Ja kaut kas jāatceras, nosūti to viņam ar send_message.`;
	return `Biroja atmiņu raksta tikai ${keeper}. Nosūti to viņam ar send_message.`;
}

// ---- secrets ----------------------------------------------------------------------------------------------------------------------------

const SECRETS: RegExp[] = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
	/\bgh[pousr]_[A-Za-z0-9]{20,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
];
const KEYED = /\b((?:api[_-]?key|token|secret|password|passwd|parole|atslēga)\s*[:=]\s*)(\S{6,})/gi;

/** A key, a token or a password an agent "remembered" does not reach the disk: it becomes «redacted N chars». */
export function redactSecrets(text: string): string {
	let t = text;
	for (const re of SECRETS) t = t.replace(re, (m) => `«redacted ${m.length} chars»`);
	return t.replace(KEYED, (_m, k: string, v: string) => `${k}«redacted ${v.length} chars»`);
}

// ---- entries ---------------------------------------------------------------------------------------------------------------------------------

export interface Entry {
	/** the whole entry, its continuation lines included */
	text: string;
	date?: string;
	until?: string;
	struck: boolean;
	key: string;
}

export interface Parsed {
	/** the lines that are not entries (headings, prose); blank ones are not kept */
	fixed: string[];
	entries: Entry[];
}

const BULLET = /^[-*]\s/;
const DATE = /^[-*]\s+(\d{4}-\d{2}-\d{2})\b/;
const UNTIL = /·\s*until\s+(\d{4}-\d{2}-\d{2})\s*$/m;

const keyOf = (first: string): string => createHash("sha1").update(first.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex").slice(0, 8);

export function parseMemory(text: string): Parsed {
	const fixed: string[] = [];
	const entries: Entry[] = [];
	let cur: string[] | null = null;
	const close = () => {
		if (!cur) return;
		const t = cur.join("\n").replace(/\s+$/, "");
		entries.push({ text: t, date: DATE.exec(t)?.[1], until: UNTIL.exec(t)?.[1], struck: /^[-*]\s+(?:\d{4}-\d{2}-\d{2}\s*·\s*)?~~/.test(t), key: keyOf(cur[0]) });
		cur = null;
	};
	for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
		if (BULLET.test(line)) {
			close();
			cur = [line];
		} else if (cur && /^\s+\S/.test(line)) cur.push(line);
		else {
			close();
			if (line.trim()) fixed.push(line);
		}
	}
	close();
	return { fixed, entries };
}

/** Riga's calendar day: the office's, whatever the PC's zone. */
export const todayRiga = (now = Date.now()): string => new Date(now).toLocaleDateString("sv-SE", { timeZone: "Europe/Riga" });

const dayNo = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/** Entries that are live today: not struck through, not past their `until` day. */
export const liveEntries = (p: Parsed, today = todayRiga()): Entry[] => p.entries.filter((e) => !e.struck && (!e.until || e.until >= today));

// ---- usage (most-used first) ---------------------------------------------------------------------------------------------------------------

const usageFile = (appDir: string) => join(memoryDir(appDir), "usage.json");
type Usage = Record<string, Record<string, number>>;

function readUsage(appDir: string): Usage {
	try {
		const j = JSON.parse(readFileSync(usageFile(appDir), "utf8")) as Usage;
		return j && typeof j === "object" ? j : {};
	} catch {
		return {};
	}
}

function bumpUsage(appDir: string, ref: MemoryRef, keys: string[]): void {
	if (!keys.length) return;
	try {
		const u = readUsage(appDir);
		const slot = (u[`${ref.kind}/${ref.id}`] ??= {});
		for (const k of keys) slot[k] = (slot[k] ?? 0) + 1;
		mkdirSync(memoryDir(appDir), { recursive: true });
		writeFileSync(`${usageFile(appDir)}.tmp`, JSON.stringify(u), "utf8");
		renameSync(`${usageFile(appDir)}.tmp`, usageFile(appDir));
	} catch {
		// a use that is not counted only changes which entry goes first
	}
}

// ---- the text a run starts with --------------------------------------------------------------------------------------------------------------

export interface Selection {
	text: string;
	/** live entries that did not fit */
	hidden: number;
	/** characters the file has */
	chars: number;
}

/** What of one file fits `budget` characters: pinned lines, then entries by freshness and use, shown in the file's own order. */
export function select(appDir: string, ref: MemoryRef, budget: number, now = Date.now()): Selection {
	const raw = readMemory(appDir, ref);
	if (!raw.trim()) return { text: "", hidden: 0, chars: 0 };
	const p = parseMemory(raw);
	const today = todayRiga(now);
	const used = readUsage(appDir)[`${ref.kind}/${ref.id}`] ?? {};
	let left = budget;
	const fixed: string[] = [];
	for (const l of p.fixed) {
		// pinned lines may use at most half of the budget, so a long preface cannot push every entry out
		if (l.length + 1 > left || budget - left + l.length + 1 > budget / 2) continue;
		fixed.push(l);
		left -= l.length + 1;
	}
	const score = (e: Entry) => (used[e.key] ?? 0) * USE_DAYS - (e.date ? Math.max(0, dayNo(today) - dayNo(e.date)) : 0);
	const live = liveEntries(p, today);
	const order = live.map((e, i) => ({ e, i, s: score(e) })).sort((a, b) => b.s - a.s || b.i - a.i);
	const chosen = new Set<number>();
	for (const { e, i } of order) {
		if (e.text.length + 1 > left) continue;
		chosen.add(i);
		left -= e.text.length + 1;
	}
	const shown = live.filter((_, i) => chosen.has(i)).map((e) => e.text);
	return { text: [...fixed, ...shown].join("\n"), hidden: live.length - shown.length, chars: raw.length };
}

const STANDING =
	"Atmiņa: memory_read un memory_write (tava, nodaļas un biroja Markdown faili; nodaļas un biroja atmiņu raksta tikai to vadītājs, citiem nosūti ar send_message). Raksti tikai to, kas der nākamajām reizēm. Ierakstus, kas nav parādīti, atrod arī search_project ar kind memory. " +
	"Kļūda pašā lietotnē (trūkst rīka, nepareizs nolasījums, avārija) nav projekta piezīme: ziņo to ar report_app_issue.";

/** The memory block of an agent's standing text: its pointer line always, and the files that exist within their budgets. `spec` null = the main agent. */
export function memoryText(spec: Pick<AgentSpec, "id" | "department"> | null, appDir: string, now = Date.now()): string {
	const me = spec?.id ?? LEAD_ID;
	const dept = spec ? departmentOf(spec) : undefined;
	const deptName = dept ? (departmentsOf(appDir).find((d) => d.id === dept)?.name ?? dept) : "";
	const parts: string[] = [];
	const office = select(appDir, { kind: "office", id: "office" }, OFFICE_BUDGET, now);
	const dep = dept ? select(appDir, { kind: "department", id: dept }, DEPARTMENT_BUDGET, now) : null;
	const own = select(appDir, { kind: "agent", id: me }, AGENT_BUDGET, now);
	const more = (s: Selection) => (s.hidden ? `\n(vēl ${s.hidden} ieraksti nav parādīti: memory_read ar find)` : "");
	if (office.text) parts.push(`### Biroja atmiņa (office)\n${office.text}${more(office)}`);
	if (dep?.text) parts.push(`### Nodaļas atmiņa: ${deptName}\n${dep.text}${more(dep)}`);
	if (own.text) parts.push(`### Tava atmiņa\n${own.text}${more(own)}`);
	if (!parts.length) return STANDING;
	// the rule a reader needs when two of them disagree
	const rule = dep?.text && own.text ? "\nJa nodaļas atmiņa un tava atmiņa pretrunā, uzvar nodaļas atmiņa." : "";
	return `${STANDING}${rule}\n\n${parts.join("\n\n")}`;
}

// ---- writing -----------------------------------------------------------------------------------------------------------------------------------

export interface WriteOpts {
	by: "agent" | "user";
	/** the agent that writes (for `by` agent), checked against the file's keeper */
	agent?: string;
	reason?: string;
	/** the hash the writer saw; a save over another text is refused */
	expectedHash?: string;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

function archive(appDir: string, ref: MemoryRef, text: string): void {
	const f = join(memoryDir(appDir), "archive", `${ref.kind}-${ref.id}.md`);
	mkdirSync(dirname(f), { recursive: true });
	const old = readText(f) ?? "";
	writeFileSync(f, `${old}${old && !old.endsWith("\n") ? "\n" : ""}${text}\n`, "utf8");
}

/** The oldest dated entries move to memory\archive until the text fits FILE_MAX; undated lines never move. The archive is written first. */
function fit(appDir: string, ref: MemoryRef, text: string): string {
	if (text.length <= FILE_MAX) return text;
	const p = parseMemory(text);
	const dated = p.entries.filter((e) => e.date).sort((a, b) => (a.date! < b.date! ? -1 : 1));
	let out = text;
	const moved: string[] = [];
	for (const e of dated) {
		if (out.length <= FILE_MAX) break;
		out = out.replace(e.text, "").replace(/\n{3,}/g, "\n\n");
		moved.push(`${e.text} · moved ${todayRiga()}`);
	}
	if (out.length > FILE_MAX) throw new Error(`Atmiņas fails ir pārāk garš (${out.length} zīmes; ${FILE_MAX} ir robeža) un vecāku ierakstu ar datumu nav, ko pārvietot. Saīsini to.`);
	if (moved.length) archive(appDir, ref, moved.join("\n"));
	return out;
}

/** Replaces a file's text. Previous text is kept in memory\versions and in the journal. Returns the new hash and the journal line's id (none when nothing changed). */
export function writeMemory(appDir: string, ref: MemoryRef, text: string, o: WriteOpts): { hash: string; change?: string } {
	const f = memoryFile(appDir, ref);
	if (o.by === "agent") {
		const why = writeRefusal(appDir, ref, o.agent ?? "");
		if (why) throw new Error(why);
	}
	const before = readText(f);
	if (o.expectedHash !== undefined && o.expectedHash !== hashText(before ?? "")) throw new Error("Šis fails mainījies, kamēr to rediģēji: ielādē to no jauna un saglabā vēlreiz.");
	const after = fit(appDir, ref, redactSecrets(text).replace(/\r\n/g, "\n"));
	if (after === (before ?? "")) return { hash: hashText(after) };
	mkdirSync(dirname(f), { recursive: true });
	if (before !== null) {
		const v = join(memoryDir(appDir), "versions");
		mkdirSync(v, { recursive: true });
		let kept = join(v, `${ref.kind}-${ref.id}.${stamp()}.md`);
		for (let n = 1; existsSync(kept); n++) kept = join(v, `${ref.kind}-${ref.id}.${stamp()}.${n}.md`);
		copyFileSync(f, kept);
	}
	// a temp file and a rename: a crash mid-write leaves the old text, not half of the new one
	writeFileSync(`${f}.tmp`, after, "utf8");
	renameSync(`${f}.tmp`, f);
	let change: string | undefined;
	try {
		change = logChange(appDir, { by: o.by, agent: o.agent ?? "", kind: "memory", target: relTarget(ref), reason: o.reason ?? "", before, after }).id;
	} catch {
		// the journal must never fail the write it records
	}
	return { hash: hashText(after), ...(change ? { change } : {}) };
}

export const relTarget = (ref: MemoryRef): string => (ref.kind === "office" ? "memory/office.md" : `memory/${ref.kind === "agent" ? "agents" : "departments"}/${ref.id}.md`);

/** The entry line an agent's text becomes: "- 2026-11-23 · text", optionally "· until 2026-12-31". */
export function entryLine(text: string, until?: string, now = Date.now()): string {
	const t = text.replace(/\r\n/g, "\n").trim();
	if (t.length < 3) throw new Error("Ieraksts ir pārāk īss.");
	if (t.length > ENTRY_MAX_CHARS || t.split("\n").length > ENTRY_MAX_LINES) throw new Error(`Viens ieraksts: līdz ${ENTRY_MAX_CHARS} zīmēm un ${ENTRY_MAX_LINES} rindām. Sadali to vai ieliec garāku tekstu citā failā.`);
	if (until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("until: datums GGGG-MM-DD.");
	const lines = t.split("\n").map((l, i) => (i === 0 ? l : `  ${l.trimStart()}`));
	return `- ${todayRiga(now)} · ${lines.join("\n")}${until ? ` · until ${until}` : ""}`;
}

/** Adds one dated entry at the end. */
export function addEntry(appDir: string, ref: MemoryRef, text: string, o: WriteOpts & { until?: string }): { hash: string; change?: string } {
	const cur = readMemory(appDir, ref);
	const next = `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}${entryLine(text, o.until)}\n`;
	return writeMemory(appDir, ref, next, o);
}

/** Strikes through the one entry that contains `find` ("superseded"); nothing is deleted. */
export function forgetEntry(appDir: string, ref: MemoryRef, find: string, o: WriteOpts): { hash: string; change?: string; struck: string } {
	const cur = readMemory(appDir, ref);
	const needle = find.trim().toLowerCase();
	if (needle.length < 3) throw new Error("find: vismaz 3 zīmes.");
	const hits = parseMemory(cur).entries.filter((e) => !e.struck && e.text.toLowerCase().includes(needle));
	if (hits.length === 0) throw new Error(`Ieraksta ar «${find}» nav.`);
	if (hits.length > 1) throw new Error(`«${find}» atbilst ${hits.length} ierakstiem: precizē, kuru.`);
	const e = hits[0];
	const first = e.text.split("\n")[0];
	const m = /^([-*]\s+)(\d{4}-\d{2}-\d{2}\s*·\s*)?(.*)$/.exec(first)!;
	const struck = `${m[1]}${m[2] ?? ""}~~${m[3].replace(/\s*·\s*until\s+\d{4}-\d{2}-\d{2}\s*$/, "")}~~ · superseded ${todayRiga()}`;
	const next = cur.replace(first, struck);
	return { ...writeMemory(appDir, ref, next, o), struck: e.text.slice(0, 120) };
}

/** The live entries that contain every word of `find`; their uses are counted (the ones that are read most stay in the next run's text). */
export function findEntries(appDir: string, ref: MemoryRef, find: string): string[] {
	const words = find.toLowerCase().split(/\s+/).filter(Boolean);
	const p = parseMemory(readMemory(appDir, ref));
	const hits = liveEntries(p).filter((e) => words.every((w) => e.text.toLowerCase().includes(w)));
	bumpUsage(appDir, ref, hits.map((e) => e.key));
	return hits.map((e) => e.text);
}

// ---- for the Atmiņa page ------------------------------------------------------------------------------------------------------------------

const budgetOf = (ref: MemoryRef) => (ref.kind === "office" ? OFFICE_BUDGET : ref.kind === "department" ? DEPARTMENT_BUDGET : AGENT_BUDGET);

/** Every memory file the page shows: each agent (and the main one), each department, the office, whether or not the file exists yet. */
export function listMemoryFiles(appDir: string, agents: readonly { id: string; name: string }[]): MemoryFileInfo[] {
	const refs: { ref: MemoryRef; label: string }[] = [
		{ ref: { kind: "office", id: "office" }, label: "Birojs" },
		...departmentsOf(appDir).map((d) => ({ ref: { kind: "department" as const, id: d.id }, label: d.name })),
		{ ref: { kind: "agent", id: LEAD_ID }, label: "Galvenais aģents" },
		...agents.filter((a) => a.id !== LEAD_ID).map((a) => ({ ref: { kind: "agent" as const, id: a.id }, label: a.name })),
	];
	// a department file or agent file the user or an agent made for an id no longer in the lists still shows
	for (const [kind, sub] of [["department", "departments"], ["agent", "agents"]] as const) {
		const dir = join(memoryDir(appDir), sub);
		if (!existsSync(dir)) continue;
		for (const n of readdirSync(dir)) {
			const id = n.replace(/\.md$/, "");
			if (n.endsWith(".md") && !refs.some((r) => r.ref.kind === kind && r.ref.id === id)) refs.push({ ref: { kind, id }, label: id });
		}
	}
	return refs.map(({ ref, label }) => {
		const text = readText(memoryFile(appDir, ref));
		const sel = select(appDir, ref, budgetOf(ref));
		return { kind: ref.kind, id: ref.id, label, keeper: keeperOf(appDir, ref), exists: text !== null, bytes: Buffer.byteLength(text ?? "", "utf8"), lines: text ? text.split("\n").filter((l) => l.trim()).length : 0, loaded: sel.text.length, chars: sel.chars };
	});
}

export function readMemoryFile(appDir: string, ref: MemoryRef): MemoryFileText {
	const text = readMemory(appDir, ref);
	return { kind: ref.kind, id: ref.id, text, hash: hashText(text), keeper: keeperOf(appDir, ref) };
}
