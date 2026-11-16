// The shape of one skill of the library (task 13.6), shared by the skills code, the IPC and the Prasmes page.
export interface SkillInfo {
	name: string;
	description: string;
	files: string[];
	/** synced = the Revit skills copied at build time (always ready); office = the office's own, imported into <appDir>\skills */
	origin: "synced" | "office";
	/** the role folder an office skill was imported from */
	group?: string;
	/** {{AIZPILDĪT: …}} left in the skill's .md files */
	placeholders: number;
	/** the user's mark that the skill's test example was checked; synced skills count as tested. Dropped again when the text gains a placeholder. */
	tested: boolean;
	/** an office skill is ready only without placeholders and once the user marked it tested */
	state: "draft" | "ready";
}
