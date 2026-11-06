// The agent dock: right half of the split view. Fokuss header, the conversation, the input.
// Events stream from main (agent.event); a `confirm` event shows the batch with Atļaut / Noraidīt.
import { useEffect, useRef, useState } from "react";
import type { AgentStatus } from "../../shared/api";
import type { RunEvent } from "../../shared/types";
import { call, errText, on } from "../bridge";
import { ui, useUi } from "../state";
import { useLoad } from "../ui";
import { windows, type PanelId } from "../windows";
import { readUi, type UiInstruction } from "../../shared/ui-instruction";
import { bimcraft } from "../preview/IfcView";

/** Carries out what an agent tool asked the window to do. */
function runUi(u: UiInstruction | null) {
	if (!u) return;
	if (u.open_panel) windows.open(u.open_panel.name as PanelId, u.open_panel.filter);
	if (u.show_source) ui.show({ kind: "source", sourceId: u.show_source.sourceId, page: u.show_source.page });
	if (u.highlight) bimcraft.send({ pj: 1, type: "highlight", guids: u.highlight.guids });
}

type Line =
	| { kind: "user"; text: string }
	| { kind: "assistant"; text: string; thinking?: string }
	| { kind: "tool"; id: string; name: string; detail?: string; ok?: boolean; output?: string }
	| { kind: "confirm"; id: string; tool: string; batch: string; answered?: boolean; allow?: boolean }
	| { kind: "error"; text: string };

export function AgentDock() {
	const { projectId, focus } = useUi();
	const status = useLoad<AgentStatus>(() => call("agent.status"), []);
	const [lines, setLines] = useState<Line[]>([]);
	const [runId, setRunId] = useState<string | null>(null);
	const [text, setText] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const runRef = useRef<string | null>(null);
	const endRef = useRef<HTMLDivElement>(null);

	// conversation of the open project
	useEffect(() => {
		let live = true;
		call("agent.history", projectId).then((h) => live && setLines(h.map((m) => (m.role === "user" ? { kind: "user", text: m.text } : { kind: "assistant", text: m.text }))));
		return () => {
			live = false;
		};
	}, [projectId]);

	useEffect(
		() =>
			on("agent.event", ({ runId: id, event }) => {
				if (id !== runRef.current) return;
				setLines((ls) => apply(ls, event));
				if (event.type === "tool_result" && event.ok) runUi(readUi(event.output));
				if (event.type === "done" || event.type === "error") {
					runRef.current = null;
					setRunId(null);
					ui.bump();
				}
			}),
		[],
	);

	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [lines]);

	const send = async () => {
		if (!text.trim() || runId) return;
		setErr(null);
		const t = text;
		try {
			const r = await call("agent.send", projectId, t, focus);
			runRef.current = r.runId;
			setRunId(r.runId);
			setLines((ls) => [...ls, { kind: "user", text: t }]);
			setText("");
		} catch (e) {
			setErr(errText(e));
		}
	};

	const answer = async (id: string, allow: boolean) => {
		try {
			await call("agent.confirm", id, allow);
			setLines((ls) => ls.map((l) => (l.kind === "confirm" && l.id === id ? { ...l, answered: true, allow } : l)));
		} catch (e) {
			setErr(errText(e));
		}
	};

	const st = status.data;
	return (
		<aside className="agent-dock">
			<div className="agent-head">
				<div className="row">
					<b>Aģents</b>
					{st ? (
						<button className={`chip ${st.signedIn ? "" : "bad"}`} onClick={() => windows.open("iestatijumi")} title={st.reason}>
							{st.providerLabel} · {st.model} · {st.signedIn ? "pieslēgts" : "nav pieslēgts"}
						</button>
					) : (
						<span className="dim small">…</span>
					)}
					<span className="badge dim" title="Revit MCP">Revit: {st?.revit ?? "…"}</span>
					<span className="grow" />
					<button className="ghost small" title="Sākt jaunu sarunu (pieraksts paliek)" onClick={() => call("agent.reset", projectId).then(() => setLines([]))}>
						jauna saruna
					</button>
				</div>
				<div className="focus-head">
					<span className="dim">Fokuss:</span>
					{focus.length === 0 ? (
						<span className="dim">nekas</span>
					) : (
						<>
							{focus.map((f) => (
								<span key={`${f.kind}:${f.id}`} className="chip" title={JSON.stringify(f.data ?? {})}>
									{f.label}
									<button className="x" onClick={() => ui.focusRemove(f.kind, f.id)}>×</button>
								</span>
							))}
							<button className="ghost small" onClick={() => ui.focusClear()}>notīrīt</button>
						</>
					)}
				</div>
			</div>
			<div className="chat">
				{lines.length === 0 && <div className="dim small chat-empty">{projectId ? "Saruna par šo projektu vēl nav sākta." : "nav projekta — saruna bez projekta datiem."}</div>}
				{lines.map((l, i) => (
					<ChatLine key={i} line={l} onAnswer={answer} />
				))}
				{runId && <div className="dim small">strādā…</div>}
				<div ref={endRef} />
			</div>
			{err && <div className="err">{err}</div>}
			<div className="chat-input">
				<textarea
					rows={3}
					value={text}
					placeholder={st && !st.signedIn ? "nav pieslēgts — atver Iestatījumi" : "Raksti aģentam… (Ctrl+Enter)"}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
					}}
				/>
				<div className="row">
					<span className="grow" />
					{runId ? <button onClick={() => call("agent.stop")}>Apturēt</button> : <button className="primary" disabled={!text.trim()} onClick={send}>Sūtīt</button>}
				</div>
			</div>
		</aside>
	);
}

function apply(ls: Line[], e: RunEvent): Line[] {
	const last = ls[ls.length - 1];
	switch (e.type) {
		case "text":
			if (last?.kind === "assistant") return [...ls.slice(0, -1), { ...last, text: last.text + e.text }];
			return [...ls, { kind: "assistant", text: e.text }];
		case "thinking":
			if (last?.kind === "assistant") return [...ls.slice(0, -1), { ...last, thinking: (last.thinking ?? "") + e.text }];
			return [...ls, { kind: "assistant", text: "", thinking: e.text }];
		case "tool":
			return [...ls, { kind: "tool", id: e.id ?? "", name: e.name, detail: e.detail }];
		case "tool_result":
			return ls.map((l) => (l.kind === "tool" && l.id === e.id ? { ...l, ok: e.ok, output: e.output } : l));
		case "confirm":
			return [...ls, { kind: "confirm", id: e.id, tool: e.tool, batch: e.batch }];
		case "error":
			return [...ls, { kind: "error", text: e.message }];
		case "done":
			// the streamed text is already shown; a provider that does not stream sends the whole answer here
			if (last?.kind === "assistant" || !e.text) return ls;
			return [...ls, { kind: "assistant", text: e.text }];
		default:
			return ls;
	}
}

function ChatLine({ line: l, onAnswer }: { line: Line; onAnswer: (id: string, allow: boolean) => void }) {
	if (l.kind === "user") return <div className="msg user">{l.text}</div>;
	if (l.kind === "assistant")
		return (
			<div className="msg assistant">
				{l.thinking && (
					<details className="thinking">
						<summary>domāšana</summary>
						{l.thinking}
					</details>
				)}
				{l.text}
			</div>
		);
	if (l.kind === "tool")
		return (
			<details className={`tool ${l.ok === false ? "bad" : ""}`}>
				<summary>
					{l.ok === undefined ? "…" : l.ok ? "✓" : "✗"} {l.name}
				</summary>
				{l.detail && <pre>{l.detail}</pre>}
				{l.output && <pre>{l.output}</pre>}
			</details>
		);
	if (l.kind === "confirm")
		return (
			<div className="confirm">
				<div>
					<b>Apstiprini partiju:</b> {l.tool}
				</div>
				<pre>{l.batch}</pre>
				{l.answered ? (
					<span className={`badge ${l.allow ? "ok" : "bad"}`}>{l.allow ? "atļauts" : "noraidīts"}</span>
				) : (
					<div className="row">
						<button className="primary" onClick={() => onAnswer(l.id, true)}>Atļaut</button>
						<button onClick={() => onAnswer(l.id, false)}>Noraidīt</button>
					</div>
				)}
			</div>
		);
	return <div className="err">{l.text}</div>;
}
