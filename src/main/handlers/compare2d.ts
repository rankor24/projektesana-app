// 2D compare in main: DWG (one drawing, or two as DWGCOMPARE through CadCraft, src/sources/dwg.ts) and the text of two
// documents (DOCX, XLSX, TXT, a PDF's text). The refs are the compare refs of compare.ts: "src:<sourceId>", "blob:<sha>",
// "file:<root>:<path>", or a path in the project. CadCraft's modules sit next to BimCraft's in the resources folder.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Registry } from "../../core/registry.js";
import type { ProjectStore } from "../../core/store.js";
import type { Handlers } from "../../shared/api.js";
import { extOf } from "../../shared/compare2d.js";
import { dwgCompare, dwgView } from "../../sources/dwg.js";
import { extractBytes, TEXT_FORMATS } from "../../sources/text/index.js";
import { refBytes } from "./compare.js";

type K = "dwg.view" | "dwg.compare" | "dwg.bytes" | "dwg.craft" | "compare.text";

/** The file name behind a ref, for its extension and its label. */
export function refName(store: ProjectStore, ref: string): string {
	if (ref.startsWith("src:")) {
		const s = store.read("sources").find((x) => x.id === ref.slice(4));
		if (!s) throw new Error(`Avots ${ref.slice(4)} nav atrasts.`);
		return s.container?.inner ?? s.paths[0]?.split("::").pop() ?? s.title;
	}
	if (ref.startsWith("blob:")) return `${ref}.pdf`;
	if (ref.startsWith("file:")) return ref.split(":").slice(2).join(":");
	return ref;
}

async function textOf(store: ProjectStore, ref: string): Promise<{ text: string; note: string | null }> {
	// a source already read by the scan: its stored text, the same the agent quotes from
	if (ref.startsWith("src:")) {
		const s = store.read("sources").find((x) => x.id === ref.slice(4));
		const v = s?.versions[s.versions.length - 1];
		const kept = v?.sha256 ? store.readText(v.sha256) : null;
		if (kept?.state === "ok" && kept.pages.length) return { text: kept.pages.join("\n\n"), note: null };
	}
	const ext = `.${extOf(refName(store, ref))}`;
	if (!TEXT_FORMATS.has(ext)) return { text: "", note: `${ext.toUpperCase()} teksts netiek lasīts.` };
	const r = await extractBytes(ext, refBytes(store, ref, /./));
	const text = r.pages.join("\n\n");
	return { text, note: r.state === "ok" ? null : r.state === "ocr" || r.state === "empty" ? "Dokumentam nav teksta slāņa (skenēts?): salīdzini kā lapas." : (r.reason ?? r.state) };
}

export function compare2dHandlers(d: { registry: Registry; bimcraftApp: string }): Pick<Handlers, K> {
	const cad = join(dirname(dirname(d.bimcraftApp)), "cadcraft", "app");
	const dwgBytes = (store: ProjectStore, ref: string) => {
		if (extOf(refName(store, ref)) !== "dwg") throw new Error(`Nav DWG: ${refName(store, ref)}`);
		return refBytes(store, ref, /\.dwg$/i);
	};
	return {
		"dwg.view": (id, ref) => {
			const store = d.registry.store(id);
			return dwgView(cad, dwgBytes(store, ref));
		},
		"dwg.bytes": (id, ref) => dwgBytes(d.registry.store(id), ref),
		// CadCraft's page is there (resources/cadcraft/index.html): the DWG opens in it; else the plain line view
		"dwg.craft": () => existsSync(join(dirname(cad), "index.html")) && existsSync(join(cad, "cadcraft.js")),
		"dwg.compare": (id, a, b) => {
			const store = d.registry.store(id);
			return dwgCompare(cad, dwgBytes(store, a), dwgBytes(store, b));
		},
		"compare.text": async (id, a, b) => {
			const store = d.registry.store(id);
			const [x, y] = await Promise.all([textOf(store, a), textOf(store, b)]);
			return { a: x.text, b: y.text, note: [x.note && `A: ${x.note}`, y.note && `B: ${y.note}`].filter(Boolean).join(" ") || null };
		},
	};
}
