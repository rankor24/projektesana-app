// The agent's general tools (2.6.9: "all regular agent tools", the ones a coding agent has): the web, the PC's files and the
// shell. Reading is free; anything that writes, moves or runs waits for the user's click (level confirm, the batch gate shows
// the exact path and command), except a text note in the agent's own work folder. The office project folders are read-only here
// whatever the click (project-write.ts `officeBlock`): a relative path of a write tool means the app's work folder
// (<app data>\agent-work\<project>), never the project. Folders are never deleted (the user's standing rule). A file that is
// overwritten is kept first under <data>\backups\agent so the user can take it back.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { extractBytes, TEXT_FORMATS } from "../../sources/text/index.js";
import type { ToolCtx } from "./context.js";
import { appShellBlock, revitShellBlock } from "./levels.js";
import { officeBlock, resolveRead, resolveWrite, workFolder } from "./project-write.js";
import { tool, type ToolDef } from "./tool.js";

const MAX_TEXT = 60_000;
const cut = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}\n[… apgriezts: ${s.length} zīmes kopā]` : s);

/** A path to READ as the agent gives it: absolute, or under the open project's folder (else under its own work folder, where its notes are). */
export function abs(ctx: ToolCtx, p: string): string {
	return resolveRead(ctx, p, existsSync);
}

/** The refusal of a write tool into an office folder, thrown where the tool runs (the gate has asked the same before the click). */
function noOffice(ctx: ToolCtx, tool: string, args: unknown): void {
	const b = officeBlock(ctx, tool, args);
	if (b) throw new Error(b);
}

/** Keeps the file that is about to be overwritten or moved: <app data>\backups\agent\<time>\<name>. */
function keep(ctx: ToolCtx, file: string): string | null {
	if (!existsSync(file) || !statSync(file).isFile()) return null;
	const dir = join(ctx.appDir, "backups", "agent", new Date().toISOString().replace(/[:.]/g, "-"));
	mkdirSync(dir, { recursive: true });
	const to = join(dir, basename(file));
	copyFileSync(file, to);
	return to;
}

const html2text = (h: string) =>
	h
		.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n+/g, "\n\n")
		.trim();

export const generalTools: ToolDef[] = [
	tool({
		name: "web_fetch",
		level: "read",
		description: "Read a web page (https) as text: a regulation on likumi.lv, a manufacturer's datasheet, documentation. Long pages are cut; ask for a later part with offset.",
		input: { url: z.string().url(), offset: z.number().int().min(0).optional() },
		run: async (_ctx, { url, offset }) => {
			if (!/^https?:\/\//i.test(url)) throw new Error("Tikai http(s) adreses.");
			const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Projektesana-App" }, signal: AbortSignal.timeout(30_000), redirect: "follow" });
			const type = res.headers.get("content-type") ?? "";
			if (!res.ok) throw new Error(`${new URL(url).host} atbildēja ${res.status}`);
			if (/pdf/i.test(type)) {
				const t = await extractBytes(".pdf", new Uint8Array(await res.arrayBuffer()));
				return cut(t.pages.join("\n\n").slice(offset ?? 0));
			}
			const text = /html/i.test(type) ? html2text(await res.text()) : await res.text();
			return cut(text.slice(offset ?? 0));
		},
	}),
	tool({
		name: "web_search",
		level: "read",
		description: "Search the web: titles, links and short texts of the first results (then web_fetch the right one). For regulations prefer likumi.lv; for standards and products the maker's site.",
		input: { query: z.string().min(2) },
		run: async (_ctx, { query }) => {
			const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { "User-Agent": "Mozilla/5.0 Projektesana-App" }, signal: AbortSignal.timeout(20_000) });
			if (!res.ok) throw new Error(`meklēšana atbildēja ${res.status}`);
			const h = await res.text();
			const out: { title: string; url: string; text: string }[] = [];
			for (const m of h.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)) {
				let url = m[1]!;
				const u = /uddg=([^&]+)/.exec(url);
				if (u) url = decodeURIComponent(u[1]!);
				out.push({ title: html2text(m[2]!), url, text: html2text(m[3]!) });
				if (out.length >= 10) break;
			}
			return out.length ? out : "no data: meklēšana neko neatdeva (vai lapas izkārtojums mainījies).";
		},
	}),
	tool({
		name: "read_file",
		level: "read",
		description: "Read any file on the PC as text: plain text, PDF, DOCX, XLSX (their text), CSV, JSON, IFC header. A relative path is under the open project's folder. Long files are cut; ask for a later part with offset.",
		input: { path: z.string(), offset: z.number().int().min(0).optional() },
		run: async (ctx, { path, offset }) => {
			const f = abs(ctx, path);
			if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`Faila nav: ${f}`);
			const ext = extname(f).toLowerCase();
			if (statSync(f).size > 200_000_000) throw new Error("Fails lielāks par 200 MB.");
			const bytes = new Uint8Array(readFileSync(f));
			const text = TEXT_FORMATS.has(ext) ? (await extractBytes(ext, bytes)).pages.join("\n\n") : new TextDecoder("utf-8").decode(bytes.slice(0, 2_000_000));
			return cut(text.slice(offset ?? 0));
		},
	}),
	tool({
		name: "list_dir",
		level: "read",
		description: "The files and folders in a folder (name, size, date). A relative path is under the open project's folder; empty = that folder.",
		input: { path: z.string().optional() },
		run: (ctx, { path }) => {
			const d = abs(ctx, path || ".");
			if (!existsSync(d) || !statSync(d).isDirectory()) throw new Error(`Mapes nav: ${d}`);
			return {
				folder: d,
				items: readdirSync(d, { withFileTypes: true })
					.slice(0, 500)
					.map((e) => {
						const full = join(d, e.name);
						try {
							const s = statSync(full);
							return e.isDirectory() ? { name: `${e.name}\\`, date: s.mtime.toISOString().slice(0, 10) } : { name: e.name, kb: Math.round(s.size / 1024), date: s.mtime.toISOString().slice(0, 10) };
						} catch {
							return { name: e.name };
						}
					}),
			};
		},
	}),
	tool({
		name: "find_files",
		level: "read",
		description: "Find files under a folder (default: the open project's folder) by name (words or *.ext) and, optionally, by text inside (plain-text files only). Up to 200 results.",
		input: { name: z.string().optional(), text: z.string().optional(), folder: z.string().optional() },
		run: (ctx, a) => {
			const root = abs(ctx, a.folder || ".");
			const pat = (a.name ?? "").toLowerCase();
			const glob = pat.includes("*") ? new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i") : null;
			const words = glob ? [] : pat.split(/\s+/).filter(Boolean);
			const out: string[] = [];
			let seen = 0;
			const walk = (d: string, depth: number) => {
				if (depth > 10 || out.length >= 200 || seen > 100_000) return;
				let entries;
				try {
					entries = readdirSync(d, { withFileTypes: true });
				} catch {
					return;
				}
				for (const e of entries) {
					seen++;
					const full = join(d, e.name);
					if (e.isDirectory()) {
						if (!/^(node_modules|\.git)$/i.test(e.name)) walk(full, depth + 1);
						continue;
					}
					const n = e.name.toLowerCase();
					if (glob ? !glob.test(n) : !words.every((w) => n.includes(w))) continue;
					if (a.text) {
						try {
							if (statSync(full).size > 5_000_000 || !readFileSync(full, "utf8").toLowerCase().includes(a.text.toLowerCase())) continue;
						} catch {
							continue;
						}
					}
					out.push(full);
					if (out.length >= 200) return;
				}
			};
			walk(root, 0);
			return out.length ? out : "no data: nekas neatrasts.";
		},
	}),
	tool({
		name: "write_file",
		level: "confirm",
		description:
			"Write a text file (create, or replace what is there; the old file is kept in the app's backups first). Your own files (analyses, letters, lists) go to YOUR WORK FOLDER in the app: a relative path means that folder, and a text note (.md, .txt, .csv, .json, .html…) there runs without asking. Read it back with the full path the result gives. The office's project folders are read-only for you: a path inside one is refused, whatever the user would click; the user copies to 1.4_Nodevumi himself. Any other path, or a file type that is not plain text, waits for the user's click.",
		input: { path: z.string(), content: z.string() },
		run: (ctx, { path, content }) => {
			noOffice(ctx, "write_file", { path });
			const f = resolveWrite(ctx, path);
			const kept = keep(ctx, f);
			mkdirSync(dirname(f), { recursive: true });
			writeFileSync(f, content, "utf8");
			return { ok: true, file: f, ...(kept ? { previousKeptAt: kept } : {}) };
		},
	}),
	tool({
		name: "edit_file",
		level: "confirm",
		description:
			"Change part of a text file: every place where `old` stands exactly once is replaced by `new` (more than one place, or none, is an error: give more of the text around it, or pass all: true to change every place). Use it to fix a note instead of writing the whole file again. The old file is kept in the app's backups first. A relative path means your work folder in the app. Runs without asking on a text note there; the office's project folders are read-only for you (refused); any other path waits for the user's click.",
		input: { path: z.string(), old: z.string().min(1), new: z.string(), all: z.boolean().optional() },
		run: (ctx, a) => {
			noOffice(ctx, "edit_file", { path: a.path });
			const f = resolveWrite(ctx, a.path);
			if (!existsSync(f) || !statSync(f).isFile()) throw new Error(`Tas nav fails: ${f}`);
			const text = readFileSync(f, "utf8");
			const n = text.split(a.old).length - 1;
			if (n === 0) throw new Error("Teksts, ko mainīt, failā nav atrasts (jābūt burtiski tādam pašam).");
			if (n > 1 && !a.all) throw new Error(`Teksts atrasts ${n} vietās; dod vairāk apkārtējā teksta vai all: true.`);
			const kept = keep(ctx, f);
			writeFileSync(f, text.split(a.old).join(a.new), "utf8");
			return { ok: true, file: f, replaced: n, ...(kept ? { previousKeptAt: kept } : {}) };
		},
	}),
	tool({
		name: "move_file",
		level: "confirm",
		description: "Move or rename a file (never a folder). The target must not exist. Neither end may be in an office project folder (read-only for you: refused); a relative target means your work folder. Waits for the user's click.",
		input: { from: z.string(), to: z.string() },
		run: (ctx, a) => {
			noOffice(ctx, "move_file", a);
			const from = abs(ctx, a.from);
			const to = resolveWrite(ctx, a.to);
			if (!existsSync(from) || !statSync(from).isFile()) throw new Error(`Tas nav fails: ${from} (mapes netiek pārvietotas).`);
			if (existsSync(to)) throw new Error(`Mērķis jau ir: ${to}`);
			mkdirSync(dirname(to), { recursive: true });
			renameSync(from, to);
			return { ok: true, from, to };
		},
	}),
	tool({
		name: "copy_file",
		level: "confirm",
		description: "Copy a file (never a folder). An existing target is kept in the app's backups before it is replaced. The target may not be in an office project folder (read-only for you: refused); a relative target means your work folder, and a copy of a text file there needs no click. Any other target waits for the user's click.",
		input: { from: z.string(), to: z.string() },
		run: (ctx, a) => {
			noOffice(ctx, "copy_file", { to: a.to });
			const from = abs(ctx, a.from);
			const to = resolveWrite(ctx, a.to);
			if (!existsSync(from) || !statSync(from).isFile()) throw new Error(`Tas nav fails: ${from}`);
			const kept = keep(ctx, to);
			mkdirSync(dirname(to), { recursive: true });
			copyFileSync(from, to);
			return { ok: true, from, to, ...(kept ? { previousKeptAt: kept } : {}) };
		},
	}),
	tool({
		name: "run_command",
		level: "confirm",
		description:
			"Run a PowerShell command on the PC and get its output (2 minutes at most): convert files, call a program, check something the app's tools do not. Never delete folders. NEVER for Revit: no clicking in its windows (UI automation), no starting, stopping or inspecting its process — such a command is refused. Revit work goes through the Revit MCP tools and the revit_* tools. Waits for the user's click, who sees the command. cwd: a folder (default: your work folder in the app, where a file a command writes belongs). A command that writes into an office project folder is refused.",
		input: { command: z.string().min(1), cwd: z.string().optional() },
		run: (ctx, a) =>
			new Promise((ok, fail) => {
				// the gate refuses these before the user is asked (levels.ts neverByArgs); this is the same rule where the command would run
				const blocked = revitShellBlock(a.command) ?? appShellBlock(a.command);
				if (blocked) return fail(new Error(blocked));
				const office = officeBlock(ctx, "run_command", a);
				if (office) return fail(new Error(office));
				const cwd = a.cwd ? abs(ctx, a.cwd) : workFolder(ctx);
				if (!a.cwd) mkdirSync(cwd, { recursive: true });
				execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", a.command], { cwd, timeout: 120_000, maxBuffer: 8_000_000, windowsHide: true }, (err, stdout, stderr) => {
					ok({ exitCode: err ? ((err as { code?: number }).code ?? 1) : 0, stdout: cut(String(stdout), 30_000), ...(stderr ? { stderr: cut(String(stderr), 10_000) } : {}), ...(err && (err as { killed?: boolean }).killed ? { note: "apturēts pēc 2 minūtēm" } : {}) });
				});
			}),
	}),
];
