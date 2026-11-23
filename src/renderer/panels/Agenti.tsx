// Aģenti: the team, grouped by department. A header per department (name, its lead, up / down, rename, remove when empty) with its agents under it as cards (name, id, what it is
// for, provider and model, backup, skills, a mark on the department's lead); an agent is dragged to another department or place (agents.move); a department is dragged or stepped to
// another place and added, renamed or removed (departments.save); agents in none are the group «Bez nodaļas». A card opens the agent's settings dialog (AgentDialog.tsx).
// «Importēt BD komandu…» reads the user's team folder (the 16 role files and their skills) and shows what it made, updated and skipped (agents.importTeam).
// The rules every agent gets (agents\_kopejie.md) and the number of parallel helpers stay at the top; the limits on how far agents talk are on the page below (AgentiPage).
//
// Ported from OpenMausBot (Apache-2.0): the grouped layout and the drag rules are SidebarSections.tsx / SidebarSectionHeader.tsx / SidebarBotDrag.tsx as src/renderer/shell/ThreadList.tsx
// already took them (the rules are in shell/sidebar-tree.ts, used here as they are); the agent dialog is src/components/BotSettingsDialog.tsx (AgentDialog.tsx).
// Adapted: this page lists agents with their settings, not conversations, and a department has an optional lead (the agent that assigns inside it; BPV when none).
import { useEffect, useMemo, useState, type HTMLAttributes } from "react";
import { SHARED_MAX, type AgentSpec, type AgentSpecRow, type TeamImportReport } from "../../shared/agent-types";
import type { ProviderRow } from "../../shared/api";
import { departmentOf, type Department } from "../../shared/departments";
import { call, errText } from "../bridge";
import { Badge, Err, useLoad } from "../ui";
import { locale, tr } from "../i18n";
import { windows } from "../windows";
import { AGENT_DRAG_TYPE, DEPARTMENT_DRAG_TYPE, dropPlace, moveDepartment, placeDepartment, planAgentDrop, sameDrop, unusedName, type AgentDrop, type DropPlace } from "../shell/sidebar-tree";
import { AgentDialog, EMPTY_DRAFT, type Draft } from "./AgentDialog";

const nf = (n: number) => n.toLocaleString(locale()).replace(/ /g, " ");

/** The rules every agent gets (agents\_kopejie.md). Saved on its own: it is a file, not part of the specs. */
function SharedRules({ onSaved }: { onSaved: () => void }) {
	const [saved, setSaved] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [err, setErr] = useState<string | null>(null);
	useEffect(() => {
		call("agents.shared.get")
			.then((t) => {
				setSaved(t);
				setText(t);
			})
			.catch((e) => setErr(errText(e)));
	}, []);
	const dirty = saved !== null && text !== saved;
	return (
		<div className="confirm">
			<div className="row">
				<b className="grow">{tr("Kopējie noteikumi")}</b>
				<span className={`counter ${text.length > SHARED_MAX ? "bad" : ""}`}>
					{nf(text.length)} / {nf(SHARED_MAX)}
				</span>
			</div>
			<div className="small dim">{tr("Šo tekstu saņem katrs speciālists pirms savas lomas (agents\\_kopejie.md). Iepriekšējais teksts paliek mapē agents\\versions.")}</div>
			{err && <div className="err">{err}</div>}
			<textarea style={{ width: "100%", minHeight: 90 }} value={text} disabled={saved === null} onChange={(e) => setText(e.target.value)} />
			<div className="row">
				<button
					className="primary"
					disabled={!dirty || text.length > SHARED_MAX}
					onClick={async () => {
						setErr(null);
						try {
							await call("agents.shared.set", text);
							setSaved(text);
							onSaved();
						} catch (e) {
							setErr(errText(e));
						}
					}}
				>
					{tr("Saglabāt noteikumus")}
				</button>
				{dirty && <span className="small">{tr("nesaglabāts")}</span>}
			</div>
		</div>
	);
}

/** What an import did, in words the user can act on. */
function ImportReport({ r, names, onClose }: { r: TeamImportReport; names: Map<string, string>; onClose: () => void }) {
	const nm = (id: string) => names.get(id) ?? id;
	return (
		<div className="confirm ag-report">
			<div className="row">
				<b className="grow">{tr("Komandas imports")}</b>
				<span className="mono small dim">{r.folder}</span>
				<button className="ghost small" onClick={onClose}>
					{tr("Aizvērt")}
				</button>
			</div>
			<div className="small">
				{tr("Izveidoti: {n}", { n: r.created.length })}
				{r.created.length > 0 && ` (${r.created.map(nm).join(", ")})`}
			</div>
			<div className="small">
				{tr("Atjaunoti (tavi iestatījumi paturēti): {n}", { n: r.updated.length })}
				{r.updated.length > 0 && ` (${r.updated.map(nm).join(", ")})`}
			</div>
			{r.skipped.length > 0 && (
				<div className="small err">
					{tr("Izlaisti: {n}", { n: r.skipped.length })}
					{r.skipped.map((s) => (
						<div key={s.id}>
							{nm(s.id)}: {s.why}
						</div>
					))}
				</div>
			)}
			{r.missing.length > 0 && <div className="small">{tr("Mapē nav lomu failu ar numuriem: {list}", { list: r.missing.join(", ") })}</div>}
			<div className="small">
				{tr("Prasmes: importētas {a}, jau bija bibliotēkā {b}, atteiktas {c}; aģentiem piešķirti nosaukumi kopā: {d}", { a: r.skills.imported.length, b: r.skills.kept.length, c: r.skills.refused.length, d: r.assigned })}
			</div>
			{r.skills.refused.map((s) => (
				<div key={s.name} className="small err">
					{s.name}: {s.why}
				</div>
			))}
			{r.skills.notReady > 0 && (
				<div className="row">
					<span className="small">{tr("{n} prasmes vēl ir melnraksti: aģents tās zinās pēc tam, kad tās atzīmēsi kā pārbaudītas.", { n: r.skills.notReady })}</span>
					<button className="small ghost" onClick={() => windows.open("prasmes")}>
						{tr("Prasmes…")}
					</button>
				</div>
			)}
		</div>
	);
}

/** One agent's card. */
function Card({ a, deptLead, provider, model, backup, drag }: { a: AgentSpecRow; deptLead: boolean; provider: string; model: string; backup: string; drag: HTMLAttributes<HTMLDivElement> }) {
	return (
		<div className="ag-card" {...drag}>
			<div className="row">
				<b className="grow ag-card-name">{a.name || tr("(bez nosaukuma)")}</b>
				{deptLead && (
					<Badge tone="info" title={tr("Nodaļas vadītājs")}>
						{tr("vadītājs")}
					</Badge>
				)}
				<span className="mono small dim">{a.id}</span>
			</div>
			<div className="small dim ag-desc">{a.description || <i>{tr("nav apraksta")}</i>}</div>
			<div className="small ag-meta">
				<span title={tr("Pakalpojums un modelis")}>
					{provider} · {model}
				</span>
				<span title={tr("Rezerve")}>
					{tr("rezerve")}: {backup}
				</span>
				<span title={tr("Prasmes")}>
					{tr("prasmes")}: {a.skills?.length ?? 0}
				</span>
				{a.mcp?.length ? <span>MCP: {a.mcp.length}</span> : null}
				{a.check ? <span>{tr("pārbaude")}</span> : null}
			</div>
		</div>
	);
}

export function Agenti() {
	const view = useLoad(() => call("agents.list"), []);
	const providers = useLoad<ProviderRow[]>(() => call("agent.providers"), []);
	const settings = useLoad(() => call("settings.get"), []);
	const depts = useLoad(() => call("departments.list"), []);
	const [open, setOpen] = useState<{ agent: Draft; isNew: boolean } | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [report, setReport] = useState<TeamImportReport | null>(null);
	const [importing, setImporting] = useState(false);
	const [drag, setDrag] = useState<{ kind: "agent" | "department"; id: string } | null>(null);
	const [agentDrop, setAgentDrop] = useState<AgentDrop | null>(null);
	const [deptDrop, setDeptDrop] = useState<{ id: string; place: DropPlace } | null>(null);
	const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
	const [adding, setAdding] = useState("");

	const v = view.data;
	const departments: Department[] = useMemo(() => depts.data?.departments ?? [], [depts.data]);
	const reload = () => {
		view.reload();
		depts.reload();
		settings.reload();
	};
	const run = async (p: Promise<unknown>) => {
		setErr(null);
		try {
			await p;
			reload();
		} catch (e) {
			setErr(errText(e));
		}
	};

	// the groups: each department with its agents in list order; agents in none, or in a department the list no longer has, are the last group
	const groups = useMemo(() => {
		const specs = v?.specs ?? [];
		const known = new Set(departments.map((d) => d.id));
		const g: { dept: Department | null; agents: AgentSpecRow[] }[] = departments.map((d) => ({ dept: d, agents: specs.filter((s) => departmentOf(s) === d.id) }));
		g.push({
			dept: null,
			agents: specs.filter((s) => {
				const d = departmentOf(s);
				return d === undefined || !known.has(d);
			}),
		});
		return g;
	}, [v, departments]);
	const lists = useMemo(() => new Map(groups.map((g) => [g.dept?.id ?? "", g.agents.map((a) => a.id)])), [groups]);
	const names = useMemo(() => new Map((v?.specs ?? []).map((s) => [s.id, s.name])), [v]);

	const endDrag = () => {
		setDrag(null);
		setAgentDrop(null);
		setDeptDrop(null);
	};
	const dropAgent = (d: AgentDrop) => {
		const id = drag?.kind === "agent" ? drag.id : null;
		endDrag();
		const mv = id ? planAgentDrop(lists, id, d) : null;
		if (id && mv) void run(call("agents.move", id, mv.department, mv.before));
	};
	const saveDepartments = (list: Department[]) => run(call("departments.save", list));
	const ids = departments.map((d) => d.id);
	const reorder = (next: string[]) => {
		if (next.length === ids.length && next.every((x, k) => x === ids[k])) return;
		void saveDepartments(next.map((id) => departments.find((d) => d.id === id)!));
	};

	const importFrom = async (folder: string) => {
		setErr(null);
		setImporting(true);
		try {
			const r = await call("agents.importTeam", folder);
			setReport(r);
			reload();
		} catch (e) {
			setErr(errText(e));
		} finally {
			setImporting(false);
		}
	};
	const pickAndImport = async () => {
		try {
			const f = await call("dialog.pickFolder", tr("Mape ar BD komandu (01_….md … 16_….md un mape skilli)"));
			if (f) await importFrom(f);
		} catch (e) {
			setErr(errText(e));
		}
	};

	const providerLabel = (id: string | undefined) => (id ? (providers.data?.find((p) => p.id === id)?.label ?? id) : (providers.data?.find((p) => p.id === settings.data?.provider)?.label ?? settings.data?.provider ?? "—"));
	const modelLabel = (providerId: string | undefined, model: string | undefined) => {
		const m = model || (providerId ? "" : (settings.data?.model ?? ""));
		if (!m) return tr("noklusējuma modelis");
		return providers.data?.find((p) => p.id === (providerId || settings.data?.provider))?.models.find((x) => x.id === m)?.name ?? m;
	};
	const cardOf = (a: AgentSpecRow, deptLead: boolean) => {
		const mark = agentDrop?.kind === "row" && agentDrop.agentId === a.id ? `drop-${agentDrop.place}` : "";
		return (
			<div key={a.id} className={`ag-cardwrap ${mark} ${drag?.kind === "agent" && drag.id === a.id ? "dragging" : ""}`}>
				<Card
					a={a}
					deptLead={deptLead}
					provider={providerLabel(a.provider)}
					model={modelLabel(a.provider, a.model)}
					backup={a.backup ? `${providerLabel(a.backup.provider)} · ${modelLabel(a.backup.provider, a.backup.model)}` : tr("nav")}
					drag={{
						draggable: true,
						onDragStart: (e) => {
							e.stopPropagation();
							e.dataTransfer.effectAllowed = "move";
							e.dataTransfer.setData(AGENT_DRAG_TYPE, a.id);
							setDrag({ kind: "agent", id: a.id });
						},
						onDragEnd: endDrag,
						onDragOver: (e) => {
							if (drag?.kind !== "agent") return;
							e.preventDefault();
							e.stopPropagation();
							const r = e.currentTarget.getBoundingClientRect();
							const next: AgentDrop | null = a.id === drag.id ? null : { kind: "row", agentId: a.id, place: dropPlace(e.clientY - r.top, r.height) };
							setAgentDrop((prev) => (sameDrop(prev, next) ? prev : next));
						},
						onDrop: (e) => {
							if (drag?.kind !== "agent") return;
							e.preventDefault();
							e.stopPropagation();
							if (a.id === drag.id) return endDrag();
							const r = e.currentTarget.getBoundingClientRect();
							dropAgent({ kind: "row", agentId: a.id, place: dropPlace(e.clientY - r.top, r.height) });
						},
					}}
				/>
				<button className="small ag-edit" onClick={() => setOpen({ agent: { ...a }, isNew: false })}>
					{tr("Labot")}
				</button>
			</div>
		);
	};

	const agentDragging = drag?.kind === "agent";
	return (
		<div>
			<Err error={err} />
			{view.error ? <Err error={view.error} /> : null}
			{v && (
				<div className="row">
					<label>
						{tr("Cik palīgi drīkst strādāt reizē")}{" "}
						<select value={v.maxParallel} onChange={(e) => run(call("settings.set", { maxParallelAgents: Number(e.target.value) }))}>
							{[1, 2, 3, 4, 5, 6].map((n) => (
								<option key={n}>{n}</option>
							))}
						</select>
					</label>
					<span className="dim small">{tr("Katrs palīgs ir atsevišķs modeļa izsaukums ar savu kontekstu, un maksā savus tokenus (skat. Izmantojums).")}</span>
				</div>
			)}
			<div className="dim small">
				{tr("Speciālistiem aģents var uzdot darbu (delegate). Viņi nevar redzēt sarunu un nevar palaist citus aģentus. Rīkus, kuriem vajag tavu apstiprinājumu, var dot tikai speciālistam ar līmeni «apstiprina lietotājs». Izmaiņas nodevuma mapē un projekta datos viņi veic pa vienam, lai nesadurtos.")}
				{v?.shipped ? tr(" Šobrīd ir piegādātais saraksts; tas saglabājas, kad saglabā kādu aģentu vai importē komandu.") : ""}
			</div>
			<SharedRules onSaved={() => view.reload()} />

			<div className="row ag-toolbar">
				<button className="primary" disabled={importing} onClick={pickAndImport} title={tr("Nolasa mapi ar 16 lomu failiem un prasmēm un izveido vai atjauno aģentus")}>
					{importing ? tr("Importē…") : tr("Importēt BD komandu…")}
				</button>
				{settings.data?.teamFolder && (
					<button className="ghost" disabled={importing} onClick={() => importFrom(settings.data!.teamFolder!)} title={settings.data.teamFolder}>
						{tr("Vēlreiz no pēdējās mapes")}
					</button>
				)}
				{settings.data?.teamFolder && <span className="small dim mono">{settings.data.teamFolder}</span>}
			</div>
			{report && <ImportReport r={report} names={names} onClose={() => setReport(null)} />}

			{groups.map((g) => {
				const d = g.dept;
				const key = d?.id ?? "";
				// the lead is shown only while it is still in the department (the handler drops a stale one on every save)
				const leadId = d?.lead && g.agents.some((a) => a.id === d.lead) ? d.lead : undefined;
				if (!d && g.agents.length === 0 && !agentDragging) return null;
				const dropInto = agentDragging && agentDrop?.kind === "end" && agentDrop.list === key;
				const hmark = deptDrop && d && deptDrop.id === d.id ? `drop-${deptDrop.place}` : "";
				const at = d ? ids.indexOf(d.id) : -1;
				return (
					<div key={key || "none"} className={`ag-dept ${dropInto ? "drop-into" : ""}`}>
						<div
							className={`ag-dept-head ${hmark} ${drag?.kind === "department" && drag.id === d?.id ? "dragging" : ""}`}
							draggable={!!d}
							onDragStart={
								d
									? (e) => {
											e.dataTransfer.effectAllowed = "move";
											e.dataTransfer.setData(DEPARTMENT_DRAG_TYPE, d.id);
											setDrag({ kind: "department", id: d.id });
										}
									: undefined
							}
							onDragEnd={endDrag}
							onDragOver={(e) => {
								if (drag?.kind === "department" && d && drag.id !== d.id) {
									e.preventDefault();
									const r = e.currentTarget.getBoundingClientRect();
									const next = { id: d.id, place: dropPlace(e.clientY - r.top, r.height) };
									setDeptDrop((p) => (p && p.id === next.id && p.place === next.place ? p : next));
								} else if (agentDragging) {
									e.preventDefault();
									const next: AgentDrop = { kind: "end", list: key };
									setAgentDrop((p) => (sameDrop(p, next) ? p : next));
								}
							}}
							onDrop={(e) => {
								e.preventDefault();
								if (drag?.kind === "department" && d && deptDrop?.id === d.id) {
									const next = placeDepartment(ids, drag.id, d.id, deptDrop.place);
									endDrag();
									reorder(next);
								} else if (agentDragging) dropAgent({ kind: "end", list: key });
								else endDrag();
							}}
						>
							{renaming && d && renaming.id === d.id ? (
								<input
									autoFocus
									className="grow"
									value={renaming.text}
									maxLength={60}
									onChange={(e) => setRenaming({ id: d.id, text: e.target.value })}
									onKeyDown={(e) => {
										if (e.key === "Escape") setRenaming(null);
										if (e.key === "Enter") {
											const name = renaming.text.replace(/\s+/g, " ").trim();
											setRenaming(null);
											if (name && name !== d.name) void saveDepartments(departments.map((x) => (x.id === d.id ? { ...x, name } : x)));
										}
									}}
									onBlur={() => setRenaming(null)}
								/>
							) : (
								<b className="ag-dept-name grow">{d ? d.name : tr("Bez nodaļas")}</b>
							)}
							<span className="small dim">{g.agents.length}</span>
							{d && (
								<>
									<label className="small dim" title={tr("Vadītājs uzdod darbus savā nodaļā un uztur tās atmiņu; bez vadītāja to dara BPV.")}>
										{tr("vadītājs")}{" "}
										<select value={leadId ?? ""} onChange={(e) => void saveDepartments(departments.map((x) => (x.id === d.id ? (e.target.value ? { ...x, lead: e.target.value } : { id: x.id, name: x.name }) : x)))}>
											<option value="">{tr("BPV (noklusējums)")}</option>
											{g.agents.map((a) => (
												<option key={a.id} value={a.id}>
													{a.name || a.id}
												</option>
											))}
										</select>
									</label>
									<button className="ghost small" disabled={at <= 0} title={tr("Augstāk")} onClick={() => reorder(moveDepartment(ids, d.id, -1))}>
										▲
									</button>
									<button className="ghost small" disabled={at >= ids.length - 1} title={tr("Zemāk")} onClick={() => reorder(moveDepartment(ids, d.id, 1))}>
										▼
									</button>
									<button className="ghost small" onClick={() => setRenaming({ id: d.id, text: d.name })}>
										{tr("Pārdēvēt")}
									</button>
									<button
										className="ghost small"
										disabled={g.agents.length > 0}
										title={g.agents.length > 0 ? tr("Nodaļa nav tukša: vispirms pārvieto aģentus") : tr("Izņemt tukšo nodaļu")}
										onClick={() => window.confirm(tr("Izņemt nodaļu {name}?", { name: d.name })) && void saveDepartments(departments.filter((x) => x.id !== d.id))}
									>
										{tr("Izņemt")}
									</button>
								</>
							)}
							<button className="ghost small" onClick={() => setOpen({ agent: { ...EMPTY_DRAFT, department: d ? d.id : "" }, isNew: true })}>
								{tr("+ aģents")}
							</button>
						</div>
						<div className="ag-cards">
							{g.agents.map((a) => cardOf(a, leadId === a.id))}
							{g.agents.length === 0 && <div className="ag-slot small dim">{agentDragging ? tr("Nomet šeit") : tr("nav aģentu")}</div>}
						</div>
					</div>
				);
			})}

			<div className="row">
				<input
					value={adding}
					placeholder={unusedName(tr("Jauna nodaļa"), departments.map((d) => d.name))}
					maxLength={60}
					onChange={(e) => setAdding(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && document.getElementById("ag-add-dept")?.click()}
				/>
				<button
					id="ag-add-dept"
					onClick={() => {
						const name = (adding.trim() || unusedName(tr("Jauna nodaļa"), departments.map((d) => d.name))).replace(/\s+/g, " ");
						setAdding("");
						void saveDepartments([...departments, { id: "", name }]);
					}}
				>
					{tr("+ nodaļa")}
				</button>
				{v && v.defaults.some((x) => !v.specs.some((s) => s.id === x.id)) && (
					<button
						className="ghost"
						title={tr("Pievieno piegādātos trīs speciālistus, kuru vēl nav sarakstā (esošie netiek mainīti)")}
						onClick={() =>
							void run(
								call(
									"agents.save",
									[...v.specs.map(({ fixedTokens: _t, ...s }): AgentSpec => s), ...v.defaults.filter((x) => !v.specs.some((s) => s.id === x.id))],
								),
							)
						}
					>
						{tr("Piegādātie")}
					</button>
				)}
			</div>

			{open && v && (
				<AgentDialog
					agent={open.agent}
					isNew={open.isNew}
					all={v.specs}
					departments={departments}
					tools={v.tools}
					providers={providers.data ?? []}
					appProvider={settings.data?.provider ?? ""}
					appModel={settings.data?.model ?? ""}
					onClose={() => setOpen(null)}
					onSaved={reload}
				/>
			)}
		</div>
	);
}
