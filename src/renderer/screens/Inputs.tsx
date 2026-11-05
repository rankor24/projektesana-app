import { useState } from "react";
import { api, pickFiles } from "../api";
import { Badge, Empty, Err, fmtDate, useAction, useLoad } from "../ui";
import type { FileRec, GatherState } from "../types";
import { GatherPanel, OpenFile } from "./Gather";

interface Line {
	op: " " | "+" | "-";
	line: string;
}

// Panel 7 holds the client's brief and BIM requirements; panel 8 everything else the project starts from.
const PU_ROLES = ["PU", "BIP / BIM prasības"];
const OTHER_PANEL = ["Tehniskie noteikumi"];

export function Inputs({ root, mode }: { root: string; mode: "pu" | "data" }) {
	const files = useLoad(() => api<FileRec[]>("filesList", root), [root]);
	const roles = useLoad(() => api<string[]>("roles"), []);
	const state = useLoad(() => api<GatherState>("gatherState", root), [root]);
	const act = useAction();
	const [diff, setDiff] = useState<{ path: string; lines: Line[] } | null>(null);

	const inPanel = (f: FileRec) => (mode === "pu" ? PU_ROLES.includes(f.role ?? "") : !PU_ROLES.includes(f.role ?? "") && !OTHER_PANEL.includes(f.role ?? ""));
	const shown = (files.data ?? []).filter(inPanel);
	const textOf = (p: string) => state.data?.scan?.files.find((f) => f.path === p);
	const unconfirmed = shown.filter((f) => f.role && f.roleSource && !f.roleSource.confirmed).length;

	async function add() {
		const picked = await pickFiles(mode === "pu" ? "Izvēlies projektēšanas uzdevumu vai BIP" : "Izvēlies izejas datu failus");
		if (!picked.length) return;
		await act.run(() => api("filesImport", root, picked, mode === "pu" ? "PU" : "Cits"));
		await act.run(() => api("gatherScan", root));
		files.reload();
		state.reload();
	}
	async function rescan() {
		await act.run(() => api("filesRescan", root));
		files.reload();
	}
	async function showDiff(f: FileRec) {
		const n = f.versions.length;
		const lines = await act.run(() => api<Line[]>("filesDiff", root, f.path, n - 2, n - 1));
		if (lines) setDiff({ path: f.path, lines });
	}
	const reloadAll = () => {
		files.reload();
		state.reload();
	};

	return (
		<>
			<h1>{mode === "pu" ? "7. Projektēšanas uzdevums (PU)" : "8. Izejas dati"}</h1>
			<GatherPanel
				root={root}
				section={mode === "pu" ? "pu" : "data"}
				title={mode === "pu" ? "Aģents lasa projektēšanas uzdevumu" : "Aģents lasa izejas datus"}
				what={
					mode === "pu"
						? "Aģents atrod PU un BIP projekta mapē, izlasa tos un ieraksta objektu, pasūtītāju, darba veidu, lietojumu, stāvus, platības un telpu programmu — katru ar burtisku citātu no dokumenta. Tu pārbaudi."
						: "Aģents atrod zemes dokumentus, topogrāfiju un Inventarizācijas lietu un ieraksta kadastra numuru, platību un esošās ēkas ar citātiem. Tu pārbaudi."
				}
				onChange={reloadAll}
			/>
			<div className="row" style={{ margin: "14px 0 6px" }}>
				<h2 style={{ margin: 0 }}>Faili šajā panelī</h2>
				{unconfirmed > 0 && <Badge kind="warn">lomas jāpārbauda: {unconfirmed}</Badge>}
				<span className="grow" />
				<button className="btn" onClick={add} disabled={act.busy} title="Ja fails nav projekta mapē, izvēlies to šeit — tas tiek nokopēts mapē „Izejas dati”">
					Pievienot failu no cita datora vietas…
				</button>
				<button className="btn" onClick={rescan} disabled={act.busy}>
					Pārbaudīt izmaiņas
				</button>
			</div>
			<Err text={act.err ?? files.err} />
			{shown.length === 0 && <Empty>Šim panelim projekta mapē nav atrasts neviens fails. Spied „Pārskatīt mapi” augšā vai pievieno failu.</Empty>}
			{shown.length > 0 && (
				<table className="card">
					<thead>
						<tr>
							<th>Fails</th>
							<th>Loma</th>
							<th>Teksts</th>
							<th>Versijas</th>
							<th>Statuss</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{shown.map((f) => {
							const t = textOf(f.path);
							return (
								<tr key={f.path}>
									<td>
										<div className="mono">{f.path}</div>
										<OpenFile root={root} path={f.path} />
									</td>
									<td>
										<select
											value={f.role ?? ""}
											onChange={async (e) => {
												await act.run(() => api("filesSetRole", root, f.path, e.target.value));
												reloadAll();
											}}
										>
											{!f.role && <option value="" />}
											{(roles.data ?? []).map((r) => (
												<option key={r}>{r}</option>
											))}
										</select>
										{f.roleSource && !f.roleSource.confirmed && (
											<div className="quote">
												<Badge kind="warn">ieteikts</Badge> „{f.roleSource.quote}”
												<div>
													<button
														className="btn primary"
														onClick={async () => {
															await act.run(() => api("roleConfirm", root, f.path));
															reloadAll();
														}}
													>
														Pareizi
													</button>
												</div>
											</div>
										)}
									</td>
									<td>{t ? t.text === "ok" ? <Badge kind="ok">nolasīts</Badge> : <span title={t.note}><Badge kind="warn">{t.text === "empty" ? "teksta nav" : t.text === "unsupported" ? "nelasāms formāts" : t.text === "toolarge" ? "pārāk liels" : "kļūda"}</Badge></span> : <span className="muted">—</span>}</td>
									<td>
										{f.versions.length} <span className="muted">({fmtDate(f.versions[f.versions.length - 1].at)})</span>
									</td>
									<td>{f.status === "ok" ? <Badge kind="ok">nemainīts</Badge> : f.status === "changed" ? <Badge kind="warn">mainīts ārpus lietotnes</Badge> : <Badge kind="bad">trūkst</Badge>}</td>
									<td>
										{f.status === "changed" && f.versions.length > 1 && (
											<>
												<button className="btn" onClick={() => showDiff(f)}>
													Rādīt atšķirības
												</button>{" "}
												<button
													className="btn"
													onClick={async () => {
														await act.run(() => api("filesAcknowledge", root, f.path));
														setDiff(null);
														reloadAll();
													}}
												>
													Esmu redzējis
												</button>
											</>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}
			{diff && (
				<div className="card">
					<h3>Atšķirības: {diff.path}</h3>
					<pre className="diff">
						{diff.lines
							.filter((l) => l.op !== " ")
							.map((l, i) => (
								<div key={i} className={l.op === "+" ? "diffadd" : "diffdel"}>
									{l.op} {l.line}
								</div>
							))}
					</pre>
					{diff.lines.every((l) => l.op === " ") && <div className="muted">Teksta atšķirību nav (mainījušies tikai baiti, piem., formatējums vai attēli).</div>}
				</div>
			)}
		</>
	);
}
