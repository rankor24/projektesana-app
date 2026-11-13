// Settings: which provider the agent uses (each user sets their own default), sign-in, API keys, model, effort, theme,
// Revit MCP path. Keys are stored encrypted by main; nothing here shows a stored key.
import { useEffect, useState } from "react";
import type { LoginNotice } from "../../shared/types";
import type { ProviderRow } from "../../shared/api";
import { call, errText, on } from "../bridge";
import { usageText } from "../../shared/tokens";
import { Badge, Err, useLoad } from "../ui";

export function Iestatijumi() {
	const settings = useLoad(() => call("settings.get"), []);
	const providers = useLoad<ProviderRow[]>(() => call("agent.providers"), []);
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
		} catch (e) {
			setErr(errText(e));
		}
	};
	const current = providers.data?.find((p) => p.id === s?.provider);
	const model = current?.models.find((m) => m.id === s?.model);

	return (
		<div className="pane fill">
			{err && <div className="err">{err}</div>}
			{settings.error ? <Err error={settings.error} /> : null}
			{providers.error ? <Err error={providers.error} /> : null}
			<div className="section-title">Lietotājs</div>
			{s && (
				<label className="row">
					<span style={{ width: 150 }}>Vārds, uzvārds</span>
					<input className="grow" defaultValue={s.userName} placeholder="nav norādīts — lēmumi tiek parakstīti kā “lietotājs”" onBlur={(e) => act(() => call("settings.set", { userName: e.target.value.trim() }))} />
				</label>
			)}
			<div className="dim small">Vārds tiek ierakstīts pie taviem lēmumiem (pieņemti atradumi, paša ierakstītas vērtības), BCF komentāros un tiek pateikts aģentam. Jau pieņemtie lēmumi savu vārdu saglabā.</div>
			<div className="section-title">Aģents</div>
			{s && (
				<div className="row">
					<label>
						Pakalpojums{" "}
						<select value={s.provider} onChange={(e) => act(() => call("settings.set", { provider: e.target.value, model: "", effort: "" }))}>
							{(providers.data ?? []).map((p) => (
								<option key={p.id} value={p.id}>
									{p.label}
									{p.configured ? "" : " (nav pieslēgts)"}
								</option>
							))}
						</select>
					</label>
					<label>
						Modelis{" "}
						<select value={s.model} onChange={(e) => act(() => call("settings.set", { model: e.target.value, effort: "" }))}>
							<option value="">noklusējums</option>
							{(current?.models ?? []).map((m) => (
								<option key={m.id} value={m.id}>
									{m.name}
									{m.legacy ? " (vecāks)" : ""}
								</option>
							))}
						</select>
					</label>
					{model && model.efforts.length > 0 && (
						<label>
							Piepūle{" "}
							<select value={s.effort} onChange={(e) => act(() => call("settings.set", { effort: e.target.value as never }))}>
								<option value="">noklusējums ({model.defaultEffort})</option>
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
						<th>Pakalpojums</th>
						<th>Stāvoklis</th>
						<th>Pieslēgšana</th>
					</tr>
				</thead>
				<tbody>
					{(providers.data ?? []).map((p) => (
						<tr key={p.id}>
							<td>{p.label}</td>
							<td>{p.configured ? <Badge tone="ok">pieslēgts ({p.method})</Badge> : <Badge tone="dim">nav pieslēgts</Badge>}</td>
							<td>
								<div className="row">
									{p.auth.includes("oauth") &&
										(p.configured && p.method === "oauth" ? (
											<button onClick={() => act(() => call("agent.logout", p.id))}>Atslēgties</button>
										) : (
											<button className="primary" onClick={() => act(() => call("agent.login", p.id))}>
												Pieslēgties ar abonementu
											</button>
										))}
									{p.auth.includes("api_key") && (
										<>
											<input type="password" placeholder="API atslēga" value={keyDraft[p.id] ?? ""} onChange={(e) => setKeyDraft({ ...keyDraft, [p.id]: e.target.value })} />
											<button disabled={!keyDraft[p.id]} onClick={() => act(async () => (await call("agent.setKey", p.id, keyDraft[p.id]), setKeyDraft({ ...keyDraft, [p.id]: "" })))}>
												Saglabāt
											</button>
											{p.configured && p.method === "api_key" && <button onClick={() => act(() => call("agent.clearKey", p.id))}>Dzēst atslēgu</button>}
											{p.keyUrl && (
												<a href={p.keyUrl} target="_blank" rel="noreferrer">
													kur dabūt
												</a>
											)}
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
					<b>Pieslēgšanās — {notice.provider}</b>
					{notice.type === "url" && (
						<div>
							Pārlūkā atvērta lapa. Ja tā neatvērās: <a href={notice.url}>{notice.url}</a>
						</div>
					)}
					{notice.type === "code" && (
						<div>
							Kods: <b className="mono">{notice.userCode}</b> — <a href={notice.url}>{notice.url}</a>
						</div>
					)}
					{notice.type === "info" && <div>{notice.message}</div>}
					{notice.type === "ask" && (
						<div className="row">
							<span>{notice.message}</span>
							<input className="grow" value={answer} onChange={(e) => setAnswer(e.target.value)} />
							<button onClick={() => act(async () => (await call("agent.loginAnswer", answer), setAnswer("")))}>Nosūtīt</button>
						</div>
					)}
					{notice.type === "done" && <Badge tone="ok">pieslēgts</Badge>}
					{notice.type === "error" && <div className="err">{notice.message}</div>}
				</div>
			)}
			<div className="section-title">Revit MCP</div>
			<RevitServer version={rv} />
			{s && (
				<>
					<label className="row">
						<span style={{ width: 150 }}>Cits index.js</span>
						<input className="grow mono" defaultValue={s.revitServerJs ?? ""} placeholder="tukšs = standarta instalācija (%LOCALAPPDATA%\Revit-MCP-Node)" onBlur={(e) => act(() => call("settings.set", { revitServerJs: e.target.value.trim() || null }).then(() => setRv((v) => v + 1)))} />
					</label>
					<label className="row">
						<span style={{ width: 150 }}>Cits node.exe</span>
						<input className="grow mono" defaultValue={s.revitNode ?? ""} placeholder="tukšs = servera node-runtime vai Electron node" onBlur={(e) => act(() => call("settings.set", { revitNode: e.target.value.trim() || null }).then(() => setRv((v) => v + 1)))} />
					</label>
				</>
			)}
			<div className="section-title">Izmantojums</div>
			<UsageTable />
			<div className="section-title">3D skats (BimCraft)</div>
			<BimcraftCopy />
			<div className="section-title">Biroja standarts</div>
			{s && (
				<label className="row">
					<span style={{ width: 150 }}>Projekta mapju koks (PDF)</span>
					<input
						className="grow mono"
						defaultValue={s.officeStandardPdf ?? ""}
						placeholder="nav norādīts — biroja prasības (nosaukumi, datumi) nav citējamas"
						onBlur={(e) => act(() => call("settings.set", { officeStandardPdf: e.target.value.trim() || null }))}
					/>
				</label>
			)}
			<div className="dim small">Biroja standarta teksts tiek lasīts no šī faila, kad lietotne strādā; tas netiek glabāts lietotnes kodā.</div>
			<div className="section-title">Izskats</div>
			{s && (
				<div className="row">
					{(["auto", "dark", "light"] as const).map((t) => (
						<button key={t} className={s.theme === t ? "primary" : ""} onClick={() => act(() => call("settings.set", { theme: t }))}>
							{t === "auto" ? "kā sistēmā" : t === "dark" ? "tumšs" : "gaišs"}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/** What the agent's model turns used, per project: tokens, and the price where the provider gave one. */
function UsageTable() {
	const u = useLoad(() => call("usage.summary"), []);
	if (u.error) return <Err error={u.error} />;
	if (!u.data) return <div className="dim small">ielādē…</div>;
	if (u.data.length === 0) return <div className="dim small">no data: aģents vēl nav izmantots.</div>;
	const sum = u.data.reduce((a, r) => ({ ...a, input: a.input + r.input, output: a.output + r.output, cacheRead: a.cacheRead + r.cacheRead, turns: a.turns + r.turns, priced: a.priced + r.priced, cost: r.cost === null ? a.cost : (a.cost ?? 0) + r.cost }), { input: 0, output: 0, cacheRead: 0, turns: 0, priced: 0, cost: null as number | null });
	return (
		<table className="small">
			<thead>
				<tr>
					<th>Projekts</th>
					<th>Palaišanas</th>
					<th>Izmantojums</th>
					<th>Pēdējo reizi</th>
				</tr>
			</thead>
			<tbody>
				{u.data.map((r) => (
					<tr key={r.project ?? "_"}>
						<td>{r.project ?? <span className="dim">bez projekta</span>}</td>
						<td>{r.runs}</td>
						<td>{usageText(r)}</td>
						<td className="dim">{new Date(r.lastAt).toLocaleDateString("lv-LV")}</td>
					</tr>
				))}
				<tr>
					<td>
						<b>Kopā</b>
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

/** The BimCraft copy the app ships: where the build took it from, when, and whether our bridge add-on is switched on. */
function BimcraftCopy() {
	const st = useLoad(() => call("bimcraft.status"), []);
	const b = st.data;
	if (st.error) return <Err error={st.error} />;
	if (!b) return <div className="dim small">pārbauda…</div>;
	return (
		<div className="small">
			<div className="row">
				<Badge tone={b.state === "gatavs" ? "ok" : b.state === "nav tilta" ? "warn" : "bad"}>{b.state}</Badge>
				{b.state !== "nav konfigurēts" && <span>{b.vendor} bibliotēkas · tilta papildinājums {b.addon ? "ieslēgts" : "nav ieslēgts"}</span>}
				<button className="small ghost" onClick={st.reload}>pārbaudīt</button>
			</div>
			{b.source && (
				<div className="dim mono">
					no {b.source}
					{b.copiedAt ? ` · ${b.copiedAt.slice(0, 16).replace("T", " ")}` : ""}
				</div>
			)}
			{b.message && <div className="dim">{b.message}</div>}
		</div>
	);
}

/** What the app actually starts for Revit: the server it found and how, and whether a Revit session answers. */
function RevitServer({ version }: { version: number }) {
	const st = useLoad(() => call("revit.status"), [version]);
	const r = st.data;
	if (st.error) return <Err error={st.error} />;
	if (!r) return <div className="dim small">pārbauda…</div>;
	return (
		<div className="small">
			<div className="row">
				<Badge tone={r.state === "savienots" ? "ok" : r.state === "nav konfigurēts" ? "bad" : "warn"}>{r.state}</Badge>
				{r.document && <span>{r.document}{r.version ? ` · Revit ${r.version}` : ""}</span>}
				<button className="small ghost" onClick={st.reload}>pārbaudīt</button>
			</div>
			{r.server && (
				<div className="dim mono">
					{r.server.source === "automātiski" ? "atrasts automātiski: " : "no Iestatījumiem: "}
					{r.server.serverJs}
					{r.server.node ? ` · ${r.server.node}` : " · Electron node"}
				</div>
			)}
			{r.message && <div className="dim">{r.message}</div>}
		</div>
	);
}
