// What happens after a change in a project: requirements are re-derived and the checks subscribed to the event run.
// One place, called by every handler that changes project data (scan, role, fact decisions, deliveries, pins).
import { statSync } from "node:fs";
import { registerAppChecks } from "../checks/index.js";
import type { CheckEvent } from "../checks/registry.js";
import { runChecks, type RunSummary } from "../checks/run.js";
import type { ProjectStore } from "../core/store.js";
import { refreshRequirements, type OfficeStandard } from "../rules/refresh.js";
import { pdfText } from "../sources/text/pdf.js";

export interface EngineDeps {
	dataDir: string;
	officeStandardPdf: () => string | null;
	/** model rooms when Revit is connected (3.2) */
	modelRooms?: () => Promise<{ number: string; name: string; level: string; area: number; id: string }[] | undefined>;
}

export class ProjectEngine {
	private office: { file: string; stamp: string; std: OfficeStandard } | null = null;

	constructor(private d: EngineDeps) {
		registerAppChecks();
	}

	/** The office standard's text, read once per file version. Absent or unreadable → null (the rules say so). */
	async officeStandard(): Promise<OfficeStandard | null> {
		const file = this.d.officeStandardPdf();
		if (!file) return null;
		try {
			const s = statSync(file);
			const stamp = `${s.size}:${s.mtimeMs}`;
			if (this.office?.file === file && this.office.stamp === stamp) return this.office.std;
			const t = await pdfText(file);
			this.office = { file, stamp, std: { file, pages: t.pages } };
			return this.office.std;
		} catch {
			return null;
		}
	}

	async afterChange(store: ProjectStore, what: string, opts: { deliveryId?: string } = {}): Promise<RunSummary> {
		const today = new Date().toISOString().slice(0, 10);
		if (what === "sources" || what === "facts" || what === "roles" || what === "requirements" || what === "manual") refreshRequirements(store, this.d.dataDir, await this.officeStandard(), today);
		const event = (["sources", "facts", "roles", "requirements", "delivery", "pins", "rooms", "manual"].includes(what) ? what : "manual") as CheckEvent;
		const modelRooms = event === "rooms" || event === "manual" ? await this.d.modelRooms?.().catch(() => undefined) : undefined;
		return runChecks(store, event, { dataDir: this.d.dataDir, today, deliveryId: opts.deliveryId, modelRooms });
	}
}
