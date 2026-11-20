// The task popup of the calendar (BIM Crew: components/calendar/TaskEditor.tsx): a small window that opens where you clicked, so
// the calendar stays in view while you edit. Creating collects everything and saves once ("Izveidot"); editing saves each field
// as you leave it, and says so. Escape or a click outside closes it. The fields are the ones a task keeps: title, first day
// ("Datums"), last day ("Līdz", for a task that lasts), priority, assignee, status, notes, a checklist. BIM Crew's reminder,
// repeat and time of day are left out: nothing in this app sends a reminder, repeats a task or plans by the hour.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChecklistItem, Task, TaskPriority } from "../../core/model";
import type { Handlers } from "../../shared/api";
import { call, errText } from "../bridge";
import { tr } from "../i18n";

type TaskPatchInput = Parameters<Handlers["todos.update"]>[2];

export type PopupTarget = { mode: "create"; projectId: string; date: string; x: number; y: number } | { mode: "edit"; projectId: string; task: Task; x: number; y: number };

const PRIORITIES: { id: TaskPriority; label: string }[] = [
	{ id: "low", label: tr("Zema") },
	{ id: "normal", label: tr("Parasta") },
	{ id: "high", label: tr("Augsta") },
];
const WIDTH = 400;

const Labeled = ({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) => (
	<label className={`tp-field ${className ?? ""}`}>
		<span className="tp-label">{label}</span>
		{children}
	</label>
);

export function TaskPopup({ target, onClose, onChanged }: { target: PopupTarget; onClose: () => void; onChanged: () => void }) {
	const creating = target.mode === "create";
	const pid = target.projectId;
	// the task as it is saved (edit) or as it is being written (create)
	const [task, setTask] = useState<Task | null>(target.mode === "edit" ? target.task : null);
	const [title, setTitle] = useState(target.mode === "edit" ? target.task.title : "");
	const [date, setDate] = useState(target.mode === "create" ? target.date : (target.task.start ?? target.task.due ?? ""));
	const [until, setUntil] = useState(target.mode === "edit" && target.task.start ? (target.task.due ?? "") : "");
	const [priority, setPriority] = useState<TaskPriority>(target.mode === "edit" ? (target.task.priority ?? "normal") : "normal");
	const [assignee, setAssignee] = useState(target.mode === "edit" ? (target.task.assignee ?? "") : "");
	const [note, setNote] = useState(target.mode === "edit" ? (target.task.note ?? "") : "");
	const [checklist, setChecklist] = useState<ChecklistItem[]>(target.mode === "edit" ? (target.task.checklist ?? []) : []);
	const [newItem, setNewItem] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ left: target.x + 12, top: target.y - 24 });

	// near the click, and never off the screen
	useLayoutEffect(() => {
		const h = box.current?.offsetHeight ?? 0;
		setPos({ left: Math.max(8, Math.min(target.x + 12, window.innerWidth - WIDTH - 8)), top: Math.max(8, Math.min(target.y - 24, window.innerHeight - h - 8)) });
	}, [target.x, target.y, checklist.length, note]);
	useEffect(() => {
		const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && onClose();
		document.addEventListener("keydown", key);
		document.addEventListener("mousedown", away);
		return () => {
			document.removeEventListener("keydown", key);
			document.removeEventListener("mousedown", away);
		};
	}, [onClose]);

	/** edit: one field, saved now; the popup shows what the store answered */
	const patch = (p: TaskPatchInput) => {
		if (!task) return;
		setErr(null);
		call("todos.update", pid, task.id, p)
			.then((t) => {
				setTask(t);
				setSaved(true);
				onChanged();
			})
			.catch((e) => setErr(errText(e)));
	};
	const setDates = (start: string, end: string) => {
		// the last day is never before the first; a task that is one day has no "start"
		const due = end && end >= start ? end : start;
		patch({ start: start === due ? null : start, due });
	};

	const create = () => {
		const t = title.trim();
		if (t.length < 2) return setErr(tr("Uzdevumam vajag nosaukumu."));
		const due = until && until >= date ? until : date;
		setErr(null);
		call("todos.add", pid, { title: t, start: date === due ? null : date, due, priority, assignee: assignee.trim() || null, checklist, note: note.trim() || undefined })
			.then(() => {
				onChanged();
				onClose();
			})
			.catch((e) => setErr(errText(e)));
	};
	const saveChecklist = (next: ChecklistItem[]) => {
		setChecklist(next);
		if (!creating) patch({ checklist: next });
	};
	const addItem = () => {
		const text = newItem.trim();
		if (!text) return;
		setNewItem("");
		saveChecklist([...checklist, { id: `c_${Date.now().toString(36)}`, text, done: false }]);
	};
	const remove = () => {
		if (!task) return;
		call("todos.remove", pid, task.id)
			.then(() => {
				onChanged();
				onClose();
			})
			.catch((e) => setErr(errText(e)));
	};
	const done = task?.state === "done";

	return (
		<div
			ref={box}
			className="task-popup"
			role="dialog"
			aria-label={creating ? tr("Jauns uzdevums") : tr("Uzdevums")}
			style={{ left: pos.left, top: pos.top, width: WIDTH }}
			onKeyDown={(e) => {
				if (e.key === "Enter" && creating && (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).dataset.role === "title") {
					e.preventDefault();
					create();
				}
			}}
		>
			<div className="tp-head">
				<b>{creating ? tr("Jauns uzdevums") : tr("Uzdevums")}</b>
				{task?.state === "proposed" && <span className="badge info">{tr("aģenta piedāvājums")}</span>}
				<span className="grow" />
				<button className="ghost small" onClick={onClose} aria-label={tr("Aizvērt")}>
					×
				</button>
			</div>
			<input
				className={`tp-title ${err && title.trim().length < 2 ? "bad" : ""}`}
				data-role="title"
				placeholder={tr("Nosaukums")}
				autoFocus={creating}
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				onBlur={() => !creating && title.trim() !== task?.title && (title.trim().length >= 2 ? patch({ title: title.trim() }) : setTitle(task?.title ?? ""))}
				onKeyDown={(e) => e.key === "Enter" && !creating && (e.target as HTMLInputElement).blur()}
			/>
			<div className="tp-grid2">
				<Labeled label={tr("Datums")}>
					<input
						type="date"
						value={date}
						onChange={(e) => {
							const v = e.target.value;
							if (!v) return;
							setDate(v);
							if (until && until < v) setUntil(v);
							if (!creating) setDates(v, until);
						}}
					/>
				</Labeled>
				<Labeled label={tr("Līdz (ja ilgst)")}>
					<input
						type="date"
						min={date || undefined}
						value={until}
						onChange={(e) => {
							const v = e.target.value;
							setUntil(v);
							if (!creating) setDates(date, v);
						}}
					/>
				</Labeled>
			</div>
			<div className="tp-grid2">
				<Labeled label={tr("Prioritāte")}>
					<span className="seg">
						{PRIORITIES.map((p) => (
							<button
								key={p.id}
								type="button"
								className={priority === p.id ? "on" : ""}
								onClick={() => {
									setPriority(p.id);
									if (!creating) patch({ priority: p.id });
								}}
							>
								{p.label}
							</button>
						))}
					</span>
				</Labeled>
				<Labeled label={tr("Izpildītājs")}>
					<input placeholder={tr("Kurš to dara")} value={assignee} onChange={(e) => setAssignee(e.target.value)} onBlur={() => !creating && assignee.trim() !== (task?.assignee ?? "") && patch({ assignee: assignee.trim() || null })} />
				</Labeled>
			</div>
			{!creating && task && (
				<Labeled label={tr("Stāvoklis")} className="tp-state">
					{task.state === "proposed" ? (
						<span className="row">
							<button className="small primary" onClick={() => patch({ state: "open" })}>
								{tr("Pieņemt")}
							</button>
							<span className="dim small">{tr("Piedāvājumu vispirms pieņem.")}</span>
						</span>
					) : (
						<span className="seg">
							<button type="button" className={!done ? "on" : ""} onClick={() => done && patch({ state: "open" })}>
								{tr("Atvērts")}
							</button>
							<button type="button" className={done ? "on" : ""} onClick={() => !done && patch({ state: "done" })}>
								{tr("Pabeigts")}
							</button>
						</span>
					)}
				</Labeled>
			)}
			<Labeled label={tr("Piezīmes")} className="tp-notes">
				<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => !creating && note.trim() !== (task?.note ?? "") && patch({ note })} />
			</Labeled>
			<div className="tp-field">
				<span className="tp-label">{tr("Kontrolsaraksts")}</span>
				{checklist.map((c) => (
					<div key={c.id} className="tp-check">
						<input type="checkbox" checked={c.done} onChange={() => saveChecklist(checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)))} />
						<span className={c.done ? "done" : ""}>{c.text}</span>
						<button className="ghost small" onClick={() => saveChecklist(checklist.filter((x) => x.id !== c.id))} aria-label={tr("Noņemt")}>
							×
						</button>
					</div>
				))}
				<input
					placeholder={tr("Pievienot punktu un nospiest Enter")}
					value={newItem}
					onChange={(e) => setNewItem(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							e.stopPropagation();
							addItem();
						}
					}}
					onBlur={addItem}
				/>
			</div>
			{err && <div className="err small">{err}</div>}
			<div className="tp-foot">
				{!creating && (
					<button className="small danger" onClick={() => (confirmDelete ? remove() : (setConfirmDelete(true), setTimeout(() => setConfirmDelete(false), 3000)))}>
						{confirmDelete ? tr("Tiešām dzēst?") : tr("Dzēst")}
					</button>
				)}
				<span className="grow" />
				{creating ? (
					<>
						<button className="small" onClick={onClose}>
							{tr("Atcelt")}
						</button>
						<button className="small primary" onClick={create}>
							{tr("Izveidot")}
						</button>
					</>
				) : (
					<span className="dim small">{saved ? tr("Saglabāts") : tr("Izmaiņas saglabājas pašas")}</span>
				)}
			</div>
		</div>
	);
}
