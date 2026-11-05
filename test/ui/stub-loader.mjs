// Node loader for UI tests: browser-only imports (vite `?url` assets, pdf.js, ifc-lite) resolve to empty stubs.
export async function resolve(specifier, context, next) {
	if (specifier.endsWith("?url")) return { url: "data:text/javascript,export default ''", shortCircuit: true };
	if (specifier === "pdfjs-dist" || specifier.startsWith("@ifc-lite/")) return { url: "data:text/javascript,export const GlobalWorkerOptions={};export function getDocument(){throw new Error('pdf stub')}", shortCircuit: true };
	if (specifier.endsWith(".css")) return { url: "data:text/javascript,", shortCircuit: true };
	return next(specifier, context);
}
