// The agent as the main process runs it: one conversation per project, one run at a time, the approval gate, the Fokuss.
// No Electron imports: the runtime, the settings and the event sink are injected.
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentStatus, FocusItem } from "../shared/api.js";
import type { RunEvent, Settings } from "../shared/types.js";
import { focusText } from "./focus.js";
import { isPiProvider, piAuthState, piProviderInfo, runPi, type McpLaunchSpec, type PiEffort, type PiRuntime } from "./pi/index.js";
import { SYSTEM_PROMPT, withEarlier } from "./prompt.js";
import { ctxEnv, type ToolCtx } from "./tools/context.js";
import { allTools, appLevels } from "./tools/defs.js";
import { Gate, makeLevelOf, offered, type ConfirmRequest, type Level } from "./tools/levels.js";

export interface ToolServer extends McpLaunchSpec {
	/** every tool name the server may list; the gate's level table filters what is offered */
	tools: readonly string[];
	levels: Record<string, Level>;
}

export interface SessionDeps {
	runtime: () => Promise<PiRuntime>;
	settings: () => Settings;
	/** how to start the app's tools server with a given context */
	toolsServer: (env: Record<string, string>) => McpLaunchSpec;
	/** the Revit MCP server, when configured; null = not connected */
	revit: () => ToolServer | null;
	ctx: Omit<ToolCtx, "projectId" | "runDir">;
	runsDir: string;
	chatDir: string;
	emit: (runId: string, event: RunEvent) => void;
}

interface Conversation {
	key: string;
	messages: AgentMessage[];
}

export class AgentSession {
	private conversations = new Map<string, Conversation>();
	private running: { id: string; abort: AbortController } | null = null;
	private confirms = new Map<string, (ok: boolean) => void>();
	private n = 0;

	constructor(private d: SessionDeps) {}

	async status(): Promise<AgentStatus> {
		const s = this.d.settings();
		const revit = this.d.revit() ? "savienots" : s.revitServerJs ? "nav savienojuma" : "nav konfigurēts";
		if (!isPiProvider(s.provider)) return { provider: s.provider, providerLabel: s.provider, model: s.model, signedIn: false, reason: `nezināms pakalpojums: ${s.provider}`, revit };
		const info = piProviderInfo(s.provider);
		try {
			const rt = await this.d.runtime();
			const auth = await piAuthState(rt, s.provider);
			return { provider: s.provider, providerLabel: info.label, model: s.model || "(noklusējums)", signedIn: auth.configured, reason: auth.configured ? `${auth.method ?? ""}` : "nav pieslēgts", revit };
		} catch (e) {
			return { provider: s.provider, providerLabel: info.label, model: s.model, signedIn: false, reason: `nav pieslēgts: ${(e as Error).message}`, revit };
		}
	}

	private chatFile(projectId: string | null) {
		mkdirSync(this.d.chatDir, { recursive: true });
		return join(this.d.chatDir, `${projectId ?? "_"}.jsonl`);
	}

	history(projectId: string | null): { role: "user" | "assistant"; text: string; at: string }[] {
		const f = this.chatFile(projectId);
		if (!existsSync(f)) return [];
		const out: { role: "user" | "assistant"; text: string; at: string }[] = [];
		for (const line of readFileSync(f, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				out.push(JSON.parse(line));
			} catch {
				// a torn line is skipped
			}
		}
		return out;
	}

	private remember(projectId: string | null, role: "user" | "assistant", text: string) {
		if (text.trim()) appendFileSync(this.chatFile(projectId), JSON.stringify({ role, text, at: new Date().toISOString() }) + "\n", "utf8");
	}

	/** Starts a run; events arrive through `emit`. Refuses while another run is going. */
	send(projectId: string | null, text: string, focus: FocusItem[]): { runId: string } {
		if (this.running) throw new Error("Aģents jau strādā. Aptur vai pagaidi.");
		if (!text.trim()) throw new Error("Tukšs ziņojums.");
		const runId = `r${Date.now().toString(36)}${++this.n}`;
		const abort = new AbortController();
		this.running = { id: runId, abort };
		void this.run(runId, projectId, text, focus, abort.signal).finally(() => {
			this.running = null;
			for (const [, r] of this.confirms) r(false);
			this.confirms.clear();
		});
		return { runId };
	}

	stop() {
		this.running?.abort.abort();
	}

	confirm(id: string, allow: boolean) {
		const r = this.confirms.get(id);
		if (!r) throw new Error("Šis apstiprinājums vairs negaida.");
		this.confirms.delete(id);
		r(allow);
	}

	private async run(runId: string, projectId: string | null, text: string, focus: FocusItem[], signal: AbortSignal) {
		const emit = (e: RunEvent) => this.d.emit(runId, e);
		let answer = "";
		try {
			const s = this.d.settings();
			const runDir = join(this.d.runsDir, runId);
			mkdirSync(runDir, { recursive: true });
			writeFileSync(join(runDir, "focus.json"), JSON.stringify(focus), "utf8");
			this.remember(projectId, "user", text);

			const env = ctxEnv({ ...this.d.ctx, projectId, runDir });
			const appTools = allTools().map((t) => t.name);
			const app = appLevels();
			const revit = this.d.revit();
			const levelOf = makeLevelOf(app, revit?.levels ?? {});
			const mcp: Record<string, McpLaunchSpec & { allow: readonly string[] }> = { "projektesana-tools": { ...this.d.toolsServer(env), allow: offered(appTools, levelOf) } };
			if (revit) mcp["revit"] = { ...revit, allow: offered(revit.tools, levelOf) };

			const gate = new Gate(levelOf, (req: ConfirmRequest) => {
				return new Promise<boolean>((resolve) => {
					if (signal.aborted) return resolve(false);
					this.confirms.set(req.id, resolve);
					emit({ type: "confirm", id: req.id, tool: req.batch.map((b) => b.tool).join(", "), batch: JSON.stringify(req.batch).slice(0, 4000) });
				});
			});

			const key = `${s.provider}/${s.model}`;
			const conv = this.conversations.get(projectId ?? "_");
			const history = conv && conv.key === key ? conv.messages : [];
			const system = history.length ? SYSTEM_PROMPT : withEarlier(SYSTEM_PROMPT, this.history(projectId).slice(-11, -1));
			const rt = await this.d.runtime();
			await runPi({
				runtime: rt,
				provider: s.provider,
				modelId: s.model,
				effort: (s.effort || undefined) as PiEffort | undefined,
				prompt: `${focusText(focus)}\n\n${text}`,
				systemPrompt: system,
				mcp,
				signal,
				beforeToolCall: gate.before,
				history,
				onMessages: (messages) => this.conversations.set(projectId ?? "_", { key, messages }),
				onEvent: (e) => {
					if (e.type === "done") answer = e.text;
					emit(e);
				},
			});
		} catch (e) {
			emit({ type: "error", engine: "pi", message: (e as Error).message });
		} finally {
			this.remember(projectId, "assistant", answer);
		}
	}

	/** Forgets the in-memory conversation (new topic, or the model changed). The transcript stays. */
	reset(projectId: string | null) {
		this.conversations.delete(projectId ?? "_");
	}
}
