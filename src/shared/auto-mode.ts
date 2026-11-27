// Auto mode: what it never answers by itself (the user's ruling 2026-11-27: "keep it guarded with clear command"). Shared so the window can describe these cards in plain words (confirm-text.ts).
/** Auto mode (the button in the agent chat, Settings.autoApprove) answers every approval card with yes, except a batch with one of these: they stay with the user.
 *  - what changes who the agents are or what they may do (agent_configure and the app calls that save an agent, a department, a role, a skill),
 *  - the one sanctioned write into an office folder (the delivery copy into 1.4_Nodevumi) and "sent", which is the user's own word about what he sent out.
 *  The hard refusals are not here: they come before any card (the gate's `never` and `deny`, the working-copy check) and Auto mode never reaches them. */
export const AUTO_STILL_ASKS_TOOLS: ReadonlySet<string> = new Set(["agent_configure"]);
export const AUTO_STILL_ASKS_CALLS: ReadonlySet<string> = new Set([
	"agents.save", "agents.move", "departments.save", "agents.role.set", "agents.role.import", "agents.shared.set", "agents.importTeam", "skills.import",
	"deliveries.copy", "deliveries.markSent",
]);
