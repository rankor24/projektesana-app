// The eight pages of Settings, each a few blocks. A block carries `data-settings-block="<anchor>"`: that is what a search result or an
// agent's "please open this" scrolls to, focuses and lights (SettingsWindow.tsx). Every setting the four old tabs had is here, working the same
// way (same calls, same Latvian text); what is new is where it sits (the four groups of shared/settings-index.ts) and the Aģenti group, which
// holds the team editor (the Agents page's own component) and the limits the Agents page also has.
// Moved from panels/Iestatijumi.tsx: the provider table, the sign-in box, model / effort, the backup, automatic recovery, the held providers,
// the usage table, the Revit MCP and component rows, the Revit add-in, the paths, the office standard PDF, the user name, language and theme.
import { useEffect, useState, type ReactNode } from "react";
import { call, errText } from "../../bridge";
import { usageText } from "../../../shared/tokens";
import type { Limits } from "../../../shared/thread-types";
import type { SettingsPageId } from "../../../shared/settings-index";
import { Badge, Err, useLoad } from "../../ui";
import { getLang, LANGS, locale, setLang, tr, trDyn } from "../../i18n";
import { windows } from "../../windows";
import { ClaudeSignIn } from "../ClaudeSignIn";
import { TeamEditor } from "../Agenti";
import type { SettingsCtx } from "./data";

/** One anchored block of a page. */
function Block({ anchor, title, children }: { anchor: string; title?: string; children: ReactNode }) {
	return (
		<section className="st-block" data-settings-block={anchor}>
			{title && <div className="section-title">{title}</div>}
			{children}
		</section>
	);
}
const anchored = (anchor: string) => ({ "data-settings-block": anchor });

/** A labelled field: the label above the input in a narrow window, beside it in a wide one (CSS .st-field). */
function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="st-field">
			<span className="st-field-label">{label}</span>
			{children}
		</label>
	);
}

export function SettingsPageBody({ page, x }: { page: SettingsPageId; x: SettingsCtx }) {
	switch (page) {
		case "paths":
			return <PathsPage x={x} />;
		case "providers":
			return <ProvidersPage x={x} />;
		case "backup":
			return <BackupPage x={x} />;
		case "usage":
			return (
				<Block anchor="usage">
					<UsageTable />
				</Block>
			);
		case "team":
			return <TeamPage />;
		case "limits":
			return <LimitsPage x={x} />;
		case "general":
			return <GeneralPage x={x} />;
		case "components":
			return <ComponentsPage x={x} />;
	}
}

// ---- Projekts · Ceļi un standarts
function PathsPage({ x }: { x: SettingsCtx }) {
	const { s, act, bumpRv } = x;
	const info = useLoad(() => call("app.info"), []);
	return (
		<>
			<Block anchor="office-standard" title={tr("Biroja standarts")}>
				{s && (
					<Field label={tr("Projekta mapju koks (PDF)")}>
						<input className="grow mono" defaultValue={s.officeStandardPdf ?? ""} placeholder={tr("nav norādīts — biroja prasības (nosaukumi, datumi) nav citējamas")} onBlur={(e) => act(() => call("settings.set", { officeStandardPdf: e.target.value.trim() || null }))} />
					</Field>
				)}
				<div className="dim small">{tr("Biroja standarta teksts tiek lasīts no šī faila, kad lietotne strādā; tas netiek glabāts lietotnes kodā.")}</div>
			</Block>
			<Block anchor="revit-paths" title={tr("Revit MCP")}>
				{s && (
					<>
						<Field label={tr("Cits index.js")}>
							<input className="grow mono" defaultValue={s.revitServerJs ?? ""} placeholder={tr("tukšs = standarta instalācija (%LOCALAPPDATA%\\Revit-MCP-Node)")} onBlur={(e) => act(() => call("settings.set", { revitServerJs: e.target.value.trim() || null }).then(bumpRv))} />
						</Field>
						<Field label={tr("Cits node.exe")}>
							<input className="grow mono" defaultValue={s.revitNode ?? ""} placeholder={tr("tukšs = servera node-runtime vai Electron node")} onBlur={(e) => act(() => call("settings.set", { revitNode: e.target.value.trim() || null }).then(bumpRv))} />
						</Field>
					</>
				)}
			</Block>
			<Block anchor="data-folder" title={tr("Lietotnes datu mape")}>
				{info.error ? <Err error={info.error} /> : info.data ? <div className="mono small st-wrap">{info.data.dataDir}</div> : <div className="dim small">{tr("ielādē…")}</div>}
				<div className="dim small">{tr("Šeit lietotne glabā iestatījumus, projektus un žurnālus. Tikai lasāma.")}</div>
			</Block>
		</>
	);
}

// ---- AI · Pakalpojums un modelis
function ProvidersPage({ x }: { x: SettingsCtx }) {
	const { s, providers, act, notice } = x;
	const [answer, setAnswer] = useState("");
	const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
	const current = providers.find((p) => p.id === s?.provider);
	const model = current?.models.find((m) => m.id === s?.model);
	return (
		<>
			<Block anchor="model" title={tr("Aģents")}>
				{s && (
					<div className="row">
						<label>
							{tr("Pakalpojums")}{" "}
							<select value={s.provider} onChange={(e) => act(() => call("settings.set", { provider: e.target.value, model: "", effort: "" }))}>
								{providers.map((p) => (
									<option key={p.id} value={p.id}>
										{p.label}
										{p.configured ? "" : tr(" (nav pieslēgts)")}
									</option>
								))}
							</select>
						</label>
						<label>
							{tr("Modelis")}{" "}
							<select value={s.model} onChange={(e) => act(() => call("settings.set", { model: e.target.value, effort: "" }))}>
								<option value="">{tr("noklusējums")}</option>
								{(current?.models ?? []).map((m) => (
									<option key={m.id} value={m.id}>
										{m.name}
										{m.legacy ? tr(" (vecāks)") : ""}
									</option>
								))}
							</select>
						</label>
						{model && model.efforts.length > 0 && (
							<label>
								{tr("Piepūle")}{" "}
								<select value={s.effort} onChange={(e) => act(() => call("settings.set", { effort: e.target.value as never }))}>
									<option value="">{tr("noklusējums ({effort})", { effort: model.defaultEffort })}</option>
									{model.efforts.map((e) => (
										<option key={e}>{e}</option>
									))}
								</select>
							</label>
						)}
					</div>
				)}
			</Block>
			<Block anchor="providers" title={tr("Pakalpojumi")}>
				<div className="st-scroll">
					<table>
						<thead>
							<tr>
								<th>{tr("Pakalpojums")}</th>
								<th>{tr("Stāvoklis")}</th>
								<th>{tr("Pieslēgšana")}</th>
							</tr>
						</thead>
						<tbody>
							{providers.map((p) => (
								<tr key={p.id}>
									<td>{p.label}</td>
									<td>{p.configured ? <Badge tone="ok">{tr("pieslēgts ({method})", { method: p.method })}</Badge> : <Badge tone="dim">{tr("nav pieslēgts")}</Badge>}</td>
									<td>
										<div className="row">
											{p.auth.includes("oauth") &&
												(p.configured && p.method === "oauth" ? (
													<button onClick={() => act(() => call("agent.logout", p.id))}>{tr("Atslēgties")}</button>
												) : (
													<button className="primary" onClick={() => act(() => call("agent.login", p.id))}>
														{tr("Pieslēgties ar abonementu")}
													</button>
												))}
											{p.auth.includes("api_key") && (
												<>
													<input type="password" placeholder={p.keyHelp ? "setup-token" : tr("API atslēga")} title={p.keyHelp ? trDyn(p.keyHelp) : undefined} value={keyDraft[p.id] ?? ""} onChange={(e) => setKeyDraft({ ...keyDraft, [p.id]: e.target.value })} />
													<button disabled={!keyDraft[p.id]} onClick={() => act(async () => (await call("agent.setKey", p.id, keyDraft[p.id]), setKeyDraft({ ...keyDraft, [p.id]: "" })))}>
														{tr("Saglabāt")}
													</button>
													{p.configured && p.method === "api_key" && <button onClick={() => act(() => call("agent.clearKey", p.id))}>{tr("Dzēst atslēgu")}</button>}
													{p.keyUrl && (
														<a href={p.keyUrl} target="_blank" rel="noreferrer">
															{tr("kur dabūt")}
														</a>
													)}
													{p.keyHelp && !p.configured && <span className="dim small">{trDyn(p.keyHelp)}</span>}
												</>
											)}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{/* the Claude subscription signs in here only (agent/claude/login.ts: the unmodified `claude auth login`); its link stays visible while the code is asked */}
				<ClaudeSignIn />
				{notice && notice.provider !== "claude-sub" && (
					<div className="confirm">
						<b>{tr("Pieslēgšanās — {provider}", { provider: notice.provider })}</b>
						{notice.type === "url" && (
							<div>
								{tr("Pārlūkā atvērta lapa. Ja tā neatvērās:")} <a href={notice.url}>{notice.url}</a>
							</div>
						)}
						{notice.type === "code" && (
							<div>
								{tr("Kods:")} <b className="mono">{notice.userCode}</b> — <a href={notice.url}>{notice.url}</a>
							</div>
						)}
						{notice.type === "info" && <div>{notice.message}</div>}
						{notice.type === "ask" && (
							<div className="row">
								<span>{notice.message}</span>
								<input className="grow" value={answer} onChange={(e) => setAnswer(e.target.value)} />
								<button onClick={() => act(async () => (await call("agent.loginAnswer", answer), setAnswer("")))}>{tr("Nosūtīt")}</button>
							</div>
						)}
						{notice.type === "done" && <Badge tone="ok">{tr("pieslēgts")}</Badge>}
						{notice.type === "error" && <div className="err">{notice.message}</div>}
					</div>
				)}
			</Block>
		</>
	);
}

// ---- AI · Rezerve un atkopšana
function BackupPage({ x }: { x: SettingsCtx }) {
	const { s, providers, holds, act } = x;
	const backupRow = providers.find((p) => p.id === s?.backup?.provider);
	return (
		<>
			<Block anchor="backup" title={tr("Rezerves AI")}>
				<div className="dim small">{tr("Kad aģenta pakalpojums sasniedz lietojuma limitu vai tā pieteikšanās beidzas, aģenta jaunie darbi sākas ar rezerves AI, līdz limits atjaunojas. Aģenta paša rezerve (Aģenti) ir svarīgāka par šo.")}</div>
				{s && (
					<>
						<div className="row">
							<label>
								{tr("Rezerves pakalpojums")}{" "}
								<select value={s.backup?.provider ?? ""} onChange={(e) => act(() => call("settings.set", { backup: e.target.value ? { provider: e.target.value, model: "" } : null }))}>
									<option value="">{tr("nav")}</option>
									{providers.map((p) => (
										<option key={p.id} value={p.id}>
											{p.label}
											{p.configured ? "" : tr(" (nav pieslēgts)")}
										</option>
									))}
								</select>
							</label>
							{s.backup && (
								<label>
									{tr("Modelis")}{" "}
									<select value={s.backup.model} onChange={(e) => act(() => call("settings.set", { backup: { provider: s.backup!.provider, model: e.target.value } }))}>
										<option value="">{tr("noklusējums")}</option>
										{(backupRow?.models ?? []).map((m) => (
											<option key={m.id} value={m.id}>
												{m.name}
												{m.legacy ? tr(" (vecāks)") : ""}
											</option>
										))}
									</select>
								</label>
							)}
						</div>
						{s.backup && s.backup.provider === s.provider && <div className="dim small">{tr("Tas pats pakalpojums nepārņem darbu, kad limits ir visam kontam; tas palīdz tikai tad, ja limits skar vienu modeli.")}</div>}
					</>
				)}
			</Block>
			<Block anchor="recovery">
				{s && (
					<>
						<label className="row">
							<input type="checkbox" checked={s.automaticRecovery === true} onChange={(e) => act(() => call("settings.set", { automaticRecovery: e.target.checked }))} />
							<span>{tr("Automātiskā atkopšana")}</span>
						</label>
						<div className="dim small">{tr("Ieslēgta: ja gājiens neizdodas, pirms kāds rīks ir darbojies (limits, beigusies pieteikšanās, pakalpojums nedarbojas), to mēģina vēlreiz vienu reizi ar rezerves AI. Izslēgta: tu nosūti ziņu vēlreiz. Cita aģenta uzdevumu pēc limita pārsūta uz rezervi vienmēr, ar tām pašām tiesībām.")}</div>
					</>
				)}
			</Block>
			<Block anchor="holds" title={tr("Aizturētie pakalpojumi")}>
				{holds.length === 0 ? (
					<div className="dim small">{tr("Nekas nav aizturēts: neviens pakalpojums šobrīd nav sasniedzis limitu.")}</div>
				) : (
					<div className="st-scroll">
						<table>
							<thead>
								<tr>
									<th>{tr("Aizturēts")}</th>
									<th>{tr("Iemesls")}</th>
									<th>{tr("Mēģina vēlreiz")}</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{holds.map((h) => (
									<tr key={`${h.provider}/${h.model ?? ""}/${h.scope}`}>
										<td>
											{h.label}
											{h.model ? ` ${h.model}` : ""}
										</td>
										<td>{h.scope === "signed-out" ? tr("pieteikšanās beigusies") : h.scope === "credits" ? tr("kredīti iztērēti") : tr("lietojuma limits")}</td>
										<td>{new Date(h.until).toLocaleString(locale(), { weekday: "short", hour: "2-digit", minute: "2-digit" })}</td>
										<td>
											<button onClick={() => act(() => call("agent.releaseHold", h.provider))}>{tr("Atbrīvot")}</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Block>
		</>
	);
}

/** What the agent's model turns used, per project: tokens, and the price where the provider gave one. */
function UsageTable() {
	const u = useLoad(() => call("usage.summary"), []);
	if (u.error) return <Err error={u.error} />;
	if (!u.data) return <div className="dim small">{tr("ielādē…")}</div>;
	if (u.data.length === 0) return <div className="dim small">{tr("no data: aģents vēl nav izmantots.")}</div>;
	const sum = u.data.reduce((a, r) => ({ ...a, input: a.input + r.input, output: a.output + r.output, cacheRead: a.cacheRead + r.cacheRead, turns: a.turns + r.turns, priced: a.priced + r.priced, cost: r.cost === null ? a.cost : (a.cost ?? 0) + r.cost }), { input: 0, output: 0, cacheRead: 0, turns: 0, priced: 0, cost: null as number | null });
	return (
		<div className="st-scroll">
			<table className="small">
				<thead>
					<tr>
						<th>{tr("Projekts")}</th>
						<th>{tr("Palaišanas")}</th>
						<th>{tr("Izmantojums")}</th>
						<th>{tr("Pēdējo reizi")}</th>
					</tr>
				</thead>
				<tbody>
					{u.data.map((r) => (
						<tr key={r.project ?? "_"}>
							<td>{r.project ?? <span className="dim">{tr("bez projekta")}</span>}</td>
							<td>{r.runs}</td>
							<td>{usageText(r)}</td>
							<td className="dim">{new Date(r.lastAt).toLocaleDateString(locale())}</td>
						</tr>
					))}
					<tr>
						<td>
							<b>{tr("Kopā")}</b>
						</td>
						<td>{u.data.reduce((n, r) => n + r.runs, 0)}</td>
						<td>
							<b>{usageText(sum)}</b>
						</td>
						<td />
					</tr>
				</tbody>
			</table>
		</div>
	);
}

// ---- Aģenti · Komanda un prasmes
/** The team editor itself, the same component as the Agents page (panels/Agenti.tsx TeamEditor): departments with their agents, drag, lead, add / rename / reorder / remove, the agent cards and dialog, the import. Below it the skills library. */
function TeamPage() {
	const skills = useLoad(() => call("skills.list"), []);
	const office = (skills.data ?? []).filter((k) => k.origin === "office").length;
	return (
		<>
			<Block anchor="departments" title={tr("Nodaļas")}>
				<TeamEditor />
				<div className="row">
					<button className="ghost" onClick={() => windows.open("agenti")}>
						{tr("Atvērt Aģentu lapu…")}
					</button>
					<span className="dim small">{tr("Kopējie noteikumi, ko saņem katrs aģents, ir Aģentu lapā.")}</span>
				</div>
			</Block>
			<Block anchor="skills" title={tr("Prasmju bibliotēka")}>
				<div className="row">
					<button onClick={() => windows.open("prasmes")}>{tr("Prasmes…")}</button>
					<span className="dim small">{skills.data ? tr("Prasmes: {n}, no tām biroja {office}.", { n: skills.data.length, office }) : tr("ielādē…")}</span>
				</div>
				<div className="dim small">{tr("Biroja prasmju bibliotēka un tas, kuras prasmes kuram aģentam.")}</div>
			</Block>
		</>
	);
}

// ---- Aģenti · Aģentu ierobežojumi
const LIMIT_ROWS: { key: keyof Limits; label: string; min: number; max: number; step?: number }[] = [
	{ key: "exchangesPerTopic", label: tr("Ziņas par vienu tematu (no katras puses)"), min: 1, max: 10 },
	{ key: "chainDepth", label: tr("Ziņu ķēdes dziļums"), min: 1, max: 20 },
	{ key: "runsPerWave", label: tr("Skrējieni vienā vilnī"), min: 1, max: 200 },
	{ key: "waveCost", label: tr("Viļņa izmaksu robeža ($)"), min: 0, max: 100000, step: 0.1 },
	{ key: "taskIterations", label: tr("Uzdevuma iterācijas"), min: 1, max: 10 },
];

function LimitsPage({ x }: { x: SettingsCtx }) {
	const { s, act } = x;
	return (
		<>
			<Block anchor="parallel" title={tr("Vienlaikus")}>
				{s && (
					<div className="row">
						<label>
							{tr("Cik palīgi drīkst strādāt reizē")}{" "}
							<select value={s.maxParallelAgents} onChange={(e) => act(() => call("settings.set", { maxParallelAgents: Number(e.target.value) }))}>
								{[1, 2, 3, 4, 5, 6].map((n) => (
									<option key={n}>{n}</option>
								))}
							</select>
						</label>
					</div>
				)}
				<div className="dim small">{tr("Katrs palīgs ir atsevišķs modeļa izsaukums ar savu kontekstu, un maksā savus tokenus (skat. Izmantojums).")}</div>
			</Block>
			<Block anchor="limits" title={tr("Aģentu ierobežojumi")}>
				{s &&
					LIMIT_ROWS.map((r) => (
						<Field key={`${r.key}${s.limits[r.key]}`} label={r.label}>
							<input
								type="number"
								min={r.min}
								max={r.max}
								step={r.step ?? 1}
								defaultValue={s.limits[r.key] ?? ""}
								placeholder={r.key === "waveCost" ? tr("nav robežas") : undefined}
								style={{ width: 110 }}
								onBlur={(e) => {
									// saved on leaving the field; main puts it into its range and the field shows what was kept. An empty cost field = no cost limit.
									const raw = e.target.value.trim();
									const v = raw === "" ? null : Number(raw);
									if (v !== s.limits[r.key] && !(v === null && r.key !== "waveCost")) void act(() => call("settings.set", { limits: { ...s.limits, [r.key]: v } }));
								}}
							/>
						</Field>
					))}
				<div className="dim small">{tr("Cik tālu aģenti drīkst sarunāties savā starpā. Vilnis ir viss, ko izraisa viena tava darbība; tam sasniedzot robežu, rindā gaidošie darbi apstājas un “Gaida tevi” piedāvā turpināt.")}</div>
			</Block>
		</>
	);
}

// ---- Lietotne · Vispārīgi
function GeneralPage({ x }: { x: SettingsCtx }) {
	const { s, act } = x;
	return (
		<>
			<Block anchor="user" title={tr("Lietotājs")}>
				{s && (
					<Field label={tr("Vārds, uzvārds")}>
						<input className="grow" defaultValue={s.userName} placeholder={tr("nav norādīts — lēmumi tiek parakstīti kā “lietotājs”")} onBlur={(e) => act(() => call("settings.set", { userName: e.target.value.trim() }))} />
					</Field>
				)}
				<div className="dim small">{tr("Vārds tiek ierakstīts pie taviem lēmumiem (pieņemti atradumi, paša ierakstītas vērtības), BCF komentāros un tiek pateikts aģentam. Jau pieņemtie lēmumi savu vārdu saglabā.")}</div>
			</Block>
			<Block anchor="language" title={tr("Valoda")}>
				{s && (
					<div className="row">
						{LANGS.map((l) => (
							<button key={l.id} className={getLang() === l.id ? "primary" : ""} onClick={() => act(() => call("settings.set", { language: l.id })).then(() => (setLang(l.id), location.reload()))}>
								{l.name}
							</button>
						))}
						<span className="dim small">{tr("Lietotnes saskarne. Aģenta teksti un dokumenti paliek latviski.")}</span>
					</div>
				)}
			</Block>
			<Block anchor="look" title={tr("Izskats")}>
				{s && (
					<div className="row">
						{(["auto", "dark", "light"] as const).map((t) => (
							<button key={t} className={s.theme === t ? "primary" : ""} onClick={() => act(() => call("settings.set", { theme: t }))}>
								{t === "auto" ? tr("kā sistēmā") : t === "dark" ? tr("tumšs") : tr("gaišs")}
							</button>
						))}
					</div>
				)}
			</Block>
		</>
	);
}

// ---- Lietotne · Komponentes
/**
 * Everything the app ships or connects to, one row each: Revit MCP (the server and a Revit session), BimCraft (the 3D / IFC view and its
 * bridge add-on), CadCraft (the DWG view and compare). Where a build took a copy from is in the tooltip. The Revit add-in sits below them.
 */
function ComponentsPage({ x }: { x: SettingsCtx }) {
	const rv = useLoad(() => call("revit.status"), [x.rv]);
	const bc = useLoad(() => call("bimcraft.status"), []);
	const cad = useLoad(() => call("dwg.craft"), []);
	const r = rv.data;
	const b = bc.data;
	const reload = () => (rv.reload(), bc.reload(), cad.reload());
	return (
		<>
			<Block anchor="components" title={tr("Komponentes")}>
				<div className="st-scroll">
					<table className="small">
						<thead>
							<tr>
								<th>{tr("Komponente")}</th>
								<th>{tr("Stāvoklis")}</th>
								<th>{tr("Kas tas ir")}</th>
							</tr>
						</thead>
						<tbody>
							<tr {...anchored("revit")}>
								<td>Revit MCP</td>
								<td>{rv.error ? <Err error={rv.error} /> : r ? <Badge tone={r.state === "savienots" ? "ok" : r.state === "nav konfigurēts" ? "bad" : "warn"}>{tr(r.state)}</Badge> : <span className="dim">{tr("pārbauda…")}</span>}</td>
								<td>
									<div>
										{tr("Lasa un raksta atvērto Revit modeli.")}
										{r?.document && (
											<>
												{" "}
												{r.document}
												{r.version ? tr(" · Revit {version}", { version: r.version }) : ""}
											</>
										)}
									</div>
									{r?.server && (
										<div className="dim mono st-wrap" title={r.server.node ?? ""}>
											{r.server.source === "iekļauts" ? tr("iekļauts lietotnē: ") : r.server.source === "automātiski" ? tr("atrasts automātiski: ") : tr("no Iestatījumiem: ")}
											{r.server.serverJs}
										</div>
									)}
									{r?.message && <div className="dim">{trDyn(r.message)}</div>}
								</td>
							</tr>
							<tr {...anchored("bimcraft")}>
								<td>BimCraft</td>
								<td>{bc.error ? <Err error={bc.error} /> : b ? <Badge tone={b.state === "gatavs" ? "ok" : b.state === "nav tilta" ? "warn" : "bad"}>{tr(b.state)}</Badge> : <span className="dim">{tr("pārbauda…")}</span>}</td>
								<td title={b?.source ? `${b.source}${b.copiedAt ? ` · ${b.copiedAt.slice(0, 16).replace("T", " ")}` : ""}` : undefined}>
									<div>
										{tr("3D skats un IFC salīdzināšana.")} {b && b.state !== "nav konfigurēts" && (b.addon ? tr("Tilts uz lietotni ieslēgts.") : tr("Tilts uz lietotni nav ieslēgts."))}
									</div>
									{b?.message && <div className="dim">{trDyn(b.message)}</div>}
								</td>
							</tr>
							<tr {...anchored("cadcraft")}>
								<td>CadCraft</td>
								<td>{cad.error ? <Err error={cad.error} /> : cad.data === null ? <span className="dim">{tr("pārbauda…")}</span> : <Badge tone={cad.data ? "ok" : "warn"}>{cad.data ? tr("gatavs") : tr("nav iekļauts")}</Badge>}</td>
								<td>
									{tr("DWG skats un DWG salīdzināšana.")} {cad.data === false && <span className="dim">{tr("Bez tā DWG rāda vienkāršā līniju skatā.")}</span>}
								</td>
							</tr>
						</tbody>
					</table>
				</div>
				<div className="row">
					<button className="small ghost" onClick={reload}>
						{tr("pārbaudīt")}
					</button>
				</div>
			</Block>
			<Block anchor="addins" title={tr("Revit spraudnis")}>
				<RevitAddins onDone={rv.reload} />
			</Block>
		</>
	);
}

/** The Revit add-in that ships with the app: which Revit years it is installed for, and a button to put it there. */
function RevitAddins({ onDone }: { onDone: () => void }) {
	const years = useLoad(() => call("revit.addins"), []);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
	useEffect(() => setErr(null), [years.data]);
	const rows = years.data ?? [];
	if (!rows.some((y) => y.available)) return <div className="dim small">{tr("Revit spraudnis šajā lietotnes versijā nav iekļauts.")}</div>;
	const install = async (ys: string[]) => {
		setBusy(true);
		setErr(null);
		try {
			setMsg((await call("revit.installAddins", ys)).join("\n"));
			years.reload();
			onDone();
		} catch (e) {
			setErr(errText(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="small">
			<div className="row">
				<span>{tr("Revit spraudnis:")}</span>
				{rows.map((y) => (
					<span key={y.year} className="row">
						<Badge tone={y.installed ? "ok" : "warn"}>
							{y.year} {y.installed ? tr("ielikts") : tr("nav ielikts")}
						</Badge>
						{y.available && (
							<button className="small ghost" disabled={busy} onClick={() => install([y.year])}>
								{y.installed ? tr("atjaunot") : tr("ielikt")}
							</button>
						)}
					</span>
				))}
			</div>
			<div className="dim">{tr("Neobligāts: serveris darbojas arī bez tā, bet Revit atbild tikai ar ielikto spraudni. Aizver Revit pirms ielikšanas, pēc tam restartē to.")}</div>
			{msg && (
				<div className="dim" style={{ whiteSpace: "pre-line" }}>
					{msg}
				</div>
			)}
			{err && <Err error={err} />}
		</div>
	);
}
