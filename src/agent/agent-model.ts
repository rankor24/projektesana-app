// The model facts (context window, images, efforts) of the model a thread or run is set to, whichever engine runs it.
//
// The Claude subscription uses pi's `anthropic` catalog, Antigravity pi's `google` catalog: its models are named by Google's own server after the sign-in
// (ids such as "gemini-4-neon" that no pi catalog or Gemini API list has), so an id nobody else knows is made up with the catalog's window and image support
// (`lookupPiModel` with `standIn`) instead of failing as an "Unknown model" before the run has started.
import type { Api, Model } from "@earendil-works/pi-ai";
import { isAntigravity } from "./antigravity/provider.js";
import { catalogProvider } from "./claude/provider.js";
import { lookupPiModel, type PiRuntime } from "./pi/models.js";

export function lookupAgentModel(rt: PiRuntime, provider: string, modelId?: string): Model<Api> {
	return lookupPiModel(rt, catalogProvider(provider), modelId, isAntigravity(provider));
}
