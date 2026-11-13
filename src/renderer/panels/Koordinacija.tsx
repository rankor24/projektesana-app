// Koordinācija (task 8.9): what every model of the project must agree on, and which model does not. The reference (the marker
// on the base point, the names, the IFC schema, the storeys and their heights) is built from the models, edited here by hand
// (a BIP can contradict itself: the models win where they all agree, and the warning names the BIP), and every current model
// is measured against it, phrased as an instruction to whoever opens that model. The same remarks are findings in Atradumi,
// and the IFC row of a delivery says when its model has some. Nothing here writes to a model.
import { useEffect, useState } from "react";
import type { CoordReference, StoreyScheme } from "../../core/coordination-types";
import type { Delivery } from "../../core/model";
import { call, errText } from "../bridge";
import { Badge, Empty, Err, useLoad } from "../ui";

const GROUP_TONE = { Novietne: "bad", Hierarhija: "warn", "Stāvi": "warn" } as const;

/** "name" or "name | 9450" per line, and back. */
const storeysText = (s: StoreyScheme) => s.storeys.map((n) => (s.elevations?.[n] ? `${n} | ${s.elevations[n]}` : n)).join("\n");
function parseStoreys(text: string): Pick<StoreyScheme, "storeys" | "elevations"> {
	const storeys: string[] = [];
	const elevations: Record<string, string> = {};
	for (const raw of text.split("\n")) {
		const [name, z] = raw.split("|").map((x) => x.trim());
		if (!name) continue;
		storeys.push(name);
		if (z) elevations[name] = z;
	}
	return { storeys, ...(Object.keys(elevations).length ? { elevations } : {}) };
}
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function Koordinacija({ projectId }: { projectId: string }) {
	const [withRevit, setWithRevit] = useState(false);
	const view = useLoad(() => call("coordination.get", projectId, withRevit), [projectId, withRevit]);
	const deliveries = useLoad<Delivery[]>(() => call("deliveries.list", projectId), [projectId]);
	const [draft, setDraft] = useState<CoordReference | null>(null);
	const [schemeText, setSchemeText] = useState<string[]>([]);
	const [bip, setBip] = useState({ x: "", y: "", z: "", schema: "" });
	const [busy, setBusy] = useState<string | null>(null);
	const [msg, setMsg] = useState<string | null>(null);
	const [stage, setStage] = useState("");
	const [guide, setGuide] = useState<string | null>(null);

	// the editor starts from what is saved, and again after every save or re-seed
	useEffect(() => {
		const r = view.data?.reference ?? null;
		setDraft(r ? structuredClone(r) : null);
		setSchemeText(r ? r.storeySchemes.map(storeysText) : []);
	}, [view.data?.reference]);

	const run = (what: string, f: () => Promise<unknown>) => {
		setBusy(what);
		setMsg(null);
		return f()
			.then(() => view.reload())
			.catch((e) => setMsg(errText(e)))
			.finally(() => setBusy(null));
	};
	const declared = () => ({ basePoint: { x: bip.x || undefined, y: bip.y || undefined, z: bip.z || undefined }, schema: bip.schema || undefined });

	if (view.error) return <Err error={view.error} />;
	if (!view.data) return <div className="pane dim small">Nolasa modeļus… (pirmo reizi tas var aizņemt laiku)</div>;
	const v = view.data;

	if (!v.reference || !draft)
		return (
			<div className="pane fill">
				{msg && <div className="err">{msg}</div>}
				<Empty title="nav atsauces">
					Koordinācijas pārbaude mēra katru projekta daļas IFC modeli pret kopīgu atsauci: kubs uz pamatpunkta, projekta / zemes / ēkas nosaukumi, IFC shēma, stāvu nosaukumi un augstumi. {v.models ? `Atrasti ${v.models} modeļi mapēs 1.2_Projekta dalas.` : "Mapēs 1.2_Projekta dalas IFC modeļu nav."}
				</Empty>
				<div className="confirm">
					<b>BIP vērtības (nav obligāti)</b>
					<div className="dim small">BIP tabulas lietotne vēl nelasa. Ja zini, ko BIP prasa, ieraksti: tā vērtība ir svarīgāka par modeļu vienošanos, ja vien visi modeļi ar kubu nepiekrīt citai.</div>
					<div className="row">
						{(["x", "y", "z"] as const).map((a) => (
							<input key={a} placeholder={`pamatpunkts ${a.toUpperCase()}, mm`} value={bip[a]} onChange={(e) => setBip({ ...bip, [a]: e.target.value })} />
						))}
						<input placeholder="IFC shēma (IFC4)" value={bip.schema} onChange={(e) => setBip({ ...bip, schema: e.target.value })} />
					</div>
					<div className="row">
						<span className="grow" />
						<button className="primary" disabled={!v.models || busy !== null} onClick={() => run("seed", () => call("coordination.seed", projectId, declared()))}>
							{busy === "seed" ? "Nolasa modeļus…" : "Izveidot atsauci no modeļiem"}
						</button>
					</div>
				</div>
			</div>
		);

	const set = (patch: Partial<CoordReference>) => setDraft({ ...draft, ...patch });
	const save = () => {
		const schemes = draft.storeySchemes.map((s, i) => ({ ...s, ...parseStoreys(schemeText[i] ?? "") }));
		return run("save", () => call("coordination.save", projectId, { ...draft, storeySchemes: schemes }));
	};
	const drafts = (deliveries.data ?? []).filter((d) => d.draft && !d.draft.copiedTo && !d.sent);

	return (
		<div className="pane fill">
			{msg && <div className="err">{msg}</div>}
			{v.errors.map((e) => (
				<div key={e.file} className="err">
					{e.file}: {e.message}
				</div>
			))}
			{v.revit && withRevit && <div className="dim small">Revit: {v.revit}</div>}
			{v.warnings.length > 0 && (
				<div className="confirm">
					<b>Vēl jāizlemj</b>
					{v.warnings.map((w) => (
						<div key={w} className="small">• {w}</div>
					))}
				</div>
			)}

			<details>
				<summary>
					<b>Atsauce</b> <span className="dim small">{v.reference.seededFrom ? `no: ${v.reference.seededFrom}` : "ievadīta pašu rokām"}{v.reference.updatedAt ? ` · ${v.reference.updatedAt.slice(0, 10)}` : ""}</span>
				</summary>
				<div className="confirm">
					<div className="row">
						<span style={{ width: 130 }}>Pamatpunkts, mm</span>
						{(["x", "y", "z"] as const).map((a) => (
							<input key={a} className="grow" placeholder={a.toUpperCase()} value={draft.basePoint[a]} onChange={(e) => set({ basePoint: { ...draft.basePoint, [a]: e.target.value } })} />
						))}
						<input style={{ width: 70 }} title="Pielaide, mm" value={draft.tolerance} onChange={(e) => set({ tolerance: Number(e.target.value.replace(",", ".")) })} />
					</div>
					<div className="row">
						<span style={{ width: 130 }}>Kuba nosaukumi</span>
						<input className="grow" value={draft.cubeNames.join(", ")} onChange={(e) => set({ cubeNames: list(e.target.value) })} />
					</div>
					<div className="row">
						<span style={{ width: 130 }}>IFC hierarhija</span>
						{(["project", "site", "building", "schema"] as const).map((k) => (
							<input key={k} className="grow" placeholder={{ project: "IfcProject", site: "IfcSite", building: "IfcBuilding", schema: "shēma" }[k]} value={draft.hierarchy[k]} onChange={(e) => set({ hierarchy: { ...draft.hierarchy, [k]: e.target.value } })} />
						))}
					</div>
					<div className="row">
						<span style={{ width: 130 }}>Faila prefikss</span>
						<input className="grow" placeholder="piem. BD427 (tukšs = netiek pārbaudīts)" value={draft.filePrefix} onChange={(e) => set({ filePrefix: e.target.value })} />
					</div>
					{draft.storeySchemes.map((s, i) => (
						<div key={s.id} className="confirm">
							<div className="row">
								<b>{i === 0 ? "Stāvu shēma (pamata)" : "Stāvu shēma"}</b>
								<input className="grow" value={s.label} onChange={(e) => set({ storeySchemes: draft.storeySchemes.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
								{i > 0 && <input className="grow" placeholder="daļas, kas to lieto (UR, BK)" value={s.disciplines.join(", ")} onChange={(e) => set({ storeySchemes: draft.storeySchemes.map((x, k) => (k === i ? { ...x, disciplines: list(e.target.value) } : x)) })} />}
							</div>
							<textarea rows={Math.min(10, Math.max(3, (schemeText[i] ?? "").split("\n").length))} placeholder={"viens stāvs rindā: nosaukums vai nosaukums | augstums mm"} value={schemeText[i] ?? ""} onChange={(e) => setSchemeText(schemeText.map((t, k) => (k === i ? e.target.value : t)))} />
						</div>
					))}
					<div className="row">
						<button className="ghost" disabled={busy !== null} onClick={() => confirm("Pārrakstīt atsauci ar to, par ko vienojušies modeļi? Tavi labojumi atsaucē pazudīs.") && run("seed", () => call("coordination.seed", projectId))}>
							Pārbūvēt no modeļiem
						</button>
						<span className="grow" />
						<button className="primary" disabled={busy !== null} onClick={save}>
							{busy === "save" ? "Saglabā…" : "Saglabāt atsauci"}
						</button>
					</div>
				</div>
			</details>

			<div className="row">
				<b>{v.audit ? `${v.audit.totalLines} ${v.audit.totalLines === 1 ? "labojums" : "labojumi"} ${v.audit.models.length} modeļos` : "—"}</b>
				<label className="small">
					<input type="checkbox" checked={withRevit} onChange={(e) => setWithRevit(e.target.checked)} /> ar atvērtā Revit dokumenta līmeņiem
				</label>
				<span className="grow" />
				<button disabled={busy !== null} onClick={() => run("guide", () => call("coordination.guide", projectId).then((t) => (setGuide(t), setMsg("Instrukcija saglabāta Atmiņā."))))} title="Soļi koplietotajām koordinātēm Revit, ar šī projekta vērtībām">
					Instrukcija Revit
				</button>
				<button disabled={busy !== null} onClick={() => run("report", () => call("coordination.report", projectId, null).then((f) => setMsg(`Atskaite: ${f}`)))}>
					HTML atskaite
				</button>
				{drafts.length > 0 && (
					<>
						<select value={stage} onChange={(e) => setStage(e.target.value)}>
							<option value="">uz nodevumu…</option>
							{drafts.map((d) => (
								<option key={d.id} value={d.id}>{d.label}</option>
							))}
						</select>
						<button disabled={!stage || busy !== null} title="Atskaite tiek ielikta nodevuma staging mapē; šī nodevuma IFC tiek mērīts arī" onClick={() => run("stage", () => call("coordination.report", projectId, stage).then((f) => setMsg(`Ielikta nodevumā: ${f}`)))}>
							Ielikt
						</button>
					</>
				)}
			</div>

			{guide && (
				<details open className="text-page">
					<summary>
						<b>Koplietotās koordinātes: instrukcija</b>
					</summary>
					<pre className="act-pre" style={{ whiteSpace: "pre-wrap" }}>{guide}</pre>
					<button className="small" onClick={() => void navigator.clipboard.writeText(guide)}>Kopēt</button>
				</details>
			)}

			{(v.audit?.models ?? []).map((m) => (
				<div key={`${m.code}|${m.file}`} className="text-page">
					<div className="row">
						<b>{m.code}</b>
						<span className="dim small grow">{m.source === "revit" ? `atvērtais Revit dokuments: ${m.file}` : `${m.file}${m.app ? ` · ${m.app}` : ""}${m.ts ? ` · ${m.ts}` : ""}`}</span>
						{m.groups.length === 0 && <Badge tone="ok">sakrīt ar atsauci</Badge>}
					</div>
					{m.groups.map((g) => (
						<div key={g.g}>
							<div className="small" style={{ marginTop: 6 }}>
								<Badge tone={GROUP_TONE[g.g]}>{g.g}</Badge>
							</div>
							<table className="small">
								<tbody>
									{g.lines.map((l) => (
										<tr key={l.id}>
											<td style={{ width: "24%" }}><b>{l.w}</b></td>
											<td className="bad-text">{l.now}</td>
											<td className="dim" style={{ width: 24 }}>→</td>
											<td className="ok-text">
												{l.to}
												{l.ask && <div className="warn-text">{l.ask}</div>}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					))}
				</div>
			))}
			{v.audit && v.audit.models.length === 0 && <Empty title="no data">Mapēs 1.2_Projekta dalas nav IFC modeļu, ko mērīt.</Empty>}
		</div>
	);
}
