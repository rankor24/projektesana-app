// Atmiņa: the memory (replaces v1's Žurnāls). Two scopes (task 8.8): Projekts — this project's decisions, answers, learnings
// and open questions; Birojs — lessons that hold for every project, which the agent reads in all of them. Notes are written
// by the user or by the agent (write_note), one markdown file per note. A project note is lifted to the office with one click
// (a copy; the project's note stays); the agent can only propose an office note, and the user accepts or rejects it here.
// Notes that agents leave through close_topic (task 12.3) show who agreed with whom: an unreviewed decision can be marked seen or cancelled
// (a new decision note names it; nothing is deleted), an open question for the user can be closed.
import { useState } from "react";
import type { Note, NoteType } from "../../core/model";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";

const TYPE: Record<NoteType, string> = { decision: "lēmums", answer: "atbilde", learning: "mācība", question: "jautājums" };

export function Atmina() {
	const { projectId } = useUi();
	const [scope, setScope] = useState<"project" | "office">(projectId ? "project" : "office");
	const [type, setType] = useState<NoteType | "">("");
	const [draft, setDraft] = useState({ type: "decision" as NoteType, title: "", body: "" });
	const [err, setErr] = useState<string | null>(null);
	const [cancelling, setCancelling] = useState<{ id: string; reason: string } | null>(null);
	const office = scope === "office";
	const notes = useLoad<Note[]>(() => (office ? call("memory.list") : projectId ? call("notes.list", projectId) : Promise.resolve([])), [projectId, scope]);
	const fail = (e: unknown) => setErr(errText(e));
	const rows = (notes.data ?? []).filter((n) => !type || n.type === type);
	const proposals = rows.filter((n) => n.state === "proposed");
	const standing = rows.filter((n) => n.state !== "proposed");
	// a decision is cancelled only by a note of the user's that says so (`cancels`); an agent's note with a similar title does not count
	const cancelled = new Set((notes.data ?? []).filter((n) => n.cancels && n.by === "user").map((n) => n.cancels!));
	const act = (p: Promise<unknown>) => p.then(() => (setErr(null), notes.reload())).catch(fail);

	const save = () =>
		(office ? call("memory.write", draft.type, draft.title, draft.body) : call("notes.write", projectId!, draft.type, draft.title, draft.body))
			.then(() => (setDraft({ ...draft, title: "", body: "" }), setErr(null), notes.reload()))
			.catch(fail);

	const lift = (n: Note) => {
		if (!projectId) return;
		if (!confirm("Pacelt uz biroja atmiņu? To lasīs aģents VISOS projektos. Raksti tajā tikai to, kas der visiem projektiem, bez klientu vārdiem un adresēm. Projekta ieraksts paliek.")) return;
		call("memory.promote", projectId, n.id).then(() => setErr(null)).catch(fail);
	};

	const noteRow = (n: Note) => (
		<div key={n.id} className={`text-page ${n.state === "proposed" ? "proposed" : ""}`}>
			<div className="row">
				<Badge>{TYPE[n.type]}</Badge>
				<b className="grow">{n.title}</b>
				{n.from && <Badge tone="info" title={`Pacelts no projekta ${n.from.project}`}>no {n.from.project}</Badge>}
				{n.agent && n.to && <Badge tone="info" title="Kas ar ko">{n.agent} → {n.to}</Badge>}
				{n.type === "decision" && n.agent && n.reviewed === false && !cancelled.has(n.id) && <Badge tone="warn">nepārskatīts</Badge>}
				{cancelled.has(n.id) && <Badge>atcelts</Badge>}
				{n.type === "question" && n.status && <Badge>{n.status === "open" ? "atvērts" : "slēgts"}</Badge>}
				<span className="dim small">
					{n.by === "agent" ? "aģents" : n.by} · {new Date(n.at).toLocaleString("lv-LV")}
				</span>
				{!office && (
					<>
						<button className="small ghost" title="Pacelt uz biroja atmiņu (kopija; šis paliek)" onClick={() => lift(n)}>
							→ birojam
						</button>
						<button className="small" onClick={() => ui.focusAdd({ kind: "note", id: n.id, label: n.title, data: { type: n.type } })}>→ aģentam</button>
					</>
				)}
			</div>
			{n.body}
			{!office && projectId && n.type === "decision" && n.agent && n.reviewed === false && !cancelled.has(n.id) && (
				<div className="row" style={{ marginTop: 6 }}>
					<span className="grow" />
					<button className="small primary" onClick={() => act(call("notes.review", projectId, n.id))}>Pārskatīts</button>
					<button className="small ghost" title="Raksta jaunu lēmumu «Atcelts: …»; šis paliek" onClick={() => setCancelling({ id: n.id, reason: "" })}>Atcelt…</button>
				</div>
			)}
			{cancelling?.id === n.id && projectId && (
				<div className="row" style={{ marginTop: 6 }}>
					<input className="grow" autoFocus placeholder="Atcelšanas iemesls" value={cancelling.reason} onChange={(e) => setCancelling({ id: n.id, reason: e.target.value })} />
					<button className="small primary" disabled={!cancelling.reason.trim()} onClick={() => act(call("notes.cancel", projectId, n.id, cancelling.reason).then(() => setCancelling(null)))}>Atcelt lēmumu</button>
					<button className="small ghost" onClick={() => setCancelling(null)}>Neatcelt</button>
				</div>
			)}
			{!office && projectId && n.type === "question" && n.status === "open" && n.to === "user" && (
				<div className="row" style={{ marginTop: 6 }}>
					<span className="grow" />
					<button className="small primary" onClick={() => act(call("notes.setStatus", projectId, n.id, "closed"))}>Slēgt</button>
				</div>
			)}
			{n.state === "proposed" && (
				<div className="row" style={{ marginTop: 6 }}>
					<Badge tone="info">aģenta priekšlikums</Badge>
					<span className="dim small grow">Aģents to neredz kā atmiņu, kamēr nepieņem.</span>
					<button className="small primary" onClick={() => call("memory.decide", n.id, true).then(notes.reload).catch(fail)}>Pieņemt</button>
					<button className="small ghost" title="Fails tiek pārvietots malā, nevis dzēsts" onClick={() => call("memory.decide", n.id, false).then(notes.reload).catch(fail)}>Noraidīt</button>
				</div>
			)}
		</div>
	);

	return (
		<div className="pane fill">
			<div className="row">
				<button className={scope === "project" ? "primary" : ""} disabled={!projectId} onClick={() => setScope("project")}>Projekts{projectId ? ` ${projectId}` : ""}</button>
				<button className={scope === "office" ? "primary" : ""} onClick={() => setScope("office")} title="Mācības, kas der visiem projektiem; aģents tās lasa katrā projektā">Birojs</button>
				<span className="grow" />
				{(["", "decision", "answer", "learning", "question"] as const).map((t) => (
					<button key={t} className={type === t ? "primary" : ""} onClick={() => setType(t)}>
						{t ? TYPE[t] : "visi"}
					</button>
				))}
			</div>
			{!office && !projectId ? (
				<Empty title="nav projekta">Atver projektu vai skaties biroja atmiņu.</Empty>
			) : (
				<>
					<div className="confirm">
						<div className="row">
							<select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as NoteType })}>
								{Object.entries(TYPE).map(([k, v]) => (
									<option key={k} value={k}>{v}</option>
								))}
							</select>
							<input className="grow" placeholder={office ? "Virsraksts (noteikums, kas der visiem projektiem)" : "Virsraksts"} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
						</div>
						<textarea rows={3} placeholder="Teksts (markdown)" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
						<div className="row">
							{office && <span className="dim small">Birojs: to lasa aģents katrā projektā.</span>}
							<span className="grow" />
							<button className="primary" disabled={draft.title.trim().length < 3} onClick={save}>
								Saglabāt{office ? " birojam" : ""}
							</button>
						</div>
					</div>
					{err && <div className="err">{err}</div>}
					{notes.error ? <Err error={notes.error} /> : null}
					{proposals.map(noteRow)}
					{standing.length === 0 && proposals.length === 0 && <Empty title="no data">{office ? "Biroja atmiņā vēl nav ierakstu." : "Atmiņā vēl nav ierakstu."}</Empty>}
					{standing.map(noteRow)}
				</>
			)}
		</div>
	);
}
