// Renaming the files of a delivery in staging (task 8.12). The plan is made first and shown (old → new, what cannot be decided,
// what collides); applying it is the user's click or the agent's `rename_staged`, and it only ever renames files inside the
// draft's own staging folder, never over a file that is already there, and records every rename so the whole batch can be taken
// back. The office folder is not touched: staging is copied into 1.4 later, by the user, after the checks.
import { existsSync, renameSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { recordRename, listCheckpoints, undoCheckpoint } from "../core/checkpoints.js";
import { checkWrite, isInside } from "../core/guard.js";
import { newId, type Who } from "../core/model.js";
import type { ProjectStore } from "../core/store.js";
import { planRenames, validName, type RenameMode, type RenameResult, type RenameRow } from "../shared/rename.js";
import { draftOf, refreshDraft } from "./staging.js";

const posix = (p: string) => p.replace(/\\/g, "/");

/** The plan for the draft's staged files. */
export function renamePlan(store: ProjectStore, deliveryId: string, mode: RenameMode = "office", revision?: string): RenameRow[] {
	const d = draftOf(store, deliveryId);
	const files = d.items.map((i) => posix(relative(d.draft.stagingDir, i.file))).sort((a, b) => a.localeCompare(b, "lv"));
	return planRenames(files, mode, { revision });
}

/** Renames files inside the draft's staging folder. Each pair is a file's path in staging and its new name (same folder). */
export function renameStaged(store: ProjectStore, deliveryId: string, pairs: { file: string; to: string }[], by: Who): RenameResult {
	const d = draftOf(store, deliveryId);
	if (d.sent || d.draft.copiedTo) throw new Error(`${d.label} jau ir nokopēts uz 1.4: staging vairs nemaina.`);
	const batch = newId("rn");
	const errors: string[] = [];
	let applied = 0;
	for (const { file, to } of pairs) {
		const bad = validName(to);
		if (bad) {
			errors.push(`${file}: ${bad}`);
			continue;
		}
		const src = resolve(d.draft.stagingDir, file);
		const dst = join(dirname(src), to);
		if (!isInside(src, d.draft.stagingDir) || !isInside(dst, d.draft.stagingDir) || src === resolve(d.draft.stagingDir)) {
			errors.push(`${file}: ārpus nodevuma mapes`);
			continue;
		}
		const gs = checkWrite(store.guard, src);
		const gd = checkWrite(store.guard, dst);
		if (!gs.ok || !gd.ok) {
			errors.push(`${file}: ${(!gs.ok ? gs : (gd as { reason: string })).reason}`);
			continue;
		}
		if (!existsSync(src) || !statSync(src).isFile()) {
			errors.push(`${file}: faila nav`);
			continue;
		}
		if (src === dst) continue;
		// never over another file; a change of letter case only (a.pdf → A.pdf) is the same file on Windows and is allowed
		if (existsSync(dst) && src.toLowerCase() !== dst.toLowerCase()) {
			errors.push(`${file}: nosaukums «${to}» jau ir`);
			continue;
		}
		renameSync(src, dst);
		recordRename(store, src, dst, batch);
		applied++;
	}
	if (applied) refreshDraft(store, deliveryId, by, "delivery.renamed");
	return { applied, errors, batch: applied ? batch : null };
}

/** Takes back every rename of one batch, last first. A name that is gone or whose old name was taken is said, not forced. */
export function undoRenameBatch(store: ProjectStore, deliveryId: string, batch: string): { reverted: number; errors: string[] } {
	draftOf(store, deliveryId);
	const list = listCheckpoints(store).filter((c) => c.batch === batch && c.renamedTo && c.state === "active");
	if (!list.length) throw new Error("Šo pārdēvēšanu atsaukt nevar: tās ieraksta nav vai tā jau atsaukta.");
	let reverted = 0;
	const errors: string[] = [];
	for (const cp of [...list].reverse()) {
		try {
			undoCheckpoint(store, cp.id);
			reverted++;
		} catch (e) {
			errors.push(`${basename(cp.renamedTo ?? "")}: ${(e as Error).message}`);
		}
	}
	if (reverted) refreshDraft(store, deliveryId, "user", "delivery.renameUndone");
	return { reverted, errors };
}
