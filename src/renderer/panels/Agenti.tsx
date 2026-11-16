// Iestatījumi → Aģenti (task 8.15): the specialists the agent can hand work to with `delegate`, and how many helpers may work at once.
// A specialist is a name, what it is for (the agent reads this line to choose), its instructions, and the tools it may use besides
// reading. Tools that need the user's batch confirmation cannot be ticked: no one is looking at a helper's confirmation. The agent's
// read-only helpers (`run_subagent`) need no setup. Saved in agents.json of the app data; until the first save the shipped three are used.
// 13.5: each agent also has a role text (agents\<id>.md, edited here or imported from a .md), a level, a model and effort of its own, and lists of who it
// may message and accept from; one editor holds the rules every agent gets. The page measures nothing itself: the fixed context comes from the handler.
import { useEffect, useState } from "react";
import { ROLE_MAX, SHARED_MAX, SPECIALIST_FIXED_MAX, type AgentSpec } from "../../shared/agent-types";
import type { ProviderRow } from "../../shared/api";
import { call, errText } from "../bridge";
import { Badge, Err, useLoad } from "../ui";

/** A spec as the page edits it: `role` is the text of its file (undefined = not read yet), `roleDirty` = changed here and not written yet. */
type Draft = AgentSpec & { fixedTokens?: number; role?: string; roleDirty?: boolean };
const EMPTY: Draft = { id: "", name: "", description: "", prompt: "", tools: [] };
const nf = (n: number) => n.toLocaleString("lv-LV").replace(/ /g, " ");
// what goes to agents.save: the spec without the page's own fields
const plain = (d: Draft): AgentSpec => {
	const { fixedTokens: _t, role: _r, roleDirty: _d, ...spec } = d;
	return spec;
};
const slug = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 30);

/** A new id for an agent: its loaded role text then belongs to the new file name, so it is marked to be written there (the old file stays on disk). */
const withId = (a: Draft, id: string): Partial<Draft> => ({ id, ...(a.role !== undefined && id !== a.id ? { roleDirty: true } : {}) });

function Counter({ n, max }: { n: number; max: number }) {
	return <span className={`counter ${n > max ? "bad" : ""}`}>{nf(n)} / {nf(max)}</span>;
}

/** Who an agent may message / take messages from. Three states, always spelled out: not set = visi, [] = neviens, or the ticked ids. */
function AclEditor({ label, value, options, onChange }: { label: string; value: string[] | undefined; options: { id: string; name: string }[]; onChange: (v: string[] | undefined) => void }) {
	const state = value === undefined ? "visi" : value.length === 0 ? "neviens" : "izvēlēti";
	// with nothing set everybody is allowed, so every box shows ticked; unticking one starts an explicit list
	const on = (id: string) => value === undefined || value.includes(id);
	const toggle = (id: string, yes: boolean) => {
		const base = value ?? options.map((o) => o.id);
		onChange(yes ? [...new Set([...base, id])] : base.filter((x) => x !== id));
	};
	return (
		<div>
			<div className="row">
				<span className="small dim">{label}:</span>
				<b className="small">{state}</b>
				<button className="small ghost" disabled={value === undefined} onClick={() => onChange(undefined)}>
					Visi
				</button>
				<button className="small ghost" disabled={value !== undefined && value.length === 0} onClick={() => onChange([])}>
					Neviens
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
				<b className="grow">Kopējie noteikumi</b>
				<Counter n={text.length} max={SHARED_MAX} />
			</div>
			<div className="small dim">Šo tekstu saņem katrs speciālists pirms savas lomas (agents\_kopejie.md). Iepriekšējais teksts paliek mapē agents\versions.</div>
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
					Saglabāt noteikumus
				</button>
				{dirty && <span className="small">nesaglabāts</span>}
			</div>
		</div>
	);
}

export function Agenti() {
	const view = useLoad(() => call("agents.list"), []);
	const providers = useLoad<ProviderRow[]>(() => call("agent.providers"), []);
	const settings = useLoad(() => call("settings.get"), []);
	const [list, setList] = useState<Draft[]>([]);
	const [open, setOpen] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [msg, setMsg] = useState<string | null>(null);
	useEffect(() => {
		if (view.data && !dirty) setList(view.data.specs);
	}, [view.data, dirty]);

	// the role text is read when an agent is opened (and again after a reload that dropped it)
	const openIdx = open === null ? -1 : Number(open);
	const openAgent = list[openIdx];
	useEffect(() => {
		if (!openAgent || openAgent.role !== undefined || !openAgent.id) return;
		let live = true;
		call("agents.role.get", openAgent.id)
			.then((t) => live && setList((l) => l.map((a, k) => (k === openIdx && a.role === undefined ? { ...a, role: t ?? "" } : a))))
			.catch(() => undefined); // an id still being typed is not a valid file name yet
		return () => {
			live = false;
		};
	}, [openAgent?.id, openAgent?.role === undefined, openIdx]);

	const v = view.data;
	const patch = (i: number, p: Partial<Draft>) => {
		setList((l) => l.map((a, k) => (k === i ? { ...a, ...p } : a)));
		setDirty(true);
		setMsg(null);
	};
	const save = async () => {
		setErr(null);
		setMsg(null);
		try {
			// a role file is written first: saving the spec checks that the file of an agent with roleFile exists
			const specs: AgentSpec[] = [];
			for (const [idx, a] of list.entries()) {
				// what the editor shows is what the agent gets: a role text that was read (or typed) switches roleFile on, an empty one off
				const roleFile = a.role !== undefined ? a.role.trim() !== "" : a.roleFile === true;
				if (a.roleDirty && a.role !== undefined) {
					await call("agents.role.set", a.id, a.role);
					// written: a retry after a failed agents.save must not write (and keep a version of) the same text again
					setList((l) => l.map((x, k) => (k === idx ? { ...x, roleDirty: false } : x)));
				}
				specs.push(plain({ ...a, roleFile: roleFile || undefined }));
			}
			const saved = await call("agents.save", specs);
			setList(saved);
			setDirty(false);
			setMsg("Saglabāts. Aģents jaunos speciālistus un lomas redz nākamajā uzdevumā.");
			view.reload();
		} catch (e) {
			setErr(errText(e));
		}
	};
	const importRole = async (i: number) => {
		const a = list[i];
		setErr(null);
		if (a.roleDirty && !window.confirm("Rediģētais lomas teksts netiks saglabāts. Importēt tāpat?")) return;
		try {
			const f = await call("dialog.pickFile", "Lomas apraksts (.md)", ["md"]);
			if (!f) return;
			// the file is written at once (the old text is kept); the spec follows when the user saves
			const { chars } = await call("agents.role.import", a.id, f);
			const text = (await call("agents.role.get", a.id)) ?? "";
			patch(i, { role: text, roleDirty: false, roleFile: true });
			setMsg(`Importēts: ${nf(chars)} zīmes. Nospied «Saglabāt», lai aģents lietotu šo lomu.`);
		} catch (e) {
			setErr(errText(e));
		}
	};
	const remove = (i: number) => {
		const gone = list[i].id;
		const prune = (x: string[] | undefined) => (x ? x.filter((id) => id !== gone) : x);
		setList(list.filter((_, k) => k !== i).map((a) => ({ ...a, mayMessage: prune(a.mayMessage), acceptsFrom: prune(a.acceptsFrom) })));
		setDirty(true);
		setOpen(null);
	};

	const provider = providers.data?.find((p) => p.id === settings.data?.provider);
	const models = provider?.models.filter((m) => !m.legacy) ?? [];

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
				Speciālistiem aģents var uzdot darbu (delegate). Viņi nevar redzēt sarunu un nevar palaist citus aģentus. Rīkus, kuriem vajag tavu apstiprinājumu, var dot tikai speciālistam ar līmeni «apstiprina lietotājs». Izmaiņas nodevuma mapē un projekta datos viņi veic pa vienam, lai nesadurtos.
				{v?.shipped ? " Šobrīd ir piegādātais saraksts; tas saglabājas, kad nospied «Saglabāt»." : ""}
			</div>
			<SharedRules onSaved={() => view.reload()} />
			{list.map((a, i) => {
				const others = list.filter((x, k) => k !== i && x.id).map((x) => ({ id: x.id, name: x.name || x.id }));
				const aclOptions = [...others, { id: "lead", name: "galvenais aģents" }];
				const model = models.find((m) => m.id === (a.model || settings.data?.model));
				const level = a.maxLevel === "confirm" ? "confirm" : "run";
				const roleLen = a.role?.length ?? 0;
				return (
					<div key={i} className="confirm">
						<div className="row">
							<b className="grow">{a.name || "(bez nosaukuma)"}</b>
							<span className="mono small dim">{a.id}</span>
							<button className="small ghost" onClick={() => setOpen(open === `${i}` ? null : `${i}`)}>
								{open === `${i}` ? "Aizvērt" : "Labot"}
							</button>
							<button className="small ghost" onClick={() => remove(i)}>
								Izņemt
							</button>
						</div>
						<div className="small dim">{a.description}</div>
						{open === `${i}` && (
							<div className="pane">
								<label className="row">
									<span style={{ width: 110 }}>Nosaukums</span>
									<input className="grow" value={a.name} onChange={(e) => patch(i, { name: e.target.value, ...(a.id === "" || a.id === slug(a.name) ? withId(a, slug(e.target.value)) : {}) })} />
								</label>
								<label className="row">
									<span style={{ width: 110 }}>Identifikators</span>
									<input className="grow mono" value={a.id} onChange={(e) => patch(i, withId(a, e.target.value))} />
								</label>
								<label className="row">
									<span style={{ width: 110 }}>Kam paredzēts</span>
									<input className="grow" value={a.description} placeholder="viena rinda: pēc tās aģents izvēlas speciālistu" onChange={(e) => patch(i, { description: e.target.value })} />
								</label>

								<div className="row">
									<span className="small dim grow">Loma (agents\{a.id || "<id>"}.md): kā šis aģents strādā un kādā balsī runā</span>
									<Counter n={roleLen} max={ROLE_MAX} />
									<button className="small ghost" disabled={!a.id} title={a.id ? "Nolasa .md failu un ieraksta to kā lomas tekstu" : "Vispirms ieraksti identifikatoru"} onClick={() => importRole(i)}>
										Importēt .md
									</button>
								</div>
								<textarea
									style={{ width: "100%", minHeight: 160 }}
									value={a.role ?? ""}
									placeholder={a.id ? "Lomas teksts (var palikt tukšs, ja aģentam pietiek ar zemāko norādījumu)" : "Vispirms ieraksti identifikatoru"}
									onChange={(e) => patch(i, { role: e.target.value, roleDirty: true })}
								/>
								<label>
									<div className="small dim">Papildu norādījums (īss; ja lomas teksta nav, tas ir viss norādījums)</div>
									<textarea style={{ width: "100%", minHeight: 60 }} value={a.prompt} onChange={(e) => patch(i, { prompt: e.target.value })} />
								</label>
								<div className="small">
									Pastāvīgais konteksts: {a.fixedTokens === undefined ? <span className="dim">tiks izmērīts pēc saglabāšanas</span> : <b style={a.fixedTokens > SPECIALIST_FIXED_MAX ? { color: "var(--bad)" } : undefined}>{nf(a.fixedTokens)} tokeni</b>} (bez Revit rīku aprakstiem)
									{a.fixedTokens !== undefined && a.fixedTokens > SPECIALIST_FIXED_MAX && <span style={{ color: "var(--bad)" }}> — pāri {nf(SPECIALIST_FIXED_MAX)}, saglabāt nevarēs</span>}
									{dirty && a.fixedTokens !== undefined && <span className="dim"> (pēc pēdējās saglabāšanas)</span>}
								</div>

								<div className="row">
									<span style={{ width: 110 }}>Līmenis</span>
									{(
										[
											["run", "palaiž"],
											["confirm", "apstiprina lietotājs"],
										] as const
									).map(([k, text]) => (
										<label key={k} className="small">
											<input
												type="radio"
												name={`level-${i}`}
												checked={level === k}
												onChange={() => {
													// a tool above the new level would be refused on save, so it leaves the list now
													const kept = k === "run" ? a.tools.filter((n) => v?.tools.find((t) => t.name === n)?.level !== "confirm") : a.tools;
													patch(i, { maxLevel: k, tools: kept });
												}}
											/>{" "}
											{text}
										</label>
									))}
								</div>
								<div className="row">
									<label className="row">
										<span style={{ width: 110 }}>Modelis</span>
										<select value={a.model ?? ""} onChange={(e) => patch(i, { model: e.target.value || undefined, effort: "" })}>
											<option value="">kā iestatījumos</option>
											{a.model && !models.some((m) => m.id === a.model) && <option value={a.model}>{a.model}</option>}
											{models.map((m) => (
												<option key={m.id} value={m.id}>
													{m.name}
												</option>
											))}
										</select>
									</label>
									<label className="row">
										<span>Domāšana</span>
										<select value={a.effort ?? ""} onChange={(e) => patch(i, { effort: e.target.value as AgentSpec["effort"] })}>
											<option value="">kā iestatījumos</option>
											{a.effort && !model?.efforts.includes(a.effort) && <option value={a.effort}>{a.effort}</option>}
											{(model?.efforts ?? []).map((x) => (
												<option key={x}>{x}</option>
											))}
										</select>
									</label>
								</div>

								<AclEditor label="Drīkst rakstīt" value={a.mayMessage} options={aclOptions} onChange={(x) => patch(i, { mayMessage: x })} />
								<AclEditor label="Pieņem no" value={a.acceptsFrom} options={aclOptions} onChange={(x) => patch(i, { acceptsFrom: x })} />

								<div className="small dim">Rīki bez lasīšanas (lasīšana vienmēr ir atļauta){level === "confirm" ? "; ar līmeni «apstiprina lietotājs» var dot arī rīkus, kuriem vajag apstiprinājumu:" : ":"}</div>
								<div className="row" style={{ flexWrap: "wrap" }}>
									{(v?.tools ?? [])
										.filter((t) => t.level !== "confirm" || level === "confirm")
										.map((t) => (
											<label key={t.name} title={t.description} className="small" style={{ minWidth: 190 }}>
												<input type="checkbox" checked={a.tools.includes(t.name)} onChange={(e) => patch(i, { tools: e.target.checked ? [...a.tools, t.name] : a.tools.filter((x) => x !== t.name) })} /> {t.name} <Badge tone={t.level === "confirm" ? "warn" : "dim"}>{t.level}</Badge>
											</label>
										))}
								</div>
							</div>
						)}
					</div>
				);
			})}
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
