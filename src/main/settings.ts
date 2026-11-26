// App settings and provider API keys. Keys are encrypted with the OS (Electron safeStorage on Windows = DPAPI), injected
// so tests run without Electron. Carried from v1 src/main/store.ts; the v1 migrations (claude.key, engine field) are dropped:
// v2 starts with a fresh data folder.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LIMITS, clampLimits } from "../core/messages.js";
import { readJson, writeAtomic } from "../core/safe-file.js";
import { DEFAULT_AGENTS } from "../agent/subagents.js";
import { isKnownProvider } from "../agent/failover/plan.js";
import type { AgentSpec } from "../shared/agent-types.js";
import { DEFAULT_DEPARTMENTS, type Department } from "../shared/departments.js";
import type { Limits } from "../shared/thread-types.js";
import { DEFAULT_MAX_TURNS, DEFAULT_MAX_TURNS_SUB, DEFAULT_SETTINGS, clampTurns, type Settings } from "../shared/types.js";

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
		const saved = readJson<Partial<Settings>>(join(this.dir, "settings.json"), (v) => !!v && typeof v === "object" && !Array.isArray(v));
		if (!saved) return { ...DEFAULT_SETTINGS };
		// a file from before the limits, or one edited by hand, still gives limits inside their ranges
		return { ...DEFAULT_SETTINGS, ...saved, maxTurns: clampTurns(saved.maxTurns, DEFAULT_MAX_TURNS), maxTurnsSub: clampTurns(saved.maxTurnsSub, DEFAULT_MAX_TURNS_SUB), limits: clampLimits(saved.limits, DEFAULT_LIMITS) };
	}

	set(patch: Partial<Settings>): Settings {
		const allowed: (keyof Settings)[] = ["provider", "model", "effort", "theme", "language", "revitServerJs", "revitNode", "officeStandardPdf", "userName", "maxParallelAgents", "maxTurns", "maxTurnsSub", "limits", "backup", "automaticRecovery", "revitDialogsOnScreen", "teamFolder"];
		const clean: Record<string, unknown> = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k as keyof Settings)));
		if ("language" in clean && clean.language !== "lv" && clean.language !== "en") delete clean.language;
		if ("maxParallelAgents" in clean) clean.maxParallelAgents = Math.max(1, Math.min(6, Math.round(Number(clean.maxParallelAgents)) || 3));
		if ("maxTurns" in clean) clean.maxTurns = clampTurns(clean.maxTurns, DEFAULT_MAX_TURNS);
		if ("maxTurnsSub" in clean) clean.maxTurnsSub = clampTurns(clean.maxTurnsSub, DEFAULT_MAX_TURNS_SUB);
		// the app-wide backup: a provider this app knows and a model of it (empty = the provider's default), or null for none
		if ("backup" in clean) {
			const b = clean.backup as { provider?: unknown; model?: unknown } | null | undefined;
			if (b === null || b === undefined) clean.backup = null;
			else if (typeof b.provider === "string" && isKnownProvider(b.provider.trim()) && (b.model === undefined || typeof b.model === "string")) clean.backup = { provider: b.provider.trim(), model: (b.model as string | undefined)?.trim() ?? "" };
			else throw new Error("Rezerves AI: nezināms pakalpojums vai modelis.");
		}
		if ("automaticRecovery" in clean) clean.automaticRecovery = clean.automaticRecovery === true;
		if ("revitDialogsOnScreen" in clean) clean.revitDialogsOnScreen = clean.revitDialogsOnScreen !== false;
		if ("teamFolder" in clean) clean.teamFolder = typeof clean.teamFolder === "string" && clean.teamFolder.trim() ? clean.teamFolder.trim() : null;
		// a patch may name only some limits: the rest stay as they are
		if ("limits" in clean) clean.limits = clampLimits(clean.limits as Partial<Limits>, this.get().limits);
		const s = { ...this.get(), ...clean };
		writeAtomic(join(this.dir, "settings.json"), JSON.stringify(s, null, 2));
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

	/** the departments (nodaļas), ordered: the saved list, or the plan's eight until the user changes them. Kept apart from agents.json so an agent list saved from an older
	 *  window never loses them; an agent holds only the id of its department (`AgentSpec.department`). */
	departments(): { departments: Department[]; shipped: boolean } {
		const f = join(this.dir, "departments.json");
		if (!existsSync(f)) return { departments: DEFAULT_DEPARTMENTS, shipped: true };
		try {
			const j = JSON.parse(readFileSync(f, "utf8")) as { departments?: unknown };
			const list = Array.isArray(j.departments) ? (j.departments as Partial<Department>[]).filter((d) => typeof d?.id === "string" && typeof d.name === "string") : null;
			return list ? { departments: list as Department[], shipped: false } : { departments: DEFAULT_DEPARTMENTS, shipped: true };
		} catch {
			return { departments: DEFAULT_DEPARTMENTS, shipped: true };
		}
	}

	saveDepartments(departments: Department[]): void {
		writeAtomic(join(this.dir, "departments.json"), JSON.stringify({ departments }, null, 2));
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
