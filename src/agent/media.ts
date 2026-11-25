// Files an agent has to open or turn into something else: archives (zip, gz, tar, tgz natively; 7z, rar, xz, bz2, cab, iso … through 7-Zip when it is installed), images
// the model cannot take as they are (TIFF, BMP, GIF, ICO, EMF, WMF → PNG or JPEG through Windows' own System.Drawing), and Office files (through LibreOffice when
// it is installed). Everything is written into one new folder of the app's own `agent-work` area: never into the office folders, never over a file.
// The tools that use it are in tools/media.ts. The agent can also call a program itself with run_command (a click each time); these are the ones that are common.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { gunzipSync, unzipSync } from "fflate";

/** <app data>\agent-work\<project id or "general">: where converted and extracted files go. */
export const workDirOf = (appDir: string, projectId: string | null): string => join(appDir, "agent-work", projectId ?? "general");

/** A path that does not exist yet: `name`, else `name (2)` … (folders and files alike). */
export function uniquePath(dir: string, name: string): string {
	mkdirSync(dir, { recursive: true });
	const ext = extname(name);
	const stem = ext ? name.slice(0, -ext.length) : name;
	let p = join(dir, name);
	for (let n = 2; existsSync(p); n++) p = join(dir, `${stem} (${n})${ext}`);
	return p;
}

/** A file name that is safe on Windows: no path, no reserved characters, no trailing dots or spaces. */
export const cleanName = (s: string): string => (s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 120) || "fails");

const run = (file: string, args: string[], o: { env?: Record<string, string>; timeout?: number; cwd?: string } = {}): Promise<{ code: number; out: string; err: string }> =>
	new Promise((ok) => {
		execFile(file, args, { env: { ...process.env, ...o.env }, timeout: o.timeout ?? 120_000, maxBuffer: 64_000_000, windowsHide: true, cwd: o.cwd }, (e, stdout, stderr) => {
			ok({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: String(stdout), err: String(stderr) });
		});
	});

// ---- programs that may be installed ----------------------------------------------------------------------------------------------------

const firstExisting = (c: string[]): string | null => c.find((p) => p && existsSync(p)) ?? null;
const pf = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], "C:\\Program Files", "C:\\Program Files (x86)"].filter((x): x is string => !!x);

export const find7z = (): string | null => firstExisting(pf.map((d) => join(d, "7-Zip", "7z.exe")));
export const findSoffice = (): string | null => firstExisting(pf.map((d) => join(d, "LibreOffice", "program", "soffice.exe")));

// ---- archives -------------------------------------------------------------------------------------------------------------------------

export interface ArchiveEntry {
	name: string;
	size: number;
	dir: boolean;
}

const TAR_EXT = /\.(tar|tgz|tar\.gz)$/i;
const NATIVE_ZIP = new Set([".zip", ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp", ".jar", ".ifczip", ".kmz", ".edoc"]);
/** Largest archive read into memory by the built-in readers (the rest go to 7-Zip, which streams). */
const NATIVE_MAX = 500 * 1024 * 1024;
export const EXTRACT_MAX_BYTES = 4 * 1024 ** 3;
export const EXTRACT_MAX_FILES = 100_000;

export type ArchiveKind = "zip" | "gz" | "tar" | "other";
export function archiveKind(path: string): ArchiveKind {
	const ext = extname(path).toLowerCase();
	if (TAR_EXT.test(path)) return /\.tar$/i.test(path) ? "tar" : "gz";
	if (NATIVE_ZIP.has(ext)) return "zip";
	if (ext === ".gz") return "gz";
	return "other";
}

/** A tar stream's entries (ustar, GNU long names; pax headers are skipped). `data` = the file's bytes, only when `withData`. */
export function readTar(tar: Uint8Array, withData = false): { name: string; size: number; dir: boolean; data?: Uint8Array }[] {
	const out: { name: string; size: number; dir: boolean; data?: Uint8Array }[] = [];
	const text = (o: number, n: number) => new TextDecoder().decode(tar.subarray(o, o + n)).replace(/\0.*$/s, "");
	let o = 0;
	let longName: string | null = null;
	while (o + 512 <= tar.length) {
		if (tar.subarray(o, o + 512).every((b) => b === 0)) break;
		const size = parseInt(text(o + 124, 12).trim() || "0", 8);
		const type = String.fromCharCode(tar[o + 156] || 48);
		const prefix = text(o + 345, 155);
		let name = (prefix ? `${prefix}/` : "") + text(o, 100);
		if (!Number.isFinite(size) || size < 0) throw new Error("tar fails ir bojāts (nepareizs izmērs).");
		const body = o + 512;
		if (type === "L") {
			longName = text(body, size);
		} else if (type === "x" || type === "g") {
			/* pax header: not needed */
		} else {
			if (longName) (name = longName), (longName = null);
			if (type === "0" || type === "\0" || type === "5") {
				const dir = type === "5" || name.endsWith("/");
				if (body + size > tar.length && !dir) throw new Error("tar fails ir saīsināts.");
				out.push({ name, size: dir ? 0 : size, dir, ...(withData && !dir ? { data: tar.subarray(body, body + size) } : {}) });
			}
		}
		o = body + Math.ceil(size / 512) * 512;
	}
	return out;
}

function parse7z(text: string): ArchiveEntry[] {
	const out: ArchiveEntry[] = [];
	for (const block of text.split(/\r?\n\r?\n/)) {
		const f: Record<string, string> = {};
		for (const line of block.split(/\r?\n/)) {
			const m = /^([A-Za-z ]+) = (.*)$/.exec(line);
			if (m) f[m[1]!] = m[2]!;
		}
		if (f.Path === undefined || f.Type !== undefined) continue; // the first block names the archive itself (it has Type)
		out.push({ name: f.Path.replace(/\\/g, "/"), size: Number(f.Size) || 0, dir: f.Folder === "+" || /^D/.test(f.Attributes ?? "") });
	}
	return out;
}

export async function listArchive(path: string): Promise<{ kind: string; entries: ArchiveEntry[] }> {
	const kind = archiveKind(path);
	const size = statSync(path).size;
	if (kind !== "other" && size <= NATIVE_MAX) {
		const bytes = new Uint8Array(readFileSync(path));
		if (kind === "zip") {
			const entries: ArchiveEntry[] = [];
			unzipSync(bytes, {
				filter: (f) => {
					entries.push({ name: f.name, size: f.originalSize, dir: f.name.endsWith("/") });
					return false;
				},
			});
			return { kind: "zip", entries };
		}
		if (kind === "tar") return { kind: "tar", entries: readTar(bytes).map(({ name, size: s, dir }) => ({ name, size: s, dir })) };
		const raw = gunzipSync(bytes);
		if (TAR_EXT.test(path) || (raw.length > 262 && new TextDecoder().decode(raw.subarray(257, 262)) === "ustar")) return { kind: "tar.gz", entries: readTar(raw).map(({ name, size: s, dir }) => ({ name, size: s, dir })) };
		return { kind: "gz", entries: [{ name: basename(path).replace(/\.gz$/i, ""), size: raw.length, dir: false }] };
	}
	const z = find7z();
	if (!z) throw new Error(`${basename(path)}: šo arhīvu (${extname(path) || "formāts"}, vai arī lielāks par ${NATIVE_MAX / 1024 / 1024} MB) nolasa 7-Zip, bet tas nav uzstādīts.`);
	const r = await run(z, ["l", "-slt", "-ba", "--", path], { timeout: 120_000 });
	if (r.code !== 0 && !r.out) throw new Error(`7-Zip: ${r.err.split(/\r?\n/).find((l) => l.trim()) ?? "neizdevās"} (parole vai bojāts arhīvs?)`);
	const entries = parse7z(`Path = ${basename(path)}\nType = x\n\n${r.out.trim()}`);
	return { kind: "7-Zip", entries };
}

/** Is `entry` (an archive path) inside `root` after it is joined? No `..`, no drive letters, no absolute paths. */
export function safeJoin(root: string, entry: string): string | null {
	const norm = entry.replace(/\\/g, "/");
	if (!norm || norm.startsWith("/") || /^[A-Za-z]:/.test(norm) || norm.includes("\0")) return null;
	const target = resolve(root, ...norm.split("/").filter((s) => s !== "" && s !== "."));
	return target === resolve(root) || target.startsWith(resolve(root) + sep) ? target : null;
}

export async function extractArchive(path: string, outDir: string, only?: string[]): Promise<{ files: number; bytes: number; skipped: string[]; kind: string }> {
	const kind = archiveKind(path);
	const size = statSync(path).size;
	const wanted = only?.length ? new Set(only.map((x) => x.replace(/\\/g, "/"))) : null;
	const skipped: string[] = [];
	mkdirSync(outDir, { recursive: true });
	const put = (name: string, data: Uint8Array, counters: { files: number; bytes: number }) => {
		const target = safeJoin(outDir, name);
		if (!target) return void skipped.push(`${name} (nedrošs ceļš)`);
		counters.files++;
		counters.bytes += data.length;
		if (counters.files > EXTRACT_MAX_FILES || counters.bytes > EXTRACT_MAX_BYTES) throw new Error(`Arhīvs ir pārāk liels (vairāk par ${EXTRACT_MAX_FILES} failiem vai ${EXTRACT_MAX_BYTES / 1024 ** 3} GB): nekas tālāk netiek izpakots.`);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, data);
	};
	if (kind !== "other" && size <= NATIVE_MAX) {
		const bytes = new Uint8Array(readFileSync(path));
		const c = { files: 0, bytes: 0 };
		if (kind === "zip") {
			// the sizes are read from the directory before anything is unpacked: a zip bomb is refused here
			let total = 0;
			let n = 0;
			const files = unzipSync(bytes, {
				filter: (f) => {
					if (f.name.endsWith("/") || (wanted && !wanted.has(f.name))) return false;
					total += f.originalSize;
					n++;
					if (total > EXTRACT_MAX_BYTES || n > EXTRACT_MAX_FILES) throw new Error(`Arhīvs ir pārāk liels (${n} faili, ${Math.round(total / 1024 ** 2)} MB izpakojot).`);
					return true;
				},
			});
			for (const [name, data] of Object.entries(files)) put(name, data, c);
			return { ...c, skipped, kind: "zip" };
		}
		if (kind === "tar" || kind === "gz") {
			const raw = kind === "gz" ? gunzipSync(bytes) : bytes;
			if (kind === "tar" || TAR_EXT.test(path) || (raw.length > 262 && new TextDecoder().decode(raw.subarray(257, 262)) === "ustar")) {
				for (const e of readTar(raw, true)) if (!e.dir && e.data && (!wanted || wanted.has(e.name))) put(e.name, e.data, c);
				return { ...c, skipped, kind: "tar" };
			}
			put(basename(path).replace(/\.gz$/i, ""), raw, c);
			return { ...c, skipped, kind: "gz" };
		}
	}
	const z = find7z();
	if (!z) throw new Error(`${basename(path)}: šo arhīvu nolasa 7-Zip, bet tas nav uzstādīts.`);
	const r = await run(z, ["x", `-o${outDir}`, "-y", "-aou", "-bd", "--", path, ...(only ?? [])], { timeout: 600_000 });
	if (r.code !== 0) throw new Error(`7-Zip: ${r.err.split(/\r?\n/).find((l) => l.trim()) ?? r.out.split(/\r?\n/).find((l) => /error/i.test(l)) ?? "neizdevās"} (parole vai bojāts arhīvs?)`);
	// whatever 7-Zip wrote is counted and checked once: a name that left the folder cannot occur (7-Zip refuses it), the sizes are reported
	const count = (d: string): { files: number; bytes: number } => {
		let files = 0;
		let bytes = 0;
		const walk = (p: string) => {
			for (const e of readdirSync(p, { withFileTypes: true })) {
				const f = join(p, e.name);
				if (e.isDirectory()) walk(f);
				else (files++, (bytes += statSync(f).size));
			}
		};
		walk(d);
		return { files, bytes };
	};
	return { ...count(outDir), skipped, kind: "7-Zip" };
}

// ---- images ---------------------------------------------------------------------------------------------------------------------------

/** Formats Chromium (and so the model's pipeline) takes as they are. */
export const NATIVE_IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp"]);
/** Formats Windows' System.Drawing reads and Chromium does not. */
export const GDI_IMAGE = new Set([".gif", ".bmp", ".tif", ".tiff", ".ico", ".emf", ".wmf"]);

const GDI_SCRIPT = `Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($env:PJ_IN)
try {
  if ($env:PJ_FMT -eq 'jpg') {
    $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $p = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]90)
    $img.Save($env:PJ_OUT, $enc, $p)
  } else { $img.Save($env:PJ_OUT, [System.Drawing.Imaging.ImageFormat]::Png) }
} finally { $img.Dispose() }`;

/** GIF, BMP, TIFF (first page), ICO, EMF, WMF → PNG or JPEG. The paths go in as environment variables, never into the command text. */
export async function convertImage(src: string, out: string, fmt: "png" | "jpg"): Promise<void> {
	const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", GDI_SCRIPT], { env: { PJ_IN: src, PJ_OUT: out, PJ_FMT: fmt }, timeout: 120_000 });
	if (r.code !== 0 || !existsSync(out)) throw new Error(`Attēlu nevar pārveidot: ${r.err.split(/\r?\n/).find((l) => l.trim()) ?? "nezināma kļūda"}`);
}

// ---- Office files through LibreOffice ---------------------------------------------------------------------------------------------------

export const OFFICE_EXT = new Set([".doc", ".docx", ".rtf", ".odt", ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".odp"]);

/** `src` → `fmt` (pdf, docx, xlsx, pptx, odt, csv …) in `outDir`, by LibreOffice with a profile of its own (so a LibreOffice the user has open is not disturbed). Returns the file written. */
export async function sofficeConvert(src: string, outDir: string, fmt: string, appDir: string): Promise<string> {
	const exe = findSoffice();
	if (!exe) throw new Error("Šim pārveidojumam vajag LibreOffice, un tas nav uzstādīts (docx → pdf iet caur Word).");
	mkdirSync(outDir, { recursive: true });
	const profile = join(appDir, "libreoffice-profile").replace(/\\/g, "/");
	const r = await run(exe, [`-env:UserInstallation=file:///${profile}`, "--headless", "--norestore", "--convert-to", fmt, "--outdir", outDir, src], { timeout: 180_000 });
	const out = join(outDir, `${basename(src, extname(src))}.${fmt.split(":")[0]}`);
	if (!existsSync(out)) throw new Error(`LibreOffice neizveidoja failu: ${(r.err || r.out).split(/\r?\n/).find((l) => l.trim()) ?? "nezināma kļūda"}`);
	return out;
}
