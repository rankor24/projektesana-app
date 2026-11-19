// One lock for every Office COM job on the machine (ruling R50). The Word export runs in the tools server of an agent run (one process per run) and the
// text extraction of .doc/.xls in the Electron main process; a failed job's cleanup stops the "new" automation servers it sees, so it must never run
// beside another job in any process. The lock is a file made with the exclusive flag (`wx`): whoever creates it owns it. It holds the owner's pid and
// start time. A lock whose pid is gone, or that is older than its owner's job limit + 60 s, is a leftover and is taken over.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";

export const LOCK_FILE = "office.lock";
export const LOCK_POLL_MS = 200;
const STALE_EXTRA_MS = 60_000;
/** an unreadable lock (its owner died between creating the file and writing it) counts as a leftover after this long */
const UNREADABLE_STALE_MS = 5 * 60_000;

interface LockBody {
	pid: number;
	start: number;
	/** after this long the lock is a leftover whatever its pid says (pids are reused) */
	staleMs: number;
	/** tells our lock from the one that replaced it, so a release never removes another job's lock */
	token: string;
}

/** What a test replaces: the clock, the liveness of a pid, the wait between tries. */
export interface LockEnv {
	pid: number;
	now(): number;
	alive(pid: number): boolean;
	sleep(ms: number): Promise<void>;
	pollMs: number;
}

export const realLockEnv: LockEnv = {
	pid: process.pid,
	now: () => Date.now(),
	alive: (pid) => {
		try {
			process.kill(pid, 0); // signal 0 only asks
			return true;
		} catch (e) {
			return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, but ours to ask no more
		}
	},
	sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	pollMs: LOCK_POLL_MS,
};

export class OfficeLockTimeout extends Error {
	constructor(waitedMs: number) {
		super(`Office darbs gaidīja ${Math.round(waitedMs / 1000)} s, bet cits Office darbs vēl nebeidzās.`);
	}
}

/** Takes the lock away when its owner is gone or it is too old. true: the file is gone, try to create it again. */
function takeIfStale(file: string, env: LockEnv): boolean {
	let body: LockBody | null = null;
	try {
		body = JSON.parse(readFileSync(file, "utf8")) as LockBody;
		if (!Number.isInteger(body.pid) || !Number.isFinite(body.start) || !Number.isFinite(body.staleMs)) body = null;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return true; // released between our two looks
	}
	let stale: boolean;
	if (body) stale = !env.alive(body.pid) || env.now() - body.start > body.staleMs;
	else {
		try {
			stale = env.now() - statSync(file).mtimeMs > UNREADABLE_STALE_MS;
		} catch {
			return true;
		}
	}
	if (!stale) return false;
	rmSync(file, { force: true });
	return true;
}

/**
 * Runs `fn` while holding the lock in `dir`. Waits for it up to `timeoutMs` (a poll every 200 ms), then throws OfficeLockTimeout. `timeoutMs` is also the
 * job's own limit: a lock older than that + 60 s is stale. The lock is released in `finally`, also when `fn` throws.
 */
export async function withOfficeLock<T>(dir: string, timeoutMs: number, fn: () => Promise<T>, env: LockEnv = realLockEnv): Promise<T> {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, LOCK_FILE);
	const began = env.now();
	const mine: LockBody = { pid: env.pid, start: began, staleMs: timeoutMs + STALE_EXTRA_MS, token: `${env.pid}-${began}-${Math.random().toString(36).slice(2, 10)}` };
	for (;;) {
		try {
			const fd = openSync(file, "wx");
			try {
				mine.start = env.now();
				writeSync(fd, JSON.stringify(mine));
			} catch (e) {
				closeSync(fd);
				rmSync(file, { force: true });
				throw e;
			}
			closeSync(fd);
			break;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
		}
		if (takeIfStale(file, env)) continue;
		const waited = env.now() - began;
		if (waited >= timeoutMs) throw new OfficeLockTimeout(waited);
		await env.sleep(env.pollMs);
	}
	try {
		return await fn();
	} finally {
		try {
			// only our own lock: a stale-looking one may have been taken over while a very long job still ran
			if ((JSON.parse(readFileSync(file, "utf8")) as LockBody).token === mine.token) rmSync(file, { force: true });
		} catch {
			// already gone
		}
	}
}
