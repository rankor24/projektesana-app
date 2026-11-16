// Skills (task 6.3): the Revit skills synced into resources/skills at build time (scripts/sync-skills.mjs, the Konkursu
// App pattern). The agent gets the list with each skill's description in its system text, and reads a SKILL.md or one of
// the skill's files with read_skill when the task matches. Paths are kept inside the skill's own folder.
// 13.6: the office's own skills sit beside them in <appDir>\skills (flat: one folder per skill, the role group of each in skills.json beside them).
// A skill of the office is `ready` only without a {{AIZPILDĪT: …}} placeholder and once the user marked it tested; until then it is a draft that no
// agent is told about and read_skill refuses. The synced Revit skills are always ready.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { AgentSpec } from "../shared/agent-types.js";
import type { SkillInfo } from "../shared/skill-types.js";

export type { SkillInfo };

export const PLACEHOLDER = /\{\{AIZPILDĪT[^}]*\}\}/g;
const NAME = /^[a-z0-9-]+$/;
const META = "skills.json";
const VERSIONS = "versions";

export const officeSkillsDir = (appDir: string): string => join(appDir, "skills");

/** name and description from the SKILL.md front matter. */
export function frontMatter(text: string): { name?: string; description?: string } {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	if (!m) return {};
	const get = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1])?.[1]?.trim().replace(/^["']|["']$/g, "");
	return { name: get("name"), description: get("description") };
}

const listFiles = (dir: string, root = dir, depth = 0): string[] => {
	if (depth > 4) return [];
	const out: string[] = [];
	for (const n of readdirSync(dir)) {
		const p = join(dir, n);
		if (statSync(p).isDirectory()) out.push(...listFiles(p, root, depth + 1));
		else if (/\.(md|txt|cs|json|py|js|ps1)$/i.test(n)) out.push(relative(root, p).replace(/\\/g, "/"));
	}
	return out;
};

const countPlaceholders = (dir: string): number => {
	let n = 0;
	for (const f of listFiles(dir)) if (f.toLowerCase().endsWith(".md")) n += readFileSync(join(dir, f), "utf8").match(PLACEHOLDER)?.length ?? 0;
	return n;
};

interface Meta {
	groups: Record<string, string>;
	tested: string[];
}

/** skills.json; a missing or damaged file is an empty one (no groups, nothing tested), so a bad edit can only make skills drafts, never ready. */
function readMeta(officeDir: string): Meta {
	try {
		const j = JSON.parse(readFileSync(join(officeDir, META), "utf8")) as Partial<Meta>;
		const groups = j.groups && typeof j.groups === "object" ? Object.fromEntries(Object.entries(j.groups).filter(([, v]) => typeof v === "string")) : {};
		return { groups, tested: Array.isArray(j.tested) ? j.tested.filter((x): x is string => typeof x === "string") : [] };
	} catch {
		return { groups: {}, tested: [] };
	}
}

function writeMeta(officeDir: string, m: Meta): void {
	mkdirSync(officeDir, { recursive: true });
	// a temp file and a rename: a crash mid-write leaves the old file
	const tmpFile = join(officeDir, `${META}.tmp`);
	writeFileSync(tmpFile, JSON.stringify(m, null, 2), "utf8");
	renameSync(tmpFile, join(officeDir, META));
}

/** The office's skills as the folder holds them now: SKILL.md is read on every call, so an edit outside the app shows at the next list. */
function officeSkills(officeDir: string): SkillInfo[] {
	if (!existsSync(officeDir)) return [];
	const meta = readMeta(officeDir);
	const dropped = new Set<string>();
	const out = readdirSync(officeDir)
		.filter((n) => NAME.test(n) && n !== VERSIONS && existsSync(join(officeDir, n, "SKILL.md")))
		.map((n) => {
			const dir = join(officeDir, n);
			const placeholders = countPlaceholders(dir);
			// a tested skill that holds a placeholder again was edited after the check: the mark is dropped, the user tests it again
			const tested = meta.tested.includes(n) && placeholders === 0;
			if (meta.tested.includes(n) && !tested) dropped.add(n);
			const info: SkillInfo = {
				name: n,
				description: frontMatter(readFileSync(join(dir, "SKILL.md"), "utf8")).description ?? "",
				files: listFiles(dir),
				origin: "office",
				placeholders,
				tested,
				state: tested ? "ready" : "draft",
			};
			if (meta.groups[n]) info.group = meta.groups[n];
			return info;
		});
	if (dropped.size) {
		try {
			writeMeta(officeDir, { ...meta, tested: meta.tested.filter((x) => !dropped.has(x)) });
		} catch {
			// a read-only folder: the list is right anyway, the mark is dropped again at the next list
		}
	}
	return out;
}

/** The synced skills first (always ready), then the office's. A name both have is the synced one: import refuses it, and a folder that predates a
 *  newer synced skill must not shadow it. */
export function listSkills(syncedDir: string, officeDir?: string): SkillInfo[] {
	const synced: SkillInfo[] = !syncedDir || !existsSync(syncedDir)
		? []
		: readdirSync(syncedDir)
				.filter((n) => existsSync(join(syncedDir, n, "SKILL.md")))
				.map((n) => {
					const fm = frontMatter(readFileSync(join(syncedDir, n, "SKILL.md"), "utf8"));
					return { name: n, description: fm.description ?? "", files: listFiles(join(syncedDir, n)), origin: "synced" as const, placeholders: 0, tested: true, state: "ready" as const };
				});
	if (!officeDir) return synced;
	const taken = new Set(synced.map((s) => s.name));
	return [...synced, ...officeSkills(officeDir).filter((s) => !taken.has(s.name))];
}

/** The skills an agent is told about: those its spec names that are ready. A draft, an unassigned skill and a name the library lacks are left out. */
export function skillsFor(spec: AgentSpec | null, all: readonly SkillInfo[]): SkillInfo[] {
	const own = spec?.skills;
	return own ? all.filter((s) => s.state === "ready" && own.includes(s.name)) : [];
}

export const draftRefusal = (name: string, placeholders: number): string => `Prasme ${name} nav gatava (vietturi: ${placeholders}). Jautā lietotājam.`;

/** Every .md under `from` copied to `to`, folders kept; nothing else (an office skill is text). */
function copyMd(from: string, to: string, depth = 0): void {
	if (depth > 4) return;
	for (const e of readdirSync(from, { withFileTypes: true })) {
		if (e.isDirectory()) copyMd(join(from, e.name), join(to, e.name), depth + 1);
		else if (e.isFile() && /\.md$/i.test(e.name)) {
			mkdirSync(to, { recursive: true });
			copyFileSync(join(from, e.name), join(to, e.name));
		}
	}
}

/** <…>/<name>/SKILL.md up to 3 levels under `src`; a folder that holds a SKILL.md is a skill and is not searched further. */
function findSkillDirs(src: string, depth = 1): string[] {
	const out: string[] = [];
	for (const e of readdirSync(src, { withFileTypes: true })) {
		if (!e.isDirectory()) continue;
		const p = join(src, e.name);
		if (existsSync(join(p, "SKILL.md"))) out.push(p);
		else if (depth < 3) out.push(...findSkillDirs(p, depth + 1));
	}
	return out;
}

/** Windows device names: a folder of that name cannot be made reliably, so such a skill name is refused up front. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** Moves the old folder of a skill to <officeDir>\versions\<name>.<timestamp>; never deletes it. */
function keepOld(officeDir: string, name: string, target: string): string {
	mkdirSync(join(officeDir, VERSIONS), { recursive: true });
	const stamp = new Date(Date.now()).toISOString().replace(/[:.]/g, "-");
	let kept = join(officeDir, VERSIONS, `${name}.${stamp}`);
	// two imports in one millisecond must not meet in the same folder
	for (let n = 1; existsSync(kept); n++) kept = join(officeDir, VERSIONS, `${name}.${stamp}.${n}`);
	renameSync(target, kept);
	return kept;
}

/** Copies every <group>/<name>/SKILL.md tree under `src` to <officeDir>\<name>, the group kept in skills.json. A name that exists is replaced and the old
 *  folder moved to <officeDir>\versions\<name>.<timestamp> (never deleted). `syncedDir`: a name equal to a synced skill is refused.
 *  Each skill stands alone: one that fails (a locked folder, a long path) is refused with the reason and the rest go on. The new text has not been tested,
 *  so skills.json (the group, no tested mark) is written BEFORE the folder is swapped: whatever fails after that can leave an old text, never an untested
 *  one marked tested. A staging folder a failure leaves behind is named in the reason and never deleted. */
export function importSkills(src: string, officeDir: string, syncedDir?: string): { imported: string[]; refused: { name: string; why: string }[] } {
	if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`Mape nav atrasta: ${src}`);
	const syncedNames = new Set(listSkills(syncedDir ?? "").map((s) => s.name));
	const imported: string[] = [];
	const refused: { name: string; why: string }[] = [];
	for (const dir of findSkillDirs(src)) {
		let name: string | undefined;
		let staging = "";
		try {
			name = frontMatter(readFileSync(join(dir, "SKILL.md"), "utf8")).name;
			if (!name) refused.push({ name: basename(dir), why: "SKILL.md sākumā nav front matter ar name." });
			else if (!NAME.test(name) || name === VERSIONS) refused.push({ name, why: `Nederīgs prasmes nosaukums: ${name} (mazie burti, cipari, domuzīme).` });
			else if (RESERVED.test(name)) refused.push({ name, why: `Nosaukums ${name} ir Windows rezervēts vārds; pārsauc prasmi.` });
			else if (syncedNames.has(name)) refused.push({ name, why: `Prasme ${name} jau ir starp Revit prasmēm.` });
			else if (imported.includes(name)) refused.push({ name, why: `Nosaukums ${name} šajā mapē atkārtojas.` });
			else {
				mkdirSync(officeDir, { recursive: true });
				const target = join(officeDir, name);
				// the new copy is made first beside the old one, so a failed copy leaves the old skill where it was
				staging = join(officeDir, `.import-${name}`);
				// a folder left by an import that died midway is not reused
				for (let n = 1; existsSync(staging); n++) staging = join(officeDir, `.import-${name}.${n}`);
				copyMd(dir, staging);
				const meta = readMeta(officeDir);
				meta.groups[name] = basename(dirname(dir));
				meta.tested = meta.tested.filter((x) => x !== name);
				writeMeta(officeDir, meta);
				const kept = existsSync(target) ? keepOld(officeDir, name, target) : null;
				try {
					renameSync(staging, target);
				} catch (e) {
					// the old text goes back where it was; if that fails too, the refusal names the kept copy so the user can put it back
					if (kept) {
						try {
							renameSync(kept, target);
						} catch {
							throw new Error(`${e instanceof Error ? e.message : String(e)}. Vecā versija palikusi: ${kept}`);
						}
					}
					throw e;
				}
				imported.push(name);
			}
		} catch (e) {
			const left = staging && existsSync(staging) ? ` Palikusi pagaidu mape: ${staging} (dzēs pats).` : "";
			refused.push({ name: name ?? basename(dir), why: `Neizdevās importēt: ${e instanceof Error ? e.message : String(e)}.${left}` });
		}
	}
	return { imported, refused };
}

/** The user's mark that a skill's test example was checked. Refused while the skill has placeholders; unmarking is always allowed. */
export function markTested(officeDir: string, name: string, tested: boolean): SkillInfo {
	const info = officeSkills(officeDir).find((s) => s.name === name);
	if (!info) throw new Error(`Prasme ${name} nav atrasta biroja bibliotēkā.`);
	if (tested && info.placeholders > 0) throw new Error(`Prasmei ${name} vēl ir ${info.placeholders} vietturi.`);
	const meta = readMeta(officeDir);
	meta.tested = [...meta.tested.filter((x) => x !== name), ...(tested ? [name] : [])];
	writeMeta(officeDir, meta);
	return officeSkills(officeDir).find((s) => s.name === name)!;
}

const MAX = 80_000;

export function readSkill(skillsDir: string, name: string, path = "SKILL.md"): string {
	if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Nederīgs prasmes nosaukums: ${name}`);
	const base = resolve(skillsDir, name);
	const file = resolve(base, path);
	if (!file.startsWith(base + sep) && file !== base) throw new Error("Ceļš ārpus prasmes mapes.");
	if (!existsSync(file)) throw new Error(`Prasmei ${name} nav faila ${path}. Faili: ${existsSync(base) ? listFiles(base).join(", ") : "prasme nav sinhronizēta"}`);
	const t = readFileSync(file, "utf8");
	return t.length > MAX ? `${t.slice(0, MAX)}\n[… apgriezts pie ${MAX} zīmēm]` : t;
}

/** read_skill for any skill. A synced skill is read from its folder; an office skill only when ready, a draft answers with the refusal text (a result, not an
 *  error: the agent should tell the user). `forUser`: the Prasmes page shows a draft's text too. */
export function readSkillAny(syncedDir: string, officeDir: string, name: string, path = "SKILL.md", forUser = false): string {
	const info = NAME.test(name) ? listSkills(syncedDir, officeDir).find((s) => s.name === name) : undefined;
	if (info?.origin === "office") {
		if (info.state !== "ready" && !forUser) return draftRefusal(name, info.placeholders);
		return readSkill(officeDir, name, path);
	}
	if (!syncedDir) throw new Error(`Prasme ${name} nav atrasta.`);
	return readSkill(syncedDir, name, path);
}

/** The longest skill description in the lead's list: it carries every synced skill in every request (R47). 160 still measured 10 037 tokens with the five synced skills, over the 10 000 guard, so 100; the skill's own text (read_skill) says the rest. */
export const LEAD_SKILL_DESC_MAX = 100;

/** `descMax`: how much of each description is listed (a specialist's own few skills keep 400, the lead's list is capped at LEAD_SKILL_DESC_MAX). */
export function skillsText(skills: SkillInfo[], descMax = 400): string {
	if (!skills.length) return "Prasmes: nav sinhronizētas (npm run build). Revit darbam lieto tikai rīkus un šos noteikumus.";
	return `Prasmes (lasi ar read_skill, kad uzdevums atbilst; vispirms SKILL.md):\n${skills.map((s) => `- ${s.name}: ${s.description.slice(0, descMax)}`).join("\n")}`;
}
