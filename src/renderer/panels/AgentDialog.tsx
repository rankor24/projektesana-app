// The settings dialog of one agent (opened from its card on the Aģenti page): role text, name and description, department, provider + model + effort, backup, the tools
// ceiling and the tool selection, who it may message, skills, MCP servers, and check before done.
//
// Ported from OpenMausBot (Apache-2.0) src/components/BotSettingsDialog.tsx and src/components/bot-settings/*: the dialog as one window with a section list beside the
// fields (IdentitySection, ModelSection, PermissionsSection, the skills card, CheckWorkSetting) and one Save that applies the whole form. Adapted: OpenMausBot saves each field
// as it is changed; here a change is kept in the dialog until Saglabāt, because a role text and the spec are two writes (the file first, then agents.save, which checks the
// file exists and measures the standing context). Left out: the bot's phone apps, memory and routines sections (other phases).
import { useEffect, useMemo, useState } from "react";
import { AGENT_CHECKS_MAX, ROLE_MAX, SPECIALIST_FIXED_MAX, type AgentMcpServer, type AgentSpec, type AgentSpecRow, type AgentToolRow } from "../../shared/agent-types";
import type { ProviderRow } from "../../shared/api";
import { departmentOf, type Department } from "../../shared/departments";
import type { SkillInfo } from "../../shared/skill-types";
import { call, errText } from "../bridge";
import { locale, tr } from "../i18n";
import { Badge } from "../ui";
import { McpSection } from "./AgentMcp";

/** A spec as the dialog edits it: `role` is the text of its file (undefined = not read yet), `roleDirty` = changed here and not written yet. */
export type Draft = AgentSpec & { fixedTokens?: number; role?: string; roleDirty?: boolean };
export const EMPTY_DRAFT: Draft = { id: "", name: "", description: "", prompt: "", tools: [] };

const nf = (n: number) => n.toLocaleString(locale()).replace(/ /g, " ");
const ID_OK = /^[a-z][a-z0-9-]{1,30}$/;
const slug = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 30);

/** What goes to agents.save: the spec without the dialog's own fields. */
export const plain = (d: Draft): AgentSpec => {
	const { fixedTokens: _t, role: _r, roleDirty: _d, ...spec } = d;
	return spec;
};

function Counter({ n, max }: { n: number; max: number }) {
	return (
		<span className={`counter ${n > max ? "bad" : ""}`}>
			{nf(n)} / {nf(max)}
		</span>
	);
}

/** Who an agent may message / take messages from. Three states, always spelled out: not set = visi, [] = neviens, or the ticked ids. */
function AclEditor({ label, value, options, onChange }: { label: string; value: string[] | undefined; options: { id: string; name: string }[]; onChange: (v: string[] | undefined) => void }) {
	const state = value === undefined ? tr("visi") : value.length === 0 ? tr("neviens") : tr("izvēlēti");
	// with nothing set everybody is allowed, so every box shows ticked; unticking one starts an explicit list
	const on = (id: string) => value === undefined || value.includes(id);
	const toggle = (id: string, yes: boolean) => {
		const base = value ?? options.map((o) => o.id);
		onChange(yes ? [...new Set([...base, id])] : base.filter((x) => x !== id));
	};
	return (
		<div className="ag-acl">
			<div className="row">
				<span className="small dim">{label}:</span>
				<b className="small">{state}</b>
				<button className="small ghost" disabled={value === undefined} onClick={() => onChange(undefined)}>
					{tr("Visi")}
				</button>
				<button className="small ghost" disabled={value !== undefined && value.length === 0} onClick={() => onChange([])}>
					{tr("Neviens")}
				</button>
			</div>
			<div className="row" style={{ flexWrap: "wrap" }}>
				{options.map((o) => (
					<label key={o.id} className="small" style={{ minWidth: 190 }}>
						<input type="checkbox" checked={on(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} /> {o.name}
					</label>
				))}
			</div>
		</div>
	);
}

type Section = "role" | "general" | "model" | "tools" | "reach" | "skills" | "mcp" | "check";

interface Props {
	/** the agent to edit; a new one has an empty id */
	agent: Draft;
	isNew: boolean;
	/** every agent of the list now (the others, for reach and checks) */
	all: AgentSpecRow[];
	departments: Department[];
	tools: AgentToolRow[];
	providers: ProviderRow[];
	/** the app's own provider and model: what "kā iestatījumos" means */
	appProvider: string;
	appModel: string;
	onClose: () => void;
	/** after a save that went through: the page reloads */
	onSaved: () => void;
}

export function AgentDialog({ agent, isNew, all, departments, tools, providers, appProvider, appModel, onClose, onSaved }: Props) {
	const [a, setA] = useState<Draft>(agent);
	const [section, setSection] = useState<Section>("role");
	const [err, setErr] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [skills, setSkills] = useState<SkillInfo[] | null>(null);
	const [skillQuery, setSkillQuery] = useState("");
	const [lead, setLead] = useState(false);
	const [dirty, setDirty] = useState(false);
	const patch = (p: Partial<Draft>) => {
		setA((x) => ({ ...x, ...p }));
		setDirty(true);
	};

	// the role text and the library are read when the dialog opens
	useEffect(() => {
		let live = true;
		if (agent.id && agent.role === undefined) {
			call("agents.role.get", agent.id)
				.then((t) => live && setA((x) => (x.role === undefined ? { ...x, role: t ?? "" } : x)))
				.catch(() => undefined);
		}
		call("skills.list")
			.then((s) => live && setSkills(s))
			.catch((e) => live && setErr(errText(e)));
		return () => {
			live = false;
		};
	}, [agent.id]);
	const dept = departmentOf(a) ?? "";
	useEffect(() => {
		setLead(!!agent.id && departments.find((d) => d.id === departmentOf(agent))?.lead === agent.id);
	}, [agent.id]);

	const level = a.maxLevel === "confirm" ? "confirm" : "run";
	const others = all.filter((x) => x.id && x.id !== a.id);
	const aclOptions = [...others.map((x) => ({ id: x.id, name: x.name || x.id })), { id: "lead", name: tr("galvenais aģents") }];
	const modelsOf = (providerId: string | undefined) => providers.find((p) => p.id === providerId)?.models.filter((m) => !m.legacy) ?? [];
	const models = modelsOf(a.provider || appProvider);
	const model = models.find((m) => m.id === (a.model || appModel));
	const backupModels = modelsOf(a.backup?.provider);
	const roleLen = a.role?.length ?? 0;

	const save = async () => {
		setErr(null);
		if (!ID_OK.test(a.id)) return setErr(tr("Identifikators: mazie burti, cipari un domuzīme, 2–31 zīmes (piem. dokumenti)."));
		setBusy(true);
		try {
			// a role file is written first: saving the spec checks that the file of an agent with roleFile exists
			const roleFile = a.role !== undefined ? a.role.trim() !== "" : a.roleFile === true;
			if (a.roleDirty && a.role !== undefined) await call("agents.role.set", a.id, a.role);
			const spec = plain({ ...a, roleFile: roleFile || undefined });
			const list = all.map(plain);
			const at = list.findIndex((x) => x.id === agent.id && !isNew);
			const next = at >= 0 ? list.map((x, k) => (k === at ? spec : x)) : [...list, spec];
			await call("agents.save", next);
			// the department's lead is a field of the department: set after the agent is saved in it
			const d = departments.find((x) => x.id === dept);
			if (d && (d.lead === a.id) !== lead && (lead || d.lead === a.id)) {
				await call("departments.save", departments.map((x) => (x.id === d.id ? (lead ? { ...x, lead: a.id } : { id: x.id, name: x.name }) : x)));
			}
			onSaved();
			onClose();
		} catch (e) {
			setErr(errText(e));
		} finally {
			setBusy(false);
		}
	};
	const remove = async () => {
		if (!window.confirm(tr("Izņemt aģentu {name}? Tā sarunas paliek, lomas fails paliek mapē agents.", { name: a.name || a.id }))) return;
		setBusy(true);
		try {
			const prune = (x: string[] | undefined) => (x ? x.filter((id) => id !== a.id) : x);
			await call(
				"agents.save",
				all
					.filter((x) => x.id !== a.id)
					.map(plain)
					.map((x) => ({ ...x, mayMessage: prune(x.mayMessage), acceptsFrom: prune(x.acceptsFrom), ...(x.check?.agent === a.id ? { check: undefined } : {}) })),
			);
			onSaved();
			onClose();
		} catch (e) {
			setErr(errText(e));
		} finally {
			setBusy(false);
		}
	};
	const importRole = async () => {
		setErr(null);
		if (a.roleDirty && !window.confirm(tr("Rediģētais lomas teksts netiks saglabāts. Importēt tāpat?"))) return;
		try {
			const f = await call("dialog.pickFile", tr("Lomas apraksts (.md)"), ["md"]);
			if (!f) return;
			// the file is written at once (the old text is kept); the spec follows when the user saves
			const { chars } = await call("agents.role.import", a.id, f);
			const text = (await call("agents.role.get", a.id)) ?? "";
			setA((x) => ({ ...x, role: text, roleDirty: false, roleFile: true }));
			setDirty(true);
			setErr(null);
			window.alert(tr("Importēts: {chars} zīmes. Nospied «Saglabāt», lai aģents lietotu šo lomu.", { chars: nf(chars) }));
		} catch (e) {
			setErr(errText(e));
		}
	};

	const check = a.check;
	const checkMode: "none" | "agent" | "model" = check?.agent ? "agent" : check?.provider || check?.model ? "model" : "none";
	const setCheck = (mode: "none" | "agent" | "model", p: Partial<NonNullable<AgentSpec["check"]>> = {}) => {
		const maxChecks = p.maxChecks ?? check?.maxChecks ?? AGENT_CHECKS_MAX;
		if (mode === "none") return patch({ check: undefined });
		if (mode === "agent") return patch({ check: { agent: p.agent ?? check?.agent ?? others[0]?.id ?? "", maxChecks } });
		patch({ check: { provider: p.provider ?? check?.provider ?? "", model: p.model ?? check?.model ?? "", maxChecks } });
	};

	const sections: [Section, string][] = [
		["role", tr("Loma")],
		["general", tr("Vispārīgi")],
		["model", tr("Modelis un rezerve")],
		["tools", tr("Rīki")],
		["reach", tr("Sazināšanās")],
		["skills", tr("Prasmes")],
		["mcp", tr("MCP serveri")],
		["check", tr("Pārbaude pirms nodošanas")],
	];
	const badge = (s: Section): string => {
		if (s === "skills") return a.skills?.length ? `${a.skills.length}` : "";
		if (s === "mcp") return a.mcp?.length ? `${a.mcp.length}` : "";
		if (s === "tools") return a.tools.length ? `${a.tools.length}` : "";
		if (s === "check") return check ? "✓" : "";
		return "";
	};

	const visibleSkills = useMemo(() => {
		const q = skillQuery.trim().toLowerCase();
		return (skills ?? []).filter((s) => !q || s.name.includes(q) || s.description.toLowerCase().includes(q) || (s.group ?? "").includes(q));
	}, [skills, skillQuery]);
	const chosenSkills = new Set(a.skills ?? []);

	return (
		<div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
			<div className="modal ag-dialog" role="dialog" aria-label={tr("Aģenta iestatījumi")}>
				<div className="row">
					<b className="grow">{a.name || tr("Jauns aģents")}</b>
					<span className="mono small dim">{a.id}</span>
					<button className="ghost small" onClick={onClose} disabled={busy} aria-label={tr("Aizvērt")}>
						✕
					</button>
				</div>
				<div className="ag-dialog-body">
					<nav className="ag-dialog-nav">
						{sections.map(([k, label]) => (
							<button key={k} className={`ghost ${section === k ? "on" : ""}`} onClick={() => setSection(k)}>
								<span className="grow">{label}</span>
								{badge(k) && <span className="small dim">{badge(k)}</span>}
							</button>
						))}
					</nav>
					<div className="ag-dialog-pane">
						{section === "role" && (
							<>
								<div className="row">
									<span className="small dim grow">
										{tr("Loma (agents\\")}
										{a.id || tr("<id>")}
										{tr(".md): kā šis aģents strādā un kādā balsī runā")}
									</span>
									<Counter n={roleLen} max={ROLE_MAX} />
									<button className="small ghost" disabled={!a.id || !ID_OK.test(a.id)} title={a.id ? tr("Nolasa .md failu un ieraksta to kā lomas tekstu") : tr("Vispirms ieraksti identifikatoru")} onClick={importRole}>
										{tr("Importēt .md")}
									</button>
								</div>
								<textarea
									className="ag-role"
									value={a.role ?? ""}
									disabled={!a.id && !a.name}
									placeholder={a.id ? tr("Lomas teksts (var palikt tukšs, ja aģentam pietiek ar zemāko norādījumu)") : tr("Vispirms ieraksti nosaukumu un identifikatoru (Vispārīgi)")}
									onChange={(e) => patch({ role: e.target.value, roleDirty: true })}
								/>
								<label>
									<div className="small dim">{tr("Papildu norādījums (īss; ja lomas teksta nav, tas ir viss norādījums)")}</div>
									<textarea style={{ width: "100%", minHeight: 60 }} value={a.prompt} onChange={(e) => patch({ prompt: e.target.value })} />
								</label>
								<div className="small">
									{tr("Pastāvīgais konteksts:")}{" "}
									{a.fixedTokens === undefined ? (
										<span className="dim">{tr("tiks izmērīts pēc saglabāšanas")}</span>
									) : (
										<b style={a.fixedTokens > SPECIALIST_FIXED_MAX ? { color: "var(--bad)" } : undefined}>{tr("{fixedTokens} tokeni", { fixedTokens: nf(a.fixedTokens) })}</b>
									)}{" "}
									{tr("(bez Revit rīku aprakstiem)")}
									{a.fixedTokens !== undefined && a.fixedTokens > SPECIALIST_FIXED_MAX && <span style={{ color: "var(--bad)" }}> {tr("— pāri {v}, saglabāt nevarēs", { v: nf(SPECIALIST_FIXED_MAX) })}</span>}
									{dirty && a.fixedTokens !== undefined && <span className="dim"> {tr("(pēc pēdējās saglabāšanas)")}</span>}
								</div>
							</>
						)}

						{section === "general" && (
							<>
								<label className="row">
									<span className="ag-label">{tr("Nosaukums")}</span>
									<input className="grow" value={a.name} onChange={(e) => patch({ name: e.target.value, ...(isNew && (a.id === "" || a.id === slug(a.name)) ? { id: slug(e.target.value) } : {}) })} />
								</label>
								<label className="row">
									<span className="ag-label">{tr("Identifikators")}</span>
									<input className="grow mono" value={a.id} readOnly={!isNew} title={isNew ? "" : tr("Esoša aģenta identifikators nav maināms: pie tā ir sarunas un lomas fails")} onChange={(e) => patch({ id: e.target.value })} />
								</label>
								<label className="row">
									<span className="ag-label">{tr("Kam paredzēts")}</span>
									<input className="grow" value={a.description} placeholder={tr("viena rinda: pēc tās aģents izvēlas speciālistu")} onChange={(e) => patch({ description: e.target.value })} />
								</label>
								<label className="row">
									<span className="ag-label">{tr("Nodaļa")}</span>
									<select
										value={dept}
										onChange={(e) => {
											patch({ department: e.target.value });
											setLead(false);
										}}
									>
										<option value="">{tr("bez nodaļas")}</option>
										{dept && !departments.some((x) => x.id === dept) && <option value={dept}>{dept}</option>}
										{departments.map((x) => (
											<option key={x.id} value={x.id}>
												{x.name}
											</option>
										))}
									</select>
									<span className="small dim">{tr("Pēc noklusējuma raksta visu projektēšanas nodaļu aģentiem un BPV; Kvalitāte (EKS) ir atsevišķi (skat. «Drīkst rakstīt» zemāk).")}</span>
								</label>
								<label className="row">
									<span className="ag-label" />
									<input type="checkbox" checked={lead} disabled={!departments.some((x) => x.id === dept)} onChange={(e) => (setLead(e.target.checked), setDirty(true))} />
									<span>{tr("Šīs nodaļas vadītājs")}</span>
									<span className="small dim">{tr("Vadītājs uzdod darbus savā nodaļā un uztur tās atmiņu; bez vadītāja to dara BPV. Katrai nodaļai ir viens.")}</span>
								</label>
							</>
						)}

						{section === "model" && (
							<>
								<label className="row">
									<span className="ag-label">{tr("Pakalpojums")}</span>
									<select value={a.provider ?? ""} onChange={(e) => patch({ provider: e.target.value || undefined, model: undefined, effort: "" })}>
										<option value="">{tr("kā iestatījumos")}</option>
										{a.provider && !providers.some((p) => p.id === a.provider) && <option value={a.provider}>{a.provider}</option>}
										{providers.map((p) => (
											<option key={p.id} value={p.id}>
												{p.label}
												{p.configured ? "" : tr(" (nav pieslēgts)")}
											</option>
										))}
									</select>
								</label>
								<div className="row">
									<label className="row">
										<span className="ag-label">{tr("Modelis")}</span>
										<select value={a.model ?? ""} onChange={(e) => patch({ model: e.target.value || undefined, effort: "" })}>
											<option value="">{tr("kā iestatījumos")}</option>
											{a.model && !models.some((m) => m.id === a.model) && <option value={a.model}>{a.model}</option>}
											{models.map((m) => (
												<option key={m.id} value={m.id}>
													{m.name}
												</option>
											))}
										</select>
									</label>
									<label className="row">
										<span>{tr("Domāšana")}</span>
										<select value={a.effort ?? ""} onChange={(e) => patch({ effort: e.target.value as AgentSpec["effort"] })}>
											<option value="">{tr("kā iestatījumos")}</option>
											{a.effort && !model?.efforts.includes(a.effort) && <option value={a.effort}>{a.effort}</option>}
											{(model?.efforts ?? []).map((x) => (
												<option key={x}>{x}</option>
											))}
										</select>
									</label>
								</div>
								<div className="row">
									<span className="ag-label">{tr("Rezerve")}</span>
									<select value={a.backup?.provider ?? ""} onChange={(e) => patch({ backup: e.target.value ? { provider: e.target.value, model: "" } : undefined })}>
										<option value="">{tr("nav")}</option>
										{providers.map((p) => (
											<option key={p.id} value={p.id}>
												{p.label}
											</option>
										))}
									</select>
									{a.backup && (
										<select value={a.backup.model} onChange={(e) => patch({ backup: { provider: a.backup!.provider, model: e.target.value } })}>
											<option value="">{tr("izvēlies modeli")}</option>
											{a.backup.model && !backupModels.some((m) => m.id === a.backup!.model) && <option value={a.backup.model}>{a.backup.model}</option>}
											{backupModels.map((m) => (
												<option key={m.id} value={m.id}>
													{m.name}
												</option>
											))}
										</select>
									)}
								</div>
								<div className="small dim">{a.backup && !a.backup.model ? tr("Bez modeļa rezerve netiks saglabāta.") : tr("Kur turpināt, ja pakalpojumam ir limits vai tas nav pieslēgts.")}</div>
							</>
						)}

						{section === "tools" && (
							<>
								<div className="row">
									<span className="ag-label">{tr("Līmenis")}</span>
									{(
										[
											["run", tr("palaiž")],
											["confirm", tr("apstiprina lietotājs")],
										] as const
									).map(([k, text]) => (
										<label key={k} className="small">
											<input
												type="radio"
												name="level"
												checked={level === k}
												onChange={() => {
													// a tool above the new level would be refused on save, so it leaves the list now
													const kept = k === "run" ? a.tools.filter((n) => tools.find((t) => t.name === n)?.level !== "confirm") : a.tools;
													patch({ maxLevel: k, tools: kept });
												}}
											/>{" "}
											{text}
										</label>
									))}
								</div>
								<div className="small dim">{tr("Rīki bez lasīšanas (lasīšana vienmēr ir atļauta)")}{level === "confirm" ? tr("; ar līmeni «apstiprina lietotājs» var dot arī rīkus, kuriem vajag apstiprinājumu:") : ":"}</div>
								<div className="row" style={{ flexWrap: "wrap" }}>
									{tools
										.filter((t) => t.level !== "confirm" || level === "confirm")
										.map((t) => (
											<label key={t.name} title={t.description} className="small" style={{ minWidth: 190 }}>
												<input type="checkbox" checked={a.tools.includes(t.name)} onChange={(e) => patch({ tools: e.target.checked ? [...a.tools, t.name] : a.tools.filter((x) => x !== t.name) })} /> {t.name}{" "}
												<Badge tone={t.level === "confirm" ? "warn" : "dim"}>{t.level}</Badge>
											</label>
										))}
								</div>
							</>
						)}

						{section === "reach" && (
							<>
								<AclEditor label={tr("Drīkst rakstīt")} value={a.mayMessage} options={aclOptions} onChange={(x) => patch({ mayMessage: x })} />
								<AclEditor label={tr("Pieņem no")} value={a.acceptsFrom} options={aclOptions} onChange={(x) => patch({ acceptsFrom: x })} />
							</>
						)}

						{section === "skills" && (
							<>
								<div className="row">
									<input className="grow" value={skillQuery} placeholder={tr("Meklēt prasmi")} onChange={(e) => setSkillQuery(e.target.value)} />
									<span className="small dim">{tr("{n} izvēlētas", { n: chosenSkills.size })}</span>
								</div>
								<div className="small dim">{tr("Aģents zina tikai gatavās prasmes (bez vietturiem un ar tavu atzīmi «pārbaudīta» lapā Prasmes). Melnraksta prasmi var piešķirt jau tagad.")}</div>
								{skills === null && <div className="dim small">{tr("Ielādē…")}</div>}
								{skills?.length === 0 && <div className="dim small">{tr("Prasmju bibliotēka ir tukša: importē prasmes lapā Prasmes vai importē komandu.")}</div>}
								<div className="ag-skills">
									{visibleSkills.map((s) => (
										<label key={s.name} className="ag-skill" title={s.description}>
											<input type="checkbox" checked={chosenSkills.has(s.name)} onChange={(e) => patch({ skills: e.target.checked ? [...(a.skills ?? []), s.name] : (a.skills ?? []).filter((x) => x !== s.name) })} />
											<span className="grow">
												<b className="small">{s.name}</b>
												<span className="small dim"> {s.description.slice(0, 110)}</span>
											</span>
											<Badge tone={s.state === "ready" ? "ok" : "warn"}>{s.state === "ready" ? tr("gatava") : tr("melnraksts")}</Badge>
											{s.group && <span className="small dim">{s.group}</span>}
										</label>
									))}
									{/* a name on the list that the library lacks (yet): shown so it can be taken off */}
									{(a.skills ?? [])
										.filter((n) => skills && !skills.some((s) => s.name === n))
										.map((n) => (
											<label key={n} className="ag-skill">
												<input type="checkbox" checked onChange={() => patch({ skills: (a.skills ?? []).filter((x) => x !== n) })} />
												<span className="grow small">{n}</span>
												<Badge tone="bad">{tr("nav bibliotēkā")}</Badge>
											</label>
										))}
								</div>
							</>
						)}

						{section === "mcp" && <McpSection agentId={a.id} servers={a.mcp ?? []} onChange={(mcp: AgentMcpServer[]) => patch({ mcp: mcp.length ? mcp : undefined })} />}

						{section === "check" && (
							<>
								<div className="small dim">{tr("Pirms aģents nodod atbildi, to izlasa pārbaudītājs un salīdzina ar pieprasījumu: līdz {n} pārbaudēm. Labāk citam pakalpojumam nekā autoram: modelis reti ievēro savas kļūdas.", { n: AGENT_CHECKS_MAX })}</div>
								<div className="row">
									{(
										[
											["none", tr("nav")],
											["agent", tr("cits aģents")],
											["model", tr("modelis")],
										] as const
									).map(([k, text]) => (
										<label key={k} className="small">
											<input type="radio" name="check-mode" checked={checkMode === k} onChange={() => setCheck(k)} /> {text}
										</label>
									))}
								</div>
								{checkMode === "agent" && (
									<label className="row">
										<span className="ag-label">{tr("Pārbauda")}</span>
										<select value={check?.agent ?? ""} onChange={(e) => setCheck("agent", { agent: e.target.value })}>
											{others.map((x) => (
												<option key={x.id} value={x.id}>
													{x.name || x.id}
												</option>
											))}
										</select>
									</label>
								)}
								{checkMode === "model" && (
									<>
										<label className="row">
											<span className="ag-label">{tr("Pakalpojums")}</span>
											<select value={check?.provider ?? ""} onChange={(e) => setCheck("model", { provider: e.target.value, model: "" })}>
												<option value="">{tr("kā iestatījumos")}</option>
												{providers.map((p) => (
													<option key={p.id} value={p.id}>
														{p.label}
													</option>
												))}
											</select>
										</label>
										<label className="row">
											<span className="ag-label">{tr("Modelis")}</span>
											<select value={check?.model ?? ""} onChange={(e) => setCheck("model", { model: e.target.value })}>
												<option value="">{tr("pakalpojuma noklusējums")}</option>
												{check?.model && !modelsOf(check.provider).some((m) => m.id === check.model) && <option value={check.model}>{check.model}</option>}
												{modelsOf(check?.provider || appProvider).map((m) => (
													<option key={m.id} value={m.id}>
														{m.name}
													</option>
												))}
											</select>
										</label>
									</>
								)}
								{checkMode !== "none" && (
									<label className="row">
										<span className="ag-label">{tr("Pārbaužu skaits")}</span>
										<select value={check?.maxChecks ?? AGENT_CHECKS_MAX} onChange={(e) => setCheck(checkMode, { maxChecks: Number(e.target.value) })}>
											{Array.from({ length: AGENT_CHECKS_MAX }, (_, i) => i + 1).map((n) => (
												<option key={n}>{n}</option>
											))}
										</select>
										<span className="small dim">{tr("Katra pārbaude ir pilns modeļa gājiens (izmaksas redzamas darba kartītē).")}</span>
									</label>
								)}
							</>
						)}
					</div>
				</div>
				{err && <div className="err">{err}</div>}
				<div className="row">
					{!isNew && (
						<button className="ghost" onClick={remove} disabled={busy}>
							{tr("Izņemt aģentu")}
						</button>
					)}
					<span className="grow" />
					{dirty && <span className="small">{tr("nesaglabāts")}</span>}
					<button onClick={onClose} disabled={busy}>
						{tr("Atcelt")}
					</button>
					<button className="primary" onClick={save} disabled={busy || (!dirty && !isNew)}>
						{tr("Saglabāt")}
					</button>
				</div>
			</div>
		</div>
	);
}
