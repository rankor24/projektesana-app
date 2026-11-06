// pi credential store: OAuth tokens in one file the app owns, API keys from the app's own key store.
//
// Borrowed from BIM Crew apps/server/src/runtime/credentials.ts (FileCredentialStore): the CredentialStore
// contract, per-provider write lock, write-to-temp + rename. Differences: the file can be sealed with the
// app's OS encryption (Windows DPAPI via Electron safeStorage), and API keys come from a callback instead
// of a settings file.
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

/** OS-level encryption, injected by the app (same shape as the app's Store `Crypto`). */
export interface Seal {
	available(): boolean;
	encrypt(plain: string): Buffer;
	decrypt(data: Buffer): string;
}

export interface PiCredentialOptions {
	/** Where signed-in tokens are kept. */
	path: string;
	/** When given, the file is encrypted. If encryption is unavailable, tokens are not stored at all. */
	seal?: Seal;
	/** An API key the app already holds for this provider (the Claude key), or null. */
	apiKey?: (providerId: string) => string | null | Promise<string | null>;
	/**
	 * Providers whose subscription OAuth must not be used from a third-party app.
	 * Anthropic forbids routing Claude.ai tokens through other apps: API key only.
	 */
	blockOAuth?: ReadonlySet<string>;
	/** Providers whose key comes from `apiKey`; they are listed as configured when a key exists. */
	keyProviders?: readonly string[];
}

export const DEFAULT_BLOCKED_OAUTH: ReadonlySet<string> = new Set(["anthropic"]);

type CredentialFile = Record<string, Credential>;

export class PiCredentialStore implements CredentialStore {
	private readonly locks = new Map<string, Promise<unknown>>();
	private readonly blocked: ReadonlySet<string>;

	constructor(private readonly opts: PiCredentialOptions) {
		this.blocked = opts.blockOAuth ?? DEFAULT_BLOCKED_OAUTH;
	}

	async read(providerId: string, _options?: AuthOperationOptions): Promise<Credential | undefined> {
		const file = await this.load();
		const stored = file[providerId];
		if (stored && !(stored.type === "oauth" && this.blocked.has(providerId))) return stored;
		return await this.keyCredential(providerId);
	}

	async list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		const file = await this.load();
		const out = new Map<string, CredentialInfo>();
		for (const [providerId, cred] of Object.entries(file)) {
			if (cred.type === "oauth" && this.blocked.has(providerId)) continue;
			out.set(providerId, { providerId, type: cred.type });
		}
		for (const providerId of this.opts.keyProviders ?? ["anthropic"]) {
			if (!out.has(providerId) && (await this.keyCredential(providerId))) out.set(providerId, { providerId, type: "api_key" });
		}
		return [...out.values()];
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		_options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		return await this.withLock(providerId, async () => {
			const file = await this.load();
			const next = await fn(file[providerId] ?? (await this.keyCredential(providerId)));
			if (next === undefined) return file[providerId];
			if (next.type === "oauth" && this.blocked.has(providerId)) {
				throw new Error(`${providerId}: subscription sign-in is not permitted for third-party apps. Use an API key.`);
			}
			// A key the app holds stays where the app keeps it; only OAuth tokens and keys pi was given are written here.
			file[providerId] = next;
			await this.save(file);
			return next;
		});
	}

	async delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
		await this.withLock(providerId, async () => {
			const file = await this.load();
			if (!(providerId in file)) return;
			delete file[providerId];
			await this.save(file);
		});
	}

	private async keyCredential(providerId: string): Promise<Credential | undefined> {
		const key = await this.opts.apiKey?.(providerId);
		return key ? { type: "api_key", key } : undefined;
	}

	private async withLock<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
		const previous = this.locks.get(providerId) ?? Promise.resolve();
		const run = previous.then(fn, fn);
		this.locks.set(providerId, run.catch(() => undefined));
		return await run;
	}

	private async load(): Promise<CredentialFile> {
		const { path, seal } = this.opts;
		if (!existsSync(path)) return {};
		try {
			const raw = await readFile(path);
			if (!seal) return JSON.parse(raw.toString("utf8")) as CredentialFile;
			if (!seal.available()) return {};
			return JSON.parse(seal.decrypt(raw)) as CredentialFile;
		} catch (e) {
			// A file that cannot be read (changed user, damaged) means "not signed in", not a crash; signing in again rewrites it.
			console.warn(`[agent-pi] credential file unreadable (${path}): ${(e as Error).message}`);
			return {};
		}
	}

	private async save(file: CredentialFile): Promise<void> {
		const { path, seal } = this.opts;
		if (seal && !seal.available()) throw new Error("Encryption is not available; refusing to store sign-in tokens in plain text.");
		await mkdir(dirname(path), { recursive: true });
		const body = JSON.stringify(file, null, 2);
		const tmp = `${path}.${process.pid}.tmp`;
		await writeFile(tmp, seal ? seal.encrypt(body) : body, seal ? undefined : "utf8");
		await rename(tmp, path);
	}
}
