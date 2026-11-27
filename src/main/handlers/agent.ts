// App, settings, dialog and agent handlers (sign-in, chat, confirmations).
import { join } from "node:path";
import type { ClaudeAccount } from "../../agent/claude/login.js";
import { CLAUDE_SUB, isClaudeSub } from "../../agent/claude/provider.js";
import type { AntigravityAccount } from "../../agent/antigravity/account.js";
import { ANTIGRAVITY, ANTIGRAVITY_LABEL, isAntigravity } from "../../agent/antigravity/provider.js";
import type { AgentSession } from "../../agent/session.js";
import { readUsage, summarizeUsage } from "../../agent/usage.js";
import type { ActivityLog } from "../activity.js";
import type { PiRuntime } from "../../agent/pi/index.js";
import type { EventName, EventSpec, Handlers, ProviderRow } from "../../shared/api.js";
import type { AppSettings } from "../settings.js";
import { titled } from "./threads.js";

export interface CoreDeps {
	version: string;
	settings: AppSettings;
	/** data folder shipped with the app (rules.json, law snapshots) */
	dataDir: string;
	session: AgentSession;
	/** what the agent is doing, in readable lines; absent in tests that do not look at it */
	activity?: ActivityLog;
	pi: () => Promise<PiRuntime>;
	/** the Claude subscription's login (Sign in by `claude auth login`); absent in tests and where Claude is not built in */
	claude?: ClaudeAccount;
	/** Google Antigravity: install of its server, Google sign-in and the models of the account; absent in tests and where it is not built in */
	antigravity?: AntigravityAccount;
	emit<E extends EventName>(event: E, payload: EventSpec[E]): void;
	pickFolder(title: string): Promise<string | null>;
	pickFile(title: string, extensions: string[]): Promise<string | null>;
	capture(rect: { x: number; y: number; width: number; height: number }): Promise<Uint8Array>;
	openPath(p: string): Promise<string>;
	openUrl(url: string): void;
}

type K = "usage.summary" | "app.info" | "settings.get" | "settings.set" | "claude.authStatus" | "dialog.pickFolder" | "dialog.pickFile" | "screen.capture" | `agent.${string}` | "queue.restored" | "queue.resumeInterrupted" | "queue.discardInterrupted" | "activity.recent";

export function coreHandlers(d: CoreDeps): Pick<Handlers, Extract<keyof Handlers, K>> {
	// one sign-in at a time; a pasted answer goes to the prompt that is waiting
	let login: { abort: AbortController; answer: ((s: string) => void) | null } | null = null;
	// the Claude subscription's sign-in runs the unmodified `claude auth login` (src/agent/claude/login.ts) and reports through the same
	// agent.login notices as the other providers: url, then ask (the code), then done or error
	let claudeAsking = false;
	let claudeCancelling = false;
	const claudeNotice = (n: { type: "url"; url: string } | { type: "ask"; message: string } | { type: "info"; message: string } | { type: "done" } | { type: "error"; message: string }) =>
		d.emit("agent.login", { provider: CLAUDE_SUB, ...n } as EventSpec["agent.login"]);
	const claudeLogin = () => {
		const claude = d.claude;
		if (!claude) throw new Error("Claude pieslēgšanās šeit nav pieejama.");
		claudeAsking = false;
		claudeCancelling = false;
		void claude
			.start((r) => {
				claudeAsking = false;
				// a finished sign-in ends a "signed out" hold on the provider (failover/holds.ts), as the other providers' sign-in does
				if (r.ok) (d.session.signedIn(CLAUDE_SUB), claudeNotice({ type: "done" }));
				else claudeNotice(claudeCancelling ? { type: "info", message: r.message } : { type: "error", message: r.message });
				d.emit("data.changed", { projectId: null, what: ["agent"] });
			})
			.then(({ url }) => {
				if (!url) return; // already signed in: onEnd says done
				claudeAsking = true;
				claudeNotice({ type: "url", url });
				claudeNotice({ type: "ask", message: `Ielogojies Anthropic lapā un ielīmē kodu, ko tā parāda (ja pārlūks pats pabeidza, kods nav vajadzīgs). Saite: ${url}` });
			})
			.catch((e: Error) => claudeNotice({ type: "error", message: e.message }));
	};
	// Google Antigravity signs in here too: the app installs Google's own server once, then runs its `authenticate`; the notices are the other providers' (info while it installs, url, ask, done)
	const antigravityLogin = () => {
		const a = d.antigravity;
		if (!a || !a.available) throw new Error("Google Antigravity šajā datorā nav pieejams.");
		void a.login((n) => {
			if (n.type === "url") d.openUrl(n.url);
			if (n.type === "done") d.session.signedIn(ANTIGRAVITY);
			d.emit("agent.login", { provider: ANTIGRAVITY, ...n } as EventSpec["agent.login"]);
			if (n.type === "done" || n.type === "error") d.emit("data.changed", { projectId: null, what: ["agent"] });
		});
	};
	/** a provider just signed in or got a key: its own model list now, not tomorrow */
	const refreshNow = async (provider: string) => {
		const m = await import("../../agent/pi/index.js");
		if (!m.isPiProvider(provider)) return;
		const done = await m.refreshStaleModels(await d.pi(), [provider], [provider]);
		if (done.length) d.emit("data.changed", { projectId: null, what: ["agent"] });
	};

	return {
		"app.info": () => ({ version: d.version, dataDir: d.settings.dir, platform: process.platform }),
		"settings.get": () => d.settings.get(),
		"settings.set": (patch) => {
			const s = d.settings.set(patch);
			// Auto mode just switched on: the cards that already wait are answered too
			if (patch.autoApprove === true) d.session.approveWaiting();
			d.emit("data.changed", { projectId: null, what: ["settings"] });
			return s;
		},
		"dialog.pickFolder": (title) => d.pickFolder(title),
		"dialog.pickFile": (title, ext) => d.pickFile(title, ext),
		"screen.capture": (rect) => d.capture(rect),

		"usage.summary": () => summarizeUsage(readUsage(join(d.settings.dir, "usage.jsonl"))),
		"agent.status": () => d.session.status(),
		"agent.providers": async () => {
			const m = await import("../../agent/pi/index.js");
			const rt = await d.pi();
			const rows: ProviderRow[] = [];
			const signedIn: (typeof m.PI_PROVIDERS)[number]["id"][] = [];
			for (const p of m.PI_PROVIDERS) {
				const auth = await m.piAuthState(rt, p.id);
				if (auth.configured) signedIn.push(p.id);
				const models = m.listPiModels(rt, p.id).map((x) => ({ id: x.id, name: x.name, legacy: x.legacy, efforts: x.efforts, defaultEffort: x.defaultEffort }));
				rows.push({ id: p.id, label: p.label, auth: p.auth, configured: auth.configured, method: auth.method, keyUrl: p.keyUrl, models });
				// right after Claude by API key: the same models through the user's own Claude subscription (the Agent SDK engine)
				if (p.id === "anthropic") {
					const c = await import("../../agent/claude/provider.js");
					// a pasted setup-token or a login made by Sign in; the token wins in a run, so it names the method
					const token = !!d.settings.apiKey(c.CLAUDE_SUB);
					const on = token || d.claude?.peek().state === "in";
					d.claude?.refreshIfStale();
					const subModels = models.map((x) => {
						const efforts = x.efforts.filter((e) => c.claudeEffort(e));
						return { ...x, efforts, defaultEffort: efforts.includes(x.defaultEffort) ? x.defaultEffort : efforts.includes("medium") ? "medium" : (efforts[0] ?? "") };
					});
					rows.push({ id: c.CLAUDE_SUB, label: c.CLAUDE_SUB_LABEL, auth: ["api_key"], configured: on, method: on ? (token ? "api_key" : "oauth") : undefined, keyHelp: c.CLAUDE_SUB_TOKEN_HELP, models: subModels });
				}
				// next to Gemini by API key: Google's models through the user's Google account (Antigravity's own server); the list is what the server told for this account
				if (p.id === "google" && d.antigravity?.available) {
					const a = d.antigravity;
					a.refreshIfStale();
					const on = a.peek().signedIn;
					if (on) a.refreshCatalogIfStale();
					const catalog = on ? await a.catalog() : null;
					rows.push({ id: ANTIGRAVITY, label: ANTIGRAVITY_LABEL, auth: ["oauth"], configured: on, method: on ? "oauth" : undefined, models: (catalog?.models ?? []).map((x) => ({ id: x.id, name: x.name, legacy: false, efforts: x.variants.map((v) => v.id).filter((id) => (m.EFFORTS as readonly string[]).includes(id)), defaultEffort: "" })) });
				}
			}
			// the providers' own model lists, fetched in the background when missing or a day old; the pickers reload when they arrive
			void m.refreshStaleModels(rt, signedIn).then((done) => done.length && d.emit("data.changed", { projectId: null, what: ["agent"] }));
			return rows;
		},
		"agent.holds": () => d.session.holds(),
		"agent.releaseHold": (provider) => {
			d.session.releaseHold(provider);
			d.emit("data.changed", { projectId: null, what: ["agent"] });
		},
		"agent.setKey": (provider, key) => {
			d.settings.setApiKey(provider, key);
			// a new key (or Claude token) ends a hold for its sign-in: the agents try the provider again at their next run
			d.session.signedIn(provider);
			d.emit("data.changed", { projectId: null, what: ["agent"] });
			void refreshNow(provider);
		},
		"agent.clearKey": (provider) => {
			d.settings.clearApiKey(provider);
			d.emit("data.changed", { projectId: null, what: ["agent"] });
		},
		"agent.login": async (provider) => {
			if (isClaudeSub(provider)) return claudeLogin();
			if (isAntigravity(provider)) return antigravityLogin();
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
				.then(() => (d.session.signedIn(provider), d.emit("agent.login", { provider, type: "done" }), refreshNow(provider)))
				.catch((e: Error) => d.emit("agent.login", { provider, type: "error", message: e.message }))
				.finally(() => {
					if (login === current) login = null;
					d.emit("data.changed", { projectId: null, what: ["agent"] });
				});
		},
		"agent.loginAnswer": (text) => {
			if (claudeAsking) return d.claude?.complete(text);
			if (d.antigravity?.asked) return d.antigravity.complete(text);
			if (!login?.answer) throw new Error("Pieslēgšanās šobrīd neko negaida.");
			login.answer(text);
			login.answer = null;
		},
		"agent.loginCancel": async (provider) => {
			if (isAntigravity(provider)) {
				d.antigravity?.cancel();
				return;
			}
			if (isClaudeSub(provider)) {
				claudeCancelling = true;
				claudeAsking = false;
				await d.claude?.cancel();
				return;
			}
			login?.abort.abort();
		},
		"claude.authStatus": async (refresh) => {
			const claude = d.claude;
			if (claude) {
				if (refresh) await claude.refresh();
				else claude.refreshIfStale();
			}
			const info = claude?.peek();
			return { login: info?.state ?? "unknown", token: !!d.settings.apiKey(CLAUDE_SUB), ...(info?.account ? { account: info.account } : {}), busy: claude?.busy ?? false };
		},
		"agent.logout": async (provider) => {
			if (isAntigravity(provider)) {
				if (!d.antigravity) throw new Error("Antigravity pieslēgšanās šeit nav pieejama.");
				await d.antigravity.signOut();
				d.emit("data.changed", { projectId: null, what: ["agent"] });
				return;
			}
			if (isClaudeSub(provider)) {
				if (!d.claude) throw new Error("Claude pieslēgšanās šeit nav pieejama.");
				await d.claude.signOut();
				d.emit("data.changed", { projectId: null, what: ["agent"] });
				return;
			}
			const m = await import("../../agent/pi/index.js");
			if (!m.isPiProvider(provider)) throw new Error(`Nezināms pakalpojums: ${provider}`);
			await m.logoutProvider((await d.pi()).models, provider);
			d.emit("data.changed", { projectId: null, what: ["agent"] });
		},
		"agent.send": async (projectId, text, focus, attachments) => {
			// the activity log titles the run with what was asked, keyed by the run's id (known before the run starts,
			// and the run's first event may come before send returns, or much later when the start waits in the queue);
			// for "@agent text" it is the text after the mention
			return titled(d, projectId, (onRunId) => d.session.send(projectId, text, focus, attachments ?? [], onRunId));
		},
		"agent.stop": () => d.session.stop(),
		"queue.restored": () => d.session.queueRestored(),
		"queue.resumeInterrupted": () => d.session.resumeInterrupted(),
		"queue.discardInterrupted": () => d.session.discardInterrupted(),
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
