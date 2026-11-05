// THROWAWAY feasibility check (spec §11 step 0). Needs a live Revit with a model open and the Revit MCP switched on.
//   node --import tsx spike/run-spike.ts <revit-mcp server/build/index.js> <empty output folder>
// It exports the ACTIVE document only; it never saves, never changes the model.
// Prints what worked, what failed, and the numbers the pin → model maths depends on.
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { connectRevit } from "../src/main/revit/client.ts";
import { docInfo, exportIfc, exportPdf, listViews, modelSummary, revitStatus, viewGeometry } from "../src/main/revit/commands.ts";
import { pdfContentRect } from "../src/main/loop/pdfrect.ts";

const [serverJs, out] = process.argv.slice(2);
if (!serverJs || !out) {
	console.error("usage: run-spike.ts <revit-mcp index.js> <output folder>");
	process.exit(2);
}
mkdirSync(out, { recursive: true });

const rev = await connectRevit(serverJs);
const results: [string, string][] = [];
async function step(name: string, fn: () => Promise<unknown>) {
	try {
		const v = await fn();
		results.push([name, `OK ${typeof v === "object" ? JSON.stringify(v).slice(0, 300) : String(v)}`]);
		return v;
	} catch (e) {
		results.push([name, `FAIL ${(e as Error).message}`]);
		return undefined;
	}
}
try {
	console.log(JSON.stringify(await revitStatus(rev)));
	const doc = (await step("document info", () => docInfo(rev))) as { version?: string } | undefined;
	const views = (await step("list views", () => listViews(rev))) as { id: string; name: string; type: string }[] | undefined;
	const plan = views?.find((v) => v.type === "FloorPlan");
	if (plan) {
		await step("export PDF (one plan view)", () => exportPdf(rev, out, "spike-plan", plan.id));
		const f = join(out, "spike-plan.pdf");
		await step("PDF file exists", async () => (existsSync(f) ? `${statSync(f).size} bytes` : Promise.reject(new Error("no file; look in the folder for the name Revit chose"))));
		const rect = (await step("PDF content rectangle", () => pdfContentRect(f))) as Parameters<typeof viewGeometry>[2] | undefined;
		if (rect) await step("view geometry (crop, scale, transform)", () => viewGeometry(rev, plan.id, rect));
	} else results.push(["export PDF", "SKIP no floor plan view in the model"]);
	await step("export IFC", () => exportIfc(rev, out, "spike-model"));
	await step("IFC file exists", async () => (existsSync(join(out, "spike-model.ifc")) ? `${statSync(join(out, "spike-model.ifc")).size} bytes` : Promise.reject(new Error("no file"))));
	await step("model summary", () => modelSummary(rev));
	console.log(`Revit version: ${doc?.version ?? "unknown"}`);
} finally {
	await rev.close();
}
for (const [n, r] of results) console.log(`${n.padEnd(42)} ${r}`);
