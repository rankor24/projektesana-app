// What the conversations panel remembers between sessions: which departments are folded and which agents are opened. Per installation, not per project (the
// departments and agents are the app's), and in localStorage, which the windows of the app share (the chat window and the panel read the same).
//
// Ported from OpenMausBot (Apache-2.0) src/lib/sidebar-preferences.ts: `loadCollapsedSections` / `saveCollapsedSections` / `toggleCollapsedSection`
// (a string list in storage, read defensively, written best-effort) and src/components/sidebar-state.ts (one object of what the list draws).
// Adapted: departments are folded by default only when the user folds them (a list of folded ids, as there); agents are the other way round, closed
// until opened, because a team of sixteen agents with a thread each would otherwise be a wall of titles; an agent that holds the open conversation, or
// is busy, opens by itself (see ThreadList). OpenMausBot's Simple / Advanced and density are not here (the plan: one mode, everything shown).
import { useCallback, useEffect, useState } from "react";

const KEY = "projektesana.threadTree.v1";

export interface TreeState {
	/** ids of folded departments ("" = the group of agents in no department) */
	folded: string[];
	/** ids of agents whose threads are shown */
	opened: string[];
}

const EMPTY: TreeState = { folded: [], opened: [] };

const list = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []);

/** What was saved; an unreadable or foreign value is an empty state (a corrupt entry never breaks the panel). */
export function loadTreeState(storage: Pick<Storage, "getItem"> | null = safeStorage()): TreeState {
	try {
		const raw = storage?.getItem(KEY);
		if (!raw) return EMPTY;
		const j = JSON.parse(raw) as Partial<TreeState> | null;
		return { folded: list(j?.folded), opened: list(j?.opened) };
	} catch {
		return EMPTY;
	}
}

export function saveTreeState(s: TreeState, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
	try {
		storage?.setItem(KEY, JSON.stringify(s));
	} catch {
		// private mode or a full disk: the panel works, it just forgets
	}
}

function safeStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/** `ids` with `id` added or taken out. */
export const toggleId = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

/** The panel's remembered state; a change in another window of the app arrives through the `storage` event. */
export function useTreeState() {
	const [state, setState] = useState<TreeState>(() => loadTreeState());
	useEffect(() => {
		const sync = (e: StorageEvent) => {
			if (e.key === KEY || e.key === null) setState(loadTreeState());
		};
		window.addEventListener("storage", sync);
		return () => window.removeEventListener("storage", sync);
	}, []);
	const update = useCallback((f: (s: TreeState) => TreeState) => {
		setState((s) => {
			const next = f(s);
			saveTreeState(next);
			return next;
		});
	}, []);
	return {
		state,
		toggleFolded: (id: string) => update((s) => ({ ...s, folded: toggleId(s.folded, id) })),
		toggleOpened: (id: string) => update((s) => ({ ...s, opened: toggleId(s.opened, id) })),
		/** the conversation on screen is in this agent under this department: show it (an agent opened, a department unfolded), once */
		reveal: (agent: string, department: string) => update((s) => (s.opened.includes(agent) && !s.folded.includes(department) ? s : { opened: s.opened.includes(agent) ? s.opened : [...s.opened, agent], folded: s.folded.filter((x) => x !== department) })),
		/** a department was removed: what was remembered of it goes with it */
		forget: (id: string) => update((s) => ({ folded: s.folded.filter((x) => x !== id), opened: s.opened.filter((x) => x !== id) })),
	};
}
