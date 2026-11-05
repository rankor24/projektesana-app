// The top of panels 1–8: the agent reads the project folder and fills the page. Boris confirms, corrects or rejects.
// Nothing on these pages is typed in first; typing is only the way to correct what the agent proposed or missed.
import { useEffect, useState } from "react";
import { api, onGather } from "../api";
import { Badge, Err, useAction, useLoad } from "../ui";
import type { FactRow, GatherState, SectionId } from "../types";

const WORK: [string, string][] = [
	["new_build", "Jaunbūve"],
	["reconstruction", "Pārbūve"],
	["simple_reconstruction", "Vienkāršota pārbūve"],
	["renovation", "Atjaunošana"],
	["simplified_renovation", "Vienkāršota atjaunošana"],
	["use_change", "Lietošanas veida maiņa"],
	["demolition", "Nojaukšana"],
];
const USE: [string, string][] = [
	["residential_1_2", "Dzīvojamā ēka (1–2 dzīvokļi)"],
	["residential_other", "Dzīvojamā ēka (pārējās)"],
	["public", "Publiska ēka"],
	["production", "Ražošanas ēka"],
	["warehouse", "Noliktava"],
	["auxiliary", "Palīgēka"],
	["agricultural", "Lauksaimniecības ēka"],
	["other", "Cita"],
];
const CHOICES: Record<string, [string, string][]> = {
	"engine.work": WORK,
	"engine.use": USE,
	"engine.seasonal": [["true", "Jā"], ["false", "Nē"]],
	"engine.publicFunded": [["true", "Jā"], ["false", "Nē"]],
	"engine.documentedGroup": [["1", "1. grupa"], ["2", "2. grupa"], ["3", "3. grupa"]],
};
const shown = (id: string, v?: string) => (v === undefined ? "" : (CHOICES[id]?.find(([x]) => x === v)?.[1] ?? v));

const STATE: Record<FactRow["state"], { label: string; kind?: "ok" | "warn" | "bad" }> = {
	open: { label: "nav atrasts", kind: "bad" },
	proposed: { label: "ieteikts — pārbaudi", kind: "warn" },
	confirmed: { label: "apstiprināts", kind: "ok" },
	unknown: { label: "nezināms" },
};

export function sourceLine(s: NonNullable<FactRow["source"]>) {
	if (s.kind === "file") return s.path;
	if (s.kind === "boris") return "Borisa vārdi čatā";
	if (s.kind === "unknown") return "Boriss: nezina";
	return "aprēķināts no noteikumiem";
}

/** Opens the file a quote came from in its own program. */
export function OpenFile({ root, path }: { root: string; path: string }) {
	const act = useAction();
	return (
		<>
			<button className="btn" disabled={act.busy} onClick={() => act.run(() => api("fileOpen", root, path))} title="Atvērt failu">
				Atvērt
			</button>
			<Err text={act.err} />
		</>
	);
}

interface Props {
	root: string;
	section: SectionId;
	title: string;
	/** what the agent does here, in one sentence */
	what: string;
	/** called when a run ends or a decision is made, so the page below reloads its own lists */
	onChange?: () => void;
	/** hide the fact table (panels whose content is a list of their own) */
	noFacts?: boolean;
}

export function GatherPanel({ root, section, title, what, onChange, noFacts }: Props) {
	const state = useLoad(() => api<GatherState>("gatherState", root), [root]);
	const facts = useLoad(() => api<FactRow[]>("gatherFacts", root, section), [root, section]);
	const agent = useLoad(() => api<{ ready: boolean; reason: string }>("agentStatus"), []);
	const act = useAction();
	const [feed, setFeed] = useState<string[]>([]);
	const [scanning, setScanning] = useState<{ done: number; total: number } | null>(null);
	const [busy, setBusy] = useState(false);
	const [reason, setReason] = useState<string | null>(null);
	const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

	const reloadAll = () => {
		state.reload();
		facts.reload();
		onChange?.();
	};

	useEffect(
		() =>
			onGather((e) => {
				if (e.root !== root) return;
				if (e.type === "scan") setScanning({ done: e.done, total: e.total });
				else if (e.type === "scan-done") setScanning(null);
				else if (e.section !== section) return;
				else if (e.type === "start") setFeed([]);
				else if (e.type === "agent") {
					const a = e.event;
					const line = a.type === "tool" ? `▸ ${a.name}${a.detail ? " " + a.detail : ""}` : a.type === "tool_result" ? `${a.ok ? "✓" : "✗"} ${a.name}${a.detail ? " " + a.detail : ""}` : a.type === "error" ? `✗ ${a.message}` : null;
					if (line) setFeed((f) => [...f.slice(-11), line]);
					if (a.type === "tool_result" && a.ok) facts.reload();
				} else if (e.type === "end" || e.type === "failed") {
					reloadAll();
				}
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[root, section],
	);

	const runningNow = busy || (state.data?.running ?? null) !== null;
	const run = state.data?.runs[section];
	const scan = state.data?.scan;
	const bad = scan?.files.filter((f) => f.text !== "ok") ?? [];

	async function gather() {
		setBusy(true);
		setReason(null);
		setFeed([]);
		try {
			const r = await act.run(() => api<{ ok: true; summary: string } | { ok: false; reason: string }>("gatherRun", root, section));
			if (r && !r.ok) setReason(r.reason);
		} finally {
			setBusy(false);
			reloadAll();
		}
	}
	async function rescan() {
		await act.run(() => api("gatherScan", root));
		reloadAll();
	}
	async function decide(id: string, op: "factConfirm" | "factReject") {
		await act.run(() => api(op, root, id));
		reloadAll();
	}
	async function saveEdit() {
		if (!editing) return;
		if (await act.run(() => api("factEdit", root, editing.id, editing.value))) {
			setEditing(null);
			reloadAll();
		}
	}

	const open = (facts.data ?? []).filter((f) => f.state === "open").length;
	const proposed = (facts.data ?? []).filter((f) => f.state === "proposed").length;

	return (
		<div className="card gather">
			<div className="row">
				<h3 style={{ margin: 0 }}>{title}</h3>
				{run && <Badge kind={run.ok ? "ok" : "bad"}>{run.ok ? `aģents izlasīja ${run.at.slice(0, 16).replace("T", " ")}` : "pēdējā reize neizdevās"}</Badge>}
				{!run && <Badge>aģents vēl nav strādājis</Badge>}
				<span className="grow" />
				<button className="btn" onClick={rescan} disabled={act.busy || runningNow} title="Reģistrē jaunus failus, nolasa to tekstu">
					Pārskatīt mapi
				</button>
				<button className="btn primary" onClick={gather} disabled={runningNow || agent.data?.ready === false} title={agent.data?.ready === false ? "Vajag pieslēgtu aģentu" : undefined}>
					{runningNow ? "Aģents lasa…" : run ? "Lasīt vēlreiz no mapes" : "Savākt no projekta mapes"}
				</button>
			</div>
			<div className="muted" style={{ margin: "6px 0" }}>
				{what}
			</div>
			{agent.data && !agent.data.ready && (
				<div className="err">
					Aģents nav pieslēgts: {agent.data.reason}
					<div className="muted">Bez aģenta šeit darbojas „Pārskatīt mapi”, failu atvēršana un ierakstīšana ar roku. Datu nolasīšanai pieslēdz aģentu: Iestatījumi → Aģents.</div>
				</div>
			)}
			{scanning && (
				<div className="muted">
					Pārskatu mapi: {scanning.done} no {scanning.total}…
				</div>
			)}
			{scan ? (
				<div className="muted">
					Mapē {scan.found} faili, nolasīti {scan.files.filter((f) => f.text === "ok").length}
					{bad.length > 0 && (
						<>
							, <details style={{ display: "inline" }}>
								<summary style={{ display: "inline", cursor: "pointer", color: "var(--warn)" }}>{bad.length} nav nolasīti</summary>
								{bad.map((f) => (
									<div key={f.path} className="mono">
										{f.path} — {f.note ?? f.text}
									</div>
								))}
							</details>
						</>
					)}
					. Pārskatīta {scan.at.slice(0, 16).replace("T", " ")}.
				</div>
			) : (
				<div className="muted">Mape vēl nav pārskatīta — spied „Pārskatīt mapi” vai „Savākt”.</div>
			)}
			{feed.length > 0 && <pre className="feed">{feed.join("\n")}</pre>}
			<Err text={act.err ?? state.err ?? facts.err} />
			{reason && (
				<div className="err">
					Aģents nevarēja sākt: {reason}
					<div className="muted">Iestatījumi → Aģents: izvēlies pakalpojumu un pieslēdzies vai ievadi atslēgu.</div>
				</div>
			)}
			{run && !run.ok && run.error && <div className="err">{run.error}</div>}
			{run?.summary && (
				<details style={{ margin: "6px 0" }}>
					<summary style={{ cursor: "pointer" }}>Aģenta atskaite ({run.tools} rīku izsaukumi)</summary>
					<div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{run.summary}</div>
				</details>
			)}
			{!noFacts && facts.data && facts.data.length > 0 && (
				<>
					<div className="row" style={{ margin: "8px 0 4px" }}>
						<b>Atrastie dati</b>
						{proposed > 0 && <Badge kind="warn">jāpārbauda: {proposed}</Badge>}
						{open > 0 && <Badge kind="bad">nav atrasts: {open}</Badge>}
					</div>
					<table>
						<thead>
							<tr>
								<th style={{ width: "22%" }}>Punkts</th>
								<th style={{ width: "22%" }}>Vērtība</th>
								<th>Avots</th>
								<th style={{ width: 150 }}>Statuss</th>
								<th style={{ width: 230 }} />
							</tr>
						</thead>
						<tbody>
							{facts.data.map((f) => (
								<tr key={f.id}>
									<td>{f.label}</td>
									<td>
										{editing?.id === f.id ? (
											<EditValue id={f.id} value={editing.value} onChange={(v) => setEditing({ id: f.id, value: v })} />
										) : (
											<b>{shown(f.id, f.value)}</b>
										)}
									</td>
									<td>
										{f.source ? (
											<>
												<div className="mono">{sourceLine(f.source)}</div>
												<div className="quote">„{f.source.quote.length > 220 ? f.source.quote.slice(0, 220) + "…" : f.source.quote}”</div>
												{f.source.kind === "file" && f.source.path && <OpenFile root={root} path={f.source.path} />}
											</>
										) : (
											<span className="muted">—</span>
										)}
									</td>
									<td>
										<Badge kind={STATE[f.state].kind}>{STATE[f.state].label}</Badge>
									</td>
									<td>
										{editing?.id === f.id ? (
											<div className="row">
												<button className="btn primary" disabled={act.busy || !editing.value.trim()} onClick={saveEdit}>
													Saglabāt
												</button>
												<button className="btn" onClick={() => setEditing(null)}>
													Atcelt
												</button>
											</div>
										) : (
											<div className="row">
												{f.state === "proposed" && (
													<button className="btn primary" disabled={act.busy} onClick={() => decide(f.id, "factConfirm")}>
														Pareizi
													</button>
												)}
												{f.id !== "group" && f.id !== "procedure" && (
													<button className="btn" disabled={act.busy} onClick={() => setEditing({ id: f.id, value: f.value ?? CHOICES[f.id]?.[0][0] ?? "" })}>
														{f.state === "open" ? "Ierakstīt" : "Labot"}
													</button>
												)}
												{f.state === "proposed" && (
													<button className="btn danger" disabled={act.busy} onClick={() => decide(f.id, "factReject")}>
														Nav pareizi
													</button>
												)}
											</div>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</>
			)}
		</div>
	);
}

function EditValue({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
	const choices = CHOICES[id];
	if (choices)
		return (
			<select value={value} onChange={(e) => onChange(e.target.value)}>
				{choices.map(([v, l]) => (
					<option key={v} value={v}>
						{l}
					</option>
				))}
			</select>
		);
	return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }} autoFocus />;
}
