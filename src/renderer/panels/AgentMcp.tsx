// The MCP servers of one agent, inside its settings dialog: a box to paste `claude mcp add …` (or add-json, an npx / uvx / docker run line, a server address or an mcpServers
// JSON block), the servers it makes, a try-out that lists each server's tools, and per tool whether the agent is given it and whether it only reads.
//
// Ported from OpenMausBot (Apache-2.0) src/components/McpServersPanel.tsx (the one paste box, "Edit details", the test on Add: "Connected: N tools" / "Saved, but off" with the reason,
// "Fix the keys" asking for just the values) and docs/custom-mcp-servers.md; the parsing is shared/mcp-paste.ts. Adapted: a server belongs to this one agent, a secret is shown
// as set / not set and a new value is typed into a password field (the page never holds the saved value), and every tool is confirm-level unless marked "tikai lasa".
import { useState } from "react";
import type { AgentMcpServer } from "../../shared/agent-types";
import { readMcpPaste } from "../../shared/mcp-paste";
import { call, errText } from "../bridge";
import { tr } from "../i18n";
import { Badge } from "../ui";

type Found = { name: string; description: string }[];

/** One environment variable or header: its name, whether it has a value, and a field for a new one (empty = keep). */
function SecretRow({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }) {
	const [typed, setTyped] = useState("");
	// what the field held when the dialog opened (the saved mask, or nothing): an emptied field goes back to it
	const [orig] = useState(value);
	const set = value !== "";
	return (
		<div className="row ag-secret">
			<span className="mono small">{name}</span>
			<Badge tone={set ? "ok" : "warn"}>{set ? tr("iestatīts") : tr("nav iestatīts")}</Badge>
			<input
				type="password"
				autoComplete="off"
				className="grow"
				value={typed}
				placeholder={set ? tr("jauna vērtība (tukšs = atstāt)") : tr("ievadi vērtību")}
				onChange={(e) => {
					setTyped(e.target.value);
					onChange(e.target.value === "" ? orig : e.target.value);
				}}
			/>
		</div>
	);
}

export function McpSection({ agentId, servers, onChange }: { agentId: string; servers: AgentMcpServer[]; onChange: (s: AgentMcpServer[]) => void }) {
	const [paste, setPaste] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const [gaps, setGaps] = useState<Record<string, string[]>>({});
	const [found, setFound] = useState<Record<string, Found>>({});
	const [probing, setProbing] = useState<string | null>(null);
	const [probeErr, setProbeErr] = useState<Record<string, string>>({});
	const update = (name: string, p: Partial<AgentMcpServer>) => onChange(servers.map((s) => (s.name === name ? { ...s, ...p } : s)));

	/** Starts the server once and lists its tools: every tool listed is offered, the ones marked read before stay read. */
	const probe = async (s: AgentMcpServer, all: AgentMcpServer[] = servers) => {
		setProbing(s.name);
		setProbeErr((e) => ({ ...e, [s.name]: "" }));
		try {
			const r = await call("agents.mcp.probe", agentId, s);
			setFound((f) => ({ ...f, [s.name]: r.tools }));
			const names = r.tools.map((t) => t.name);
			onChange(all.map((x) => (x.name === s.name ? { ...x, tools: names, read: (x.read ?? []).filter((n) => names.includes(n)) } : x)));
		} catch (e) {
			setProbeErr((p) => ({ ...p, [s.name]: errText(e) }));
		} finally {
			setProbing(null);
		}
	};

	const add = async () => {
		setErr(null);
		const r = readMcpPaste(paste, servers.map((s) => s.name));
		if (!r) return;
		if (!r.ok) return setErr(r.error);
		const made = r.servers.map((x) => x.server);
		const next = [...servers, ...made];
		onChange(next);
		setGaps((g) => ({ ...g, ...Object.fromEntries(r.servers.filter((x) => x.gaps.length).map((x) => [x.server.name, x.gaps])) }));
		setPaste("");
		// a server whose secrets the paste gave is tried at once; one that still lacks a value waits for it
		for (const x of r.servers) if (!x.gaps.length) await probe(x.server, next);
	};

	return (
		<>
			<div className="small dim">{tr("Šī aģenta paša MCP serveri: citi aģenti to rīkus neredz. Katrs rīks prasa tavu apstiprinājumu (pa partijām), ja neatzīmē «tikai lasa».")}</div>
			<textarea
				className="ag-paste mono"
				value={paste}
				placeholder={tr("Ielīmē claude mcp add …, claude mcp add-json …, npx/uvx/docker run rindu, servera adresi vai mcpServers JSON")}
				onChange={(e) => setPaste(e.target.value)}
			/>
			<div className="row">
				<button className="primary" disabled={!paste.trim() || probing !== null} onClick={add}>
					{tr("Pievienot")}
				</button>
				{err && <span className="err">{err}</span>}
			</div>
			{servers.length === 0 && <div className="dim small">{tr("Nav pievienotu MCP serveru.")}</div>}
			{servers.map((s) => {
				const secrets = Object.entries(s.url ? (s.headers ?? {}) : (s.env ?? {}));
				const secretKind = s.url ? "headers" : "env";
				const known = found[s.name];
				// the tools to show: what the try-out listed, else what was saved
				const toolNames = known ? known.map((t) => t.name) : (s.tools ?? []);
				const missing = secrets.filter(([, v]) => v === "");
				return (
					<div key={s.name} className="confirm ag-mcp">
						<div className="row">
							<b className="mono">{s.name}</b>
							<Badge tone="dim">{s.url ? tr("adrese") : tr("programma")}</Badge>
							{s.tools?.length ? <Badge tone="ok">{tr("{n} rīki", { n: s.tools.length })}</Badge> : <Badge tone="warn">{tr("nav pārbaudīts")}</Badge>}
							<span className="grow" />
							<button className="small" disabled={probing !== null || missing.length > 0} title={missing.length ? tr("Vispirms ievadi trūkstošās vērtības") : ""} onClick={() => probe(s)}>
								{probing === s.name ? tr("Pārbauda…") : tr("Pārbaudīt")}
							</button>
							<button className="small ghost" onClick={() => onChange(servers.filter((x) => x.name !== s.name))}>
								{tr("Noņemt")}
							</button>
						</div>
						<div className="mono small dim ag-cmd">{s.url ?? [s.command, ...(s.args ?? [])].join(" ")}</div>
						{gaps[s.name]?.length ? <div className="small">{tr("Ielīmētajā tekstā nebija vērtību: {names}. Ievadi tās zemāk.", { names: gaps[s.name]!.join(", ") })}</div> : null}
						{probeErr[s.name] && (
							<div className="err">
								{tr("Serveris neatbild:")} {probeErr[s.name]}
							</div>
						)}
						{secrets.map(([k, v]) => (
							<SecretRow
								key={k}
								name={k}
								value={v}
								onChange={(nv) => update(s.name, { [secretKind]: { ...(s[secretKind] ?? {}), [k]: nv } })}
							/>
						))}
						{toolNames.length > 0 && (
							<div className="ag-tools">
								<div className="row small dim">
									<span className="grow">{tr("Rīks")}</span>
									<span style={{ width: 90 }}>{tr("dot aģentam")}</span>
									<span style={{ width: 110 }}>{tr("tikai lasa")}</span>
								</div>
								{toolNames.map((t) => {
									const offered = s.tools?.includes(t) ?? false;
									return (
										<div key={t} className="row">
											<span className="grow" title={known?.find((x) => x.name === t)?.description}>
												<span className="mono small">{t}</span> <span className="small dim">{known?.find((x) => x.name === t)?.description.slice(0, 90)}</span>
											</span>
											<span style={{ width: 90 }}>
												<input
													type="checkbox"
													checked={offered}
													onChange={(e) => update(s.name, { tools: e.target.checked ? [...(s.tools ?? []), t] : (s.tools ?? []).filter((x) => x !== t), ...(e.target.checked ? {} : { read: (s.read ?? []).filter((x) => x !== t) }) })}
												/>
											</span>
											<span style={{ width: 110 }}>
												<input
													type="checkbox"
													disabled={!offered}
													checked={s.read?.includes(t) ?? false}
													onChange={(e) => update(s.name, { read: e.target.checked ? [...(s.read ?? []), t] : (s.read ?? []).filter((x) => x !== t) })}
												/>
											</span>
										</div>
									);
								})}
								<div className="small dim">{tr("Rīks, kas nav atzīmēts «tikai lasa», prasa apstiprinājumu pirms katras partijas. Serveris var vēlāk pievienot jaunus rīkus: tie netiek doti, kamēr nenospied «Pārbaudīt».")}</div>
							</div>
						)}
					</div>
				);
			})}
		</>
	);
}
