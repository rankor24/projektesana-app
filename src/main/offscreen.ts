// The hidden page renderer (dist/renderer/offscreen/render.html): PDF pages → PNG through Chromium's canvas.
// One window, created on first use, kept for the session; calls are queued so two scans never share it at once.
import { BrowserWindow } from "electron";
import { join } from "node:path";

export interface RenderedPage {
	page: number;
	png: Uint8Array;
	width: number;
	height: number;
}

export class PageRenderer {
	private win: Promise<BrowserWindow> | null = null;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private rendererDir: string) {}

	private open(): Promise<BrowserWindow> {
		return (this.win ??= (async () => {
			const w = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, nodeIntegration: false } });
			w.on("closed", () => (this.win = null));
			await w.loadFile(join(this.rendererDir, "offscreen", "render.html"));
			// render.ts sets the title once its function is installed
			for (let i = 0; i < 100 && w.webContents.getTitle() !== "ready"; i++) await new Promise((r) => setTimeout(r, 50));
			if (w.webContents.getTitle() !== "ready") throw new Error("Lapu renderētājs neielādējās.");
			return w;
		})());
	}

	/** Renders 1-based pages at `scale` (1 = 72 dpi; 3 ≈ 216 dpi, enough for OCR of A4 text). */
	render(pdf: Uint8Array, pages: number[], scale = 3): Promise<RenderedPage[]> {
		const job = this.queue.then(async () => {
			const w = await this.open();
			const b64 = Buffer.from(pdf).toString("base64");
			const out = (await w.webContents.executeJavaScript(`window.__renderPages(${JSON.stringify(b64)}, ${JSON.stringify(pages)}, ${Number(scale)})`)) as { page: number; png: string; width: number; height: number }[];
			return out.map((p) => ({ page: p.page, width: p.width, height: p.height, png: new Uint8Array(Buffer.from(p.png.slice(p.png.indexOf(",") + 1), "base64")) }));
		});
		this.queue = job.catch(() => undefined);
		return job;
	}

	close() {
		void this.win?.then((w) => w.destroy());
		this.win = null;
	}
}
