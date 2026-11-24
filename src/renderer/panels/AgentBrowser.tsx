// Aģenti → «Aģenti» tab: the list of agents on the left and the chosen agent's settings beside it, in the page (no dialog over it).
//
// Taken from BIM Crew (apps/client/src/components/AgentsArtifact.tsx): the two columns, the list header «Aģenti · N» with «+», a row per agent (icon, name, what it is for,
// a mark, a chevron), the selected row lit, the editor with its actions on top and its sections below, and «Izvēlies aģentu» with «+ Jauns aģents» when nothing is chosen.
// From OpenMausBot (Apache-2.0) src/components/bot-panel/PanelShell.tsx and DetailsTab.tsx: the bot's hero and pill tabs (AgentDialog `inline`), the quiet group labels over the
// rows (rows.tsx CardLabel), and the page stack with a back link when there is room for one column only.
// Adapted: the list is grouped by department in the department order (the BD team), with a search; a department's lead carries a mark; picking another agent while the form
// has unsaved changes asks first (BIM Crew drops them silently).
import { useMemo, useState } from "react";
import type { AgentSpecRow } from "../../shared/agent-types";
import type { ProviderRow } from "../../shared/api";
import { BPV_ID, departmentOf, type Department } from "../../shared/departments";
import { call } from "../bridge";
import { Err, useLoad } from "../ui";
import { tr } from "../i18n";
import { AgentAvatar, AgentDialog, EMPTY_DRAFT } from "./AgentDialog";
import { deptHue, type AgentOpen } from "./Agenti";

const fold = (s: string) => s.toLocaleLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** `onDirty`: the form has unsaved changes (the page asks before it changes tab). */
export function AgentBrowser({ selected, onSelect, onImport, onDirty }: { selected: AgentOpen | null; onSelect: (o: AgentOpen | null) => void; onImport: () => void; onDirty: (dirty: boolean) => void }) {
	const view = useLoad(() => call("agents.list"), []);
	const depts = useLoad(() => call("departments.list"), []);
	const providers = useLoad<ProviderRow[]>(() => call("agent.providers"), []);
	const settings = useLoad(() => call("settings.get"), []);
	const [query, setQuery] = useState("");
	const [dirty, setDirtyState] = useState(false);
	const setDirty = (d: boolean) => {
		setDirtyState(d);
		onDirty(d);
	};

	const specs = view.data?.specs ?? [];
	const departments: Department[] = useMemo(() => depts.data?.departments ?? [], [depts.data]);
	const leads = new Set(departments.map((d) => d.lead).filter((x): x is string => !!x));

	// the groups in department order, the agents in list order; agents in none (or in a department that is gone) last
	const groups = useMemo(() => {
		const q = fold(query.trim());
		const hit = (a: AgentSpecRow) => !q || fold(`${a.name} ${a.id} ${a.description}`).includes(q);
		const known = new Set(departments.map((d) => d.id));
		const g = departments.map((d) => ({ id: d.id, name: d.name, agents: specs.filter((a) => departmentOf(a) === d.id && hit(a)) }));
		g.push({
			id: "",
			name: tr("Bez nodaļas"),
			agents: specs.filter((a) => {
				const d = departmentOf(a);
				return (d === undefined || !known.has(d)) && hit(a);
			}),
		});
		return g.filter((x) => x.agents.length > 0);
	}, [specs, departments, query]);

	const pick = (o: AgentOpen | null) => {
		const same = o && selected && JSON.stringify(o) === JSON.stringify(selected);
		if (same) return;
		if (dirty && !window.confirm(tr("Nesaglabātās izmaiņas tiks zaudētas. Turpināt?"))) return;
		setDirty(false);
		onSelect(o);
	};
	const reload = () => {
		view.reload();
		depts.reload();
	};

	const current = selected && "id" in selected ? specs.find((a) => a.id === selected.id) : undefined;
	const isNew = !!selected && "newIn" in selected;
	const draft = current ? { ...current } : isNew ? { ...EMPTY_DRAFT, department: (selected as { newIn: string }).newIn } : null;
	const editorKey = current ? `a:${current.id}` : isNew ? `n:${(selected as { newIn: string }).newIn}` : "";
	const hasTeam = specs.some((a) => a.id === BPV_ID);

	return (
		<div className={`ag-browser ${draft ? "has-sel" : ""}`}>
			<div className="ag-list">
				<div className="row ag-list-head">
					<b className="grow">
						{tr("Aģenti")} · {specs.length}
					</b>
					<button className="ghost small" title={tr("Jauns aģents")} aria-label={tr("Jauns aģents")} onClick={() => pick({ newIn: "" })}>
						+
					</button>
				</div>
				<input type="search" className="ag-list-search" value={query} placeholder={tr("Meklēt aģentu")} onChange={(e) => setQuery(e.target.value)} />
				<div className="ag-list-rows">
					{view.error ? <Err error={view.error} /> : null}
					{groups.map((g) => (
						<div key={g.id || "none"} className="ag-list-group">
							<div className="ag-list-label">
								{g.name} <span className="dim">{g.agents.length}</span>
							</div>
							{g.agents.map((a) => (
								<button key={a.id} type="button" className={`ag-row ${current?.id === a.id ? "on" : ""}`} onClick={() => pick({ id: a.id })} title={a.description}>
									<AgentAvatar id={a.id} name={a.name} hue={deptHue(departmentOf(a), departments)} />
									<span className="ag-row-text">
										<span className="ag-row-name">
											{a.name || a.id}
											{leads.has(a.id) && <span className="ag-row-lead">{tr("vadītājs")}</span>}
										</span>
										<span className="ag-row-desc">{a.description || tr("nav apraksta")}</span>
									</span>
									<span className="ag-row-chev" aria-hidden="true">
										›
									</span>
								</button>
							))}
						</div>
					))}
					{view.data && groups.length === 0 && <div className="small dim ag-list-empty">{query ? tr("Nekas neatbilst.") : tr("Vēl nav aģentu")}</div>}
				</div>
			</div>

			<div className="ag-detail">
				{draft && view.data ? (
					<>
						<button className="ghost small ag-back" onClick={() => pick(null)}>
							‹ {tr("Aģenti")}
						</button>
						<AgentDialog
							key={editorKey}
							inline
							agent={draft}
							isNew={isNew}
							all={specs}
							departments={departments}
							tools={view.data.tools}
							providers={providers.data ?? []}
							appProvider={settings.data?.provider ?? ""}
							appModel={settings.data?.model ?? ""}
							hue={deptHue(departmentOf(draft), departments)}
							onDirty={setDirty}
							onClose={() => {
								setDirty(false);
								onSelect(null);
							}}
							onSaved={reload}
						/>
					</>
				) : (
					<div className="ag-detail-empty">
						<div className="dim">{tr("Izvēlies aģentu, lai to labotu")}</div>
						<div className="row">
							<button onClick={() => pick({ newIn: "" })}>{tr("+ Jauns aģents")}</button>
							{view.data && !hasTeam && (
								<button className="primary" onClick={onImport}>
									{tr("Importēt BD komandu…")}
								</button>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
