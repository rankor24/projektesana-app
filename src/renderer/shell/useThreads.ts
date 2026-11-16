// What the chat window knows about threads: the project's threads, the run table and queue, Gaida tevi, the agents, and the last step of each running thread.
// Everything is pushed by main (threads.changed, queue.changed, waiting.changed, agent.event); the first read only fills what has not been pushed yet.
import { useCallback, useEffect, useMemo, useState } from "react";
import { normRef, type AgentSpec } from "../../shared/agent-types";
import { LEAD_ID, type QueueView, type Thread, type ThreadState, type WaitingItem } from "../../shared/thread-types";
import type { RunEvent } from "../../shared/types";
import { call, on } from "../bridge";
import { ui, useUi } from "../state";

const NO_QUEUE: QueueView = { running: [], queued: [], paused: false, waves: [] };

/** "Vadošais" for the lead, the specialist's name, or the bare id of one that was removed in Iestatījumi. */
export function agentName(id: string, specs: readonly AgentSpec[]): string {
	return id === LEAD_ID ? "Vadošais aģents" : (specs.find((s) => s.id === id)?.name ?? id);
}

/** The specialists "@" at the start of the message offers: those whose id or name starts with what is typed so far. Empty once a space follows the word. */
export function mentionOptions(text: string, specs: readonly AgentSpec[]): AgentSpec[] {
	const m = /^\s*@(\S*)$/.exec(text);
	if (!m) return [];
	const q = normRef(m[1]);
	return specs.filter((s) => !q || normRef(s.id).startsWith(q) || normRef(s.name).startsWith(q));
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
			return "domā…";
		case "confirm":
			return "gaida apstiprinājumu";
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
}

export function useThreads(projectId: string | null) {
	const { tick, thread: selId } = useUi();
	const [threads, setThreads] = useState<Thread[]>([]);
	const [queue, setQueue] = useState<QueueView>(NO_QUEUE);
	const [waiting, setWaiting] = useState<WaitingItem[]>([]);
	const [specs, setSpecs] = useState<AgentSpec[]>([]);
	const [steps, setSteps] = useState<Record<string, string>>({});
	/** confirmations answered from the window: the chat's own confirm line follows */
	const [answered, setAnswered] = useState<ReadonlyMap<string, boolean>>(new Map());

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
			setWaiting(v);
		});
		call("waiting.list")
			.then((v) => pushed || setWaiting(v))
			.catch(() => undefined);
		return off;
	}, []);

	useEffect(() => {
		let live = true;
		call("agents.list")
			.then((v) => live && setSpecs(v.specs))
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [tick]);

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
		const run = queue.running.filter((r) => r.projectId === projectId).map((r): LaneItem => ({ threadId: r.threadId, agent: r.agent, title: title(r.threadId), state: r.waitingConfirm ? "waiting-confirm" : "running", step: steps[r.threadId] ?? null }));
		const wait = queue.queued.filter((q) => q.state === "queued" && q.projectId === projectId).map((q): LaneItem => ({ threadId: q.threadId, agent: q.agent, title: title(q.threadId), state: "queued", step: null }));
		return [...run, ...wait];
	}, [queue, threads, steps, projectId]);
	/** work going on in other projects: the lanes show the open one only, but Apturēt visu stops these too */
	const elsewhere = useMemo(() => queue.running.filter((r) => r.projectId !== projectId).length + queue.queued.filter((q) => q.state === "queued" && q.projectId !== projectId).length, [queue, projectId]);

	const confirm = useCallback(async (id: string, allow: boolean) => {
		await call("agent.confirm", id, allow);
		setAnswered((m) => new Map(m).set(id, allow));
	}, []);
	const reload = useCallback(() => {
		call("threads.list", projectId)
			.then((list) => setThreads((pushed) => pushed.reduce(upsert, list)))
			.catch(() => undefined);
	}, [projectId]);
	const add = useCallback((t: Thread) => setThreads((ts) => upsert(ts, t)), []);

	// the thread on screen: the one picked, else the lead's current one (today's chat, which `agent.send` and `agent.history` mean)
	const viewId = selId ?? lead?.id ?? null;
	const viewThread = threads.find((t) => t.id === viewId);
	const leadPath = selId === null || selId === lead?.id;
	/** the lead's current thread is the null selection, so a click on it is the same as today's chat */
	const select = useCallback((id: string) => ui.selectThread(id === lead?.id ? null : id), [lead?.id]);
	const open = useCallback(
		async (agent: string) => {
			const t = await call("threads.open", projectId, agent);
			add(t);
			select(t.id);
		},
		[projectId, add, select],
	);
	const close = useCallback(
		async (id: string) => {
			add(await call("threads.close", id, projectId));
		},
		[projectId, add],
	);

	return { threads, queue, waiting, specs, lead, lanes, elsewhere, answered, confirm, reload, selId, viewId, viewThread, leadPath, viewKey: `${projectId}|${selId}`, select, open, close };
}
