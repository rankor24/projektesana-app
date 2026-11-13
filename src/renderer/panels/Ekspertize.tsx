// Ekspertīze (task 8.14): the remarks of an expert review (ekspertīzes atzinums) per daļa and responsible person, each with its words
// and page, until the user closes it. First minute: pick the document the atzinums is, press Nolasīt — the remarks appear, grouped by
// daļa, critical first. The user closes each one (izpildīts, or nav aktuāls with a reason); the open ones are also findings in Atradumi
// (so BCF and the agent's Fokuss carry them). Per-daļa fix lists are one click. Nothing here changes a model or a document.
import { useMemo, useState } from "react";
import { REMARK_STATE_LABEL, type ExpertRemark, type RemarkState } from "../../shared/expert-types";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";

const STATE_TONE: Record<RemarkState, "warn" | "ok" | "dim"> = { open: "warn", done: "ok", na: "dim" };
const NONE = "nenoteikta";

export function Ekspertize({ projectId }: { projectId: string }) {
	const view = useLoad(() => call("expert.list", projectId), [projectId]);
	const [pick, setPick] = useState("");
	const [show, setShow] = useState<RemarkState | "all">("open");
	const [daļa, setDaļa] = useState<string>("");
	const [q, setQ] = useState("");
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [naFor, setNaFor] = useState<string | null>(null);
	const [reason, setReason] = useState("");
	const [list, setList] = useState<{ title: string; text: string } | null>(null);

	const data = view.data;
	const sources = useMemo(() => [...(data?.sources ?? [])].sort((a, b) => Number(b.role === "Ekspertīzes atzinums") - Number(a.role === "Ekspertīzes atzinums") || b.remarks - a.remarks || a.title.localeCompare(b.title, "lv")), [data]);
	const titleOf = (id: string) => data?.sources.find((s) => s.id === id)?.title ?? id;
	const act = async (f: () => Promise<unknown>) => {
		setErr(null);
		try {
			await f();
			view.reload();
		} catch (e) {
			setErr(errText(e));
		}
	};
	const read = async () => {
		if (!pick) return;
		setBusy(true);
		setMsg(null);
		await act(async () => {
			const s = data?.sources.find((x) => x.id === pick);
			if (s && s.role !== "Ekspertīzes atzinums") await call("sources.setRole", projectId, pick, "Ekspertīzes atzinums");
			const r = await call("expert.read", projectId, pick);
			setMsg(
				r.found === 0
					? "Kods šajā dokumentā neatrada nevienu piezīmi (izkārtojums nav no zināmajiem). Palūdz aģentam: «izlasi ekspertīzes atzinumu un pievieno piezīmes»."
					: `Atrastas ${r.found} piezīmes${r.added < r.found ? `, jaunas ${r.added}` : ""}${r.meta.auditor ? `. Eksperts: ${r.meta.auditor}` : ""}.`,
			);
		});
		setBusy(false);
	};

	const rows = (data?.remarks ?? [])
		.filter((r) => (show === "all" || r.state === show) && (!daļa || (r.daļa ?? NONE) === daļa) && (!q || `${r.quote} ${r.responsible ?? ""} ${r.code ?? ""}`.toLowerCase().includes(q.toLowerCase())))
		.sort((a, b) => Number(b.critical) - Number(a.critical) || (a.daļa ?? "~").localeCompare(b.daļa ?? "~") || a.page - b.page);
	const s = data?.summary;

	return (
		<div className="pane fill">
			<div className="row">
				<select value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 420 }}>
					<option value="">— kurš dokuments ir ekspertīzes atzinums? —</option>
					{sources.map((x) => (
						<option key={x.id} value={x.id}>
							{x.title} · {x.pages} lpp.{x.remarks ? ` · ${x.remarks} piezīmes` : ""}
							{x.role === "Ekspertīzes atzinums" ? " ✓" : ""}
						</option>
					))}
				</select>
				<button className="primary" disabled={!pick || busy} onClick={read}>
					Nolasīt atzinumu
				</button>
				{msg && <span className="small">{msg}</span>}
			</div>
			{err && <div className="err">{err}</div>}
			{view.error ? <Err error={view.error} /> : null}
			{data && data.remarks.length === 0 && (
				<Empty title="ekspertīzes piezīmju vēl nav">
					{sources.length === 0 ? "Projektā nav nolasīta dokumenta. Pārbaudi Avoti: vajag PDF, DOCX vai MD ar nolasītu tekstu." : "Izvēlies dokumentu, kas ir ekspertīzes atzinums, un spied “Nolasīt atzinumu”. Dokuments saņem lomu “Ekspertīzes atzinums”."}
				</Empty>
			)}
			{s && s.total > 0 && (
				<>
					<div className="row">
						{(["open", "done", "na", "all"] as const).map((k) => (
							<button key={k} className={show === k ? "primary" : ""} onClick={() => setShow(k)}>
								{k === "all" ? "visas" : REMARK_STATE_LABEL[k]} ({k === "all" ? s.total : s[k]})
							</button>
						))}
						{s.openCritical > 0 && <Badge tone="bad">{s.openCritical} kritiskas atvērtas</Badge>}
						<input className="grow" placeholder="meklēt piezīmē vai atbildīgajā…" value={q} onChange={(e) => setQ(e.target.value)} />
					</div>
					<div className="row">
						<span className="dim small">daļa:</span>
						<button className={daļa === "" ? "primary" : ""} onClick={() => setDaļa("")}>
							visas
						</button>
						{s.byDaļa.map((g) => (
							<span key={g.key} style={{ display: "inline-flex", gap: 2 }}>
								<button className={daļa === g.key ? "primary" : ""} onClick={() => setDaļa(daļa === g.key ? "" : g.key)} title={`${g.open} atvērtas no ${g.total}`}>
									{g.key} {g.open}/{g.total}
								</button>
								<button
									className="small ghost"
									title={`Labojumu saraksts: ${g.key}`}
									onClick={() => act(async () => setList({ title: g.key, text: await call("expert.fixList", projectId, g.key === NONE ? null : g.key) }))}
								>
									saraksts
								</button>
							</span>
						))}
					</div>
					{s.byResponsible.some((g) => g.key !== "nenorādīts") && (
						<div className="small dim">
							atbildīgie: {s.byResponsible.map((g) => `${g.key} ${g.open}/${g.total}`).join(" · ")}
						</div>
					)}
				</>
			)}
			{list && (
				<div className="confirm">
					<div className="row">
						<b className="grow">Labojumu saraksts — {list.title}</b>
						<button
							className="small"
							onClick={() => {
								try {
									void navigator.clipboard.writeText(list.text);
									setMsg("Saraksts nokopēts.");
								} catch {
									setMsg("Nokopēt neizdevās: iezīmē tekstu un kopē pats.");
								}
							}}
						>
							Kopēt
						</button>
						<button className="small ghost" onClick={() => setList(null)}>
							Aizvērt
						</button>
					</div>
					<pre className="small" style={{ whiteSpace: "pre-wrap", maxHeight: 280, overflow: "auto" }}>
						{list.text}
					</pre>
					<div className="small dim">Aģents var to ielikt Word dokumentā nodevumā (write_document).</div>
				</div>
			)}
			{rows.length > 0 && (
				<table>
					<thead>
						<tr>
							<th>Daļa</th>
							<th>Piezīme atzinumā</th>
							<th>Atbildīgais</th>
							<th>Statuss</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => (
							<Row key={r.id} r={r} title={titleOf(r.sourceId)} naOpen={naFor === r.id} reason={reason} setReason={setReason} onNa={() => { setNaFor(r.id); setReason(""); }} onCancelNa={() => setNaFor(null)} projectId={projectId} act={act} setNaFor={setNaFor} />
						))}
					</tbody>
				</table>
			)}
			{data && data.remarks.length > 0 && rows.length === 0 && <Empty title="nekas neatbilst filtram" />}
		</div>
	);
}

function Row({ r, title, naOpen, reason, setReason, onNa, onCancelNa, projectId, act, setNaFor }: { r: ExpertRemark; title: string; naOpen: boolean; reason: string; setReason: (s: string) => void; onNa: () => void; onCancelNa: () => void; projectId: string; act: (f: () => Promise<unknown>) => Promise<void>; setNaFor: (s: string | null) => void }) {
	const [dl, setDl] = useState(r.daļa ?? "");
	const [who, setWho] = useState(r.responsible ?? "");
	return (
		<tr>
			<td style={{ whiteSpace: "nowrap" }}>
				<input style={{ width: 54 }} value={dl} placeholder="daļa" onChange={(e) => setDl(e.target.value)} onBlur={() => dl.trim().toUpperCase() !== (r.daļa ?? "") && act(() => call("expert.edit", projectId, r.id, { daļa: dl }))} />
			</td>
			<td>
				{r.critical && <Badge tone="bad">kritiska</Badge>} {r.code && <span className="mono small dim">{r.code} </span>}
				{r.quote}
				<div className="small dim">
					<button className="small ghost" title="Atvērt atzinumu šajā lapā" onClick={() => ui.show({ kind: "source", sourceId: r.sourceId, page: r.page })}>
						{title}, {r.page}. lpp.
					</button>
					{r.section ? ` · ${r.section}` : ""}
					{r.by === "agent" ? " · aģenta atrasta" : ""}
				</div>
				{r.reply && <div className="small">Atbilde dokumentā: <i>{r.reply}</i></div>}
				{r.note && <div className="small">{r.state === "na" ? "Pamatojums" : "Piezīme"}: <i>{r.note}</i></div>}
				{naOpen && (
					<div className="row">
						<input className="grow" autoFocus placeholder="Kāpēc piezīme nav aktuāla (obligāts)" value={reason} onChange={(e) => setReason(e.target.value)} />
						<button disabled={reason.trim().length < 5} onClick={() => act(async () => { await call("expert.setState", projectId, r.id, "na", reason); setNaFor(null); })}>
							Nav aktuāls
						</button>
						<button className="small ghost" onClick={onCancelNa}>
							Atcelt
						</button>
					</div>
				)}
			</td>
			<td>
				<input style={{ width: 130 }} value={who} placeholder="nav norādīts" onChange={(e) => setWho(e.target.value)} onBlur={() => who.trim() !== (r.responsible ?? "") && act(() => call("expert.edit", projectId, r.id, { responsible: who }))} />
			</td>
			<td style={{ whiteSpace: "nowrap" }}>
				<Badge tone={STATE_TONE[r.state]}>{REMARK_STATE_LABEL[r.state]}</Badge>{" "}
				{r.state === "open" ? (
					<>
						<button className="small" onClick={() => act(() => call("expert.setState", projectId, r.id, "done", null))}>
							Izpildīts
						</button>
						<button className="small ghost" onClick={onNa}>
							Nav aktuāls
						</button>
					</>
				) : (
					<button className="small ghost" onClick={() => act(() => call("expert.setState", projectId, r.id, "open", null))}>
						Atvērt atkal
					</button>
				)}
			</td>
		</tr>
	);
}
