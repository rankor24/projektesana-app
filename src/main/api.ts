// Everything the UI can ask the main process to do. Plain methods so they can be tested without Electron;
// ipc.ts exposes every public method (names not starting with "_") over one IPC channel.
import { copyFileSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { checkRead } from "../kernel/guard.js";
import { createProject, loadProject, type ProjectMeta } from "../kernel/project.js";
import { Registry } from "../kernel/registry.js";
import { appendLog, readLog } from "../kernel/log.js";
import { acknowledgeChange, confirmRole, loadFiles, registerFile, rescan, setRole, versionBlob } from "../kernel/files.js";
import { textDiff } from "../kernel/diff.js";
import { addPin, closePin, loadPins, loadReview, openPins, pinToModel, reopenPin, revisionComplete, setReviewState, type ReviewState, type PinTarget, type ViewGeometry } from "../kernel/pins.js";
import type { Engine, McpLaunch } from "./engines/types.js";
import { toolsLaunch, revitLaunch } from "./engines/index.js";
import type { EngineId, RunEvent, Settings } from "../shared/types.js";
import type { PiRuntime } from "../agent-pi/index.js";
import { PiLogin, providerStatuses } from "./engines/pi.js";
import { Library, type Category } from "./library/library.js";
import type { Store } from "./store.js";
import { appendChat, completeness, confirmFact, deriveFacts, editFact, factState, loadBrief, readChat, rejectFact } from "./chat/brief.js";
import { loadScan, scanFolder, type ScanResult } from "./gather/scan.js";
import { projectRefs } from "./gather/refs.js";
import { FACT_LABELS, SECTIONS, SECTION_ORDER, buildGatherPrompt, type FactRow, type SectionId } from "./gather/sections.js";
import { confirmApplicable, loadApplicable, loadRuns, removeApplicable, saveRun, type GatherRun } from "./gather/state.js";
import { buildSetupPrompt } from "./chat/setup.js";
import { loadRules, rereadRules, verifyRules } from "./rules/verify.js";
import { proposeRole, ROLES } from "./files/roles.js";
import { ACTS, NOT_READ, PENDING_UNREAD, type Stage } from "./rules/types.js";
import { bimModelRequired, groupOf, procedureOf, requiredContent, type Facts } from "./rules/engine.js";
import { addTask, addTr, calendar, confirmTr, loadTasks, loadTr, removeTr, setTaskDone, trDeadline, updateTr, type TrRequest } from "./project/work.js";
import { extractText } from "./files/text.js";
import { connectRevit, type RevitConnection } from "./revit/client.js";
import { createElevations, createMissingPlans, createSheet, ensureActiveDocument, docInfo, listViews, revitStatus, saveAsWorkCopy, setViewScale, type RevitCaller } from "./revit/commands.js";
import { publishApproved, revisionDir, runAgentBatch, type Manifest } from "./loop/revision.js";

export interface ApiDeps {
	store: Store;
	/** the pi engine (tests pass a fake) */
	engine: Engine;
	/** pi runtime: catalog, credentials, live model lists. Built on first use. */
	pi: () => Promise<PiRuntime>;
	/** built server.js of projektesana-tools */
	serverJs: string;
	dataDir: string;
	emit: (channel: string, ...args: unknown[]) => void;
	/** opens an https address in the system browser (sign-in pages, likumi.lv) */
	openUrl?: (url: string) => void;
	/** opens a local file with its default program; returns an error text or "" (Electron shell.openPath) */
	openPath?: (path: string) => Promise<string>;
	/** the Revit MCP server if it is in its usual place, offered as a one-click default */
	revitDefault?: () => string | null;
	/** fetches a web page's HTML; injected so tests run offline */
	fetchPage?: (url: string) => Promise<string>;
	/** test hook: replaces the Revit connection */
	revitFactory?: (serverJs: string) => Promise<RevitConnection | RevitCaller>;
}

const fetchHtml = async (url: string) => {
	const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Projektesana-App" }, signal: AbortSignal.timeout(30_000) });
	if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
	return r.text();
};

export class AppApi {
	private registry: Registry;
	private revit: (RevitConnection | RevitCaller) | null = null;
	private running: AbortController | null = null;
	/** which gather section the agent is on right now, for the panels to show */
	private runningLabel: SectionId | null = null;
	private login: PiLogin;
	private library: Library;

	constructor(private d: ApiDeps) {
		this.registry = new Registry(d.store.registryFile());
		this.login = new PiLogin({ runtime: d.pi, emit: (n) => d.emit("pi:login", n), openUrl: (u) => d.openUrl?.(u) });
		this.library = new Library(d.store.libraryDir(), join(d.dataDir, "law-snapshots"));
	}

	// ---- settings, providers, models, sign-in ------------------------------------

	settingsGet(): Settings {
		return this.d.store.settings();
	}
	settingsSave(patch: Partial<Settings>) {
		return this.d.store.saveSettings(patch);
	}
	/** The chosen provider/model is usable right now (shown in the chat and modelling panels). */
	agentStatus() {
		return this.d.engine.status();
	}
	/** Every provider: signed in or keyed, and what to do next. */
	async providersStatus() {
		return providerStatuses(await this.d.pi());
	}
	/** Model picker: pi's catalog plus the provider's live list (newest first), each with its effort levels. */
	async modelsList(provider: string) {
		const pi = await import("../agent-pi/index.js");
		if (!pi.isPiProvider(provider)) throw new Error(`Nezināms pakalpojums: ${provider}`);
		const rt = await this.d.pi();
		const models = pi.listPiModels(rt, provider);
		return { models, defaultModel: pi.defaultPiModel(rt, provider) ?? null, fetchedAt: rt.live.fetchedAt[provider] ?? null };
	}
	/** Downloads the live model lists of every provider that has an API key. */
	async modelsRefresh() {
		const pi = await import("../agent-pi/index.js");
		return pi.refreshLiveModels(await this.d.pi(), pi.PI_PROVIDER_IDS);
	}
	keySet(provider: string, key: string) {
		this.d.store.setApiKey(provider, key);
		return true;
	}
	keyClear(provider: string) {
		this.d.store.clearApiKey(provider);
		return true;
	}
	async providerLogin(provider: string) {
		const pi = await import("../agent-pi/index.js");
		if (!pi.isPiProvider(provider)) throw new Error(`Nezināms pakalpojums: ${provider}`);
		await this.login.login(provider);
		return true;
	}
	loginAnswer(text: string) {
		this.login.answer(String(text ?? ""));
		return true;
	}
	loginCancel() {
		this.login.cancel();
		return true;
	}
	async providerLogout(provider: string) {
		const pi = await import("../agent-pi/index.js");
		if (!pi.isPiProvider(provider)) throw new Error(`Nezināms pakalpojums: ${provider}`);
		await pi.logoutProvider((await this.d.pi()).models, provider);
		return true;
	}

	// ---- law library (panels 1–4) --------------------------------------------------

	librarySources(category?: Category) {
		return this.library.list(category);
	}
	libraryParagraphs(id: string) {
		return this.library.paragraphs(id);
	}
	libraryAddUrl(url: string, category: Category, title?: string) {
		return this.library.addUrl(url, category, this.d.fetchPage ?? fetchHtml, title);
	}
	libraryAddFiles(paths: string[], category: Category) {
		return Promise.all(paths.map((p) => this.library.addFile(p, category)));
	}
	libraryRemove(id: string) {
		this.library.remove(id);
		return true;
	}
	libraryReread(id: string) {
		return this.library.reread(id, this.d.fetchPage ?? fetchHtml);
	}
	librarySearch(query: string, category?: Category) {
		return this.library.search(query, { category });
	}
	libraryReferences(kind: "lvs" | "es") {
		return this.library.references(kind);
	}
	libraryOpenOriginal(id: string) {
		const f = this.library.originalFile(id);
		if (!f) throw new Error("Šim avotam nav saglabāta faila.");
		return f;
	}
	/** Usual place of the Revit MCP server, when it exists on this computer. */
	revitDefaultPath() {
		return this.d.revitDefault?.() ?? null;
	}
	/** Where main-process and renderer errors are written. */
	logFile() {
		return join(this.d.store.logsDir(), "app.log");
	}
	openUrl(url: string) {
		if (!/^https:\/\//i.test(url)) throw new Error("Atvērt var tikai https adreses.");
		this.d.openUrl?.(url);
		return true;
	}

	// ---- projects ----------------------------------------------------------------

	projectsCreate(root: string, name: string): ProjectMeta {
		mkdirSync(root, { recursive: true });
		const m = createProject(root, name);
		this.registry.add(root);
		return m;
	}
	/**
	 * Boris points at the folder his project already lives in. A folder without .bv gets one (named after the folder);
	 * nothing else in it is touched. The folder is scanned at once: every file registered, read and given a proposed role.
	 */
	async projectsOpenFolder(root: string): Promise<ProjectMeta> {
		if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Mape nav atrasta: ${root}`);
		const meta = loadProject(root) ?? createProject(root, basename(resolve(root)));
		this.registry.add(root);
		await this.gatherScan(root);
		return meta;
	}
	/** Opens a folder that already has .bv (made by this or another family app). */
	projectsAdd(root: string): ProjectMeta {
		const m = loadProject(root);
		if (!m) throw new Error("Šajā mapē nav .bv/project.json — tas nav projekts.");
		this.registry.add(root);
		return m;
	}
	/** Removes the project from the list. The folder is never touched. */
	projectsForget(root: string) {
		this.registry.forget(root);
		return true;
	}
	projectsList() {
		return this.registry.list().map((root) => {
			const meta = existsSync(root) ? loadProject(root) : null;
			if (!meta) return { root, meta: null, missing: true as const };
			const tasks = loadTasks(root);
			const revs = existsSync(join(root, ".bv", "revisions")) ? readdirSync(join(root, ".bv", "revisions")).filter((x) => /^r\d+$/.test(x)) : [];
			const latest = revs.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).pop() ?? null;
			const review = latest ? loadReview(root, latest) : [];
			const comp = completeness(root);
			const brief = loadBrief(root);
			const states = Object.values(brief.facts).map((f) => factState(brief, f));
			return {
				root,
				meta,
				missing: false as const,
				files: loadFiles(root).length,
				factsProposed: states.filter((s) => s === "proposed").length,
				factsConfirmed: states.filter((s) => s === "confirmed").length,
				gathered: Object.keys(loadRuns(root)).length,
				openPins: openPins(root).length,
				openTasks: tasks.filter((t) => !t.done).length,
				revisions: revs.length,
				latest,
				approved: review.filter((r) => r.state === "approved").length,
				reviewItems: review.length,
				setup: comp.blocked ? ("not started" as const) : comp.complete ? ("complete" as const) : ("in progress" as const),
				next: calendar(root)[0] ?? null,
			};
		});
	}

	// ---- files (panels 7–8) ----------------------------------------------------

	roles() {
		return [...ROLES];
	}
	filesList(root: string) {
		return loadFiles(root);
	}
	/** Copies picked files into <root>/Izejas dati (the originals stay where they are) and registers them. */
	filesImport(root: string, absPaths: string[], role: string) {
		const dir = join(root, "Izejas dati");
		mkdirSync(dir, { recursive: true });
		return absPaths.map((p) => {
			let target = join(dir, basename(p));
			for (let n = 2; existsSync(target); n++) target = join(dir, `${basename(p, extname(p))} (${n})${extname(p)}`);
			copyFileSync(p, target, constants.COPYFILE_EXCL);
			return registerFile(root, target, role);
		});
	}
	filesRegister(root: string, path: string, role: string) {
		return registerFile(root, path, role);
	}
	/** Opens a project file in its own program (PDF reader, Word …). Guarded to the project folder. */
	async fileOpen(root: string, path: string) {
		const g = checkRead({ root }, path);
		if (!g.ok) throw new Error(g.reason);
		if (!existsSync(g.path)) throw new Error(`Fails nav atrasts: ${g.path}`);
		const err = await this.d.openPath?.(g.path);
		if (err) throw new Error(err);
		return true;
	}
	/**
	 * Files attached in the chat: copied into the project, role proposed from their text (Boris can change it in
	 * panels 7–8). The agent sees them in its file list on the next message.
	 */
	async chatAttach(root: string, absPaths: string[]) {
		const out = [];
		for (const p of absPaths) {
			const prop = await proposeRole(p).catch(() => null);
			const [rec] = this.filesImport(root, [p], prop?.role ?? "Cits");
			appendLog(root, { kind: "chat.attach", by: "boris", data: { path: rec.path, role: rec.role ?? null, proposedFrom: prop?.quote ?? null } });
			out.push({ path: rec.path, role: rec.role ?? "Cits", quote: prop?.quote ?? null });
		}
		return out;
	}
	/** The received technical-rules document: copied into the project, registered with its role, linked to the request. */
	async trAttachFile(root: string, id: string, absPath: string) {
		const [rec] = this.filesImport(root, [absPath], "Tehniskie noteikumi");
		return updateTr(root, id, { file: rec.path });
	}
	/** Suggests a role with the matching words as the quote; nothing is assigned until Boris confirms with filesSetRole. */
	async filesProposeRole(root: string, path: string) {
		const g = checkRead({ root }, path);
		if (!g.ok) throw new Error(g.reason);
		return proposeRole(g.path);
	}
	filesSetRole(root: string, path: string, role: string) {
		if (!(ROLES as readonly string[]).includes(role)) throw new Error(`Nezināma loma: ${role}`);
		return setRole(root, path, role);
	}
	filesRescan(root: string) {
		return rescan(root);
	}
	filesAcknowledge(root: string, path: string) {
		acknowledgeChange(root, path);
		return true;
	}
	/** Text diff between two stored versions of a registered file. */
	async filesDiff(root: string, path: string, from: number, to: number) {
		const a = versionBlob(root, path, from);
		const b = versionBlob(root, path, to);
		if (!a || !b) throw new Error("Vienas versijas saturs nav saglabāts (fails par lielu vai nav šādas versijas).");
		return textDiff(await extractText(a), await extractText(b));
	}
	/** Bytes for the viewers; path-guarded to the project. */
	fileRead(root: string, path: string): Uint8Array {
		const g = checkRead({ root }, path);
		if (!g.ok) throw new Error(g.reason);
		return new Uint8Array(readFileSync(g.path));
	}
	filesInFolder(root: string, sub: string) {
		const g = checkRead({ root }, sub);
		if (!g.ok) throw new Error(g.reason);
		if (!existsSync(g.path)) return [];
		return readdirSync(g.path).map((n) => ({ name: n, dir: statSync(join(g.path, n)).isDirectory() }));
	}

	// ---- rules (panels 1–4) ----------------------------------------------------

	rulesAll() {
		const rules = loadRules(this.d.dataDir);
		return {
			rules,
			verification: verifyRules(rules, join(this.d.dataDir, "law-snapshots")),
			acts: ACTS,
			notRead: NOT_READ,
			pending: PENDING_UNREAD,
		};
	}
	/** Re-reads the live likumi.lv pages (one GET per act, only when Boris presses the button) and flags rules whose quote changed. */
	async rulesReread() {
		return rereadRules(loadRules(this.d.dataDir), async (url) => {
			const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Projektesana-App" } });
			if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
			return r.text();
		});
	}
	/** Group, procedure and required AR/GP content for a project, from its brief facts. */
	rulesForProject(root: string, stage: Stage) {
		const b = loadBrief(root);
		if (!b.engine.work || !b.engine.use) return { ready: false as const, reason: "Brief nav pabeigts: trūkst darba veida un ēkas lietojuma." };
		const f = b.engine as Facts;
		const rules = loadRules(this.d.dataDir);
		return { ready: true as const, group: groupOf(f), procedure: procedureOf(f), content: requiredContent(rules, f, stage), bim: bimModelRequired(f) };
	}

	// ---- technical rules (panels 5–6) -------------------------------------------

	trList(root: string) {
		return loadTr(root).map((r) => ({ ...r, deadline: r.status === "pieprasīts" ? trDeadline(r) : null }));
	}
	trAdd(root: string, r: Omit<TrRequest, "id">) {
		return addTr(root, r);
	}
	trUpdate(root: string, id: string, patch: Partial<Omit<TrRequest, "id">>) {
		return updateTr(root, id, patch);
	}

	// ---- gather: panels 1–8 are filled from the project folder ------------------------

	/** Registers, reads and proposes roles for every file in the project folder. Cheap, no model. */
	async gatherScan(root: string): Promise<ScanResult> {
		const r = await scanFolder(root, (done, total, path) => this.d.emit("gather:event", { root, type: "scan", done, total, path }));
		this.d.emit("gather:event", { root, type: "scan-done", found: r.found });
		return r;
	}
	gatherState(root: string) {
		return { scan: loadScan(root), runs: loadRuns(root), running: this.running ? this.runningLabel : null };
	}
	/** The rows a panel shows for its section: each fact with its state, value and the quote behind it. */
	gatherFacts(root: string, section: SectionId): FactRow[] {
		const b = loadBrief(root);
		const ids = section === "laws" ? ["group", "procedure"] : SECTIONS[section].facts;
		return ids.map((id) => {
			const f = b.facts[id];
			return { id, label: FACT_LABELS[id] ?? id, state: f ? factState(b, f) : "open", value: f?.value, source: f?.source as FactRow["source"], by: f?.by };
		});
	}
	private _derive(root: string) {
		deriveFacts(root, loadRules(this.d.dataDir));
	}

	/**
	 * One agent run over the project folder for one group of panels. The agent reads the files and records facts with
	 * verbatim quotes; code checks each quote. Everything it writes is a proposal that Boris confirms in the panel.
	 */
	async gatherRun(root: string, section: SectionId): Promise<{ ok: true; summary: string } | { ok: false; reason: string }> {
		const def = SECTIONS[section];
		if (!def) throw new Error(`Nezināma sadaļa: ${section}`);
		if (this.running) throw new Error("Aģents jau strādā.");
		const engine = this.d.engine;
		const st = await engine.status();
		const fail = (reason: string) => {
			this.d.emit("gather:event", { root, section, type: "failed", reason });
			saveRun(root, { section, at: new Date().toISOString(), ok: false, summary: "", tools: 0, error: reason });
			return { ok: false as const, reason };
		};
		if (!st.ready) return fail(st.reason);
		const scan = loadScan(root) ?? (await this.gatherScan(root));
		this._derive(root);
		const ac = (this.running = new AbortController());
		this.runningLabel = section;
		this.d.emit("gather:event", { root, section, type: "start" });
		let tools = 0;
		let streamed = "";
		let answer = "";
		let error: string | null = null;
		try {
			const refs = section === "laws" ? await projectRefs(root) : [];
			const text = new Map(scan.files.map((f) => [f.path, f]));
			const prompt = buildGatherPrompt({
				section: def,
				rows: this.gatherFacts(root, section).filter((r) => def.facts.includes(r.id)),
				files: loadFiles(root).map((f) => ({ path: f.path, role: f.role ?? null, text: text.get(f.path)?.text ?? "ok", note: text.get(f.path)?.note })),
				refs,
				scan,
			});
			await engine.run({
				prompt,
				runDir: join(root, ".bv", "runs", `gather-${section}`),
				mcp: { projektesana: this._tools(root, engine.id, "gather") },
				signal: ac.signal,
				onEvent: (e) => {
					if (e.type === "turn") streamed = "";
					if (e.type === "text") streamed += e.text;
					if (e.type === "tool") tools++;
					if (e.type === "done") answer = e.text || streamed;
					if (e.type === "error") error = e.message;
					this.d.emit("gather:event", { root, section, type: "agent", event: e });
				},
			});
		} catch (e) {
			error = (e as Error).message;
		} finally {
			this.running = null;
			this.runningLabel = null;
		}
		this._derive(root);
		const run: GatherRun = { section, at: new Date().toISOString(), ok: !error, summary: answer || streamed, tools, error: error ?? undefined };
		saveRun(root, run);
		this.d.emit("gather:event", { root, section, type: "end", ok: !error });
		return error ? { ok: false, reason: error } : { ok: true, summary: run.summary };
	}
	/** Scan, then every section in order. Stops at the first section that cannot run (for instance, no agent connected). */
	async gatherAll(root: string) {
		await this.gatherScan(root);
		const out: Partial<Record<SectionId, { ok: boolean; reason?: string }>> = {};
		for (const s of SECTION_ORDER) {
			const r = await this.gatherRun(root, s);
			out[s] = r.ok ? { ok: true } : { ok: false, reason: r.reason };
			if (!r.ok) break;
		}
		return out;
	}

	// Boris's decisions on what the agent proposed. None of these is available to the agent.
	factConfirm(root: string, id: string) {
		confirmFact(root, id);
		this._derive(root);
		return true;
	}
	factReject(root: string, id: string) {
		rejectFact(root, id);
		this._derive(root);
		return true;
	}
	async factEdit(root: string, id: string, value: string) {
		await editFact(root, id, value, FACT_LABELS[id] ?? id);
		this._derive(root);
		return true;
	}
	roleConfirm(root: string, path: string) {
		return confirmRole(root, path);
	}
	trConfirm(root: string, id: string) {
		return confirmTr(root, id);
	}
	trRemove(root: string, id: string) {
		return removeTr(root, id);
	}
	/** Laws the agent cited for this project (panels 1–4), optionally one category. */
	applicableList(root: string, category?: Category) {
		return loadApplicable(root).filter((a) => !category || a.category === category);
	}
	applicableConfirm(root: string, id: string) {
		return confirmApplicable(root, id);
	}
	applicableRemove(root: string, id: string) {
		return removeApplicable(root, id);
	}
	/** Acts and standards the project's own documents mention, with whether the library has them. */
	async refsList(root: string, category?: Category) {
		const titles = this.library.list().map((s) => s.title.toLowerCase().replace(/\s+/g, ""));
		// "MK noteikumi Nr. 500" is titled "MK 500 …" in the built-in list and "… noteikumi Nr.500 …" in added ones
		const keys = (ref: string) => {
			const k = ref.toLowerCase().replace(/\s+/g, "");
			const mk = /^mknoteikuminr\.(\d+)$/.exec(k);
			return mk ? [`nr.${mk[1]}`, `mk${mk[1]}`] : [k.replace(/^(lbn|lvs|direktīva|regula)/, "")];
		};
		return (await projectRefs(root))
			.filter((r) => !category || r.category === category)
			.map((r) => ({ ...r, inLibrary: keys(r.ref).some((k) => titles.some((t) => t.includes(k))) }));
	}

	// ---- dashboard work --------------------------------------------------------

	tasksList(root: string) {
		return loadTasks(root);
	}
	taskAdd(root: string, title: string, due: string | null) {
		return addTask(root, title, due);
	}
	taskDone(root: string, id: string, done: boolean) {
		return setTaskDone(root, id, done);
	}
	calendarFor(root: string) {
		return calendar(root);
	}
	logTail(root: string, n = 200) {
		const l = readLog(root);
		return { entries: l.entries.slice(-n), bad: l.bad, total: l.entries.length };
	}

	// ---- setup chat (panel 9) --------------------------------------------------

	chatHistory(root: string) {
		return { messages: readChat(root), completeness: completeness(root), brief: loadBrief(root) };
	}
	async chatSend(root: string, text: string) {
		if (!text.trim()) throw new Error("Ziņa ir tukša.");
		if (this.running) throw new Error("Aģents jau strādā.");
		appendChat(root, "boris", text.trim());
		const engine = this.d.engine;
		const st = await engine.status();
		if (!st.ready) {
			this.d.emit("agent:event", { type: "error", engine: engine.id, message: st.reason } satisfies RunEvent);
			return { ok: false as const, reason: st.reason };
		}
		const prompt = buildSetupPrompt({ completeness: completeness(root), history: readChat(root), files: loadFiles(root).map((f) => ({ path: f.path, role: f.role ?? null })) });
		const ac = (this.running = new AbortController());
		let answer = "";
		let streamed = "";
		let error: string | null = null;
		try {
			await engine.run({
				prompt,
				runDir: join(root, ".bv", "runs", "chat"),
				mcp: { projektesana: this._tools(root, engine.id, "setup") },
				signal: ac.signal,
				onEvent: (e) => {
					// text arrives in pieces; a new model turn starts a new answer; `done` carries the final one
					if (e.type === "turn") streamed = "";
					if (e.type === "text") streamed += e.text;
					if (e.type === "done") answer = e.text || streamed;
					if (e.type === "error") error = e.message;
					this.d.emit("agent:event", e);
				},
			});
		} finally {
			this.running = null;
		}
		if (error) return { ok: false as const, reason: error };
		if (answer) appendChat(root, "agent", answer);
		return { ok: true as const };
	}
	agentStop() {
		this.running?.abort();
		return true;
	}

	// ---- Revit & modelling -----------------------------------------------------

	private async _revit(): Promise<RevitConnection | RevitCaller> {
		if (this.revit) return this.revit;
		const js = this.d.store.settings().revitServerJs;
		if (!js) throw new Error("Revit MCP nav konfigurēts (Iestatījumi → Revit MCP serveris).");
		this.revit = await (this.d.revitFactory ?? connectRevit)(js);
		return this.revit;
	}
	async revitStatus() {
		if (!this.d.store.settings().revitServerJs) return { state: "not configured" as const };
		try {
			return await revitStatus(await this._revit());
		} catch (e) {
			this.revit = null;
			return { state: "not connected" as const, reason: (e as Error).message };
		}
	}
	modellingGet(root: string): { workPath: string | null } {
		const p = join(root, ".bv", "modelling.json");
		return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { workPath: null };
	}
	/** Saves the ACTIVE Revit document as <root>/Modelis/<name>_WORK.rvt. The open document becomes the copy; the original file is not touched. */
	async modellingCreateWorkCopy(root: string, name: string) {
		const safe = name.replace(/[^\p{L}\p{N}._ -]+/gu, "_").trim();
		if (!safe) throw new Error("Nosaukums ir tukšs.");
		const r = await this._revit();
		const info = await docInfo(r);
		if (/_WORK\.rvt$/i.test(info.path)) throw new Error("Aktīvais dokuments jau ir darba kopija.");
		const target = join(root, "Modelis", `${safe}_WORK.rvt`);
		if (existsSync(target)) throw new Error(`Darba kopija jau ir: ${target}`);
		mkdirSync(join(root, "Modelis"), { recursive: true });
		const path = await saveAsWorkCopy(r, target);
		return this._setWork(root, path);
	}
	/** Boris opened the work copy himself: remember it, but only if it is a _WORK file and it is the active document. */
	async modellingUseActive(root: string) {
		const info = await docInfo(await this._revit());
		if (!/_WORK\.rvt$/i.test(info.path)) throw new Error("Aktīvā dokumenta nosaukumam jābeidzas ar _WORK.rvt. Aģents nekad nestrādā ar oriģinālu.");
		const g = checkRead({ root }, info.path);
		if (!g.ok) throw new Error("Darba kopijai jābūt projekta mapē.");
		return this._setWork(root, info.path);
	}
	private _setWork(root: string, path: string) {
		writeFileSync(join(root, ".bv", "modelling.json"), JSON.stringify({ workPath: path }, null, 1), "utf8");
		appendLog(root, { kind: "modelling.workcopy", by: "boris", data: { path } });
		return { workPath: path };
	}
	/** App-side view preparation in the work copy: a plan for every level, a scale, and four elevations when the model has none. */
	async modellingPrepareViews(root: string, scale = 100) {
		const { workPath } = this.modellingGet(root);
		if (!workPath) throw new Error("Nav darba kopijas.");
		const r = (await this._revit()) as RevitCaller;
		await ensureActiveDocument(r, workPath);
		const created = await createMissingPlans(r);
		const views = await listViews(r);
		const plans = views.filter((v) => v.type === "FloorPlan");
		for (const p of plans) await setViewScale(r, p.id, scale);
		const elevations = views.some((v) => v.type === "Elevation") || !plans.length ? [] : await createElevations(r, plans[0].id);
		appendLog(root, { kind: "modelling.views", by: "app", data: { createdPlans: created, scale, createdElevations: elevations } });
		return { createdPlans: created, elevations };
	}
	async modellingCreateSheet(root: string, number: string, name: string, viewId: string) {
		const { workPath } = this.modellingGet(root);
		if (!workPath) throw new Error("Nav darba kopijas.");
		const r = (await this._revit()) as RevitCaller;
		await ensureActiveDocument(r, workPath);
		const id = await createSheet(r, number, name, viewId);
		appendLog(root, { kind: "modelling.sheet", by: "app", data: { number, name, viewId, sheetId: id } });
		return id;
	}
	/** One agent batch → one revision. Refused while setup is incomplete. */
	async batchRun(root: string, instruction: string) {
		if (this.running) throw new Error("Aģents jau strādā.");
		const comp = completeness(root);
		if (comp.blocked || !comp.complete) throw new Error("Uzstādīšana nav pabeigta (čats, panelis 9). Modelēšana sākas pēc pilna kontrolsaraksta.");
		const { workPath } = this.modellingGet(root);
		if (!workPath) throw new Error("Nav darba kopijas (Skati → Darba kopija).");
		const s = this.d.store.settings();
		const revitL = revitLaunch(s.revitServerJs);
		if (!revitL) throw new Error("Revit MCP nav konfigurēts.");
		const engine = this.d.engine;
		const st = await engine.status();
		if (!st.ready) throw new Error(st.reason);
		const ac = (this.running = new AbortController());
		try {
			const r = await runAgentBatch({
				root,
				engine,
				revit: (await this._revit()) as RevitCaller,
				workPath,
				mcp: { revit: revitL, tools: (revisionId) => this._tools(root, engine.id, "model", revisionId) },
				instruction,
				signal: ac.signal,
				onEvent: (e) => this.d.emit("agent:event", e),
			});
			return r;
		} finally {
			this.running = null;
		}
	}
	private _tools(root: string, engine: EngineId, mode: "setup" | "gather" | "model", revisionId?: string): McpLaunch {
		return toolsLaunch({ serverJs: this.d.serverJs, root, engine, dataDir: this.d.dataDir, libraryDir: this.d.store.libraryDir(), mode, revisionId });
	}

	// ---- revisions, review, pins (panel 10) --------------------------------------

	revisionsList(root: string) {
		const dir = join(root, ".bv", "revisions");
		if (!existsSync(dir)) return [];
		return readdirSync(dir)
			.filter((x) => /^r\d+$/.test(x) && existsSync(join(dir, x, "manifest.json")))
			.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
			.map((id) => {
				const m = JSON.parse(readFileSync(join(dir, id, "manifest.json"), "utf8")) as Manifest;
				const review = loadReview(root, id);
				return { id, createdAt: m.createdAt, pages: m.pages.length, approved: review.filter((r) => r.state === "approved").length, items: review.length, complete: revisionComplete(review) };
			});
	}
	revisionGet(root: string, id: string) {
		const dir = revisionDir(root, id);
		const rd = (f: string) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : null);
		return { manifest: rd("manifest.json") as Manifest | null, review: loadReview(root, id), diff: rd("diff.json"), summary: rd("summary.json"), geometry: rd("geometry.json") as Record<string, ViewGeometry> | null, pins: loadPins(root).filter((p) => p.revision === id) };
	}
	/** Only Boris's click reaches this; there is no agent tool for it. */
	reviewSet(root: string, id: string, item: string, state: ReviewState) {
		return setReviewState(root, id, item, state);
	}
	pinAdd(root: string, revision: string, target: PinTarget, text: string) {
		const pin = addPin(root, revision, target, text);
		// a comment on an item moves it from `new` to `commented`, never to approved
		const item = target.kind === "pdf" ? target.sheet : "model.ifc";
		const cur = loadReview(root, revision).find((r) => r.item === item);
		if (cur && cur.state === "new") setReviewState(root, revision, item, "commented");
		return pin;
	}
	pinClose(root: string, id: string) {
		return closePin(root, id);
	}
	pinReopen(root: string, id: string) {
		return reopenPin(root, id);
	}
	pinToModel(root: string, pinId: string) {
		const pin = loadPins(root).find((p) => p.id === pinId);
		if (!pin || pin.target.kind !== "pdf") throw new Error("Tikai PDF pins.");
		const geo = this.revisionGet(root, pin.revision).geometry?.[pin.target.sheet];
		if (!geo) throw new Error("Šim skatam nav ģeometrijas datu.");
		return pinToModel(pin, geo);
	}
	async publish(root: string, id: string) {
		const { workPath } = this.modellingGet(root);
		const rvt = workPath && this.d.store.settings().revitServerJs ? { revit: (await this._revit()) as RevitCaller, workPath } : undefined;
		return publishApproved(root, id, rvt);
	}
	ensureDocument(root: string) {
		return this._revit().then(async (r) => ensureActiveDocument(r, this.modellingGet(root).workPath ?? ""));
	}
	resolveRoot(p: string) {
		return resolve(p);
	}
}
