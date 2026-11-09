// Copies the Revit skills from the user's Claude skills folder into resources/skills/ so the agent gets
// the same instructions Claude Code uses (the Konkursu App pattern). The skills folder stays the single
// source of truth; this copy is build output and git-ignored. A missing skill is reported, never invented.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SKILLS = ["revit-modeling", "revit-drafting", "revit-dimensioning", "revit-api", "revit-room-dimension-chains", "revit-ifc-export-classes", "revit-shared-coordinates-z", "ifc-property-set-txt"];
const source = process.env.PROJEKTESANA_SKILLS_SOURCE ?? join(homedir(), ".claude", "skills");
const target = join(import.meta.dirname, "..", "resources", "skills");

const present = SKILLS.filter((s) => existsSync(join(source, s, "SKILL.md")));
const missing = SKILLS.filter((s) => !present.includes(s));
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const skill of present) cpSync(join(source, skill), join(target, skill), { recursive: true, filter: (p) => !p.includes("__pycache__") });
writeFileSync(join(target, "index.json"), JSON.stringify({ source, syncedAt: new Date().toISOString(), skills: present, missing }, null, 2));
console.log(`skills: ${present.length} synced from ${source}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`);
