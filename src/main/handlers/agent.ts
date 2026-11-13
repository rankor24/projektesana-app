// App, settings, dialog and agent handlers (sign-in, chat, confirmations).
import { join } from "node:path";
import type { AgentSession } from "../../agent/session.js";
import { readUsage, summarizeUsage } from "../../agent/usage.js";
import type { ActivityLog } from "../activity.js";
import type { PiRuntime } from "../../agent/pi/index.js";
import type { EventName, EventSpec, Handlers, ProviderRow } from "../../shared/api.js";
import type { AppSettings } from "../settings.js";

export interface CoreDeps {
	version: string;
	settings: AppSettings;
	/** data folder shipped with the app (rules.json, law snapshots) */
	dataDir: string;
	session: AgentSession;
	/** what the agent is doing, in readable lines; absent in tests that do not look at it */
	activity?: ActivityLog;
	pi: () => Promise<PiRuntime>;
	emit<E extends EventName>(event: E, payload: EventSpec[E]): void;
	pickFolder(title: string): Promise<string | null>;
	pickFile(title: string, extensions: string[]): Promise<string | null>;
	openPath(p: string): Promise<string>;
	openUrl(url: string): void;
}

type K = "usage.summary" | "app.info" | "settings.get" | "settings.set" | "dialog.pickFolder" | "dialog.pickFile" | `agent.${string}` | "activity.recent";

export function coreHandlers(d: CoreDeps): Pick<Handlers, Extract<keyof Handlers, K>> {
	// one sign-in at a time; a pasted answer goes to the prompt that is waiting
	let login: { abort: AbortController; answer: ((s: string) => void) | null } | null = null;

	return {
		"app.info": () => ({ version: d.version, dataDir: d.settings.dir, platform: process.platform }),
		"settings.get": () => d.settings.get(),
		"settings.set": (patch) => {
			const s = d.settings.set(patch);
			d.emit("data.changed", { projectId: null, what: ["settings"] });
			return s;
		},
		"dialog.pickFolder": (title) => d.pickFolder(title),
		"dialog.pickFile": (title, ext) => d.pickFile(title, ext),

		"usage.summary": () => summarizeUsage(readUsage(join(d.settings.dir, "usage.jsonl"))),
		"agent.status": () => d.session.status(),
		"agent.providers": async () => {
			const m = await import("../../agent/pi/index.js");
			const rt = await d.pi();
			const rows: ProviderRow[] = [];
			for (const p of m.PI_PROVIDERS) {
				const auth = await m.piAuthState(rt, p.id);
				const models = m.listPiModels(rt, p.id).map((x) => ({ id: x.id, name: x.name, legacy: x.legacy, efforts: x.efforts, defaultEffort: x.defaultEffort }));
				rows.push({ id: p.id, label: p.label, auth: p.auth, configured: auth.configured, method: auth.method, keyUrl: p.keyUrl, models });
			}
			return rows;
		},
		"agent.setKey": (provider, key) => {
			d.settings.setApiKey(provider, key);
			d.emit("data.changed", { projectId: null, what: ["agent"] });
		},
		"agent.clearKey": (provider) => {
			d.settings.clearApiKey(provider);
			d.emit("data.changed", { projectId: null, what: ["agent"] });
		},
		"agent.login": async (provider) => {
			const m = await import("../../agent/pi/index.js");
			if (!m.isPiProvider(provider)) throw new Error(`Nezināms pakalpojums: ${provider}`);
			login?.abort.abort();
			const abort = new AbortController();
			const current = { abort, answer: null as ((s: string) => void) | null };
			login = current;
			const rt = await d.pi();
			void m
				.loginProvider(
					rt.models,
					provider,
					{
						openUrl: d.openUrl,
						notify: (n) => d.emit("agent.login", { provider, ...n } as EventSpec["agent.login"]),
						ask: (message, signal) =>
							new Promise<string>((resolve, reject) => {
								current.answer = resolve;
								d.emit("agent.login", { provider, type: "ask", message });
								signal?.addEventListener("abort", () => reject(new Error("Pieslēgšanās atcelta")), { once: true });
							}),
					},
					abort.signal,
				)
				.then(() => d.emit("agent.login", { provider, type: "done" }))
				.catch((e: Error) => d.emit("agent.login", { provider, type: "error", message: e.message }))
				.finally(() => {
					if (login === current) login = null;
					d.emit("data.changed", { projectId: null, what: ["agent"] });
				});
		},
		"agent.loginAnswer": (text) => {
			if (!login?.answer) throw new Error("Pieslēgšanās šobrīd neko negaida.");
			login.answer(text);
			login.answer = null;
		},
		"agent.logout": async (provider) => {
			const m = await import("../../agent/pi/index.js");
			if (!m.isPiProvider(provider)) throw new Error(`Nezināms pakalpojums: ${provider}`);
			await m.logoutProvider((await d.pi()).models, provider);
			d.emit("data.changed", { projectId: null, what: ["agent"] });
		},
		"agent.send": async (projectId, text, focus, attachments) => {
			// the activity log titles the run with what was asked; the run's first event may come before send returns
			d.activity?.begin(projectId, text);
			try {
				const r = await d.session.send(projectId, text, focus, attachments ?? []);
				d.activity?.bind(r.runId);
				return r;
			} catch (e) {
				d.activity?.cancel();
				throw e;
			}
		},
		"agent.stop": () => d.session.stop(),
		"agent.confirm": (id, allow) => {
			d.session.confirm(id, allow);
			d.activity?.confirmed(id, allow);
		},
		"activity.recent": () => d.activity?.recent() ?? [],
		"agent.history": (projectId) => d.session.history(projectId),
		"agent.reset": (projectId) => d.session.reset(projectId),
		"agent.context": (projectId, draft) => d.session.context(projectId, draft),
		"agent.measureFile": (attachment) => d.session.measureFile(attachment),
		"agent.compact": (projectId) => d.session.compactNow(projectId),
	};
}
