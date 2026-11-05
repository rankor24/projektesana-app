// App settings and provider API keys. Keys are encrypted with the OS (Electron safeStorage, injected so tests run without Electron).
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type Settings } from "../shared/types.js";

export interface Crypto {
	available(): boolean;
	encrypt(s: string): Buffer;
	decrypt(b: Buffer): string;
}

const SAFE_ID = /^[a-z0-9-]+$/;

export class Store {
	constructor(
		private dir: string,
		readonly crypto: Crypto,
	) {
		mkdirSync(join(dir, "keys"), { recursive: true });
	}
	settings(): Settings {
		const f = join(this.dir, "settings.json");
		if (!existsSync(f)) return { ...DEFAULT_SETTINGS };
		try {
			const raw = JSON.parse(readFileSync(f, "utf8")) as Partial<Settings> & { engine?: string };
			// settings from the first build had engine "claude"|"codex" and no provider
			const provider = raw.provider ?? (raw.engine === "codex" ? "openai-codex" : DEFAULT_SETTINGS.provider);
			return { ...DEFAULT_SETTINGS, ...raw, provider };
		} catch {
			return { ...DEFAULT_SETTINGS };
		}
	}
	saveSettings(patch: Partial<Settings>): Settings {
		const s = { ...this.settings(), ...patch };
		writeFileSync(join(this.dir, "settings.json"), JSON.stringify(s, null, 2), "utf8");
		return s;
	}
	private keyFile(provider: string) {
		if (!SAFE_ID.test(provider)) throw new Error(`Nederīgs pakalpojums: ${provider}`);
		return join(this.dir, "keys", `${provider}.key`);
	}
	apiKey(provider: string): string | null {
		if (!this.crypto.available()) return null;
		let f = this.keyFile(provider);
		// the first build kept the Claude key as claude.key
		if (!existsSync(f) && provider === "anthropic" && existsSync(join(this.dir, "claude.key"))) f = join(this.dir, "claude.key");
		if (!existsSync(f)) return null;
		try {
			return this.crypto.decrypt(readFileSync(f));
		} catch {
			return null;
		}
	}
	setApiKey(provider: string, key: string): void {
		if (!this.crypto.available()) throw new Error("OS šifrēšana nav pieejama; atslēgu nevar droši saglabāt.");
		if (!key.trim()) throw new Error("Atslēga ir tukša.");
		writeFileSync(this.keyFile(provider), this.crypto.encrypt(key.trim()));
	}
	clearApiKey(provider: string): void {
		const f = this.keyFile(provider);
		if (existsSync(f)) unlinkSync(f);
		if (provider === "anthropic" && existsSync(join(this.dir, "claude.key"))) unlinkSync(join(this.dir, "claude.key"));
	}
	registryFile(): string {
		return join(this.dir, "projects.json");
	}
	/** pi OAuth tokens (ChatGPT, SuperGrok), encrypted by agent-pi with the same OS encryption */
	piCredentialsFile(): string {
		return join(this.dir, "pi-credentials.bin");
	}
	modelCacheFile(): string {
		return join(this.dir, "model-cache.json");
	}
	libraryDir(): string {
		return join(this.dir, "library");
	}
	logsDir(): string {
		return join(this.dir, "logs");
	}
}
