// What the chat window knows about threads: the project's threads, the run table and queue, Gaida tevi, the agents, and the last step of each running thread.
// Everything is pushed by main (threads.changed, queue.changed, waiting.changed, agent.event); the first read only fills what has not been pushed yet.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normRef, type AgentSpec } from "../../shared/agent-types";
import { LEAD_ID, type IncidentView, type PauseTarget, type QueueView, type Thread, type ThreadState, type WaitingItem, type WaitReason } from "../../shared/thread-types";
import { EVERYONE_WORDS } from "../../shared/everyone";
import { BPV_ID } from "../../shared/departments";
import type { RunEvent } from "../../shared/types";
import { call, on } from "../bridge";
import { ui, useUi } from "../state";
import { tr } from "../i18n";

const NO_QUEUE: QueueView = { running: [], queued: [], why: {}, paused: false, waves: [], held: { agents: [], departments: [], all: false } };

/** "Vadošais" for the lead, the specialist's name, or the bare id of one that was removed in Iestatījumi. */
export function agentName(id: string, specs: readonly AgentSpec[]): string {
	return id === LEAD_ID ? tr("Vadošais aģents") : (specs.find((s) => s.id === id)?.name ?? id);
}

/** The specialists "@" at the start of the message offers: those whose id or name starts with what is typed so far. Empty once a space follows the word. */
export function mentionOptions(text: string, specs: readonly AgentSpec[]): AgentSpec[] {
	const m = /^\s*@(\S*)$/.exec(text);
	if (!m) return [];
	const q = normRef(m[1]);
	const own = specs.filter((s) => !q || normRef(s.id).startsWith(q) || normRef(s.name).startsWith(q));
	// "@visi": a line to everyone goes to BPV alone (shared/everyone.ts), so it is offered when BPV is there
	const everyone = specs.some((s) => s.id === BPV_ID) && (!q || EVERYONE_WORDS.some((w) => w.startsWith(q))) ? [{ id: "visi", name: tr("Visi — nonāk pie BPV"), description: tr("Rinda visiem nonāk pie BPV vienīgā: viņš izlemj, kam to nodot."), prompt: "", tools: [] } as AgentSpec] : [];
	return [...own, ...everyone];
}

/** Newest first, the order main lists them in. */
function upsert(ts: Thread[], t: Thread): Thread[] {
	const next = ts.some((x) => x.id === t.id) ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t];
	return next.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

/** The state a thread shows now: the run table is fresher than the thread file, which only says what it was last marked. */
export function liveState(t: Thread, q: QueueView): ThreadState {
	const run = q.running.find((r) => r.threadId === t.id);
	if (run) return run.waitingConfirm ? "waiting-confirm" : "running";
	if (q.queued.some((x) => x.threadId === t.id && x.state === "queued")) return "queued";
	return t.state;
}

/** One line for a lane: the tool the run is in, or that it is thinking. null = the run ended; undefined = the event says nothing new. */
function stepOf(e: RunEvent): string | null | undefined {
	switch (e.type) {
		case "tool":
			return e.name;
		case "thinking":
		case "turn":
			return tr("domā…");
		case "confirm":
			return tr("gaida apstiprinājumu");
		case "done":
		case "error":
			return null;
		default:
			return undefined;
	}
}

export interface LaneItem {
	threadId: string;
	agent: string;
	title: string;
	state: "running" | "queued" | "waiting-confirm";
	step: string | null;
	/** when the conversation was opened: two chats of one agent are told apart by it */
	at: string | null;
	/** why a queued item waits (null: running, or nothing holds it) */
	why: WaitReason | null;
}

/** `markSeen`: this is the window that shows the chat, so the thread on screen counts as read (threads.seen); the list window leaves it alone. */
export function useThreads(projectId: string | null, opts: { markSeen?: boolean } = {}) {
	const { tick, thread: selId } = useUi();
	const [threads, setThreads] = useState<Thread[]>([]);
	const [queue, setQueue] = useState<QueueView>(NO_QUEUE);
	const [waiting, setWaiting] = useState<WaitingItem[]>([]);
	const [specs, setSpecs] = useState<AgentSpec[]>([]);
	const [steps, setSteps] = useState<Record<string, string>>({});
	/** every confirmation id that has been in the list: one that was and is gone has been answered (ids carry their run, so they never repeat) */
	const seen = useRef(new Set<string>());
	const listed = useCallback((v: WaitingItem[]) => {
		for (const w of v) if (w.kind === "confirm") seen.current.add(w.id);
		setWaiting(v);
	}, []);
	/** the open project right now: an answer that comes back after a switch belongs to the project that was open when it was asked */
	const current = useRef(projectId);
	current.current = projectId;

	useEffect(() => {
		let live = true;
		setThreads([]);
		const off = on("threads.changed", ({ projectId: p, thread }) => {
			if (p === projectId) setThreads((ts) => upsert(ts, thread));
		});
		// a thread pushed while the list was being read is newer than the list
		call("threads.list", projectId)
			.then((list) => live && setThreads((pushed) => pushed.reduce(upsert, list)))
			.catch(() => undefined);
		return () => {
			live = false;
			off();
		};
	}, [projectId]);

	// push first, then read: what arrives before the read comes back is kept
	useEffect(() => {
		let pushed = false;
		const off = on("queue.changed", (v) => {
			pushed = true;
			setQueue(v);
		});
		call("queue.view")
			.then((v) => pushed || setQueue(v))
			.catch(() => undefined);
		return off;
	}, []);

	useEffect(() => {
		let pushed = false;
		const off = on("waiting.changed", (v) => {
			pushed = true;
			listed(v);
		});
		call("waiting.list")
			.then((v) => pushed || listed(v))
			.catch(() => undefined);
		return off;
	}, [listed]);

	useEffect(() => {
		let live = true;
		call("agents.list")
			.then((v) => live && setSpecs(v.specs))
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [tick]);

	// the agents may have been changed in another window (Iestatījumi → Aģenti, a drag in the conversations window): read them again when this one gets focus
	useEffect(() => {
		let live = true;
		const reread = () =>
			call("agents.list")
				.then((v) => live && setSpecs(v.specs))
				.catch(() => undefined);
		window.addEventListener("focus", reread);
		return () => {
			live = false;
			window.removeEventListener("focus", reread);
		};
	}, []);

	useEffect(
		() =>
			on("agent.event", ({ threadId, event }) => {
				const next = stepOf(event);
				if (next === undefined) return;
				setSteps((s) => {
					if (next === null) {
						if (!(threadId in s)) return s;
						const rest = { ...s };
						delete rest[threadId];
						return rest;
					}
					return s[threadId] === next ? s : { ...s, [threadId]: next };
				});
			}),
		[],
	);

	/** The lead's current thread: what `agent.send` and `agent.history` mean. Same rule as main's `lead()`: the newest one that is not closed. */
	const lead = useMemo(() => threads.find((t) => t.agent === LEAD_ID && t.state !== "closed"), [threads]);

	/** Running and queued threads of the open project, running first. A queued item that was stopped is not a lane. */
	const lanes = useMemo<LaneItem[]>(() => {
		const title = (id: string) => threads.find((t) => t.id === id)?.title ?? "";
		const at = (id: string) => threads.find((t) => t.id === id)?.createdAt ?? null;
		const run = queue.running.filter((r) => r.projectId === projectId).map((r): LaneItem => ({ threadId: r.threadId, agent: r.agent, title: title(r.threadId), at: at(r.threadId), why: null, state: r.waitingConfirm ? "waiting-confirm" : "running", step: steps[r.threadId] ?? null }));
		const wait = queue.queued.filter((q) => q.state === "queued" && q.projectId === projectId).map((q): LaneItem => ({ threadId: q.threadId, agent: q.agent, title: title(q.threadId), at: at(q.threadId), why: queue.why?.[q.id] ?? null, state: "queued", step: null }));
		return [...run, ...wait];
	}, [queue, threads, steps, projectId]);
	/** work going on in other projects: the lanes show the open one only, but Apturēt visu stops these too */
	const elsewhere = useMemo(() => queue.running.filter((r) => r.projectId !== projectId).length + queue.queued.filter((q) => q.state === "queued" && q.projectId !== projectId).length, [queue, projectId]);

	const confirm = useCallback((id: string, allow: boolean) => call("agent.confirm", id, allow), []);
	/** The chat's confirm line is settled once main's list no longer has it (answered here or in Gaida tevi, or its run ended). Never before the list showed it once. */
	const settled = (id: string) => seen.current.has(id) && !waiting.some((w) => w.kind === "confirm" && w.id === id);
	/** a confirmation that Gaida tevi shows right now, waiting for the user's answer */
	const pending = (id: string) => waiting.some((w) => w.kind === "confirm" && w.id === id);
	const reload = useCallback(() => {
		const p = projectId;
		call("threads.list", p)
			.then((list) => current.current === p && setThreads((pushed) => pushed.reduce(upsert, list)))
			.catch(() => undefined);
	}, [projectId]);
	const add = useCallback((t: Thread) => setThreads((ts) => upsert(ts, t)), []);

	// the thread on screen: the one picked, else the lead's current one (today's chat, which `agent.send` and `agent.history` mean)
	const viewId = selId ?? lead?.id ?? null;
	const viewThread = threads.find((t) => t.id === viewId);
	const leadPath = selId === null || selId === lead?.id;

	// the thread on screen is read while the window is in front: opening it, or a message arriving in it, moves its seen mark (main pushes the thread back without `unread`)
	const [inFront, setInFront] = useState(() => (typeof document === "undefined" ? true : document.hasFocus()));
	useEffect(() => {
		if (!opts.markSeen) return;
		const on = () => setInFront(true);
		const off = () => setInFront(false);
		window.addEventListener("focus", on);
		window.addEventListener("blur", off);
		return () => {
			window.removeEventListener("focus", on);
			window.removeEventListener("blur", off);
		};
	}, [opts.markSeen]);
	const unreadOnScreen = viewThread?.unread ?? 0;
	useEffect(() => {
		if (!opts.markSeen || !inFront || unreadOnScreen <= 0 || !viewId) return;
		const p = projectId;
		call("threads.seen", viewId, p)
			.then((t) => current.current === p && setThreads((ts) => upsert(ts, t)))
			.catch(() => undefined);
	}, [opts.markSeen, inFront, unreadOnScreen, viewId, projectId]);
	/** the lead's current thread is the null selection, so a click on it is the same as today's chat */
	const select = useCallback((id: string) => ui.selectThread(id === lead?.id ? null : id), [lead?.id]);
	const open = useCallback(
		async (agent: string) => {
			const p = projectId;
			const t = await call("threads.open", p, agent);
			// the user went to another project meanwhile: the thread is made, but this list and this chat are not its
			if (current.current !== p) return;
			add(t);
			select(t.id);
		},
		[projectId, add, select],
	);
	const rename = useCallback(
		async (id: string, title: string) => {
			const p = projectId;
			const t = await call("threads.rename", id, p, title);
			if (current.current === p) add(t);
		},
		[projectId, add],
	);
	const close = useCallback(
		async (id: string) => {
			const p = projectId;
			const t = await call("threads.close", id, p);
			if (current.current === p) add(t);
		},
		[projectId, add],
	);

	const pin = useCallback(
		async (id: string, pinned: boolean) => {
			const p = projectId;
			const t = await call("threads.pin", id, p, pinned);
			if (current.current === p) add(t);
		},
		[projectId, add],
	);
	/** Takes an archived conversation back (Atjaunot). */
	const reopen = useCallback(
		async (id: string) => {
			const p = projectId;
			const t = await call("threads.reopen", id, p);
			if (current.current === p) add(t);
		},
		[projectId, add],
	);
	const pause = useCallback((target: PauseTarget, paused: boolean) => call("pause.set", target, paused), []);
	/** The run table, Gaida tevi and the pause state are main's; nothing is kept here but what it pushes. */
	const incidents = useMemo(() => waiting.filter((w): w is Extract<WaitingItem, { kind: "incident" }> => w.kind === "incident") as (Extract<WaitingItem, { kind: "incident" }> & IncidentView)[], [waiting]);
	const retry = useCallback((id: string) => call("incidents.retry", id), []);
	const dismiss = useCallback((id: string) => call("incidents.dismiss", id), []);

	return { threads, queue, waiting, specs, lead, lanes, elsewhere, settled, pending, confirm, reload, selId, viewId, viewThread, leadPath, viewKey: `${projectId}|${selId}`, select, open, close, rename, pin, reopen, pause, incidents, retry, dismiss };
}
