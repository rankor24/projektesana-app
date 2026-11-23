// Grafiks → Rutīnas: a routine is an agent + an instruction + a schedule. The user writes the timing in words ("katru pirmdienu 9:00",
// "first of every month at 9") or as a cron expression; the page shows the expression, a sentence and the next three runs BEFORE saving,
// so a wrong reading shows at once. A routine runs only while the app is open; what came due while it was closed runs once on start and is
// marked "novēlots". A routine an agent proposed waits here for "Sākt". Per project (in the project's data folder) or, with no project,
// for the whole app. Ported in idea from OpenMausBot's Automations → Schedule (docs/routine-schedules.md): preview with the next three
// dates, Pause, Run now, a log of runs with Missed rows.
import { useEffect, useState } from "react";
import type { RoutineInput, RoutinePreview, RoutineRow, RoutineRunRow, RoutineTaskMode } from "../../shared/routine-types";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";
import { locale, tr } from "../i18n";

const MODES: { id: RoutineTaskMode; label: string }[] = [
	{ id: "none", label: tr("bez uzdevuma") },
	{ id: "task", label: tr("izveido uzdevumu šai dienai") },
	{ id: "task-result", label: tr("uzdevums + rezultāts tā piezīmē") },
];

const STATE_TONE: Record<RoutineRunRow["state"], "ok" | "warn" | "bad" | "dim" | "info"> = { pending: "info", running: "info", ran: "ok", failed: "bad", missed: "warn" };
const STATE_WORD: Record<RoutineRunRow["state"], string> = { pending: tr("gaida"), running: tr("darbojas"), ran: tr("izpildīta"), failed: tr("neizdevās"), missed: tr("izlaista") };

const EMPTY: RoutineInput = { name: "", agent: "lead", instruction: "", when: "", taskMode: "none" };

export function Routines({ projectId }: { projectId: string | null }) {
	// with a project open both lists are reachable; without one only the app's own
	const [wholeApp, setWholeApp] = useState(!projectId);
	const scope = wholeApp ? null : projectId;
	const rows = useLoad<RoutineRow[]>(() => call("routines.list", scope), [scope]);
	const agents = useLoad(() => call("agents.list"), []);
	const [form, setForm] = useState<RoutineInput | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const act = (p: Promise<unknown>) => p.then(() => (setErr(null), rows.reload())).catch((e) => setErr(errText(e)));
	const names = new Map<string, string>([["lead", tr("Galvenais aģents")], ...(agents.data?.specs ?? []).map((s) => [s.id, s.name] as [string, string])]);

	return (
		<div className="pane fill">
			<div className="row">
				<button className={!wholeApp ? "primary" : ""} disabled={!projectId} onClick={() => setWholeApp(false)}>{tr("Projekts")}{projectId ? ` ${projectId}` : ""}</button>
				<button className={wholeApp ? "primary" : ""} onClick={() => setWholeApp(true)} title={tr("Rutīnas, kas nepieder projektam")}>{tr("Visa lietotne")}</button>
				<span className="grow" />
				<span className="dim small">{tr("Rutīnas darbojas tikai, kamēr lietotne ir atvērta; kas nokavēts, tiek palaists vienreiz startā.")}</span>
				<button className="primary" onClick={() => setForm({ ...EMPTY })}>＋ {tr("Rutīna")}</button>
			</div>
			{err && <div className="err">{err}</div>}
			{rows.error ? <Err error={rows.error} /> : null}
			{form && (
				<RoutineForm
					key={form.id ?? "new"}
					value={form}
					projectId={scope}
					agents={[...names].map(([id, name]) => ({ id, name }))}
					onCancel={() => setForm(null)}
					onSaved={() => (setForm(null), rows.reload())}
				/>
			)}
			{!rows.loading && (rows.data ?? []).length === 0 && !form && <Empty title={tr("no data")}>{wholeApp ? tr("Visas lietotnes rutīnu vēl nav.") : tr("Šajā projektā rutīnu vēl nav.")}</Empty>}
			{(rows.data ?? []).map((r) => (
				<RoutineCard
					key={r.id}
					r={r}
					agentName={names.get(r.agent) ?? r.agent}
					onEdit={() => setForm({ id: r.id, name: r.name, agent: r.agent, instruction: r.instruction, when: r.words ?? r.cron, tz: r.tz, taskMode: r.taskMode })}
					onPause={() => act(call("routines.setPaused", scope, r.id, !(r.paused || r.proposed)))}
					onRun={() => act(call("routines.runNow", scope, r.id))}
					onDelete={() => confirm(tr("Dzēst rutīnu «{name}»? Tās žurnāls pazudīs.", { name: r.name })) && act(call("routines.remove", scope, r.id))}
				/>
			))}
		</div>
	);
}

function RoutineCard({ r, agentName, onEdit, onPause, onRun, onDelete }: { r: RoutineRow; agentName: string; onEdit: () => void; onPause: () => void; onRun: () => void; onDelete: () => void }) {
	const idle = r.paused || r.proposed;
	return (
		<div className={`text-page routine ${idle ? "idle" : ""}`}>
			<div className="row">
				<b className="grow">⟳ {r.name}</b>
				<Badge tone="info" title={tr("Aģents, kas rutīnu izpilda")}>{agentName}</Badge>
				{r.proposed && <Badge tone="warn" title={tr("Aģents to piedāvāja; tā nedarbojas, kamēr tu to nesāc")}>{tr("aģenta piedāvājums")}</Badge>}
				{r.paused && !r.proposed && <Badge tone="dim">{tr("apturēta")}</Badge>}
				{r.taskMode !== "none" && <Badge tone="dim" title={MODES.find((m) => m.id === r.taskMode)?.label}>{tr("uzdevums")}</Badge>}
			</div>
			<div className="routine-when">
				<span>{r.text}</span> <code className="mono dim">{r.cron}</code> <span className="dim small">{r.tz}</span>
			</div>
			<div className="small dim">{r.instruction}</div>
			<div className="small">
				{idle ? <span className="dim">{r.proposed ? tr("Nākamo reižu nav, kamēr nesāc.") : tr("Nākamo reižu nav, kamēr apturēta.")}</span> : <span>{tr("Nākamās reizes:")} {r.next.length ? r.next.join(" · ") : tr("nav")}</span>}
			</div>
			<div className="row" style={{ marginTop: 6 }}>
				{r.proposed ? (
					<button className="small primary" onClick={onPause}>{tr("Sākt")}</button>
				) : (
					<button className="small" onClick={onPause}>{r.paused ? tr("Turpināt") : tr("Apturēt")}</button>
				)}
				<button className="small" onClick={onRun} title={tr("Palaist aģentu tūlīt, neskarot grafiku")}>{tr("Palaist tagad")}</button>
				<button className="small ghost" onClick={onEdit}>{tr("Labot")}</button>
				<span className="grow" />
				<button className="small ghost danger" onClick={onDelete}>{tr("Dzēst")}</button>
			</div>
			{r.runs.length > 0 && (
				<details className="routine-log">
					<summary className="dim small">
						{tr("Žurnāls: {n} ieraksti", { n: r.runs.length })} · {STATE_WORD[r.runs[0].state]} {fmt(r.runs[0].scheduledFor)}
					</summary>
					{r.runs.map((x) => (
						<div key={x.id} className="row small routine-run">
							<Badge tone={STATE_TONE[x.state]}>{STATE_WORD[x.state]}</Badge>
							<span>{fmt(x.scheduledFor)}</span>
							{x.late && <Badge tone="warn">{tr("novēlots")}</Badge>}
							{x.count ? <span className="dim">×{x.count}</span> : null}
							<span className="dim grow">{x.note ?? ""}</span>
							{x.thread && <button className="small ghost" onClick={() => ui.selectThread(x.thread!)}>{tr("sarunā")}</button>}
						</div>
					))}
				</details>
			)}
		</div>
	);
}

const fmt = (iso: string) => new Date(iso).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });

function RoutineForm({ value, projectId, agents, onCancel, onSaved }: { value: RoutineInput; projectId: string | null; agents: { id: string; name: string }[]; onCancel: () => void; onSaved: () => void }) {
	const [v, setV] = useState<RoutineInput>(value);
	const [preview, setPreview] = useState<RoutinePreview | null>(null);
	const [err, setErr] = useState<string | null>(null);
	// the reading of the words is asked from the app's own reader (no network) a moment after typing stops
	useEffect(() => {
		if (!v.when.trim()) return setPreview(null);
		let live = true;
		const t = setTimeout(() => void call("routines.preview", v.when, v.tz).then((p) => live && setPreview(p)).catch(() => undefined), 250);
		return () => {
			live = false;
			clearTimeout(t);
		};
	}, [v.when, v.tz]);
	const can = v.name.trim().length >= 2 && v.instruction.trim().length >= 5 && preview?.ok === true;
	const save = () =>
		call("routines.save", projectId, v)
			.then(onSaved)
			.catch((e) => setErr(errText(e)));
	return (
		<div className="confirm routine-form">
			<div className="row">
				<input className="grow" placeholder={tr("Nosaukums (piem. Nedēļas kopsavilkums)")} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
				<select value={v.agent} onChange={(e) => setV({ ...v, agent: e.target.value })} title={tr("Kurš aģents rutīnu izpilda")}>
					{agents.map((a) => (
						<option key={a.id} value={a.id}>{a.name}</option>
					))}
				</select>
			</div>
			<textarea rows={3} placeholder={tr("Ko aģentam darīt (viņš to saņem kā ziņu)")} value={v.instruction} onChange={(e) => setV({ ...v, instruction: e.target.value })} />
			<div className="row">
				<input className="grow" placeholder={tr("Kad: vārdiem («katru pirmdienu 9:00», «darba dienās 8:30», «katra mēneša 1. datumā 9:00») vai cron")} value={v.when} onChange={(e) => setV({ ...v, when: e.target.value })} />
				<input style={{ width: 150 }} placeholder="Europe/Riga" value={v.tz ?? ""} onChange={(e) => setV({ ...v, tz: e.target.value })} title={tr("Laika josla (IANA)")} />
			</div>
			{preview && (
				<div className={preview.ok ? "routine-preview" : "err"}>
					{preview.ok ? (
						<>
							<div>
								<b>{preview.text}</b> <code className="mono">{preview.cron}</code>
							</div>
							<div className="small">{tr("Nākamās trīs reizes:")} {preview.next?.join(" · ")}</div>
							<div className="small dim">{tr("Ja tas nav tas, ko domāji, pārfrāzē vai ieraksti cron izteiksmi tieši.")}</div>
						</>
					) : (
						preview.error
					)}
				</div>
			)}
			{projectId && (
				<div className="row">
					<span className="dim small">{tr("Uzdevums:")}</span>
					<select value={v.taskMode ?? "none"} onChange={(e) => setV({ ...v, taskMode: e.target.value as RoutineTaskMode })}>
						{MODES.map((m) => (
							<option key={m.id} value={m.id}>{m.label}</option>
						))}
					</select>
					<span className="dim small">{tr("Uzdevums parādās Grafikā uz dienu, kad rutīna palaista.")}</span>
				</div>
			)}
			{err && <div className="err">{err}</div>}
			<div className="row">
				<span className="grow" />
				<button className="ghost" onClick={onCancel}>{tr("Atcelt")}</button>
				<button className="primary" disabled={!can} onClick={save}>{v.id ? tr("Saglabāt izmaiņas") : tr("Saglabāt rutīnu")}</button>
			</div>
		</div>
	);
}
