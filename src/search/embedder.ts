// The embedding model: text in, a short list of numbers out, so that two texts that mean the same thing get lists that point the
// same way. It runs on the user's own CPU through transformers.js (ONNX Runtime); no project text ever goes to a server.
// The model files (100 MB to a few hundred MB) are NOT in the installer. They are fetched once from Hugging Face into
// <appDir>\models\ the first time the index is built, with progress, and after that loaded from there with remote access
// switched off (so a search never reaches out). A marker file records that a download finished, so a half-fetched model is
// not mistaken for a ready one.
//
// Chosen by a Latvian test on a real project's own text (2026-11-23): 29 questions ("kāds ir zemes kadastra apzīmējums?", the BIP
// stage dates, room areas, who issued a technical regulation ...), each with one fact that sits on a known page, asked against the
// 1366 pieces of 35 sources of one project (many of them OCR text). A question counts as found when a piece holding the fact is
// among the first five results. The same questions were put to the keyword search alone (FTS5, OR of the content words, bm25).
//
//                              meaning alone   words + meaning   speed        files
//   keyword search (no model)                      24/29  83%
//   Granite 97M, fp32            16/29  55%       23/29  79%     3.0 pieces/s  390 MB  Apache-2.0   <- chosen
//   EmbeddingGemma 300M, q8      14/29  48%       25/29  86%     1.1 pieces/s  310 MB  Gemma terms
//   Qwen3-Embedding 0.6B, q8      9/29  31%       20/29  69%     0.4 pieces/s  615 MB  Apache-2.0
//
// ("words + meaning" is the merge as search.ts does it. Speed: 4 CPU threads, a laptop-class PC, other work running meanwhile.)
// Granite is chosen: the best on meaning alone, two to seven times faster than the others (a first build of this project takes
// about ten minutes, the largest model would take an hour), the smallest, Apache-2.0, and Latvian is one of its 52 explicitly
// trained languages. EmbeddingGemma's two-question lead after the merge is within what 29 questions can tell apart, and it costs
// 2.7 times the time. The words alone are already strong on this kind of question (codes, numbers, names), so the vectors earn
// their place on the questions put in other words. The misses that remain, whichever model, are questions whose answer is one row of
// a table (a schedule's duration, a floor's area, the BIP's date table), which is a row of numbers, not a sentence. Cutting pieces shorter (500 characters) made both searches worse.
// Granite's 98 MB int8/q8 files are NOT usable: every vector comes out nearly the same (cosine 0.998 between unrelated sentences),
// the 8-bit quantization breaks that architecture, so the 390 MB fp32 file is used. Qwen3's q8 may suffer the same loss; its
// fp32 file is 2.4 GB, not an option for a download on first use.
//
// Written against the model cards of onnx-community/{Qwen3-Embedding-0.6B-ONNX, embeddinggemma-300m-ONNX,
// granite-embedding-97m-multilingual-r2-ONNX} (pooling, prefixes, MRL sizes) and the transformers.js 4.3 API (AutoTokenizer,
// AutoModel, env.cacheDir). The library is loaded lazily: the tools server and the app start without paying for it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";

export type TextKind = "query" | "doc";
export type Pooling = "cls" | "mean" | "last";

export interface ModelSpec {
	/** short name kept in the database next to every vector; a different one means the vectors must be rebuilt */
	id: string;
	/** the Hugging Face repository with the ONNX weights */
	repo: string;
	/** which weight file: the library maps it to a file name (fp32 → onnx/model.onnx, q8 → onnx/model_quantized.onnx) */
	dtype: "q8" | "q4" | "fp32";
	label: string;
	/** roughly what is downloaded, for the progress text */
	approxMB: number;
	pooling: Pooling;
	/** the model gives its finished sentence vector itself (EmbeddingGemma: pooling and two dense layers are inside the ONNX file) */
	ownVector?: boolean;
	/** size of the vector as the model gives it */
	nativeDims: number;
	/** size kept in the database: Matryoshka-trained models keep their meaning when cut short, so 256 is stored instead of 768 or 1024 */
	storeDims: number;
	maxTokens: number;
	queryPrefix: string;
	docPrefix: string;
	license: string;
}

const QWEN_TASK = "Instruct: Given a question in Latvian, retrieve passages from project documents that answer it\nQuery:";

export const MODELS: Record<string, ModelSpec> = {
	"granite-97m": { id: "granite-97m", repo: "onnx-community/granite-embedding-97m-multilingual-r2-ONNX", dtype: "fp32", label: "IBM Granite Embedding 97M Multilingual R2", approxMB: 390, pooling: "cls", nativeDims: 384, storeDims: 384, maxTokens: 512, queryPrefix: "", docPrefix: "", license: "Apache-2.0" },
	"gemma-300m": { id: "gemma-300m", repo: "onnx-community/embeddinggemma-300m-ONNX", dtype: "q8", label: "EmbeddingGemma 300M", approxMB: 310, pooling: "mean", ownVector: true, nativeDims: 768, storeDims: 256, maxTokens: 512, queryPrefix: "task: search result | query: ", docPrefix: "title: none | text: ", license: "Gemma Terms of Use" },
	"qwen3-0.6b": { id: "qwen3-0.6b", repo: "onnx-community/Qwen3-Embedding-0.6B-ONNX", dtype: "q8", label: "Qwen3-Embedding 0.6B", approxMB: 615, pooling: "last", nativeDims: 1024, storeDims: 256, maxTokens: 512, queryPrefix: QWEN_TASK, docPrefix: "", license: "Apache-2.0" },
};
export const DEFAULT_MODEL_ID = "granite-97m";
export const modelById = (id: string): ModelSpec | null => MODELS[id] ?? null;

export interface Embedder {
	readonly model: string;
	readonly dims: number;
	/** unit-length vectors, in the order of `texts` */
	embed(texts: string[], kind: TextKind): Promise<Float32Array[]>;
	dispose?(): Promise<void>;
}

export interface DownloadProgress {
	file: string;
	/** bytes received so far in this file */
	loaded: number;
	total: number;
}

export interface LoadOptions {
	/** <appDir>\models */
	modelsDir: string;
	/** true: fetch what is missing from Hugging Face; false: files must already be there (a search, the tools server) */
	download: boolean;
	onProgress?: (p: DownloadProgress) => void;
	/** the matrix multiplications use this many threads; the background index uses fewer than a search would */
	threads?: number;
}

const markerFile = (modelsDir: string, spec: ModelSpec) => join(modelsDir, "_ready", `${spec.id}.json`);

/** True when this model was downloaded completely (the marker is written after the first successful load with downloading on). */
export function modelReady(modelsDir: string, spec: ModelSpec): boolean {
	try {
		return existsSync(markerFile(modelsDir, spec)) && (JSON.parse(readFileSync(markerFile(modelsDir, spec), "utf8")) as { repo?: string; dtype?: string }).dtype === spec.dtype;
	} catch {
		return false;
	}
}

/** Unit length: after this a dot product is the cosine. */
export function normalize(v: Float32Array): Float32Array {
	let s = 0;
	for (let i = 0; i < v.length; i++) s += v[i] * v[i];
	const n = Math.sqrt(s) || 1;
	for (let i = 0; i < v.length; i++) v[i] /= n;
	return v;
}

/** The first `dims` numbers of a Matryoshka vector, made unit length again. */
export function truncate(v: Float32Array, dims: number): Float32Array {
	return normalize(v.length > dims ? v.slice(0, dims) : v.slice());
}

export const defaultThreads = () => Math.max(1, Math.min(4, Math.floor(cpus().length / 2)));

interface TensorLike {
	dims: number[];
	data: Float32Array;
}

/** One sentence vector per row of a [batch, tokens, hidden] output, picked by the model's pooling rule. `mask` is the tokenizer's attention mask (1 = a real token), row-major [batch, tokens]. */
export function pool(hidden: TensorLike, mask: ArrayLike<number | bigint>, pooling: Pooling): Float32Array[] {
	const [b, t, h] = hidden.dims;
	const rows: Float32Array[] = [];
	for (let i = 0; i < b; i++) {
		const base = i * t * h;
		const real: number[] = [];
		for (let j = 0; j < t; j++) if (Number(mask[i * t + j]) === 1) real.push(j);
		if (!real.length) real.push(0);
		const out = new Float32Array(h);
		if (pooling === "cls") out.set(hidden.data.subarray(base + real[0] * h, base + (real[0] + 1) * h));
		else if (pooling === "last") out.set(hidden.data.subarray(base + real[real.length - 1] * h, base + (real[real.length - 1] + 1) * h));
		else {
			for (const j of real) for (let k = 0; k < h; k++) out[k] += hidden.data[base + j * h + k];
			for (let k = 0; k < h; k++) out[k] /= real.length;
		}
		rows.push(out);
	}
	return rows;
}

type Tok = (texts: string[], o: Record<string, unknown>) => { input_ids: { dims: number[] }; attention_mask: { data: ArrayLike<number | bigint> } };
type Model = (inputs: unknown) => Promise<{ sentence_embedding?: TensorLike; last_hidden_state?: TensorLike }>;

const BATCH = 8;

export async function loadEmbedder(spec: ModelSpec, o: LoadOptions): Promise<Embedder> {
	if (!o.download && !modelReady(o.modelsDir, spec)) throw new Error(`Modelis ${spec.label} nav lejupielādēts (Avoti → Meklēšanas indekss).`);
	mkdirSync(o.modelsDir, { recursive: true });
	const tf = await import("@huggingface/transformers");
	tf.env.cacheDir = o.modelsDir;
	tf.env.useFSCache = true;
	tf.env.allowLocalModels = false;
	tf.env.allowRemoteModels = true;
	const common = {
		cache_dir: o.modelsDir,
		local_files_only: !o.download,
		progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
			if (o.onProgress && p.status === "progress" && p.file && typeof p.loaded === "number" && typeof p.total === "number") o.onProgress({ file: p.file, loaded: p.loaded, total: p.total });
		},
	};
	const tokenizer = (await tf.AutoTokenizer.from_pretrained(spec.repo, common)) as unknown as Tok;
	const model = (await tf.AutoModel.from_pretrained(spec.repo, { ...common, dtype: spec.dtype, device: "cpu", session_options: { intraOpNumThreads: o.threads ?? defaultThreads() } } as never)) as unknown as Model;
	if (o.download) {
		mkdirSync(join(o.modelsDir, "_ready"), { recursive: true });
		writeFileSync(markerFile(o.modelsDir, spec), JSON.stringify({ repo: spec.repo, dtype: spec.dtype, at: new Date().toISOString() }));
	}
	return {
		model: spec.id,
		dims: spec.storeDims,
		async embed(texts, kind) {
			const prefix = kind === "query" ? spec.queryPrefix : spec.docPrefix;
			// similar lengths together: a batch is as slow as its longest text, so mixed lengths waste most of the work
			const order = texts.map((t, i) => i).sort((a, b) => texts[a].length - texts[b].length);
			const result = new Array<Float32Array>(texts.length);
			for (let s = 0; s < order.length; s += BATCH) {
				const idx = order.slice(s, s + BATCH);
				const enc = tokenizer(
					idx.map((i) => prefix + texts[i]),
					{ padding: true, truncation: true, max_length: spec.maxTokens },
				);
				const out = await model(enc);
				let rows: Float32Array[];
				if (spec.ownVector && out.sentence_embedding) {
					const [b, h] = out.sentence_embedding.dims;
					rows = Array.from({ length: b }, (_, i) => out.sentence_embedding!.data.slice(i * h, (i + 1) * h));
				} else if (out.last_hidden_state) {
					rows = pool(out.last_hidden_state, enc.attention_mask.data, spec.pooling);
				} else throw new Error(`Modelis ${spec.id} neatdeva vektoru.`);
				idx.forEach((i, k) => (result[i] = truncate(rows[k], spec.storeDims)));
			}
			return result;
		},
	};
}
