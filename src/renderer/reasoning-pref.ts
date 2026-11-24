// How the model's reasoning shows in the chat (a preference of this computer, kept in localStorage, shared by every window):
// hidden = no "Domā" steps in the run card; folded = each is one line, and only the one being written is open (how it always was);
// open = every one is open. Changed from the button by the message box and read by the run card.
import { useSyncExternalStore } from "react";
import { tr } from "./i18n";

export type Reasoning = "hidden" | "folded" | "open";

const KEY = "projektesana.reasoning";
const ORDER: Reasoning[] = ["folded", "open", "hidden"];
const listeners = new Set<() => void>();

export const REASONING_LABEL: Record<Reasoning, string> = { hidden: tr("paslēpta"), folded: tr("sakļauta"), open: tr("atvērta") };

export function readReasoning(): Reasoning {
	try {
		const v = localStorage.getItem(KEY);
		return v === "hidden" || v === "open" ? v : "folded";
	} catch {
		return "folded";
	}
}

function write(v: Reasoning) {
	try {
		localStorage.setItem(KEY, v);
	} catch {
		// no storage: the choice is not kept
	}
	listeners.forEach((l) => l());
}

export function cycleReasoning() {
	write(ORDER[(ORDER.indexOf(readReasoning()) + 1) % ORDER.length]);
}

function subscribe(cb: () => void) {
	listeners.add(cb);
	// another window of the app changed it
	const onStorage = (e: StorageEvent) => e.key === KEY && cb();
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(cb);
		window.removeEventListener("storage", onStorage);
	};
}

export const useReasoning = (): Reasoning => useSyncExternalStore(subscribe, readReasoning, () => "folded");
