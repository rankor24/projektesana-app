// Folder scan: the first thing that happens when Boris points the app at a project folder.
// Every file is registered in place (hash only, the file is never touched), its text is read once and kept in
// .bv/text so the agent, the reference finder and quote checks do not read a 40-page PDF again, and a role is
// PROPOSED from the words in the file. Nothing here needs a model.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { appendLog } from "../../kernel/log.js";
import { dropProposedRole, loadFiles, proposeRoleFor, registerFile } from "../../kernel/files.js";
import { extractText } from "../files/text.js";
import { proposeRoleFromText } from "../files/roles.js";

export type TextState = "ok" | "empty" | "unsupported" | "toolarge" | "error";

export interface ScanFile {
	path: string;
	text: TextState;
	chars: number;
	note?: string;
}

export interface ScanResult {
	at: string;
	/** files found in the folder (outside .bv) */
	found: number;
	/** newly registered by this scan */
	registered: number;
	files: ScanFile[];
}

const SKIP_DIRS = new Set([".bv", ".git", "node_modules", "$RECYCLE.BIN", "System Volume Information"]);
const SKIP_FILES = /^(~\$|\.|thumbs\.db$|desktop\.ini$)/i;
const TEXT_EXT = new Set([".txt", ".md", ".json", ".csv", ".tsv", ".xml", ".html", ".htm", ".pdf", ".docx", ".xlsx"]);
/** Larger files are listed but not registered or read: big PDFs are drawing sets, big binaries are models and point clouds. */
const MAX_REGISTER = 100 * 1024 * 1024;
const MAX_PDF_TEXT = 40 * 1024 * 1024;
const MAX_FILES = 5000;

export const textDir = (root: string) => join(root, ".bv", "text");
export const scanFile = (root: string) => join(root, ".bv", "scan.json");

export function loadScan(root: string): ScanResult | null {
	return existsSync(scanFile(root)) ? (JSON.parse(readFileSync(scanFile(root), "utf8")) as ScanResult) : null;
}

/** Walks the project folder; paths are relative with forward slashes. */
export function walkProject(root: string): string[] {
	const out: string[] = [];
	const visit = (dir: string) => {
		if (out.length >= MAX_FILES) return;
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.isDirectory()) {
				if (!SKIP_DIRS.has(e.name)) visit(join(dir, e.name));
			} else if (e.isFile() && !SKIP_FILES.test(e.name)) {
				out.push(relative(root, join(dir, e.name)).split("\\").join("/"));
			}
		}
	};
	visit(root);
	return out.sort((a, b) => a.localeCompare(b, "lv"));
}

/**
 * Text of a registered file from the cache (keyed by the SHA-256 of its latest version), reading it once if needed.
 * A file that is not registered, or has no text format, is read directly or throws the reader's own message.
 */
export async function cachedText(root: string, path: string): Promise<string> {
	const rec = loadFiles(root).find((f) => f.path === path.split("\\").join("/"));
	const sha = rec?.versions[rec.versions.length - 1]?.sha256;
	const cache = sha ? join(textDir(root), `${sha}.txt`) : null;
	if (cache && existsSync(cache)) return readFileSync(cache, "utf8");
	const text = await extractText(join(root, path));
	if (cache) {
		mkdirSync(textDir(root), { recursive: true });
		writeFileSync(cache, text, "utf8");
	}
	return text;
}

export async function scanFolder(root: string, onProgress?: (done: number, total: number, path: string) => void, now = new Date()): Promise<ScanResult> {
	const paths = walkProject(root);
	const known = new Set(loadFiles(root).map((f) => f.path));
	const files: ScanFile[] = [];
	let registered = 0;
	let done = 0;
	for (const p of paths) {
		onProgress?.(done++, paths.length, p);
		const abs = join(root, p);
		const ext = extname(p).toLowerCase();
		const size = statSync(abs).size;
		if (size > MAX_REGISTER) {
			files.push({ path: p, text: "toolarge", chars: 0, note: `${Math.round(size / 1048576)} MB — netiek reģistrēts (parasti modelis vai punktu mākonis)` });
			continue;
		}
		try {
			const rec = registerFile(root, abs);
			if (!known.has(rec.path)) registered++;
		} catch (e) {
			files.push({ path: p, text: "error", chars: 0, note: (e as Error).message });
			continue;
		}
		let text = "";
		let state: TextState = "ok";
		let note: string | undefined;
		if (!TEXT_EXT.has(ext)) {
			state = "unsupported";
			note = `${ext || "bez paplašinājuma"} netiek lasīts — pārvērt uz PDF vai DOCX, ja tur ir teksts`;
		} else if (ext === ".pdf" && size > MAX_PDF_TEXT) {
			state = "toolarge";
			note = "liels PDF (parasti rasējumu komplekts) — teksts nav nolasīts";
		} else {
			try {
				text = await cachedText(root, p);
				if (!text.replace(/--- lpp\. \d+ ---/g, "").trim()) {
					state = "empty";
					note = "teksta nav (skenēts dokuments?) — jāpārbauda ar aci";
				}
			} catch (e) {
				state = "error";
				note = (e as Error).message;
			}
		}
		const prop = proposeRoleFromText(text, p.split("/").pop() ?? p);
		if (prop) proposeRoleFor(root, p, prop.role, prop.quote, "app");
		else dropProposedRole(root, p);
		files.push({ path: p, text: state, chars: text.length, note });
	}
	onProgress?.(paths.length, paths.length, "");
	// registered files that no longer exist are reported by rescan(); the scan only lists what is on disk
	const result: ScanResult = { at: now.toISOString(), found: paths.length, registered, files };
	mkdirSync(join(root, ".bv"), { recursive: true });
	writeFileSync(scanFile(root), JSON.stringify(result, null, 1), "utf8");
	appendLog(root, { kind: "folder.scanned", by: "app", data: { found: paths.length, registered, unreadable: files.filter((f) => f.text !== "ok").length } }, now);
	return result;
}
