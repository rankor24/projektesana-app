// The Antigravity engine (Google's ACP server), beside pi and the Claude Agent SDK. Only ThreadRunner, the session and main.ts know it is there.
export { ANTIGRAVITY, ANTIGRAVITY_LABEL, ANTIGRAVITY_NOT_CONNECTED, ANTIGRAVITY_SIGN_IN_AGAIN, isAntigravity } from "./provider.js";
export { AntigravityAccount, type AntigravityNotice } from "./account.js";
export { AntigravityHost, antigravityFolders } from "./host.js";
export { createAntigravityRun, type AntigravityEngineConfig, type AntigravityRunOptions } from "./run.js";
