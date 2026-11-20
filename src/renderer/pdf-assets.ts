// Where pdf.js finds its decoders (pdfjs-dist/wasm, copied next to the bundle by vite.config.ts): without `wasmUrl` a scanned
// PDF's JBIG2 or JPEG 2000 images do not decode, so the viewer shows blank pages and OCR reads nothing. Resolved from this
// module's own URL (dist/renderer/assets/…), so the app window and the hidden OCR page both find dist/renderer/pdfjs/wasm/.
export const PDF_WASM_URL = new URL("../pdfjs/wasm/", import.meta.url).href;
