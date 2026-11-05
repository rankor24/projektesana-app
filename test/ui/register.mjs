// UI tests: browser-only imports (vite `?url` assets, pdf.js, ifc-lite, css) resolve to small stubs. Runs in-thread before tsx.
import { registerHooks } from "node:module";

const STUBS = {
	url: "export default '';",
	pdf: "export const GlobalWorkerOptions = {}; export function getDocument() { throw new Error('pdf stub'); }",
	empty: "export {};",
};

registerHooks({
	resolve(specifier, context, next) {
		if (specifier.endsWith("?url")) return { url: "stub:url", shortCircuit: true, format: "module" };
		if (specifier === "pdfjs-dist" || specifier.startsWith("@ifc-lite/")) return { url: "stub:pdf", shortCircuit: true, format: "module" };
		if (specifier.endsWith(".css")) return { url: "stub:empty", shortCircuit: true, format: "module" };
		return next(specifier, context);
	},
	load(url, context, next) {
		if (url.startsWith("stub:")) return { format: "module", source: STUBS[url.slice(5)], shortCircuit: true };
		return next(url, context);
	},
});
