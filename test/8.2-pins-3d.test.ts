// 8.2 pins on model elements: a pin carries its model, camera and BCF viewpoint; the agent prompt names where a pin sits;
// numbering is by creation time and never moves; a pin is a BCF topic that BimCraft's own reader gives back with its camera.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pinsText } from "../src/agent/tools/pins.ts";
import { pinTopic, pinsToBcf } from "../src/checks/bcf.ts";
import { addPin, commentPin, resolvePin, validCamera } from "../src/core/pins.ts";
import type { Pin, PinCamera, PinViewpoint } from "../src/core/model.ts";
import { ProjectStore } from "../src/core/store.ts";
import { listOrder, numbered } from "../src/shared/pins-view.ts";
import { BIMCRAFT_DIR, BIMCRAFT_TRIED, tmp } from "./helpers.ts";

const CAMERA: PinCamera = { position: [3, 2, 5], target: [0, 1, 0], fov: 50 };
const VIEWPOINT: PinViewpoint = { kind: "perspective", viewPoint: [3, -5, 2], direction: [-0.5, 0.8, -0.2], up: [0, 0, 1], fov: 50 };
const store = () => ProjectStore.open(tmp(), { id: "BD900", name: "BD900", root: tmp(), createdAt: "2026-11-13T00:00:00Z" });
const GUID = "0Wall0000000000000001";

test("a camera is two points and a sensible field of view", () => {
	assert.equal(validCamera(CAMERA), true);
	for (const bad of [null, {}, { ...CAMERA, fov: 5 }, { ...CAMERA, fov: 170 }, { ...CAMERA, position: [1, 2] }, { ...CAMERA, target: [1, NaN, 3] }, { position: CAMERA.position, target: CAMERA.target }])
		assert.equal(validCamera(bad), false, JSON.stringify(bad));
});

test("an element pin keeps model, camera and viewpoint; a bad camera is refused; the page pin is unchanged", () => {
	const s = store();
	const p = addPin(s, { elementGuid: GUID, model: "BD900_AR.ifc", camera: CAMERA, viewpoint: VIEWPOINT }, " pārbaudīt sienas biezumu ", "user");
	assert.equal(p.text, "pārbaudīt sienas biezumu");
	assert.deepEqual(s.read("pins")[0].target, { elementGuid: GUID, model: "BD900_AR.ifc", camera: CAMERA, viewpoint: VIEWPOINT });
	assert.throws(() => addPin(s, { elementGuid: GUID, camera: { ...CAMERA, fov: 500 } }, "x y z", "user"), /Nederīga piezīmes vieta/);
	assert.throws(() => addPin(s, { elementGuid: "" }, "x y z", "user"), /Nederīga piezīmes vieta/);
	assert.doesNotThrow(() => addPin(s, { sourceId: "s1", page: 2, x: 0.4, y: 0.6 }, "lapas piezīme", "user"));
	assert.doesNotThrow(() => addPin(s, { elementGuid: GUID }, "no skata (aģents)", "agent"), "a pin with no camera is fine: the element is framed instead");
});

test("the agent's prompt says which model an element pin is in", () => {
	const s = store();
	addPin(s, { elementGuid: GUID, model: "BD900_AR.ifc", camera: CAMERA }, "siena par plānu", "user");
	addPin(s, { elementGuid: "0Door000000000000001" }, "durvis bez modeļa nosaukuma", "agent");
	const text = pinsText(s.read("pins"));
	assert.match(text, new RegExp(`elements ${GUID} modelī BD900_AR\\.ifc`));
	assert.match(text, /elements 0Door000000000000001\)/);
});

test("numbers follow creation time and survive state changes; the list puts open first, closed last", () => {
	const at = (n: number) => `2026-11-13T10:00:0${n}.000Z`;
	const mk = (id: string, n: number, state: Pin["state"]): Pin => ({ id, target: { elementGuid: id }, text: id, comments: [], by: "user", at: at(n), state, findingId: null, requirementId: null });
	const pins = [mk("c", 3, "open"), mk("a", 1, "closed"), mk("b", 2, "resolved"), mk("d", 4, "open")];
	const items = numbered(pins);
	assert.deepEqual(items.map((x) => [x.pin.id, x.n]), [["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
	assert.deepEqual(listOrder(items).map((x) => x.pin.id), ["c", "d", "b", "a"], "open (oldest first), resolved, closed");
	// closing c does not renumber anything
	const after = numbered(pins.map((p) => (p.id === "c" ? { ...p, state: "closed" as const } : p)));
	assert.deepEqual(after.map((x) => x.n), [1, 2, 3, 4]);
});

test("a pin is a BCF topic: status, comments, selection and the camera in IFC space; the same pin is the same topic", () => {
	const s = store();
	const p = addPin(s, { elementGuid: GUID, model: "BD900_AR.ifc", camera: CAMERA, viewpoint: VIEWPOINT }, "siena par plānu", "user");
	commentPin(s, p.id, "kāds ir vajadzīgais biezums?", "user");
	resolvePin(s, p.id, "izmainīju uz 300 mm");
	const pin = s.read("pins")[0];
	const t = pinTopic(pin);
	assert.equal(t.title, "siena par plānu");
	assert.equal(t.status, "Resolved");
	assert.equal(t.comments.length, 2);
	assert.equal(t.comments[1].author, "Aģents");
	assert.deepEqual(t.viewpoints[0].selection, [GUID]);
	assert.deepEqual(t.viewpoints[0].camera, VIEWPOINT);
	assert.equal(pinTopic(pin).guid, t.guid, "stable across exports");
	assert.equal(pinTopic({ ...pin, state: "closed" }).status, "Closed");
	assert.match(t.description, /Modelis: BD900_AR\.ifc/);
	// a page pin has no place in a model
	assert.deepEqual(pinTopic({ ...pin, target: { sourceId: "s1", page: 1, x: 0.5, y: 0.5 } }).viewpoints, []);
});

const APP = join(BIMCRAFT_DIR ?? "", "app");
test("BimCraft's own reader gives the pins back: titles, comments, selection and camera", { skip: existsSync(join(APP, "bcf.js")) ? false : `BimCraft not found in: ${BIMCRAFT_TRIED.join(" | ")}` }, async () => {
	const s = store();
	addPin(s, { elementGuid: GUID, model: "BD900_AR.ifc", camera: CAMERA, viewpoint: VIEWPOINT }, "siena par plānu", "user");
	addPin(s, { sourceId: "s1", page: 1, x: 0.5, y: 0.5 }, "lapas piezīme, nav BCF", "user");
	const bytes = await pinsToBcf(APP, s.read("pins"), { name: "BD900_AR.ifc" });
	const bcf = await import(new URL(`file:///${join(APP, "bcf.js").replace(/\\/g, "/")}`).href);
	const back = await bcf.readBcf(bytes);
	assert.equal(back.topics.length, 1, "only the element pin");
	const t = back.topics[0];
	assert.equal(t.title, "siena par plānu");
	assert.equal(t.status, "Open");
	assert.deepEqual(t.viewpoints[0].selection, [GUID]);
	const c = t.viewpoints[0].camera;
	assert.equal(c.kind, "perspective");
	assert.deepEqual(c.viewPoint, VIEWPOINT.viewPoint);
	assert.equal(c.fov, 50);
});
