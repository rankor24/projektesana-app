// bimcraft:// — serves the BimCraft copy in resources/bimcraft to the preview frame, with the URL layout BimCraft's own dev
// server uses (getcadcraft/bimcraft devshell/serve.mjs mapUrl, ported):
//   /                                   the pre-rendered page (index.html)
//   /assets/apps/bimcraft/dev/…         app/
//   /assets/vendor/<lib>/<ver|current>/… vendor/<lib>/<ver>/   (current = the version app.json pins)
//   other /assets/…, /favicon.*         site/
// Nothing outside resources/bimcraft is served. BimCraft's page uses absolute paths, so it cannot run from file://.
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

export const BIMCRAFT_SCHEME = "bimcraft";

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".wasm": "application/wasm",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".txt": "text/plain; charset=utf-8",
	".map": "application/json",
	".bcmap": "application/octet-stream",
	".pfb": "application/octet-stream",
	".icc": "application/vnd.iccprofile",
	".zip": "application/zip",
};

const inside = (base: string, rel: string): string | null => {
	const p = resolve(base, rel);
	const b = resolve(base);
	return p === b || p.startsWith(b + sep) ? p : null;
};

export interface BimcraftSite {
	dir: string;
	vendorPins: Record<string, string>;
	isolate: string;
}

export function bimcraftSite(dir: string): BimcraftSite | null {
	if (!existsSync(join(dir, "index.html")) || !existsSync(join(dir, "app", "bimcraft.js"))) return null;
	const meta = JSON.parse(readFileSync(join(dir, "app.json"), "utf8")) as { vendor?: Record<string, string> };
	let isolate = "";
	try {
		isolate = (JSON.parse(readFileSync(join(dir, "app", "manifest.json"), "utf8")) as { isolate?: string }).isolate ?? "";
	} catch {
		// no isolation asked
	}
	return { dir, vendorPins: meta.vendor ?? {}, isolate };
}

/** URL path → file in the copy, or null (404). */
export function mapBimcraftPath(site: BimcraftSite, pathname: string): string | null {
	if (pathname === "/" || pathname === "/index.html") return join(site.dir, "index.html");
	let m = /^\/assets\/apps\/([a-z0-9-]+)\/dev\/(.*)$/.exec(pathname);
	if (m) return m[1] === "bimcraft" ? inside(join(site.dir, "app"), m[2]) : null;
	m = /^\/assets\/vendor\/([a-z0-9._-]+)\/([a-z0-9._-]+)\/(.*)$/.exec(pathname);
	if (m && m[1] !== "bootstrap-icons") {
		const ver = m[2] === "current" ? site.vendorPins[m[1]] : m[2];
		return ver ? inside(join(site.dir, "vendor", m[1], ver), m[3]) : null;
	}
	if (pathname.startsWith("/assets/") || /^\/favicon[\w.-]*\.(svg|ico|png)$/.test(pathname)) return inside(join(site.dir, "site"), pathname.slice(1));
	return null;
}

export function bimcraftResponse(site: BimcraftSite, url: string): { status: number; headers: Record<string, string>; file: string | null } {
	const u = new URL(url);
	const file = mapBimcraftPath(site, decodeURIComponent(u.pathname));
	const headers: Record<string, string> = { "Cache-Control": "no-cache" };
	if (site.isolate === "require-corp" || site.isolate === "credentialless") {
		headers["Cross-Origin-Opener-Policy"] = "same-origin";
		headers["Cross-Origin-Embedder-Policy"] = site.isolate;
		headers["Cross-Origin-Resource-Policy"] = "same-origin";
	}
	if (!file || !existsSync(file)) return { status: 404, headers, file: null };
	headers["Content-Type"] = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
	return { status: 200, headers, file };
}
