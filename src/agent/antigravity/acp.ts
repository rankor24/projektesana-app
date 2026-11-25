// Google's Antigravity ACP server as a child process: its isolated profile and launch environment, the sign-in link it announces on stderr, the
// JSON-RPC lines on stdout, and the model catalog it offers. Plain functions and one client class; nothing here knows the app's agents.
//
// Adapted from OpenMausBot (Apache-2.0) server/drivers/antigravity-acp.ts, which itself adapts pingdotgg/t3code@b9bc03869e (MIT, Copyright (c) 2026
// T3 Tools Inc., third_party/t3-code/LICENSE): apps/server/src/provider/antigravityAuthSupport.ts (the browser helper, the launch environment, the sign-in
// link's validation), antigravityCallback.ts (the redirect's validation and delivery) and acp/AntigravityAcpSupport.ts (the session setup, the client name).
// Changed: no bot box and no relay (the redirect reaches the server's own listener on this PC), a Windows-only temp folder, taskkill instead of killCliTree,
// and the client takes server requests (permission, files) through one handler instead of OpenMausBot's host pool.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AntigravityRuntime } from "./runtime.js";

// Printed on stderr by Google's server, not stdout.
export const ANTIGRAVITY_AUTH_PREFIX = "Open the following link to authenticate the ACP server: ";
// Google's packaged server can take tens of seconds to cold-start on Windows.
export const STARTUP_TIMEOUT_MS = 90_000;
// The Windows runtime is silent while it unpacks ~1 GB into TEMP, which antivirus scanning can stretch past one window: startup gets another window
// while that folder grows, up to this cap.
const STARTUP_CAP_MS = 5 * 60_000;
const UNPACK_COUNT_BUDGET_MS = 5_000;
const MAX_PROTOCOL_LINE_BYTES = 16 * 1024 * 1024;
const MAX_DIAGNOSTIC_LINE_CHARS = 64 * 1024;
// A forced stop on Windows skips the runtime's cleanup of what it unpacked; exiting by itself removes it.
const GRACEFUL_EXIT_MS = 5_000;

export interface AntigravityProfile {
	directory: string;
	tokenPath: string;
	environment: NodeJS.ProcessEnv;
	tempDirectory: string;
}

/** Foreign Google credentials and settings that would change the account or the billing without a word are never passed on. */
const REMOVED_ENVIRONMENT_KEYS = new Set([
	"GEMINI_API_KEY",
	"GOOGLE_API_KEY",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"GOOGLE_CLOUD_PROJECT",
	"GOOGLE_CLOUD_LOCATION",
	"GOOGLE_CLOUD_QUOTA_PROJECT",
	"GOOGLE_GENAI_USE_VERTEXAI",
	"GCLOUD_PROJECT",
	"CLOUDSDK_CORE_PROJECT",
	"AGY_ACP_CCPA_PROJECT",
	"AGY_ACP_ENABLE_OAUTH",
	"AGY_ACP_DEFAULT_MODEL",
	"GEMINI_HOME",
	"AGY_ACP_FORCE_FILE_STORAGE",
	"ANTIGRAVITY_HARNESS_PATH",
	"BROWSER",
	"PYTHONUNBUFFERED",
	"ELECTRON_RUN_AS_NODE",
	// an inherited pipe whose owner exited makes Electron-as-Node print Crashpad errors to stderr
	"CHROME_CRASHPAD_PIPE_NAME",
	// the app's own tool servers must not see the user's other agents' keys either
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
]);

const BROWSER_MARKER = "__PROJEKTESANA_ANTIGRAVITY_AUTH_URL__";
// The server opens the sign-in page through $BROWSER: this helper (the app's own node) prints the link, behind a private marker, and exits.
const browserHelperSource = `process.stderr.on("error",()=>process.exit(0)).write("${BROWSER_MARKER}"+JSON.stringify(process.argv[1])+"\\n",()=>process.exit(0))`;

const quoteBrowserArgument = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

function takeLines(buffer: string): { lines: string[]; rest: string } {
	const parts = buffer.split("\n");
	const rest = parts.pop() ?? "";
	return { lines: parts.map((line) => line.replace(/\r$/u, "")), rest };
}

/** Only fixed, allowlisted hints leave stderr: native output can carry OAuth codes in any format. */
function startupHint(line: string): string | undefined {
	if (/no space left|not enough (?:space|disk)|disk (?:is )?full|winerror\s*112/iu.test(line)) return "The runtime reported insufficient disk space while starting.";
	if (/failed to (?:extract|load (?:python|embedded python))|could not load python/iu.test(line)) return "The runtime reported a problem unpacking or loading its bundled Python runtime.";
	if (/permission denied|access is denied|winerror\s*5\b/iu.test(line)) return "The runtime reported a file or process permission failure.";
	if (/address family not supported|failed to create.*(?:socket|listener)|failed to bind/iu.test(line)) return "The runtime reported a local network listener failure.";
	return undefined;
}

/** Google announces the link two ways, both on stderr: through $BROWSER (the helper re-emits it JSON-encoded behind a private marker, preferred) and in plain text. */
export function authorizationUrlFromLine(line: string): string | null {
	if (line.startsWith(ANTIGRAVITY_AUTH_PREFIX)) return line.slice(ANTIGRAVITY_AUTH_PREFIX.length).trim();
	if (!line.startsWith(BROWSER_MARKER)) return null;
	try {
		const url = JSON.parse(line.slice(BROWSER_MARKER.length));
		return typeof url === "string" ? url : null;
	} catch {
		return null;
	}
}

export const antigravityTokenPath = (profileDirectory: string): string => join(profileDirectory, "antigravity-acp", "acp_token.json");

/** The runtime asked for a Google sign-in although a token file is stored (a revoked or ineligible account), or there was none. */
export class AntigravitySignInRequired extends Error {
	constructor() {
		super("Antigravity asked for a new Google sign-in.");
	}
}

const refusedTokens = new Map<string, string>();
const tokenStamp = (info: { mtimeMs: number; size: number; ino: number | bigint }) => `${info.mtimeMs}:${info.size}:${info.ino}`;

/** The stored token no longer signs this account in: it counts as signed out until a sign-in succeeds or writes the file again. */
export async function noteAntigravitySignInRequired(tokenPath: string): Promise<void> {
	try {
		refusedTokens.set(tokenPath, tokenStamp(await stat(tokenPath)));
	} catch {
		// no file: nothing to remember
	}
}

export function noteAntigravitySignedIn(tokenPath: string): void {
	refusedTokens.delete(tokenPath);
}

export async function antigravityProfileAuthenticated(tokenPath: string): Promise<boolean> {
	try {
		const info = await stat(tokenPath);
		if (!info.isFile() || info.size <= 0 || info.size > 1024 * 1024) return false;
		const refused = refusedTokens.get(tokenPath);
		if (refused === tokenStamp(info)) return false;
		if (refused !== undefined) refusedTokens.delete(tokenPath);
		return true;
	} catch {
		return false;
	}
}

/** Signing out forgets this app's stored Google sign-in; the profile stays for the next one. */
export async function removeAntigravitySignIn(tokenPath: string): Promise<void> {
	await rm(tokenPath, { force: true, maxRetries: 4, retryDelay: 250 });
}

// ---- the Windows temp folder -------------------------------------------------------------------------------------------------------------------

const UNPACK_PREFIX = "_MEI";

/** agy_acp_server.exe is a PyInstaller one-file build: each launch unpacks thousands of files (0.34-1.26 GB) into a new _MEI<pid><counter> folder in TEMP,
 *  and a forced stop skips PyInstaller's cleanup. The owner's PID is `%08x` since PyInstaller 6.22.1 and `%d` before: every split that leaves a 1-3 digit counter is a candidate. */
export function unpackFolderOwnerPids(name: string): number[] | null {
	if (!name.startsWith(UNPACK_PREFIX)) return null;
	const rest = name.slice(UNPACK_PREFIX.length);
	const pids = new Set<number>();
	if (/^[0-9a-f]{8}\d+$/iu.test(rest)) pids.add(Number.parseInt(rest.slice(0, 8), 16));
	if (/^[1-9]\d+$/u.test(rest)) for (let counter = 1; counter <= 3 && counter < rest.length; counter++) pids.add(Number.parseInt(rest.slice(0, rest.length - counter), 10));
	const valid = [...pids].filter((pid) => Number.isSafeInteger(pid) && pid > 0);
	return valid.length ? valid : null;
}

/** Only ESRCH proves a process gone: EPERM means it exists but belongs to someone else. */
export function processIsAlive(pid: number, kill: (pid: number, signal: 0) => unknown = (p, s) => process.kill(p, s)): boolean {
	try {
		kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException)?.code !== "ESRCH";
	}
}

/** Removes what dead launches left in the app's temp folder (never the system temp, which other programs use for the same runtime). */
export async function sweepAntigravityTemp(directory: string, isAlive: (pid: number) => boolean = processIsAlive): Promise<number> {
	let removed = 0;
	let names: string[] = [];
	try {
		names = await readdir(directory);
	} catch {
		return 0;
	}
	for (const name of names) {
		const pids = unpackFolderOwnerPids(name);
		if (!pids || pids.some((pid) => isAlive(pid))) continue;
		try {
			await rm(join(directory, name), { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
			removed++;
		} catch {
			// a file still held: the next start tries again
		}
	}
	return removed;
}

/** How many bytes a folder holds, within a time budget (`complete` is false when the count ran out of time: the number is then a lower bound). */
async function folderBytes(directory: string, deadline: number): Promise<{ bytes: number; complete: boolean }> {
	let bytes = 0;
	const pending = [directory];
	while (pending.length) {
		if (Date.now() > deadline) return { bytes, complete: false };
		const current = pending.pop()!;
		let entries: import("node:fs").Dirent[] = [];
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) pending.push(path);
			else if (entry.isFile()) {
				try {
					bytes += (await stat(path)).size;
				} catch {
					// gone meanwhile
				}
			}
		}
	}
	return { bytes, complete: true };
}

// ---- profile ------------------------------------------------------------------------------------------------------------------------------------

export interface PrepareProfileInput {
	/** `<appDir>\antigravity\profile`: the isolated Google profile (GEMINI_HOME) */
	profileDirectory: string;
	/** a short folder for what the runtime unpacks (Windows paths stop at 260) */
	tempDirectory: string;
	runtime: AntigravityRuntime;
	baseEnv?: NodeJS.ProcessEnv;
	/** the app's own node for the browser helper (Electron with ELECTRON_RUN_AS_NODE); defaults to this process */
	nodePath?: string;
}

export async function prepareAntigravityProfile(i: PrepareProfileInput): Promise<AntigravityProfile> {
	const directory = resolve(i.profileDirectory);
	const acpDirectory = join(directory, "antigravity-acp");
	await mkdir(acpDirectory, { recursive: true });
	await writeFile(join(acpDirectory, "settings.json"), `${JSON.stringify({ auth: { type: "oauth-personal" } })}\n`, { mode: 0o600 });
	const executable = (i.nodePath ?? process.execPath).replaceAll("\\", "/");
	if (/\r|\n|\0|%s/u.test(executable)) throw new Error("The app's node path cannot safely stand in for the browser.");
	const browserCommand = [executable, "-e", browserHelperSource, "--", "%s"].map(quoteBrowserArgument).join(" ");
	const environment: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(i.baseEnv ?? process.env)) if (!REMOVED_ENVIRONMENT_KEYS.has(key.toUpperCase())) environment[key] = value;
	Object.assign(environment, {
		GEMINI_HOME: directory,
		AGY_ACP_FORCE_FILE_STORAGE: "1",
		ANTIGRAVITY_HARNESS_PATH: i.runtime.harnessPath,
		BROWSER: browserCommand,
		PYTHONUNBUFFERED: "1",
		ELECTRON_RUN_AS_NODE: "1",
	});
	// Windows env names ignore case: an inherited `Temp` or `tmp` could otherwise win
	const tempDirectory = resolve(i.tempDirectory);
	await mkdir(tempDirectory, { recursive: true });
	for (const key of Object.keys(environment)) if (key.toUpperCase() === "TEMP" || key.toUpperCase() === "TMP") delete environment[key];
	environment.TEMP = tempDirectory;
	environment.TMP = tempDirectory;
	return { directory, tokenPath: antigravityTokenPath(directory), environment, tempDirectory };
}

// ---- the sign-in link and its redirect ------------------------------------------------------------------------------------------------------

export function parseAntigravityAuthorizationUrl(authorizationUrl: string): { authorizationUrl: string; redirectUri: string; state: string } {
	if (authorizationUrl.length > 16_384 || /\s/u.test(authorizationUrl)) throw new Error("Antigravity returned an invalid Google sign-in URL.");
	const url = new URL(authorizationUrl);
	const state = url.searchParams.get("state");
	const redirectUri = url.searchParams.get("redirect_uri");
	if (
		url.origin !== "https://accounts.google.com" ||
		url.pathname !== "/o/oauth2/v2/auth" ||
		url.username ||
		url.password ||
		url.hash ||
		url.searchParams.getAll("state").length !== 1 ||
		url.searchParams.getAll("redirect_uri").length !== 1 ||
		url.searchParams.getAll("response_type").length !== 1 ||
		url.searchParams.get("response_type") !== "code" ||
		!state ||
		state.length > 512 ||
		/\s/u.test(state) ||
		!redirectUri ||
		!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/$/u.test(redirectUri)
	)
		throw new Error("Antigravity returned an invalid Google sign-in URL.");
	const redirect = new URL(redirectUri);
	if (Number(redirect.port) < 1024 || Number(redirect.port) > 65535) throw new Error("Antigravity returned an invalid Google sign-in URL.");
	return { authorizationUrl, redirectUri, state };
}

/** A redirect URL pasted by the person (the browser could not reach the server's listener): it must belong to the sign-in that is waiting. */
export function validateAntigravityCallbackUrl(pending: { redirectUri: string; state: string }, callbackUrl: string): URL {
	if (callbackUrl.length > 16_384) throw new Error("The sign-in response URL is too long.");
	let callback: URL;
	try {
		callback = new URL(callbackUrl);
	} catch {
		throw new Error("Paste the complete redirect URL from Google.");
	}
	const expected = new URL(pending.redirectUri);
	const states = callback.searchParams.getAll("state");
	const codes = callback.searchParams.getAll("code");
	const errors = callback.searchParams.getAll("error");
	const issuers = callback.searchParams.getAll("iss");
	if (
		callback.protocol !== "http:" ||
		callback.hostname !== "127.0.0.1" ||
		callback.origin !== expected.origin ||
		callback.pathname !== expected.pathname ||
		callback.username ||
		callback.password ||
		callback.hash ||
		states.length !== 1 ||
		states[0] !== pending.state ||
		!((codes.length === 1 && codes[0] && errors.length === 0) || (errors.length === 1 && errors[0] && codes.length === 0)) ||
		issuers.length > 1 ||
		(issuers.length === 1 && issuers[0] !== "https://accounts.google.com")
	)
		throw new Error("This redirect URL does not belong to the current sign-in.");
	return callback;
}

/** Delivers the callback to the runtime's listener on 127.0.0.1. */
export async function forwardAntigravityCallback(callback: URL): Promise<void> {
	return new Promise((resolveForward, reject) => {
		const req = httpRequest({ protocol: "http:", hostname: "127.0.0.1", port: callback.port, path: `${callback.pathname}${callback.search}`, method: "GET", agent: false, timeout: 10_000 }, (response) => {
			response.resume();
			response.once("end", () => {
				const status = response.statusCode ?? 0;
				if (status >= 200 && status < 300) resolveForward();
				else reject(new Error("Could not deliver the Google sign-in response."));
			});
			response.once("error", reject);
		});
		req.once("timeout", () => req.destroy(new Error("The Google sign-in response timed out.")));
		req.once("error", reject);
		req.end();
	});
}

// ---- the client ------------------------------------------------------------------------------------------------------------------------------

interface Pending {
	resolve(value: any): void;
	reject(error: Error): void;
	timer?: ReturnType<typeof setTimeout>;
}

/** What the server sent as a request to this client (permission, file access…): answered with `result`, or an `error` the client sends back. */
export type ServerRequestHandler = (method: string, params: any) => Promise<{ result: unknown } | { error: { code: number; message: string } }>;

/** The `clientInfo` a runtime of `version` is started with. Before 1.5.1 (and for an unknown version) a runtime offers its non-Gemini models only to clients on
 *  its allowlist, so it is given a name from that list. (t3code AntigravityAcpSupport.ts, OpenMausBot antigravityClientInfo) */
export function antigravityClientInfo(version: string | null | undefined): { name: string; version: string } {
	const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version?.trim() ?? "");
	const need = [1, 5, 1];
	const open = match !== null && need.reduce((difference, part, index) => difference || Number(match[index + 1]) - part, 0) >= 0;
	return open ? { name: "projektesana", version: "0.0.0" } : { name: "zed", version: "0.0.0" };
}

const runtimeVersion = (value: unknown) => (typeof value === "string" ? value.replace(/^agy_acp_server_/u, "").trim() : "");

/** agy_acp_server 1.4.2 to 1.4.5 create or overwrite skills/system/run-workflow/SKILL.md in the session's folder unless the session turns its `run_workflow` tool off. */
export function antigravitySessionSetup(initialized: any): { _meta?: { antigravity: { disabledTools: string[] } } } {
	const match = /^1\.4\.(\d+)(?!\d)/u.exec(runtimeVersion(initialized?.agentInfo?.version));
	const patch = match ? Number(match[1]) : -1;
	return patch >= 2 && patch <= 5 ? { _meta: { antigravity: { disabledTools: ["run_workflow"] } } } : {};
}

export function isValidAntigravityInitializeResult(initialized: any, expectedVersion: string): boolean {
	if (!initialized || initialized.protocolVersion !== 1) return false;
	const name = initialized.agentInfo?.name;
	if (name !== "antigravity-acp" && name !== "Google Antigravity") return false;
	const actualVersion = initialized.agentInfo?.version;
	if (typeof actualVersion !== "string") return false;
	if (actualVersion !== expectedVersion && runtimeVersion(actualVersion) !== runtimeVersion(expectedVersion)) return false;
	// ACP advertises optional operations as capability objects (even empty); older runtimes send booleans
	const advertised = (v: unknown) => v === true || (typeof v === "object" && v !== null && !Array.isArray(v));
	if (initialized.agentCapabilities?.loadSession !== true || !advertised(initialized.agentCapabilities?.sessionCapabilities?.resume) || !advertised(initialized.agentCapabilities?.auth?.logout)) return false;
	if (!Array.isArray(initialized.authMethods) || !initialized.authMethods.some((m: any) => m?.id === "oauth-personal")) return false;
	return true;
}

export class AntigravityAcpClient {
	readonly child: ChildProcess;
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private buffer = "";
	private diagnosticBuffer = "";
	private initializationComplete = false;
	private startupOutputBytes = 0;
	private startupDiagnosticBytes = 0;
	private nativeStartupHint?: string;
	/** the last masked stderr lines since it last answered, for the exit message */
	private tail: string[] = [];
	private closed = false;
	private stopping?: Promise<boolean>;
	private readonly onAuthorizationUrl?: (url: string) => void;
	private readonly tempDirectory?: string;
	private readonly runtimeVersion: string | null;
	/** On Windows a running executable pins its file and directory: do not rename or delete before this settles. */
	readonly exited: Promise<void>;
	/** `session/update` and other notifications from the server */
	onNotification: (method: string, params: any) => void = () => undefined;
	/** requests the server makes of this client */
	onRequest: ServerRequestHandler = async () => ({ error: { code: -32601, message: "method not found" } });
	/** the server ended (the process closed): every open request already failed with this */
	onExit: (error: Error) => void = () => undefined;

	constructor(runtime: AntigravityRuntime, profile: AntigravityProfile, cwd: string, onAuthorizationUrl?: (url: string) => void) {
		this.onAuthorizationUrl = onAuthorizationUrl;
		this.tempDirectory = profile.tempDirectory;
		this.runtimeVersion = runtime.version;
		this.child = spawn(runtime.executablePath, runtime.args ?? [], { cwd, env: profile.environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		this.child.stdout!.setEncoding("utf8");
		this.child.stdout!.on("data", (chunk: string) => this.consume(chunk));
		// raw stderr is never surfaced: it can contain authorization codes. Only masked last lines reach the exit message.
		this.child.stderr!.setEncoding("utf8");
		this.child.stderr!.on("data", (chunk: string) => this.consumeDiagnostics(chunk));
		this.child.stdin!.on("error", () => undefined);
		this.child.once("error", (error) => this.failAll(error));
		this.exited = new Promise((done) => {
			this.child.once("close", (code, signal) => {
				if (authorizationUrlFromLine(this.diagnosticBuffer) === null) this.noteDiagnostic(this.diagnosticBuffer);
				this.diagnosticBuffer = "";
				const wasClosed = this.closed;
				this.closed = true;
				const detail = this.tail.length ? ` (${this.tail.join(" | ")})` : "";
				const error = new Error(`Antigravity ACP exited ${code ?? signal ?? "unexpectedly"}${detail}.${this.nativeStartupHint ? ` ${this.nativeStartupHint}` : ""}`);
				if (!wasClosed) this.failAll(error);
				if (!wasClosed) this.onExit(error);
				done();
			});
		});
	}

	get isClosed(): boolean {
		return this.closed;
	}

	private consume(chunk: string) {
		if (this.closed) return;
		if (!this.initializationComplete) this.startupOutputBytes += Buffer.byteLength(chunk);
		this.buffer += chunk;
		if (Buffer.byteLength(this.buffer) > MAX_PROTOCOL_LINE_BYTES) {
			this.failAll(new Error("Antigravity sent a protocol line that is too large."));
			this.close();
			return;
		}
		const { lines, rest } = takeLines(this.buffer);
		this.buffer = rest;
		for (const line of lines) {
			if (this.announceAuthorizationUrl(line)) continue;
			let message: any;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			this.dispatch(message);
		}
	}

	private dispatch(message: any) {
		if (typeof message?.method === "string") {
			if (typeof message.id === "number" || typeof message.id === "string") void this.answerServerRequest(message);
			else this.onNotification(message.method, message.params);
			return;
		}
		if (typeof message?.id !== "number") return;
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		if (pending.timer) clearTimeout(pending.timer);
		if (message.error) {
			const error = new Error(message.error.message ?? "Antigravity ACP request failed.");
			Object.assign(error, { code: message.error.code, data: message.error.data });
			pending.reject(error);
		} else pending.resolve(message.result);
	}

	/** An unanswered server request blocks the agent: every one gets an answer, an error when the handler throws. */
	private async answerServerRequest(message: any) {
		let reply: { result: unknown } | { error: { code: number; message: string } };
		try {
			reply = await this.onRequest(message.method, message.params ?? {});
		} catch (e) {
			reply = { error: { code: -32603, message: (e as Error).message } };
		}
		this.send({ jsonrpc: "2.0", id: message.id, ...reply });
	}

	send(obj: unknown) {
		if (this.closed) return;
		try {
			this.child.stdin!.write(`${JSON.stringify(obj)}\n`);
		} catch {
			// the process is going away: the close handler fails what is open
		}
	}

	notify(method: string, params: unknown) {
		this.send({ jsonrpc: "2.0", method, params });
	}

	private announceAuthorizationUrl(line: string): boolean {
		const raw = authorizationUrlFromLine(line);
		if (raw === null) return false;
		try {
			const { authorizationUrl } = parseAntigravityAuthorizationUrl(raw);
			if (!this.onAuthorizationUrl) throw new AntigravitySignInRequired();
			this.onAuthorizationUrl(authorizationUrl);
		} catch (error) {
			this.failAll(error instanceof Error ? error : new Error(String(error)));
		}
		return true;
	}

	/** Lines are matched and released at once and the tail is capped, so no authorization code is held. */
	private consumeDiagnostics(chunk: string) {
		if (!this.initializationComplete) this.startupDiagnosticBytes += Buffer.byteLength(chunk);
		const { lines, rest } = takeLines(this.diagnosticBuffer + chunk);
		this.diagnosticBuffer = rest.length > MAX_DIAGNOSTIC_LINE_CHARS ? "" : rest;
		for (const line of lines) if (!this.announceAuthorizationUrl(line)) this.noteDiagnostic(line);
	}

	private noteDiagnostic(line: string) {
		if (!this.initializationComplete) this.nativeStartupHint ??= startupHint(line);
		const masked = line.trim().replace(/https?:\/\/\S+/giu, "<link>").slice(0, 200);
		if (!masked) return;
		this.tail.push(masked);
		if (this.tail.length > 4) this.tail.shift();
	}

	private failAll(error: Error) {
		for (const pending of this.pending.values()) {
			if (pending.timer) clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}

	/** When `timeoutMs` passes, `expired` decides: a number waits that many milliseconds more, an Error fails the request. `timeoutMs` 0 = no timeout (a prompt runs as long as it runs). */
	request(method: string, params: unknown, timeoutMs = 30_000, expired: () => Promise<number | Error> = async () => new Error(`${method} timed out.`)): Promise<any> {
		if (this.closed) return Promise.reject(new Error("Antigravity ACP is closed."));
		const id = this.nextId++;
		return new Promise((resolveRequest, reject) => {
			const arm = (milliseconds: number): ReturnType<typeof setTimeout> => {
				const timer = setTimeout(async () => {
					const outcome = await expired();
					const pending = this.pending.get(id);
					if (!pending) return;
					if (typeof outcome === "number") {
						pending.timer = arm(outcome);
						return;
					}
					this.pending.delete(id);
					reject(outcome);
				}, milliseconds);
				timer.unref?.();
				return timer;
			};
			this.pending.set(id, { resolve: resolveRequest, reject, ...(timeoutMs > 0 ? { timer: arm(timeoutMs) } : {}) });
			this.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
		});
	}

	private async unpackedBytes(): Promise<{ bytes: number; complete: boolean }> {
		return this.tempDirectory ? folderBytes(this.tempDirectory, Date.now() + UNPACK_COUNT_BUDGET_MS) : { bytes: 0, complete: true };
	}

	async initialize(windowMs = STARTUP_TIMEOUT_MS, deadline = Date.now() + STARTUP_CAP_MS): Promise<any> {
		const started = Date.now();
		const counting = this.unpackedBytes();
		let unpacked: number | undefined;
		const expired = async (): Promise<number | Error> => {
			const before = (await counting).bytes;
			const count = await this.unpackedBytes();
			const progressing = !count.complete || count.bytes > (unpacked ?? before);
			if (count.complete) unpacked = count.bytes;
			const left = deadline - Date.now();
			if (progressing && left > 0) return Math.min(windowMs, left);
			return new Error(
				`Antigravity initialization timed out after ${Math.ceil((Date.now() - started) / 1_000)} seconds (${process.platform}-${process.arch}). The executable was found, but did not finish starting. ` +
					`${this.nativeStartupHint ? `${this.nativeStartupHint} ` : ""}Startup output: ${this.startupOutputBytes} bytes; diagnostic output: ${this.startupDiagnosticBytes} bytes. Try again; if it still fails, check free disk space and the antivirus.`,
			);
		};
		const initialized = await this.request(
			"initialize",
			{ protocolVersion: 1, clientInfo: antigravityClientInfo(this.runtimeVersion), clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } },
			Math.min(windowMs, Math.max(0, deadline - Date.now())),
			expired,
		);
		this.initializationComplete = true;
		this.nativeStartupHint = undefined;
		this.tail = [];
		return initialized;
	}

	/** End input so the runtime exits by itself and removes what it unpacked; force-stop after GRACEFUL_EXIT_MS. */
	close() {
		if (this.closed) return;
		this.closed = true;
		this.failAll(new Error("Antigravity ACP was closed."));
		this.stopping = this.stopGracefully();
	}

	private async stopGracefully(): Promise<boolean> {
		try {
			this.child.stdin?.end();
		} catch {
			// already closed
		}
		let timer: NodeJS.Timeout | undefined;
		await Promise.race([
			this.exited,
			new Promise<void>((done) => {
				timer = setTimeout(done, GRACEFUL_EXIT_MS);
				timer.unref?.();
			}),
		]);
		clearTimeout(timer);
		return killTree(this.child);
	}

	async closeAndWait(timeoutMs = 12_000): Promise<boolean> {
		this.close();
		let timer: NodeJS.Timeout | undefined;
		const timedOut = new Promise<boolean>((done) => {
			timer = setTimeout(() => done(false), timeoutMs);
			timer.unref?.();
		});
		try {
			return await Promise.race([this.stopping!, timedOut]);
		} finally {
			clearTimeout(timer);
		}
	}
}

/** Stops a process and its children (the harness): true when it is gone. */
export function killTree(child: ChildProcess): Promise<boolean> {
	return new Promise((done) => {
		if (child.exitCode !== null || child.signalCode !== null || !child.pid) return done(true);
		if (process.platform === "win32") {
			execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => done(child.exitCode !== null || child.signalCode !== null || !isRunning(child.pid)));
		} else {
			try {
				child.kill("SIGKILL");
			} catch {
				// already gone
			}
			done(true);
		}
	});
}

function isRunning(pid: number | undefined): boolean {
	return pid !== undefined && processIsAlive(pid);
}

// ---- the model catalog ----------------------------------------------------------------------------------------------------------------------

export interface AntigravityModel {
	id: string;
	name: string;
	/** thinking levels the model offers, from the server: the app's "effort" for this model */
	variants: { id: string; name: string }[];
}

export interface AntigravityCatalog {
	default: string;
	models: AntigravityModel[];
}

function nonempty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function selectValues(value: unknown): { id: string; name: string }[] {
	const out: { id: string; name: string }[] = [];
	const seen = new Set<string>();
	const visit = (entries: unknown, depth = 0) => {
		if (!Array.isArray(entries) || depth > 8) return;
		for (const raw of entries) {
			if (raw === null || typeof raw !== "object") continue;
			const entry = raw as Record<string, unknown>;
			const id = nonempty(entry.value);
			if (id) {
				if (!seen.has(id)) {
					seen.add(id);
					out.push({ id, name: nonempty(entry.name)?.trim() ?? id });
				}
			} else visit(entry.options, depth + 1);
		}
	};
	visit(value);
	return out;
}

const configOptions = (result: unknown): Record<string, unknown>[] => {
	const options = (result as { configOptions?: unknown } | null)?.configOptions;
	return Array.isArray(options) ? options.filter((o): o is Record<string, unknown> => o !== null && typeof o === "object") : [];
};

/** The session's model option, and the thinking-level option: the ids the server calls them. */
export function modelOptionOf(result: unknown): { currentValue?: string; options: { id: string; name: string }[] } | null {
	const option = configOptions(result).find((o) => o.type === "select" && o.id === "model");
	return option ? { ...(nonempty(option.currentValue) ? { currentValue: nonempty(option.currentValue) } : {}), options: selectValues(option.options) } : null;
}

export function variantOptionOf(result: unknown): { configId: string; options: { id: string; name: string }[]; currentValue?: string } | null {
	const option = configOptions(result).find((o) => o.type === "select" && nonempty(o.id) && (o.id === "effort" || o.id === "reasoning_effort" || o.id === "thought_level" || o.id === "thinking" || o.category === "thought_level" || o.category === "thinking"));
	return option ? { configId: option.id as string, options: selectValues(option.options), ...(nonempty(option.currentValue) ? { currentValue: nonempty(option.currentValue) } : {}) } : null;
}

/** The catalog a new session names: the models, the default (the session's current one), and the thinking levels of the current model. */
export function catalogFromSession(session: unknown): AntigravityCatalog | null {
	const model = modelOptionOf(session);
	if (!model?.options.length) return null;
	const current = model.currentValue && model.options.some((o) => o.id === model.currentValue) ? model.currentValue : model.options[0]!.id;
	const variants = variantOptionOf(session)?.options ?? [];
	return { default: current, models: model.options.map((o) => ({ id: o.id, name: o.name, variants: o.id === current ? variants : [] })) };
}

/** A new session names thinking levels only for its current model: switching through the rest finds theirs (about 1.5 s each). */
export async function surveyVariants(request: (method: string, params: unknown) => Promise<any>, session: any, catalog: AntigravityCatalog, budgetMs: number): Promise<AntigravityCatalog> {
	const sessionId = session?.sessionId;
	if (typeof sessionId !== "string") return catalog;
	const deadline = Date.now() + budgetMs;
	const found = new Map<string, { id: string; name: string }[]>();
	for (const m of catalog.models) {
		if (m.variants.length) continue;
		const left = deadline - Date.now();
		if (left <= 0) break;
		try {
			const selected = await Promise.race([request("session/set_config_option", { sessionId, configId: "model", value: m.id }), new Promise<never>((_r, reject) => setTimeout(() => reject(new Error("slow")), left))]);
			if (modelOptionOf(selected)?.currentValue !== m.id) continue;
			found.set(m.id, variantOptionOf(selected)?.options ?? []);
		} catch {
			break;
		}
	}
	return { ...catalog, models: catalog.models.map((m) => (found.get(m.id)?.length ? { ...m, variants: found.get(m.id)! } : m)) };
}

export const profileKey = (id: string): string => createHash("sha256").update(id).digest("hex").slice(0, 12);

/** The token file's presence says "signed in"; the account's name needs Google, so it is looked up there (see account.ts). */
export async function readStoredSignIn(tokenPath: string): Promise<{ client_id: string; client_secret: string; refresh_token: string } | null> {
	try {
		const c = JSON.parse(await readFile(tokenPath, "utf8"));
		return ["client_id", "client_secret", "refresh_token"].every((k) => typeof c?.[k] === "string" && c[k].length > 0) ? c : null;
	} catch {
		return null;
	}
}
