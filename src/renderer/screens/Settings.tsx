// Settings: one agent harness (pi) for the whole family. Provider, model and effort come from lists
// (pi's catalog + each provider's live model list), so no model name is ever typed by hand.
import { useEffect, useMemo, useState } from "react";
import { api, onLogin, pickFiles } from "../api";
import { Badge, Err, useAction, useLoad } from "../ui";
import type { AppSettings, Effort, LoginNotice, ModelInfo, ProviderStatus } from "../types";

const EFFORT_LABEL: Record<Effort, string> = { off: "izslēgta", minimal: "minimāla", low: "zema", medium: "vidēja", high: "augsta", xhigh: "ļoti augsta", max: "maksimāla" };

export function Settings({ theme, onTheme }: { theme: "auto" | "light" | "dark"; onTheme: (t: "auto" | "light" | "dark") => void }) {
	const s = useLoad(() => api<AppSettings>("settingsGet"), []);
	const providers = useLoad(() => api<ProviderStatus[]>("providersStatus"), []);
	const act = useAction();

	async function save(patch: Partial<AppSettings>) {
		await act.run(() => api("settingsSave", patch));
		s.reload();
	}
	const refreshAll = () => {
		providers.reload();
		s.reload();
	};

	return (
		<>
			<h1>Iestatījumi</h1>
			<Err text={act.err ?? s.err ?? providers.err} />
			{s.data && providers.data && <AgentCard settings={s.data} providers={providers.data} onSave={save} />}
			{providers.data && <Connections providers={providers.data} onChange={refreshAll} />}
			<div className="card">
				<h3>Izskats</h3>
				<select
					value={theme}
					onChange={(e) => {
						onTheme(e.target.value as typeof theme);
						void save({ theme: e.target.value as AppSettings["theme"] });
					}}
				>
					<option value="auto">Automātiski</option>
					<option value="light">Gaišs</option>
					<option value="dark">Tumšs</option>
				</select>
			</div>
			{s.data && <RevitCard current={s.data.revitServerJs} onSave={(v) => save({ revitServerJs: v })} />}
			<LogCard />
		</>
	);
}

// ---- provider / model / effort ---------------------------------------------------------

function AgentCard({ settings, providers, onSave }: { settings: AppSettings; providers: ProviderStatus[]; onSave: (p: Partial<AppSettings>) => Promise<void> }) {
	const list = useLoad(() => api<{ models: ModelInfo[]; defaultModel: string | null; fetchedAt: number | null }>("modelsList", settings.provider), [settings.provider]);
	const refresh = useAction();
	const [report, setReport] = useState<Record<string, string> | null>(null);
	const [showOld, setShowOld] = useState(false);
	const prov = providers.find((p) => p.id === settings.provider);
	const models = list.data?.models ?? [];
	const effective = settings.model || list.data?.defaultModel || "";
	const current = models.find((m) => m.id === effective);
	const shown = models.filter((m) => showOld || !m.legacy || m.id === settings.model);

	return (
		<div className="card">
			<h3>Aģents</h3>
			<div className="muted" style={{ marginBottom: 8 }}>
				Viens aģents (pi) visām ģimenes lietotnēm — tas pats, kas BIM Crew un Konkursu App. Modeļu saraksts nāk no pi kataloga un pakalpojuma paša saraksta, tāpēc jaunus modeļus nav jāraksta ar roku.
			</div>
			<div className="row">
				<label>
					Pakalpojums{" "}
					<select value={settings.provider} onChange={(e) => onSave({ provider: e.target.value, model: "", effort: "" })}>
						{providers.map((p) => (
							<option key={p.id} value={p.id}>
								{p.configured ? "✓ " : "· "}
								{p.label}
							</option>
						))}
					</select>
				</label>
				{prov && <Badge kind={prov.configured ? "ok" : "bad"}>{prov.configured ? "gatavs" : "nav pieslēgts"}</Badge>}
				{prov && !prov.configured && <span className="muted">{prov.reason}</span>}
			</div>
			<div className="row" style={{ marginTop: 8 }}>
				<label>
					Modelis{" "}
					<select value={settings.model} onChange={(e) => onSave({ model: e.target.value, effort: "" })} style={{ minWidth: 300 }}>
						<option value="">Noklusējums{list.data?.defaultModel ? ` (${list.data.defaultModel})` : ""}</option>
						{shown.map((m) => (
							<option key={m.id} value={m.id}>
								{m.name !== m.id ? `${m.name} — ${m.id}` : m.id}
								{m.live ? " · jauns (no pakalpojuma saraksta)" : ""}
								{m.legacy ? " · vecāks" : ""}
							</option>
						))}
					</select>
				</label>
				<label className="row">
					<input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> rādīt vecākus
				</label>
				<label>
					Domāšanas līmenis{" "}
					<select value={settings.effort} onChange={(e) => onSave({ effort: e.target.value as Effort | "" })} disabled={!current || current.efforts.length === 0}>
						<option value="">Noklusējums{current?.efforts.length ? ` (${EFFORT_LABEL[current.defaultEffort]})` : ""}</option>
						{(current?.efforts ?? []).map((e) => (
							<option key={e} value={e}>
								{EFFORT_LABEL[e]}
							</option>
						))}
					</select>
				</label>
				{current && current.efforts.length === 0 && <span className="muted">šim modelim domāšanas līmeņa nav</span>}
			</div>
			<div className="row" style={{ marginTop: 8 }}>
				<button
					className="btn"
					disabled={refresh.busy}
					onClick={async () => {
						const r = await refresh.run(() => api<Record<string, string>>("modelsRefresh"));
						if (r) setReport(r);
						list.reload();
					}}
				>
					{refresh.busy ? "Lejupielādē sarakstus…" : "Atjaunot modeļu sarakstus"}
				</button>
				<span className="muted">
					{models.length} modeļi
					{list.data?.fetchedAt ? ` · pakalpojuma saraksts no ${new Date(list.data.fetchedAt).toLocaleString("lv")}` : " · tikai pi katalogs (saraksts vēl nav lejupielādēts)"}
				</span>
			</div>
			<Err text={refresh.err ?? list.err} />
			{report && (
				<div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
					{Object.entries(report).map(([p, r]) => (
						<div key={p}>
							{providers.find((x) => x.id === p)?.label ?? p}: {r}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ---- connections: sign-in and API keys -----------------------------------------------

function Connections({ providers, onChange }: { providers: ProviderStatus[]; onChange: () => void }) {
	const act = useAction();
	const [keys, setKeys] = useState<Record<string, string>>({});
	const [notices, setNotices] = useState<LoginNotice[]>([]);
	const [loggingIn, setLoggingIn] = useState<string | null>(null);
	const [answer, setAnswer] = useState("");

	useEffect(
		() =>
			onLogin((n) => {
				setNotices((x) => [...x, n]);
				if (n.type === "done" || n.type === "error") {
					setLoggingIn(null);
					onChange();
				}
			}),
		[onChange],
	);

	async function login(id: string) {
		setNotices([]);
		setLoggingIn(id);
		await act.run(() => api("providerLogin", id));
		setLoggingIn(null);
		onChange();
	}
	const ask = useMemo(() => [...notices].reverse().find((n) => n.type === "ask"), [notices]);
	const code = useMemo(() => [...notices].reverse().find((n) => n.type === "code"), [notices]);

	return (
		<div className="card">
			<h3>Pieslēgumi un API atslēgas</h3>
			<table>
				<tbody>
					{providers.map((p) => (
						<tr key={p.id}>
							<td style={{ width: 170 }}>
								<b>{p.label}</b>
							</td>
							<td style={{ width: 150 }}>
								<Badge kind={p.configured ? "ok" : undefined}>{p.configured ? (p.method === "oauth" ? "pieslēgts" : "atslēga saglabāta") : "nav"}</Badge>
							</td>
							<td>
								<div className="row">
									{p.auth.includes("oauth") &&
										(p.configured && p.method === "oauth" ? (
											<button className="btn" onClick={async () => (await act.run(() => api("providerLogout", p.id)), onChange())}>
												Atslēgties
											</button>
										) : (
											<button className="btn primary" disabled={loggingIn !== null} onClick={() => login(p.id)}>
												{loggingIn === p.id ? "Gaida pārlūkā…" : p.id === "xai" ? "Pieslēgties ar SuperGrok" : "Pieslēgties ar ChatGPT"}
											</button>
										))}
									{p.auth.includes("api_key") && (
										<>
											<input type="password" placeholder={p.configured && p.method === "api_key" ? "saglabāta — ievadi jaunu, lai nomainītu" : "API atslēga"} value={keys[p.id] ?? ""} onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))} style={{ minWidth: 260 }} />
											<button
												className="btn"
												disabled={!keys[p.id]?.trim()}
												onClick={async () => {
													if (await act.run(() => api("keySet", p.id, keys[p.id]))) setKeys((k) => ({ ...k, [p.id]: "" }));
													onChange();
												}}
											>
												Saglabāt
											</button>
											{p.configured && p.method === "api_key" && (
												<button className="btn danger" onClick={async () => (await act.run(() => api("keyClear", p.id)), onChange())}>
													Dzēst atslēgu
												</button>
											)}
											{p.keyUrl && (
												<button className="btn" onClick={() => api("openUrl", p.keyUrl)}>
													Kur dabūt atslēgu
												</button>
											)}
										</>
									)}
								</div>
								{p.id === "anthropic" && <div className="muted" style={{ fontSize: 12 }}>Claude abonementa (Claude.ai) pieslēgšanu Anthropic trešo pušu lietotnēm neatļauj — tikai Console API atslēga.</div>}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Atslēgas un pieslēgumu žetoni tiek glabāti šifrēti ar Windows (tikai šajā datorā, tikai tavam lietotājam).</div>
			<Err text={act.err} />
			{(loggingIn || notices.length > 0) && (
				<div className="card" style={{ marginTop: 10 }}>
					<h3>Pieslēgšanās</h3>
					{code && code.type === "code" && (
						<div>
							Ievadi šo kodu pārlūkā atvērtajā lapā: <b style={{ fontSize: 22, letterSpacing: 2 }}>{code.userCode}</b>
						</div>
					)}
					{notices.map((n, i) => (
						<div key={i} className={n.type === "error" ? "err" : "muted"}>
							{n.type === "url" && <>Pārlūkā atvērta pieslēgšanās lapa.</>}
							{n.type === "info" && n.message}
							{n.type === "done" && "Pieslēgts."}
							{n.type === "error" && n.message}
						</div>
					))}
					{ask && ask.type === "ask" && loggingIn && (
						<div className="row" style={{ marginTop: 6 }}>
							<span>{ask.message}</span>
							<input type="text" value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ minWidth: 340 }} />
							<button className="btn primary" onClick={() => (api("loginAnswer", answer), setAnswer(""))}>
								Nosūtīt
							</button>
						</div>
					)}
					{loggingIn && (
						<button className="btn" style={{ marginTop: 6 }} onClick={() => api("loginCancel")}>
							Atcelt
						</button>
					)}
				</div>
			)}
		</div>
	);
}

// ---- Revit, log ------------------------------------------------------------------------

function RevitCard({ current, onSave }: { current: string | null; onSave: (v: string | null) => Promise<void> }) {
	const rv = useLoad(() => api<{ state: string; reason?: string }>("revitStatus"), [current]);
	const [js, setJs] = useState<string | null>(null);
	const def = useLoad(() => api<string | null>("revitDefaultPath"), []);
	return (
		<div className="card">
			<h3>Revit MCP serveris</h3>
			<div className="row">
				<input type="text" placeholder="D:\Code\BIM\revit-mcp\server\build\index.js" value={js ?? current ?? ""} onChange={(e) => setJs(e.target.value)} style={{ minWidth: 420 }} />
				<button
					className="btn"
					onClick={async () => {
						const [p] = await pickFiles("Izvēlies Revit MCP servera failu (server/build/index.js)", [{ name: "JavaScript", extensions: ["js", "mjs", "cjs"] }]);
						if (p) setJs(p);
					}}
				>
					Izvēlēties failu…
				</button>
				{def.data && def.data !== (js ?? current) && (
					<button className="btn" onClick={() => setJs(def.data)} title={def.data}>
						Izmantot parasto vietu
					</button>
				)}
				<button className="btn primary" onClick={() => onSave((js ?? current ?? "").trim() || null)}>
					Saglabāt
				</button>
				{rv.data && <Badge kind={rv.data.state === "connected" ? "ok" : "warn"}>{rv.data.state === "connected" ? "pieslēgts" : rv.data.state === "not configured" ? "nav konfigurēts" : "nav pieslēgts"}</Badge>}
				<span className="muted">{rv.data?.reason}</span>
			</div>
		</div>
	);
}

function LogCard() {
	const f = useLoad(() => api<string>("logFile"), []);
	return (
		<div className="card">
			<h3>Žurnāla fails</h3>
			<div className="mono">{f.data}</div>
			<div className="muted" style={{ fontSize: 12 }}>Šeit tiek ierakstītas lietotnes un ekrānu kļūdas. F5 pārlādē logu, Ctrl+Shift+I atver izstrādātāja rīkus.</div>
		</div>
	);
}
