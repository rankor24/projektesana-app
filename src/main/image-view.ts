// An image for the agent's view_image tool (and view_page's `region`): a PNG / JPEG / WebP file, or a PDF page, optionally one part of it, at a size the model reads well.
// Runs in main (Electron's nativeImage decodes and crops; the hidden page renderer draws PDF pages), reached through the agent bridge `/image` (main/agent-bridge.ts).
// Other formats (TIFF, BMP, GIF, EMF, WMF, a DWG's sheet) are turned into PNG or PDF by the tools server before they get here (tools/media.ts), so only these three kinds arrive.
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { PageRenderer } from "./offscreen.js";

export interface Region {
	/** fractions of the picture from its top left corner */
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ViewRequest {
	/** the file (its extension says the kind); with `bytes` only the name matters */
	path: string;
	/** the file's content when it is already in memory (a source of the project) */
	bytes?: Uint8Array;
	page?: number;
	scale?: number;
	region?: Region;
	/** the long side in pixels at most (default 2000, 3000 for a part: a zoom is asked for detail) */
	maxSide?: number;
}

export interface ViewResult {
	image: string;
	mimeType: string;
	width: number;
	height: number;
	page?: number;
	pages?: number;
	note?: string;
}

/** The part of Electron's nativeImage this file uses, so a test can stand in for it. */
export interface NativeLike {
	createFromBuffer(b: Buffer): {
		isEmpty(): boolean;
		getSize(): { width: number; height: number };
		crop(r: { x: number; y: number; width: number; height: number }): ReturnType<NativeLike["createFromBuffer"]>;
		resize(o: { width?: number; height?: number; quality?: "good" | "better" | "best" }): ReturnType<NativeLike["createFromBuffer"]>;
		toPNG(): Buffer;
		toJPEG(q: number): Buffer;
	};
}

const RASTER = new Map([
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".webp", "image/webp"],
]);
/** What the model's image input takes without trouble, in bytes of the base64 text. */
const MAX_BYTES = 4_500_000;

/** The region the tool was given, checked: fractions in 0..1, a part at least 0.5% wide. */
export function cleanRegion(r: unknown): Region | undefined {
	if (r === undefined || r === null) return undefined;
	const o = r as Partial<Region>;
	const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
	const x = n(o.x), y = n(o.y), w = n(o.w), h = n(o.h);
	if ([x, y, w, h].some(Number.isNaN)) throw new Error("region: x, y, w, h kā skaitļi no 0 līdz 1 (daļa no attēla, no kreisā augšējā stūra).");
	if (x < 0 || y < 0 || w <= 0 || h <= 0 || x >= 1 || y >= 1 || w > 1 || h > 1) throw new Error("region: x un y ir [0, 1), w un h ir (0, 1].");
	return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

export async function viewImage(d: { renderer: Pick<PageRenderer, "render" | "renderRegion">; native?: NativeLike }, req: ViewRequest): Promise<ViewResult> {
	const ext = extname(req.path).toLowerCase();
	const region = cleanRegion(req.region);
	const maxSide = Math.min(4000, Math.max(400, Math.round(req.maxSide ?? (region ? 3000 : 2000))));
	if (ext === ".pdf") {
		const bytes = req.bytes ?? readFileSync(req.path);
		const page = Math.max(1, Math.floor(Number(req.page) || 1));
		if (region) {
			const r = await d.renderer.renderRegion(bytes, page, Math.min(8, Math.max(1, Number(req.scale) || 4)), region, maxSide);
			return { image: Buffer.from(r.png).toString("base64"), mimeType: "image/png", width: r.width, height: r.height, page, note: `daļa ${pct(region)}, mērogs ${r.scale.toFixed(1)} (1 = 72 dpi)` };
		}
		const [img] = await d.renderer.render(bytes, [page], Math.min(3, Math.max(1, Number(req.scale) || 2)));
		if (!img) throw new Error(`Lapa ${page} nav.`);
		return { image: Buffer.from(img.png).toString("base64"), mimeType: "image/png", width: img.width, height: img.height, page };
	}
	const mime = RASTER.get(ext);
	if (!mime) throw new Error(`Attēla formāts ${ext || "(bez paplašinājuma)"} šeit nav: izmanto view_image (tas pārveido TIFF, BMP, GIF, EMF, WMF, DWG, DXF) vai convert_file.`);
	if (!d.native) throw new Error("Attēlu apstrāde nav pieejama (nativeImage trūkst).");
	const buf = req.bytes ? Buffer.from(req.bytes) : readFileSync(req.path);
	let img = d.native.createFromBuffer(buf);
	if (img.isEmpty()) {
		// Electron's nativeImage decodes PNG and JPEG only (checked on 43.8.7): a WebP goes to the model as it is, whole, as view_page sent it before 2.17.2
		if (mime !== "image/webp" || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") throw new Error("Attēlu nevar nolasīt (bojāts fails vai nepareizs formāts).");
		if (region) throw new Error("region: WebP attēla daļu šeit nevar izgriezt. Skaties visu attēlu (bez region).");
		if (buf.length * 1.34 > MAX_BYTES) throw new Error("WebP attēls ir par lielu modelim, un šeit to nevar samazināt.");
		return { image: buf.toString("base64"), mimeType: mime, width: 0, height: 0 };
	}
	const full = img.getSize();
	let note: string | undefined;
	let changed = false;
	if (region) {
		img = img.crop({ x: Math.round(region.x * full.width), y: Math.round(region.y * full.height), width: Math.max(1, Math.round(region.w * full.width)), height: Math.max(1, Math.round(region.h * full.height)) });
		changed = true;
		note = `daļa ${pct(region)} no ${full.width}×${full.height}`;
	}
	let { width, height } = img.getSize();
	if (Math.max(width, height) > maxSide) {
		img = width >= height ? img.resize({ width: maxSide, quality: "best" }) : img.resize({ height: maxSide, quality: "best" });
		({ width, height } = img.getSize());
		changed = true;
		note = `${note ? `${note}; ` : ""}samazināts līdz ${width}×${height}`;
	}
	if (!changed && buf.length * 1.34 <= MAX_BYTES) return { image: buf.toString("base64"), mimeType: mime, width, height };
	let out = mime === "image/jpeg" ? img.toJPEG(88) : img.toPNG();
	let outMime = mime === "image/jpeg" ? "image/jpeg" : "image/png";
	// a big PNG (a photo saved as PNG) goes out as JPEG: the model takes a few MB at most
	if (out.length * 1.34 > MAX_BYTES) {
		out = img.toJPEG(85);
		outMime = "image/jpeg";
		note = `${note ? `${note}; ` : ""}saspiests JPEG`;
	}
	return { image: out.toString("base64"), mimeType: outMime, width, height, ...(note ? { note } : {}) };
}

const pct = (r: Region) => `x ${Math.round(r.x * 100)}–${Math.round((r.x + r.w) * 100)}%, y ${Math.round(r.y * 100)}–${Math.round((r.y + r.h) * 100)}%`;
