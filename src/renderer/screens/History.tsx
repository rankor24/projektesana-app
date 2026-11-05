import { useState } from "react";
import { api } from "../api";
import { Badge, Empty, Err, useLoad } from "../ui";
import type { LogEntry } from "../types";

export function History({ root }: { root: string }) {
	const log = useLoad(() => api<{ entries: LogEntry[]; bad: number; total: number }>("logTail", root, 500), [root]);
	const [kind, setKind] = useState("");
	const entries = (log.data?.entries ?? []).filter((e) => !kind || e.kind.startsWith(kind)).reverse();
	return (
		<>
			<h1>Vēsture</h1>
			<div className="muted" style={{ marginBottom: 10 }}>
				Pievienojamais žurnāls (.bv/log.jsonl): revīzijas, pin, komentāri, apstiprinājumi, aģenta rīku izsaukumi, importētie faili. Nekas netiek dzēsts.
			</div>
			<div className="row" style={{ marginBottom: 10 }}>
				<select value={kind} onChange={(e) => setKind(e.target.value)}>
					<option value="">Visi ieraksti</option>
					{["project", "file", "brief", "revision", "pin", "page", "agent", "task", "tr", "snapshot", "modelling"].map((k) => (
						<option key={k}>{k}</option>
					))}
				</select>
				{log.data && <Badge>{log.data.total} ieraksti</Badge>}
				{log.data && log.data.bad > 0 && <Badge kind="bad">{log.data.bad} bojātas rindas izlaistas</Badge>}
				<button className="btn" onClick={log.reload}>
					Atjaunot
				</button>
			</div>
			<Err text={log.err} />
			{entries.length === 0 && <Empty>Nav ierakstu.</Empty>}
			<table className="card">
				<tbody>
					{entries.map((e) => (
						<tr key={e.seq}>
							<td className="mono muted">{e.seq}</td>
							<td className="mono">{e.at.replace("T", " ").slice(0, 19)}</td>
							<td>{e.by}</td>
							<td>
								<b>{e.kind}</b>
							</td>
							<td className="mono muted">{e.data ? JSON.stringify(e.data).slice(0, 220) : ""}</td>
						</tr>
					))}
				</tbody>
			</table>
		</>
	);
}
