// Settings, in tabs like BIM Crew's (General · AI · Integrations · Paths): which provider the agent uses (each user sets their own default), sign-in, API keys, model, effort,
// the backup AI every agent carries on with when its provider is at its limit or signed out (an agent's own backup, set in Aģenti, wins), automatic recovery, theme,
// Revit MCP path. Keys are stored encrypted by main; nothing here shows a stored key.
import { useEffect, useState } from "react";
import type { LoginNotice } from "../../shared/types";
import type { HoldRow, ProviderRow } from "../../shared/api";
import { call, errText, on } from "../bridge";
import { usageText } from "../../shared/tokens";
import { Badge, Err, useLoad } from "../ui";
import { locale, getLang, LANGS, setLang, tr, trDyn } from "../i18n";

type SettingsTab = "general" | "agent" | "integrations" | "paths";
const TABS: { id: SettingsTab; label: string }[] = [
	{ id: "general", label: "Vispārīgi" },
	{ id: "agent", label: "Aģents" },
	{ id: "integrations", label: "Integrācijas" },
	{ id: "paths", label: "Ceļi" },
];
let lastTab: SettingsTab = "general";

export function Iestatijumi() {
	const [tab, setTabState] = useState<SettingsTab>(lastTab);
	const setTab = (t: SettingsTab) => setTabState((lastTab = t));
	const settings = useLoad(() => call("settings.get"), []);
	const providers = useLoad<ProviderRow[]>(() => call("agent.providers"), []);
	const holds = useLoad<HoldRow[]>(() => call("agent.holds"), []);
	const [notice, setNotice] = useState<LoginNotice | null>(null);
	const [answer, setAnswer] = useState("");
	const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
	const [err, setErr] = useState<string | null>(null);
	const [rv, setRv] = useState(0);

	useEffect(() => on("agent.login", (n) => setNotice(n)), []);

	const s = settings.data;
	const act = async (fn: () => Promise<unknown>) => {
		setErr(null);
		try {
			await fn();
			settings.reload();
			providers.reload();
			holds.reload();
		} catch (e) {
			setErr(errText(e));
		}
	};
	const current = providers.data?.find((p) => p.id === s?.provider);
	const model = current?.models.find((m) => m.id === s?.model);
	const backupRow = providers.data?.find((p) => p.id === s?.backup?.provider);

	return (
		<div className="pane fill">
			{err && <div className="err">{err}</div>}
			{settings.error ? <Err error={settings.error} /> : null}
			{providers.error ? <Err error={providers.error} /> : null}
			<div className="row" style={{ flexWrap: "wrap" }}>
				{TABS.map((t) => (
					<button key={t.id} className={`small ${tab === t.id ? "primary" : ""}`} onClick={() => setTab(t.id)}>
						{tr(t.label)}
					</button>
				))}
			</div>
			{tab === "general" && (
				<>
					<div className="section-title">{tr("Lietotājs")}</div>
					{s && (
						<label className="row">
							<span style={{ width: 150 }}>{tr("Vārds, uzvārds")}</span>
							<input className="grow" defaultValue={s.userName} placeholder={tr("nav norādīts — lēmumi tiek parakstīti kā “lietotājs”")} onBlur={(e) => act(() => call("settings.set", { userName: e.target.value.trim() }))} />
						</label>
					)}
					<div className="dim small">{tr("Vārds tiek ierakstīts pie taviem lēmumiem (pieņemti atradumi, paša ierakstītas vērtības), BCF komentāros un tiek pateikts aģentam. Jau pieņemtie lēmumi savu vārdu saglabā.")}</div>
					<div className="section-title">{tr("Valoda")}</div>
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
					<div className="section-title">{tr("Izskats")}</div>
					{s && (
						<div className="row">
							{(["auto", "dark", "light"] as const).map((t) => (
								<button key={t} className={s.theme === t ? "primary" : ""} onClick={() => act(() => call("settings.set", { theme: t }))}>
									{t === "auto" ? tr("kā sistēmā") : t === "dark" ? tr("tumšs") : tr("gaišs")}
								</button>
							))}
						</div>
					)}
				</>
			)}
			{tab === "agent" && (
				<>
					<div className="section-title">{tr("Aģents")}</div>
					{s && (
						<div className="row">
							<label>
								{tr("Pakalpojums")}{" "}
								<select value={s.provider} onChange={(e) => act(() => call("settings.set", { provider: e.target.value, model: "", effort: "" }))}>
									{(providers.data ?? []).map((p) => (
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
										{model.efforts.map((x) => (
											<option key={x}>{x}</option>
										))}
									</select>
								</label>
							)}
						</div>
					)}
					<table>
						<thead>
							<tr>
								<th>{tr("Pakalpojums")}</th>
								<th>{tr("Stāvoklis")}</th>
								<th>{tr("Pieslēgšana")}</th>
							</tr>
						</thead>
						<tbody>
							{(providers.data ?? []).map((p) => (
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
														{tr("Pieslēgties ar abonementu")}</button>
												))}
											{p.auth.includes("api_key") && (
												<>
													<input type="password" placeholder={p.keyHelp ? "setup-token" : tr("API atslēga")} title={p.keyHelp ? trDyn(p.keyHelp) : undefined} value={keyDraft[p.id] ?? ""} onChange={(e) => setKeyDraft({ ...keyDraft, [p.id]: e.target.value })} />
													<button disabled={!keyDraft[p.id]} onClick={() => act(async () => (await call("agent.setKey", p.id, keyDraft[p.id]), setKeyDraft({ ...keyDraft, [p.id]: "" })))}>
														{tr("Saglabāt")}</button>
													{p.configured && p.method === "api_key" && <button onClick={() => act(() => call("agent.clearKey", p.id))}>{tr("Dzēst atslēgu")}</button>}
													{p.keyUrl && (
														<a href={p.keyUrl} target="_blank" rel="noreferrer">
															{tr("kur dabūt")}</a>
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
					{notice && (
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
					<div className="section-title">{tr("Rezerves AI")}</div>
					<div className="dim small">{tr("Kad aģenta pakalpojums sasniedz lietojuma limitu vai tā pieteikšanās beidzas, aģenta jaunie darbi sākas ar rezerves AI, līdz limits atjaunojas. Aģenta paša rezerve (Aģenti) ir svarīgāka par šo.")}</div>
					{s && (
						<>
							<div className="row">
								<label>
									{tr("Rezerves pakalpojums")}{" "}
									<select value={s.backup?.provider ?? ""} onChange={(e) => act(() => call("settings.set", { backup: e.target.value ? { provider: e.target.value, model: "" } : null }))}>
										<option value="">{tr("nav")}</option>
										{(providers.data ?? []).map((p) => (
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
							<label className="row">
								<input type="checkbox" checked={s.automaticRecovery === true} onChange={(e) => act(() => call("settings.set", { automaticRecovery: e.target.checked }))} />
								<span>{tr("Automātiskā atkopšana")}</span>
							</label>
							<div className="dim small">{tr("Ieslēgta: ja gājiens neizdodas, pirms kāds rīks ir darbojies (limits, beigusies pieteikšanās, pakalpojums nedarbojas), to mēģina vēlreiz vienu reizi ar rezerves AI. Izslēgta: tu nosūti ziņu vēlreiz. Cita aģenta uzdevumu pēc limita pārsūta uz rezervi vienmēr, ar tām pašām tiesībām.")}</div>
						</>
					)}
					{(holds.data ?? []).length > 0 && (
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
								{(holds.data ?? []).map((h) => (
									<tr key={`${h.provider}/${h.model ?? ""}/${h.scope}`}>
										<td>
											{h.label}
											{h.model ? ` ${h.model}` : ""}
										</td>
										<td>{h.scope === "signed-out" ? tr("pieteikšanās beigusies") : h.scope === "credits" ? tr("kredīti iztērēti") : tr("lietojuma limits")}</td>
										<td>{new Date(h.until).toLocaleString(locale(), { weekday: "short", hour: "2-digit", minute: "2-digit" })}</td>
										<td>
											<button onClick={() => act(() => call("agent.releaseHold", h.provider).then(holds.reload))}>{tr("Atbrīvot")}</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
					<div className="section-title">{tr("Izmantojums")}</div>
					<UsageTable />
				</>
			)}
			{tab === "integrations" && (
				<>
					<div className="section-title">{tr("Komponentes")}</div>
					<Components version={rv} />
				</>
			)}
			{tab === "paths" && (
				<>
					<div className="section-title">{tr("Revit MCP")}</div>
					{s && (
						<>
							<label className="row">
								<span style={{ width: 150 }}>{tr("Cits index.js")}</span>
								<input className="grow mono" defaultValue={s.revitServerJs ?? ""} placeholder={tr("tukšs = standarta instalācija (%LOCALAPPDATA%\\Revit-MCP-Node)")} onBlur={(e) => act(() => call("settings.set", { revitServerJs: e.target.value.trim() || null }).then(() => setRv((v) => v + 1)))} />
							</label>
							<label className="row">
								<span style={{ width: 150 }}>{tr("Cits node.exe")}</span>
								<input className="grow mono" defaultValue={s.revitNode ?? ""} placeholder={tr("tukšs = servera node-runtime vai Electron node")} onBlur={(e) => act(() => call("settings.set", { revitNode: e.target.value.trim() || null }).then(() => setRv((v) => v + 1)))} />
							</label>
						</>
					)}
					<div className="section-title">{tr("Biroja standarts")}</div>
					{s && (
						<label className="row">
							<span style={{ width: 150 }}>{tr("Projekta mapju koks (PDF)")}</span>
							<input
								className="grow mono"
								defaultValue={s.officeStandardPdf ?? ""}
								placeholder={tr("nav norādīts — biroja prasības (nosaukumi, datumi) nav citējamas")}
								onBlur={(e) => act(() => call("settings.set", { officeStandardPdf: e.target.value.trim() || null }))}
							/>
						</label>
					)}
					<div className="dim small">{tr("Biroja standarta teksts tiek lasīts no šī faila, kad lietotne strādā; tas netiek glabāts lietotnes kodā.")}</div>
				</>
			)}
		</div>
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
	);
}

/**
 * Everything the app ships or connects to, one row each: Revit MCP (the server and a Revit session), BimCraft (the 3D / IFC
 * view and its bridge add-on), CadCraft (the DWG view and compare). Where a build took a copy from is in the tooltip.
 */
function Components({ version }: { version: number }) {
	const rv = useLoad(() => call("revit.status"), [version]);
	const bc = useLoad(() => call("bimcraft.status"), []);
	const cad = useLoad(() => call("dwg.craft"), []);
	const r = rv.data;
	const b = bc.data;
	const reload = () => (rv.reload(), bc.reload(), cad.reload());
	return (
		<>
			<table className="small">
				<thead>
					<tr>
						<th>{tr("Komponente")}</th>
						<th>{tr("Stāvoklis")}</th>
						<th>{tr("Kas tas ir")}</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Revit MCP</td>
						<td>{rv.error ? <Err error={rv.error} /> : r ? <Badge tone={r.state === "savienots" ? "ok" : r.state === "nav konfigurēts" ? "bad" : "warn"}>{tr(r.state)}</Badge> : <span className="dim">{tr("pārbauda…")}</span>}</td>
						<td>
							<div>
								{tr("Lasa un raksta atvērto Revit modeli.")}
								{r?.document && <> {r.document}{r.version ? tr(" · Revit {version}", { version: r.version }) : ""}</>}
							</div>
							{r?.server && (
								<div className="dim mono" title={r.server.node ?? ""}>
									{r.server.source === "iekļauts" ? tr("iekļauts lietotnē: ") : r.server.source === "automātiski" ? tr("atrasts automātiski: ") : tr("no Iestatījumiem: ")}
									{r.server.serverJs}
								</div>
							)}
							{r?.message && <div className="dim">{trDyn(r.message)}</div>}
						</td>
					</tr>
					<tr>
						<td>BimCraft</td>
						<td>{bc.error ? <Err error={bc.error} /> : b ? <Badge tone={b.state === "gatavs" ? "ok" : b.state === "nav tilta" ? "warn" : "bad"}>{tr(b.state)}</Badge> : <span className="dim">{tr("pārbauda…")}</span>}</td>
						<td title={b?.source ? `${b.source}${b.copiedAt ? ` · ${b.copiedAt.slice(0, 16).replace("T", " ")}` : ""}` : undefined}>
							<div>
								{tr("3D skats un IFC salīdzināšana.")} {b && b.state !== "nav konfigurēts" && (b.addon ? tr("Tilts uz lietotni ieslēgts.") : tr("Tilts uz lietotni nav ieslēgts."))}
							</div>
							{b?.message && <div className="dim">{trDyn(b.message)}</div>}
						</td>
					</tr>
					<tr>
						<td>CadCraft</td>
						<td>{cad.error ? <Err error={cad.error} /> : cad.data === null ? <span className="dim">{tr("pārbauda…")}</span> : <Badge tone={cad.data ? "ok" : "warn"}>{cad.data ? tr("gatavs") : tr("nav iekļauts")}</Badge>}</td>
						<td>
							{tr("DWG skats un DWG salīdzināšana.")} {cad.data === false && <span className="dim">{tr("Bez tā DWG rāda vienkāršā līniju skatā.")}</span>}
						</td>
					</tr>
				</tbody>
			</table>
			<div className="row">
				<button className="small ghost" onClick={reload}>{tr("pārbaudīt")}</button>
			</div>
			<RevitAddins onDone={rv.reload} />
		</>
	);
}

/** The Revit add-in that ships with the app: which Revit years it is installed for, and a button to put it there. */
function RevitAddins({ onDone }: { onDone: () => void }) {
	const years = useLoad(() => call("revit.addins"), []);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
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
						<Badge tone={y.installed ? "ok" : "warn"}>{y.year} {y.installed ? tr("ielikts") : tr("nav ielikts")}</Badge>
						{y.available && <button className="small ghost" disabled={busy} onClick={() => install([y.year])}>{y.installed ? tr("atjaunot") : tr("ielikt")}</button>}
					</span>
				))}
			</div>
			<div className="dim">{tr("Neobligāts: serveris darbojas arī bez tā, bet Revit atbild tikai ar ielikto spraudni. Aizver Revit pirms ielikšanas, pēc tam restartē to.")}</div>
			{msg && <div className="dim" style={{ whiteSpace: "pre-line" }}>{msg}</div>}
			{err && <Err error={err} />}
		</div>
	);
}
