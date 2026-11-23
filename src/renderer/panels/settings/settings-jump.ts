// A request to open Settings at one place: the agent's "please type the key" notice, a search result, a link from another page.
// The Settings window may not be open yet when the request is made, so the last request waits here until the window takes it, and
// an open window hears of a new one at once. Nothing is stored: a request is used once.
import type { SettingsPageId } from "../../../shared/settings-index";

export interface SettingsTarget {
	page: SettingsPageId;
	anchor?: string;
}

let pending: SettingsTarget | null = null;
const listeners = new Set<(t: SettingsTarget) => void>();

/** Asks for this place. An open window shows it now; otherwise the next window to open takes it. */
export function requestSettings(t: SettingsTarget): void {
	pending = t;
	for (const l of [...listeners]) l(t);
}

/** The waiting request, if any, and forgets it. */
export function takeSettingsRequest(): SettingsTarget | null {
	const t = pending;
	pending = null;
	return t;
}

export function onSettingsRequest(fn: (t: SettingsTarget) => void): () => void {
	listeners.add(fn);
	return () => void listeners.delete(fn);
}
