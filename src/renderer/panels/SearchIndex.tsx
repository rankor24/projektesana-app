// Meklēšanas indekss: the state of the project's search index (which model, how many pieces of the sources, conversations,
// memory and decision and question logs have a vector, the model download, the run in progress) with a button to update or rebuild it, and a box to try the very
// search the agents use (`search_project`): words and meaning together, answered with passages and where they come from.
// The index builds itself (after a scan, after a turn, at start); nothing here is needed for that. Shown in Avoti.
import { useEffect, useState } from "react";
import type { SearchKind, SearchResult, SearchStatus } from "../../shared/search-types";
import { call, errText, on } from "../bridge";
import { ui } from "../state";
import { Badge } from "../ui";
import { locale, tr } from "../i18n";

const mb = (n: number) => `${(n / 1_048_576).toFixed(n > 10_485_760 ? 0 : 1)} MB`;

/** The line that says what the index is doing right now, or null when it is doing nothing. */
function workLine(s: SearchStatus): string | null {
	if (s.state === "queued") return tr("Gaida rindā");
	if (s.state !== "running") return null;
	// files already on this PC are read through the same progress callback, but that is loading, not downloading
	if (s.phase === "model" && s.download && !s.model.downloaded) return tr("Lejupielādē modeli: {file} {loaded} / {total}", { file: s.download.file.split("/").pop() ?? s.download.file, loaded: mb(s.download.loaded), total: mb(s.download.total) });
	if (s.phase === "model") return tr("Ielādē modeli");
	if (s.phase === "vectors") return tr("Veido vektorus: {done} / {total}", { done: s.done ?? 0, total: s.total ?? 0 });
	return tr("Sagatavo fragmentus");
}

function workShare(s: SearchStatus): number | null {
	if (s.state !== "running") return null;
	if (s.phase === "model" && s.download && !s.model.downloaded && s.download.total > 0) return s.download.loaded / s.download.total;
	if (s.phase === "vectors" && s.total) return (s.done ?? 0) / s.total;
	return null;
}

export function SearchIndex({ projectId }: { projectId: string }) {
	const [st, setSt] = useState<SearchStatus | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [q, setQ] = useState("");
	const [kind, setKind] = useState<SearchKind>("all");
	const [res, setRes] = useState<SearchResult | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let live = true;
		setSt(null);
		setRes(null);
		call("search.status", projectId)
			.then((s) => live && setSt(s))
			.catch((e) => live && setErr(errText(e)));
		const off = on("search.progress", (s) => s.projectId === projectId && setSt(s));
		return () => {
			live = false;
			off();
		};
	}, [projectId]);

	const ask = async () => {
		if (q.trim().length < 2) return;
		setBusy(true);
		setErr(null);
		try {
			setRes(await call("search.query", projectId, q.trim(), kind, 8));
		} catch (e) {
			setErr(errText(e));
		} finally {
			setBusy(false);
		}
	};

	if (!st) return err ? <div className="err">{err}</div> : null;
	const ix = st.index;
	const pending = ix ? ix.chunks - ix.embedded : 0;
	const line = workLine(st);
	const share = workShare(st);
	const when = ix?.updatedAt ? new Date(ix.updatedAt).toLocaleString(locale()) : null;

	return (
		<details className="pane" open={st.state !== "idle" || !!st.error || !ix || ix.chunks === 0 || pending > 0}>
			<summary>
				<b>{tr("Meklēšanas indekss")}</b>{" "}
				<span className="dim small">
					{ix && ix.chunks > 0 ? tr("{done} / {total} fragmenti", { done: ix.embedded, total: ix.chunks }) : tr("nav uzbūvēts")}
					{when ? ` · ${tr("atjaunots {when}", { when })}` : ""}
				</span>{" "}
				{st.state === "running" && <Badge tone="info">{tr("darbojas")}</Badge>}
				{st.error && <Badge tone="bad">{tr("kļūda")}</Badge>}
			</summary>
			<div className="row small" style={{ flexWrap: "wrap", gap: 8 }}>
				<span>
					{tr("Modelis")}: <b>{st.model.label}</b> <span className="dim">({tr("apm. {size} MB, lokāli, licence {licence}", { size: st.model.approxMB, licence: st.model.license })})</span>
				</span>
				{st.model.downloaded ? <Badge tone="ok">{tr("lejupielādēts")}</Badge> : <Badge tone="warn">{tr("nav lejupielādēts")}</Badge>}
			</div>
			{ix && ix.chunks > 0 && (
				<div className="dim small">
					{tr("Avoti: {done} / {total} fragmenti no {files} failiem; sarunas: {mdone} / {mtotal}", { done: ix.sources.embedded, total: ix.sources.chunks, files: ix.sources.files, mdone: ix.messages.embedded, mtotal: ix.messages.chunks })}
					<br />
					{tr("Atmiņa: {done} / {total} fragmenti; žurnāli (lēmumi, jautājumi): {ldone} / {ltotal}", { done: ix.memory.embedded, total: ix.memory.chunks, ldone: ix.logs.embedded, ltotal: ix.logs.chunks })}
				</div>
			)}
			{line && (
				<div className="small">
					{line}
					{share !== null && (
						<div className="progress">
							<div style={{ width: `${Math.round(share * 100)}%` }} />
						</div>
					)}
				</div>
			)}
			{st.error && <div className="err">{tr("Indeksēšana apstājās: {message}", { message: st.error })}</div>}
			{err && <div className="err">{err}</div>}
			<div className="row">
				<button className="ghost small" disabled={st.state !== "idle"} title={tr("Uzbūvē to, kā trūkst; pirmajā reizē lejupielādē modeli")} onClick={() => call("search.update", projectId).catch((e) => setErr(errText(e)))}>
					{st.model.downloaded ? tr("Atjaunināt") : tr("Lejupielādēt modeli un veidot indeksu")}
				</button>
				<button className="ghost small" disabled={st.state === "running"} title={tr("Izmet visu un uzbūvē no jauna no avotiem, sarunām, atmiņas un žurnāliem")} onClick={() => call("search.reindex", projectId).catch((e) => setErr(errText(e)))}>
					{tr("Pārindeksēt")}
				</button>
				<span className="dim small">{tr("Indekss veidojas pats: pēc nolasīšanas un pēc katras sarunas.")}</span>
			</div>
			<div className="row">
				<input className="grow" placeholder={tr("Pamēģini to pašu meklēšanu, ko izmanto aģenti: jautājums latviski…")} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void ask()} />
				<select className="small" value={kind} onChange={(e) => setKind(e.target.value as SearchKind)}>
					<option value="all">{tr("Viss")}</option>
					<option value="sources">{tr("Avoti")}</option>
					<option value="conversations">{tr("Sarunas")}</option>
					<option value="memory">{tr("Atmiņa")}</option>
					<option value="logs">{tr("Žurnāli")}</option>
				</select>
				<button className="primary" disabled={busy || q.trim().length < 2} onClick={() => void ask()}>
					{tr("Meklēt")}
				</button>
			</div>
			{res && (
				<div>
					{res.note && <div className="dim small">{res.note}</div>}
					{res.hits.length === 0 && <div className="dim small">{tr("Nekas neatbilst.")}</div>}
					{res.hits.map((h, i) => (
						<div key={i} style={{ padding: "4px 0", borderTop: "1px solid var(--line, #8883)" }}>
							<div className="small">
								{h.kind === "source" && h.sourceId ? (
									<a href="#" onClick={(e) => (e.preventDefault(), ui.show({ kind: "source", sourceId: h.sourceId!, page: h.page }))}>
										{h.citation}
									</a>
								) : (
									<b>{h.citation}</b>
								)}{" "}
								<Badge tone={h.via.length === 2 ? "ok" : "dim"}>{h.via.map((v) => (v === "keyword" ? tr("vārdi") : tr("jēga"))).join(" + ")}</Badge>
							</div>
							<div className="dim small" style={{ whiteSpace: "pre-wrap" }}>
								{h.text}
							</div>
						</div>
					))}
				</div>
			)}
		</details>
	);
}
