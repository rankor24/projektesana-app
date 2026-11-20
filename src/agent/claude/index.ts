// The Claude subscription engine (Claude Agent SDK), beside pi. Only ThreadRunner, the session and main.ts know it is there.
// Importing this loads the SDK: the app's startup path imports ./provider.js (plain data) and loads ./run.js on first use.
export { CLAUDE_SUB, CLAUDE_SUB_DEFAULT_MODEL, CLAUDE_SUB_LABEL, CLAUDE_SUB_TOKEN_HELP, catalogProvider, claudeEffort, isClaudeSub, NOT_CONNECTED, type ClaudeEffort } from "./provider.js";
export { claudeEvents, newClaudeState, toolNameOf, TOOL_SERVER, type ClaudeState } from "./events.js";
export { claudeEnv, createClaudeRun, type ClaudeEngineConfig, type ClaudeRunOptions } from "./run.js";
