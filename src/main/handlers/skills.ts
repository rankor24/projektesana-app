// The office's skills library (task 13.6): list, import, mark tested, read. The files live in <appDir>\skills (skills.ts holds the rules); the Prasmes
// page assigns a skill to an agent through agents.save (spec.skills), so nothing here knows about agents.
import { importSkills, listSkills, markTested, officeSkillsDir, readSkillAny } from "../../agent/skills.js";
import type { Handlers } from "../../shared/api.js";
import type { AppSettings } from "../settings.js";

type K = "skills.list" | "skills.import" | "skills.tested" | "skills.read";

export function skillHandlers(d: { settings: AppSettings; /** the synced skills folder */ skillsDir?: string }): Pick<Handlers, K> {
	const office = () => officeSkillsDir(d.settings.dir);
	const synced = () => d.skillsDir ?? "";
	return {
		"skills.list": () => listSkills(synced(), office()),
		"skills.import": (folder: string) => {
			if (typeof folder !== "string" || !folder.trim()) throw new Error("Norādi mapi ar prasmēm.");
			return importSkills(folder, office(), synced());
		},
		"skills.tested": (name: string, tested: boolean) => {
			if (typeof name !== "string" || typeof tested !== "boolean") throw new Error("Nederīgs pieprasījums: prasmes nosaukums un atzīme.");
			return markTested(office(), name, tested);
		},
		"skills.read": (name: string, path?: string) => readSkillAny(synced(), office(), name, path, true),
	};
}
