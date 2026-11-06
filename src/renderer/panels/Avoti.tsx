// Avoti: the only file list in the app (design doc 1, cause 8: v1 repeated a huge list on two pages).
// One list grouped by office folder; per row: title, role, versions, duplicate paths, signers, text state, pages.
// Photo surveys are one row each (date, count). A click opens the source in the preview and puts it in the Fokuss.
import { Fragment, useMemo, useState } from "react";
import type { Source } from "../../core/model";
import type { ScanSummaryRow } from "../../shared/api";
import { sourceFocus } from "../../shared/focus-items";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";
import { RoleQuestions, ScanBar, useScanProgress } from "./Projekts";

const STATE: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "dim" | "info" }> = {
	ok: { label: "teksts", tone: "ok" },
	ocr: { label: "OCR", tone: "info" },
	empty: { label: "bez teksta", tone: "warn" },
	unsupported: { label: "netiek lasīts", tone: "dim" },
	error: { label: "kļūda", tone: "bad" },
	pending: { label: "gaida", tone: "dim" },
};

const latest = (s: Source) => s.versions[s.versions.length - 1];

export function Avoti({ filter }: { filter?: string }) {
	const { projectId, preview } = useUi();
	const sources = useLoad<Source[]>(() => (projectId ? call("sources.list", projectId) : Promise.resolve([])), [projectId]);
	const summary = useLoad<ScanSummaryRow | null>(() => (projectId ? call("projects.scanSummary", projectId) : Promise.resolve(null)), [projectId]);
	const progress = useScanProgress(projectId);
	const [q, setQ] = useState(filter ?? "");
	const [open, setOpen] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);

	const groups = useMemo(() => {
		const words = q.toLowerCase().split(/\s+/).filter(Boolean);
		const list = (sources.data ?? []).filter((s) => !words.length || words.every((w) => `${s.title} ${s.role} ${s.paths.join(" ")} ${s.signers.map((x) => x.name).join(" ")}`.toLowerCase().includes(w)));
		const byKey = new Map<string, Source[]>();
		for (const s of list) {
			const k = s.folderKey;
			byKey.set(k, [...(byKey.get(k) ?? []), s]);
		}
		const keyNum = (k: string) => Number(k.split(".")[2] ?? 0);
		return [...byKey.entries()].sort((a, b) => keyNum(a[0]) - keyNum(b[0]));
	}, [sources.data, q]);

	if (!projectId) return <Empty title="nav projekta">Atver projektu panelī Projekts.</Empty>;

	const folderName = (k: string) => summary.data?.folders.find((f) => f.folderKey === k)?.name ?? k;
	const select = (s: Source) => {
		if (s.kind === "photoSurvey") return;
		ui.show({ kind: "source", sourceId: s.id });
		ui.focusAdd(sourceFocus(s.id, s.title, s.role));
	};
	const selectedId = preview?.kind === "source" ? preview.sourceId : null;

	return (
		<div className="pane fill">
			<div className="row">
				<button className="primary" onClick={() => call("projects.scan", projectId).catch((e) => setErr(errText(e)))}>
					Nolasīt vēlreiz
				</button>
				<input className="grow" placeholder="Meklēt nosaukumā, lomā, ceļā, parakstītājā…" value={q} onChange={(e) => setQ(e.target.value)} />
				<span className="dim small">{sources.data ? `${sources.data.length} avoti` : ""}</span>
			</div>
			{err && <div className="err">{err}</div>}
			{progress && <ScanBar p={progress} />}
			<RoleQuestions projectId={projectId} />
			{sources.error ? <Err error={sources.error} /> : null}
			{sources.data && sources.data.length === 0 && !progress && <Empty title="run scan">Projekts vēl nav nolasīts.</Empty>}
			{summary.data && summary.data.skipped.archive > 0 && <div className="dim small">Arhīva mapēs {summary.data.skipped.archive} faili netiek lasīti.</div>}
			{groups.length > 0 && (
				<table>
					<thead>
						<tr>
							<th>Nosaukums</th>
							<th>Loma</th>
							<th>Teksts</th>
							<th>Lapas</th>
							<th>Versijas</th>
						</tr>
					</thead>
					<tbody>
						{groups.map(([key, list]) => (
							<Fragment key={key}>
								<tr className="group-head">
									<td colSpan={5}>
										{key} · {folderName(key)} <span className="dim">({list.length})</span>
									</td>
								</tr>
								{list
									.sort((a, b) => (a.container?.path ?? a.paths[0] ?? "").localeCompare(b.container?.path ?? b.paths[0] ?? "", "lv", { numeric: true }))
									.map((s) => {
										const v = latest(s);
										const st = STATE[v?.textState ?? "pending"];
										const isOpen = open === s.id;
										return (
											<Fragment key={s.id}>
												<tr className={`click ${selectedId === s.id ? "sel" : ""}`} onClick={() => select(s)}>
													<td>
														<button className="ghost small" onClick={(e) => (e.stopPropagation(), setOpen(isOpen ? null : s.id))}>
															{isOpen ? "▾" : "▸"}
														</button>{" "}
														{s.container && <span className="dim">↳ </span>}
														{s.title}
														{s.kind === "photoSurvey" && s.survey && (
															<span className="dim">
																{" "}
																— {s.survey.date ?? "bez datuma"}, {s.survey.count} foto
															</span>
														)}
														{s.paths.length > 1 && (
															<>
																{" "}
																<Badge tone="info" title={s.paths.join("\n")}>
																	{s.paths.length} vietās
																</Badge>
															</>
														)}
														{s.signers.length > 0 && (
															<>
																{" "}
																<Badge tone="ok" title={s.signers.map((x) => `${x.name} ${x.at ?? ""}`).join("\n")}>
																	{s.signers.length} paraksti
																</Badge>
															</>
														)}
														{s.paths.length === 0 && (
															<>
																{" "}
																<Badge tone="bad">vairs nav mapē</Badge>
															</>
														)}
													</td>
													<td>
														{s.role}
														{s.roleFrom === "unconfirmed" && (
															<>
																{" "}
																<Badge tone="warn">jāapstiprina</Badge>
															</>
														)}
													</td>
													<td>
														<Badge tone={st.tone} title={v?.textReason}>
															{st.label}
														</Badge>
													</td>
													<td>{v?.pages ?? ""}</td>
													<td>{s.versions.length}</td>
												</tr>
												{isOpen && (
													<tr>
														<td colSpan={5} className="small">
															<div className="mono">{s.paths.map((p) => <div key={p}>{p}</div>)}</div>
															{v?.textReason && <div className="dim">{v.textReason}</div>}
															{s.signers.map((x) => (
																<div key={x.file + x.name}>
																	parakstīja: <b>{x.name}</b> {x.at ? new Date(x.at).toLocaleString("lv-LV") : "laiks nav nolasāms"}
																</div>
															))}
															{s.versions.map((ver, i) => (
																<div key={ver.sha256 + i} className="dim">
																	v{i + 1}: {new Date(ver.mtime).toLocaleDateString("lv-LV")} · {(ver.size / 1024).toFixed(0)} KB · {ver.sha256.slice(0, 10)}
																</div>
															))}
															{s.kind === "document" && (
																<button className="small" onClick={() => call("sources.openOriginal", projectId, s.id).catch((e) => setErr(errText(e)))}>
																	Atvērt oriģinālu
																</button>
															)}
														</td>
													</tr>
												)}
											</Fragment>
										);
									})}
							</Fragment>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
