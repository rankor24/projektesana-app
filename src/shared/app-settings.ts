// What the agent's settings tool (app_settings) and the Settings window say to each other: the three tiers, one change the agent
// made (with its before and after for the user to read and undo), and the event that tells every window about it.
// Ported in idea from OpenMausBot docs/superpowers/specs/2026-11-12-app-settings-tool-design.md (tiers safe / secret / owner-only,
// Undo that is stale-safe, a write budget per turn). Types only: the renderer imports this through shared/api.ts.

/** safe: applies at once and can be undone. secret: an API key or token; the agent never gets or gives a value, the user types it in Settings.
 *  owner-only: only the user changes it (sign-in, paths that start programs, the name signed under decisions); the agent explains where. */
export type SettingTier = "safe" | "secret" | "owner-only";

/** One change an agent made to a setting. `before` and `after` are what a person reads (never a key). */
export interface AppSettingChange {
	/** "chg-…": what Undo names */
	id: string;
	/** the setting's id in the registry, e.g. "ai.backup" */
	settingId: string;
	label: string;
	before: string;
	after: string;
	/** the agent that made it ("lead" when the run has no agent name) */
	by: string;
	at: string;
	undone: boolean;
}

/** `ask`: the agent met a setting only the user can change; the window offers to open it. */
export type AppSettingEvent =
	| { kind: "change"; change: AppSettingChange }
	| { kind: "undone"; change: AppSettingChange }
	| { kind: "ask"; settingId: string; label: string; tier: Exclude<SettingTier, "safe">; where: string; by: string; note: string };
