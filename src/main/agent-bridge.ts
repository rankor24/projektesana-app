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
import { viewImage, type NativeLike } from "./image-view.js";
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

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

export function startAgentBridge(d: { handlers: Handlers; registry: Registry; renderer: PageRenderer; /** the app_settings tool's host (main/app-settings); absent in tests that do not use it */ appSettings?: AppSettingsHost; /** Electron's nativeImage, for view_image (crop, resize); absent in tests */ native?: NativeLike }): Promise<Bridge> {
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
				if (![".png", ".jpg", ".jpeg", ".webp", ".pdf"].includes(ext)) return send(400, { error: `${s.title}: lapas attēls ir tikai PDF un attēliem (${ext || "nezināms"}).` });
				const bytes = sourceBytes(store, sourceId);
				// the same code as view_image: a whole page, or one part of it (region) drawn at its own scale (2.17.2: region was dropped here before)
				const r = await viewImage({ renderer: d.renderer, native: d.native }, { path: name, bytes, page: Number(b.page) || 1, scale: Number(b.scale) || undefined, region: b.region as never });
				return send(200, { ...r, page: r.page ?? 1 });
			}
			// view_image (agent/tools/media.ts): a file on this PC (an image, a PDF page, a sheet the tools server already turned into a PDF), whole or one part of it
			if (req.url === "/image") {
				const path = String(b.path ?? "");
				if (!isAbsolute(path)) return send(400, { error: `view_image: ceļam jābūt pilnam (saņemts «${path}»).` });
				if (!existsSync(path) || !statSync(path).isFile()) return send(404, { error: `Faila nav: ${path}` });
				const r = await viewImage({ renderer: d.renderer, native: d.native }, { path, page: Number(b.page) || undefined, scale: Number(b.scale) || undefined, region: b.region as never });
				return send(200, r);
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
