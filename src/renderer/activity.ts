// The activity lines in the window: what main still keeps (activity.recent) plus every line since, in one list that the
// dock's run cards and the status strip read. One subscription for the whole window.
import { useSyncExternalStore } from "react";
import { addActivity, type Activity } from "../shared/activity";
import { call, on } from "./bridge";

let list: Activity[] = [];
const subs = new Set<() => void>();
let started = false;

function set(next: Activity[]) {
	list = next;
	for (const s of [...subs]) s();
}

const same = (a: Activity, b: Activity) => a.run === b.run && a.at === b.at && a.kind === b.kind && a.text === b.text;

function start() {
	if (started) return;
	started = true;
	// subscribe first, then fetch: a line that arrives while the fetch is under way is in both, and is kept once
	on("activity", (a) => set(addActivity(list, a)));
	call("activity.recent")
		.then((old) => {
			let merged = old;
			for (const a of list) if (a.step || !old.some((x) => same(x, a))) merged = addActivity(merged, a);
			set(merged);
		})
		.catch(() => undefined);
}

export function useActivity(): Activity[] {
	start();
	return useSyncExternalStore(
		(cb) => {
			subs.add(cb);
			return () => void subs.delete(cb);
		},
		() => list,
	);
}
