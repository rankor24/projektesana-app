import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer only. Loaded from file:// inside Electron, so asset paths must be relative.
// Two pages: the app (index.html) and the hidden page renderer main uses for OCR and sheet compare (offscreen/render.html).
export default defineConfig({
	root: "src/renderer",
	base: "./",
	plugins: [react()],
	build: {
		outDir: "../../dist/renderer",
		emptyOutDir: true,
		chunkSizeWarningLimit: 4000,
		rollupOptions: { input: { index: resolve(import.meta.dirname, "src/renderer/index.html"), render: resolve(import.meta.dirname, "src/renderer/offscreen/render.html") } },
	},
});
