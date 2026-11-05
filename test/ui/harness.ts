// Mounts the real renderer App in jsdom, with window.bv calling a real in-process AppApi on a temp folder.
// No browser, no Electron: it catches render crashes ("black screen") and wrong wiring between screens and the API.
import { JSDOM } from "jsdom";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppApi, type ApiDeps } from "../../src/main/api.ts";
import { Store } from "../../src/main/store.ts";
import { piFor } from "../helpers.ts";

export interface Harness {
	api: AppApi;
	dir: string;
	picks: { folder: string | null; files: string[] };
	errors: string[];
	window: JSDOM["window"];
	text(): string;
	click(label: string | RegExp): Promise<void>;
	settle(ms?: number): Promise<void>;
	/** clicks a button inside the table row that contains the text */
	clickIn(rowText: string, label: string): Promise<void>;
	type(selector: string, value: string): Promise<void>;
	unmount(): void;
}

const crypto = { available: () => true, encrypt: (s: string) => Buffer.from(s, "utf8"), decrypt: (b: Buffer) => b.toString("utf8") };

export async function mountApp(over: Partial<ApiDeps> = {}, before?: (api: AppApi, dir: string) => void | Promise<void>): Promise<Harness> {
	const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
	const g = globalThis as Record<string, unknown>;
	for (const k of ["window", "document", "HTMLElement", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"])
		Object.defineProperty(g, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
	g.IS_REACT_ACT_ENVIRONMENT = true;
	(dom.window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

	const dir = mkdtempSync(join(tmpdir(), "bvui-"));
	const store = new Store(join(dir, "data"), crypto);
	const channels: Record<string, Set<(e: unknown) => void>> = { "agent:event": new Set(), "gather:event": new Set() };
	/** what the native dialogs return; a test sets these before clicking */
	const picks: { folder: string | null; files: string[] } = { folder: null, files: [] };
	const api = new AppApi({
		store,
		engine: { id: "pi", status: async () => ({ id: "pi", ready: false, reason: "Ievadi Anthropic API atslēgu.", canLogin: false }), run: async () => {} } as never,
		pi: piFor(store),
		serverJs: "server.js",
		dataDir: join(import.meta.dirname, "..", "..", "data"),
		emit: (c, e) => channels[c]?.forEach((l) => l(e)),
		...over,
	});
	await before?.(api, dir);
	const errors: string[] = [];
	(dom.window as unknown as { bv: unknown }).bv = {
		api: async (m: string, ...a: unknown[]) => (api as unknown as Record<string, (...x: unknown[]) => unknown>)[m](...a),
		pickFolder: async () => picks.folder,
		pickFiles: async () => picks.files,
		onAgent: (cb: (e: unknown) => void) => (channels["agent:event"].add(cb), () => channels["agent:event"].delete(cb)),
		onGather: (cb: (e: unknown) => void) => (channels["gather:event"].add(cb), () => channels["gather:event"].delete(cb)),
		onLogin: () => () => {},
		openExternal: () => {},
	};

	const { act, createElement } = await import("react");
	const { createRoot } = await import("react-dom/client");
	const { App } = await import("../../src/renderer/App.tsx");
	const root = createRoot(dom.window.document.getElementById("root")!, {
		onUncaughtError: (e) => errors.push(String((e as Error)?.stack ?? e)),
		onCaughtError: (e) => errors.push(String((e as Error)?.stack ?? e)),
	});
	await act(async () => root.render(createElement(App)));
	const settle = async (ms = 60) => {
		await act(async () => {
			await new Promise((r) => setTimeout(r, ms));
		});
	};
	await settle();
	const all = () => [...dom.window.document.querySelectorAll("button, a, summary")] as HTMLElement[];
	return {
		api,
		dir,
		picks,
		errors,
		window: dom.window,
		text: () => dom.window.document.body.textContent ?? "",
		async click(label) {
			const enabled = all().filter((b) => !(b as HTMLButtonElement).disabled);
			const el =
				typeof label === "string"
					? (enabled.find((b) => b.textContent?.trim() === label) ?? enabled.find((b) => b.textContent?.includes(label)))
					: enabled.find((b) => label.test(b.textContent ?? ""));
			if (!el) throw new Error(`no button "${label}" in: ${all().map((b) => b.textContent?.trim()).join(" | ")}`);
			await act(async () => {
				el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
			});
			await settle();
		},
		settle,
		async clickIn(rowText, label) {
			const row = [...dom.window.document.querySelectorAll("tr")].find((r) => r.textContent?.includes(rowText));
			const el = row && ([...row.querySelectorAll("button")] as HTMLButtonElement[]).find((b) => !b.disabled && b.textContent?.trim() === label);
			if (!el) throw new Error(`no "${label}" in the row "${rowText}"`);
			await act(async () => {
				el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
			});
			await settle();
		},
		async type(selector: string, value: string) {
			const el = dom.window.document.querySelector(selector) as HTMLTextAreaElement | HTMLInputElement | null;
			if (!el) throw new Error(`no ${selector}`);
			const proto = el instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
			await act(async () => {
				Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
				el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
			});
		},
		unmount: () => root.unmount(),
	};
}
