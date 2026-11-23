// The agent's way into the app (2.6.9): the tools server runs in its own process for each agent run, the app's calls live
// here in main. A small HTTP server on 127.0.0.1 (a random port, a random token per app start) runs an IPC call for the
// agent's app_* tools with exactly the handler the screens use, and renders a document page as an image for view_page
// (the model reads a scan itself: AI OCR). Two checks on every call: the token, and the call's level (shared/app-calls.ts)
// is the level of the tool that asks, so app_change can never run a call that waits for the user.
import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { extname } from "node:path";
import type { AddressInfo } from "node:net";
import type { Handlers } from "../shared/api.js";
import { APP_CALL_LEVEL, type AppCallLevel } from "../shared/app-calls.js";
import type { Registry } from "../core/registry.js";
import { sourceBytes } from "../sources/bytes.js";
import type { PageRenderer } from "./offscreen.js";
import type { AppSettingsHost } from "./app-settings/host.js";

export interface Bridge {
	url: string;
	token: string;
	close(): void;
}

const body = (req: IncomingMessage): Promise<unknown> =>
	new Promise((resolve, reject) => {
		const parts: Buffer[] = [];
		let size = 0;
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > 2_000_000) reject(new Error("pieprasījums par lielu"));
			else parts.push(c);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}"));
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", reject);
	});

const isBytes = (v: unknown): boolean => v instanceof Uint8Array || (v !== null && typeof v === "object" && Object.values(v as object).some((x) => x instanceof Uint8Array));

export function startAgentBridge(d: { handlers: Handlers; registry: Registry; renderer: PageRenderer; /** the app_settings tool's host (main/app-settings); absent in tests that do not use it */ appSettings?: AppSettingsHost }): Promise<Bridge> {
	const token = randomBytes(24).toString("hex");
	const server = createServer(async (req, res) => {
		const send = (status: number, v: unknown) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(v));
		};
		try {
			if (req.method !== "POST" || req.headers["x-bridge-token"] !== token) return send(403, { error: "nav atļauts" });
			const b = (await body(req)) as Record<string, unknown>;
			if (req.url === "/call") {
				const name = String(b.name ?? "");
				const level = (APP_CALL_LEVEL as Record<string, AppCallLevel>)[name];
				if (!level) return send(400, { error: `Lietotnē nav izsaukuma ${name}. Saraksts: app_calls.` });
				if (level === "never") return send(403, { error: `${name} aģentam nav pieejams (pieteikšanās, logu izkārtojums, faila baiti vai aģenta paša vadība).` });
				if (level !== b.level) return send(403, { error: `${name} ir līmenī «${level}»: izsauc to ar ${level === "read" ? "app_read" : level === "run" ? "app_change" : "app_confirm"}.` });
				const fn = (d.handlers as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
				const args = Array.isArray(b.args) ? b.args : [];
				const result = await fn(...args);
				if (isBytes(result)) return send(400, { error: `${name} atgriež faila baitus, ne datus.` });
				return send(200, { result: result === undefined ? "ok" : result });
			}
			// app_settings (agent/tools/app-settings.ts): find, get, set, undo over the settings registry; the tier of each setting decides what happens
			if (req.url === "/app-settings") {
				if (!d.appSettings) return send(404, { error: "Iestatījumu rīks šeit nav pieejams." });
				const action = String(b.action ?? "");
				if (!["find", "get", "set", "undo"].includes(action)) return send(400, { error: "action: find, get, set vai undo." });
				const r = await d.appSettings.handle({ action: action as "find", query: typeof b.query === "string" ? b.query : undefined, id: typeof b.id === "string" ? b.id : undefined, value: b.value, run: typeof b.run === "string" ? b.run : null, agent: typeof b.agent === "string" ? b.agent : null });
				return r.ok ? send(200, { text: r.text }) : send(400, { error: r.text });
			}
			if (req.url === "/page") {
				const store = d.registry.store(String(b.projectId ?? ""));
				const sourceId = String(b.sourceId ?? "");
				const s = store.read("sources").find((x) => x.id === sourceId);
				if (!s) return send(404, { error: `Avots ${sourceId} nav atrasts.` });
				const name = (s.container?.inner ?? s.paths[0] ?? "").split("::").pop() ?? "";
				const ext = extname(name).toLowerCase();
				const bytes = sourceBytes(store, sourceId);
				if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return send(200, { image: Buffer.from(bytes).toString("base64"), mimeType: ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg", page: 1, pages: 1 });
				if (ext !== ".pdf") return send(400, { error: `${s.title}: lapas attēls ir tikai PDF un attēliem (${ext || "nezināms"}).` });
				const page = Math.max(1, Math.floor(Number(b.page) || 1));
				// scale 2: a scan's small print stays readable for the model, the image under ~2 MB
				const [img] = await d.renderer.render(bytes, [page], Math.min(3, Math.max(1, Number(b.scale) || 2)));
				if (!img) return send(400, { error: `${s.title}: lapa ${page} nav.` });
				return send(200, { image: Buffer.from(img.png).toString("base64"), mimeType: "image/png", page, width: img.width, height: img.height });
			}
			return send(404, { error: "nezināms ceļš" });
		} catch (e) {
			return send(500, { error: (e as Error).message });
		}
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			resolve({ url: `http://127.0.0.1:${port}`, token, close: () => server.close() });
		});
	});
}
