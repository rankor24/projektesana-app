// Files the user attaches to a chat message: screenshots pasted with Ctrl+V, files dropped on the dock or picked with 📎.
// pi carries text and images only, so an image goes to the model as an image, and a document goes as its text, read by
// the same readers the sources use (sources/text). Anything else is refused with the reason, before the run starts.
// Pure apart from writing the received bytes into the run folder (the record of what the agent was shown).
import type { ImageContent } from "@earendil-works/pi-ai";
import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { ChatAttachment, ChatAttachmentRef, FileCost } from "../shared/api.js";
import { extractBytes, TEXT_FORMATS } from "../sources/text/index.js";
import { DEFAULT_IMAGE_LIMITS, estimateTextTokens, IMAGE_TOKENS, type ImageLimits } from "./context.js";

export const ATTACH_LIMITS = {
	files: 10,
	docBytes: 30 * 1024 * 1024,
	/** characters of one document's text the model gets; the rest is cut and the cut is said */
	docChars: 60_000,
	/** all documents of one message together */
	totalDocChars: 150_000,
	/** the transcript keeps a small preview of each image, not the image */
	thumbChars: 40_000,
	/** of a model's stated request limit, the share the new images of one message may use (the rest is the conversation) */
	requestShare: 0.8,
} as const;

export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const isImage = (mime: string) => (IMAGE_MIMES as readonly string[]).includes(mime);

export interface PreparedAttachments {
	images: ImageContent[];
	/** goes into the prompt after the user's text; "" when nothing is attached */
	text: string;
	/** what the transcript remembers */
	refs: ChatAttachmentRef[];
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} kB`);

/** A file name safe to write into the run folder and to show; keeps the extension. */
export function safeName(name: string, i: number): string {
	const n = (name || `pielikums-${i + 1}`).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(-120);
	return n || `pielikums-${i + 1}`;
}

/** The text of a document as it goes into the prompt, or throws with why it cannot. `room` = characters left for it. */
async function readDocument(a: ChatAttachment, name: string, bytes: Buffer, room: number): Promise<{ block: string; used: number; pages: number; cut: boolean }> {
	const ext = extname(name).toLowerCase();
	if (a.mimeType.startsWith("image/")) throw new Error(`Attēla formāts ${a.mimeType} netiek nosūtīts. Der PNG, JPG, WebP, GIF.`);
	if (!TEXT_FORMATS.has(ext)) throw new Error(`Formāts ${ext || "(bez paplašinājuma)"} ("${name}") netiek lasīts. Der attēli (PNG, JPG, WebP, GIF) un ${[...TEXT_FORMATS].map((e) => e.slice(1).toUpperCase()).join(", ")}.`);
	if (bytes.length > ATTACH_LIMITS.docBytes) throw new Error(`Dokuments "${name}" ir ${kb(bytes.length)}; pieņem līdz ${kb(ATTACH_LIMITS.docBytes)}. Lielam dokumentam pievieno to kā avotu (Avoti).`);
	const ex = await extractBytes(ext, new Uint8Array(bytes));
	if (ex.state !== "ok") throw new Error(`No "${name}" neizdevās nolasīt tekstu: ${ex.reason ?? ex.state}. Skenētam dokumentam pievieno lapas ekrānuzņēmumu.`);

	const paged = ex.pages.length > 1 ? ex.pages.map((p, n) => `[lpp. ${n + 1}]\n${p.trim()}`).join("\n\n") : (ex.pages[0] ?? "").trim();
	const take = Math.max(0, Math.min(ATTACH_LIMITS.docChars, room));
	const cut = paged.length > take;
	const body = cut ? `${paged.slice(0, take)}\n[… saīsināts: ${take} no ${paged.length} zīmēm]` : paged;
	const pages = ex.pages.length > 1 ? `, ${ex.pages.length} lpp.` : "";
	const gaps = ex.emptyPages?.length ? `; bez teksta slāņa: lpp. ${ex.emptyPages.join(", ")}` : "";
	return { block: `--- pielikums: ${name} (${ext.slice(1).toUpperCase()}${pages}${gaps}) ---\n${body}\n--- beigas: ${name} ---`, used: Math.min(paged.length, take), pages: ex.pages.length, cut };
}

/** What one file will add to the context; refuses a file that could not be sent, so the window can say so when it is attached. */
export async function measureAttachment(a: ChatAttachment): Promise<FileCost> {
	const name = safeName(a.name, 0);
	const bytes = Buffer.from(a.data, "base64");
	if (!bytes.length) throw new Error(`Pielikums "${name}" ir tukšs.`);
	if (isImage(a.mimeType)) return { kind: "image", tokens: IMAGE_TOKENS };
	const d = await readDocument(a, name, bytes, ATTACH_LIMITS.totalDocChars);
	return { kind: "document", tokens: estimateTextTokens(d.block), pages: d.pages, cut: d.cut, chars: d.used };
}

/**
 * Checks, reads and splits the attachments. Throws with a Latvian reason the chat shows; nothing has started yet.
 * `limits` are the model's own (null = it takes no images); `imagesInContext` = screenshots the conversation still carries.
 */
export async function prepareAttachments(
	list: ChatAttachment[],
	o: { seesImages: boolean; model: string; saveDir?: string; limits?: ImageLimits | null; imagesInContext?: number },
): Promise<PreparedAttachments> {
	const out: PreparedAttachments = { images: [], text: "", refs: [] };
	if (!list.length) return out;
	if (list.length > ATTACH_LIMITS.files) throw new Error(`Par daudz pielikumu: ${list.length} (vienā ziņojumā līdz ${ATTACH_LIMITS.files}).`);
	const limits = o.limits ?? DEFAULT_IMAGE_LIMITS;

	const docs: string[] = [];
	const imageNames: string[] = [];
	let total = 0;
	let imageBytes = 0;
	for (const [i, a] of list.entries()) {
		const name = safeName(a.name, i);
		const bytes = Buffer.from(a.data, "base64");
		if (!bytes.length) throw new Error(`Pielikums "${name}" ir tukšs.`);
		if (o.saveDir) {
			mkdirSync(o.saveDir, { recursive: true });
			writeFileSync(join(o.saveDir, `${String(i + 1).padStart(2, "0")}-${name}`), bytes);
		}

		if (isImage(a.mimeType)) {
			if (!o.seesImages) throw new Error(`Modelis "${o.model}" neredz attēlus, tāpēc "${name}" netiktu parādīts. Iestatījumos izvēlies modeli, kas redz attēlus, vai noņem attēlu.`);
			if (bytes.length > limits.maxBytes) throw new Error(`Attēls "${name}" ir ${kb(bytes.length)}; modelis ${o.model} pieņem līdz ${kb(limits.maxBytes)}.`);
			imageBytes += a.data.length;
			out.images.push({ type: "image", data: a.data, mimeType: a.mimeType });
			imageNames.push(name);
			out.refs.push({ name, kind: "image", thumb: a.thumb && a.thumb.length <= ATTACH_LIMITS.thumbChars ? a.thumb : undefined });
			continue;
		}

		const d = await readDocument(a, name, bytes, ATTACH_LIMITS.totalDocChars - total);
		total += d.used;
		docs.push(d.block);
		out.refs.push({ name, kind: "document" });
	}

	// what the provider states for one request: how many images, how many bytes
	if (limits.maxPerRequest !== null && out.images.length + (o.imagesInContext ?? 0) > limits.maxPerRequest) {
		throw new Error(`Modelis ${o.model} pieņem līdz ${limits.maxPerRequest} attēliem vienā pieprasījumā; sarunā jau ir ${o.imagesInContext ?? 0}. Sāc jaunu sarunu vai pievieno mazāk attēlu.`);
	}
	if (limits.maxRequestBytes !== null && imageBytes > limits.maxRequestBytes * ATTACH_LIMITS.requestShare) {
		throw new Error(`Attēli kopā (${kb(imageBytes)}) pārsniedz to, ko ${o.model} pieņem vienā pieprasījumā (${kb(limits.maxRequestBytes)}). Pievieno mazāk attēlu.`);
	}

	const parts: string[] = [];
	if (imageNames.length) parts.push(`Pievienotie attēli (tādā secībā, kā pievienoti): ${imageNames.join(", ")}.`);
	if (docs.length) parts.push(`Pievienotie dokumenti (teksts nolasīts lietotnē; citē kā "pielikums: <nosaukums>, lpp."):\n${docs.join("\n\n")}`);
	out.text = parts.join("\n\n");
	return out;
}
