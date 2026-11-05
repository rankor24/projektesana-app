// agent-pi — the family's shared agent loop on pi 1.4 (lifted from konkurss-app/src/agent-pi, 2026-11-05).
//
// Knows nothing about tenders or Revit. Its only ties to the app are the RunEvent type (../shared/types) and the
// MCP launch specs it is handed. Same folder, same contract in every app of the family, so the apps can be combined.
export { PI_PROVIDERS, PI_PROVIDER_IDS, KEY_PROVIDERS, isPiProvider, piProviderInfo, type PiAuthKind, type PiProviderId, type PiProviderInfo } from "./providers.js";
export { PiCredentialStore, DEFAULT_BLOCKED_OAUTH, type PiCredentialOptions, type Seal } from "./credentials.js";
export {
	createPiRuntime,
	defaultEffort,
	defaultPiModel,
	effortFor,
	effortsOf,
	EFFORTS,
	fetchLiveModels,
	listPiModels,
	lookupPiModel,
	piAuthState,
	refreshLiveModels,
	streamFn,
	type LiveModel,
	type PiAuthState,
	type PiEffort,
	type PiIdentity,
	type PiModelInfo,
	type PiModelsOptions,
	type PiRuntime,
} from "./models.js";
export { interactionFor, loginProvider, logoutProvider, type LoginNotice, type LoginUi } from "./login.js";
export { connectMcpServers, connectMcpTools, type McpLaunchSpec, type McpTools, type McpToolsOptions } from "./mcp.js";
export { newPiState, piEvents, type PiState } from "./events.js";
export { DEFAULT_MAX_TURNS, DEFAULT_SYSTEM_PROMPT, runPi, type PiRunOptions } from "./run.js";
