// Panels 1–4: the law library. Built-in likumi.lv texts + what Boris adds by link or file; the rules the app
// computes with (verbatim quotes); and for LVS / EU the references found in the texts already read.
import { useState } from "react";
import { api, pickFiles } from "../api";
import { Badge, Empty, Err, useAction, useLoad } from "../ui";
import type { Applicable, Category, LibHit, LibSource, ProjectRef, ProjectRules, Reread, Rule, RulesAll } from "../types";
import { GatherPanel, OpenFile } from "./Gather";

type Tab = "p1" | "p2" | "p3" | "p4";
const CAT: Record<Tab, Category> = { p1: "likums", p2: "mk", p3: "lvs", p4: "es" };
const TITLES: Record<Tab, string> = { p1: "Likumi", p2: "MK noteikumi un LBN", p3: "LVS standarti", p4: "ES standarti un tiesības" };
const HINT: Record<Tab, string> = {
	p1: "Pievieno likumu ar likumi.lv saiti (piem., https://likumi.lv/ta/id/…) vai failu.",
	p2: "Pievieno citus MK noteikumus un LBN (201-15, 208-15, 211-15, 016-15 …) ar likumi.lv saiti vai PDF.",
	p3: "LVS standarti ir maksas dokumenti — pievieno savus PDF failus. Zemāk: standarti, uz kuriem atsaucas jau nolasītie akti.",
	p4: "Pievieno ES regulas un direktīvas ar EUR-Lex saiti vai PDF. Zemāk: ES akti, uz kuriem atsaucas jau nolasītie teksti.",
};
const ACT_IDS: Record<Tab, string[]> = { p1: ["258572", "72608"], p2: ["269069", "269164", "301303", "326992"], p3: [], p4: [] };
const SECTION_LABEL: Record<string, string> = { GP: "GP — ģenerālplāns", AR: "AR — arhitektūras daļa", VISPARIGA: "Vispārīgā daļa" };

export function Laws({ tab, root }: { tab: Tab; root: string | null }) {
	const cat = CAT[tab];
	const sources = useLoad(() => api<LibSource[]>("librarySources", cat), [cat]);
	const act = useAction();
	const [url, setUrl] = useState("");
	const [q, setQ] = useState("");
	const [hits, setHits] = useState<LibHit[] | null>(null);

	async function addUrl() {
		if (await act.run(() => api("libraryAddUrl", url.trim(), cat))) {
			setUrl("");
			sources.reload();
		}
	}
	async function addFiles() {
		const files = await pickFiles("Izvēlies dokumentus (PDF, DOCX, XLSX, TXT)", [{ name: "Dokumenti", extensions: ["pdf", "docx", "xlsx", "txt", "html", "htm"] }]);
		if (files.length && (await act.run(() => api("libraryAddFiles", files, cat)))) sources.reload();
	}
	async function search() {
		const r = await act.run(() => api<LibHit[]>("librarySearch", q, cat));
		if (r) setHits(r);
	}

	return (
		<>
			<h1>{TITLES[tab]}</h1>
				{root ? (
					<ProjectLaws root={root} cat={cat} showFacts={tab === "p2"} onAdded={sources.reload} />
				) : (
					<div className="empty" style={{ marginBottom: 12 }}>
						Izvēlies projektu (Pārskats) — tad šeit parādīsies tieši šim projektam piemērojamie panti un tas, ko min projekta dokumenti.
					</div>
				)}
			<div className="muted" style={{ marginBottom: 10 }}>
				{HINT[tab]} <b>„Nolasīts &lt;datums&gt;”</b> nozīmē dienu, kad teksts lejupielādēts vai izvilkts no faila un saglabāts lietotnes datos. Aģenta kontekstā tas nav pastāvīgi: aģents saņem tikai tos punktus, ko pats pieprasa ar rīkiem
				(meklēšana bibliotēkā, noteikumi stadijai), un katru citē ar avotu un datumu.
			</div>

			<div className="card">
				<div className="row">
					<input type="text" placeholder={tab === "p4" ? "https://eur-lex.europa.eu/…" : "https://likumi.lv/ta/id/…"} value={url} onChange={(e) => setUrl(e.target.value)} style={{ minWidth: 380 }} />
					<button className="btn primary" disabled={!url.trim() || act.busy} onClick={addUrl}>
						{act.busy ? "Nolasa…" : "Pievienot saiti"}
					</button>
					<button className="btn" disabled={act.busy} onClick={addFiles}>
						Pievienot failu…
					</button>
				</div>
				<Err text={act.err} />
			</div>

			<div className="card">
				<div className="row">
					<input type="text" placeholder="Meklēt šīs sadaļas tekstos (visi vārdi)…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim() && search()} style={{ minWidth: 380 }} />
					<button className="btn" disabled={!q.trim()} onClick={search}>
						Meklēt
					</button>
					{hits && <span className="muted">{hits.length} punkti</span>}
				</div>
				{hits?.map((h, i) => (
					<div key={i} style={{ marginTop: 6 }}>
						<div className="muted" style={{ fontSize: 12 }}>
							{h.title} · nolasīts {h.readOn}
						</div>
						<div className="quote">{h.paragraph}</div>
					</div>
				))}
			</div>

			<h2>Avoti</h2>
			<Err text={sources.err} />
			{sources.data?.length === 0 && <Empty>Šajā sadaļā vēl nav avotu. Pievieno saiti vai failu augstāk.</Empty>}
			{sources.data?.map((s) => (
				<SourceCard key={s.id} s={s} onChange={sources.reload} />
			))}

			{(tab === "p3" || tab === "p4") && <References kind={tab === "p3" ? "lvs" : "es"} />}
			{(tab === "p1" || tab === "p2") && <RulesUsed actIds={ACT_IDS[tab]} />}
			{tab === "p2" && <ProjectResult root={root} />}
		</>
	);
}

function SourceCard({ s, onChange }: { s: LibSource; onChange: () => void }) {
	const [open, setOpen] = useState(false);
	const paras = useLoad(() => (open ? api<string[]>("libraryParagraphs", s.id) : Promise.resolve(null)), [open, s.id]);
	const act = useAction();
	const [msg, setMsg] = useState<string | null>(null);
	return (
		<div className="card">
			<div className="row">
				<b>{s.title}</b>
				<Badge>{s.kind === "builtin" ? "iebūvēts" : s.kind === "url" ? "saite" : `fails ${s.file ?? ""}`}</Badge>
				<span className="muted">
					nolasīts {s.readOn} · {s.paragraphs} rindkopas
				</span>
				{s.changedOn && <Badge kind="warn">teksts mainījies {s.changedOn}</Badge>}
				<span className="grow" />
				{s.url && (
					<button className="btn" onClick={() => api("openUrl", s.url)}>
						Atvērt
					</button>
				)}
				{s.kind === "url" && (
					<button
						className="btn"
						disabled={act.busy}
						onClick={async () => {
							const r = await act.run(() => api<{ changed: boolean }>("libraryReread", s.id));
							if (r) setMsg(r.changed ? "Teksts mainījies — jaunā versija saglabāta, vecā paturēta." : "Teksts nav mainījies.");
							onChange();
						}}
					>
						Pārlasīt
					</button>
				)}
				<button className="btn" onClick={() => setOpen(!open)}>
					{open ? "Aizvērt tekstu" : "Rādīt tekstu"}
				</button>
				{s.kind !== "builtin" && (
					<button className="btn danger" onClick={async () => (await act.run(() => api("libraryRemove", s.id)), onChange())}>
						Noņemt
					</button>
				)}
			</div>
			{msg && <div className="muted">{msg}</div>}
			<Err text={act.err ?? paras.err} />
			{open && paras.data && (
				<div style={{ maxHeight: 420, overflow: "auto", marginTop: 8 }}>
					{paras.data.map((p, i) => (
						<div key={i} style={{ padding: "2px 0", fontSize: 13 }}>
							{p}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function References({ kind }: { kind: "lvs" | "es" }) {
	const refs = useLoad(() => api<{ ref: string; title: string; paragraph: string }[]>("libraryReferences", kind), [kind]);
	return (
		<>
			<h2 style={{ marginTop: 16 }}>{kind === "lvs" ? "LVS standarti, uz kuriem atsaucas nolasītie teksti" : "ES akti, uz kuriem atsaucas nolasītie teksti"}</h2>
			<div className="muted" style={{ marginBottom: 8 }}>Atrasti visos bibliotēkas tekstos (iebūvētajos un tevis pievienotajos). Pievieno vēl aktus — saraksts papildināsies.</div>
			<Err text={refs.err} />
			{refs.data?.length === 0 && <Empty>Nolasītajos tekstos atsauču nav atrasts.</Empty>}
			{refs.data?.map((r) => (
				<details key={r.ref} className="card">
					<summary>
						<b>{r.ref}</b> <span className="muted">— {r.title}</span>
					</summary>
					<div className="quote">{r.paragraph}</div>
				</details>
			))}
		</>
	);
}

function RulesUsed({ actIds }: { actIds: string[] }) {
	const all = useLoad(() => api<RulesAll>("rulesAll"), []);
	const reread = useAction();
	const [res, setRes] = useState<Reread | null>(null);
	const rules = (all.data?.rules ?? []).filter((r) => actIds.includes(r.actId));
	return (
		<details className="card" style={{ marginTop: 16 }}>
			<summary>
				<b>Noteikumi, ar kuriem lietotne rēķina</b> ({rules.length}) — grupa, procedūra, saturs, termiņi.{" "}
				{all.data && <Badge kind={all.data.verification.ok ? "ok" : "bad"}>{all.data.verification.ok ? "visi citāti sakrīt ar likumi.lv tekstu" : `${all.data.verification.failures.length} citāti nesakrīt`}</Badge>}
			</summary>
			<div className="row" style={{ margin: "8px 0" }}>
				<button className="btn" disabled={reread.busy} onClick={async () => setRes((await reread.run(() => api<Reread>("rulesReread"))) ?? null)}>
					{reread.busy ? "Pārbauda likumi.lv…" : "Pārbaudīt citātus pret likumi.lv šodien"}
				</button>
				{res && (
					<Badge kind={res.changed.length || res.failed.length ? "warn" : "ok"}>
						pārbaudīti {res.checked} · izmainīti {res.changed.length} · nepieejami {res.failed.length}
					</Badge>
				)}
			</div>
			<Err text={reread.err ?? all.err} />
			{res?.changed.map((c) => (
				<div key={c.id} className="err">
					Citāts vairs nav lapā: {c.act}, {c.article} — likums mainīts, noteikums jāpārlasa.
				</div>
			))}
			{rules.map((r) => (
				<RuleCard key={r.id} r={r} />
			))}
		</details>
	);
}

function RuleCard({ r }: { r: Rule }) {
	return (
		<div style={{ borderTop: "1px solid var(--border)", padding: "6px 0" }}>
			<div className="row">
				<b>
					{r.act}, {r.article}
				</b>
				{r.section && <Badge>{SECTION_LABEL[r.section] ?? r.section}</Badge>}
				{r.requires.map((x) => (
					<Badge key={x}>{x}</Badge>
				))}
				<span className="grow" />
				<span className="muted">nolasīts {r.read_on}</span>
			</div>
			<div className="quote">{r.quote}</div>
		</div>
	);
}

function ProjectResult({ root }: { root: string | null }) {
	const [stage, setStage] = useState<"skice" | "mbp" | "bp">("mbp");
	const res = useLoad(() => (root ? api<ProjectRules>("rulesForProject", root, stage) : Promise.resolve(null)), [root, stage]);
	if (!root) return <Empty>Izvēlies projektu pārskatā, lai redzētu tā grupu, procedūru un prasīto saturu.</Empty>;
	const d = res.data;
	return (
		<div className="card">
			<div className="row">
				<h2 style={{ margin: 0 }}>Šī projekta rezultāts</h2>
				<select value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
					<option value="skice">Skiču projekts</option>
					<option value="mbp">MBP (būvprojekts minimālā sastāvā)</option>
					<option value="bp">BP (būvprojekts)</option>
				</select>
			</div>
			<Err text={res.err} />
			{d && !d.ready && <Empty>{d.reason} Pabeidz čatu (9).</Empty>}
			{d && d.ready && (
				<>
					<p>
						<b>Grupa {d.group.value}</b> · <b>{d.procedure.value}</b> {d.bim && <Badge kind="warn">jāpievieno BIM modelis (MK 529 74.1)</Badge>}
					</p>
					{[...d.group.check, ...d.procedure.check].map((c, i) => (
						<div key={i} style={{ color: "var(--warn)" }}>
							Pārbaudi: {c}
						</div>
					))}
					{d.content.notes.map((n, i) => (
						<div key={i} className="muted">
							{n}
						</div>
					))}
					<table>
						<thead>
							<tr>
								<th>Sadaļa</th>
								<th>Prasītais saturs</th>
								<th>Pants</th>
							</tr>
						</thead>
						<tbody>
							{d.content.items.map((it, i) => (
								<tr key={i}>
									<td>{it.section}</td>
									<td>{it.item}</td>
									<td>{it.article}</td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			)}
		</div>
	);
}

/**
 * Top of panels 1–4 when a project is open: what THIS project has to follow. The agent cites library paragraphs
 * with a reason; code lists every act the project's own documents mention. The library below stays the reference.
 */
function ProjectLaws({ root, cat, showFacts, onAdded }: { root: string; cat: Category; showFacts: boolean; onAdded: () => void }) {
	const applicable = useLoad(() => api<Applicable[]>("applicableList", root, cat), [root, cat]);
	const refs = useLoad(() => api<ProjectRef[]>("refsList", root, cat), [root, cat]);
	const act = useAction();
	const reload = () => {
		applicable.reload();
		refs.reload();
		onAdded();
	};
	return (
		<>
			<GatherPanel
				root={root}
				section="laws"
				title="Aģents izvēlas šim projektam piemērojamos pantus"
				what="Aģents ņem projekta faktus (7.–8. panelis), nosaka grupu un procedūru pēc likuma, meklē bibliotēkā pantus, kas šim projektam jāievēro, un katru ieraksta ar citātu un iemeslu. Tas pats darbs aizpilda visus četrus likumu paneļus."
				onChange={reload}
				noFacts={!showFacts}
			/>
			<div className="card">
				<h3>Šim projektam piemērojamie panti ({applicable.data?.length ?? 0})</h3>
				<Err text={act.err ?? applicable.err} />
				{applicable.data?.length === 0 && <div className="muted">Aģents šajā sadaļā vēl nav izvēlējies pantus. Spied „Savākt no projekta mapes” augšā (vajag izlasītus 7.–8. paneļa datus).</div>}
				{applicable.data?.map((a) => (
					<div key={a.id} style={{ marginTop: 8 }}>
						<div className="row">
							<b>{a.title}</b>
							<span className="muted">nolasīts {a.readOn}</span>
							{a.url && (
								<button className="btn" onClick={() => api("openUrl", a.url)}>
									likumi.lv
								</button>
							)}
							<span className="grow" />
							{a.confirmed ? (
								<Badge kind="ok">apstiprināts</Badge>
							) : (
								<>
									<Badge kind="warn">ieteikts — pārbaudi</Badge>
									<button className="btn primary" onClick={async () => (await act.run(() => api("applicableConfirm", root, a.id)), reload())}>
										Pareizi
									</button>
								</>
							)}
							<button className="btn danger" onClick={async () => (await act.run(() => api("applicableRemove", root, a.id)), reload())}>
								Neattiecas
							</button>
						</div>
						<div className="quote">{a.quote}</div>
						<div>
							<span className="muted">Kāpēc šim projektam: </span>
							{a.why}
						</div>
					</div>
				))}
			</div>
			<div className="card">
				<h3>Projekta dokumenti min ({refs.data?.length ?? 0})</h3>
				<Err text={refs.err} />
				{refs.data?.length === 0 && <div className="muted">Projekta failos šajā sadaļā nekas netika atrasts (meklē pēc nosaukumiem un numuriem).</div>}
				{refs.data?.map((r) => (
					<div key={r.ref} style={{ marginTop: 6 }}>
						<div className="row">
							<b>{r.ref}</b>
							{r.inLibrary ? <Badge kind="ok">ir bibliotēkā</Badge> : <Badge kind="warn">nav bibliotēkā — pievieno ar saiti vai failu zemāk</Badge>}
							<span className="muted">{r.files} {r.files === 1 ? "fails" : "faili"}</span>
							<OpenFile root={root} path={r.path} />
						</div>
						<div className="quote">
							<span className="mono">{r.path}</span>: „{r.quote}”
						</div>
					</div>
				))}
			</div>
		</>
	);
}
