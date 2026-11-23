// Reads what someone pasted to add an MCP server to an agent: `claude mcp add …`, `claude mcp add-json …`, an `npx` / `uvx` / `docker run` line, a server address,
// or an `mcpServers` JSON block. Node-free: the agent settings dialog parses in the window and shows the result before anything is saved.
//
// Ported from OpenMausBot (Apache-2.0) src/lib/mcp-paste.ts (`readMcpPaste`, `shellCommands`, `fromClaudeAdd`, `fromClaudeAddJson`, `fromLauncher`, `dockerServer`,
// `entryServer`, `remoteServer`, `gapIn`, `hostName`, `packageName`, `uniqueNames`) and shared/mcp-name.ts (`slugMcpName`, `importedMcpServerName`). The parsing
// is theirs as it stands; its test cases (src/lib/mcp-paste.test.ts) are the checklist of test/mcp-paste.test.ts.
// Adapted: the result is this app's `AgentMcpServer` (shared/agent-types.ts) plus `gaps`, the names of the secrets the paste could not give (a `$TOKEN` from the other
// person's terminal, a `YOUR_API_KEY` from the instructions): those are left empty, never saved as written, and the dialog asks for them. The refusal texts are Latvian
// sentences, not message keys, and the server names that are kept are the two of this app (projektesana-tools, revit) instead of OpenMausBot's twelve.
import type { AgentMcpServer } from "./agent-types.js";

export interface PastedServer {
	server: AgentMcpServer;
	/** the environment variables and headers whose value the paste did not give (empty in `server`): the dialog asks for them */
	gaps: string[];
}

export type McpPaste = { ok: true; servers: PastedServer[] } | { ok: false; error: string };

const RESERVED = new Set(["projektesana-tools", "revit"]);

/** A server name from any text: lower case letters, digits, `_` and `-`, starting with a letter, at most 32. */
export function slugMcpName(raw: string): string {
	const slug = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
	return /^[a-z]/.test(slug) ? slug : slug ? `mcp-${slug}`.slice(0, 32).replace(/-+$/, "") : "";
}

/** The name of a server another tool calls `raw`; a name this app keeps for itself gets an mcp- prefix. */
export function importedMcpServerName(raw: string): string {
	const slug = slugMcpName(raw);
	return RESERVED.has(slug) ? `mcp-${slug}`.slice(0, 32) : slug;
}

type Secret = { name: string; value: string; gap?: boolean };
type Parsed = { name: string; command?: string; args?: string[]; env?: Secret[]; url?: string; headers?: Secret[] };

class PasteError extends Error {}
const fail = (text: string): never => {
	throw new PasteError(text);
};
const NOT_RECOGNIZED = "Šis nav MCP servera apraksts. Ielīmē «claude mcp add …», «claude mcp add-json …», npx / uvx / docker run rindu, servera adresi vai mcpServers JSON.";
const BAD_JSON = "JSON nav derīgs.";
const INCOMPLETE = "Trūkst servera nosaukuma vai komandas / adreses.";
const URL_GAP = "Servera adresē ir mainīgais vai vietturis (piem. <tenant>): ievadi īsto adresi.";
const BAD_PAIR = "Mainīgajam vai galvenei jābūt formā NOSAUKUMS=vērtība vai Galvene: vērtība.";

const URL_START = /^https?:\/\//i;
const ENV_PAIR = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HEADER_PAIR = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+:/;
const LAUNCHERS = new Set(["npx", "uvx", "bunx"]);
const DLX = new Set(["pnpm", "yarn"]);

/** Null for blank text. `taken` are the names the agent has already, so a name made up from an address does not clash. */
export function readMcpPaste(text: string, taken: readonly string[] = []): McpPaste | null {
	const trimmed = normalizeTypography(text).trim();
	if (!trimmed) return null;
	try {
		const parsed = /^[{[]/.test(trimmed) ? fromJson(trimmed) : URL_START.test(trimmed) && !/\s/.test(trimmed) ? [remoteServer(undefined, trimmed, [])] : fromCommands(trimmed);
		return { ok: true, servers: uniqueNames(parsed, taken).map(toServer) };
	} catch (e) {
		if (e instanceof PasteError) return { ok: false, error: e.message };
		throw e;
	}
}

function toServer(p: Parsed): PastedServer {
	const server: AgentMcpServer = { name: p.name };
	const map = (list: Secret[] | undefined) => Object.fromEntries((list ?? []).map((s) => [s.name, s.gap ? "" : s.value]));
	if (p.url) {
		server.url = p.url;
		if (p.headers?.length) server.headers = map(p.headers);
	} else {
		server.command = p.command;
		if (p.args?.length) server.args = p.args;
		if (p.env?.length) server.env = map(p.env);
	}
	return { server, gaps: [...(p.env ?? []), ...(p.headers ?? [])].filter((s) => s.gap).map((s) => s.name) };
}

/** Word processors and chat apps turn quotes and `--` into typographic ones. */
function normalizeTypography(text: string): string {
	return text.replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/(^|\s)[–—](?=[a-z])/g, "$1--");
}

/** POSIX-shell words, split into commands at newlines, `;` and `&&`. Backslash-, backtick- and caret-newline continue a line. */
export function shellCommands(text: string): string[][] {
	const commands: string[][] = [];
	let words: string[] = [];
	let word = "";
	let inWord = false;
	const endWord = () => {
		if (inWord) words.push(word);
		word = "";
		inWord = false;
	};
	const endCommand = () => {
		endWord();
		if (words.length) commands.push(words);
		words = [];
	};
	const continuation = (at: number) => (text[at] === "\n" ? 1 : text[at] === "\r" && text[at + 1] === "\n" ? 2 : 0);
	for (let i = 0; i < text.length; i += 1) {
		const c = text[i]!;
		if (c === "\\" || ((c === "`" || c === "^") && continuation(i + 1))) {
			const skip = continuation(i + 1);
			if (skip) {
				i += skip;
				continue;
			}
			if (i + 1 < text.length) {
				word += text[i + 1];
				inWord = true;
				i += 1;
			}
			continue;
		}
		if (c === "'") {
			const end = text.indexOf("'", i + 1);
			if (end < 0) fail(NOT_RECOGNIZED);
			word += text.slice(i + 1, end);
			inWord = true;
			i = end;
			continue;
		}
		if (c === '"') {
			let j = i + 1;
			for (; j < text.length && text[j] !== '"'; j += 1) {
				if (text[j] === "\\" && j + 1 < text.length) {
					const skip = continuation(j + 1);
					if (skip) {
						j += skip;
						continue;
					}
					if ('"\\$`'.includes(text[j + 1]!)) {
						word += text[j + 1];
						j += 1;
						continue;
					}
				}
				word += text[j];
			}
			if (j >= text.length) fail(NOT_RECOGNIZED);
			inWord = true;
			i = j;
			continue;
		}
		if (c === "$" && text[i + 1] === "(") {
			const end = text.indexOf(")", i + 2);
			if (end < 0) fail(NOT_RECOGNIZED);
			word += text.slice(i, end + 1);
			inWord = true;
			i = end;
			continue;
		}
		if (c === "#" && !inWord) {
			while (i + 1 < text.length && text[i + 1] !== "\n") i += 1;
			continue;
		}
		if (c === "\n" || c === ";") {
			endCommand();
			continue;
		}
		if (c === "&" && text[i + 1] === "&") {
			endCommand();
			i += 1;
			continue;
		}
		if (/\s/.test(c)) {
			endWord();
			continue;
		}
		word += c;
		inWord = true;
	}
	endCommand();
	return commands;
}

function fromCommands(text: string): Parsed[] {
	const commands = shellCommands(text);
	if (!commands.length) fail(NOT_RECOGNIZED);
	return commands.map((words) => {
		const command = words[0] === "$" || words[0] === ">" ? words.slice(1) : words;
		if (command[0] === "claude" && command[1] === "mcp" && command[2] === "add") return fromClaudeAdd(command.slice(3));
		if (command[0] === "claude" && command[1] === "mcp" && command[2] === "add-json") return fromClaudeAddJson(command.slice(3));
		return fromLauncher(command);
	});
}

/** `claude mcp add [options] <name> <commandOrUrl> [args...]`, with options anywhere before `--`, as Claude Code's parser takes them. */
function fromClaudeAdd(args: string[]): Parsed {
	let transport: string | undefined;
	const headers: string[] = [];
	const env: string[] = [];
	const positionals: string[] = [];
	let afterDashes: string[] = [];
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i]!;
		if (arg === "--") {
			afterDashes = args.slice(i + 1);
			break;
		}
		const option = /^(--[a-z][a-z-]*|-[a-zA-Z])(?:=([\s\S]*))?$/.exec(arg);
		if (!option) {
			positionals.push(arg);
			continue;
		}
		const value = () => option[2] ?? args[++i] ?? "";
		// `-e A=1 B=2` and `-H "X: y" "Z: w"`: the option takes every following word that looks like its pair
		const more = (pattern: RegExp, into: string[]) => {
			while (i + 1 < args.length && pattern.test(args[i + 1]!) && !URL_START.test(args[i + 1]!)) into.push(args[++i]!);
		};
		switch (option[1]) {
			case "--transport":
			case "-t":
				transport = value().toLowerCase();
				break;
			case "--header":
			case "-H":
				headers.push(value());
				if (option[2] === undefined) more(HEADER_PAIR, headers);
				break;
			case "--env":
			case "-e":
				env.push(value());
				if (option[2] === undefined) more(ENV_PAIR, env);
				break;
			case "--scope":
			case "-s":
			case "--callback-port":
			case "--client-id":
				value();
				break;
			default:
				break;
		}
	}
	const [name, target, ...rest] = [...positionals, ...afterDashes];
	if (!name || !target) fail(INCOMPLETE);
	if (transport !== "stdio" && (transport === "http" || transport === "sse" || URL_START.test(target!))) return remoteServer(name, target!, headers.map(headerSecret));
	return { name: importedMcpServerName(name!), command: target, args: rest, env: env.map(envSecret) };
}

/** `claude mcp add-json [options] <name> <json>`: one server's entry. */
function fromClaudeAddJson(args: string[]): Parsed {
	const positionals: string[] = [];
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i]!;
		if (arg === "--scope" || arg === "-s") {
			i += 1;
			continue;
		}
		if (arg.startsWith("-") && !arg.startsWith("{")) continue;
		positionals.push(arg);
	}
	const [name, json] = positionals;
	if (!name || !json) fail(INCOMPLETE);
	const server = entryServer(name, parseJson(json!));
	if (!server) fail(NOT_RECOGNIZED);
	return server!;
}

/** A bare `npx …`, `uvx …`, `pnpm dlx …` or `docker run …` line, with any `KEY=value` before it. */
function fromLauncher(words: string[]): Parsed {
	let at = 0;
	const env: Secret[] = [];
	while (at < words.length && ENV_PAIR.test(words[at]!)) env.push(envSecret(words[at++]!));
	const [command, ...args] = words.slice(at);
	if (!command) fail(NOT_RECOGNIZED);
	if (command === "docker" && args[0] === "run") return dockerServer(args, env);
	if (!LAUNCHERS.has(command!) && !(DLX.has(command!) && args[0] === "dlx")) fail(NOT_RECOGNIZED);
	const packageArg = args.find((arg, index) => !arg.startsWith("-") && !(index === 0 && arg === "dlx"));
	if (!packageArg) fail(INCOMPLETE);
	return { name: packageName(packageArg!), command, args, env };
}

const DOCKER_FLAGS = new Set(["-i", "-t", "-it", "-ti", "-d", "--rm", "--init", "--interactive", "--tty", "--detach", "--privileged"]);

/** Security: `-e KEY=value` would show the value in the arguments, so it moves to the environment and docker is told `-e KEY` (pass it through). */
function dockerServer(args: string[], env: Secret[]): Parsed {
	const out: string[] = [args[0]!];
	let image: string | undefined;
	for (let i = 1; i < args.length; i += 1) {
		const arg = args[i]!;
		if (image || !arg.startsWith("-")) {
			image ??= arg;
			out.push(arg);
		} else if ((arg === "-e" || arg === "--env") && i + 1 < args.length) {
			const pair = args[++i]!;
			const name = pair.split("=")[0]!;
			env.push(pair.includes("=") ? envSecret(pair) : { name, value: "", gap: true });
			out.push(arg, name);
		} else if (arg.includes("=") || DOCKER_FLAGS.has(arg) || i + 1 >= args.length) {
			out.push(arg);
		} else {
			out.push(arg, args[++i]!);
		}
	}
	if (!image) fail(INCOMPLETE);
	return { name: packageName(image!.replace(/:[^/:]*$/, "")), command: "docker", args: out, env };
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return fail(BAD_JSON);
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** `{"mcpServers": {...}}` (Claude Code, Cursor, Claude Desktop), `{"servers": {...}}` (VS Code), a bare `{name: entry}` map, or one entry, with or without a `name`. */
function fromJson(text: string): Parsed[] {
	const root = parseJson(text);
	if (!isRecord(root)) return fail(NOT_RECOGNIZED);
	const single = entryServer(typeof root.name === "string" ? root.name : undefined, root);
	if (single) return [single];
	const block = isRecord(root.mcpServers) ? root.mcpServers : isRecord(root.servers) ? root.servers : root;
	const servers = Object.entries(block).map(([name, entry]) => entryServer(name, entry));
	if (!servers.length || servers.some((server) => !server)) fail(NOT_RECOGNIZED);
	return servers as Parsed[];
}

const strings = (value: unknown): Array<[string, string]> => (isRecord(value) ? Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string") : []);

function entryServer(name: string | undefined, entry: unknown): Parsed | null {
	if (!isRecord(entry)) return null;
	const url = typeof entry.url === "string" ? entry.url : typeof entry.serverUrl === "string" ? entry.serverUrl : undefined;
	if (url !== undefined) return remoteServer(name, url, strings(entry.headers).map(([key, value]) => secret(key, value)));
	if (typeof entry.command !== "string" || !entry.command.trim()) return null;
	const listed = Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === "string") : [];
	const [command, ...inline] = listed.length ? [entry.command.trim()] : (shellCommands(entry.command)[0] ?? [entry.command]);
	const env = strings(entry.env).map(([key, value]) => secret(key, value));
	const all = [...inline, ...listed];
	return { name: name ? importedMcpServerName(name) : packageName(all.find((arg) => !arg.startsWith("-")) ?? command ?? ""), command, args: all, env };
}

function remoteServer(name: string | undefined, url: string, headers: Secret[]): Parsed {
	// an address with a variable or a placeholder in it cannot be reached as written: the user gives the real one
	if (hasGap(url)) fail(URL_GAP);
	return { name: name ? importedMcpServerName(name) : hostName(url), url, headers };
}

function headerSecret(pair: string): Secret {
	const colon = pair.indexOf(":");
	if (colon <= 0) return fail(BAD_PAIR);
	return secret(pair.slice(0, colon).trim(), pair.slice(colon + 1).trim());
}

function envSecret(pair: string): Secret {
	const equals = pair.indexOf("=");
	if (equals <= 0) return fail(BAD_PAIR);
	return secret(pair.slice(0, equals), pair.slice(equals + 1));
}

function secret(name: string, value: string): Secret {
	return hasGap(value) ? { name, value: "", gap: true } : { name, value };
}

const VARIABLE = /\$\{([^}]*)\}|\$\(([^)]*)\)|\$([A-Za-z_][A-Za-z0-9_]*)/;
const PLACEHOLDER = /<([^<>\s][^<>]{0,63})>|\b(YOUR[_-][A-Za-z0-9_-]+|your[_-][a-z0-9_-]+)\b/;

/** A shell variable (`$CF_ID`, `${CF_ID}`, `$(…)`), a config variable (`${env:X}`) or a placeholder (`<api-key>`, `YOUR_API_KEY`): nothing that could be a real value. */
export function hasGap(value: string): boolean {
	return VARIABLE.test(value) || PLACEHOLDER.test(value);
}

const GENERIC_LABELS = new Set(["www", "mcp", "api", "server", "servers", "app", "remote", "sse", "gateway", "co", "com", "org", "net", "ac", "gov"]);

/** A name from an address: mcp.acme.example is "acme". */
function hostName(url: string): string {
	let host: string;
	try {
		host = new URL(url).hostname;
	} catch {
		return "";
	}
	if (/^[\d.]+$/.test(host) || host.includes(":")) return "server";
	const labels = host.split(".").filter(Boolean);
	if (labels.length > 1) labels.pop();
	return importedMcpServerName(labels.filter((label) => !GENERIC_LABELS.has(label)).at(-1) ?? labels.at(-1) ?? "server");
}

/** A name from a package or image: @modelcontextprotocol/server-github is "github", mcp-server-fetch is "fetch". */
function packageName(spec: string): string {
	const parts = spec.replace(/(?!^)@[^/@]*$/, "").split("/");
	const base = parts.at(-1) ?? spec;
	const stem = base.replace(/^(?:mcp-server-|server-|mcp-)/, "").replace(/(?:-mcp-server|-mcp|-server)$/, "");
	const scope = (parts.at(-2) ?? "").replace(/^@/, "");
	return importedMcpServerName(GENERIC_LABELS.has(stem) && scope ? scope : stem || base) || "server";
}

/** A taken name gets -2, -3…, so adding never overwrites a server already there. */
function uniqueNames(servers: Parsed[], taken: readonly string[]): Parsed[] {
	const used = new Set(taken);
	return servers.map((server) => {
		let name = server.name || "server";
		if (used.has(name)) {
			for (let n = 2; used.has(name); n += 1) name = slugMcpName(`${server.name.slice(0, 29)}-${n}`);
		}
		used.add(name);
		return name === server.name ? server : { ...server, name };
	});
}
