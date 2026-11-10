// Test helpers: a real offline pi runtime on the test store, and a minimal PDF builder for file-reading tests.
import type { Store } from "../src/main/store.ts";
import { createPiRuntime, type PiRuntime } from "../src/agent-pi/index.ts";

/** A real pi runtime on the test's store (keys from the store, tokens and model cache in its folder). Offline. */
export function piFor(store: Store): () => Promise<PiRuntime> {
	let rt: PiRuntime | null = null;
	return async () => (rt ??= createPiRuntime({ path: store.piCredentialsFile(), seal: store.crypto, apiKey: (p) => store.apiKey(p), modelCachePath: store.modelCacheFile() }));
}

/** Smallest valid PDF with one content stream (page 600 x 800). */
export function pdf(content: string): Buffer {
	const objs = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let out = "%PDF-1.4\n";
	const offs: number[] = [];
	objs.forEach((o, i) => {
		offs.push(out.length);
		out += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
	out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return Buffer.from(out, "latin1");
}
