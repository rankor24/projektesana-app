// Atmiņa: the memory (replaces v1's Žurnāls). Two scopes (task 8.8): Projekts — this project's decisions, answers, learnings
// and open questions; Birojs — lessons that hold for every project, which the agent reads in all of them. Notes are written
// by the user or by the agent (write_note), one markdown file per note. A project note is lifted to the office with one click
// (a copy; the project's note stays); the agent can only propose an office note, and the user accepts or rejects it here.
// Notes that agents leave through close_topic (task 12.3) show who agreed with whom: an unreviewed decision can be marked seen or cancelled
// (a new decision note names it; nothing is deleted), an open question for the user can be closed.
import { useEffect, useRef, useState } from "react";
import type { Note, NoteType } from "../../core/model";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";
import { locale, tr } from "../i18n";

const TYPE: Record<NoteType, string> = { decision: tr("lēmums"), answer: tr("atbilde"), learning: tr("mācība"), question: tr("jautājums"), gate: tr("gate"), risk: tr("risks"), change: tr("izmaiņa") };
/** what the notes form offers: the process notes are written by the process, not typed */
const TYPED: NoteType[] = ["decision", "answer", "learning", "question"];

/** `filter` = a project note's id (the room feed's Atmiņa button, task 12.5): that note is shown and scrolled to. */
export function Atmina({ filter }: { filter?: string }) {
	const { projectId } = useUi();
	const [scope, setScope] = useState<"project" | "office">(projectId ? "project" : "office");
	const [type, setType] = useState<NoteType | "">("");
	const [agent, setAgent] = useState("");
	// the note asked for: project scope, no type/agent filter hiding it
	useEffect(() => {
		if (!filter) return;
		setScope("project");
		setType("");
		setAgent("");
	}, [filter]);
	// scrolled to once per asked note, so reading further down is not pulled back on the next render
	const scrolledTo = useRef<string | null>(null);
	const scrollOnce = (el: HTMLDivElement | null) => {
		if (!el || !filter || scrolledTo.current === filter) return;
		scrolledTo.current = filter;
		el.scrollIntoView?.({ block: "center" });
	};
	const [draft, setDraft] = useState({ type: "decision" as NoteType, title: "", body: "" });
	const [err, setErr] = useState<string | null>(null);
	const [cancelling, setCancelling] = useState<{ id: string; reason: string } | null>(null);
	const office = scope === "office";
	const notes = useLoad<Note[]>(() => (office ? call("memory.list") : projectId ? call("notes.list", projectId) : Promise.resolve([])), [projectId, scope]);
	const fail = (e: unknown) => setErr(errText(e));
	// the office memory by agent (13.4): the ids that wrote a note there; a note with no agent (the user's, or older) shows under "Visi" only
	const agentIds = office ? [...new Set((notes.data ?? []).map((n) => n.agent).filter((a): a is string => !!a))].sort() : [];
	const rows = (notes.data ?? []).filter((n) => (!type || n.type === type) && (!office || !agent || n.agent === agent));
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
		if (!confirm(tr("Pacelt uz biroja atmiņu? To lasīs aģents VISOS projektos. Raksti tajā tikai to, kas der visiem projektiem, bez klientu vārdiem un adresēm. Projekta ieraksts paliek."))) return;
		call("memory.promote", projectId, n.id).then(() => setErr(null)).catch(fail);
	};

	const noteRow = (n: Note) => (
		<div
			key={n.id}
			className={`text-page ${n.state === "proposed" ? "proposed" : ""} ${!office && n.id === filter ? "focused" : ""}`}
			ref={!office && n.id === filter ? scrollOnce : undefined}
		>
			<div className="row">
				<Badge>{TYPE[n.type]}</Badge>
				<b className="grow">{n.title}</b>
				{n.from && <Badge tone="info" title={tr("Pacelts no projekta {project}", { project: n.from.project })}>{tr("no {project}", { project: n.from.project })}</Badge>}
				{n.agent && n.to && <Badge tone="info" title={tr("Kas ar ko")}>{n.agent} → {n.to}</Badge>}
				{office && n.agent && <Badge tone="info" title={tr("Šī aģenta rakstīts; pēc pieņemšanas tas to nes līdzi savā instrukcijā")}>{n.agent}</Badge>}
				{n.type === "decision" && n.agent && n.reviewed === false && !cancelled.has(n.id) && <Badge tone="warn">{tr("nepārskatīts")}</Badge>}
				{cancelled.has(n.id) && <Badge>{tr("atcelts")}</Badge>}
				{n.type === "question" && n.status && <Badge>{n.status === "open" ? tr("atvērts") : tr("slēgts")}</Badge>}
				<span className="dim small">
					{n.by === "agent" ? tr("aģents") : n.by} · {new Date(n.at).toLocaleString(locale())}
				</span>
				{!office && (
					<>
						<button className="small ghost" title={tr("Pacelt uz biroja atmiņu (kopija; šis paliek)")} onClick={() => lift(n)}>
							{tr("→ birojam")}</button>
						<button className="small" onClick={() => ui.focusAdd({ kind: "note", id: n.id, label: n.title, data: { type: n.type } })}>{tr("→ aģentam")}</button>
					</>
				)}
			</div>
			{n.body}
			{!office && projectId && n.type === "decision" && n.agent && n.reviewed === false && !cancelled.has(n.id) && (
				<div className="row" style={{ marginTop: 6 }}>
					<span className="grow" />
					<button className="small primary" onClick={() => act(call("notes.review", projectId, n.id))}>{tr("Pārskatīts")}</button>
					<button className="small ghost" title={tr("Raksta jaunu lēmumu «Atcelts: …»; šis paliek")} onClick={() => setCancelling({ id: n.id, reason: "" })}>{tr("Atcelt…")}</button>
				</div>
			)}
			{cancelling?.id === n.id && projectId && (
				<div className="row" style={{ marginTop: 6 }}>
					<input className="grow" autoFocus placeholder={tr("Atcelšanas iemesls")} value={cancelling.reason} onChange={(e) => setCancelling({ id: n.id, reason: e.target.value })} />
					<button className="small primary" disabled={!cancelling.reason.trim()} onClick={() => act(call("notes.cancel", projectId, n.id, cancelling.reason).then(() => setCancelling(null)))}>{tr("Atcelt lēmumu")}</button>
					<button className="small ghost" onClick={() => setCancelling(null)}>{tr("Neatcelt")}</button>
				</div>
			)}
			{!office && projectId && n.type === "question" && n.status === "open" && n.to === "user" && (
				<div className="row" style={{ marginTop: 6 }}>
					<span className="grow" />
					<button className="small primary" onClick={() => act(call("notes.setStatus", projectId, n.id, "closed"))}>{tr("Slēgt")}</button>
				</div>
			)}
			{n.state === "proposed" && (
				<div className="row" style={{ marginTop: 6 }}>
					<Badge tone="info">{tr("aģenta priekšlikums")}</Badge>
					<span className="dim small grow">{tr("Aģents to neredz kā atmiņu, kamēr nepieņem.")}</span>
					<button className="small primary" onClick={() => call("memory.decide", n.id, true).then(notes.reload).catch(fail)}>{tr("Pieņemt")}</button>
					<button className="small ghost" title={tr("Fails tiek pārvietots malā, nevis dzēsts")} onClick={() => call("memory.decide", n.id, false).then(notes.reload).catch(fail)}>{tr("Noraidīt")}</button>
				</div>
			)}
		</div>
	);

	return (
		<div className="pane fill">
			<div className="row">
				<button className={scope === "project" ? "primary" : ""} disabled={!projectId} onClick={() => setScope("project")}>{tr("Projekts")}{projectId ? ` ${projectId}` : ""}</button>
				<button className={scope === "office" ? "primary" : ""} onClick={() => setScope("office")} title={tr("Mācības, kas der visiem projektiem; aģents tās lasa katrā projektā")}>{tr("Birojs")}</button>
				<span className="grow" />
				{(["", "decision", "answer", "learning", "question", "gate"] as const).map((t) => (
					<button key={t} className={type === t ? "primary" : ""} onClick={() => setType(t)}>
						{t ? TYPE[t] : tr("visi")}
					</button>
				))}
			</div>
			{office && agentIds.length > 0 && (
				<div className="row">
					<span className="dim small">{tr("Aģents:")}</span>
					{["", ...agentIds].map((a) => (
						<button key={a} className={`small ${agent === a ? "primary" : ""}`} onClick={() => setAgent(a)}>
							{a || tr("Visi")}
						</button>
					))}
				</div>
			)}
			{!office && !projectId ? (
				<Empty title={tr("nav projekta")}>{tr("Atver projektu vai skaties biroja atmiņu.")}</Empty>
			) : (
				<>
					<div className="confirm">
						<div className="row">
							<select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as NoteType })}>
								{TYPED.map((k) => (
									<option key={k} value={k}>{TYPE[k]}</option>
								))}
							</select>
							<input className="grow" placeholder={office ? tr("Virsraksts (noteikums, kas der visiem projektiem)") : tr("Virsraksts")} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
						</div>
						<textarea rows={3} placeholder={tr("Teksts (markdown)")} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
						<div className="row">
							{office && <span className="dim small">{tr("Birojs: to lasa aģents katrā projektā.")}</span>}
							<span className="grow" />
							<button className="primary" disabled={draft.title.trim().length < 3} onClick={save}>
								{tr("Saglabāt")}{office ? tr(" birojam") : ""}
							</button>
						</div>
					</div>
					{err && <div className="err">{err}</div>}
					{notes.error ? <Err error={notes.error} /> : null}
					{proposals.map(noteRow)}
					{standing.length === 0 && proposals.length === 0 && <Empty title={tr("no data")}>{office ? tr("Biroja atmiņā vēl nav ierakstu.") : tr("Atmiņā vēl nav ierakstu.")}</Empty>}
					{standing.map(noteRow)}
				</>
			)}
		</div>
	);
}
