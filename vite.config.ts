import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer only. Loaded from file:// inside Electron, so asset paths must be relative.
export default defineConfig({
	root: "src/renderer",
	base: "./",
	plugins: [react()],
	build: { outDir: "../../dist/renderer", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
