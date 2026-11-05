import { useEffect, useRef, useState } from "react";
import { api, onAgent, pickFiles } from "../api";
import { Badge, Err, useAction, useLoad } from "../ui";
import type { AgentEvent, ChatState } from "../types";

export function Chat({ root, onModel }: { root: string; onModel: () => void }) {
	const st = useLoad(() => api<ChatState>("chatHistory", root), [root]);
	const agent = useLoad(() => api<{ ready: boolean; reason: string }>("agentStatus"), []);
	const act = useAction();
	const [text, setText] = useState("");
	const [events, setEvents] = useState<AgentEvent[]>([]);
	const end = useRef<HTMLDivElement>(null);

	useEffect(() => onAgent((e) => setEvents((x) => [...x.slice(-200), e])), []);
	useEffect(() => end.current?.scrollIntoView({ block: "end" }), [st.data?.messages.length, events.length]);

	async function send() {
		const t = text.trim();
		if (!t) return;
		setText("");
		setEvents([]);
		// show Boris's message at once, then reload with the agent's answer and the updated checklist
		st.data?.messages.push({ at: new Date().toISOString(), role: "boris", text: t });
		const r = await act.run(() => api<{ ok: boolean; reason?: string }>("chatSend", root, t));
		if (r && !r.ok) act.setErr(r.reason ?? "Aģents neatbildēja.");
		st.reload();
	}

	const [attached, setAttached] = useState<{ path: string; role: string; quote: string | null }[]>([]);
	async function attach() {
		const picked = await pickFiles("Izvēlies failus, ko aģentam parādīt");
		if (!picked.length) return;
		const r = await act.run(() => api<{ path: string; role: string; quote: string | null }[]>("chatAttach", root, picked));
		if (r) setAttached((x) => [...x, ...r]);
	}

	const c = st.data?.completeness;
	return (
		<>
			<h1>Čats — projekta uzstādīšana</h1>
			<div className="muted" style={{ marginBottom: 10 }}>
				Projekta datus aģents jau savāc no mapes (paneļi 1–8). Šeit viņš jautā tikai to, ko dokumentos neatrada. Katram faktam ir avots — burtisks citāts no faila vai no tavas ziņas; to pārbauda kods.
			</div>
			{agent.data && (
				<div className="row" style={{ marginBottom: 10 }}>
					<Badge kind={agent.data.ready ? "ok" : "bad"}>{agent.data.ready ? "aģents gatavs" : "aģents nav gatavs"}</Badge>
					<span className="muted">{agent.data.reason}</span>
					{!agent.data.ready && <span className="muted">→ Iestatījumi</span>}
				</div>
			)}
			<div className="split">
				<div>
					<div className="card">
						<div className="chat">
							{st.data?.messages.length === 0 && <div className="empty">Uzraksti, par kādu objektu ir projekts, un aģents sāks jautāt.</div>}
							{st.data?.messages.map((m, i) => (
								<div key={i} className={`msg ${m.role}`}>
									{m.text}
								</div>
							))}
							<div ref={end} />
						</div>
						{act.busy && (
							<div className="activity">
								{events.filter((e) => e.type === "tool" || e.type === "error").map((e, i) => (
									<div key={i}>{e.type === "tool" ? `▸ ${e.name}` : `✖ ${e.message}`}</div>
								))}
							</div>
						)}
						<Err text={act.err ?? st.err} />
						{attached.map((a) => (
							<div key={a.path} className="muted">
								Pievienots: <span className="mono">{a.path}</span> — loma <b>{a.role}</b>
								{a.quote ? ` („${a.quote}”)` : " (ieteikuma nav — maini 7.–8. panelī)"}
							</div>
						))}
						<div className="row" style={{ marginTop: 8 }}>
							<textarea
								value={text}
								placeholder="Raksti Borisa atbildi…  (Ctrl+Enter — sūtīt)"
								onChange={(e) => setText(e.target.value)}
								onKeyDown={(e) => e.ctrlKey && e.key === "Enter" && send()}
								style={{ flex: 1, minHeight: 56 }}
							/>
							<div style={{ display: "grid", gap: 6 }}>
								<button className="btn primary" onClick={send} disabled={act.busy || !text.trim()}>
									Sūtīt
								</button>
								<button className="btn" onClick={attach} disabled={act.busy} title="Pievieno failu no jebkuras vietas; tas tiek nokopēts projekta mapē">
									Pievienot failu…
								</button>
								{act.busy && (
									<button className="btn danger" onClick={() => api("agentStop")}>
										Apturēt
									</button>
								)}
							</div>
						</div>
					</div>
				</div>
				<div className="card">
					<h2>Kontrolsaraksts</h2>
					{c?.blocked && <div className="muted">{c.blocked}</div>}
					{c?.items.map((i) => (
						<div key={i.id} style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
							<div className="row">
								<Badge kind={i.status === "filled" ? "ok" : i.status === "unknown" || i.status === "proposed" ? "warn" : i.required ? "bad" : undefined}>{i.status === "filled" ? "✓" : i.status === "unknown" ? "?" : i.status === "proposed" ? "~" : "·"}</Badge>
								<span>{i.label}</span>
							</div>
							{i.fact && (
								<div className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
									<b>{i.fact.value}</b> — {i.fact.source.kind === "file" ? `${i.fact.source.path}: „${i.fact.source.quote}”` : i.fact.source.kind === "rules" ? `noteikumu modulis: „${i.fact.source.quote.slice(0, 120)}…”` : `Boriss: „${i.fact.source.quote}”`}
									{i.status === "proposed" && <> — gaida apstiprinājumu (7.–8. panelis)</>}
								</div>
							)}
						</div>
					))}
					<div style={{ marginTop: 10 }}>
						{c?.complete ? (
							<>
								<Badge kind="ok">kontrolsaraksts pilns</Badge>
								<div style={{ marginTop: 6 }}>
									<button className="btn primary" onClick={onModel}>
										Sākt modelēt →
									</button>
								</div>
							</>
						) : (
							<span className="muted">Modelēšana sākas, kad obligātie punkti ir aizpildīti vai tu esi tos atzīmējis kā nezināmus.</span>
						)}
					</div>
				</div>
			</div>
		</>
	);
}
