// The Agents page, in three tabs like the app's other pages (Grafiks, Faili): «Aģenti» is the list with the chosen agent's settings beside it (AgentBrowser.tsx: BIM Crew's agents
// page with OpenMausBot's bot panel), «Nodaļas» the team by department (Agenti.tsx TeamEditor: drag, lead, order, the BD team import), «Noteikumi» the rules every agent gets, how
// many helpers work at once, the Skills shortcut and the limits on how far agents may talk to each other. «Labot» or «+ aģents» in Nodaļas opens that agent in the Aģenti tab.
// The tab and the agent on screen are remembered while the app runs, as Settings remembers its tab.
import { useEffect, useRef, useState } from "react";
import type { Limits } from "../../shared/thread-types";
import { call, errText } from "../bridge";
import { Err, useLoad } from "../ui";
import { windows } from "../windows";
import { AgentBrowser } from "./AgentBrowser";
import { ParallelHelpers, SharedRules, TeamEditor, type AgentOpen } from "./Agenti";
import { tr } from "../i18n";

type Tab = "agenti" | "nodalas" | "noteikumi";
let lastTab: Tab = "agenti";
let lastAgent: AgentOpen | null = null;

export function AgentiPage() {
	const settings = useLoad(() => call("settings.get"), []);
	const [err, setErr] = useState<string | null>(null);
	const [tab, setTabState] = useState<Tab>(lastTab);
	const [agent, setAgentState] = useState<AgentOpen | null>(lastAgent);
	// the agent form has unsaved changes: leaving the tab asks first (each tab loads its own lists when it opens, so a save is seen by the other)
	const dirty = useRef(false);
	const s = settings.data;
	useEffect(() => {
		setErr(null);
	}, [s]);
	const setTab = (t: Tab) => {
		if (t === tab) return;
		if (dirty.current && !window.confirm(tr("Nesaglabātās izmaiņas tiks zaudētas. Turpināt?"))) return;
		dirty.current = false;
		lastTab = t;
		setTabState(t);
	};
	const setAgent = (o: AgentOpen | null) => {
		lastAgent = o;
		setAgentState(o);
	};
	const saveLimits = async (limits: Limits) => {
		setErr(null);
		try {
			await call("settings.set", { limits });
			settings.reload();
		} catch (e) {
			setErr(errText(e));
		}
	};
	const tabs: [Tab, string][] = [
		["agenti", tr("Aģenti")],
		["nodalas", tr("Nodaļas")],
		["noteikumi", tr("Noteikumi")],
	];
	return (
		<div className={`ag-page ${tab === "agenti" ? "ag-page-split" : ""}`}>
			<div className="tabs" role="tablist" aria-label={tr("Aģenti")}>
				{tabs.map(([k, label]) => (
					<button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
						{label}
					</button>
				))}
			</div>
			<Err error={err} />
			{tab === "agenti" && (
				<AgentBrowser selected={agent} onSelect={setAgent} onImport={() => setTab("nodalas")} onDirty={(d) => (dirty.current = d)} />
			)}
			{tab === "nodalas" && (
				<div className="page-scroll">
					<div className="dim small">{tr("Komanda pa nodaļām: velc aģentu uz citu nodaļu vai vietu, velc nodaļu augstāk vai zemāk; «Labot» atver aģentu cilnē Aģenti.")}</div>
					<TeamEditor
						onOpen={(o) => {
							setAgent(o);
							setTab("agenti");
						}}
					/>
				</div>
			)}
			{tab === "noteikumi" && (
				<div className="page-scroll">
					<ParallelHelpers />
					<SharedRules onSaved={() => undefined} />
					<div className="row">
						<button className="ghost" onClick={() => windows.open("prasmes")}>
							{tr("Prasmes…")}
						</button>
						<span className="dim small">{tr("Biroja prasmju bibliotēka un tas, kuras prasmes kuram aģentam.")}</span>
					</div>
					<div className="section-title">{tr("Aģentu ierobežojumi")}</div>
					{s && <LimitInputs limits={s.limits} save={saveLimits} />}
					<div className="dim small">{tr("Cik tālu aģenti drīkst sarunāties savā starpā. Vilnis ir viss, ko izraisa viena tava darbība; tam sasniedzot robežu, rindā gaidošie darbi apstājas un “Gaida tevi” piedāvā turpināt.")}</div>
				</div>
			)}
		</div>
	);
}

const LIMIT_ROWS: { key: keyof Limits; label: string; min: number; max: number; step?: number }[] = [
	{ key: "exchangesPerTopic", label: tr("Ziņas par vienu tematu (no katras puses)"), min: 1, max: 10 },
	{ key: "chainDepth", label: tr("Ziņu ķēdes dziļums"), min: 1, max: 20 },
	{ key: "runsPerWave", label: tr("Skrējieni vienā vilnī"), min: 1, max: 200 },
	{ key: "waveCost", label: tr("Viļņa izmaksu robeža ($)"), min: 0, max: 100000, step: 0.1 },
	{ key: "taskIterations", label: tr("Uzdevuma iterācijas"), min: 1, max: 10 },
];

/** The five limits. Saved on leaving a field; main puts each into its range, and the field shows what was kept. An empty cost field = no cost limit. */
function LimitInputs({ limits, save }: { limits: Limits; save: (next: Limits) => void }) {
	return (
		<>
			{LIMIT_ROWS.map((r) => (
				<label key={`${r.key}${limits[r.key]}`} className="row">
					<span style={{ width: 260 }}>{r.label}</span>
					<input
						type="number"
						min={r.min}
						max={r.max}
						step={r.step ?? 1}
						defaultValue={limits[r.key] ?? ""}
						placeholder={r.key === "waveCost" ? tr("nav robežas") : undefined}
						style={{ width: 110 }}
						onBlur={(e) => {
							const raw = e.target.value.trim();
							const v = raw === "" ? null : Number(raw);
							if (v !== limits[r.key] && !(v === null && r.key !== "waveCost")) save({ ...limits, [r.key]: v });
						}}
					/>
				</label>
			))}
		</>
	);
}
