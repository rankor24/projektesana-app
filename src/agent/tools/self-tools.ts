// The tools that change something about the agent itself or the app's own files, not the project: its memory, its role text, its skill
// drafts, its routines. They are `run` / `confirm` tools, which a specialist's thread is not offered unless its spec lists them
// (agent/subagents.ts specialistTools); like the mail tools these are for every agent, so ownTools adds exactly these names. The gate still
// applies: `memory_write_office` is a `confirm` tool and asks the user before it runs. Not offered to a `delegate` lane.
export const SELF_TOOL_NAMES: ReadonlySet<string> = new Set(["memory_write", "memory_write_office", "edit_own_role", "draft_skill", "routine_create", "routine_change"]);
