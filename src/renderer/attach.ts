// Turns a File the user pasted, dropped or picked into what agent.send carries. Images are downscaled here, in the
// window, because pi sends them as they are and providers refuse large ones (Anthropic: 5 MB, ~8000 px a side) or
// shrink them anyway. A screenshot of a 4K screen is cut to 2000 px on its long side: UI text stays readable.
import type { ChatAttachment, FileCost } from "../shared/api";
import { IMAGE_TOKENS } from "../shared/tokens";
import { call } from "./bridge";

export interface Pending extends ChatAttachment {
	/** local key for the strip */
	key: string;
	kind: "image" | "document";
	/** bytes after downscaling */
	size: number;
	/** what it adds to the context: images by pi's flat estimate at once, documents as the main process read them */
	cost: FileCost;
}

/** The model's own image limits (agent.status); until they are known, what every vision model in pi's catalog states. */
export type Limits = { maxEdge: number; maxBytes: number };
const DEFAULT_LIMITS: Limits = { maxEdge: 2000, maxBytes: 4_718_592 };
const MAX_DOC_BYTES = 30 * 1024 * 1024;
const THUMB_EDGE = 240;
const SENT_IMAGES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** What the 📎 picker offers; the main process checks again. */
export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.xlsx,.txt,.md,.csv,.tsv,.json,.xml,.html,.htm";

let n = 0;

/** Clipboard screenshots arrive named "image.png"; give them a name that says what and when. */
function nameOf(f: File): string {
	if (f.name && f.name !== "image.png") return f.name;
	const t = new Date();
	const p = (x: number) => String(x).padStart(2, "0");
	return `ekranuzn-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}-${++n}.png`;
}

function base64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
		r.onerror = () => reject(r.error ?? new Error("Neizdevās nolasīt failu."));
		r.readAsDataURL(blob);
	});
}

function draw(img: ImageBitmap, edge: number): HTMLCanvasElement {
	const k = Math.min(1, edge / Math.max(img.width, img.height));
	const c = document.createElement("canvas");
	c.width = Math.max(1, Math.round(img.width * k));
	c.height = Math.max(1, Math.round(img.height * k));
	const g = c.getContext("2d");
	if (!g) throw new Error("Attēlu neizdevās sagatavot (canvas).");
	g.imageSmoothingQuality = "high";
	g.drawImage(img, 0, 0, c.width, c.height);
	return c;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
	new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Attēlu neizdevās saspiest."))), type, q));

/** The image as the model gets it: as it is when small enough, else downscaled; PNG first (sharp text), JPEG if PNG stays too big. */
async function shrink(f: File, img: ImageBitmap, lim: Limits): Promise<Blob> {
	const fits = Math.max(img.width, img.height) <= lim.maxEdge && f.size <= lim.maxBytes;
	if (fits && SENT_IMAGES.includes(f.type)) return f;
	const c = draw(img, lim.maxEdge);
	const png = await toBlob(c, "image/png");
	if (png.size <= lim.maxBytes) return png;
	for (const q of [0.92, 0.85, 0.75]) {
		const jpg = await toBlob(c, "image/jpeg", q);
		if (jpg.size <= lim.maxBytes) return jpg;
	}
	throw new Error(`Attēls "${f.name}" ir par lielu arī pēc samazināšanas.`);
}

const withExt = (name: string, mime: string) => {
	const ext = mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : null;
	return ext && !name.toLowerCase().endsWith(ext) ? name.replace(/\.[^.]+$/, "") + ext : name;
};

/** Reads, downscales (images) and measures (documents, by the main process, which refuses what cannot be sent) one file. */
export async function readAttachment(f: File, limits?: Limits | null): Promise<Pending> {
	const name = nameOf(f);
	const key = `${name}:${f.size}:${++n}`;
	if (f.type.startsWith("image/")) {
		let img: ImageBitmap;
		try {
			img = await createImageBitmap(f);
		} catch {
			throw new Error(`"${name}" nav nolasāms attēls.`);
		}
		try {
			const blob = await shrink(f, img, limits ?? DEFAULT_LIMITS);
			const thumb = draw(img, THUMB_EDGE).toDataURL("image/jpeg", 0.7);
			return { key, kind: "image", name: withExt(name, blob.type), mimeType: blob.type, data: await base64(blob), thumb, size: blob.size, cost: { kind: "image", tokens: IMAGE_TOKENS } };
		} finally {
			img.close();
		}
	}
	if (f.size > MAX_DOC_BYTES) throw new Error(`"${name}" ir ${(f.size / 1024 / 1024).toFixed(1)} MB; pieņem līdz 30 MB.`);
	const att = { name, mimeType: f.type || "application/octet-stream", data: await base64(f) };
	// the main process reads the text; a scanned PDF or an unknown format is refused here, not when sending
	const cost = await call("agent.measureFile", att);
	return { key, kind: "document", ...att, size: f.size, cost };
}

/** Files from a paste, unless it is text: copying cells from Excel puts text and a picture of them on the clipboard. */
export function pastedFiles(d: DataTransfer): File[] {
	const files = [...d.files];
	if (!files.length) return [];
	const text = d.types.includes("text/plain") ? d.getData("text/plain").trim() : "";
	if (text && files.every((f) => f.type.startsWith("image/"))) return [];
	return files;
}

export const sizeText = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);
