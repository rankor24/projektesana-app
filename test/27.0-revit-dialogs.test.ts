// 27.0 Revit popup windows (docs/revit-dialogs-plan.md): what may be answered, the watcher, the computer-use helper's tools. Invented popups only; the screen is a fake.
// Not covered here (needs a live Revit on the PC): the add-in's own handler, resources/revit-screen.ps1, and a real click.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { dialogTools, describe, runDialogAgent, type DialogAgentDeps } from "../src/agent/dialog-agent.ts";
import { DialogWatch } from "../src/agent/dialog-watch.ts";
import { appendDialogLog, assess, buttonAt, buttonKind, chatLine, decide, dialogLogFile, pathsIn, type DialogLogLine, type DialogWindow, type PolicyContext } from "../src/revit/dialog-policy.ts";
import { normalizePopup } from "../src/revit/screen.ts";
import { tmp } from "./helpers.ts";

const WORK = "C:\\Data\\agent-work\\proj1\\House_WORK.rvt";
const ctx: PolicyContext = { own: (p) => p.toLowerCase().startsWith("c:\\data\\") };

function popup(over: Partial<DialogWindow> & { buttons?: string[] } = {}): DialogWindow {
	const names = over.buttons ?? ["OK"];
	return {
		hwnd: 100,
		pid: 7,
		title: "Revit",
		className: "#32770",
		rect: { left: 400, top: 300, right: 800, bottom: 500 },
		text: "Highlighted elements overlap.",
		checkboxes: [],
		edits: 0,
		...over,
		buttons: names.map((name, i) => ({ name, id: String(i), rect: { left: 420 + i * 100, top: 450, right: 500 + i * 100, bottom: 480 } })),
	};
}
const centreOf = (d: DialogWindow, i: number) => ({ x: (d.buttons[i].rect!.left + d.buttons[i].rect!.right) / 2, y: (d.buttons[i].rect!.top + d.buttons[i].rect!.bottom) / 2 });

test("button kinds, in English and Latvian; «Don't save» is destructive, not a save", () => {
	const k = (n: string) => buttonKind(n);
	assert.deepEqual([k("&Cancel"), k("Atcelt"), k("Close"), k("Aizvērt"), k("OK"), k("Labi"), k("No"), k("Nē"), k("Yes"), k("Jā")], ["cancel", "cancel", "close", "close", "ok", "ok", "no", "no", "yes", "yes"]);
	assert.deepEqual([k("Retry"), k("Try again"), k("Ignore"), k("Continue"), k("Turpināt")], ["retry", "retry", "ignore", "continue", "continue"]);
	assert.deepEqual([k("Delete elements"), k("Dzēst"), k("Overwrite"), k("Replace"), k("Don't save"), k("Nesaglabāt"), k("Synchronize now"), k("Detach")], Array(8).fill("destructive"));
	assert.deepEqual([k("Save"), k("Saglabāt"), k("Save as...")], ["save", "save", "save"]);
	assert.equal(k("Show me more"), "unknown");
});

test("a plain popup: OK, Close and Cancel may be answered, Save and unknown buttons not", () => {
	const d = popup({ buttons: ["OK", "Cancel", "Save", "Show more"] });
	const a = assess(d, ctx);
	assert.equal(a.person, false);
	assert.ok(a.allowed.includes("ok") && a.allowed.includes("cancel"));
	assert.equal(decide(d, { type: "press", name: "OK" }, ctx).ok, true);
	assert.equal(decide(d, { type: "press", name: "Save" }, ctx).ok, false);
	assert.equal(decide(d, { type: "press", name: "Show more" }, ctx).ok, false);
	assert.equal(decide(d, { type: "press", name: "Nothing" }, ctx).ok, false);
});

test("a popup that can lose data gets Cancel, Close or No, never OK or Delete (the user's rule)", () => {
	const d = popup({ title: "Delete elements", text: "This will delete 12 elements and cannot be undone.", buttons: ["OK", "Delete", "Cancel"] });
	const a = assess(d, ctx);
	assert.equal(a.dataLoss, true);
	assert.equal(decide(d, { type: "press", name: "Cancel" }, ctx).ok, true);
	assert.equal(decide(d, { type: "press", name: "OK" }, ctx).ok, false);
	assert.equal(decide(d, { type: "press", name: "Delete" }, ctx).ok, false);
	const lv = popup({ text: "Šī darbība dzēsīs elementus.", buttons: ["Labi", "Atcelt"] });
	assert.equal(decide(lv, { type: "press", name: "Labi" }, ctx).ok, false);
	assert.equal(decide(lv, { type: "press", name: "Atcelt" }, ctx).ok, true);
});

test("the word «close» in a text is not data loss", () => {
	const d = popup({ text: "Close the view and try again.", buttons: ["OK"] });
	assert.equal(assess(d, ctx).dataLoss, false);
	assert.equal(decide(d, { type: "press", name: "OK" }, ctx).ok, true);
});

test("a popup about a model file that is not ours, or about B:, is answered with Cancel or Close only", () => {
	const orig = popup({ text: "The file B:\\Projects\\Client\\Model.rvt is read-only.", buttons: ["OK", "Cancel"] });
	assert.deepEqual(pathsIn(orig), ["B:\\Projects\\Client\\Model.rvt"]);
	assert.equal(assess(orig, ctx).outside, true);
	assert.equal(decide(orig, { type: "press", name: "OK" }, ctx).ok, false);
	assert.equal(decide(orig, { type: "press", name: "Cancel" }, ctx).ok, true);
	const mine = popup({ text: `The link to ${WORK} was not found.`, buttons: ["OK"] });
	assert.equal(assess(mine, ctx).outside, false);
	assert.equal(decide(mine, { type: "press", name: "OK" }, ctx).ok, true);
	const net = popup({ text: "Cannot reach \\\\server\\share\\a.rvt", buttons: ["OK"] });
	assert.equal(decide(net, { type: "press", name: "OK" }, ctx).ok, false);
});

test("a save question allows only Cancel or Close; Yes and No would save or discard", () => {
	const d = popup({ title: "Close project", text: `Save changes to ${WORK}?`, buttons: ["Yes", "No", "Cancel"] });
	assert.equal(assess(d, ctx).saveQuestion, true);
	assert.equal(decide(d, { type: "press", name: "Yes" }, ctx).ok, false);
	assert.equal(decide(d, { type: "press", name: "No" }, ctx).ok, false);
	assert.equal(decide(d, { type: "press", name: "Cancel" }, ctx).ok, true);
});

test("sign-in, licence, crash and typing popups are the user's: nothing is clicked, not even Escape", () => {
	for (const d of [popup({ title: "Autodesk sign in", text: "Please sign in to continue.", buttons: ["OK", "Cancel"] }), popup({ title: "Revit", text: "Revit has encountered a problem and is not responding.", buttons: ["Close"] }), popup({ text: "Name the view", edits: 1, buttons: ["OK", "Cancel"] })]) {
		const as = assess(d, ctx);
		assert.equal(as.person, true);
		const r = decide(d, { type: "press", name: "Cancel" }, ctx);
		assert.equal(r.ok, false);
		assert.equal(!r.ok && r.person, true);
		assert.equal(decide(d, { type: "key", key: "Escape" }, ctx).ok, false);
	}
});

test("clicks: on a button yes, on the popup's blank part, a check box or outside it no; the title-bar × counts as Close; only Escape is a key", () => {
	const d = popup({ buttons: ["OK", "Cancel"], checkboxes: ["Do not show this again"] });
	const ok = centreOf(d, 0);
	assert.equal(buttonAt(d, ok.x, ok.y)?.name, "OK");
	assert.deepEqual(decide(d, { type: "click", ...ok }, ctx), { ok: true, button: "OK", kind: "ok" });
	assert.equal(decide(d, { type: "click", x: 600, y: 350 }, ctx).ok, false, "blank part");
	assert.equal(decide(d, { type: "click", x: 50, y: 50 }, ctx).ok, false, "outside the popup");
	const x = decide(d, { type: "click", x: d.rect.right - 20, y: d.rect.top + 12 }, ctx);
	assert.equal(x.ok && x.kind, "close");
	assert.equal(decide(d, { type: "key", key: "Escape" }, ctx).ok, true);
	assert.equal(decide(d, { type: "key", key: "Enter" }, ctx).ok, false);
	assert.equal(decide(d, { type: "key", key: "a" }, ctx).ok, false);
	// × on a data-losing popup is Close: allowed; on a person's popup: not
	assert.equal(decide(popup({ text: "This will delete elements.", buttons: ["OK"] }), { type: "click", x: 790, y: 310 }, ctx).ok, true);
});

test("the script's single-popup answer (an object, not a list) and missing parts read the same as a list", () => {
	const one = normalizePopup({ hwnd: 5, pid: 2, title: "T", rect: { left: 0, top: 0, right: 10, bottom: 10 }, buttons: { name: "OK", rect: null }, checkboxes: "Do not show" });
	assert.deepEqual(one.buttons, [{ name: "OK", id: null, rect: null }]);
	assert.deepEqual(one.checkboxes, ["Do not show"]);
	assert.equal(normalizePopup({ hwnd: 5, pid: 2, rect: { left: 0, top: 0, right: 10, bottom: 10 } }).buttons.length, 0);
});

test("the log: one JSON line per event in the app's folder, text cut; the chat line says what was done", () => {
	const dir = tmp("dlg-");
	const file = dialogLogFile(dir);
	const line: DialogLogLine = { at: "2026-11-26T10:00:00Z", source: "screen", action: "press", title: "Revit", text: "x".repeat(2000), button: "OK", kind: "ok", pid: 7 };
	appendDialogLog(file, line);
	appendDialogLog(file, { ...line, action: "gone" });
	assert.ok(existsSync(file));
	const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
	assert.equal(rows.length, 2);
	assert.equal(rows[0].text.length, 600);
	assert.match(chatLine(line), /nospiests «OK»/);
	assert.match(chatLine({ ...line, action: "person", reason: "pieteikšanās" }), /gaida tevi/);
	assert.match(chatLine({ ...line, action: "gone" }), /aizvērts/);
	// a log in a folder that cannot be written does not throw
	appendDialogLog(join(file, "no", "such"), line);
});

// ---- a fake screen -----------------------------------------------------------------------------------------------------------

function fakeScreen(initial: DialogWindow[]) {
	const s = {
		popupsNow: [...initial],
		actions: [] as string[],
		cursorAt: { x: 0, y: 0 },
		async popups() {
			return [...s.popupsNow];
		},
		async shot() {
			return { png: "AAAA", width: 1, height: 1 };
		},
		async cursor() {
			return s.cursorAt;
		},
		async click(_h: number, x: number, y: number) {
			s.actions.push(`click ${x},${y}`);
			s.cursorAt = { x, y };
			const d = s.popupsNow[0];
			const b = d && buttonAt(d, x, y);
			if (b) s.popupsNow = [];
		},
		async key() {
			s.actions.push("key Escape");
			s.popupsNow = [];
		},
		async press(_h: number, name: string) {
			s.actions.push(`press ${name}`);
			s.popupsNow = [];
		},
	};
	return s;
}

function toolsOf(screen: ReturnType<typeof fakeScreen>) {
	const logs: Omit<DialogLogLine, "at" | "source">[] = [];
	const state = { actions: 0, person: false, cleared: false, lastPoint: null as { x: number; y: number } | null };
	const deps: DialogAgentDeps = { screen, ctx, log: (l) => logs.push(l), run: async () => undefined, base: {} as never, signal: new AbortController().signal, seesImages: true, sleep: async () => undefined };
	const tools = Object.fromEntries(dialogTools(deps, state).map((t) => [t.name, t]));
	const call = async (name: string, args: object) => (await (tools[name] as any).execute("id", args)) as { content: { type: string; text?: string }[]; isError?: boolean };
	return { call, logs, state };
}

test("the helper's tools: look gives the text, the buttons and a picture; pressing Cancel clears the popup and is logged", async () => {
	const screen = fakeScreen([popup({ buttons: ["OK", "Cancel"] })]);
	const { call, logs, state } = toolsOf(screen);
	const look = await call("screen_look", {});
	assert.equal(look.content[0].type, "text");
	assert.match(look.content[0].text!, /«OK»/);
	assert.equal(look.content[1]?.type, "image");
	const r = await call("screen_press", { button: "Cancel" });
	assert.match(r.content[0].text!, /No popup of Revit is open now/);
	assert.deepEqual(screen.actions, ["press Cancel"]);
	assert.equal(state.cleared, true);
	assert.deepEqual(logs.map((l) => l.action), ["press", "gone"]);
});

test("the helper's tools: a refused answer does nothing on the screen and says why; a person's popup makes it call ask_user", async () => {
	const screen = fakeScreen([popup({ text: "This will delete 3 elements.", buttons: ["OK", "Cancel"] })]);
	const { call, logs, state } = toolsOf(screen);
	const bad = await call("screen_press", { button: "OK" });
	assert.equal(bad.isError, true);
	assert.match(bad.content[0].text!, /Refused by the program/);
	assert.deepEqual(screen.actions, []);
	assert.equal(logs[0].action, "refused");
	assert.equal(state.person, false);

	const lic = fakeScreen([popup({ title: "Autodesk sign in", text: "Please sign in.", buttons: ["OK", "Cancel"] })]);
	const t2 = toolsOf(lic);
	const r = await t2.call("screen_press", { button: "Cancel" });
	assert.match(r.content[0].text!, /ask_user/);
	assert.equal(t2.state.person, true);
	await t2.call("ask_user", { reason: "sign-in" });
	assert.deepEqual(t2.logs.map((l) => l.action), ["person", "person"]);
	assert.deepEqual(lic.actions, []);
});

test("the helper's tools: a click needs a button under it; a moved mouse (the user's hand) stops the next click", async () => {
	const d = popup({ buttons: ["OK", "Cancel"] });
	const screen = fakeScreen([d]);
	const { call, state } = toolsOf(screen);
	const miss = await call("screen_click", { x: 600, y: 350 });
	assert.equal(miss.isError, true);
	state.lastPoint = { x: 10, y: 10 };
	screen.cursorAt = { x: 900, y: 900 };
	const busy = await call("screen_click", { ...centreOf(d, 1) });
	assert.match(busy.content[0].text!, /moving the mouse/);
	assert.deepEqual(screen.actions, []);
	screen.cursorAt = { x: 10, y: 10 };
	await call("screen_click", { ...centreOf(d, 1) });
	assert.equal(screen.actions.length, 1);
});

test("Escape is the only key; with no buttons read it still works (the popup's own Cancel)", async () => {
	const screen = fakeScreen([popup({ buttons: [] })]);
	const { call } = toolsOf(screen);
	assert.equal((await call("screen_key", { key: "Enter" })).isError, true);
	await call("screen_key", { key: "Escape" });
	assert.deepEqual(screen.actions, ["key Escape"]);
});

test("describe names the allowed answers and flags the user's popups", () => {
	assert.match(describe([popup({ buttons: ["OK", "Cancel"] })], ctx), /Allowed answers: .*cancel/);
	assert.match(describe([popup({ text: "Please sign in", buttons: ["OK"] })], ctx), /the user's/);
	assert.equal(describe([], ctx), "No popup of Revit is open now.");
});

test("runDialogAgent: starts the run with the popup text, a picture, the six tools and the safety rules, and reports what the model said", async () => {
	const screen = fakeScreen([popup({ buttons: ["OK"] })]);
	let seen: any;
	const logs: Omit<DialogLogLine, "at" | "source">[] = [];
	const out = await runDialogAgent(
		{
			screen,
			ctx,
			log: (l) => logs.push(l),
			base: { provider: "x" } as never,
			signal: new AbortController().signal,
			seesImages: true,
			sleep: async () => undefined,
			run: async (o) => {
				seen = o;
				const press = o.extraTools!.find((t) => t.name === "screen_press")!;
				await (press as any).execute("1", { button: "OK" });
				o.onEvent({ type: "done", text: "Pressed OK; the popup is gone." } as never);
			},
		},
		screen.popupsNow,
	);
	assert.match(seen.prompt, /Highlighted elements overlap/);
	assert.equal(seen.images.length, 1);
	assert.deepEqual(seen.extraTools.map((t: any) => t.name).sort(), ["ask_user", "screen_click", "screen_key", "screen_look", "screen_press", "screen_wait"]);
	assert.match(seen.systemPrompt, /Never press Delete/);
	assert.deepEqual(seen.mcp, {});
	assert.deepEqual([out.cleared, out.person, out.actions, out.report], [true, false, 1, "Pressed OK; the popup is gone."]);
});

// ---- the watcher -------------------------------------------------------------------------------------------------------------

function watch(opts: { popups: () => DialogWindow[]; act?: boolean; active?: boolean; helpResult?: { cleared: boolean; person: boolean; report: string } }) {
	const logs: Omit<DialogLogLine, "at" | "source">[] = [];
	const helped: number[] = [];
	let t = 0;
	const w = new DialogWatch({
		screen: { popups: async () => opts.popups() },
		help: async (p) => {
			helped.push(p.length);
			return opts.helpResult ?? { cleared: false, person: false, report: "tried" };
		},
		log: (l) => logs.push(l),
		act: () => opts.act !== false,
		active: () => opts.active !== false,
		graceMs: 8000,
		maxTries: 2,
		now: () => t,
	});
	return { w, logs, helped, at: (ms: number) => (t = ms) };
}

test("watcher: a new popup is noted; it is left alone for the grace time (the add-in or the user may answer it); then the helper gets it once", async () => {
	const d = popup();
	const x = watch({ popups: () => [d] });
	x.at(0);
	await x.w.tick();
	assert.deepEqual(x.logs.map((l) => l.action), ["seen"]);
	x.at(5000);
	await x.w.tick();
	assert.deepEqual(x.helped, []);
	x.at(9000);
	await x.w.tick();
	assert.deepEqual(x.helped, [1]);
});

test("watcher: a popup the helper could not clear is tried twice, then said to the user once", async () => {
	const d = popup();
	const x = watch({ popups: () => [d] });
	for (const at of [0, 9000, 12000, 15000, 18000]) {
		x.at(at);
		await x.w.tick();
	}
	assert.deepEqual(x.helped, [1, 1]);
	assert.deepEqual(x.logs.map((l) => l.action), ["seen", "person"]);
});

test("watcher: a popup that closes by itself is not helped; a popup the helper left to the user is not told twice", async () => {
	let open = [popup()];
	const gone = watch({ popups: () => open });
	gone.at(0);
	await gone.w.tick();
	open = [];
	gone.at(9000);
	await gone.w.tick();
	assert.deepEqual(gone.helped, []);

	const person = watch({ popups: () => [popup()], helpResult: { cleared: false, person: true, report: "sign-in" } });
	for (const at of [0, 9000, 13000, 20000]) {
		person.at(at);
		await person.w.tick();
	}
	assert.deepEqual(person.helped, [1], "asked once; the helper's own ask_user already told the user");
});

test("watcher: the screen helper switched off only tells the user; no Revit call waiting means popups of the user's own are not touched", async () => {
	const off = watch({ popups: () => [popup()], act: false });
	off.at(0);
	await off.w.tick();
	off.at(9000);
	await off.w.tick();
	assert.deepEqual(off.helped, []);
	assert.deepEqual(off.logs.map((l) => l.action), ["seen", "person"]);

	const idle = watch({ popups: () => [popup()], active: false });
	idle.at(0);
	await idle.w.tick();
	idle.at(20000);
	await idle.w.tick();
	assert.deepEqual([idle.logs.length, idle.helped.length], [0, 0]);
});

test("watcher: a screen that cannot be read (locked, no script) is said once and the watch goes on", async () => {
	const logs: Omit<DialogLogLine, "at" | "source">[] = [];
	const w = new DialogWatch({
		screen: { popups: async () => Promise.reject(new Error("no desktop")) },
		help: async () => ({ cleared: true, person: false, report: "" }),
		log: (l) => logs.push(l),
		act: () => true,
	});
	await w.tick();
	await w.tick();
	assert.deepEqual(logs.map((l) => [l.action, l.reason]), [["failed", "no desktop"]]);
});
