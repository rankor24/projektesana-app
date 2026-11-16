// The room (Telpa): the mailbox, read as one line per message, agreement, pass-up and pause. Pure; the main process hands in what it read, the window draws the lines.
import type { Message, Topic } from "./message-types.js";
import type { RoomLine, Thread, Wave } from "./thread-types.js";

/** How much of a message a line shows. */
const CUT = 120;

/** What the lines are made from. `names` maps an agent id to the name shown (an id with no name shows as itself); `waves` are those of the open project. */
export interface RoomInput {
	messages: readonly Message[];
	topics: readonly Topic[];
	threads: readonly Thread[];
	names?: Record<string, string>;
	waves?: readonly Wave[];
}

const nameOf = (id: string, names?: Record<string, string>) => names?.[id] ?? id;
const titleOf = (id: string, topics: readonly Topic[]) => topics.find((t) => t.id === id)?.title ?? id;

/** One line of text: blanks and line breaks are one space, cut by characters (not UTF-16 halves). */
const oneLine = (s: string) => [...s.replace(/\s+/g, " ").trim()].slice(0, CUT).join("");

/** What a line shows of a message. A task is shown by its goal. A reply that says "izpildīts" by its status; one that says "bloķēts" or "daļēji" by its text,
 *  because the text holds the reason or the answer itself and the bare status would hide it. */
function bodyOf(m: Message): string {
	if (m.task) return m.task.goal;
	if (m.reply && (m.reply.status === "izpildīts" || !m.text.trim())) return m.reply.status;
	return m.text;
}

/** The line of one message. */
export function messageLine(m: Message, topics: readonly Topic[], names?: Record<string, string>): RoomLine {
	const title = titleOf(m.topic, topics);
	const body = oneLine(bodyOf(m));
	return { at: m.at, kind: "message", from: m.from, to: m.to, topic: title, text: `${nameOf(m.from, names)} → ${nameOf(m.to, names)} · ${title}: ${body}`, threadId: m.toThread };
}

/** The line of a topic that was closed; null for one that is still open. It opens the thread that carries the topic, else the one its last message went to. */
export function topicLine(t: Topic, messages: readonly Message[], threads: readonly Thread[], names?: Record<string, string>): RoomLine | null {
	if (t.state === "open") return null;
	const threadId = threads.find((x) => x.topic === t.id)?.id ?? messages.findLast((m) => m.topic === t.id)?.toThread;
	const at = t.closedAt ?? t.openedAt;
	const base = { at, topic: t.title, threadId, noteId: t.noteId };
	if (t.state === "agreed") {
		const [a, b] = t.parties;
		return { ...base, kind: "agreed", from: a, to: b, text: `${nameOf(a, names)} ↔ ${nameOf(b, names)} vienojās: ${t.title}` };
	}
	return { ...base, kind: "passed-up", text: `${t.title} nodots tālāk` };
}

const LIMIT = { runs: "skrējienu limits", cost: "izmaksu limits" } as const;

/** A wave that stopped at a limit. The window has no time for the pause, so it stands where the wave's last message stands (the limit was met by it), or at the wave's start. */
function pausedLine(w: Wave, messages: readonly Message[]): RoomLine {
	const last = messages.filter((m) => m.wave === w.id).reduce((at, m) => (m.at > at ? m.at : at), w.startedAt);
	return { at: last, kind: "paused", text: `Vilnis apturēts: ${LIMIT[w.paused!]}` };
}

/** The room, oldest first, the newest `max` lines. Lines of one moment keep this order: message, closed topic, pause. */
export function roomLines(i: RoomInput, max = 300): RoomLine[] {
	if (!(max > 0)) return [];
	const lines: RoomLine[] = [
		...i.messages.map((m) => messageLine(m, i.topics, i.names)),
		...i.topics.map((t) => topicLine(t, i.messages, i.threads, i.names)).filter((l): l is RoomLine => !!l),
		...(i.waves ?? []).filter((w) => w.paused).map((w) => pausedLine(w, i.messages)),
	];
	// a stable sort on the time: equal times keep the order above
	lines.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
	return lines.slice(-max);
}
