// Google Antigravity as a provider the settings can choose. Plain data, no process or file imports, so the renderer and the settings can read it too.
//
// Google moved personal Gemini accounts from Gemini CLI to Antigravity on 2026-06-18. The app runs Google's own ACP server (Agent Client Protocol) as a
// child process, signed in by the server's own `authenticate` with the person's Google account: the app never sees a Google password. The models the
// account has come from the server itself, after the sign-in. See docs/BD/openmausbot-adoption-plan.md §1 (row 21) and src/agent/antigravity/*.ts.

export const ANTIGRAVITY = "antigravity";

export const ANTIGRAVITY_LABEL = "Google Gemini (Antigravity)";

export const isAntigravity = (provider: string): boolean => provider === ANTIGRAVITY;

/** Said when a run starts on Antigravity without a sign-in (and the words the failover reads as "signed out": `nav pieslēgts`). */
export const ANTIGRAVITY_NOT_CONNECTED = "Google Gemini (Antigravity) nav pieslēgts: Iestatījumi → Pakalpojumi → Google Gemini (Antigravity) → Pieslēgties ar abonementu (vispirms tiek instalēts Google oficiālais Antigravity serveris).";

/** What a run says when Google's server asks for a new sign-in (the stored one is revoked or the account is not eligible any more). */
export const ANTIGRAVITY_SIGN_IN_AGAIN = "Antigravity nav pieslēgts: Google prasa jaunu pieteikšanos (authentication required). Iestatījumi → Pakalpojumi → Pieslēgties ar abonementu.";
