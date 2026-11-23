// Signs the Claude subscription in from Settings by Claude Code's own `claude auth login`, instead of the user pasting a setup-token.
// Ported from OpenMausBot (Apache-2.0): server/drivers/claude-login-auth.ts (the sign-in flow, link filter, code check, sign-out) and
// server/drivers/claude-auth-status.ts (`auth status --json`). Adapted: no provider-contract types, one account per app (so one flag
// instead of a per-config-folder lock), Windows process-tree stop through taskkill, the app's Latvian messages, and a small cache of
// the last status so the settings and the status line can ask synchronously.
//
// The rule that makes this allowed: the program that signs in is the unmodified claude.exe the Agent SDK already ships, signed in by the
// person with their own subscription. This file holds no OAuth client of its own and never sees a claude.ai credential: it only shows the
// link Anthropic's program prints, hands the code the person pasted to that program's stdin, and asks it `auth status --json` whether it
// worked. The login lives in the app's own config folder (CLAUDE_CONFIG_DIR), never the user's ~/.claude.
//
// Plain Node, no SDK import: main.ts imports it at start-up.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";

const MAX_OUTPUT = 32_768;
/** Where Anthropic's sign-in lives. Anything else in the program's output is not a link we show. */
const SIGN_IN_HOSTS = ["claude.com", "claude.ai", "console.anthropic.com", "platform.claude.com"];

/** Variables that would change which account or endpoint a Claude Code process uses; same list as pi's runtime. An
 * `ANTHROPIC_API_KEY` in particular wins over a login and bills per token. `CLAUDE_CODE_OAUTH_TOKEN` is the setup-token: a run
 * adds it back on purpose, the sign-in and the status check must not see one that happens to be in the shell. */
export const CLAUDE_ACCOUNT_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_OAUTH_TOKEN"] as const;

/** The environment of claude.exe without any account of its own: the app's config folder, nothing that would switch the account. */
export function claudeBaseEnv(configDir: string, base: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...base };
	for (const k of CLAUDE_ACCOUNT_VARS) delete env[k];
	return { ...env, CLAUDE_CONFIG_DIR: configDir };
}

/** A sign-in link we may show: https, one of Anthropic's own hosts, no credentials in it. */
export function claudeSignInLink(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase();
		const trusted = SIGN_IN_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
		return url.protocol === "https:" && trusted && !url.username && !url.password ? url.href : null;
	} catch {
		return null;
	}
}

/** The first Anthropic link on a finished line of the program's output. The last, unfinished line is skipped: the link may still be arriving. */
export function claudeLoginPrompt(output: string): { url: string } | null {
	const lines = stripVTControlCharacters(output).split(/\r?\n/).slice(0, -1);
	for (const line of lines) {
		const match = /(https:\/\/\S+)/.exec(line.trim());
		const link = match ? claudeSignInLink(match[1]!.replace(/[),.;]+$/, "")) : null;
		if (link) return { url: link };
	}
	return null;
}

/** What Anthropic's page shows after sign-in: a code, sometimes with `#state`. */
export function claudeLoginCode(value: string): string | null {
	const code = value.trim();
	return /^[A-Za-z0-9_\-#.:]{8,1024}$/.test(code) ? code : null;
}

export type ClaudeAuthState = "in" | "out" | "unknown";

export interface ClaudeAuthInfo {
	/** only `loggedIn: false` is "out"; a timeout or unreadable answer says nothing ("unknown") */
	state: ClaudeAuthState;
	account?: { email?: string; organization?: string };
}

/** `claude auth status --json` output as a state: only `loggedIn: true` / `false` count, everything else says nothing. */
export function parseClaudeAuthStatus(stdout: string): ClaudeAuthInfo {
	try {
		const status: unknown = JSON.parse(stdout);
		if (!status || typeof status !== "object") return { state: "unknown" };
		const loggedIn = (status as { loggedIn?: unknown }).loggedIn;
		if (loggedIn === false) return { state: "out" };
		if (loggedIn !== true) return { state: "unknown" };
		const who = status as { email?: unknown; orgName?: unknown };
		const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\p{Cc}\p{Cf}]/u.test(v) ? v.trim() : undefined);
		const candidate = text(who.email, 254);
		const email = candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : undefined;
		const organization = text(who.orgName, 160);
		return { state: "in", ...(email || organization ? { account: { ...(email ? { email } : {}), ...(organization ? { organization } : {}) } } : {}) };
	} catch {
		return { state: "unknown" };
	}
}

type ExecFn = (file: string, args: string[], options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv; windowsHide: boolean }, cb: (error: Error | null, stdout: string) => void) => unknown;

/** Asks the program itself. Credential storage differs by platform and a file's presence accepts stale credentials, so the file is never read here. */
export function claudeAuthStatus(cli: string, env: NodeJS.ProcessEnv, run: ExecFn = execFile as unknown as ExecFn): Promise<ClaudeAuthInfo> {
	return new Promise((resolve) => {
		try {
			run(cli, ["auth", "status", "--json"], { timeout: 8000, maxBuffer: 65_536, env, windowsHide: true }, (error, stdout) => {
				// a check that timed out says nothing; `auth status` exits 1 when signed out and still prints the JSON
				if ((error as { killed?: boolean } | null)?.killed) return resolve({ state: "unknown" });
				resolve(parseClaudeAuthStatus(String(stdout)));
			});
		} catch {
			resolve({ state: "unknown" });
		}
	});
}

type SpawnFn = (file: string, args: string[], options: { env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"]; windowsHide: boolean }) => ChildProcess;

export interface ClaudeAccountOptions {
	/** claude.exe; resolved when needed so a missing install fails at sign-in, not at start-up */
	cli: () => string;
	/** Claude Code's config folder for this app */
	configDir: string;
	/** the status changed (signed in, signed out, first check): the settings and the status line reload */
	onChange?: () => void;
	log?: (line: string) => void;
	base?: NodeJS.ProcessEnv;
	// test seams
	spawn?: SpawnFn;
	status?: (cli: string, env: NodeJS.ProcessEnv) => Promise<ClaudeAuthInfo>;
	startupTimeoutMs?: number;
	lifetimeMs?: number;
	completeTimeoutMs?: number;
}

/** How a sign-in ended. `ok` = signed in (or already was). */
export type ClaudeLoginResult = { ok: true } | { ok: false; message: string };

interface Flow {
	id: string;
	phase: "waiting" | "ended";
	child: ChildProcess | null;
	ready: boolean;
	codeSent: boolean;
	url: string | null;
	output: string;
	env: NodeJS.ProcessEnv;
	resolve: (v: { url: string | null }) => void;
	reject: (e: Error) => void;
	onEnd: (r: ClaudeLoginResult) => void;
	startupTimer: NodeJS.Timeout;
	expiryTimer: NodeJS.Timeout;
	codeTimer?: NodeJS.Timeout;
	stopping?: Promise<void>;
}

const NOT_AVAILABLE = "Šī pieslēgšanās vairs nav pieejama. Sāc pieslēgšanos vēlreiz.";
const NO_START = "Claude Code neizdevās palaist. Pārbaudi, vai lietotne ir uzstādīta pilnībā, un mēģini vēlreiz.";

/** The Claude login of this app: its status (cached), the sign-in flow and the sign-out. One flow at a time. */
export class ClaudeAccount {
	private info: ClaudeAuthInfo = { state: "unknown" };
	private checkedAt = 0;
	private checking: Promise<ClaudeAuthInfo> | null = null;
	private flow: Flow | null = null;
	private signingOutNow: Promise<void> | null = null;
	private logoutChild: ChildProcess | null = null;
	private disposed = false;

	constructor(private readonly o: ClaudeAccountOptions) {}

	private env(): NodeJS.ProcessEnv {
		return { ...claudeBaseEnv(this.o.configDir, this.o.base), NO_COLOR: "1" };
	}

	/** The last status we saw; "unknown" until the first check has come back. */
	peek(): ClaudeAuthInfo {
		return this.info;
	}

	/** A sign-in or sign-out is in progress. */
	get busy(): boolean {
		return this.flow?.phase === "waiting" || this.signingOutNow !== null;
	}

	private set(next: ClaudeAuthInfo) {
		const changed = next.state !== this.info.state || next.account?.email !== this.info.account?.email || next.account?.organization !== this.info.account?.organization;
		this.info = next;
		this.checkedAt = Date.now();
		if (changed) this.o.onChange?.();
	}

	/** Asks `claude auth status --json` now; checks that overlap share one process. A check with no answer keeps the last known state. */
	refresh(): Promise<ClaudeAuthInfo> {
		this.checking ??= (async () => {
			try {
				const check = this.o.status ?? claudeAuthStatus;
				const next = await check(this.o.cli(), this.env());
				if (next.state !== "unknown" || this.info.state === "unknown") this.set(next);
				else this.checkedAt = Date.now();
			} catch (e) {
				this.o.log?.(`auth status: ${(e as Error).message}`);
			} finally {
				this.checking = null;
			}
			return this.info;
		})();
		return this.checking;
	}

	/** In the background: a check when the last one is older than `maxAgeMs`. */
	refreshIfStale(maxAgeMs = 60_000): void {
		if (!this.checking && Date.now() - this.checkedAt > maxAgeMs && !this.busy) void this.refresh();
	}

	/** Before a run that has no setup-token: a login we trust, or one we just confirmed. Only "in" is trusted without asking again. */
	async ensureSignedIn(): Promise<boolean> {
		if (this.info.state === "in") return true;
		return (await this.refresh()).state === "in";
	}

	/** Starts `claude auth login`. Resolves with the link to show (null: already signed in, nothing to do) once the program has printed
	 * it; `onEnd` hears how the sign-in ended, also when the browser finishes it without a pasted code. */
	async start(onEnd: (r: ClaudeLoginResult) => void): Promise<{ url: string | null }> {
		if (this.disposed) throw new Error("Pieslēgšanās nav pieejama.");
		if (this.signingOutNow) throw new Error("Notiek atteikšanās no Claude. Uzgaidi.");
		const live = this.flow;
		if (live?.phase === "waiting") {
			if (!live.ready) throw new Error("Claude pieslēgšanās jau sākas. Uzgaidi saiti.");
			live.onEnd = onEnd;
			return { url: live.url };
		}
		await live?.stopping;
		const env = this.env();
		return new Promise((resolve, reject) => {
			const life = this.o.lifetimeMs ?? 15 * 60_000;
			const flow: Flow = {
				id: randomUUID(),
				phase: "waiting",
				child: null,
				ready: false,
				codeSent: false,
				url: null,
				output: "",
				env,
				resolve,
				reject,
				onEnd,
				startupTimer: setTimeout(() => this.finish(flow, "Claude Code laikā nerādīja pieteikšanās saiti. Pārbaudi savienojumu un mēģini vēlreiz."), this.o.startupTimeoutMs ?? 30_000),
				expiryTimer: setTimeout(() => this.finish(flow, "Pieteikšanās saite beidzās. Sāc pieslēgšanos vēlreiz."), life),
			};
			flow.startupTimer.unref();
			flow.expiryTimer.unref();
			this.flow = flow;
			// never replace a working login because the button was clicked twice
			void this.refresh().then((info) => {
				if (flow.phase !== "waiting") return;
				if (info.state === "in") this.finish(flow);
				else this.login(flow);
			});
		});
	}

	/** Hands the pasted code to the program's stdin. The outcome arrives through `onEnd`. */
	complete(pasted: string): void {
		const flow = this.flow;
		if (!flow || flow.phase !== "waiting" || !flow.ready) throw new Error(NOT_AVAILABLE);
		if (flow.codeSent) throw new Error("Kods jau nosūtīts. Uzgaidi rezultātu vai atcel un sāc no jauna.");
		const code = claudeLoginCode(pasted);
		if (!code) throw new Error("Ielīmē visu kodu, ko Anthropic lapa rāda pēc pieteikšanās.");
		const stdin = flow.child?.stdin;
		if (!flow.child || !stdin || flow.child.exitCode !== null || flow.child.signalCode !== null) throw new Error(NOT_AVAILABLE);
		flow.codeSent = true;
		flow.codeTimer = setTimeout(() => this.finish(flow, "Claude Code pēc koda ievades nepabeidza pieteikšanos. Sāc pieslēgšanos vēlreiz."), this.o.completeTimeoutMs ?? 60_000);
		flow.codeTimer.unref();
		stdin.write(`${code}\n`, (error) => {
			if (error) this.finish(flow, "Kodu neizdevās nodot Claude Code. Sāc pieslēgšanos vēlreiz.");
		});
	}

	/** Stops a sign-in in progress; its `onEnd` hears "cancelled". */
	async cancel(): Promise<void> {
		const flow = this.flow;
		if (flow?.phase === "waiting") this.finish(flow, "Pieslēgšanās atcelta.");
		await flow?.stopping;
		if (this.logoutChild) await this.stop(this.logoutChild);
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await this.cancel();
	}

	/** Signs out with the program's own `auth logout`, then confirms with `auth status`. A sign-in in progress is not pulled away. */
	async signOut(): Promise<void> {
		if (this.disposed) throw new Error("Atteikšanās nav pieejama.");
		if (this.flow?.phase === "waiting") throw new Error("Pabeidz vai atcel Claude pieslēgšanos, pirms atsakies.");
		if (this.signingOutNow) return this.signingOutNow;
		const run = this.signOutNow();
		this.signingOutNow = run;
		try {
			await run;
		} finally {
			this.signingOutNow = null;
		}
	}

	private async signOutNow(): Promise<void> {
		await this.flow?.stopping;
		await this.logout();
		await this.checking;
		const after = await this.refresh();
		if (after.state === "in") throw new Error("Claude Code joprojām uzrāda pieteikšanos. Atjaunini Claude Code un mēģini vēlreiz.");
		if (after.state === "unknown") throw new Error("Claude Code neapstiprināja atteikšanos. Mēģini vēlreiz.");
	}

	private logout(): Promise<void> {
		return new Promise((resolve, reject) => {
			let child: ChildProcess;
			try {
				child = this.spawnCli(["auth", "logout"], this.env());
			} catch {
				reject(new Error(NO_START));
				return;
			}
			this.logoutChild = child;
			child.stdin?.end();
			child.stdout?.on("data", () => {});
			child.stderr?.on("data", () => {});
			// a hung program must not hold the sign-out forever
			const timer = setTimeout(() => void this.stop(child).then(() => reject(new Error("Claude Code neatbildēja uz atteikšanos. Mēģini vēlreiz."))), this.o.startupTimeoutMs ?? 30_000);
			timer.unref();
			child.once("error", () => {
				clearTimeout(timer);
				reject(new Error(NO_START));
			});
			child.once("close", () => {
				clearTimeout(timer);
				if (this.logoutChild === child) this.logoutChild = null;
				resolve();
			});
		});
	}

	private spawnCli(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
		const run = this.o.spawn ?? (spawn as unknown as SpawnFn);
		return run(this.o.cli(), args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
	}

	private login(flow: Flow): void {
		if (flow.phase !== "waiting") return;
		let child: ChildProcess;
		try {
			// on Windows the program opens the browser itself and also prints the link; the link is shown for when it does not
			child = this.spawnCli(["auth", "login"], flow.env);
		} catch {
			this.finish(flow, NO_START);
			return;
		}
		flow.child = child;
		const receive = (chunk: Buffer) => {
			if (flow.phase !== "waiting") return;
			if (flow.output.length + chunk.length > MAX_OUTPUT) {
				this.finish(flow, "Claude Code atsūtīja negaidītu atbildi. Atjaunini Claude Code un mēģini vēlreiz.");
				return;
			}
			flow.output += chunk.toString("utf8");
			if (flow.ready) return;
			const prompt = claudeLoginPrompt(flow.output);
			if (!prompt) return;
			flow.url = prompt.url;
			flow.ready = true;
			clearTimeout(flow.startupTimer);
			flow.resolve({ url: prompt.url });
		};
		child.stdout?.on("data", receive);
		child.stderr?.on("data", receive);
		child.once("error", (error: NodeJS.ErrnoException) => this.finish(flow, error.code === "ENOENT" ? "Claude Code nav atrasts lietotnes mapē." : NO_START));
		child.once("close", (code) => {
			if (flow.child === child) flow.child = null;
			if (flow.phase !== "waiting") return;
			const output = stripVTControlCharacters(flow.output);
			flow.output = "";
			// the browser can finish the sign-in without a pasted code: what counts is what `auth status` says
			void this.refresh().then((info) => {
				if (flow.phase !== "waiting") return;
				if (info.state === "in") return this.finish(flow);
				this.finish(
					flow,
					flow.codeSent
						? /invalid|expired|denied|rejected/i.test(output)
							? "Anthropic nepieņēma šo kodu. Sāc pieslēgšanos vēlreiz un ielīmē visu kodu."
							: "Claude Code pabeidza darbu, bet pieteikšanās nav izdevusies. Sāc pieslēgšanos vēlreiz."
						: code === 0
							? "Claude Code pabeidza darbu, bet pieteikšanās nav izdevusies. Sāc pieslēgšanos vēlreiz."
							: "Claude Code apstājās, pirms pieteikšanās pabeigta. Pārbaudi savienojumu un mēģini vēlreiz.",
				);
			});
		});
	}

	/** Ends the flow once: `message` absent = signed in. The program is stopped, the status re-read, the person told through `onEnd`. */
	private finish(flow: Flow, message?: string): void {
		if (flow.phase !== "waiting") return;
		flow.phase = "ended";
		clearTimeout(flow.startupTimer);
		clearTimeout(flow.expiryTimer);
		if (flow.codeTimer) clearTimeout(flow.codeTimer);
		flow.output = "";
		if (!flow.ready) {
			if (message) flow.reject(new Error(message));
			else flow.resolve({ url: null });
		}
		flow.stopping = this.stop(flow.child).then(() => undefined);
		if (!message) {
			// a success shows its account at once (email), not after the next poll
			void this.refresh().finally(() => flow.onEnd({ ok: true }));
		}
		// before the link was shown the failure already went to whoever awaits `start`
		else if (flow.ready) flow.onEnd({ ok: false, message });
	}

	/** Stops a program and its children (claude.exe may start helpers); true once it has exited. */
	private async stop(child: ChildProcess | null): Promise<boolean> {
		if (!child || child.exitCode !== null || child.signalCode !== null) return true;
		const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
		if (process.platform === "win32" && child.pid) execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
		else child.kill("SIGKILL");
		await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 3000).unref())]);
		return child.exitCode !== null || child.signalCode !== null;
	}
}
