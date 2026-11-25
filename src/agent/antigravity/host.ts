// One Antigravity server process for the whole app, shared by every run: started on first use, kept for a while after the last run (a cold start unpacks
// about a gigabyte on Windows and takes tens of seconds), many sessions in it. Sessions are routed by id: a run listens to its own session's updates and
// answers its own permission requests.
//
// Adapted from OpenMausBot (Apache-2.0) server/drivers/acp/core.ts (the shared host, `session/resume` of a thread's session with the turn's MCP servers,
// the model and mode set through `session/set_config_option`) and antigravity.ts (`mode`: default / auto_edit / yolo; the model discovery on a session).
// Much smaller: one process, one profile, no pool keys and no sandbox.
import { join } from "node:path";
import {
	AntigravityAcpClient,
	AntigravitySignInRequired,
	antigravityProfileAuthenticated,
	antigravitySessionSetup,
	catalogFromSession,
	noteAntigravitySignInRequired,
	prepareAntigravityProfile,
	surveyVariants,
	sweepAntigravityTemp,
	variantOptionOf,
	modelOptionOf,
	type AntigravityCatalog,
	type AntigravityProfile,
} from "./acp.js";
import { findAntigravityRuntime, resolveAntigravityRuntime, type AntigravityRuntime } from "./runtime.js";

/** After the last run the process stays this long, then it ends by itself (and removes what it unpacked). */
const IDLE_MS = 10 * 60_000;
const VARIANT_SURVEY_MS = 15_000;

export interface HostFolders {
	/** `<appDir>\antigravity` */
	root: string;
	/** where the server is, when not the app's own install (tests stand in for it) */
	runtime?: () => Promise<AntigravityRuntime | null>;
	/** the app's own node (Electron's exe) for the browser helper; defaults to this process */
	nodePath?: string;
}

export const antigravityFolders = (root: string) => ({
	root,
	runtime: join(root, "runtime"),
	profile: join(root, "profile"),
	temp: join(root, "tmp"),
	work: join(root, "work"),
	models: join(root, "models.json"),
});

export interface SessionListener {
	update(update: Record<string, any>): void;
	/** a `session/request_permission` of this session: the answer to send */
	permission(params: Record<string, any>): Promise<{ outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } }>;
}

export interface SessionSpec {
	/** the session to continue (`session/resume`); absent or refused = a new one */
	resume?: string;
	cwd: string;
	mcpServers: unknown[];
	/** a model id of the catalog; empty = the account's default */
	model?: string;
	/** the thinking level of that model; empty = the model's default */
	variant?: string;
}

export interface OpenedSession {
	sessionId: string;
	resumed: boolean;
}

export class AntigravityHost {
	private readonly dirs;
	private started: Promise<{ client: AntigravityAcpClient; init: any; profile: AntigravityProfile; runtime: AntigravityRuntime }> | null = null;
	private listeners = new Map<string, SessionListener>();
	private active = 0;
	private idle: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly cfg: HostFolders & { log?: (line: string) => void }) {
		this.dirs = antigravityFolders(cfg.root);
	}

	get folders() {
		return this.dirs;
	}

	private log(line: string) {
		this.cfg.log?.(line);
	}

	get tokenPath(): string {
		return join(this.dirs.profile, "antigravity-acp", "acp_token.json");
	}

	async installed(): Promise<AntigravityRuntime | null> {
		return this.cfg.runtime ? this.cfg.runtime() : findAntigravityRuntime(this.dirs.runtime);
	}

	async signedIn(): Promise<boolean> {
		return antigravityProfileAuthenticated(this.tokenPath);
	}

	async profileFor(runtime: AntigravityRuntime): Promise<AntigravityProfile> {
		return prepareAntigravityProfile({ profileDirectory: this.dirs.profile, tempDirectory: this.dirs.temp, runtime, ...(this.cfg.nodePath ? { nodePath: this.cfg.nodePath } : {}) });
	}

	/** The running process, started if there is none: initialised and signed in with the stored Google sign-in. */
	private async client() {
		if (this.started) {
			const s = await this.started.catch(() => null);
			if (s && !s.client.isClosed) return s;
			this.started = null;
		}
		const start = (async () => {
			const runtime = (await this.installed()) ?? (await resolveAntigravityRuntime(this.dirs.runtime));
			const profile = await this.profileFor(runtime);
			if (!(await antigravityProfileAuthenticated(profile.tokenPath))) throw new AntigravitySignInRequired();
			// what dead launches left in the app's temp folder (a forced stop skips the runtime's own cleanup)
			void sweepAntigravityTemp(profile.tempDirectory).catch(() => undefined);
			const client = new AntigravityAcpClient(runtime, profile, this.dirs.profile);
			client.onNotification = (method, params) => {
				if (method !== "session/update") return;
				if (params?._meta?.isReplay === true) return;
				this.listeners.get(params?.sessionId)?.update(params.update ?? {});
			};
			client.onRequest = async (method, params) => {
				if (method === "session/request_permission") {
					const l = this.listeners.get(params?.sessionId);
					return { result: l ? await l.permission(params) : { outcome: { outcome: "cancelled" } } };
				}
				return { error: { code: -32601, message: "method not found" } };
			};
			client.onExit = (error) => {
				this.log(`antigravity: ${error.message}`);
				this.started = null;
			};
			try {
				const init = await client.initialize();
				await client.request("authenticate", { methodId: "oauth-personal" }, 60_000);
				return { client, init, profile, runtime };
			} catch (e) {
				if (e instanceof AntigravitySignInRequired) await noteAntigravitySignInRequired(profile.tokenPath);
				client.close();
				throw e;
			}
		})();
		this.started = start;
		start.catch(() => {
			if (this.started === start) this.started = null;
		});
		return start;
	}

	private touch(delta: 1 | -1) {
		this.active += delta;
		if (this.idle) clearTimeout(this.idle);
		this.idle = null;
		if (this.active <= 0) {
			this.active = 0;
			this.idle = setTimeout(() => void this.closeAll(), IDLE_MS);
			this.idle.unref?.();
		}
	}

	/** Opens (or resumes) a session, with the model and the thinking level set and the permission mode on `default`: the server asks before anything beyond reading. */
	async openSession(spec: SessionSpec, listener: SessionListener): Promise<OpenedSession> {
		this.touch(1);
		let opened: string | undefined;
		try {
			const { client, init } = await this.client();
			const setup = antigravitySessionSetup(init);
			// the server's own writing, running and browsing tools are off; a runtime that refuses that setup gets the minimal one (the permission handler of run.ts still refuses them)
			const open = async (method: string, params: Record<string, unknown>) => {
				try {
					return await client.request(method, { ...params, ...setup }, 120_000);
				} catch (e) {
					// a refused resume (the session is gone) fails the same way again, so only a session/new falls back
					if (method !== "session/new" || e instanceof AntigravitySignInRequired) throw e;
					this.log(`antigravity: session/new with the server's own tools off failed (${(e as Error).message}); trying without`);
					return client.request(method, { ...params, ...antigravitySessionSetup(init, true) }, 120_000);
				}
			};
			let session: any = null;
			let resumed = false;
			if (spec.resume) {
				try {
					session = await open("session/resume", { sessionId: spec.resume, cwd: spec.cwd, mcpServers: spec.mcpServers });
					session = { ...session, sessionId: session?.sessionId ?? spec.resume };
					resumed = true;
				} catch (e) {
					// a session the server no longer has (its profile was cleared): a new one, the caller seeds it from the transcript
					this.log(`antigravity: session/resume refused (${(e as Error).message}); a new session`);
				}
			}
			if (!session) session = await open("session/new", { cwd: spec.cwd, mcpServers: spec.mcpServers });
			const sessionId: string = session?.sessionId;
			if (!sessionId) throw new Error("Antigravity did not return a session.");
			this.listeners.set(sessionId, listener);
			opened = sessionId;
			let options = session;
			const set = async (configId: string, value: string) => {
				options = await client.request("session/set_config_option", { sessionId, configId, value }, 60_000);
			};
			const model = modelOptionOf(options);
			if (spec.model && model && model.currentValue !== spec.model) {
				if (!model.options.some((o) => o.id === spec.model)) throw new Error(`Antigravity: modelis ${spec.model} šim kontam nav pieejams. Izvēlies citu modeli Iestatījumos.`);
				await set("model", spec.model);
			}
			const variant = variantOptionOf(options);
			if (spec.variant && variant && variant.currentValue !== spec.variant && variant.options.some((o) => o.id === spec.variant)) await set(variant.configId, spec.variant);
			const mode = (Array.isArray(options?.configOptions) ? options.configOptions : []).find((o: any) => o?.id === "mode");
			if (mode && mode.currentValue !== "default") await set("mode", "default");
			return { sessionId, resumed };
		} catch (e) {
			if (opened) this.listeners.delete(opened);
			this.touch(-1);
			throw e;
		}
	}

	/** One prompt to the end. Resolves with the server's answer (its stopReason and, when it says, the usage); a cancel is a notification, the prompt then ends by itself. */
	async prompt(sessionId: string, blocks: unknown[], signal: AbortSignal): Promise<{ stopReason?: string; usage?: Record<string, unknown>; _meta?: Record<string, unknown> }> {
		const { client } = await this.client();
		const cancel = () => client.notify("session/cancel", { sessionId });
		if (signal.aborted) cancel();
		else signal.addEventListener("abort", cancel, { once: true });
		try {
			return await client.request("session/prompt", { sessionId, prompt: blocks }, 0);
		} finally {
			signal.removeEventListener("abort", cancel);
		}
	}

	/** The run is over: its session stays in the server (the thread resumes it), its listener goes. */
	release(sessionId: string) {
		if (this.listeners.delete(sessionId)) this.touch(-1);
	}

	/** The account's models, read from a session on the shared process (the server names them after the sign-in). */
	async probeCatalog(): Promise<AntigravityCatalog> {
		this.touch(1);
		try {
			const { client, init } = await this.client();
			const session = await client.request("session/new", { cwd: this.dirs.work, mcpServers: [], ...antigravitySessionSetup(init) }, 120_000);
			const catalog = catalogFromSession(session);
			if (!catalog) throw new Error("Antigravity did not return a model catalog for this Google account.");
			return await surveyVariants((m, p) => client.request(m, p, VARIANT_SURVEY_MS), session, catalog, VARIANT_SURVEY_MS);
		} finally {
			this.touch(-1);
		}
	}

	/** Ends the process (idle, sign-out, quit) and waits until it has gone, so a file it held can be removed. */
	async closeAll(): Promise<void> {
		if (this.idle) clearTimeout(this.idle);
		this.idle = null;
		const started = this.started;
		this.started = null;
		this.listeners.clear();
		this.active = 0;
		if (!started) return;
		const s = await started.catch(() => null);
		if (s) await s.client.closeAndWait().catch(() => undefined);
	}
}
