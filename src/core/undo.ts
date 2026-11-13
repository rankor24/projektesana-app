// What an agent run changed in a project, and taking it back (task 8.7). Two kinds of change, one list:
//   a collection write (a fact, a pin, a task, a note…): the store kept the version it replaced, tagged with the run and the
//     tool. It can be undone while it is still the newest write of that collection; after a later write undoing it would
//     throw that one away too, so it says so instead.
//   a file the tool made, replaced or removed: a checkpoint (checkpoints.ts).
// Undoing is the user's click and is itself logged (kind "undo"), so it can be told apart and is never silent.
import { listCheckpoints, undoCheckpoint } from "./checkpoints.js";
import type { CollectionName } from "./model.js";
import { COLLECTIONS } from "./model.js";
import type { StoredEntry } from "./log.js";
import type { ProjectStore } from "./store.js";
import type { UndoRow } from "./undo-types.js";

export type { UndoRow };

const COLLECTION_LABEL: Record<CollectionName, string> = {
	sources: "Avoti",
	facts: "Fakti",
	requirements: "Prasības",
	findings: "Atradumi",
	deliveries: "Nodevumi",
	pins: "Piezīmes",
	revisions: "Revīzijas",
	tasks: "Uzdevumi",
};

const isCollection = (c: unknown): c is CollectionName => typeof c === "string" && (COLLECTIONS as string[]).includes(c);

const undoneSeqs = (events: StoredEntry[]) => new Set(events.filter((e) => e.kind === "undo" && typeof e.data?.of === "number").map((e) => e.data!.of as number));

/** The newest write of a collection that still stands: not an undo, and not itself undone. Taking back anything older than it
 *  would take it back too, which is why only this one can be undone. */
export function lastStandingWrite(events: StoredEntry[], c: CollectionName): number | null {
	const undone = undoneSeqs(events);
	const live = events.filter((e) => e.data?.collection === c && e.kind !== "undo" && !undone.has(e.seq)).map((e) => e.seq);
	return live.length ? Math.max(...live) : null;
}

export function undoRows(store: ProjectStore, run: string): UndoRow[] {
	const events = store.events();
	const undone = undoneSeqs(events);
	const rows: UndoRow[] = [];
	for (const e of events) {
		const c = e.data?.collection;
		if (e.data?.run !== run || e.by !== "agent" || !isCollection(c)) continue;
		const newest = lastStandingWrite(events, c);
		const done = undone.has(e.seq);
		const has = store.versions(c).includes(e.seq);
		rows.push({
			key: `log:${e.seq}`,
			kind: "collection",
			label: `${COLLECTION_LABEL[c]}: ${e.kind}${typeof e.data?.count === "number" ? ` (tagad ${e.data.count})` : ""}`,
			at: e.at,
			tool: typeof e.data?.tool === "string" ? e.data.tool : null,
			undone: done,
			undoable: !done && has && newest === e.seq,
			...(done ? {} : !has ? { why: "iepriekšējā versija vairs nav" } : newest !== e.seq ? { why: `${COLLECTION_LABEL[c]} vēlāk mainītas: vispirms atsauc vēlākās izmaiņas` } : {}),
		});
	}
	for (const cp of listCheckpoints(store, run)) {
		rows.push({
			key: `cp:${cp.id}`,
			kind: "file",
			label: `${cp.created ? "Izveidots" : "Aizstāts vai izņemts"} fails ${cp.path.replace(/\\/g, "/")}`,
			at: cp.at,
			tool: cp.tool,
			undone: cp.state === "undone",
			undoable: cp.state === "active",
		});
	}
	return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/** Takes back one change of an agent run. Throws, saying why, when it cannot. */
export function applyUndo(store: ProjectStore, key: string): string {
	if (key.startsWith("cp:")) {
		const r = undoCheckpoint(store, key.slice(3));
		store.log({ kind: "undo", by: "user", data: { file: r.path, did: r.did } });
		return r.did === "restored" ? "Fails atjaunots." : "Fails pārvietots malā (nekas netiek dzēsts).";
	}
	const m = /^log:(\d+)$/.exec(key);
	if (!m) throw new Error(`Nezināma izmaiņa: ${key}`);
	const seq = Number(m[1]);
	const e = store.events().find((x) => x.seq === seq);
	const c = e?.data?.collection;
	if (!e || e.by !== "agent" || !isCollection(c)) throw new Error(`Izmaiņa ${seq} nav aģenta ieraksts.`);
	const events = store.events();
	if (undoneSeqs(events).has(seq)) throw new Error("Šī izmaiņa jau ir atsaukta.");
	if (!store.versions(c).includes(seq)) throw new Error("Iepriekšējās versijas vairs nav: atsaukt nevar.");
	if (lastStandingWrite(events, c) !== seq) throw new Error(`${COLLECTION_LABEL[c]} ir mainītas vēlāk: vispirms atsauc vēlākās izmaiņas.`);
	store.write(c, store.readVersion(c, seq), { kind: "undo", by: "user", data: { of: seq } });
	return `${COLLECTION_LABEL[c]} atgrieztas iepriekšējā stāvoklī.`;
}
