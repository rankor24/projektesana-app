// App settings and provider API keys. Keys are encrypted with the OS (Electron safeStorage on Windows = DPAPI), injected
// so tests run without Electron. Carried from v1 src/main/store.ts; the v1 migrations (claude.key, engine field) are dropped:
// v2 starts with a fresh data folder.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_AGENTS } from "../agent/subagents.js";
import type { AgentSpec } from "../shared/agent-types.js";
import { DEFAULT_SETTINGS, type Settings } from "../shared/types.js";

export interface Crypto {
	available(): boolean;
	encrypt(s: string): Buffer;
	decrypt(b: Buffer): string;
}

const SAFE_ID = /^[a-z0-9-]+$/;

export class AppSettings {
	constructor(
		readonly dir: string,
		readonly crypto: Crypto,
	) {
		mkdirSync(join(dir, "keys"), { recursive: true });
	}

	get(): Settings {
		const f = join(this.dir, "settings.json");
		if (!existsSync(f)) return { ...DEFAULT_SETTINGS };
		try {
			return { ...DEFAULT_SETTINGS, ...(JSON.parse(readFileSync(f, "utf8")) as Partial<Settings>) };
		} catch {
			return { ...DEFAULT_SETTINGS };
		}
	}

	set(patch: Partial<Settings>): Settings {
		const allowed: (keyof Settings)[] = ["provider", "model", "effort", "theme", "revitServerJs", "revitNode", "officeStandardPdf", "userName", "maxParallelAgents"];
		const clean: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k as keyof Settings)));
		if ("maxParallelAgents" in clean) clean.maxParallelAgents = Math.max(1, Math.min(6, Math.round(Number(clean.maxParallelAgents)) || 3));
		const s = { ...this.get(), ...clean };
		writeFileSync(join(this.dir, "settings.json"), JSON.stringify(s, null, 2), "utf8");
		return s;
	}

	/** the specialists (task 8.15): the saved list, or the shipped one until the user saves */
	agentSpecs(): { specs: AgentSpec[]; shipped: boolean } {
		const f = join(this.dir, "agents.json");
		if (!existsSync(f)) return { specs: DEFAULT_AGENTS, shipped: true };
		try {
			const j = JSON.parse(readFileSync(f, "utf8")) as AgentSpec[];
			return Array.isArray(j) ? { specs: j, shipped: false } : { specs: DEFAULT_AGENTS, shipped: true };
		} catch {
			return { specs: DEFAULT_AGENTS, shipped: true };
		}
	}

	saveAgentSpecs(specs: AgentSpec[]): void {
		writeFileSync(join(this.dir, "agents.json"), JSON.stringify(specs, null, 2), "utf8");
	}

	private keyFile(provider: string) {
		if (!SAFE_ID.test(provider)) throw new Error(`Nederīgs pakalpojums: ${provider}`);
		return join(this.dir, "keys", `${provider}.key`);
	}

	apiKey(provider: string): string | null {
		if (!this.crypto.available()) return null;
		const f = this.keyFile(provider);
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
	}

	projectsDir = () => join(this.dir, "projects");
	registryFile = () => join(this.dir, "projects.json");
	piCredentialsFile = () => join(this.dir, "pi-credentials.bin");
	modelCacheFile = () => join(this.dir, "model-cache.json");
	libraryDir = () => join(this.dir, "library");
	logsDir = () => join(this.dir, "logs");
	chatDir = () => join(this.dir, "chat");
}
