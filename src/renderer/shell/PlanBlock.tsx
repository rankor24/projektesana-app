// The checklist on top of the chat input (task 9.2, redrawn): "Uzdevumi 2/4". The agent writes the steps with update_plan, the user
// ticks, edits (double click), drags, adds and removes them and his version wins. It folds to one line with the step in work.
// Proposed tasks (8.5) show in the same list with Pieņemt / Noraidīt. The quick note (it becomes an Atmiņa note) moved to
// the Telpa tab: NoteBox below. BIM Crew reference: Chat.tsx (the plan block above the input).
import { useRef, useState } from "react";
import type { NoteType, Task } from "../../core/model";
import { addStep, editText, moveStep, planProgress, removeStep, setState, STATE_LABEL, tick, type PlanStep } from "../../shared/plan";
import { call, errText } from "../bridge";
import { Icon, type IconName } from "../icons";
import { useLoad } from "../ui";
import { tr } from "../i18n";

const NOTE_TYPE: Record<NoteType, string> = { decision: tr("lēmums"), answer: tr("atbilde"), learning: tr("mācība"), question: tr("jautājums"), gate: tr("gate"), risk: tr("risks"), change: tr("izmaiņa") };
const MARK: Record<PlanStep["state"], IconName> = { todo: "circle", doing: "circleProgress", done: "circleCheck", blocked: "alert" };
const newStepId = () => `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function PlanBlock({ projectId }: { projectId: string | null }) {
	/** null = follows the content: folded while there is nothing in the list, open as soon as there is */
	const [fold, setFold] = useState<boolean | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
	const [dragId, setDragId] = useState<string | null>(null);
	const addRef = useRef<HTMLInputElement>(null);
	const plan = useLoad(() => (projectId ? call("plan.get", projectId) : Promise.resolve(null)), [projectId]);
	const todos = useLoad(() => (projectId ? call("todos.list", projectId) : Promise.resolve([] as Task[])), [projectId]);
	const steps = plan.data?.steps ?? [];
	const prog = planProgress(steps);
	const proposed = (todos.data ?? []).filter((t) => t.state === "proposed");
	if (!projectId) return null;

	const folded = fold ?? (steps.length === 0 && proposed.length === 0);
	const fail = (e: unknown) => setErr(errText(e));
	const save = (next: PlanStep[]) => {
		setErr(null);
		return call("plan.set", projectId, next).then(() => plan.reload()).catch(fail);
	};
	const decide = (p: Promise<unknown>) => p.then(() => todos.reload()).catch(fail);
	const openAdd = () => {
		setFold(false);
		setTimeout(() => addRef.current?.focus(), 0);
	};
	const add = () => {
		if (draft.trim().length < 2) return;
		void save(addStep(steps, draft, newStepId()));
		setDraft("");
	};

	return (
		<div className={`tasks ${folded ? "folded" : ""}`}>
			<div className="tasks-head">
				<button className="tasks-toggle" aria-expanded={!folded} onClick={() => setFold(!folded)} title={folded ? tr("Atvērt") : tr("Sakļaut līdz vienai rindai")}>
					<Icon name="chevronDown" size={14} />
					<b>{tr("Uzdevumi")}</b>
					{steps.length > 0 && (
						<span className="tasks-count">
							{prog.done}/{prog.total}
						</span>
					)}
					{folded && prog.doing && <span className="tasks-doing">· {prog.doing.text}</span>}
					{proposed.length > 0 && <span className="chip">{tr("{length} gaida", { length: proposed.length })}</span>}
				</button>
				<button className="icon-btn" title={tr("Pievienot uzdevumu")} aria-label={tr("Pievienot uzdevumu")} onClick={openAdd}>
					<Icon name="plus" />
				</button>
			</div>
			{!folded && (
				<div className="tasks-body">
					{err && <div className="err">{err}</div>}
					{proposed.map((t) => (
						<div key={t.id} className="task">
							<span className="chip">{tr("piedāvājums")}</span>
							<span className="task-text" title={t.note}>
								{t.title}
								{t.due ? tr(" · līdz {due}", { due: t.due }) : ""}
							</span>
							<button className="small primary" onClick={() => decide(call("todos.update", projectId, t.id, { state: "open" }))}>{tr("Pieņemt")}</button>
							<button className="small ghost" onClick={() => decide(call("todos.remove", projectId, t.id))}>{tr("Noraidīt")}</button>
						</div>
					))}
					{steps.length === 0 && proposed.length === 0 && <div className="dim small">{tr("Plāna vēl nav. Aģents to uzrakstīs daudzsoļu darbam; vari rakstīt arī pats.")}</div>}
					{steps.map((s, i) => (
						<div
							key={s.id}
							className={`task ${s.state}`}
							draggable
							onDragStart={() => setDragId(s.id)}
							onDragOver={(e) => dragId && e.preventDefault()}
							onDrop={() => dragId && dragId !== s.id && (void save(moveStep(steps, dragId, i)), setDragId(null))}
							onDragEnd={() => setDragId(null)}
						>
							<button className="task-mark" title={tr(STATE_LABEL[s.state])} aria-label={tr(STATE_LABEL[s.state])} onClick={() => save(tick(steps, s.id))}>
								<Icon name={MARK[s.state]} size={16} />
							</button>
							{editing?.id === s.id ? (
								<input
									autoFocus
									className="grow"
									value={editing.text}
									onChange={(e) => setEditing({ id: s.id, text: e.target.value })}
									onBlur={() => (void save(editText(steps, s.id, editing.text)), setEditing(null))}
									onKeyDown={(e) => {
										if (e.key === "Enter") (e.target as HTMLInputElement).blur();
										if (e.key === "Escape") setEditing(null);
									}}
								/>
							) : (
								<span className="task-text" onDoubleClick={() => setEditing({ id: s.id, text: s.text })} title={`${s.text}\n${tr("Dubultklikšķis — labot")}`}>
									{s.text}
								</span>
							)}
							<span className="task-acts">
								<button title={s.state === "doing" ? tr("Atcelt «darbā»") : tr("Atzīmēt kā darbā")} onClick={() => save(setState(steps, s.id, s.state === "doing" ? "todo" : "doing"))}>
									<Icon name="play" size={13} />
								</button>
								<button title={s.state === "blocked" ? tr("Atcelt «iestrēdzis»") : tr("Atzīmēt kā iestrēgušu")} onClick={() => save(setState(steps, s.id, s.state === "blocked" ? "todo" : "blocked"))}>
									<Icon name="alert" size={14} />
								</button>
								<button className="danger" title={tr("Noņemt soli")} onClick={() => save(removeStep(steps, s.id))}>
									<Icon name="x" size={14} />
								</button>
							</span>
						</div>
					))}
					<label className="task-add">
						<Icon name="plus" size={16} />
						<input ref={addRef} placeholder={tr("jauns solis…")} aria-label={tr("Pievienot uzdevumu")} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
						{steps.length > 0 && (
							<button type="button" className="ghost small" onClick={() => save([])}>
								{tr("notīrīt")}
							</button>
						)}
					</label>
					{plan.data?.pending && <div className="dim small">{tr("Tavs saraksts ir spēkā; aģents to redzēs nākamajā ziņā.")}</div>}
					{!plan.data?.pending && plan.data?.by === "agent" && steps.length > 0 && <div className="dim small">{tr("Plānu uzrakstīja aģents.")}</div>}
				</div>
			)}
		</div>
	);
}

/** The quick note in the Telpa tab: the text becomes an Atmiņa note. */
export function NoteBox({ projectId }: { projectId: string }) {
	const [text, setText] = useState("");
	const [type, setType] = useState<NoteType>("answer");
	const [saved, setSaved] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const save = () => {
		const body = text.trim();
		if (body.length < 2) return;
		const title = body.split(/\n/)[0].slice(0, 60);
		call("notes.write", projectId, type, title, body)
			.then(() => (setText(""), setSaved(true)))
			.catch((e) => setErr(errText(e)));
	};
	return (
		<div className="note-box">
			{err && <div className="err">{err}</div>}
			<textarea rows={2} placeholder={tr("ātra piezīme — kļūs par Atmiņas ierakstu")} value={text} onChange={(e) => (setText(e.target.value), setSaved(false))} />
			<div className="row">
				<select value={type} onChange={(e) => setType(e.target.value as NoteType)}>
					{(["decision", "answer", "learning", "question"] as NoteType[]).map((t) => (
						<option key={t} value={t}>
							{NOTE_TYPE[t]}
						</option>
					))}
				</select>
				<button className="small primary" disabled={text.trim().length < 2} onClick={save}>{tr("Saglabāt Atmiņā")}</button>
				{saved && <span className="dim small">{tr("saglabāts")}</span>}
			</div>
		</div>
	);
}
