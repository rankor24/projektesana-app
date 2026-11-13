// Write locks for agents that run side by side (task 8.15; pattern from BIM Crew runtime/file-locks.ts: a queue per key, a bounded
// wait, release after the tool call). BIM Crew locks one file path. Here the tools run in separate tool-server processes (one per
// lane), so a lock in the main process is taken at the gate, before a write tool is let through, and keyed by what the tool
// changes: the delivery's staging folder, the project's data (facts, notes, pins, remarks …), or the one open Revit. Reads are never
// locked. Two lanes can read and think at the same time; their writes take turns.
import type { Level } from "./tools/levels.js";

export type LockKey = "staging" | "store" | "revit";

/** Tools that change the delivery's staging folder: their files must not be changed by two lanes at once. */
const STAGING = new Set(["docx_apply", "write_document", "stage_source_file", "unstage_file", "rename_staged", "stage_revit_sheets", "stage_ifc"]);

/** The lock a tool call needs, or null when it only reads. `revitTools` = the names the Revit MCP lists. */
export function lockKeyOf(tool: string, level: Level, revitTools: ReadonlySet<string> = new Set()): LockKey | null {
	if (level === "read" || level === "never") return null;
	if (revitTools.has(tool) || tool.startsWith("revit_")) return "revit";
	if (STAGING.has(tool)) return "staging";
	return "store";
}

export type Acquired = { ok: true } | { ok: false; reason: string };

interface Waiter {
	owner: string;
	call: string;
	grant: () => void;
	/** the lane ended while waiting: the waiting call is told no */
	cancel: () => void;
}

export interface LockOptions {
	/** how long a lane waits for another lane's write before it is told to do something else first */
	waitMs?: number;
}

/** One queue per key; a call holds the key from `acquire` until `release`. */
export class WriteLocks {
	private holder = new Map<LockKey, { owner: string; call: string; label: string }>();
	private queue = new Map<LockKey, Waiter[]>();
	private byCall = new Map<string, LockKey>();
	private waitMs: number;

	constructor(opts: LockOptions = {}) {
		this.waitMs = opts.waitMs ?? 120_000;
	}

	/** Who holds a key now (for the message another lane gets, and for tests). */
	heldBy(key: LockKey): string | null {
		return this.holder.get(key)?.owner ?? null;
	}

	/** `owner` identifies the lane (what releaseOwner frees); `label` is how another lane's message names it. */
	acquire(key: LockKey, owner: string, call: string, signal?: AbortSignal, label = owner): Promise<Acquired> {
		if (signal?.aborted) return Promise.resolve({ ok: false, reason: "Apturēts." });
		if (!this.holder.has(key)) {
			this.holder.set(key, { owner, call, label });
			this.byCall.set(call, key);
			return Promise.resolve({ ok: true });
		}
		const by = this.holder.get(key)!.label;
		return new Promise<Acquired>((resolve) => {
			let done = false;
			const finish = (r: Acquired) => {
				if (done) return;
				done = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				resolve(r);
			};
			const waiter: Waiter = {
				owner,
				call,
				grant: () => {
					if (done) return;
					this.holder.set(key, { owner, call, label });
					this.byCall.set(call, key);
					finish({ ok: true });
				},
				cancel: () => finish({ ok: false, reason: "Aģents beidza darbu, gaidot rindā." }),
			};
			const leave = () => this.queue.set(key, (this.queue.get(key) ?? []).filter((w) => w !== waiter));
			const onAbort = () => {
				leave();
				finish({ ok: false, reason: "Apturēts, gaidot citu aģentu." });
			};
			const timer = setTimeout(() => {
				leave();
				finish({ ok: false, reason: `${LABEL[key]} šobrīd maina ${by}; gaidīts ${Math.round(this.waitMs / 1000)} s. Dari citu darbu vai mēģini vēlāk.` });
			}, this.waitMs);
			signal?.addEventListener("abort", onAbort, { once: true });
			this.queue.set(key, [...(this.queue.get(key) ?? []), waiter]);
		});
	}

	/** The call finished (well or not): the next in line goes on. */
	release(call: string): void {
		const key = this.byCall.get(call);
		if (!key) return;
		this.byCall.delete(call);
		this.holder.delete(key);
		const next = this.queue.get(key)?.shift();
		if (next) next.grant();
	}

	/** A lane ended (or was stopped): free whatever it still holds and take it out of every queue. */
	releaseOwner(owner: string): void {
		for (const [call, key] of [...this.byCall]) if (this.holder.get(key)?.owner === owner) this.release(call);
		for (const [key, q] of this.queue) {
			for (const w of q) if (w.owner === owner) w.cancel();
			this.queue.set(key, q.filter((w) => w.owner !== owner));
		}
	}
}

const LABEL: Record<LockKey, string> = { staging: "Nodevuma mapi", store: "Projekta datus", revit: "Revit" };
