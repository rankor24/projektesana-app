// Finds, downloads and keeps Google's Antigravity ACP server: one pinned release in the app's own folder, installed once by the person's click.
//
// Adapted from OpenMausBot (Apache-2.0) server/drivers/antigravity-runtime.ts and antigravity-release.ts: the download comes from dl.google.com only,
// its size and SHA-256 are the pinned ones, the archive may hold exactly the two expected files, the install is staged and renamed into place, and a
// Windows file lock (an antivirus scan, a just-stopped process) is retried. Changed: the archive is unpacked with fflate's streaming reader (this app
// has no zip reader of OpenMausBot's), progress goes to a callback, and there is no `agy` / custom-path / macOS / Linux handling.
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, mkdirSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, statfs, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { Unzip, UnzipInflate } from "fflate";
import { resolveAntigravityReleaseAsset, type AntigravityReleaseAsset } from "./release.js";

const FREE_SPACE_MARGIN = 256 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 45 * 60_000;
const STAGING_PREFIX = ".install-";
const INSTALL_RECORD = ".install-complete.json";

export interface AntigravityRuntime {
	executablePath: string;
	/** arguments of the program (none for Google's server; a test stands in for the server with node and a script) */
	args?: string[];
	harnessPath: string;
	version: string;
}

interface InstallRecord {
	sha256: string;
	version: string;
	executable: { name: string; bytes: number };
	harness: { name: string; bytes: number };
}

/** A setup problem the person can act on (not installed, no build for this PC). */
export class AntigravitySetupError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AntigravitySetupError";
	}
}

/** Windows refuses to rename or delete a held file with EPERM / EBUSY / EACCES (a just-stopped runtime, an antivirus scan). */
export function transientWindowsFileError(error: unknown): boolean {
	const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
	return code === "EPERM" || code === "EBUSY" || code === "EACCES" || code === "ENOTEMPTY";
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retryOnWindowsFileLock<T>(step: () => Promise<T>, attempts = 8, delayMs = 250): Promise<T> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await step();
		} catch (error) {
			if (attempt >= attempts || !transientWindowsFileError(error)) throw error;
			await wait(Math.min(2_000, delayMs * 2 ** (attempt - 1)));
		}
	}
}

/** Where the pinned release lives: `<root>\<platform-arch>\versions\<sha256>`. */
const versionsDir = (root: string) => join(root, `${process.platform}-${process.arch}`, "versions");

async function sizeIs(path: string, bytes: number): Promise<boolean> {
	try {
		const info = await stat(path);
		return info.isFile() && info.size === bytes;
	} catch {
		return false;
	}
}

async function completedRelease(directory: string, asset: AntigravityReleaseAsset): Promise<AntigravityRuntime | null> {
	try {
		const record = JSON.parse(await readFile(join(directory, INSTALL_RECORD), "utf8")) as InstallRecord;
		if (record.sha256 !== asset.sha256 || record.version !== asset.version || record.executable.name !== asset.executable.name || record.executable.bytes !== asset.executable.bytes || record.harness.name !== asset.harness.name || record.harness.bytes !== asset.harness.bytes) return null;
		const executablePath = join(directory, asset.executable.name);
		const harnessPath = join(directory, asset.harness.name);
		if (!(await sizeIs(executablePath, asset.executable.bytes)) || !(await sizeIs(harnessPath, asset.harness.bytes))) return null;
		return { executablePath, harnessPath, version: asset.version };
	} catch {
		return null;
	}
}

/** Google does not publish a build for this PC (anything but Windows x64 / arm64). */
export const antigravityInstallAvailable = (): boolean => resolveAntigravityReleaseAsset() !== null;

/** The installed runtime, or null when it is not installed (or is not the pinned release). */
export async function findAntigravityRuntime(root: string): Promise<AntigravityRuntime | null> {
	const asset = resolveAntigravityReleaseAsset();
	return asset ? completedRelease(join(versionsDir(root), asset.sha256), asset) : null;
}

/** The installed runtime, or a setup error that says what to do. */
export async function resolveAntigravityRuntime(root: string): Promise<AntigravityRuntime> {
	const asset = resolveAntigravityReleaseAsset();
	if (!asset) throw new AntigravitySetupError(`Google nepiedāvā Antigravity serveri šim datoram (${process.platform}-${process.arch}).`);
	const found = await completedRelease(join(versionsDir(root), asset.sha256), asset);
	if (!found) throw new AntigravitySetupError("Google Antigravity serveris nav instalēts: Iestatījumi → Pakalpojumi → Google Gemini (Antigravity) → Pieslēgties ar abonementu.");
	return found;
}

/** Unpacks the two files of the archive with fflate, streaming: nothing but the two pinned names, at the pinned sizes, ever reaches the disk. */
export async function extractWithFflate(archivePath: string, outputDirectory: string, asset: AntigravityReleaseAsset): Promise<void> {
	const expected = new Map([
		[asset.executable.name, asset.executable.bytes],
		[asset.harness.name, asset.harness.bytes],
	]);
	const seen = new Set<string>();
	const opened: FileHandle[] = [];
	let failure: Error | null = null;
	// every write goes through one chain that never rejects: the first failure is kept and the writes after it do nothing
	let chain: Promise<void> = Promise.resolve();
	const enqueue = (step: () => Promise<void>) => {
		chain = chain.then(() => (failure ? undefined : step())).catch((e) => void (failure ??= e as Error));
	};
	const unzip = new Unzip((file) => {
		const want = expected.get(file.name);
		if (want === undefined || seen.has(file.name) || file.name.includes("/") || file.name.includes("\\")) {
			failure ??= new Error("The archive contains an unexpected or unsafe file.");
			return;
		}
		seen.add(file.name);
		let written = 0;
		let handle: FileHandle | null = null;
		file.ondata = (error, data, final) => {
			if (error) {
				failure ??= error;
				return;
			}
			written += data.length;
			enqueue(async () => {
				if (written > want) throw new Error("The archive member is larger than pinned.");
				handle ??= await open(join(outputDirectory, file.name), "wx", 0o600);
				if (!opened.includes(handle)) opened.push(handle);
				let offset = 0;
				while (offset < data.length) {
					const { bytesWritten } = await handle.write(data, offset, data.length - offset, null);
					if (bytesWritten <= 0) throw new Error("The runtime could not be written completely.");
					offset += bytesWritten;
				}
				if (final) {
					await handle.close();
					opened.splice(opened.indexOf(handle), 1);
					if (written !== want) throw new Error("The archive member does not have the pinned size.");
				}
			});
		};
		file.start();
	});
	unzip.register(UnzipInflate);
	try {
		for await (const chunk of createReadStream(archivePath, { highWaterMark: 1 << 20 })) {
			unzip.push(chunk as Uint8Array, false);
			// the writes of what was just unpacked finish before more is read: memory stays at about one chunk
			await chain;
			if (failure) throw failure;
		}
		unzip.push(new Uint8Array(0), true);
		await chain;
		if (failure) throw failure;
		if (seen.size !== 2) throw new Error("The archive is missing an expected file.");
	} finally {
		await Promise.all(opened.map((h) => h.close().catch(() => undefined)));
	}
}

const run = (file: string, args: string[], timeout: number) =>
	new Promise<string>((resolve, reject) => execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(String(stdout)))));

/** Windows' own tar.exe (bsdtar, in every Windows 10 since 1803) reads a zip without holding it in memory: the member list is checked against the pinned names first,
 *  only those two are extracted, and their sizes are checked after. False when there is no such tar (then the streaming reader below does it). */
async function extractWithTar(archivePath: string, outputDirectory: string, asset: AntigravityReleaseAsset): Promise<boolean> {
	const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
	try {
		await stat(tar);
	} catch {
		return false;
	}
	const expected = new Map([
		[asset.executable.name, asset.executable.bytes],
		[asset.harness.name, asset.harness.bytes],
	]);
	const listed = (await run(tar, ["-tf", archivePath], 120_000)).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	if (listed.length !== 2 || new Set(listed).size !== 2 || listed.some((n) => !expected.has(n))) throw new Error("The archive contains an unexpected or unsafe file.");
	await run(tar, ["-xf", archivePath, "-C", outputDirectory, ...listed], 15 * 60_000);
	for (const [name, bytes] of expected) if (!(await sizeIs(join(outputDirectory, name), bytes))) throw new Error("The archive member does not have the pinned size.");
	return true;
}

/** Unpacks the archive: nothing but the two pinned files, at the pinned sizes, ever stays on the disk. */
export async function extractPinnedArchive(archivePath: string, outputDirectory: string, asset: AntigravityReleaseAsset): Promise<void> {
	if (await extractWithTar(archivePath, outputDirectory, asset)) return;
	await extractWithFflate(archivePath, outputDirectory, asset);
}

export interface InstallOptions {
	/** a release other than the pinned one (tests install a small invented archive) */
	asset?: AntigravityReleaseAsset | null;
	/** `<appDir>\antigravity\runtime` */
	root: string;
	/** Runs the unpacked server once and refuses a download that is not the expected release (it is renamed into place only after this passes). */
	validate?: (runtime: AntigravityRuntime, expectedVersion: string) => Promise<void>;
	/** Lines for the person while it goes on: "Lejupielādē …" */
	progress?: (line: string) => void;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}

const installs = new Map<string, Promise<AntigravityRuntime>>();

async function installOnce(o: InstallOptions): Promise<AntigravityRuntime> {
	const asset = o.asset === undefined ? resolveAntigravityReleaseAsset() : o.asset;
	if (!asset) throw new AntigravitySetupError(`Google nepiedāvā Antigravity serveri šim datoram (${process.platform}-${process.arch}).`);
	const versions = versionsDir(o.root);
	const destination = join(versions, asset.sha256);
	await mkdir(versions, { recursive: true });
	const existing = await completedRelease(destination, asset);
	if (existing) return existing;

	try {
		const disk = await statfs(versions, { bigint: true });
		const required = BigInt(asset.archiveBytes + asset.executable.bytes + asset.harness.bytes + FREE_SPACE_MARGIN);
		if (disk.bavail * disk.bsize < required) throw new Error(`Antigravity instalēšanai vajag vismaz ${Math.ceil(Number(required) / 1024 / 1024)} MiB brīvas vietas.`);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Antigravity")) throw error;
		// statfs is not available on every file system
	}

	const staging = await mkdtemp(join(versions, `${STAGING_PREFIX}${randomUUID()}-`));
	try {
		const archivePath = join(staging, "download.zip");
		const runtimeDirectory = join(staging, "runtime");
		mkdirSync(runtimeDirectory, { recursive: true });
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
		timeout.unref?.();
		o.signal?.addEventListener("abort", () => controller.abort(), { once: true });
		try {
			o.progress?.(`Lejupielādē Google Antigravity serveri (${Math.round(asset.archiveBytes / 1_000_000)} MB)…`);
			const response = await (o.fetchImpl ?? fetch)(asset.url, { signal: controller.signal, redirect: "follow" });
			if (!response.ok || !response.body) throw new Error(`Google lejupielāde neizdevās (${response.status}).`);
			const finalUrl = new URL(response.url || asset.url);
			if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "dl.google.com") throw new Error("Lejupielāde pārvirzījās ārpus dl.google.com.");
			const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
			const length = response.headers.get("content-length");
			if ((!encoding || encoding === "identity") && length && Number(length) !== asset.archiveBytes) throw new Error("Lejupielādes izmērs neatbilst fiksētajam izdevumam.");
			const handle = await open(archivePath, "wx", 0o600);
			const hash = createHash("sha256");
			let downloaded = 0;
			let shown = -1;
			try {
				for await (const raw of response.body as unknown as AsyncIterable<Uint8Array>) {
					const chunk = Buffer.from(raw);
					if (downloaded + chunk.length > asset.archiveBytes) throw new Error("Lejupielāde pārsniedza fiksēto izmēru.");
					let offset = 0;
					while (offset < chunk.length) {
						const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
						if (bytesWritten <= 0) throw new Error("Lejupielādi neizdevās ierakstīt pilnībā.");
						offset += bytesWritten;
					}
					hash.update(chunk);
					downloaded += chunk.length;
					const pct = Math.floor((downloaded / asset.archiveBytes) * 10) * 10;
					if (pct !== shown) {
						shown = pct;
						o.progress?.(`Lejupielādē Google Antigravity serveri: ${pct}%`);
					}
				}
			} finally {
				await handle.close();
			}
			if (downloaded !== asset.archiveBytes || hash.digest("hex") !== asset.sha256) throw new Error("Lejupielāde neizturēja SHA-256 vai izmēra pārbaudi. Nekas netika instalēts.");
		} finally {
			clearTimeout(timeout);
		}
		o.progress?.("Izpako Google Antigravity serveri…");
		await extractPinnedArchive(archivePath, runtimeDirectory, asset);
		const candidate: AntigravityRuntime = { executablePath: join(runtimeDirectory, asset.executable.name), harnessPath: join(runtimeDirectory, asset.harness.name), version: asset.version };
		o.progress?.("Pārbauda Google Antigravity serveri…");
		await o.validate?.(candidate, asset.version);
		const record: InstallRecord = { sha256: asset.sha256, version: asset.version, executable: asset.executable, harness: asset.harness };
		await writeFile(join(runtimeDirectory, INSTALL_RECORD), `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
		try {
			await retryOnWindowsFileLock(() => rename(runtimeDirectory, destination));
		} catch (error) {
			if (!(await completedRelease(destination, asset))) throw error;
		}
		const installed = await completedRelease(destination, asset);
		if (!installed) throw new Error("Instalētais Antigravity serveris ir nepilns.");
		return installed;
	} finally {
		// cleanup never replaces the real error: only this attempt's folder is touched
		await retryOnWindowsFileLock(() => rm(staging, { recursive: true, force: true })).catch((e) => console.warn(`antigravity: could not remove ${staging}: ${(e as Error).message}`));
	}
}

/** One install at a time per folder: a second click joins the first. */
export function installAntigravityRuntime(o: InstallOptions): Promise<AntigravityRuntime> {
	const key = versionsDir(o.root);
	const running = installs.get(key);
	if (running) return running;
	const p = installOnce(o).finally(() => installs.delete(key));
	installs.set(key, p);
	return p;
}
