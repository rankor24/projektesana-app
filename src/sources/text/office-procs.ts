// Office processes left behind by a COM job. When a PowerShell helper times out, Node kills PowerShell before the script's `finally` reaches Quit(), and the Office
// server it started (WINWORD.EXE /Automation -Embedding, child of DcomLaunch) stays alive for good. A job that failed therefore stops the automation servers that
// appeared during it: the PIDs before the job, the PIDs after, the new ones go. A server with a window (one the user opened) and any that existed before are never touched.
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LockEnv, withOfficeLock } from "./office-lock.js";

/** The Office programs whose COM servers the helpers start. */
export type OfficeExe = "WINWORD.EXE" | "EXCEL.EXE";

/** One process of the query: its id, its command line, and whether it owns a visible window. */
export interface OfficeProc {
	pid: number;
	cmd: string | null;
	window: boolean;
}

/** A server started by COM automation carries these two switches; a Word the user opened does not. */
const AUTOMATION = /\/Automation\s+-Embedding/i;

/** The ids of the processes that are automation servers without a window. */
export function automationPids(procs: readonly OfficeProc[]): Set<number> {
	return new Set(procs.filter((p) => Number.isInteger(p.pid) && p.pid > 0 && !p.window && p.cmd !== null && AUTOMATION.test(p.cmd)).map((p) => p.pid));
}

/** The ids to stop after a failed job: those present now that were not there before it. */
export function pidsToStop(before: ReadonlySet<number>, after: ReadonlySet<number>): number[] {
	return [...after].filter((pid) => !before.has(pid)).sort((a, b) => a - b);
}

/** What touches the machine, so a test can stand in for it. */
export interface OfficeProcIO {
	/** null when the processes cannot be listed (not Windows, PowerShell refused): then nothing is stopped, as nobody can tell which are new */
	list(exe: OfficeExe): Promise<Set<number> | null>;
	stop(pids: readonly number[]): void;
	/** the settling wait of the cleanup; a test passes one that does not sleep */
	wait?(ms: number): Promise<void>;
}

// one small CIM query; the window test is Get-Process's MainWindowHandle
const QUERY = (exe: OfficeExe) =>
	`$r = @(Get-CimInstance Win32_Process -Filter "Name='${exe}'" | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; [pscustomobject]@{ pid = [int]$_.ProcessId; cmd = $_.CommandLine; window = [bool]($p -and $p.MainWindowHandle -ne 0) } }); ConvertTo-Json -InputObject $r -Compress`;

export const realIO: OfficeProcIO = {
	list: (exe) =>
		process.platform !== "win32"
			? Promise.resolve(null)
			: new Promise((resolve) => {
					execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", QUERY(exe)], { windowsHide: true, timeout: 20_000, encoding: "utf8" }, (err, stdout) => {
						if (err) return resolve(null);
						try {
							const j = JSON.parse(stdout.trim() || "[]") as OfficeProc | OfficeProc[];
							resolve(automationPids(Array.isArray(j) ? j : [j]));
						} catch {
							resolve(null);
						}
					});
				}),
	wait: (ms) => new Promise((r) => setTimeout(r, ms)),
	stop: (pids) => {
		for (const pid of pids) {
			try {
				process.kill(pid); // on Windows this ends the process outright, as Stop-Process -Force does
			} catch {
				// already gone
			}
		}
	},
};

// COM jobs of any helper run one at a time through here inside this process; office-lock.ts makes them one at a time across processes
let gate: Promise<unknown> = Promise.resolve();

/** After a failed job the script's own Quit() may have run and its Office still be shutting down: it gets this long before the second look. */
export const SETTLE_MS = 1_500;

/** The folder of `office.lock`: the app data folder every process of the app knows (PROJEKTESANA_APP for a tools server); without one, a folder of the temp directory. */
export function officeLockDir(appDir?: string): string {
	return appDir || join(tmpdir(), "projektesana");
}

/** The lock every job takes: the folder of `office.lock` (the app data folder) and the job's own time limit, which is also how long to wait for it. */
export interface OfficeLockOpts {
	dir: string;
	timeoutMs: number;
	/** a test's clock and pids */
	env?: LockEnv;
}

/**
 * Runs `job` under the cross-process Office lock (R50): list the servers, run, and when `failed` says it did (a timeout, an error) stop those that
 * started during it, still there after a settling wait and still without a window. Snapshot, job and cleanup of two jobs, in whatever process, never
 * overlap. Errors of the job pass through after the cleanup; a lock that never frees throws OfficeLockTimeout.
 */
export function withOfficeCleanup<T>(exe: OfficeExe, job: () => Promise<T>, failed: (r: T) => boolean, lock: OfficeLockOpts, io: OfficeProcIO = realIO): Promise<T> {
	const wait = io.wait ?? realIO.wait!;
	const run = gate.then(() =>
		withOfficeLock(
			lock.dir,
			lock.timeoutMs,
			async () => {
				const before = await io.list(exe);
				const clean = async () => {
					if (!before) return;
					const first = await io.list(exe);
					const fresh = first ? pidsToStop(before, first) : [];
					if (!fresh.length) return;
					await wait(SETTLE_MS);
					const later = await io.list(exe);
					// only what is still there and still windowless: one that finished quitting is gone, and nothing else is touched
					if (later) io.stop(fresh.filter((pid) => later.has(pid)));
				};
				let r: T;
				try {
					r = await job();
				} catch (e) {
					await clean();
					throw e;
				}
				if (failed(r)) await clean();
				return r;
			},
			lock.env,
		),
	);
	gate = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}
