# Agent Sessions and Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every agent gets stored conversations of its own, agents start each other's work through messages under limits kept in code, and the office's design process (S1–S7 with gates H1–H7) runs on top as an optional mode per project.

**Architecture:** `AgentSession` splits into a thread runner (one conversation) and a coordinator (who runs now). Threads, messages, topics and the queue are JSON / JSONL files in the app's data folder; agreements and questions are Atmiņa notes with extra fields. Process mode is a pure state machine over a small state in the project store's meta slot; its rules are enforced where messages are checked.

**Tech Stack:** Electron 43, React 19, TypeScript (ESM, tabs), pi 1.4.0 (`@earendil-works/pi-agent-core`, `pi-ai`), zod, `node:test` with `tsx`. No new dependencies.

**Spec:** `docs/agent-sessions-design.md` (approved by the user 2026-11-13). Process source: `docs/BD/projektesanas_process.md`.

## Global Constraints

- pi packages stay pinned at `1.4.0`. Tools of the main process are handed to a run through `PiRunOptions.extraTools`, as `delegate` is.
- Every new tool gets a level, a row in `docs/v2-design.md` 4.2 and in the tool table of `docs/v2-work-plan.md`, and a short description. The lead's fixed context stays under **10 000** tokens (`test/0.6-session-context.test.ts`); measure before and after each task that adds a declaration.
- `never` stays `never` for every agent: `delete_element`, `send_code_to_revit`, any approve / close / confirm-a-fact, any write to a source file. No agent tool passes a gate.
- Revit: short calls, confirm per batch, only on the project's working copy (`revitWork`), a revision after every confirmed batch (`afterBatch`).
- Nothing is written into an office project folder. All new files live under the app's data folder.
- Pure logic goes in `src/core` or `src/shared` with tests; components are typechecked and built only. No UI automation, no browser tests: the user playtests.
- Tests use invented fixtures and a scripted run (`SessionDeps.runAgent`); nothing leaves the machine. No real project data and no people's names in code, tests, docs or commit messages.
- UI strings and refusals an agent or the user reads are Latvian; code, comments and docs English.
- One task, one commit; the message starts with the task number (`10.1 thread store`). Stage explicit paths only.
- **Task cycle**, the same for every task: write the task's tests and see them fail → implement → `npm run typecheck && npm test && npm run build` all pass → commit.
- The three shipped specialists and today's single chat must keep working after every task.

## Before starting

- Phase 9 is built (commit `71c3a5c` on `v2.5`). Work on the branch `agent-sessions` made from it. The renderer tasks (11.6, 12.5, 13.5, 13.6, 14.8) build on the Chat window of 9.2.
- `scripts/audit.ts` reads only `docs/v2-work-plan.md`. When a phase here starts, add its rows to that file in its table format (Task | Build | Files | Tests | Done when) so `npm run audit` covers them. That edit is part of the phase's first task.

## Review Focus

Conditions the spec implies and no task would otherwise test. Each is pinned by a test in the task named.

1. **The app dies mid-write.** A torn last line in a transcript, `messages.jsonl` or `queue.json` must not lose the rest: the file loads, the torn line is skipped, the run is `interrupted`. → 10.1, 11.3, 12.1.
2. **A reply arrives while its addressee is still running.** It is kept and delivered when that run ends, never dropped and never started as a second run of the same thread. → 12.2.
3. **The recipient cannot run** (agent removed in Iestatījumi, not signed in, model error, stopped). The sender must be woken with a "blocked" reply, not wait for ever. → 12.2.
4. **The user is in another project** while agents of the first one work. Runs go on, every event carries its project, Gaida tevi lists items of all projects. → 11.5.
5. **Two agents with a role text each push a thread past its window.** Compaction works per thread and a compacted thread still knows its open topic ids. → 10.4, 12.2.

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/thread-types.ts` | `Thread`, `ThreadState`, `QueueView`, `WaitingItem`, `RoomLine`: shapes the renderer shares |
| `src/core/threads.ts` | `ThreadStore`: threads and their transcripts on disk |
| `src/core/queue.ts` | pure: the queue, `pickNext`, waves and their limits; load and save |
| `src/core/messages.ts` | pure: `Message`, `Topic`, `Mailbox`, `canSend`, `inboxOf`, `pendingOf`, `shouldWake` |
| `src/core/process-def.ts` | the office process as data: stages, gates, leaders, depth table, stage cards |
| `src/core/process.ts` | pure: `ProcessState`, `step`, `reviewScope`, `statusText`, `exportRegisters` |
| `src/agent/locks.ts` | + `LockRegistry`: locks per project, one Revit, the batch hold |
| `src/agent/thread-runner.ts` | one run of one thread (today's `AgentSession.run`) |
| `src/agent/coordinator.ts` | the run table, the queue, stop, pause, confirmations, waking |
| `src/agent/mail.ts` | the `send_message` and `close_topic` tools of the main process |
| `src/agent/agents.ts` | spec v2: role files, shared rules, validation, standing text per agent |
| `src/agent/session.ts` | stays as the facade the IPC handlers call |
| `src/agent/tools/process.ts` | process tools of the tools server |
| `src/main/handlers/threads.ts`, `process.ts` | IPC |
| `src/shared/mention.ts`, `waiting.ts`, `room.ts` | pure: `@` parsing, Gaida tevi items, room feed lines |
| `src/renderer/shell/{ThreadList,Lane,Waiting,RoomFeed,ProcessStrip}.tsx` | the minimum UI |

Files in `src/shared` and the renderer import from `src/core` and `src/agent` **as types only** (`import type`); the files with `node:fs` in them never reach the renderer bundle.

---

## Phase 10 — Foundations (design step A): no change in behaviour

Accepted when the user works a normal session and notices nothing new.

### Task 10.1: Thread store

**Files:** Create `src/shared/thread-types.ts`, `src/core/threads.ts`. Test `test/10.1-threads.test.ts`.

**Interfaces — produces:**

```ts
// src/shared/thread-types.ts
export const LEAD_ID = "lead";
export type ThreadState = "idle" | "queued" | "running" | "waiting-confirm" | "waiting-reply" | "interrupted" | "closed";
export interface Thread {
	id: string; projectId: string | null; agent: string; title: string;
	topic: string | null; state: ThreadState; startedBy: string; // "user" or an agent id
	wave: string | null; createdAt: string; lastAt: string; runs: number;
}
// src/core/threads.ts
export function threadsDir(appDir: string, projectsDir: string, projectId: string | null): string; // <projects>\<id>\threads, or <appDir>\threads\_
export class ThreadStore {
	constructor(dir: string);
	create(i: { projectId: string | null; agent: string; title: string; topic?: string | null; startedBy: string }): Thread;
	get(id: string): Thread | null;
	list(f?: { agent?: string; open?: boolean }): Thread[]; // newest lastAt first
	patch(id: string, p: Partial<Pick<Thread, "state" | "title" | "wave" | "lastAt" | "runs">>): Thread;
	append(id: string, e: ChatEntry): void;
	transcript(id: string): ChatEntry[];
	/** The lead's open thread; made on first use. `legacyChat` (chat\<project>.jsonl) is copied into it once, the old file is kept. */
	lead(projectId: string | null, legacyChat: string): Thread;
}
```

Layout: `<dir>\<threadId>\thread.json` and `chat.jsonl`. Writes of `thread.json` are atomic (temp file + rename, as `ProjectStore`).

**Tests:**
- create → get → list round trip; `list({ open: true })` leaves out `closed`; order by `lastAt`.
- `append` / `transcript` keep `ChatEntry` fields, compaction entries included.
- `lead()` twice returns the same thread; with a legacy file of 3 lines the thread's transcript has those 3 lines and the legacy file still exists.
- Review Focus 1: a `chat.jsonl` whose last line is cut mid-JSON loads the lines before it; a half-written `thread.json.<pid>.tmp` beside a good `thread.json` is ignored.
- `threadsDir` for a project is inside `<projects>\<id>`; for `null` it is `<appDir>\threads\_`.

- [ ] Tests written and failing
- [ ] Implemented
- [ ] `npm run typecheck && npm test && npm run build` pass
- [ ] Commit `10.1 thread store` (and the phase 10 rows in `docs/v2-work-plan.md`)

### Task 10.2: Who wrote it — agent and thread on every write

**Files:** Modify `src/core/scope.ts`, `src/core/store.ts` (`log`), `src/core/model.ts` (`Note`), `src/agent/tools/context.ts`, `src/agent/tools/server.ts`. Test `test/10.2-attribution.test.ts`.

**Interfaces — produces:**

```ts
export interface ToolScope { run: string | null; tool: string; agent: string | null; thread: string | null }
export interface ToolCtx { /* existing */ agent: string | null; thread: string | null } // env PROJEKTESANA_AGENT, PROJEKTESANA_THREAD
export interface Note { /* existing */ agent?: string; to?: string; topic?: string; stage?: string; status?: "open" | "closed"; reviewed?: boolean }
```

`store.log` adds `agent` and `thread` to `data` when the scope has them. `write_note` stamps `note.agent` from `ctx.agent`.

**Tests:** a store write inside `inToolScope({ run: "r1", tool: "set_fact", agent: "ar", thread: "t1" })` logs `data.agent === "ar"` and `data.thread === "t1"`; outside a scope neither key exists; `ctxEnv` → `ctxFromEnv` round trip keeps both and gives `null` for empty; a note written by `write_note` with `ctx.agent = "bk"` has `agent: "bk"`; `serializeNote` / `parseNote` keep the six new fields and old notes parse unchanged.

- [ ] Tests failing → implemented → checks pass → commit `10.2 agent and thread in the tool scope`

### Task 10.3: Locks for every run, one Revit

**Files:** Modify `src/agent/locks.ts`. Test `test/10.3-lock-registry.test.ts`.

**Interfaces — produces:**

```ts
export class LockRegistry {
	constructor(opts?: LockOptions);
	/** `staging` and `store` are per project; `revit` is one for the app. */
	acquire(projectId: string | null, key: LockKey, owner: string, call: string, signal?: AbortSignal, label?: string): Promise<Acquired>;
	release(call: string): void;
	releaseOwner(owner: string): void;
	/** From an owner's first confirmed Revit change until `endBatch`: other owners' Revit calls wait, the owner's pass. */
	beginBatch(owner: string, label: string): void;
	endBatch(owner: string): void;
	revitHeldBy(): string | null;
}
```

**Tests:** two owners on `store` of the same project take turns, on different projects both pass at once; `revit` is shared across projects; during `beginBatch("a")` a second call by `a` passes while `b` waits and gets through after `endBatch("a")`; `releaseOwner("a")` ends its batch; a waiter past `waitMs` gets the existing Latvian reason naming the holder's label.

- [ ] Tests failing → implemented → checks pass → commit `10.3 lock registry`

### Task 10.4: Thread runner

**Files:** Create `src/agent/thread-runner.ts`. Modify `src/agent/session.ts`. Test `test/10.4-thread-runner.test.ts`; existing `0.5`, `0.6`, `8.15` tests must pass unchanged.

**Interfaces — consumes:** `ThreadStore` (10.1), `LockRegistry` (10.3), `ToolCtx.agent/thread` (10.2).
**Produces:**

```ts
export interface RunInput {
	runId: string; thread: Thread; spec: AgentSpec | null; // null = the lead
	text: string; focus: FocusItem[]; files: PreparedAttachments; wave: string;
	signal: AbortSignal; emit: (e: RunEvent) => void;
	ask: (req: ConfirmRequest) => Promise<boolean>; // the coordinator routes it to the user
}
export class ThreadRunner {
	constructor(d: SessionDeps & { threads: (projectId: string | null) => ThreadStore; locks: LockRegistry });
	run(i: RunInput): Promise<{ ok: boolean; answer: string; confirmedBatches: number }>;
	context(thread: Thread, draft?: { text: string; focus: FocusItem[] }): Promise<ContextInfo>;
	compactNow(thread: Thread): Promise<{ before: number; after: number }>;
	reset(threadId: string): void;
}
```

Move the body of `AgentSession.run`, `compactHistory`, `transcriptSeed`, `shrink`, `standing`, `context`, `compactNow` here, keyed by `thread.id` instead of the project id, reading and writing the thread's transcript. Every write-level tool call of the run takes its lock through `LockRegistry` in `beforeToolCall` and frees it in `afterToolCall` (today only lanes do); a confirmed Revit batch calls `beginBatch` and the run's end, after `afterBatch`, calls `endBatch`. The tools server env gets the agent id (`lead` for `spec: null`) and the thread id. `AgentSession` keeps its public methods and calls the runner with `threads.lead(projectId, chatFile)`.

**Tests:** two threads of one project run in turn keep separate histories (the second run of thread A sees A's first answer, not B's); the transcript lands in the thread's `chat.jsonl`; a write tool in the lead's run holds `store` while it executes and frees it after (seen through `LockRegistry`); a confirmed batch holds Revit until after `afterBatch`; Review Focus 5: a thread seeded over the compaction line compacts and its compaction entry is in its own transcript, the other thread's untouched.

- [ ] Tests failing → implemented → checks pass → commit `10.4 thread runner`

### Task 10.5: Coordinator with a cap of one, events with an envelope

**Files:** Create `src/agent/coordinator.ts`. Modify `src/agent/session.ts`, `src/shared/api.ts` (`EventSpec`), `src/main/main.ts`, `src/main/activity.ts`, `src/shared/activity.ts`. Test `test/10.5-coordinator.test.ts`.

**Interfaces — produces:**

```ts
// src/shared/api.ts
"agent.event": { runId: string; event: RunEvent; threadId: string; agent: string; projectId: string | null; wave: string };
"threads.changed": { projectId: string | null; thread: Thread };
// src/shared/activity.ts
export interface Activity { /* existing */ agent?: string; thread?: string }
// src/shared/thread-types.ts
export interface StartInput { threadId: string; projectId: string | null; text: string; focus: FocusItem[]; attachments?: ChatAttachment[]; wave?: string; cause: { by: "user" } | { by: "message"; ids: string[] } }
// src/agent/coordinator.ts
export class Coordinator {
	constructor(d: CoordinatorDeps); // runner, threads, settings, emit, now
	start(i: StartInput): Promise<{ runId: string }>; // phase 10: refuses while any run is going, with today's text
	stopAll(): void;
	confirm(id: string, allow: boolean): void;
	shutdown(): Promise<void>;
}
```

A run started by the user opens a new wave (`w` + time + counter). The thread's state follows the run: `running`, `waiting-confirm` while a confirmation is open, `idle` after. `AgentSession.send / stop / confirm / shutdown` delegate to the coordinator.

**Tests:** `start` twice gives today's refusal "Aģents jau strādā. Aptur vai pagaidi."; every emitted event has `threadId`, `agent: "lead"`, `projectId`, `wave`; `threads.changed` is sent for running and idle; an open confirmation puts the thread in `waiting-confirm` and `stopAll` answers it with no; activity lines of the run carry `agent`.

- [ ] Tests failing → implemented → checks pass → commit `10.5 coordinator, event envelope`

---

## Phase 11 — Several threads and runs (design step B)

Accepted when the user co-works with two specialists at once, each in its own conversation, and stops one without the other.

### Task 11.1: The queue (pure)

**Files:** Create `src/core/queue.ts`. Test `test/11.1-queue.test.ts`.

**Interfaces — produces:**

```ts
export interface QueueItem { id: string; threadId: string; agent: string; projectId: string | null; wave: string; at: string; state: "queued" | "stopped"; input: Omit<StartInput, "threadId" | "projectId" | "wave"> }
export interface Running { runId: string; threadId: string; agent: string; projectId: string | null; wave: string; waitingConfirm: boolean }
/** The oldest queued item whose thread is not running, whose agent is not running in that project, while fewer than `cap` runs are not waiting for a confirmation. */
export function pickNext(queue: QueueItem[], running: Running[], cap: number, paused: boolean): QueueItem | null;
export function loadQueue(file: string): { items: QueueItem[]; paused: boolean };
export function saveQueue(file: string, q: { items: QueueItem[]; paused: boolean }): void; // atomic
```

**Tests:** FIFO; an item whose thread runs is skipped and the next taken; the same agent in the same project is skipped, in another project taken; `cap` 3 with 3 running gives null, with one of them `waitingConfirm` gives the item; `paused` gives null; `stopped` items are never picked; Review Focus 1: a damaged `queue.json` loads as empty and paused, never throws.

- [ ] Tests failing → implemented → checks pass → commit `11.1 queue`

### Task 11.2: Runs side by side, Stop for all and for one

**Files:** Modify `src/agent/coordinator.ts`. Test `test/11.2-parallel.test.ts`.

**Interfaces — produces (replaces 10.5's refusing `start`):**

```ts
start(i: StartInput): Promise<{ runId: string | null; queued: boolean }>; // runs now or queues
stopAll(wave?: string): void;        // aborts runs, marks queued items stopped, denies confirmations, frees locks
stopThread(threadId: string): void;
pause(): void; resume(): void;
view(): QueueView;
// src/shared/thread-types.ts
export interface QueueView { running: Running[]; queued: QueueItem[]; paused: boolean; waves: Wave[] } // waves: empty until 12.4
"queue.changed": QueueView; // event, sent on every change of the view
```

After every run end, confirmation and `resume`, the coordinator calls `pickNext` with `settings().maxParallelAgents` until it returns null. A thread with a queued item is `queued`. A start caused by the user on a thread that is running or queued is refused with today's text ("Aģents jau strādā. Aptur vai pagaidi."): the user's own messages never pile up unseen. `agent.send` and `threads.send` return `{ runId: string | null; queued: boolean }` (`src/shared/api.ts`).

**Tests** (scripted `runAgent` that waits on a promise the test resolves): with cap 2, three starts on three threads → two running, one queued, the third starts when one ends; a second user start on a running thread is refused with today's text; two threads of one agent in one project → the second queues behind the first; `stopThread` ends one run with the other still going; `stopAll` leaves nothing running, queued items `stopped`, no lock held (`LockRegistry.revitHeldBy()` null, a fresh `acquire` passes at once); `pause` lets running runs finish and starts nothing; confirmations of two runs are answered separately by id.

- [ ] Tests failing → implemented → checks pass → commit `11.2 parallel runs, stop`

### Task 11.3: After a restart nothing runs by itself

**Files:** Modify `src/agent/coordinator.ts`, `src/core/threads.ts`. Test `test/11.3-restart.test.ts`.

**Interfaces — produces:** `Coordinator.restore(): { interrupted: number; queued: number }` (called once at start), `resumeInterrupted(): void`, `discardInterrupted(): void`.

`restore` marks every thread found `running`, `queued`, `waiting-confirm` as `interrupted`, loads the queue paused. `resumeInterrupted` unpauses; `discardInterrupted` marks the queued items `stopped` and the threads `idle`.

**Tests:** a data folder with one thread `running` and two queued items → after `restore` no run started, the thread is `interrupted`, `view().paused` is true, the counts are 1 and 2; resume starts the queued items; discard leaves them `stopped`; Review Focus 1: a queue file cut mid-write gives `{ interrupted: 1, queued: 0 }` and no throw.

- [ ] Tests failing → implemented → checks pass → commit `11.3 restart: interrupted, paused`

### Task 11.4: Talk to any agent

**Files:** Create `src/main/handlers/threads.ts`, `src/shared/mention.ts`. Modify `src/shared/api.ts`, `src/main/api.ts`, `src/agent/thread-runner.ts`, `src/agent/session.ts`. Test `test/11.4-threads-api.test.ts`.

**Interfaces — produces:**

```ts
// src/shared/mention.ts
/** "@ar pārbaudi sienas" → { agent: "ar", text: "pārbaudi sienas" }; no leading @known-agent → null. Matches id or name as findSpec does. */
export function parseMention(text: string, specs: readonly AgentSpec[]): { agent: string; text: string } | null;
// Handlers
"threads.list": (projectId: string | null) => Thread[];
"threads.open": (projectId: string | null, agent: string, title?: string) => Thread;   // a new thread with that agent
"threads.send": (threadId: string, projectId: string | null, text: string, focus: FocusItem[], attachments?: ChatAttachment[]) => { runId: string | null; queued: boolean };
"threads.history": (threadId: string, projectId: string | null) => ChatEntry[];
"threads.stop": (threadId: string) => void;
"threads.close": (threadId: string, projectId: string | null) => Thread;
"queue.view": () => QueueView; "queue.pause": () => void; "queue.resume": () => void;
```

A thread whose agent is a specialist runs with that spec's prompt plus the existing `RULES` text and the tools `laneTools(listed, levelOf, SPECIALIST_CAP)` filtered by `spec.tools` (as `delegate` builds them); it gets no `run_subagent` / `delegate`. `agent.send` with a text that `parseMention` matches opens or reuses that agent's newest open thread in the project and sends there.

**Tests:** `parseMention` on id, on name with diacritics, on a prefix, on no match, on `@` mid-text (null); `threads.open` with an unknown agent throws "Nav speciālista: …"; a specialist thread's run is offered only read tools plus its own; sending to a `closed` thread throws; `agent.send("@dokumenti …")` lands in the dokumenti thread, a plain text in the lead's.

- [ ] Tests failing → implemented → checks pass → commit `11.4 threads API, @mention`

### Task 11.5: Gaida tevi

**Files:** Create `src/shared/waiting.ts`. Modify `src/shared/thread-types.ts`, `src/agent/coordinator.ts`, `src/main/handlers/threads.ts`, `src/shared/api.ts`. Test `test/11.5-waiting.test.ts`.

**Interfaces — produces:**

```ts
export type WaitingItem =
	| { kind: "confirm"; id: string; threadId: string; agent: string; projectId: string | null; tool: string; batch: string }
	| { kind: "interrupted"; interrupted: number; queued: number }
	| { kind: "wave-paused"; wave: string; projectId: string | null; reason: "runs" | "cost" }        // from 12.4
	| { kind: "question"; noteId: string; projectId: string; from: string; title: string }            // from 12.3
	| { kind: "gate"; gate: string; projectId: string; noteId: string };                              // from 14.3
export function waitingItems(i: { confirms: Extract<WaitingItem, { kind: "confirm" }>[]; restore: { interrupted: number; queued: number } | null; paused: Extract<WaitingItem, { kind: "wave-paused" }>[]; questions: Extract<WaitingItem, { kind: "question" }>[]; gates: Extract<WaitingItem, { kind: "gate" }>[] }): WaitingItem[]; // confirmations first, then gates, questions, pauses, interrupted
"waiting.list": () => WaitingItem[];   // all projects
"waiting.changed": WaitingItem[];      // event
```

**Tests:** order of kinds; Review Focus 4: confirmations of runs in two projects are both listed with their `projectId` while a third project is the open one; an answered confirmation leaves the list and `waiting.changed` is sent.

- [ ] Tests failing → implemented → checks pass → commit `11.5 Gaida tevi`

### Task 11.6: Minimum UI for threads

**Files:** Create `src/renderer/shell/ThreadList.tsx`, `Lane.tsx`, `Waiting.tsx`. Modify the Chat window of 9.2 (`src/renderer/shell/AgentDock.tsx`), `src/renderer/state.ts`, `src/renderer/styles.css`. No test file (components); `parseMention` and `waitingItems` are already tested.

Build: a list of agents with their threads and state dots (idle, running, waiting, interrupted) and "Jauna saruna"; the chat shows the selected thread; one collapsed lane per running thread under the input's area with its last step and a stop button; `@` in the input completes agent names; a **Gaida tevi** block with confirm / deny, Turpināt / Atmest; one Stop for all; queue pause.

**Done when:** the user opens a thread with a specialist, writes to it while the lead works on something else, confirms a batch from Gaida tevi, and stops one of the two.

- [ ] Implemented → `npm run typecheck && npm test && npm run build` pass → commit `11.6 threads in the chat`

---

## Phase 12 — Messages (design step C)

Accepted when the user watches two agents settle a detail and finds the agreement in Atmiņa.

### Task 12.1: Messages, topics and the send rules (pure)

**Files:** Create `src/core/messages.ts`. Test `test/12.1-messages.test.ts`.

**Interfaces — produces:**

```ts
export type MessageKind = "task" | "reply" | "ask";
export interface TaskEnvelope { id: string; stage?: string; goal: string; context: string[]; expects: string; iteration: number; limits?: string }
export interface ReplyEnvelope { id: string; status: "izpildīts" | "daļēji" | "bloķēts"; results: string[]; questions: string[]; decisions: string[]; risks?: string }
export interface Message { id: string; at: string; wave: string; topic: string; from: string; to: string; kind: MessageKind; text: string; refs: string[]; fromThread: string; toThread: string; depth: number; state: "queued" | "delivered" | "failed" | "stopped"; task?: TaskEnvelope; reply?: ReplyEnvelope }
export interface Topic { id: string; title: string; parties: [string, string]; parent: string | null; state: "open" | "agreed" | "passed-up"; openedAt: string; closedAt?: string; noteId?: string }
export interface Limits { exchangesPerTopic: number; chainDepth: number; runsPerWave: number; waveCost: number | null; taskIterations: number }
export const DEFAULT_LIMITS: Limits = { exchangesPerTopic: 3, chainDepth: 6, runsPerWave: 20, waveCost: null, taskIterations: 3 };
export type SendCheck = { ok: true } | { ok: false; code: "self" | "unknown-agent" | "acl" | "closed" | "exchanges" | "depth" | "iterations" | "process"; reason: string; passUp: boolean };
export function canSend(m: { from: string; to: string; kind: MessageKind; topic: Topic | null; depth: number; iteration?: number }, c: { agents: readonly AgentSpec[]; limits: Limits; messages: readonly Message[] }): SendCheck;
export function inboxOf(threadId: string, ms: readonly Message[]): Message[];   // state "queued", toThread = threadId
export function pendingOf(threadId: string, ms: readonly Message[]): Message[]; // this thread's task/ask messages with no later message on the topic back to it, and not failed/stopped
export function shouldWake(threadId: string, ms: readonly Message[]): boolean;  // inbox not empty and nothing pending
export class Mailbox { constructor(dir: string); topics(): Topic[]; messages(): Message[]; openTopic(t: Omit<Topic, "id" | "state" | "openedAt">): Topic; add(m: Omit<Message, "id" | "at" | "state">): Message; setState(id: string, s: Message["state"]): void; closeTopic(id: string, state: "agreed" | "passed-up", noteId: string): Topic }
export function renderTask(t: TaskEnvelope, agent: string): string;  // the office's UZDEVUMS text
export function renderReply(r: ReplyEnvelope): string;               // the office's ATBILDE text
```

`canSend` rules, in this order: `self` (from = to); `unknown-agent`; `acl` (`to` not in sender's `mayMessage` when set, or sender not in recipient's `acceptsFrom` when set; these fields arrive in 13.1 and are absent until then; a `reply` on an open topic between its two parties always passes this rule, so an agent that takes messages from nobody still gets answers to its own questions); `closed` (topic not open); `exchanges` (the sender already sent `exchangesPerTopic` messages on this topic) with `passUp: true`; `depth` (`depth > chainDepth`) with `passUp: true`; `iterations` (`kind: "task"` with `iteration > taskIterations`) with `passUp: true`.

Storage: `messages.jsonl` (one line per message; a state change is a new line with the same id, the last one wins) and `topics.json` in `<projects>\<id>\mail`.

**Tests:** each refusal code with its Latvian reason; on one topic the opener's 1st, 2nd and 3rd message pass and the 4th is `exchanges` with `passUp`, and so is the other party's 4th; `depth` 6 passes, 7 is refused; `inboxOf` / `pendingOf` / `shouldWake` for: a fresh task (wake), one of two replies in (no wake), both in (wake), one in and the other `failed` (wake); `renderTask` gives exactly

```
UZDEVUMS: U-12 | Stadija: S4 | Aģents: bk
Mērķis: Pārbaudīt pārseguma biezumu asīs 1-4.
Konteksta pakete: 04_modeli/ifc/AR.ifc; L-7
Gaidāmā izeja: atbilde ar pamatojumu
Termiņš / iterācija: 1 no 3
Ierobežojumi: nemainīt modeli
```

for the matching envelope, and `renderReply` the ATBILDE block of process 7.2; Review Focus 1: a `messages.jsonl` with a torn last line loads all earlier messages; the last state line of an id wins.

- [ ] Tests failing → implemented → checks pass → commit `12.1 messages, topics, send rules` (and the phase 12 rows in `docs/v2-work-plan.md`)

### Task 12.2: `send_message`, delivery and waking

**Files:** Create `src/agent/mail.ts`. Modify `src/agent/coordinator.ts`, `src/agent/thread-runner.ts`, `src/agent/subagents.ts` (`MAIN_TOOL_LEVELS`), `src/agent/prompt.ts`, `docs/v2-design.md` 4.2, `docs/v2-work-plan.md` tool table. Test `test/12.2-mail.test.ts`.

**Interfaces — consumes:** `Mailbox`, `canSend`, `shouldWake` (12.1); `Coordinator.start` (11.2).
**Produces:**

```ts
export const MAIL_TOOL_LEVELS: Record<string, Level> = { send_message: "run", close_topic: "run" };
export function mailTools(d: MailDeps): AgentTool<any>[]; // MailDeps: mailbox, threads, agents(), limits(), self: { agent, threadId, projectId, wave, depth }, enqueue(), note()
```

`send_message { to, topic?, title?, kind, text, refs?, task?, reply? }`: exactly one of `topic` (an id) or `title` (opens a topic); runs `canSend`; a refusal returns `isError` with the reason (what a `passUp` refusal also writes comes in 12.3). On success: adds the message, finds the recipient's open thread for the topic or creates one (`startedBy` = sender), and the coordinator delivers.

Delivery, in the coordinator: after any run ends and after any message is added, for each thread with `shouldWake` and no run going, start a run whose text is the inbox messages in order, each as `[no <from> · <topic title> · <kind>]\n<text or rendered envelope>`; mark them `delivered`; the run is in the messages' wave with `cause.by = "message"` and carries no Fokuss. A thread whose run ended with `pendingOf` not empty becomes `waiting-reply`. When a run that was started by a message ends in an error, is stopped, or its agent no longer exists, the coordinator adds a `reply` from that agent with `reply.status: "bloķēts"` and the reason, so the sender wakes. Every agent's standing text gets three lines on when to use `send_message` (work that outlives your turn) against `delegate` (a report within your turn).

**Tests** (scripted agents): A sends an `ask` to B → B's thread is created and runs with the message text → B replies → A is woken once with the reply and its thread goes `waiting-reply` → `idle`; A asks five agents → A is woken once, after the fifth reply, with five messages; Review Focus 2: B's reply added while A's run is still going is delivered when A's run ends, one run, nothing lost; Review Focus 3: the recipient's run errors → A gets a `bloķēts` reply naming the error; the recipient id removed from the specs before delivery → same; `stopAll(wave)` marks the wave's queued messages `stopped` and nobody is woken; the user writes into a `waiting-reply` thread → it runs on the user's message at once, and the reply that arrives later is delivered in a run of its own; a 4th message on a topic is refused and the tool result is an error with the Latvian reason; Review Focus 5: a thread compacted while a topic is open still gets the topic id in its next prompt (open topics of the thread are listed in the run's prompt by code); the lead's fixed context stays under 10 000.

- [ ] Tests failing → implemented → checks pass → commit `12.2 send_message, delivery, waking`

### Task 12.3: `close_topic` and the registers in Atmiņa

**Files:** Modify `src/agent/mail.ts`, `src/core/model.ts` (nothing new beyond 10.2 fields), `src/agent/tools/sources.ts` (`read_notes` filters), `src/renderer/panels/Atmina.tsx`. Test `test/12.3-close-topic.test.ts`.

**Interfaces — produces:** `close_topic { topic, outcome: "agreed" | "passed-up", decision, impact: { cost: boolean; time: boolean; norms: boolean; pu: boolean } }`; `passUp(d: MailDeps, topic: Topic, why: string): Note` (used by 12.2's refusals and by the automatic pass-up).

From this task a `send_message` refusal with `passUp: true` calls `passUp` as well. `agreed` writes a note `type: "decision"`, `agent` = caller, `to` = the other party, `topic`, `reviewed: false`, title = topic title, body = `decision`, refs = the message refs of the topic; closes the topic with the note id. `passed-up` writes a note `type: "question"`, `status: "open"`, `to: "lead"` (or `"user"` when the caller is the lead). An `agreed` close with any `impact` flag true is not an agreement: it is written as a question to the user with the proposed decision in it and the topic closes `passed-up` (process chapter 8 and the office's `lemumu-zurnals` skill: agents do not settle what changes cost, time, the PU or compliance). Only a party of the topic may close it. `read_notes` takes optional `topic`, `agent`, `status`. Atmiņa shows the parties and "nepārskatīts" on such notes; the user (and in 14.x the lead) can mark a decision reviewed or cancel it (cancel = a new `decision` note that names the cancelled one; nothing is deleted).

**Tests:** `agreed` with all impact flags false → one decision note with both parties, the topic `agreed` with `noteId`; `agreed` with `impact.cost: true` → no decision note, one open question to `"user"` holding the proposed decision, the topic `passed-up`; a non-party's call is refused; a second close is refused (`closed`); the automatic pass-up at the exchange limit writes one open question to the lead and closes the topic `passed-up`; a question to `"user"` appears as a `question` item in `waitingItems`; `read_notes({ topic })` returns only that topic's notes.

- [ ] Tests failing → implemented → checks pass → commit `12.3 close_topic into Atmiņa`

### Task 12.4: Wave limits

**Files:** Modify `src/core/queue.ts`, `src/agent/coordinator.ts`, `src/shared/types.ts` (`Settings.limits`), `src/main/settings.ts`, `src/renderer/panels/Iestatijumi.tsx`. Test `test/12.4-wave-limits.test.ts`.

**Interfaces — produces:**

```ts
export interface Wave { id: string; projectId: string | null; startedAt: string; runs: number; cost: number; paused: null | "runs" | "cost" }
export function waveCheck(w: Wave, l: Limits): null | "runs" | "cost"; // runs >= runsPerWave; waveCost set and cost >= waveCost
// Settings
limits: Limits; // DEFAULT_LIMITS when absent
// Coordinator
resumeWave(wave: string): void; // counts start again from zero for that wave
```

Before starting a run the coordinator checks its wave; a paused wave's items stay queued and a `wave-paused` item appears in Gaida tevi; other waves go on. `usage` events add to the wave's cost when the provider gives one. `QueueView.waves` carries the live waves, and the chat shows the current wave's runs and cost beside Stop ("vilnis: 7 skrējieni · $0.42", cost left out when the provider gives none).

**Tests:** the 21st run of a wave is not started and the wave is paused with `runs`; another wave still runs; `resumeWave` starts it; `waveCost: 1` pauses after usage events summing to 1; `waveCost: null` never pauses on cost; settings clamp: `exchangesPerTopic` 1–10, `chainDepth` 1–20, `runsPerWave` 1–200.

- [ ] Tests failing → implemented → checks pass → commit `12.4 wave limits`

### Task 12.5: Room feed

**Files:** Create `src/shared/room.ts`, `src/renderer/shell/RoomFeed.tsx`. Modify `src/shared/thread-types.ts`, `src/main/handlers/threads.ts`, `src/shared/api.ts`. Test `test/12.5-room.test.ts`.

**Interfaces — produces:**

```ts
export interface RoomLine { at: string; kind: "message" | "state" | "agreed" | "passed-up" | "paused"; from?: string; to?: string; topic?: string; text: string; threadId?: string; noteId?: string }
export function roomLines(i: { messages: readonly Message[]; topics: readonly Topic[]; threads: readonly Thread[] }, max?: number): RoomLine[]; // oldest first, the newest `max` (default 300)
"room.lines": (projectId: string | null) => RoomLine[];
"room.line": { projectId: string | null; line: RoomLine }; // event, one per new line
```

One line per message ("AR → BK · Pārseguma biezums: …" with the first 120 characters), per agreement, per pass-up. The component is a tab beside the thread view; a line opens its thread or its note.

**Tests:** lines in time order; a message line's text is cut at 120 characters; an agreed topic gives an `agreed` line with `noteId`; `max` keeps the newest.

- [ ] Tests failing → implemented → checks pass → commit `12.5 room feed`

---

## Phase 13 — Agents v2 (design step D)

Accepted when the user loads one of the office's role descriptions as an agent and lets a modelling agent change the Revit working copy with their confirmation.

### Task 13.0: Spike — two Revit MCP connections to one Revit

Not a code task. On this PC with Revit 2026 open on a working copy: start two runs that each launch the Revit MCP server and call one read tool at the same time. Record the result in this file under this task as one line (`Result: both answer` / `the second fails` / `the first is cut`); `docs/CHECKLIST.md` is rewritten by the audit script and is not the place. **If two connections do not work**, task 13.3 offers Revit tools only to the run that holds the Revit lock (the others get the refusal "Revit šobrīd lieto <aģents>."). The user runs Revit; the builder prepares the two scripted prompts.

Result (the user, 2026-11-13): **one Revit accepts one MCP connection; the MCP works with two Revits open.** So 13.3 takes the "only the run that holds Revit" path below. Revit per instance (two agents on two open Revits) is not built here.

- [x] Result recorded

### Task 13.1: Spec v2 and role files

**Files:** Create `src/agent/agents.ts`. Modify `src/shared/agent-types.ts`, `src/agent/subagents.ts` (re-export; `validateSpec` moves), `src/main/settings.ts`, `src/main/handlers/agents.ts`. Test `test/13.1-agents.test.ts`.

**Interfaces — produces:**

```ts
export interface AgentSpec {
	id: string; name: string; description: string; prompt: string; tools: string[];
	roleFile?: boolean;                 // <appDir>\agents\<id>.md exists and is the role text
	maxLevel?: "run" | "confirm";       // absent = "run"
	model?: string; effort?: Effort | "";
	mayMessage?: string[]; acceptsFrom?: string[]; // absent = everyone
	skills?: string[];                  // skill names this agent is told about; absent = the synced Revit skills, as today
}
export const ROLE_MAX = 16_000; export const SHARED_MAX = 6_000; // characters
export function roleDir(appDir: string): string;                 // <appDir>\agents
export function readRole(appDir: string, id: string): string | null;
export function writeRole(appDir: string, id: string, text: string): void;   // the replaced file is kept in agents\versions
export function readShared(appDir: string): string; export function writeShared(appDir: string, text: string): void; // agents\_kopejie.md
export function validateSpec(raw: unknown, levelOf: LevelOf, known: readonly string[], ids: readonly string[]): { ok: true; spec: AgentSpec } | { ok: false; error: string };
```

Validation adds: `prompt` may be empty when `roleFile` is true; tools up to `confirm` are allowed only with `maxLevel: "confirm"`, never a `never` tool and never the main-process agent tools; `mayMessage` / `acceptsFrom` name existing ids or `lead`; `model` empty or a known model id is checked at run time, not here. An `agents.json` written before this task loads unchanged.

**Tests:** an old spec validates as before; a `confirm` tool without `maxLevel: "confirm"` is refused with the existing Latvian text, with it accepted; `delete_element` refused always; unknown id in `mayMessage` refused; a role of 16 001 characters refused, 16 000 accepted; `writeRole` twice keeps the first text under `versions`; `canSend` (12.1) now refuses `acl` both ways.

- [x] Tests failing → implemented → checks pass → commit `13.1 agent spec v2, role files` (and the phase 13 rows)

### Task 13.2: Standing text per agent, measured

**Files:** Modify `src/agent/agents.ts`, `src/agent/thread-runner.ts`, `src/agent/session.ts` (`context`), `src/shared/agent-types.ts` (`AgentsView`). Test `test/13.2-standing.test.ts`.

**Interfaces — produces:**

```ts
export function standingFor(spec: AgentSpec | null, d: { appDir: string; userName: string; specs: readonly AgentSpec[]; skills: SkillInfo[]; knowledge: string; processCard?: string; status?: string }): string;
export function rosterFor(spec: AgentSpec | null, specs: readonly AgentSpec[]): string; // only agents this one may message
export function fixedTokens(spec: AgentSpec | null, d: Parameters<typeof standingFor>[1], toolDeclarations: number): number;
export const SPECIALIST_FIXED_MAX = 16_000; // tokens
// AgentsView.specs rows gain: fixedTokens: number
```

Order of a specialist's standing text: shared rules, role file (or `prompt`), `RULES`, the user line, Revit rules only when it has a Revit tool, the roster, the skills list, knowledge (13.4), the process card and status (14.x). The lead's stays `SYSTEM_PROMPT` first, as today. The skills list holds only the agent's own skills (`spec.skills`), never the whole library: the office's 120 skill descriptions are 29 000 characters together and would alone pass the guard.

**Tests:** the lead's text and token count are unchanged from before this task (under 10 000); a specialist with a 9 000-character role and 4 000 characters of shared rules contains both once and is under `SPECIALIST_FIXED_MAX`; an agent without Revit tools has no Revit rules; `rosterFor` leaves out agents outside `mayMessage`; a spec over the guard makes `agents.save` refuse with "Aģenta <id> pastāvīgais konteksts ir <n> tokeni (limits 16000)."

- [ ] Tests failing → implemented → checks pass → commit `13.2 standing text per agent`

### Task 13.3: An agent that may confirm, and its own model

**Files:** Modify `src/agent/thread-runner.ts`, `src/agent/coordinator.ts`. Test `test/13.3-confirm-agent.test.ts`.

A thread whose spec has `maxLevel: "confirm"` is offered its listed `confirm` tools; its gate asks the user through the coordinator (the item in Gaida tevi names the agent); the Revit working-copy check, `beginBatch` / `endBatch` and `afterBatch` apply as for the lead. `spec.model` / `spec.effort`, when set, replace the settings' for that agent's runs; an unknown model ends the run with the provider's own error.

From 13.0 (one connection per Revit): **the Revit seat.** `LockRegistry` gets `takeSeat(owner: string, label: string): boolean`, `releaseSeat(owner: string): void`, `seatHeldBy(): string | null`. At run start the coordinator tries to take the seat for any run whose agent would be offered Revit tools (the lead when Revit is configured; a specialist with a Revit tool). With the seat the run gets the Revit MCP server and its tools; without it the run gets **no Revit server and no Revit tools**, and one line in its prompt: "Revit šobrīd lieto <label>; Revit darbu atstāj vai jautā lietotājam." The seat is released when the run ends, after `afterBatch`. Batch holds (10.3) stay as they are inside the seat.

**Tests:** while the lead's run holds the seat, a specialist's run started beside it has no `revit` entry in its MCP launch map and its prompt carries the seat line; after the lead's run ends the next run takes the seat; two runs never both have the Revit server; a `run`-level specialist is not offered `create_level`; a `confirm`-level one is, and its call waits for the user; denying blocks it with today's text; while it holds the batch another agent's Revit call waits; after the confirmed batch `afterBatch` runs once and the batch is released; a spec with `model: "x"` runs with that model id (seen in the scripted `runAgent` options) and usage is logged under it.

- [ ] Tests failing → implemented → checks pass → commit `13.3 confirm-level agents, model per agent`

### Task 13.4: Agent knowledge

**Files:** Modify `src/core/office-memory.ts`, `src/agent/agents.ts`, `src/agent/tools/sources.ts`, `src/renderer/panels/Atmina.tsx`. Test `test/13.4-knowledge.test.ts`.

**Interfaces — produces:** `OfficeMemory.list({ type?, standing?, agent? })`; `knowledgeFor(mem: OfficeMemory, agent: string, maxChars = 4000): string` (accepted `learning` notes of that agent, newest first, cut at whole notes).

An office note written by an agent's tool call is stamped with `agent` and waits as `proposed` (the existing rule). The Atmiņa panel filters the office memory by agent.

**Tests:** a proposal is not in `knowledgeFor`; after the user accepts it, it is; notes of another agent are not; the text stops at a whole note under 4000 characters; a note without `agent` (written before this task) belongs to no agent's knowledge and stays in the shared office memory.

- [ ] Tests failing → implemented → checks pass → commit `13.4 agent knowledge`

### Task 13.5: Aģenti page

**Files:** Modify `src/renderer/panels/Agenti.tsx`, `src/main/handlers/agents.ts`, `src/shared/api.ts`. Test: extend `test/13.1-agents.test.ts` for the handlers.

**Interfaces — produces:** `"agents.role.get": (id: string) => string | null`, `"agents.role.set": (id: string, text: string) => void`, `"agents.role.import": (id: string, path: string) => { chars: number }`, `"agents.shared.get" / "agents.shared.set"`.

Build: per agent the role text editor (with its length against 16 000), "Importēt .md", the level switch (palaiž / apstiprina lietotājs), model and effort, who it may message, and its measured fixed context. One editor for the shared rules.

**Done when:** the user imports an office role description, saves, and that agent answers in its own thread in the role's voice.

- [ ] Implemented → checks pass → commit `13.5 Aģenti page: roles`

### Task 13.6: The office's skills library

Source: `docs/BD/skilli/` (received 2026-11-13): 120 skills in 17 role folders, each `<name>/SKILL.md` with `name` and `description`; 64 of them hold 109 `{{AIZPILDĪT: …}}` placeholders; its README says a skill goes to an agent only when its placeholders are filled and, for a calculation skill, its test example is checked.

**Files:** Modify `src/agent/skills.ts`, `src/agent/tools/sources.ts` (`read_skill`), `src/agent/agents.ts`. Create `src/main/handlers/skills.ts`, `src/renderer/panels/Prasmes.tsx`. Test `test/13.6-skills-library.test.ts`.

**Interfaces — produces:**

```ts
export interface SkillInfo { name: string; description: string; files: string[]; origin: "synced" | "office"; group?: string; placeholders: number; state: "draft" | "ready" }
export const PLACEHOLDER = /\{\{AIZPILDĪT[^}]*\}\}/g;
export function officeSkillsDir(appDir: string): string;                       // <appDir>\skills
export function listSkills(syncedDir: string, officeDir?: string): SkillInfo[]; // synced skills are always "ready"
/** Copies every <group>/<name>/SKILL.md tree under `src` to <officeDir>\<name>, the group kept in skills.json. A name that exists is replaced and the old folder kept under skills\versions. */
export function importSkills(src: string, officeDir: string): { imported: string[]; refused: { name: string; why: string }[] };
export function markTested(officeDir: string, name: string, tested: boolean): SkillInfo; // refused while placeholders > 0
export function skillsFor(spec: AgentSpec | null, all: readonly SkillInfo[]): SkillInfo[]; // the agent's assigned skills that are "ready"
"skills.list": () => SkillInfo[]; "skills.import": (folder: string) => { imported: string[]; refused: { name: string; why: string }[] }; "skills.tested": (name: string, tested: boolean) => SkillInfo;
```

An office skill is `ready` only when it has no placeholder left **and** the user has marked it tested; otherwise `draft`. A draft is never listed to an agent, and `read_skill` on one answers "Prasme <name> nav gatava (vietturi: <n>). Jautā lietotājam." A skill whose name equals a synced skill's is refused on import. The Prasmes page lists the library by group with the placeholder count and state, opens the skill's text, marks it tested, and assigns it to agents (writes `spec.skills`); an edited `SKILL.md` in the office folder is re-read on the next list.

**Tests** (invented skills): import of a tree with two groups gives a flat folder and the groups in `skills.json`; a skill with two placeholders is `draft` with `placeholders: 2`; `markTested` on it is refused; with the placeholders removed and marked tested it is `ready`; `skillsFor` leaves out drafts and unassigned skills; `read_skill` on a draft gives the refusal above; importing a name of a synced skill is refused with a reason; a path outside the skill's folder is still refused (the existing rule); an agent with 12 assigned ready skills stays under `SPECIALIST_FIXED_MAX`.

- [ ] Tests failing → implemented → checks pass → commit `13.6 office skills library`

---

## Phase 14 — Process mode (design step E): optional, per project

Accepted when the user takes one small project from S1 to H3 in process mode, and a project left in co-work behaves exactly as after phase 13.

### Task 14.1: The process as data and a state machine (pure)

**Files:** Create `src/core/process-def.ts`, `src/core/process.ts`. Test `test/14.1-process.test.ts`.

**Interfaces — produces:**

```ts
// process-def.ts
export const STAGES = ["S1", "S2", "S3", "S4", "S5", "S6", "S7"] as const; export type Stage = (typeof STAGES)[number];
export type GateId = "H1" | "H2" | "H3" | "H4" | "H5" | "H6" | "H7";
export const GATE_OF: Record<Stage, GateId>;                       // S1→H1 … S7→H7
export const LEADER: Record<Stage, "bpv" | "eks">;                 // "eks" for S5, "bpv" for the rest
export type DocType = "buvprojekts" | "paskaidrojuma-raksts" | "pazinojums";
export type Depth = "pilna" | "vienkāršota" | "pēc vajadzības" | "izlaiž";
export const DEFAULT_DEPTH: Record<DocType, Record<Stage, Depth>>; // the table of process chapter 4, cell for cell
export const STAGE_CARD: Record<Stage, { title: string; goal: string; involved: string; actions: string[]; output: string[]; gate: string }>; // Latvian, from chapter 6
export const MAX_ITERATIONS = 3;
// process.ts
export interface GateRecord { id: GateId; stage: Stage; iteration: number; state: "waiting" | "approved" | "returned"; noteId: string; at: string; decidedAt?: string; comment?: string; fix?: string[] }
export interface ProcessState {
	mode: "cowork" | "process"; docType: DocType;
	profile: { depth: Record<Stage, Depth>; agents: string[]; changes: { at: string; what: string; why: string }[] };
	stage: Stage | "mācības" | "done"; iteration: Record<Stage, number>;
	gates: GateRecord[]; reviewed: boolean; escalated: Stage | null;
}
export type ProcessEvent =
	| { type: "gate.request"; noteId: string; at: string }
	| { type: "gate.approve"; at: string; comment?: string; fix?: string[] }   // fix: remark ids to fix, H5 only
	| { type: "gate.return"; at: string; comment: string }
	| { type: "stage.skip"; why: string; at: string }
	| { type: "review.done"; at: string }                                       // S6: the ekspertīze re-check is recorded
	| { type: "change"; basic: boolean; at: string }
	| { type: "learned"; at: string };
export function initial(docType: DocType, agents: string[]): ProcessState;
export function step(s: ProcessState, e: ProcessEvent): { ok: true; state: ProcessState } | { ok: false; error: string };
export function reviewScope(changed: readonly string[], all: readonly string[]): { mode: "full" | "partial"; share: number }; // full when share > 0.10
```

`DEFAULT_DEPTH`, exactly: buvprojekts — all `pilna`; paskaidrojuma-raksts — S1 `pilna`, S2 `pēc vajadzības`, S3 `vienkāršota`, S4 `vienkāršota`, S5 `vienkāršota`, S6 `pilna`, S7 `pilna`; pazinojums — S1 `vienkāršota`, S2 `izlaiž`, S3 `izlaiž`, S4 `vienkāršota`, S5 `vienkāršota`, S6 `pilna`, S7 `pilna`.

Transitions: `gate.request` needs no waiting gate, and in S6 needs `reviewed`; `gate.approve` moves to the next stage whose depth is not `izlaiž`, except: H5 with empty or absent `fix` → S7, H5 with `fix` → S6, H6 → S7, H7 → `mācības`; `gate.return` keeps the stage, adds 1 to its iteration and clears `reviewed`; when that iteration would pass `MAX_ITERATIONS` the state gets `escalated: <stage>` and further `gate.request` in that stage is an error until the user approves or changes the profile; `stage.skip` is refused for S6 and S7 and records the reason in `profile.changes`; `change` with `basic: true` in S4 moves to S3, otherwise stays; `learned` in `mācības` → `done`. Any event in `cowork` mode is an error.

**Tests:** the happy path S1→H1→…→H7→mācības→done for buvprojekts; pazinojums goes S1 → S4 (S2, S3 skipped); H5 without fix → S7, with fix → S6; S6 `gate.request` before `review.done` is an error, after it passes; a gate returned three times then returned a fourth sets `escalated` and refuses the next request; `stage.skip` on S7 refused; `change` basic in S4 → S3, non-basic stays; `reviewScope(["a"], ten docs)` is `partial` with share 0.1, two of ten is `full`; every `STAGE_CARD` has a goal, at least one action and a gate text.

- [ ] Tests failing → implemented → checks pass → commit `14.1 process state machine` (and the phase 14 rows)

### Task 14.2: The mode switch and the profile

**Files:** Create `src/main/handlers/process.ts`. Modify `src/core/process.ts`, `src/shared/api.ts`, `src/main/api.ts`. Test `test/14.2-process-mode.test.ts`.

**Interfaces — produces:**

```ts
export const PROCESS_META = "process";
export function readProcess(store: ProjectStore): ProcessState | null;
export function writeProcess(store: ProjectStore, s: ProcessState, by: Who): void; // logs "process.<what>"
export function docTypeFromProfile(p: Profile): DocType; // from the confirmed `procedure` fact; "buvprojekts" when unknown
"process.get": (projectId: string) => ProcessState | null;
"process.setMode": (projectId: string, mode: "cowork" | "process") => ProcessState;
"process.setProfile": (projectId: string, p: { docType?: DocType; depth?: Partial<Record<Stage, Depth>>; agents?: string[]; why: string }) => ProcessState;
```

First switch to `process` makes the initial state from the project's profile facts and the agents that exist; switching back to `cowork` keeps everything else. `agents` must contain `bpv` and name existing agent ids. Every profile change needs a `why` and is appended to `profile.changes`.

**Tests:** no state before the first switch; `setMode("process")` on a project whose `procedure` fact says paskaidrojuma raksts gives that doc type and its depth row; back to `cowork` and again to `process` keeps stage and gates; `setProfile` without `why` is refused; an unknown agent id is refused; removing `bpv` is refused.

- [ ] Tests failing → implemented → checks pass → commit `14.2 process mode and profile`

### Task 14.3: Gates

**Files:** Create `src/agent/tools/process.ts`. Modify `src/agent/tools/defs.ts`, `src/main/handlers/process.ts`, `src/core/model.ts` (`NoteType` + `"gate" | "risk" | "change"`), `src/shared/waiting.ts` use, `docs/v2-design.md` 4.2, the tool table. Test `test/14.3-gates.test.ts`.

**Interfaces — produces:**

```ts
// tools (tools server): process_status — read; process_request_gate, process_skip_stage, process_set_profile, process_review_done — run
process_request_gate { result: string[]; files: string[]; deviations: string; questions: string[]; risks: string; decisions: string[]; next: string }
export function gateSummary(s: ProcessState, project: string, a: GateArgs): string; // the template of process chapter 13, ending "Lūdzu atļauju turpināt."
"process.gate": (projectId: string, d: { approve: boolean; comment?: string; fix?: string[] }) => ProcessState; // the user only
```

`process_request_gate` is allowed only when `ctx.agent` is the stage's `LEADER` (`bpv`, or `eks` in S5); it writes a note `type: "gate"` with `gateSummary` and applies `gate.request`. `process_review_done` only by `eks` in S6. `process_skip_stage` and `process_set_profile` only by `bpv`. No tool applies `gate.approve` or `gate.return`. A waiting gate is a `gate` item in Gaida tevi; returning needs a comment.

**Tests:** a non-leader's request is refused with "Gate pieprasa tikai stadijas vadītājs (<kods>)."; the gate note text equals the template for given arguments; `process.gate` approve advances the stage and removes the item; return without comment refused; no tool name in `allTools()` can change a gate's state (asserted by listing the process tools and their effects); in `cowork` every process tool except `process_status` refuses.

- [ ] Tests failing → implemented → checks pass → commit `14.3 gates`

### Task 14.4: Task discipline in process mode

**Files:** Modify `src/core/messages.ts` (`canSend`), `src/agent/mail.ts`, `src/agent/coordinator.ts`. Test `test/14.4-process-discipline.test.ts`.

**Interfaces — produces:** `canSend`'s context gains `process?: ProcessState | null`; refusals use the code `process`.

With `process.mode === "process"`, for `kind: "task"`: the sender must be the stage's leader; the recipient must be in `profile.agents`; `task.stage` must equal the current stage; no task while a gate is `waiting` or the stage is `escalated`; `task.iteration` over 3 is `iterations` and writes a question to the user. `ask` and `reply` between agents of the profile are free (process 7.3), under the topic limit. A message to an agent outside the profile is refused for every kind. In `cowork` none of this applies.

**Tests:** each rule above with its Latvian reason; the same messages in `cowork` pass; S5: `eks` may send a task, `bpv` may not; an agent outside the profile cannot be written to; with a gate waiting a task is refused and an `ask` passes.

- [ ] Tests failing → implemented → checks pass → commit `14.4 process discipline`

### Task 14.5: The status page and the registers

**Files:** Modify `src/core/process.ts`, `src/agent/agents.ts` (`standingFor` gets `processCard`, `status`), `src/agent/thread-runner.ts`, `src/main/handlers/process.ts`. Test `test/14.5-status-registers.test.ts`.

**Interfaces — produces:**

```ts
export function statusText(s: ProcessState, i: { notes: readonly Note[]; open: readonly Message[]; now: string }, maxChars = 3000): string; // stage, iteration, waiting gate, open questions (id, to, title), open tasks (id, agent), newest first, cut at whole lines
export function stageCard(stage: Stage): string;
export function exportRegisters(store: ProjectStore, dir: string, s: ProcessState): string[]; // writes lemumu_zurnals.md, jautajumu_zurnals.md, risku_registrs.md, izmainu_zurnals.md, projekta_statuss.md, gate_Hx.md; returns the paths
"process.export": (projectId: string) => string[]; // into <project data>\export\00_vadiba
```

Decision and question notes are numbered `L-<n>` / `J-<n>` by their order in time and rendered in the formats of process 7.4 and 7.5. In process mode every agent of the profile gets `statusText` in its standing text and the stage's leader also `stageCard`; in co-work neither.

**Tests:** `statusText` stays under 3000 characters with 200 open questions and ends on a whole line; a decision note renders as

```
L-3 | 2026-11-13 | S4 | Puses: ar, bk
Temats: Pārseguma biezums
Lēmums: 220 mm asīs 1-4.
Ietekme: BK, AR
BPV pārskatīts: nē
```

`exportRegisters` writes six kinds of file inside the project's data folder and refuses a `dir` inside the office project folder (the store's guard); a co-work agent's standing text has no status.

- [ ] Tests failing → implemented → checks pass → commit `14.5 status and registers`

### Task 14.6: Ekspertīze: the wall, the remarks, the 10% rule

**Files:** Modify `src/core/expertise.ts`, `src/agent/tools/expert.ts`, `src/agent/tools/process.ts`, `src/core/messages.ts`, `src/agent/thread-runner.ts` (the S5 block in the run's gate). Test `test/14.6-ekspertize.test.ts`.

**Interfaces — produces:** `ExpertRemark.class?: "K" | "B" | "I"`; `expert_add` takes `class`; `process_review_scope { changed: string[] }` (read) returns `reviewScope` against the delivery draft's items; the `eks` agent's shipped spec values: `acceptsFrom: []` except replies, `mayMessage` = the profile's section authors, no `read_notes` of types `decision` / `question` that are not its own.

In S5: `eks` may `ask` an author; the author's `reply` reaches it; nobody else can write to `eks`; each such question and answer is also a `question` note marked `agent: "eks"`. Authors' write tools on project data are refused during S5 ("S5 laikā sadaļas autors nelabo projektu.") through the gate of their runs. The H5 decision's `fix` list holds remark ids; S6 tasks carry them.

**Tests:** a message from `bpv` to `eks` is refused (`acl`); `eks` → `ar` `ask` passes and `ar`'s reply arrives; in S5 `ar`'s `set_fact` is blocked with the text above, in S4 it is not; `expert_add` with `class: "K"` stores it and the fix list groups by class; `process_review_scope` with 1 of 10 changed says `partial`, 2 of 10 `full`.

- [ ] Tests failing → implemented → checks pass → commit `14.6 ekspertīze in process mode`

### Task 14.7: Changes and learning

**Files:** Modify `src/main/handlers/process.ts`, `src/agent/tools/process.ts`, `src/agent/coordinator.ts`. Test `test/14.7-change-learning.test.ts`.

**Interfaces — produces:** `"process.change": (projectId: string, text: string) => Note` (the user records a client change: a note `type: "change"`, and a message to `bpv`); tool `process_change_impact { noteId, basic: boolean, sections: string[], note: string }` (run, `bpv` only) applies the `change` event; `"process.learn": (projectId: string) => { asked: string[] }`.

After H7 is approved the stage is `mācības`: `process.learn` sends each agent of the profile one task "Ieraksti mācības" whose result is a proposal to the office memory under its own agent id (13.4); when the user has gone through the proposals they press "Pabeigt", which applies `learned`.

**Tests:** a change in S4 judged basic moves the state to S3 and is listed in the next gate summary's deviations; a non-basic one stays in S4; `process.learn` before H7 is refused; after it, one task per profile agent is queued and the lessons arrive as proposals, none standing.

- [ ] Tests failing → implemented → checks pass → commit `14.7 changes, learning`

### Task 14.8: Process UI

**Files:** Create `src/renderer/shell/ProcessStrip.tsx`. Modify `src/renderer/panels/Parskats.tsx`, `src/renderer/shell/Waiting.tsx`, `src/renderer/state.ts`.

Build: on Pārskats a switch "Darba režīms: Kopdarbs / Process" with the profile editor (document type, depth per stage, agents on; a reason is asked on every change); a strip in the chat with the seven stages, the current one, its iteration "2 no 3" and the waiting gate; the gate card in Gaida tevi with the summary, Apstiprināt / Atgriezt (comment required) and for H5 the remark list with ticks; "Eksportēt reģistrus"; "Klienta izmaiņa"; after H7 "Mācības".

**Done when:** the user switches a small project to Process, answers H1, sees S2 skipped or run by the profile, and approves H3; a second project stays in Kopdarbs and shows none of it.

- [ ] Implemented → checks pass → commit `14.8 process UI`

---

## What this plan does not build

From the design's non-goals and open questions: the agents themselves (turning the office's 16 role texts and the extra roles into tested agents), **the content of the 120 skills** (filling their 109 placeholders, checking the test examples, and giving agents the tools some skills assume: task 13.6 only stores, gates and assigns them), scheduled or always-on runs, the final page layout, and the office's `00_vadiba … 09_macibas` folder tree as a place of work (only the export of 14.5).

## Questions for the office (they block no task; the plan follows the process document where the texts differ)

1. **Three formats for the same thing.** A task is `UZDEVUMS: <ID> | Stadija …` in the process (7.1) and `UZDEVUMS Nr. …-U-…` with scope, interfaces and deliverables in the skill `uzdevumu-sadale-agentiem`. A decision is `L-<nr> | …` in the process (7.4), a `VIENOŠANĀS Nr. …-V-…` report in the skill `vienosanas-zinojums`, and an XLSX with eleven columns in the skill `lemumu-zurnals`. The plan renders the process formats (tasks 12.1, 14.5); the richer content of the skills goes in the message text until one format is chosen.
2. **Skills that assume tools the agents do not have.** `revit-darbs` asks for worksets, Synchronize with Central, Copy/Monitor, Purge and Audit; the app's Revit tools are the create and modify allow-list and the named commands, on a working copy only, and never `send_code_to_revit`.
3. **Who confirms an agreement.** The skill wants the second agent to answer "Apstiprinu" and every fire-safety agreement confirmed by the ugunsdrošības speciālists; the plan's `close_topic` is one party's call. A two-party confirmation can be added to task 12.3 if the office wants it.
