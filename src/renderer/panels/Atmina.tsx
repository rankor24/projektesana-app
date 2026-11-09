// Atmiņa: the project memory (replaces v1's Žurnāls). Decisions, answers, learnings and open questions, written by the user
// or by the agent (write_note), one markdown file per note. The agent reads them with read_notes.
import { useState } from "react";
import type { Note, NoteType } from "../../core/model";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";

const TYPE: Record<NoteType, string> = { decision: "lēmums", answer: "atbilde", learning: "mācība", question: "jautājums" };

export function Atmina() {
	const { projectId } = useUi();
	const notes = useLoad<Note[]>(() => (projectId ? call("notes.list", projectId) : Promise.resolve([])), [projectId]);
	const [type, setType] = useState<NoteType | "">("");
	const [draft, setDraft] = useState({ type: "decision" as NoteType, title: "", body: "" });
	const [err, setErr] = useState<string | null>(null);
	if (!projectId) return <Empty title="nav projekta" />;
	const rows = (notes.data ?? []).filter((n) => !type || n.type === type);
	return (
		<div className="pane fill">
			<div className="row">
				{(["", "decision", "answer", "learning", "question"] as const).map((t) => (
					<button key={t} className={type === t ? "primary" : ""} onClick={() => setType(t)}>
						{t ? TYPE[t] : "visi"}
					</button>
				))}
			</div>
			<div className="confirm">
				<div className="row">
					<select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as NoteType })}>
						{Object.entries(TYPE).map(([k, v]) => (
							<option key={k} value={k}>{v}</option>
						))}
					</select>
					<input className="grow" placeholder="Virsraksts" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
				</div>
				<textarea rows={3} placeholder="Teksts (markdown)" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
				<div className="row">
					<span className="grow" />
					<button
						className="primary"
						disabled={draft.title.trim().length < 3}
						onClick={() =>
							call("notes.write", projectId, draft.type, draft.title, draft.body)
								.then(() => (setDraft({ ...draft, title: "", body: "" }), notes.reload()))
								.catch((e) => setErr(errText(e)))
						}
					>
						Saglabāt
					</button>
				</div>
			</div>
			{err && <div className="err">{err}</div>}
			{notes.error ? <Err error={notes.error} /> : null}
			{rows.length === 0 && <Empty title="no data">Atmiņā vēl nav ierakstu.</Empty>}
			{rows.map((n) => (
				<div key={n.id} className="text-page">
					<div className="row">
						<Badge>{TYPE[n.type]}</Badge>
						<b className="grow">{n.title}</b>
						<span className="dim small">
							{n.by === "agent" ? "aģents" : n.by} · {new Date(n.at).toLocaleString("lv-LV")}
						</span>
						<button className="small" onClick={() => ui.focusAdd({ kind: "note", id: n.id, label: n.title, data: { type: n.type } })}>→ aģentam</button>
					</div>
					{n.body}
				</div>
			))}
		</div>
	);
}
