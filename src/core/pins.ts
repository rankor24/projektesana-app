// Pins: the user's notes on a page or a model element, worked as tasks. open → resolved (the agent says what it changed)
// → closed (the user only). A pin can be tied to a finding or a requirement.
import { newId, type Pin, type PinCamera, type PinTarget, type Who } from "./model.js";
import type { ProjectStore } from "./store.js";

const vec3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));

/** A camera is two points and a field of view; anything else would send the viewer somewhere meaningless. */
export function validCamera(c: unknown): c is PinCamera {
	const x = c as PinCamera;
	return !!x && vec3(x.position) && vec3(x.target) && typeof x.fov === "number" && x.fov >= 10 && x.fov <= 120;
}

export function addPin(store: ProjectStore, target: PinTarget, text: string, by: Who, links: { findingId?: string; requirementId?: string } = {}): Pin {
	if (!text.trim()) throw new Error("Tukša piezīme.");
	const valid = "elementGuid" in target ? !!target.elementGuid && (target.camera === undefined || validCamera(target.camera)) : Number.isFinite(target.x) && Number.isFinite(target.y) && target.x >= 0 && target.x <= 1 && target.y >= 0 && target.y <= 1;
	if (!valid) throw new Error("Nederīga piezīmes vieta.");
	const pin: Pin = { id: newId("p"), target, text: text.trim(), comments: [], by, at: new Date().toISOString(), state: "open", findingId: links.findingId ?? null, requirementId: links.requirementId ?? null };
	store.update("pins", (all) => [...all, pin], { kind: "pin.added", by, data: { id: pin.id } });
	return pin;
}

export function commentPin(store: ProjectStore, pinId: string, text: string, by: Who): void {
	if (!text.trim()) throw new Error("Tukšs komentārs.");
	store.update("pins", (all) => mustHave(all, pinId).map((p) => (p.id === pinId ? { ...p, comments: [...p.comments, { by, at: new Date().toISOString(), text: text.trim() }] } : p)), { kind: "pin.commented", by, data: { id: pinId } });
}

/** The agent marks a pin done with what it changed; it stays for the user to close or reopen. */
export function resolvePin(store: ProjectStore, pinId: string, note: string): void {
	if (note.trim().length < 3) throw new Error("Norādi, ko izmainīji.");
	store.update(
		"pins",
		(all) => mustHave(all, pinId).map((p) => (p.id === pinId ? { ...p, state: p.state === "closed" ? p.state : ("resolved" as const), comments: [...p.comments, { by: "agent" as const, at: new Date().toISOString(), text: note.trim() }] } : p)),
		{ kind: "pin.resolved", by: "agent", data: { id: pinId } },
	);
}

export function closePin(store: ProjectStore, pinId: string, by: Who): void {
	if (by !== "user") throw new Error("Piezīmi aizver tikai lietotājs, ne aģents.");
	store.update("pins", (all) => mustHave(all, pinId).map((p) => (p.id === pinId ? { ...p, state: "closed" as const } : p)), { kind: "pin.closed", by, data: { id: pinId } });
}

export function reopenPin(store: ProjectStore, pinId: string): void {
	store.update("pins", (all) => mustHave(all, pinId).map((p) => (p.id === pinId ? { ...p, state: "open" as const } : p)), { kind: "pin.reopened", by: "user", data: { id: pinId } });
}

function mustHave(all: Pin[], id: string): Pin[] {
	if (!all.some((p) => p.id === id)) throw new Error(`Piezīme ${id} nav atrasta.`);
	return all;
}

/** Open pins first (oldest first: they wait longest), then resolved ones waiting for the user. Closed pins are not tasks. */
export function pinsAsTasks(pins: Pin[]): Pin[] {
	const rank = (p: Pin) => (p.state === "open" ? 0 : p.state === "resolved" ? 1 : 2);
	return pins.filter((p) => p.state !== "closed").sort((a, b) => rank(a) - rank(b) || a.at.localeCompare(b.at));
}
