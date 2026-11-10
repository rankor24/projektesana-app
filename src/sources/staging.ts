// Staging of a delivery being made (work plan 7.1): <data>\nodevumi\<KIND>\<YYMMDD>\, the same layout as the office folder
// 1.4_Nodevumi\<KIND>\<YYMMDD>\, so the set that is checked is the set that gets copied. A draft is a Delivery like any other
// (timeline chip, checks, gate); its items are the staged files with absolute paths in the app's data folder.
// Everything here writes inside the data folder only (checkWrite); the copy into the office folder is deliver-copy.ts.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { checkRead, checkWrite, isInside } from "../core/guard.js";
import type { Delivery, DeliveryItem, DeliveryKind, Who } from "../core/model.js";
import type { ProjectStore } from "../core/store.js";
import { itemOf, withStages } from "./deliveries.js";
import { isJunk } from "./roles.js";

/** The kinds a delivery can be started as (PR and custom are read from the office folder only). */
export const DRAFT_KINDS = ["SKICE", "MBP", "BP", "DT", "STARP"] as const satisfies readonly DeliveryKind[];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validIso = (iso: string) => ISO.test(iso) && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso;

/** "2026-11-10" → "261110" (the office folder name). */
export const yymmdd = (iso: string) => `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;
export const draftId = (kind: DeliveryKind, date: string) => `draft_${kind}_${yymmdd(date)}`;
export const stagingDirOf = (store: ProjectStore, kind: DeliveryKind, date: string) => join(store.dir, "nodevumi", kind, yymmdd(date));

/** Files under a staging folder (subfolders such as sections are allowed), as delivery items with absolute paths. */
export function stagedItems(dir: string): DeliveryItem[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	const walk = (p: string, depth: number) => {
		if (depth > 4) return;
		for (const e of readdirSync(p, { withFileTypes: true })) {
			const full = join(p, e.name);
			if (e.isDirectory()) walk(full, depth + 1);
			else if (e.isFile() && !isJunk(e.name) && !e.name.endsWith(".part")) out.push(full);
		}
	};
	walk(dir, 0);
	return out.sort((a, b) => a.localeCompare(b, "lv", { numeric: true })).map(itemOf);
}

/** Fingerprint of a staging folder: every file's path, size and time. Any change to the set changes it. */
export function stagingFingerprint(dir: string): string {
	const h = createHash("sha256");
	for (const i of stagedItems(dir)) {
		const s = statSync(i.file);
		h.update(`${i.file}|${s.size}|${s.mtimeMs}
`);
	}
	return h.digest("hex").slice(0, 16);
}

export function draftOf(store: ProjectStore, deliveryId: string): Delivery & { draft: NonNullable<Delivery["draft"]> } {
	const d = store.read("deliveries").find((x) => x.id === deliveryId);
	if (!d) throw new Error(`Nodevums ${deliveryId} nav atrasts.`);
	if (!d.draft) throw new Error(`${d.label} nav gatavojams nodevums (tas ir nolasīts no 1.4_Nodevumi).`);
	return d as Delivery & { draft: NonNullable<Delivery["draft"]> };
}

/** The open draft (not yet sent) the user works on: the one named, or the newest open one. */
export function activeDraft(store: ProjectStore, deliveryId?: string): (Delivery & { draft: NonNullable<Delivery["draft"]> }) | null {
	if (deliveryId) return draftOf(store, deliveryId);
	const open = store.read("deliveries").filter((d) => d.draft && !d.sent);
	open.sort((a, b) => b.draft!.startedAt.localeCompare(a.draft!.startedAt));
	return (open[0] as Delivery & { draft: NonNullable<Delivery["draft"]> }) ?? null;
}

/** "Nodot projektu": a new draft of this kind for this date, with its empty staging folder. */
export function startDraft(store: ProjectStore, kind: string, date: string, by: Who): Delivery {
	if (!(DRAFT_KINDS as readonly string[]).includes(kind)) throw new Error(`Nodevuma veids: ${DRAFT_KINDS.join(", ")}.`);
	if (!validIso(date)) throw new Error("Datums formā GGGG-MM-DD.");
	const k = kind as DeliveryKind;
	const id = draftId(k, date);
	const all = store.read("deliveries");
	if (all.some((d) => d.id === id)) throw new Error(`${k} ${yymmdd(date)} jau ir sākts.`);
	const dir = stagingDirOf(store, k, date);
	const g = checkWrite(store.guard, dir);
	if (!g.ok) throw new Error(g.reason);
	mkdirSync(dir, { recursive: true });
	const row: Delivery = {
		id,
		stage: "Koncept",
		kind: k,
		label: `${k} ${yymmdd(date)}`,
		plannedDate: date,
		plannedFrom: "user",
		submittedDate: null,
		folder: dir,
		items: stagedItems(dir),
		checksRun: [],
		draft: { stagingDir: dir, startedAt: new Date().toISOString(), date, copiedTo: null },
	};
	// a planned-only row of this kind is what this draft now is
	const rest = all.filter((d) => !(d.id.startsWith("plan_") && d.kind === k));
	store.write("deliveries", withStages([...rest, row]), { kind: "delivery.started", by, data: { id, kind: k, date } });
	return store.read("deliveries").find((d) => d.id === id)!;
}

/** Re-reads the staging folder into the draft's items (after an export, a copy, a removal). */
export function refreshDraft(store: ProjectStore, deliveryId: string, by: Who, what = "delivery.staged"): Delivery {
	const d = draftOf(store, deliveryId);
	const items = stagedItems(d.draft.stagingDir);
	store.update("deliveries", (all) => all.map((x) => (x.id === deliveryId ? { ...x, items } : x)), { kind: what, by, data: { id: deliveryId, files: items.length } });
	return { ...d, items };
}

/** A file name safe for the office folder: diacritics folded, no path or reserved characters, no leading/trailing dots. */
export function safeName(name: string): string {
	const folded = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
	const clean = folded
		.replace(/[\\/:*?"<>|]+/g, "_")
		.replace(/[^\x20-\x7E]+/g, "_")
		.replace(/\s+/g, " ")
		.replace(/_+/g, "_")
		.trim()
		.replace(/^[.\s_]+|[.\s]+$/g, "");
	if (!clean || clean === "." || clean === "..") throw new Error(`Nederīgs faila nosaukums: “${name}”`);
	return clean.slice(0, 150);
}

/** A path inside the draft's staging folder for this file name; never outside it. */
export function stagedPath(store: ProjectStore, d: { draft: NonNullable<Delivery["draft"]> }, name: string): string {
	const p = join(d.draft.stagingDir, safeName(name));
	const g = checkWrite(store.guard, p);
	if (!g.ok) throw new Error(g.reason);
	if (!isInside(p, d.draft.stagingDir) || p === d.draft.stagingDir) throw new Error(`Ārpus nodevuma mapes: ${p}`);
	return p;
}

/** Copies a file the project already has (a source, an export) into staging under the given name. Never overwrites. */
export function stageFile(store: ProjectStore, deliveryId: string, from: string, name: string | undefined, by: Who): { file: string } {
	const d = draftOf(store, deliveryId);
	if (d.sent || d.draft.copiedTo) throw new Error(`${d.label} jau ir nokopēts uz 1.4 — staging vairs nemaina.`);
	const r = checkRead(store.guard, from);
	if (!r.ok) throw new Error(r.reason);
	if (!existsSync(r.path) || !statSync(r.path).isFile()) throw new Error(`Fails nav atrasts: ${r.path}`);
	const target = stagedPath(store, d, name ?? basename(r.path));
	if (existsSync(target)) throw new Error(`Nodevumā jau ir “${basename(target)}”. Vispirms izņem veco.`);
	copyFileSync(r.path, target);
	refreshDraft(store, deliveryId, by);
	return { file: target };
}

/** Removes one staged file (by its name in the staging folder). */
export function unstageFile(store: ProjectStore, deliveryId: string, name: string, by: Who): void {
	const d = draftOf(store, deliveryId);
	if (d.sent || d.draft.copiedTo) throw new Error(`${d.label} jau ir nokopēts uz 1.4 — staging vairs nemaina.`);
	const hit = d.items.find((i) => basename(i.file) === name || i.file === name);
	if (!hit) throw new Error(`Nodevumā nav faila “${name}”.`);
	const g = checkWrite(store.guard, hit.file);
	if (!g.ok || !isInside(hit.file, d.draft.stagingDir)) throw new Error(`Ārpus nodevuma mapes: ${hit.file}`);
	rmSync(hit.file, { force: true });
	refreshDraft(store, deliveryId, by, "delivery.unstaged");
}
