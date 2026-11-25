// The Antigravity connection as the Settings page and the sign-in handlers see it: is Google's server installed, is a Google account signed in, which models
// the account has (read from the server after the sign-in, kept in a file), and the steps that change it: install, sign in, sign out.
//
// Adapted from OpenMausBot (Apache-2.0) server/drivers/antigravity.ts (create: installRuntime, startAuthentication, signOut that stops the server first and
// removes the stored sign-in) and antigravity-acp.ts (validateAntigravityRuntime: the download is started once and must identify as the expected release).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	AntigravityAcpClient,
	isValidAntigravityInitializeResult,
	noteAntigravitySignedIn,
	prepareAntigravityProfile,
	removeAntigravitySignIn,
	sweepAntigravityTemp,
	type AntigravityCatalog,
} from "./acp.js";
import { AntigravityAuthController, type SignInEnd } from "./auth.js";
import type { AntigravityHost } from "./host.js";
import { antigravityInstallAvailable, installAntigravityRuntime, resolveAntigravityRuntime, type AntigravityRuntime } from "./runtime.js";

export type AntigravityNotice = { type: "url"; url: string } | { type: "ask"; message: string } | { type: "info"; message: string } | { type: "done" } | { type: "error"; message: string };

const CATALOG_MAX_AGE_MS = 24 * 3_600_000;
const CATALOG_RETRY_MS = 10 * 60_000;
const STATE_MAX_AGE_MS = 15_000;

export interface AntigravityAccountOptions {
	host: AntigravityHost;
	/** the state the settings page shows changed */
	onChange: () => void;
	/** a finished sign-in ends a "signed out" hold on the provider (failover/holds.ts) */
	onSignedIn?: () => void;
	log?: (line: string) => void;
}

/** The server must identify as the expected release before it is installed: it is started once in a scratch profile and asked to initialize. */
async function validateRuntime(host: AntigravityHost, runtime: AntigravityRuntime, expected: string): Promise<void> {
	const dirs = host.folders;
	const scratch = join(dirs.root, `verify-${randomUUID().slice(0, 8)}`);
	let client: AntigravityAcpClient | undefined;
	let failure: unknown;
	try {
		const profile = await prepareAntigravityProfile({ profileDirectory: scratch, tempDirectory: join(dirs.temp, "verify"), runtime });
		client = new AntigravityAcpClient(runtime, profile, scratch);
		const initialized = await client.initialize();
		if (!isValidAntigravityInitializeResult(initialized, expected)) throw new Error("Lejupielāde neidentificējas kā gaidītais Google Antigravity ACP izdevums.");
	} catch (e) {
		failure = e;
	}
	// the caller renames this server's folder next: nothing is touched before a confirmed close
	let stopped = !client;
	if (client) stopped = await client.closeAndWait().catch(() => false);
	if (!stopped && !failure) failure = new Error("Antigravity neapstājās pēc pārbaudes.");
	if (stopped) {
		await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }).catch(() => undefined);
		await sweepAntigravityTemp(join(dirs.temp, "verify")).catch(() => undefined);
	}
	if (failure) throw failure;
}

export class AntigravityAccount {
	private readonly auth: AntigravityAuthController;
	private installing: Promise<unknown> | null = null;
	private state = { installed: false, signedIn: false, version: null as string | null, at: 0 };
	private catalogRun: Promise<void> | null = null;
	private catalogFailedAt = 0;
	private notify: ((n: AntigravityNotice) => void) | null = null;
	private asking = false;

	constructor(private readonly o: AntigravityAccountOptions) {
		this.auth = new AntigravityAuthController((r) => this.signInEnded(r));
	}

	get available(): boolean {
		return antigravityInstallAvailable();
	}

	/** Install or sign-in is running. */
	get busy(): boolean {
		return this.installing !== null || this.auth.busy;
	}

	/** What the last look found, with no disk access (a look is started when it is stale). */
	peek(): { installed: boolean; signedIn: boolean; version: string | null } {
		return { installed: this.state.installed, signedIn: this.state.signedIn, version: this.state.version };
	}

	refreshIfStale(): void {
		if (Date.now() - this.state.at > STATE_MAX_AGE_MS) void this.refresh();
	}

	async refresh(): Promise<void> {
		const before = `${this.state.installed}${this.state.signedIn}`;
		this.state.at = Date.now();
		const runtime = await this.o.host.installed().catch(() => null);
		this.state = { installed: runtime !== null, signedIn: runtime !== null && (await this.o.host.signedIn()), version: runtime?.version ?? null, at: Date.now() };
		if (before !== `${this.state.installed}${this.state.signedIn}`) this.o.onChange();
	}

	/** The account's models as the server last said them; null = not read yet (or nobody is signed in). */
	async catalog(): Promise<AntigravityCatalog | null> {
		try {
			const c = JSON.parse(await readFile(this.o.host.folders.models, "utf8")) as { at: number; catalog: AntigravityCatalog };
			return c?.catalog?.models?.length ? c.catalog : null;
		} catch {
			return null;
		}
	}

	/** Reads the models from the server when the file is missing or a day old (the server is started for it, so only when someone is signed in). */
	refreshCatalogIfStale(force = false): void {
		if (this.catalogRun || !this.state.signedIn) return;
		if (!force && Date.now() - this.catalogFailedAt < CATALOG_RETRY_MS) return;
		this.catalogRun = (async () => {
			try {
				if (!force) {
					const at = JSON.parse(await readFile(this.o.host.folders.models, "utf8").catch(() => "{}")).at;
					if (typeof at === "number" && Date.now() - at < CATALOG_MAX_AGE_MS) return;
				}
				const catalog = await this.o.host.probeCatalog();
				await mkdir(this.o.host.folders.root, { recursive: true });
				await writeFile(this.o.host.folders.models, JSON.stringify({ at: Date.now(), catalog }), "utf8");
				this.o.onChange();
			} catch (e) {
				this.catalogFailedAt = Date.now();
				this.o.log?.(`models: ${(e as Error).message}`);
			} finally {
				this.catalogRun = null;
			}
		})();
	}

	/** Installs Google's server (once; a second call joins the first). */
	install(progress: (line: string) => void): Promise<AntigravityRuntime> {
		const run = installAntigravityRuntime({ root: this.o.host.folders.runtime, progress, validate: (r, v) => validateRuntime(this.o.host, r, v) });
		this.installing = run;
		return run.finally(() => {
			if (this.installing === run) this.installing = null;
		});
	}

	/**
	 * Sign in: installs the server first when it is not there, then starts Google's sign-in and reports through `notify` (the same notices the other providers
	 * send): info lines while it installs, then the link to open, then done or an error.
	 */
	async login(notify: (n: AntigravityNotice) => void): Promise<void> {
		if (this.auth.busy) this.auth.cancel();
		this.notify = notify;
		this.asking = false;
		try {
			let runtime = await this.o.host.installed();
			if (!runtime) {
				runtime = await this.install((line) => notify({ type: "info", message: line }));
				await this.refresh();
			}
			// the server running now holds the old account: it ends before a new sign-in starts
			await this.o.host.closeAll();
			const profile = await this.o.host.profileFor(runtime);
			notify({ type: "info", message: "Palaiž Google Antigravity serveri…" });
			const { url } = await this.auth.start(runtime, profile);
			if (!url) return; // the stored sign-in was good: onEnd said done
			this.asking = true;
			notify({ type: "url", url });
			notify({ type: "ask", message: `Piesakies Google lapā (tā atveras pārlūkā). Kad Google pabeidz, šeit viss notiks pats. Ja nenotiek, ielīmē adresi (http://127.0.0.1:…), uz kuru Google pārvirzīja. Saite: ${url}` });
		} catch (e) {
			this.notify = null;
			notify({ type: "error", message: (e as Error).message });
		}
	}

	private signInEnded(r: SignInEnd): void {
		const notify = this.notify;
		this.notify = null;
		this.asking = false;
		if (r.ok) {
			noteAntigravitySignedIn(this.o.host.tokenPath);
			void this.refresh().then(() => {
				this.o.onSignedIn?.();
				notify?.({ type: "done" });
				this.refreshCatalogIfStale(true);
				this.o.onChange();
			});
			return;
		}
		notify?.(r.cancelled ? { type: "info", message: r.message } : { type: "error", message: r.message });
		this.o.onChange();
	}

	/** Is a pasted answer expected (the sign-in waits for Google)? */
	get asked(): boolean {
		return this.asking;
	}

	/** The person pasted the address Google redirected to. */
	complete(callbackUrl: string): Promise<void> {
		return this.auth.complete(callbackUrl.trim());
	}

	cancel(): void {
		this.auth.cancel();
	}

	/** Forgets this app's Google sign-in: the server ends first (it keeps the account it started with and may write the token again as it exits). */
	async signOut(): Promise<void> {
		this.auth.cancel();
		await this.o.host.closeAll();
		await removeAntigravitySignIn(this.o.host.tokenPath);
		await rm(this.o.host.folders.models, { force: true }).catch(() => undefined);
		await this.refresh();
		this.o.onChange();
	}

	async dispose(): Promise<void> {
		this.auth.cancel();
		await this.o.host.closeAll();
	}

	/** The installed server, or a setup error that says what to do. */
	runtime(): Promise<AntigravityRuntime> {
		return resolveAntigravityRuntime(this.o.host.folders.runtime);
	}
}
