// Settings: which provider the agent uses (each user sets their own default), sign-in, API keys, model, effort, theme,
// Revit MCP path. Keys are stored encrypted by main; nothing here shows a stored key.
import { useEffect, useState } from "react";
import type { LoginNotice } from "../../shared/types";
import type { ProviderRow } from "../../shared/api";
import { call, errText, on } from "../bridge";
import { Badge, Err, useLoad } from "../ui";

export function Iestatijumi() {
	const settings = useLoad(() => call("settings.get"), []);
	const providers = useLoad<ProviderRow[]>(() => call("agent.providers"), []);
	const [notice, setNotice] = useState<LoginNotice | null>(null);
	const [answer, setAnswer] = useState("");
	const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
	const [err, setErr] = useState<string | null>(null);

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
			{s && (
				<div className="pane" style={{ padding: 0 }}>
					<label className="row">
						<span style={{ width: 150 }}>Servera index.js</span>
						<input className="grow mono" defaultValue={s.revitServerJs ?? ""} placeholder="nav konfigurēts" onBlur={(e) => act(() => call("settings.set", { revitServerJs: e.target.value.trim() || null }))} />
					</label>
					<label className="row">
						<span style={{ width: 150 }}>node.exe (neobligāts)</span>
						<input className="grow mono" defaultValue={s.revitNode ?? ""} placeholder="Electron node" onBlur={(e) => act(() => call("settings.set", { revitNode: e.target.value.trim() || null }))} />
					</label>
				</div>
			)}
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
