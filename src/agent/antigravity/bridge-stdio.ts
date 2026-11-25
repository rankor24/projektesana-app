// The relay Google's Antigravity server starts as an MCP server: it reads MCP's JSON lines from its stdin, passes each to the app's tool bridge
// (bridge.ts) at PROJEKTESANA_BRIDGE_URL with the run's token, and writes the answers to stdout. It runs on Electron's own node (ELECTRON_RUN_AS_NODE=1),
// from dist/agent/antigravity/bridge-stdio.js, like the tools server. Nothing but the two variables reaches it; it holds no state.
import { createInterface } from "node:readline";

const url = process.env.PROJEKTESANA_BRIDGE_URL ?? "";
const token = process.env.PROJEKTESANA_BRIDGE_TOKEN ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url) || !token) {
	process.stderr.write("bridge-stdio: the bridge address or token is missing\n");
	process.exit(2);
}

const out = (obj: unknown): void => void process.stdout.write(`${JSON.stringify(obj)}\n`);
const failure = (id: unknown, message: string) => out({ jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message } });

const pending = new Set<Promise<void>>();

async function relay(line: string): Promise<void> {
	let message: { id?: unknown } | { id?: unknown }[];
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	const id = Array.isArray(message) ? undefined : message.id;
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
			body: line,
		});
		// a notification has no answer (202 with no body)
		if (res.status === 202 || id === undefined) return void (await res.arrayBuffer().catch(() => undefined));
		const body = await res.text();
		if (!res.ok && !body.trim()) return failure(id, `the app's tool bridge answered ${res.status}`);
		out(JSON.parse(body));
	} catch (e) {
		if (id !== undefined) failure(id, `the app's tool bridge is not reachable: ${(e as Error).message}`);
	}
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
	if (!line.trim()) return;
	const p = relay(line).finally(() => pending.delete(p));
	pending.add(p);
});
// the server closed our stdin: answer what is open, then leave
lines.on("close", () => void Promise.allSettled([...pending]).then(() => process.exit(0)));
