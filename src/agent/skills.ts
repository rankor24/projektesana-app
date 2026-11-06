// Skills (task 6.3): the Revit skills synced into resources/skills at build time (scripts/sync-skills.mjs, the Konkursu
// App pattern). The agent gets the list with each skill's description in its system text, and reads a SKILL.md or one of
// the skill's files with read_skill when the task matches. Paths are kept inside the skill's own folder.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export interface SkillInfo {
	name: string;
	description: string;
	files: string[];
}

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

export function listSkills(skillsDir: string): SkillInfo[] {
	if (!existsSync(skillsDir)) return [];
	return readdirSync(skillsDir)
		.filter((n) => existsSync(join(skillsDir, n, "SKILL.md")))
		.map((n) => {
			const fm = frontMatter(readFileSync(join(skillsDir, n, "SKILL.md"), "utf8"));
			return { name: n, description: fm.description ?? "", files: listFiles(join(skillsDir, n)) };
		});
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

export function skillsText(skills: SkillInfo[]): string {
	if (!skills.length) return "Prasmes: nav sinhronizētas (npm run build). Revit darbam lieto tikai rīkus un šos noteikumus.";
	return `Prasmes (lasi ar read_skill, kad uzdevums atbilst; vispirms SKILL.md):\n${skills.map((s) => `- ${s.name}: ${s.description.slice(0, 400)}`).join("\n")}`;
}
