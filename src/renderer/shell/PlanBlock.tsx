// The block above the chat input (task 9.2): Plāns (the order of work: the agent writes it with update_plan, the user ticks,
// edits, adds, drags and removes steps and his version wins), Uzdevumi (the 8.5 tasks, proposed ones first, Pieņemt / Noraidīt
// in place) and Piezīmes (a quick note that becomes an Atmiņa note). It folds to one line ("Plāns · 2/4").
// BIM Crew reference: Chat.tsx (the plan block above the input).
import { useState } from "react";
import type { NoteType, Task } from "../../core/model";
import { addStep, editText, moveStep, planProgress, removeStep, setState, STATE_LABEL, tick, type PlanStep } from "../../shared/plan";
import { call, errText } from "../bridge";
import { useLoad } from "../ui";

type Tab = "plan" | "tasks" | "notes";
const NOTE_TYPE: Record<NoteType, string> = { decision: "lēmums", answer: "atbilde", learning: "mācība", question: "jautājums", gate: "gate", risk: "risks", change: "izmaiņa" };
const newStepId = () => `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function PlanBlock({ projectId }: { projectId: string | null }) {
	const [tab, setTab] = useState<Tab>("plan");
	const [folded, setFolded] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const plan = useLoad(() => (projectId ? call("plan.get", projectId) : Promise.resolve(null)), [projectId]);
	const tasks = useLoad(() => (projectId ? call("todos.list", projectId) : Promise.resolve([] as Task[])), [projectId]);
	const steps = plan.data?.steps ?? [];
	const prog = planProgress(steps);
	const proposed = (tasks.data ?? []).filter((t) => t.state === "proposed");
	if (!projectId) return null;

	const fail = (e: unknown) => setErr(errText(e));
	const save = (next: PlanStep[]) => {
		setErr(null);
		return call("plan.set", projectId, next).then(() => plan.reload()).catch(fail);
	};

	return (
		<div className="plan-block">
			<div className="plan-head">
				<button className="ghost small" onClick={() => setFolded(!folded)} title={folded ? "Atvērt" : "Sakļaut līdz vienai rindai"}>
					{folded ? "▸" : "▾"} {prog.line}
				</button>
				{folded && prog.doing && <span className="dim small plan-doing">→ {prog.doing.text}</span>}
				{!folded && (
					<div className="tabs plan-tabs">
						<button className={tab === "plan" ? "on" : ""} onClick={() => setTab("plan")}>Plāns</button>
						<button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>
							Uzdevumi{proposed.length ? ` (${proposed.length} gaida)` : ""}
						</button>
						<button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>Piezīmes</button>
					</div>
				)}
			</div>
			{!folded && (
				<div className="plan-body">
					{err && <div className="err">{err}</div>}
					{tab === "plan" && <StepsTab steps={steps} pending={!!plan.data?.pending} by={plan.data?.by} onSave={save} />}
					{tab === "tasks" && <TasksTab projectId={projectId} tasks={tasks.data ?? []} reload={tasks.reload} onErr={fail} />}
					{tab === "notes" && <NotesTab projectId={projectId} onErr={fail} />}
				</div>
			)}
		</div>
	);
}

function StepsTab({ steps, pending, by, onSave }: { steps: PlanStep[]; pending: boolean; by?: string; onSave: (s: PlanStep[]) => void }) {
	const [draft, setDraft] = useState("");
	const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
	const [dragId, setDragId] = useState<string | null>(null);
	return (
		<div className="plan-steps">
			{steps.length === 0 && <div className="dim small">Plāna vēl nav. Aģents to uzrakstīs daudzsoļu darbam; vari rakstīt arī pats.</div>}
			{steps.map((s, i) => (
				<div
					key={s.id}
					className={`plan-step ${s.state}`}
					draggable
					onDragStart={() => setDragId(s.id)}
					onDragOver={(e) => dragId && e.preventDefault()}
					onDrop={() => dragId && dragId !== s.id && (onSave(moveStep(steps, dragId, i)), setDragId(null))}
					onDragEnd={() => setDragId(null)}
				>
					<input type="checkbox" checked={s.state === "done"} onChange={() => onSave(tick(steps, s.id))} title={STATE_LABEL[s.state]} />
					{editing?.id === s.id ? (
						<input
							autoFocus
							className="grow"
							value={editing.text}
							onChange={(e) => setEditing({ id: s.id, text: e.target.value })}
							onBlur={() => (onSave(editText(steps, s.id, editing.text)), setEditing(null))}
							onKeyDown={(e) => {
								if (e.key === "Enter") (e.target as HTMLInputElement).blur();
								if (e.key === "Escape") setEditing(null);
							}}
						/>
					) : (
						<span className="grow plan-text" onDoubleClick={() => setEditing({ id: s.id, text: s.text })} title="Dubultklikšķis — labot">
							{s.state === "doing" && "→ "}
							{s.state === "blocked" && "! "}
							{s.text}
						</span>
					)}
					<button className="ghost small" title={s.state === "doing" ? "Atcelt «darbā»" : "Atzīmēt kā darbā"} onClick={() => onSave(setState(steps, s.id, s.state === "doing" ? "todo" : "doing"))}>
						→
					</button>
					<button className="ghost small" title={s.state === "blocked" ? "Atcelt «iestrēdzis»" : "Atzīmēt kā iestrēgušu"} onClick={() => onSave(setState(steps, s.id, s.state === "blocked" ? "todo" : "blocked"))}>
						!
					</button>
					<button className="ghost small" title="Uz augšu" disabled={i === 0} onClick={() => onSave(moveStep(steps, s.id, i - 1))}>
						↑
					</button>
					<button className="ghost small" title="Uz leju" disabled={i === steps.length - 1} onClick={() => onSave(moveStep(steps, s.id, i + 1))}>
						↓
					</button>
					<button className="ghost small danger" title="Noņemt soli" onClick={() => onSave(removeStep(steps, s.id))}>
						×
					</button>
				</div>
			))}
			<div className="row">
				<input
					className="grow"
					placeholder="jauns solis…"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && draft.trim().length >= 2) (onSave(addStep(steps, draft, newStepId())), setDraft(""));
					}}
				/>
				{steps.length > 0 && (
					<button className="ghost small" onClick={() => onSave([])}>
						notīrīt
					</button>
				)}
			</div>
			{pending && <div className="dim small">Tavs saraksts ir spēkā; aģents to redzēs nākamajā ziņā.</div>}
			{!pending && by === "agent" && steps.length > 0 && <div className="dim small">Plānu uzrakstīja aģents.</div>}
		</div>
	);
}

function TasksTab({ projectId, tasks, reload, onErr }: { projectId: string; tasks: Task[]; reload: () => void; onErr: (e: unknown) => void }) {
	const [draft, setDraft] = useState("");
	const act = (p: Promise<unknown>) => p.then(reload).catch(onErr);
	const open = tasks.filter((t) => t.state === "open");
	const proposed = tasks.filter((t) => t.state === "proposed");
	return (
		<div className="plan-steps">
			{proposed.map((t) => (
				<div key={t.id} className="plan-step proposed">
					<span className="chip">piedāvājums</span>
					<span className="grow plan-text" title={t.note}>
						{t.title}
						{t.due ? ` · līdz ${t.due}` : ""}
					</span>
					<button className="small primary" onClick={() => act(call("todos.update", projectId, t.id, { state: "open" }))}>Pieņemt</button>
					<button className="small ghost" onClick={() => act(call("todos.remove", projectId, t.id))}>Noraidīt</button>
				</div>
			))}
			{open.map((t) => (
				<div key={t.id} className="plan-step">
					<input type="checkbox" checked={false} onChange={() => act(call("todos.update", projectId, t.id, { state: "done" }))} title="Pabeigts" />
					<span className="grow plan-text" title={t.note}>
						{t.title}
						{t.due ? ` · līdz ${t.due}` : ""}
					</span>
					<button className="ghost small danger" title="Noņemt" onClick={() => act(call("todos.remove", projectId, t.id))}>×</button>
				</div>
			))}
			{proposed.length + open.length === 0 && <div className="dim small">Uzdevumu nav.</div>}
			<div className="row">
				<input className="grow" placeholder="jauns uzdevums…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && draft.trim().length >= 2 && act(call("todos.add", projectId, { title: draft.trim() })).then(() => setDraft(""))} />
			</div>
		</div>
	);
}

function NotesTab({ projectId, onErr }: { projectId: string; onErr: (e: unknown) => void }) {
	const [text, setText] = useState("");
	const [type, setType] = useState<NoteType>("answer");
	const [saved, setSaved] = useState(false);
	const save = () => {
		const body = text.trim();
		if (body.length < 2) return;
		const title = body.split(/\n/)[0].slice(0, 60);
		call("notes.write", projectId, type, title, body)
			.then(() => (setText(""), setSaved(true)))
			.catch(onErr);
	};
	return (
		<div className="plan-steps">
			<textarea rows={2} placeholder="ātra piezīme — kļūs par Atmiņas ierakstu" value={text} onChange={(e) => (setText(e.target.value), setSaved(false))} />
			<div className="row">
				<select value={type} onChange={(e) => setType(e.target.value as NoteType)}>
					{(["decision", "answer", "learning", "question"] as NoteType[]).map((t) => (
						<option key={t} value={t}>
							{NOTE_TYPE[t]}
						</option>
					))}
				</select>
				<button className="small primary" disabled={text.trim().length < 2} onClick={save}>Saglabāt Atmiņā</button>
				{saved && <span className="dim small">saglabāts</span>}
			</div>
		</div>
	);
}
