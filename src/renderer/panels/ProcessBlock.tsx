// "Darba režīms" on Pārskats (task 14.8): the switch Kopdarbs / Process, the profile editor with its history, and the process-mode buttons (registers, client change,
// lessons, finish). Every rule is main's (core/process.ts); a refusal is shown as it comes. The block is the only place the mode is switched.
import { useEffect, useState } from "react";
import type { AgentSpec } from "../../shared/agent-types";
import type { Depth, DocType, Stage } from "../../core/process-def";
import { STAGES } from "../../core/process-def";
import { DOC_TYPE_LABEL, depthChoices, depthOfDocType, profilePatch, type ProfileDraft } from "../../shared/process-view";
import { call, errText } from "../bridge";
import { useProcess } from "../state";

const DOC_TYPES = Object.keys(DOC_TYPE_LABEL) as DocType[];
const FOLDER = "export/00_vadiba";

/** The refusal of a missing bpv names Iestatījumi already; the pointer is added only when the text lacks it. */
const withPointer = (m: string) => (/bpv/i.test(m) && !m.includes("Iestatījumi") ? `${m} (Iestatījumi → Aģenti)` : m);

export function ProcessBlock({ projectId }: { projectId: string }) {
	const s = useProcess(projectId);
	const [specs, setSpecs] = useState<AgentSpec[]>([]);
	const [err, setErr] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let live = true;
		call("agents.list")
			.then((v) => live && setSpecs(v.specs))
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, []);
	useEffect(() => {
		setErr(null);
		setInfo(null);
	}, [projectId]);

	/** one job at a time; its refusal is shown, its result may set a line of information */
	const run = (job: () => Promise<string | void>) => {
		setErr(null);
		setInfo(null);
		setBusy(true);
		job()
			.then((m) => setInfo(m ?? null))
			.catch((e) => setErr(withPointer(errText(e))))
			.finally(() => setBusy(false));
	};
	const mode = s?.mode ?? "cowork";
	const setMode = (m: "cowork" | "process") => m !== mode && run(async () => void (await call("process.setMode", projectId, m)));

	return (
		<section className="pblock">
			<div className="row">
				<div className="section-title">Darba režīms</div>
				<div className="seg" role="group" aria-label="Darba režīms">
					<button className={mode === "cowork" ? "on" : ""} disabled={busy} onClick={() => setMode("cowork")} title="Aģenti strādā pēc tavas komandas; stadiju un vārtu nav">
						Kopdarbs
					</button>
					<button className={mode === "process" ? "on" : ""} disabled={busy} onClick={() => setMode("process")} title="Biroja process S1–S7 ar cilvēka vārtiem H1–H7">
						Process
					</button>
				</div>
				{s && <span className="dim small">{s.stage === "mācības" ? "stadija: mācības" : s.stage === "done" ? "process pabeigts" : `stadija: ${s.stage}`}</span>}
			</div>
			{err && <div className="err pblock-msg">{err}</div>}
			{info && <div className="small pblock-msg">{info}</div>}
			{s && <ProfileEditor key={`${projectId}|${JSON.stringify([s.docType, s.profile.depth, s.profile.agents])}`} projectId={projectId} s={s} specs={specs} run={run} busy={busy} />}
			{s && s.mode === "process" && <Actions projectId={projectId} stage={s.stage} run={run} busy={busy} />}
			{s && <History changes={s.profile.changes} />}
		</section>
	);
}

type Run = (job: () => Promise<string | void>) => void;

function ProfileEditor({ projectId, s, specs, run, busy }: { projectId: string; s: NonNullable<ReturnType<typeof useProcess>>; specs: AgentSpec[]; run: Run; busy: boolean }) {
	// the editor is re-keyed on the saved profile, so a draft always starts from what is stored
	const [draft, setDraft] = useState<ProfileDraft>({ docType: s.docType, depth: { ...s.profile.depth }, agents: [...s.profile.agents], why: "" });
	const [open, setOpen] = useState(false);
	const [local, setLocal] = useState<string | null>(null);
	const known = new Set(specs.map((a) => a.id));
	// an agent of the profile that no longer exists is listed, so that it is not dropped without being seen
	const agents = [...specs.map((a) => ({ id: a.id, name: a.name })), ...draft.agents.filter((a) => !known.has(a)).map((a) => ({ id: a, name: `${a} (nav iestatījumos)` }))];
	const patch = profilePatch(s, draft);

	const save = () => {
		if (!draft.why.trim()) {
			setLocal("Profila maiņai vajag pamatojumu.");
			return;
		}
		if (!patch) {
			setLocal("Nekas nav mainīts.");
			return;
		}
		setLocal(null);
		run(async () => void (await call("process.setProfile", projectId, patch)));
	};
	const toggle = (id: string) => setDraft((d) => ({ ...d, agents: d.agents.includes(id) ? d.agents.filter((a) => a !== id) : [...d.agents, id] }));

	return (
		<div className="pprofile">
			<div className="row">
				<button className="small ghost" onClick={() => setOpen(!open)}>
					{open ? "Slēpt procesa profilu" : "Procesa profils"}
				</button>
				<span className="dim small">
					{DOC_TYPE_LABEL[s.docType]} · aģenti: {s.profile.agents.join(", ")}
				</span>
			</div>
			{open && (
				<>
					<label className="row small">
						<span className="dim">Dokumenta veids</span>
						<select value={draft.docType} onChange={(e) => setDraft((d) => ({ ...d, docType: e.target.value as DocType, depth: depthOfDocType(e.target.value as DocType) }))}>
							{DOC_TYPES.map((t) => (
								<option key={t} value={t}>
									{DOC_TYPE_LABEL[t]}
								</option>
							))}
						</select>
						<span className="dim">(jauns veids atjauno dziļumu pa stadijām)</span>
					</label>
					<div className="pdepth">
						{STAGES.map((st: Stage) => (
							<label key={st} className="pdepth-cell small">
								<b>{st}</b>
								<select value={draft.depth[st]} onChange={(e) => setDraft((d) => ({ ...d, depth: { ...d.depth, [st]: e.target.value as Depth } }))}>
									{depthChoices(st).map((x) => (
										<option key={x} value={x}>
											{x}
										</option>
									))}
								</select>
							</label>
						))}
					</div>
					<div className="row small">
						<span className="dim">Aģenti profilā</span>
						{agents.map((a) => (
							<label key={a.id} className="pagent" title={a.id === "bpv" ? "Projekta vadītājs ir vienmēr" : a.id}>
								<input type="checkbox" checked={a.id === "bpv" || draft.agents.includes(a.id)} disabled={a.id === "bpv"} onChange={() => toggle(a.id)} />
								{a.name}
							</label>
						))}
					</div>
					<label className="small pwhy">
						<span className="dim">Pamatojums (obligāts)</span>
						<input value={draft.why} onChange={(e) => setDraft((d) => ({ ...d, why: e.target.value }))} placeholder="Kāpēc profils mainās" />
					</label>
					<div className="row">
						<button className="primary" disabled={busy} onClick={save}>
							Saglabāt profilu
						</button>
						{!patch && <span className="dim small">nekas nav mainīts</span>}
					</div>
					{local && <div className="err pblock-msg">{local}</div>}
				</>
			)}
		</div>
	);
}

function Actions({ projectId, stage, run, busy }: { projectId: string; stage: string; run: Run; busy: boolean }) {
	const [folder, setFolder] = useState<string | null>(null);
	const [asking, setAsking] = useState(false);
	const [text, setText] = useState("");
	return (
		<div className="pactions">
			<div className="row">
				<button
					disabled={busy}
					title="Reģistri un vārtu kopsavilkumi failos lietotnes datu mapē; biroja mapē nekas netiek rakstīts"
					onClick={() =>
						run(async () => {
							const files = await call("process.export", projectId);
							// the folder is the one the files were written into
							setFolder(files.length ? files[0].replace(/[\\/][^\\/]*$/, "") : null);
							return files.length ? `Izveidoti faili: ${files.length}.` : "Nekas netika izveidots.";
						})
					}
				>
					Eksportēt reģistrus
				</button>
				<button disabled={busy} onClick={() => setAsking(!asking)} title="Pasūtītāja pieprasīta izmaiņa: aģents bpv novērtē ietekmi">
					Klienta izmaiņa…
				</button>
				{stage === "mācības" && (
					<>
						<button disabled={busy} onClick={() => run(async () => `Pajautāti: ${(await call("process.learn", projectId)).asked.join(", ") || "neviens"}`)} title="Katram profila aģentam uzdevums: ierakstīt projekta mācības biroja atmiņā kā priekšlikumus">
							Mācības
						</button>
						<button disabled={busy} className="primary" onClick={() => run(async () => void (await call("process.finish", projectId)))} title="Mācību priekšlikumi ir pārskatīti">
							Pabeigt
						</button>
					</>
				)}
			</div>
			{folder && (
				<div className="row small">
					<span className="dim">Mape:</span>
					<span className="mono pfolder">{folder}</span>
					<button className="small ghost" onClick={() => run(() => call("files.open", projectId, "dati", FOLDER))}>
						Atvērt mapi
					</button>
				</div>
			)}
			{asking && (
				<div className="pchange">
					<textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ko pasūtītājs prasa mainīt?" />
					<div className="row">
						<button
							className="primary"
							disabled={busy || !text.trim()}
							onClick={() =>
								run(async () => {
									const n = await call("process.change", projectId, text.trim());
									setText("");
									setAsking(false);
									return `Izmaiņa nosūtīta aģentam bpv (piezīme ${n.id}).`;
								})
							}
						>
							Sūtīt
						</button>
						<button className="ghost" onClick={() => setAsking(false)}>
							Aizvērt
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

/** Newest first: what changed in the profile and why. */
function History({ changes }: { changes: { at: string; what: string; why: string }[] }) {
	if (changes.length === 0) return <div className="dim small">Profila izmaiņu vēl nav.</div>;
	return (
		<div className="phistory">
			<div className="dim small">Profila izmaiņu vēsture</div>
			{[...changes].reverse().map((c, i) => (
				<div key={i} className="ps-recent small">
					<span className="dim mono">{c.at.slice(0, 10)}</span>
					<span className="grow">
						{c.what}
						<span className="dim"> · {c.why}</span>
					</span>
				</div>
			))}
		</div>
	);
}
