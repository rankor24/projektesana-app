// 9.11 pop out: the layout model's pop-out state (a window leaves its group, remembers where it was, docks back on close), main's
// window list (one OS window per layout window, a close reported once, closed by the user or by popIn), the layout file shared
// through main (every window told, the sender ignoring its own), what a popped window relays to the main window, and a layout read
// after a restart docks every popped window back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { layoutHandlers } from "../src/main/handlers/layout.ts";
import { PopoutManager, type PopHandle } from "../src/main/windows.ts";
import type { EventName, EventSpec } from "../src/shared/api.ts";
import * as L from "../src/shared/layout.ts";
import { checkRelay, popIdOf, popTitle } from "../src/shared/popout.ts";
import { EVENT_NAMES } from "../src/shared/api.ts";
import { tmp } from "./helpers.ts";

const VP = { w: 1600, h: 900 };

/** A fake OS window: records what it was told, closes like a BrowserWindow (the "closed" callback follows close()). */
function fake() {
	const made: { id: string; sent: [string, unknown][]; focused: number; closeCb: (() => void) | null; handle: PopHandle }[] = [];
	const factory = (id: string): PopHandle => {
		const rec = { id, sent: [] as [string, unknown][], focused: 0, closeCb: null as (() => void) | null } as (typeof made)[number];
		rec.handle = { focus: () => void rec.focused++, close: () => rec.closeCb?.(), send: (c, p) => void rec.sent.push([c, p]), onClosed: (cb) => (rec.closeCb = cb) };
		made.push(rec);
		return rec.handle;
	};
	return { made, factory };
}

test("the layout model: a popped window leaves its group, remembers its place, and docks back into that side's group or floats where it was", () => {
	let l = L.open(L.open(L.open(L.emptyLayout(), "avoti", VP), "faili", VP), "grafiks", VP);
	l = L.dock(l, "avoti", "right", VP);
	l = L.dock(l, "faili", "right", VP);
	l = L.popOut(l, "faili", VP);
	assert.deepEqual(L.poppedOut(l), ["faili"]);
	assert.deepEqual(L.dockGroup(l, "right")!.tabs, ["avoti"], "it left the group");
	assert.deepEqual(L.groupOf(l, "faili")!.place, { kind: "pop", from: { kind: "dock", side: "right", size: L.DEFAULT_DOCK, collapsed: false } });
	l = L.popIn(l, "faili", VP);
	assert.deepEqual(L.dockGroup(l, "right")!.tabs, ["avoti", "faili"], "docked back into the same side's group");
	assert.deepEqual(L.problems(l), []);
	// a floating window comes back where it was, even if its place was changed meanwhile
	l = L.move(l, "grafiks", 400, 250, VP);
	l = L.popOut(l, "grafiks", VP);
	l = L.popIn(l, "grafiks", VP);
	const p = L.groupOf(l, "grafiks")!.place as L.FloatPlace;
	assert.deepEqual([p.kind, p.x, p.y], ["float", 400, 250]);
	// the side was emptied while it was out: the group is made again with the size it had
	l = L.dock(L.open(l, "telpas", VP), "telpas", "bottom", VP, { size: 333 });
	l = L.popOut(l, "telpas", VP);
	assert.equal(L.dockGroup(l, "bottom"), undefined);
	l = L.popIn(l, "telpas", VP);
	assert.equal((L.dockGroup(l, "bottom")!.place as L.DockPlace).size, 333);
	// the chat may be popped out and always comes back
	l = L.popIn(L.popOut(l, "chat", VP), "chat", VP);
	assert.equal(L.groupOf(l, "chat")!.place.kind, "dock");
	assert.deepEqual(L.problems(l), []);
	// popping twice or docking what is not popped does nothing
	assert.equal(L.popIn(l, "avoti", VP), l);
	const once = L.popOut(l, "avoti", VP);
	assert.equal(L.popOut(once, "avoti", VP), once);
});

test("a layout read after a restart docks every popped window back (the OS windows are gone)", () => {
	let l = L.dock(L.open(L.emptyLayout(), "avoti", VP), "avoti", "right", VP);
	l = L.popOut(L.popOut(l, "avoti", VP), "chat", VP);
	assert.deepEqual(L.poppedOut(l).sort(), ["avoti", "chat"]);
	const back = L.popInAll(l, VP);
	assert.deepEqual(L.poppedOut(back), []);
	assert.deepEqual(L.dockGroup(back, "right")!.tabs, ["avoti"]);
	assert.equal(L.groupOf(back, "chat")!.place.kind, "dock");
	assert.deepEqual(L.problems(back), []);
	const s = L.parseStore(JSON.stringify(L.withPage(L.emptyStore(), "x", l)), VP);
	assert.deepEqual(L.poppedOut(L.popInAll(s.pages.x, VP)), [], "also after a trip through the file");
});

test("main's window list: one OS window per layout window, a second pop-out brings it to the front, an unknown window is refused", () => {
	const f = fake();
	const closed: string[] = [];
	const m = new PopoutManager(f.factory, (id) => closed.push(id));
	assert.equal(m.popOut("viewer.comments"), "opened");
	assert.equal(m.popOut("viewer.comments"), "focused");
	assert.equal(f.made.length, 1, "no second window");
	assert.equal(f.made[0].focused, 1);
	assert.equal(m.popOut("avoti"), "opened");
	assert.deepEqual(m.list(), ["viewer.comments", "avoti"]);
	assert.equal(m.has("avoti"), true);
	assert.throws(() => m.popOut("nezinams"), /Nezināms logs/);
	assert.equal(f.made.length, 2);
	assert.deepEqual(closed, []);
});

test("closing: by the user or by popIn, the close is reported once and the window is forgotten; popIn of what is not out does nothing", () => {
	const f = fake();
	const closed: string[] = [];
	const m = new PopoutManager(f.factory, (id) => closed.push(id));
	m.popOut("avoti");
	m.popOut("faili");
	f.made[0].closeCb?.(); // the user closes the avoti window
	assert.deepEqual(closed, ["avoti"]);
	assert.equal(m.has("avoti"), false);
	f.made[0].closeCb?.(); // the same event twice
	assert.deepEqual(closed, ["avoti"], "reported once");
	assert.equal(m.popIn("faili"), true, "docked back from the main window");
	assert.deepEqual(closed, ["avoti", "faili"]);
	assert.equal(m.popIn("faili"), false);
	assert.equal(m.popIn("telpas"), false);
	// it can be popped out again after it was closed
	assert.equal(m.popOut("avoti"), "opened");
	assert.equal(f.made.length, 3);
	m.popOut("grafiks");
	m.closeAll();
	assert.deepEqual(m.list(), []);
	assert.deepEqual(closed.slice(-2).sort(), ["avoti", "grafiks"]);
});

test("events reach every pop-out window", () => {
	const f = fake();
	const m = new PopoutManager(f.factory);
	m.popOut("avoti");
	m.popOut("faili");
	m.broadcast("ev:data.changed", { projectId: "BD1", what: ["x"] });
	assert.deepEqual(f.made.map((r) => r.sent), [[["ev:data.changed", { projectId: "BD1", what: ["x"] }]], [["ev:data.changed", { projectId: "BD1", what: ["x"] }]]]);
	m.popIn("avoti");
	m.broadcast("ev:activity", 1);
	assert.equal(f.made[0].sent.length, 1, "a closed window is not written to");
	assert.equal(f.made[1].sent.length, 2);
});

test("the layout file is shared through main: a save is written whole and every window is told, with the sender named; a pop-out round trip", () => {
	const dir = tmp();
	const f = fake();
	const events: [string, unknown][] = [];
	const emit = <E extends EventName>(e: E, p: EventSpec[E]) => void events.push([e, p]);
	const popouts = new PopoutManager(f.factory, (id) => emit("layout.popped", { id }));
	const h = layoutHandlers({ settings: { dir }, emit, popouts });
	// the main window pops Prasības out and saves its layout
	let l = L.dock(L.open(L.emptyLayout(), "prasibas", VP), "prasibas", "right", VP);
	l = L.popOut(l, "prasibas", VP);
	h["layout.popOut"]("prasibas");
	assert.deepEqual(popouts.list(), ["prasibas"]);
	h["layout.set"](L.withPage(L.emptyStore(), "avoti", l), "main-1");
	const saved = JSON.parse(readFileSync(join(dir, "layout.json"), "utf8"));
	assert.equal(saved.version, 1);
	const told = events.find(([e]) => e === "layout.changed")![1] as EventSpec["layout.changed"];
	assert.equal(told.origin, "main-1", "the sender is named, so it ignores its own");
	assert.deepEqual(L.poppedOut(told.store.pages.avoti), ["prasibas"]);
	assert.deepEqual((h["layout.get"]() as L.LayoutStore).pages.avoti, told.store.pages.avoti);
	// the user closes the pop-out: main reports it, the main window docks the window back and saves
	f.made[0].closeCb?.();
	assert.deepEqual(events.at(-1), ["layout.popped", { id: "prasibas" }]);
	const back = L.popIn(l, "prasibas", VP);
	h["layout.set"](L.withPage(L.emptyStore(), "avoti", back), "main-1");
	assert.deepEqual(L.dockGroup((h["layout.get"]() as L.LayoutStore).pages.avoti, "right")!.tabs, ["prasibas"], "it is where it was");
	// the main window docks one back itself: the OS window closes
	h["layout.popOut"]("faili");
	h["layout.popIn"]("faili");
	assert.deepEqual(popouts.list(), []);
	// a save with no origin still tells the others
	h["layout.set"](L.emptyStore());
	assert.equal((events.at(-1)![1] as EventSpec["layout.changed"]).origin, "");
	assert.throws(() => h["layout.popOut"]("nezinams"), /Nezināms logs/);
	// without a window manager (a test build) it says so
	assert.throws(() => layoutHandlers({ settings: { dir } })["layout.popOut"]("avoti"), /nevar iznest/);
});

test("the new events are in the contract; the layout shares one store, so a damaged save is repaired before anyone adopts it", () => {
	for (const e of ["layout.changed", "layout.popped", "layout.relay"]) assert.ok((EVENT_NAMES as readonly string[]).includes(e), e);
	const dir = tmp();
	const events: [string, unknown][] = [];
	const h = layoutHandlers({ settings: { dir }, emit: (e, p) => void events.push([e, p]) });
	h["layout.set"]({ version: 1, pages: { x: { groups: [{ tabs: ["avoti", "avoti"], active: "nezinams", place: { kind: "float", x: 0, y: 0, w: 10, h: 10, z: 1 } }], focused: "gone", filters: {} } } } as never, "w");
	const told = events[0][1] as EventSpec["layout.changed"];
	assert.deepEqual(L.problems(told.store.pages.x), [], "what the others adopt is already repaired");
	assert.ok(L.groupOf(told.store.pages.x, "chat"));
});

test("what a popped window asks of the main window: open a file, go to a page, a message for the 3D view; anything else is refused", () => {
	assert.equal(checkRelay({ t: "show", target: { kind: "source", sourceId: "s1", page: 3 } }), null);
	assert.equal(checkRelay({ t: "show", target: null }), null);
	assert.match(checkRelay({ t: "show", target: "x" }) ?? "", /a target or null/);
	assert.equal(checkRelay({ t: "go", name: "koordinacija" }), null);
	assert.equal(checkRelay({ t: "go", name: "prasibas", filter: "findings" }), null);
	assert.match(checkRelay({ t: "go", name: "" }) ?? "", /a page name/);
	assert.match(checkRelay({ t: "go", name: "a", filter: 3 }) ?? "", /filter is text/);
	assert.equal(checkRelay({ t: "bimcraft", cmd: { pj: 1, type: "fly", guid: "g" } }), null);
	assert.match(checkRelay({ t: "bimcraft", cmd: { type: "fly" } }) ?? "", /a bridge message/);
	assert.match(checkRelay({ t: "rm -rf" }) ?? "", /unknown kind/);
	assert.match(checkRelay(null) ?? "", /not a message/);
	const h = layoutHandlers({ settings: { dir: tmp() }, emit: () => undefined });
	assert.throws(() => h["layout.relay"]({ t: "go", name: "" }), /a page name/);
	assert.doesNotThrow(() => h["layout.relay"]({ t: "go", name: "avoti" }));
});

test("the pop-out window knows which layout window it shows from its URL; an unknown one is the main window", () => {
	assert.equal(popIdOf("?pop=viewer.comments"), "viewer.comments");
	assert.equal(popIdOf("?pop=chat"), "chat");
	assert.equal(popIdOf("?pop=nezinams"), null);
	assert.equal(popIdOf(""), null);
	assert.equal(popIdOf("?x=1"), null);
	assert.equal(popTitle("Komentāri / BCF"), "Komentāri / BCF — Projektēšanas App");
});
