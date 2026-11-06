// Old Office formats (.doc, .rtf, .xls, .msg, .ppt) through the installed Office, with one PowerShell COM helper
// (resources/office-text.ps1). Called once per sha: the pipeline caches the text. When Office is absent the state is
// `unsupported` with the reason, never empty text.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { Extracted } from "./index.js";

export const KIND_OF: Record<string, "doc" | "xls" | "msg" | "ppt"> = { ".doc": "doc", ".rtf": "doc", ".xls": "xls", ".msg": "msg", ".ppt": "ppt" };
const PROGID = { doc: "Word.Application", xls: "Excel.Application", msg: "Outlook.Application", ppt: "PowerPoint.Application" } as const;

export function officeArgs(script: string, path: string, kind: string): string[] {
	return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Path", path, "-Kind", kind];
}

/** Parses the helper's one JSON line. Anything else is an error with the text the helper printed. */
export function parseOfficeOutput(stdout: string): Extracted {
	const line = stdout.split(/\r?\n/).find((l) => l.trim().startsWith("{"));
	if (!line) return { state: "error", pages: [], reason: `Office palīgs neatbildēja: ${stdout.slice(0, 300) || "(tukšs)"}` };
	let j: { ok?: boolean; pages?: unknown; reason?: string };
	try {
		j = JSON.parse(line);
	} catch {
		return { state: "error", pages: [], reason: `Office palīgs atbildēja ne JSON: ${line.slice(0, 300)}` };
	}
	if (!j.ok) return { state: "error", pages: [], reason: j.reason ?? "Office kļūda" };
	const pages = (Array.isArray(j.pages) ? j.pages : [j.pages]).map((p) => String(p ?? ""));
	const letters = pages.join("").match(/\p{L}/gu)?.length ?? 0;
	return letters ? { state: "ok", pages } : { state: "empty", pages, reason: "Office dokumentā nav teksta." };
}

/** Is the Office application for this kind registered (HKCR\<ProgID>)? Asked once per kind. */
const present = new Map<string, Promise<boolean>>();
export function officeHas(kind: keyof typeof PROGID): Promise<boolean> {
	if (process.platform !== "win32") return Promise.resolve(false);
	let p = present.get(kind);
	if (!p) {
		p = new Promise((resolve) => execFile("reg", ["query", `HKCR\\${PROGID[kind]}\\CLSID`], { windowsHide: true }, (err) => resolve(!err)));
		present.set(kind, p);
	}
	return p;
}

export function officeText(script: string, abs: string, ext: string, timeoutMs = 120_000): Promise<Extracted> {
	const kind = KIND_OF[ext.toLowerCase()];
	if (!kind) return Promise.resolve({ state: "unsupported", pages: [], reason: `formāts ${ext} nav Office` });
	if (!existsSync(script)) return Promise.resolve({ state: "unsupported", pages: [], reason: `Office palīgs nav atrasts: ${script}` });
	return officeHas(kind).then((has) => {
		if (!has) return { state: "unsupported" as const, pages: [], reason: `${PROGID[kind]} nav instalēts` };
		return new Promise<Extracted>((resolve) => {
			execFile("powershell.exe", officeArgs(script, abs, kind), { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
				if (err && !stdout) return resolve({ state: "error", pages: [], reason: `Office palīgs: ${err.message} ${stderr}`.trim() });
				resolve(parseOfficeOutput(stdout));
			});
		});
	});
}
