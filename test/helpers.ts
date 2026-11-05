// Test doubles only. A fake Revit that answers the app's snippets and writes the files a real export would write.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RevitCaller } from "../src/main/revit/commands.ts";
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

const ok = (v: unknown) => `Code execution successful!\nResult: ${JSON.stringify({ Success: true, Result: JSON.stringify(v) })}`;

export const G1 = "0abcdefghijklmnopqrstu";
export const G2 = "1abcdefghijklmnopqrstu";
const ifc = (x: number, extra = "") => `#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCLOCALPLACEMENT($,#2);
#4=IFCCARTESIANPOINT((${x}.,0.,0.));
#5=IFCAXIS2PLACEMENT3D(#4,$,$);
#6=IFCLOCALPLACEMENT(#3,#5);
#7=IFCWALL('${G1}',$,'W1',$,$,#6,$,$,$);
${extra}`;

export interface FakeRevitOpts {
	workPath: string;
	/** how many times export has run: lets revision 2 differ from revision 1 */
	state: { exports: number };
}

export function fakeRevit(o: FakeRevitOpts): RevitCaller {
	return {
		async call(tool, args) {
			if (tool === "list_revit_instances") return JSON.stringify({ selectedPid: 1, count: 1, instances: [{ pid: 1 }] });
			const code = String(args.code);
			const p = (args.parameters as string[]) ?? [];
			if (code.includes("document.Title")) return ok({ title: "A_WORK", path: o.workPath, version: "2026", isFamily: false, view: "1. stāvs", viewId: "11" });
			if (code.includes("OfClass(typeof(View))")) return ok([{ id: "11", name: "1. stāvs", type: "FloorPlan" }, { id: "12", name: "Fasāde A", type: "Elevation" }, { id: "13", name: "3D", type: "ThreeD" }]);
			if (code.includes("PDFExportOptions")) {
				writeFileSync(join(p[0], `${p[1]}.pdf`), pdf("100 100 400 300 re S"));
				return ok(true);
			}
			if (code.includes("IFCExportOptions")) {
				o.state.exports++;
				writeFileSync(join(p[0], `${p[1]}.ifc`), ifc(o.state.exports === 1 ? 1000 : 3000, o.state.exports > 1 ? `#8=IFCDOOR('${G2}',$,'D1',$,$,#6,$,$,$,$);` : ""));
				return ok(true);
			}
			if (code.includes("CropBox")) return ok({ id: p[0], name: "v", type: "FloorPlan", scale: 100, cropActive: true, level: "L1", elevMm: 0, min: [0, 0], max: [10000, 5000], origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0] });
			if (code.includes("OST_Rooms")) return ok({ rooms: [{ id: "r1", name: "Foajē", level: "L1", areaM2: 20 + o.state.exports }], levels: [{ name: "L1", elevMm: 0 }], walls: 4, floors: 1 });
			if (code.includes("document.Save()")) return ok(o.workPath);
			if (code.includes("ViewPlan.Create")) return ok(["2. stāvs"]);
			if (code.includes("v.Scale =")) return ok(Number(p[1]));
			if (code.includes("CreateElevationMarker")) return ok(["Ziemeļi", "Austrumi", "Dienvidi", "Rietumi"]);
			if (code.includes("ViewSheet.Create")) return ok("999");
			throw new Error(`fake Revit does not know this snippet: ${code.slice(0, 40)}`);
		},
	};
}
