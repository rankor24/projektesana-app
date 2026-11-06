// The whole read of a project's inputs: scan 1.1 → hash in a worker → merge duplicates → containers → text in a worker →
// old Office formats → OCR. Every step reports progress; every file ends with a text state, never silently empty.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { Source, Version } from "../core/model.js";
import type { ProjectStore } from "../core/store.js";
import type { ScanProgress } from "../shared/api.js";
import { mergeSources } from "./dedupe.js";
import { mergeDeliveries, plannedFromSchedule, readDeliveries } from "./deliveries.js";
import { expandContainers } from "./edoc-sources.js";
import { hashFiles } from "./hash.js";
import { scanInputs, type ScanResult } from "./scan.js";
import type { Extracted } from "./text/index.js";
import { TEXT_FORMATS } from "./text/index.js";
import { readTexts } from "./text-run.js";
import type { TextJob } from "./text-worker.js";

export interface PipelineHooks {
	/** .doc / .xls / .msg through the installed Office (1.6); absent = state unsupported with the reason */
	officeText?: (abs: string, ext: string) => Promise<Extracted>;
	/** OCR of the pages without a text layer (1.5); returns the text per page number */
	ocr?: (bytes: () => Uint8Array, pages: number[], onPage: (page: number) => void) => Promise<Map<number, string>>;
}

export const OFFICE_FORMATS = new Set([".doc", ".xls", ".msg", ".rtf", ".ppt"]);

export interface ScanSummary {
	at: string;
	inputsRel: string | null;
	files: number;
	surveys: number;
	added: number;
	changed: number;
	gone: number;
	skipped: ScanResult["skipped"];
	problems: string[];
	folders: ScanResult["folders"];
}

const latest = (s: Source) => s.versions[s.versions.length - 1];

export async function scanProject(store: ProjectStore, progress: (p: Omit<ScanProgress, "projectId">) => void, hooks: PipelineHooks = {}): Promise<ScanSummary> {
	const root = store.project.root;
	const confirmed = store.readMeta<Record<string, string>>("roles", {});
	let folders = 0;
	progress({ phase: "walk", done: 0, total: 0 });
	const scan = await scanInputs(root, confirmed, (rel) => progress({ phase: "walk", done: ++folders, total: 0, current: rel }));

	// a known path with the same size and mtime keeps its hash: an unchanged network folder is not read again
	const prev = store.read("sources");
	const known = new Map<string, { size: number; mtime: string; sha: string }>();
	for (const s of prev) {
		const v = latest(s);
		if (s.kind !== "document" || s.container || !v?.sha256) continue;
		for (const p of s.paths) known.set(p.toLowerCase(), { size: v.size, mtime: v.mtime, sha: v.sha256 });
	}
	const hashed = await hashFiles(
		scan.files,
		(rel, size, mtimeMs) => {
			const k = known.get(rel.toLowerCase());
			return k && k.size === size && k.mtime === new Date(mtimeMs).toISOString() ? k.sha : null;
		},
		(done, total, current) => progress({ phase: "hash", done, total, current }),
	);
	const merged = mergeSources(prev, hashed, scan.surveys, scan.folders);
	keepBlobs(store, hashed);
	let sources = await expandContainers(merged.sources, root);
	store.write("sources", sources, { kind: "sources.scanned", by: "app", data: { added: merged.added.length, changed: merged.changed.length, gone: merged.gone.length } });

	sources = await readAllText(store, sources, progress, hooks);
	store.write("sources", sources, { kind: "sources.text", by: "app" });

	// deliveries from 1.4_Nodevumi; planned dates from the BIP grafiks / schedule sources
	const planned = sources
		.filter((s) => s.kind === "document" && (s.role === "Grafiks" || s.role === "BIP / BIM prasības"))
		.flatMap((s) => plannedFromSchedule(store.readText(s.versions[s.versions.length - 1]?.sha256 ?? "")?.pages ?? []));
	const deliveries = mergeDeliveries(store.read("deliveries"), await readDeliveries(root), planned);
	if (JSON.stringify(deliveries) !== JSON.stringify(store.read("deliveries"))) store.write("deliveries", deliveries, { kind: "deliveries.read", by: "app", data: { count: deliveries.length } });

	const summary: ScanSummary = {
		at: new Date().toISOString(),
		inputsRel: scan.inputsRel,
		files: scan.files.length,
		surveys: scan.surveys.length,
		added: merged.added.length,
		changed: merged.changed.length,
		gone: merged.gone.length,
		skipped: scan.skipped,
		problems: scan.problems,
		folders: scan.folders,
	};
	store.writeMeta("scan", summary);
	progress({ phase: "done", done: sources.length, total: sources.length });
	return summary;
}

/** Text for every latest version still `pending`; the cache per sha is reused across sources and re-scans. */
async function readAllText(store: ProjectStore, sources: Source[], progress: (p: Omit<ScanProgress, "projectId">) => void, hooks: PipelineHooks): Promise<Source[]> {
	const root = store.project.root;
	const setState = (v: Version, r: { state: string; reason?: string; pages: string[] }) => {
		v.textState = r.state as Version["textState"];
		v.textReason = r.reason;
		v.pages = r.pages.length || undefined;
		v.textCache = `${v.sha256}.json`;
	};
	const jobs: (TextJob & { v: Version })[] = [];
	const office: { abs: string; ext: string; v: Version }[] = [];
	let id = 0;
	for (const s of sources) {
		const v = latest(s);
		if (s.kind !== "document" || !v || !v.sha256 || v.textState !== "pending") continue;
		const cached = store.readText(v.sha256);
		if (cached) {
			setState(v, cached);
			continue;
		}
		const name = s.container ? s.container.inner : s.paths[0];
		const ext = extname(name).toLowerCase();
		const abs = join(root, s.container ? s.container.path : s.paths[0]);
		if (TEXT_FORMATS.has(ext)) jobs.push({ id: id++, abs, ext, inner: s.container?.inner, v });
		else if (OFFICE_FORMATS.has(ext) && !s.container) office.push({ abs, ext, v });
		else {
			v.textState = "unsupported";
			v.textReason = ext === ".edoc" || ext === ".asice" ? "parakstīts konteiners — skatīt iekšējos failus" : `formāts ${ext || "(bez paplašinājuma)"} nav teksts`;
		}
	}
	const total = jobs.length + office.length;
	let done = 0;
	progress({ phase: "text", done, total });
	const ocrQueue: { v: Version; abs: string; inner?: string; pages: string[]; empty: number[] }[] = [];
	await readTexts(jobs, (job, r) => {
		const j = jobs[job.id];
		if (r.emptyPages?.length && hooks.ocr) ocrQueue.push({ v: j.v, abs: j.abs, inner: j.inner, pages: r.pages, empty: r.emptyPages });
		store.writeText(j.v.sha256, { pages: r.pages, state: r.state, reason: r.reason });
		setState(j.v, r);
		progress({ phase: "text", done: ++done, total, current: job.inner ?? job.abs });
	});
	for (const o of office) {
		const r: Extracted = hooks.officeText ? await hooks.officeText(o.abs, o.ext) : { state: "unsupported", pages: [], reason: "Office (Word/Excel/Outlook) nav pieejams šim formātam" };
		if (r.state === "ok" || r.state === "empty") store.writeText(o.v.sha256, { pages: r.pages, state: r.state, reason: r.reason });
		setState(o.v, r);
		if (r.state !== "ok" && r.state !== "empty") o.v.textCache = undefined;
		progress({ phase: "text", done: ++done, total, current: o.abs });
	}
	if (hooks.ocr) {
		for (const q of ocrQueue) {
			const { readFileSync } = await import("node:fs");
			const { unzipSync } = await import("fflate");
			const bytes = () => {
				const b = new Uint8Array(readFileSync(q.abs));
				return q.inner ? unzipSync(b, { filter: (f) => f.name === q.inner })[q.inner!] : b;
			};
			let n = 0;
			const text = await hooks.ocr(bytes, q.empty, (page) => progress({ phase: "text", done, total, current: `OCR lpp. ${page} (${++n}/${q.empty.length})` }));
			const pages = q.pages.map((p, i) => (text.has(i + 1) ? text.get(i + 1)! : p));
			const unread = q.empty.filter((p) => !(text.get(p) ?? "").match(/\p{L}{3,}/u));
			const letters = pages.join("").match(/\p{L}/gu)?.length ?? 0;
			const r = {
				pages,
				state: letters === 0 ? "empty" : "ocr",
				reason: unread.length ? `OCR: lpp. ${unread.join(", ")} nav nolasāmas` : `OCR: lpp. ${q.empty.join(", ")}`,
				ocrPages: q.empty,
			};
			store.writeText(q.v.sha256, r);
			setState(q.v, r);
		}
	}
	return sources;
}

/** Each PDF version (up to 30 MB) is copied once into the data folder by its sha, so an older issue can still be compared
 *  after the office file was replaced. Content-addressed: the same bytes are stored once. */
export const BLOB_MAX = 30 * 1024 * 1024;
function keepBlobs(store: ProjectStore, files: { abs: string; rel: string; size: number; sha256: string | null }[]) {
	const dir = join(store.dir, "blobs");
	mkdirSync(dir, { recursive: true });
	for (const f of files) {
		if (!f.sha256 || f.sha256.startsWith("q:") || f.size > BLOB_MAX || extname(f.rel).toLowerCase() !== ".pdf") continue;
		const to = join(dir, `${f.sha256}.pdf`);
		if (!existsSync(to)) {
			try {
				copyFileSync(f.abs, to);
			} catch {
				// a file that went away between hash and copy: the next scan copies it
			}
		}
	}
}
