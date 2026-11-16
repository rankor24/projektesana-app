// Telpa: the room of the agents of the open project, one line per message, agreement, pass-up and pause, oldest at the top, newest at the bottom.
// Read once from main (room.lines), then every new line is pushed (room.line). A line opens the thread it belongs to.
import { useEffect, useRef, useState } from "react";
import type { RoomLine } from "../../shared/thread-types";
import { call, on } from "../bridge";
import { windows } from "../windows";

/** Same cap as main's read: the feed never grows without end while the window stays open. */
const MAX = 300;

/** One line is one thing that happened; the push and the read can both carry it, so identity is what it says and when. */
const keyOf = (l: RoomLine) => `${l.kind}|${l.at}|${l.from ?? ""}|${l.to ?? ""}|${l.text}`;

const LABEL: Record<RoomLine["kind"], string> = { message: "ziņa", state: "stāvoklis", agreed: "vienošanās", "passed-up": "nodots tālāk", paused: "apturēts" };
const TONE: Record<RoomLine["kind"], string> = { message: "dim", state: "dim", agreed: "ok", "passed-up": "warn", paused: "bad" };

/** Lines that arrived while the read was on its way are newer than the read; each appears once. */
export function mergeLines(read: RoomLine[], pushed: RoomLine[]): RoomLine[] {
	const seen = new Set(read.map(keyOf));
	return [...read, ...pushed.filter((l) => !seen.has(keyOf(l)))].slice(-MAX);
}

export function RoomFeed({ projectId, onOpen }: { projectId: string | null; onOpen: (threadId: string) => void }) {
	const [lines, setLines] = useState<RoomLine[]>([]);
	const [err, setErr] = useState<string | null>(null);
	const endRef = useRef<HTMLDivElement>(null);

	// push first, then read: what arrives before the read comes back is kept
	useEffect(() => {
		let live = true;
		let pushed: RoomLine[] = [];
		let read = false;
		setLines([]);
		setErr(null);
		const off = on("room.line", (e) => {
			if (e.projectId !== projectId) return;
			if (!read) pushed = [...pushed, e.line];
			else setLines((ls) => mergeLines(ls, [e.line]));
		});
		call("room.lines", projectId)
			.then((list) => {
				if (!live) return;
				read = true;
				setLines(mergeLines(list, pushed));
			})
			.catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
		return () => {
			live = false;
			off();
		};
	}, [projectId]);

	useEffect(() => endRef.current?.scrollIntoView?.({ block: "end" }), [lines]);

	return (
		<div className="chat room-feed">
			{lines.length === 0 && <div className="dim small chat-empty">{err ?? "Telpā vēl nekā nav: aģenti viens ar otru vēl nav runājuši."}</div>}
			{lines.map((l) => (
				<div key={keyOf(l)} className={`room-line ${l.threadId ? "link" : ""}`} onClick={() => l.threadId && onOpen(l.threadId)} title={l.threadId ? "Atvērt sarunu" : undefined}>
					<span className="dim small room-time">{new Date(l.at).toLocaleTimeString("lv-LV", { hour: "2-digit", minute: "2-digit" })}</span>
					<span className={`badge ${TONE[l.kind]}`}>{LABEL[l.kind]}</span>
					<span className="room-text">{l.text}</span>
					{l.noteId && (
						<button
							className="ghost small"
							title="Atvērt Atmiņu (tur ir šī vienošanās vai jautājums)"
							onClick={(e) => {
								e.stopPropagation();
								windows.open("atmina");
							}}
						>
							Atmiņa
						</button>
					)}
				</div>
			))}
			<div ref={endRef} />
		</div>
	);
}
