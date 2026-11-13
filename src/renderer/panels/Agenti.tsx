// Iestatījumi → Aģenti (task 8.15): the specialists the agent can hand work to with `delegate`, and how many helpers may work at once.
// A specialist is a name, what it is for (the agent reads this line to choose), its instructions, and the tools it may use besides
// reading. Tools that need the user's batch confirmation cannot be ticked: no one is looking at a helper's confirmation. The agent's
// read-only helpers (`run_subagent`) need no setup. Saved in agents.json of the app data; until the first save the shipped three are used.
import { useEffect, useState } from "react";
import type { AgentSpec } from "../../shared/agent-types";
import { call, errText } from "../bridge";
import { Badge, Err, useLoad } from "../ui";

const EMPTY: AgentSpec = { id: "", name: "", description: "", prompt: "", tools: [] };
const slug = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 30);

export function Agenti() {
	const view = useLoad(() => call("agents.list"), []);
	const [list, setList] = useState<AgentSpec[]>([]);
	const [open, setOpen] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [msg, setMsg] = useState<string | null>(null);
	useEffect(() => {
		if (view.data && !dirty) setList(view.data.specs);
	}, [view.data, dirty]);

	const v = view.data;
	const change = (i: number, patch: Partial<AgentSpec>) => {
		setList(list.map((a, k) => (k === i ? { ...a, ...patch } : a)));
		setDirty(true);
		setMsg(null);
	};
	const save = async () => {
		setErr(null);
		try {
			const saved = await call("agents.save", list);
			setList(saved);
			setDirty(false);
			setMsg("Saglabāts. Aģents jaunos speciālistus redz nākamajā uzdevumā.");
			view.reload();
		} catch (e) {
			setErr(errText(e));
		}
	};

	return (
		<div>
			{err && <div className="err">{err}</div>}
			{view.error ? <Err error={view.error} /> : null}
			{v && (
				<div className="row">
					<label>
						Cik palīgi drīkst strādāt reizē{" "}
						<select value={v.maxParallel} onChange={(e) => call("settings.set", { maxParallelAgents: Number(e.target.value) }).then(() => view.reload())}>
							{[1, 2, 3, 4, 5, 6].map((n) => (
								<option key={n}>{n}</option>
							))}
						</select>
					</label>
					<span className="dim small">Katrs palīgs ir atsevišķs modeļa izsaukums ar savu kontekstu, un maksā savus tokenus (skat. Izmantojums).</span>
				</div>
			)}
			<div className="dim small">
				Speciālistiem aģents var uzdot darbu (delegate). Viņi nevar redzēt sarunu, nevar palaist citus aģentus un nevar izmantot rīkus, kuriem vajag tavu apstiprinājumu. Izmaiņas nodevuma mapē un projekta datos viņi veic pa vienam, lai nesadurtos.
				{v?.shipped ? " Šobrīd ir piegādātais saraksts; tas saglabājas, kad nospied «Saglabāt»." : ""}
			</div>
			{list.map((a, i) => (
				<div key={i} className="confirm">
					<div className="row">
						<b className="grow">{a.name || "(bez nosaukuma)"}</b>
						<span className="mono small dim">{a.id}</span>
						<button className="small ghost" onClick={() => setOpen(open === `${i}` ? null : `${i}`)}>
							{open === `${i}` ? "Aizvērt" : "Labot"}
						</button>
						<button
							className="small ghost"
							onClick={() => {
								setList(list.filter((_, k) => k !== i));
								setDirty(true);
							}}
						>
							Izņemt
						</button>
					</div>
					<div className="small dim">{a.description}</div>
					{open === `${i}` && (
						<div className="pane">
							<label className="row">
								<span style={{ width: 110 }}>Nosaukums</span>
								<input className="grow" value={a.name} onChange={(e) => change(i, { name: e.target.value, ...(a.id === "" || a.id === slug(a.name) ? { id: slug(e.target.value) } : {}) })} />
							</label>
							<label className="row">
								<span style={{ width: 110 }}>Identifikators</span>
								<input className="grow mono" value={a.id} onChange={(e) => change(i, { id: e.target.value })} />
							</label>
							<label className="row">
								<span style={{ width: 110 }}>Kam paredzēts</span>
								<input className="grow" value={a.description} placeholder="viena rinda: pēc tās aģents izvēlas speciālistu" onChange={(e) => change(i, { description: e.target.value })} />
							</label>
							<label>
								<div className="small dim">Norādījums (kā strādāt, kādā valodā, ko neizdomāt)</div>
								<textarea style={{ width: "100%", minHeight: 110 }} value={a.prompt} onChange={(e) => change(i, { prompt: e.target.value })} />
							</label>
							<div className="small dim">Rīki bez lasīšanas (lasīšana vienmēr ir atļauta):</div>
							<div className="row" style={{ flexWrap: "wrap" }}>
								{(v?.tools ?? []).map((t) => (
									<label key={t.name} title={t.description} className="small" style={{ minWidth: 190 }}>
										<input type="checkbox" checked={a.tools.includes(t.name)} onChange={(e) => change(i, { tools: e.target.checked ? [...a.tools, t.name] : a.tools.filter((x) => x !== t.name) })} /> {t.name} <Badge tone="dim">{t.level}</Badge>
									</label>
								))}
							</div>
						</div>
					)}
				</div>
			))}
			<div className="row">
				<button
					onClick={() => {
						setList([...list, { ...EMPTY }]);
						setOpen(`${list.length}`);
						setDirty(true);
					}}
				>
					+ speciālists
				</button>
				<button className="primary" disabled={!dirty} onClick={save}>
					Saglabāt
				</button>
				{v && (
					<button
						className="ghost"
						title="Atgriež piegādātos trīs speciālistus (jau saglabātais tiek pārrakstīts, kad nospied «Saglabāt»)"
						onClick={() => {
							setList(v.defaults);
							setDirty(true);
						}}
					>
						Piegādātie
					</button>
				)}
				{dirty && <span className="small">nesaglabāts</span>}
				{msg && <span className="small">{msg}</span>}
			</div>
		</div>
	);
}
