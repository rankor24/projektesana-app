// Pins and approvals (spec §6). Pins live in .bv/pins.json; every change is also a log line.
// The agent can mark a pin `addressed`; only Boris can `close` it or set a page to `approved`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendLog } from "./log.js";

export type PinTarget =
	| {
			kind: "pdf";
			/** sheet or view file inside the revision */
			sheet: string;
			page: number;
			/** normalised position on the page, 0..1 from top-left */
			x: number;
			y: number;
			viewId: number | null;
	  }
	| { kind: "ifc"; guid: string };

export type PinState = "open" | "addressed" | "closed";

export interface Pin {
	id: string;
	revision: string;
	target: PinTarget;
	text: string;
	state: PinState;
	createdAt: string;
	agentNote?: string;
}

const pinsFile = (root: string) => join(root, ".bv", "pins.json");

export function loadPins(root: string): Pin[] {
	const p = pinsFile(root);
	return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Pin[]) : [];
}

const save = (root: string, pins: Pin[]) => writeFileSync(pinsFile(root), JSON.stringify(pins, null, 1), "utf8");

export function addPin(root: string, revision: string, target: PinTarget, text: string, now = new Date()): Pin {
	if (!text.trim()) throw new Error("Piezīme ir tukša.");
	if (target.kind === "pdf" && (target.x < 0 || target.x > 1 || target.y < 0 || target.y > 1)) throw new Error("Pin pozīcija ārpus lapas (0..1).");
	const pins = loadPins(root);
	const pin: Pin = { id: `pin${pins.length + 1}`, revision, target, text: text.trim(), state: "open", createdAt: now.toISOString() };
	save(root, [...pins, pin]);
	appendLog(root, { kind: "pin.added", by: "boris", data: { id: pin.id, revision, target, text: pin.text } }, now);
	return pin;
}

export const openPins = (root: string): Pin[] => loadPins(root).filter((p) => p.state === "open");

/** Agent side: marks a pin addressed. It stays visible until Boris closes it. */
export function addressPin(root: string, id: string, note: string, by: string): Pin {
	const pins = loadPins(root);
	const p = pins.find((x) => x.id === id);
	if (!p) throw new Error(`Nav pin ${id}`);
	if (p.state === "closed") throw new Error(`Pin ${id} jau ir aizvērts.`);
	p.state = "addressed";
	p.agentNote = note;
	save(root, pins);
	appendLog(root, { kind: "pin.addressed", by, data: { id, note } });
	return p;
}

/** Boris side. */
export function closePin(root: string, id: string): Pin {
	const pins = loadPins(root);
	const p = pins.find((x) => x.id === id);
	if (!p) throw new Error(`Nav pin ${id}`);
	p.state = "closed";
	save(root, pins);
	appendLog(root, { kind: "pin.closed", by: "boris", data: { id } });
	return p;
}

/** Boris reopens a pin whose fix he does not accept. */
export function reopenPin(root: string, id: string): Pin {
	const pins = loadPins(root);
	const p = pins.find((x) => x.id === id);
	if (!p) throw new Error(`Nav pin ${id}`);
	p.state = "open";
	save(root, pins);
	appendLog(root, { kind: "pin.reopened", by: "boris", data: { id } });
	return p;
}

// ---- pin → model coordinates -------------------------------------------------

/** What Revit reports for a view at export time. Lengths in millimetres. */
export interface ViewGeometry {
	viewId: number;
	viewName: string;
	levelName: string | null;
	/** level elevation, mm */
	elevationMm: number | null;
	scale: number;
	/** crop box in view-local coordinates, mm */
	cropMin: [number, number];
	cropMax: [number, number];
	/** view-local → model transform */
	origin: [number, number, number];
	right: [number, number, number];
	up: [number, number, number];
	/** where the cropped view sits on the exported PDF page, normalised 0..1 from top-left */
	pageRect: { x0: number; y0: number; x1: number; y1: number };
}

export function pinToModel(pin: Pin, g: ViewGeometry): { x: number; y: number; z: number; levelName: string | null } {
	if (pin.target.kind !== "pdf") throw new Error("Tikai PDF pins pārvērš modeļa koordinātēs.");
	const { x, y } = pin.target;
	const r = g.pageRect;
	if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) throw new Error("Pin ir ārpus skata laukuma uz lapas.");
	const u = (x - r.x0) / (r.x1 - r.x0);
	const v = (y - r.y0) / (r.y1 - r.y0);
	const lx = g.cropMin[0] + u * (g.cropMax[0] - g.cropMin[0]);
	const ly = g.cropMax[1] - v * (g.cropMax[1] - g.cropMin[1]);
	const P = [0, 1, 2].map((k) => g.origin[k] + g.right[k] * lx + g.up[k] * ly);
	return { x: Math.round(P[0] * 10) / 10, y: Math.round(P[1] * 10) / 10, z: Math.round(P[2] * 10) / 10, levelName: g.levelName };
}

// ---- review state (approval is per page and per model) ----------------------

export type ReviewState = "new" | "commented" | "approved";

export interface ReviewItem {
	/** e.g. "A-101.pdf" or "model.ifc" */
	item: string;
	kind: "page" | "model";
	state: ReviewState;
}

const reviewFile = (root: string, revision: string) => join(root, ".bv", "revisions", revision, "review.json");

export function loadReview(root: string, revision: string): ReviewItem[] {
	const p = reviewFile(root, revision);
	return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as ReviewItem[]) : [];
}

export function initReview(root: string, revision: string, items: { item: string; kind: "page" | "model" }[]): ReviewItem[] {
	const r = items.map((i) => ({ ...i, state: "new" as ReviewState }));
	mkdirSync(join(root, ".bv", "revisions", revision), { recursive: true });
	writeFileSync(reviewFile(root, revision), JSON.stringify(r, null, 1), "utf8");
	return r;
}

/** Only called from the app's own IPC handler for Boris's click; no agent tool reaches it. */
export function setReviewState(root: string, revision: string, item: string, state: ReviewState): ReviewItem[] {
	const r = loadReview(root, revision);
	const it = r.find((x) => x.item === item);
	if (!it) throw new Error(`Nav ${item} revīzijā ${revision}`);
	it.state = state;
	writeFileSync(reviewFile(root, revision), JSON.stringify(r, null, 1), "utf8");
	appendLog(root, { kind: state === "approved" ? "page.approved" : "page.state", by: "boris", data: { revision, item, state } });
	return r;
}

export const revisionComplete = (r: ReviewItem[]): boolean => r.length > 0 && r.every((x) => x.state === "approved");
