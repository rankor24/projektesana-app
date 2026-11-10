// "Kopēt uz 1.4_Nodevumi" (work plan 7.6): the one place the app writes into the office project folder, on the user's click
// only, after "Sagatavot" with no blocking findings. Target: the project's existing kind folder (1.4.2_MBP, MBP, …) and a new
// YYMMDD folder in it — the dated delivery folder the office standard asks for; no other folder is ever made inside
// 01_Projektesana. Never overwrites; every copied file is compared by SHA-256 with its staged original.
import { createHash } from "node:crypto";
import { constants, copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { blocking } from "../checks/gate.js";
import { checkDeliveryWrite } from "../core/guard.js";
import type { DeliveryKind, Who } from "../core/model.js";
import type { ProjectStore } from "../core/store.js";
import { dateInName, deliveryKindOf } from "../core/stages.js";
import type { CopyPlan } from "../shared/nodevums.js";
import { findDeliveriesDir } from "./deliveries.js";
import { draftOf, stagingFingerprint, yymmdd } from "./staging.js";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The kind folder inside 1.4_Nodevumi that holds dated deliveries of this kind ("1.4.2_MBP", "MBP"); a folder that is itself
 *  a dated delivery ("1.4.3_BP_260109") is not one. Several candidates → the user picks by making it unambiguous. */
export function kindFolderOf(deliveriesDir: string, kind: DeliveryKind): { dir: string | null; why?: string } {
	let names: string[];
	try {
		names = readdirSync(deliveriesDir, { withFileTypes: true })
			.filter((e) => e.isDirectory() && !/^arh[iī]v/i.test(norm(e.name)))
			.map((e) => e.name);
	} catch (e) {
		return { dir: null, why: `1.4_Nodevumi nav nolasāma: ${(e as Error).message}` };
	}
	const hits = names.filter((n) => deliveryKindOf(n) === kind && !dateInName(n));
	if (hits.length === 1) return { dir: join(deliveriesDir, hits[0]) };
	if (!hits.length) return { dir: null, why: `1.4_Nodevumi nav mapes ${kind} veidam. Izveido to pats (01_Projektesana lietotne jaunas mapes neveido).` };
	return { dir: null, why: `1.4_Nodevumi ir vairākas ${kind} mapes (${hits.join(", ")}). Atstāj vienu vai pārdēvē pārējās.` };
}

export function copyPlan(store: ProjectStore, deliveryId: string): CopyPlan {
	const d = draftOf(store, deliveryId);
	const blockers: string[] = [];
	const root = store.project.root;
	const dd = existsSync(root) ? null : `Projekta mape nav pieejama: ${root}`;
	const deliveriesDir = dd ? null : findDeliveriesDirSync(root);
	let target = "";
	if (dd) blockers.push(dd);
	else if (!deliveriesDir) blockers.push("Projektā nav 01_Projektesana\\1.4_Nodevumi mapes.");
	else {
		const k = kindFolderOf(deliveriesDir, d.kind);
		if (!k.dir) blockers.push(k.why!);
		else {
			target = join(k.dir, yymmdd(d.draft.date));
			if (existsSync(target)) blockers.push(`Mape jau ir: ${target}. Lietotne to nepārraksta.`);
			const g = checkDeliveryWrite(store.guard, deliveriesDir, target);
			if (!g.ok) blockers.push(g.reason);
		}
	}
	if (d.draft.copiedTo) blockers.push(`Jau nokopēts uz ${d.draft.copiedTo}.`);
	if (d.sent) blockers.push("Jau atzīmēts kā nosūtīts.");
	if (!d.items.length) blockers.push("Nodevumā nav failu.");
	const last = d.checksRun[d.checksRun.length - 1];
	if (!last) blockers.push("Vispirms Sagatavot (pārbaudes).");
	else if (last.set !== stagingFingerprint(d.draft.stagingDir)) blockers.push("Faili mainīti pēc pēdējās pārbaudes — Sagatavot vēlreiz.");
	const open = blocking(store, deliveryId);
	if (open.length) blockers.push(`${open.length} atvērti atradumi (${open.slice(0, 2).map((f) => f.message).join("; ")}${open.length > 2 ? " …" : ""}).`);
	const bytes = d.items.reduce((s, i) => s + (existsSync(i.file) ? statSync(i.file).size : 0), 0);
	return { target, files: d.items.length, bytes, blockers };
}

/** findDeliveriesDir is async (readdir); the plan is shown on every render, so this one reads synchronously. */
function findDeliveriesDirSync(root: string): string | null {
	try {
		const top = readdirSync(root, { withFileTypes: true }).find((d) => d.isDirectory() && /^01[\s_.-]*projekt/.test(norm(d.name)));
		if (!top) return null;
		const inner = readdirSync(join(root, top.name), { withFileTypes: true }).find((d) => d.isDirectory() && /^1\.4(?![.\d])/.test(d.name.trim()));
		return inner ? join(root, top.name, inner.name) : null;
	} catch {
		return null;
	}
}

const sha256 = (file: string) =>
	new Promise<string>((res, rej) => {
		const h = createHash("sha256");
		createReadStream(file)
			.on("data", (c) => h.update(c))
			.on("error", rej)
			.on("end", () => res(h.digest("hex")));
	});

/** Copies the staged set into 1.4_Nodevumi\<kind>\<YYMMDD>. The user only; refuses on any blocker; never overwrites. */
export async function copyDelivery(store: ProjectStore, deliveryId: string, by: Who): Promise<{ target: string; files: number }> {
	if (by !== "user") throw new Error("Uz 1.4_Nodevumi kopē tikai lietotājs, ne aģents.");
	const plan = copyPlan(store, deliveryId);
	if (plan.blockers.length) throw new Error(`Nevar kopēt: ${plan.blockers.join(" ")}`);
	const d = draftOf(store, deliveryId);
	const deliveriesDir = await findDeliveriesDir(store.project.root);
	if (!deliveriesDir) throw new Error("Projektā nav 1.4_Nodevumi mapes.");
	const t = checkDeliveryWrite(store.guard, deliveriesDir, plan.target);
	if (!t.ok) throw new Error(t.reason);
	mkdirSync(t.path); // not recursive: the kind folder must already exist
	const copied: string[] = [];
	try {
		for (const it of d.items) {
			const rel = relative(d.draft.stagingDir, it.file);
			const g = checkDeliveryWrite(store.guard, deliveriesDir, t.path, rel);
			if (!g.ok) throw new Error(g.reason);
			// g.path is inside the target (checked above), so its folder is the target or a section folder under it
			mkdirSync(dirname(g.path), { recursive: true });
			copyFileSync(it.file, g.path, constants.COPYFILE_EXCL);
			const [a, b] = await Promise.all([sha256(it.file), sha256(g.path)]);
			if (a !== b) throw new Error(`Kopija atšķiras no oriģināla: ${rel}`);
			copied.push(rel);
		}
	} catch (e) {
		store.log({ kind: "delivery.copy.failed", by, data: { id: deliveryId, target: t.path, copied: copied.length, of: d.items.length } });
		throw new Error(`${(e as Error).message} — nokopēti ${copied.length} no ${d.items.length} failiem uz ${t.path}; tie paliek tur, pārbaudi un izdzēs pats, ja vajag.`);
	}
	const rel = relative(store.project.root, t.path);
	store.update("deliveries", (all) => all.map((x) => (x.id === deliveryId ? { ...x, draft: { ...x.draft!, copiedTo: rel } } : x)), { kind: "delivery.copied", by, data: { id: deliveryId, target: rel, files: copied.length } });
	return { target: t.path, files: copied.length };
}
