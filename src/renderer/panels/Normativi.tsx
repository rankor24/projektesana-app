// Avoti → Normatīvi: the law library (global, shared by all projects) and, for the open project, the acts that apply to it.
// The library rows: title, category, read date, changed flag, paragraphs; a click opens the text in the preview.
// "Piemērojamie normatīvi": data/applicable-acts.json judged against the CONFIRMED profile facts (main decides, the
// panel only shows). likumi.lv acts load with one click; paid standards (LVS / EN / ISO) are never downloaded — the row
// links to the LVS catalogue and the user adds the PDF they own.
import { Fragment, useState } from "react";
import type { ApplicableRow, LibraryCategory, LibraryRow } from "../../shared/api";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { Badge, Err, useLoad } from "../ui";

const CAT: Record<LibraryCategory, string> = { likums: "likums", mk: "MK / LBN", lvs: "LVS", es: "ES" };
const STATE_TONE: Record<ApplicableRow["state"], "ok" | "warn" | "dim"> = { attiecas: "ok", "nav zināms": "warn", neattiecas: "dim" };
const ORDER: ApplicableRow["state"][] = ["attiecas", "nav zināms", "neattiecas"];

export function Normativi({ projectId }: { projectId: string | null }) {
	const { preview } = useUi();
	const lib = useLoad<LibraryRow[]>(() => call("library.list"), []);
	const app = useLoad(() => (projectId ? call("library.applicable", projectId) : Promise.resolve(null)), [projectId]);
	const [open, setOpen] = useState(true);
	const [url, setUrl] = useState("");
	const [cat, setCat] = useState<LibraryCategory>("mk");
	const [busy, setBusy] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [showOut, setShowOut] = useState(false);

	const run = (key: string, p: () => Promise<unknown>, done?: (r: unknown) => void) => {
		setBusy(key);
		setErr(null);
		setNote(null);
		p()
			.then((r) => (done?.(r), lib.reload(), app.reload()))
			.catch((e) => setErr(errText(e)))
			.finally(() => setBusy(null));
	};
	const addFile = (category: LibraryCategory, title?: string) =>
		run(`file:${title ?? ""}`, async () => {
			const f = await call("dialog.pickFile", "Pievienot standartu vai aktu (savu failu)", ["pdf", "docx", "txt"]);
			if (f) await call("library.addFile", f, category, title);
		});
	const show = (sourceId: string, quote?: string) => ui.show({ kind: "law", sourceId, quote });
	const selectedId = preview?.kind === "law" ? preview.sourceId : null;
	const rows = [...(app.data?.rows ?? [])].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state));
	const out = rows.filter((r) => r.state === "neattiecas");

	return (
		<div className="normativi">
			<table>
				<tbody>
					<tr className="group-head click" onClick={() => setOpen(!open)}>
						<td colSpan={5}>
							{open ? "▾" : "▸"} Normatīvi <span className="dim">({lib.data?.length ?? "…"}) · bibliotēka kopīga visiem projektiem</span>
						</td>
					</tr>
					{open && (
						<>
							<tr>
								<td colSpan={5}>
									<div className="row">
										<input className="grow" placeholder="https://likumi.lv/ta/id/…" value={url} onChange={(e) => setUrl(e.target.value)} />
										<select className="small" value={cat} onChange={(e) => setCat(e.target.value as LibraryCategory)}>
											{(Object.keys(CAT) as LibraryCategory[]).map((c) => (
												<option key={c} value={c}>
													{CAT[c]}
												</option>
											))}
										</select>
										<button disabled={!url.trim() || !!busy} onClick={() => run("url", () => call("library.addUrl", url, cat), () => setUrl(""))}>
											{busy === "url" ? "Lasa…" : "Pievienot no likumi.lv"}
										</button>
										<button disabled={!!busy} title="Maksas LVS / EN / ISO standarts vai cits akts, kas tev ir failā" onClick={() => addFile(cat === "likums" || cat === "mk" ? "lvs" : cat)}>
											Pievienot savu failu
										</button>
									</div>
									{err && <div className="err">{err}</div>}
									{note && <div className="dim small">{note}</div>}
									{lib.error ? <Err error={lib.error} /> : null}
								</td>
							</tr>
							{(lib.data ?? []).map((s) => (
								<tr key={s.id} className={`click ${selectedId === s.id ? "sel" : ""}`} onClick={() => show(s.id)}>
									<td>
										{s.title}{" "}
										{s.changedOn && (
											<Badge tone="warn" title="Pārlasot likumi.lv teksts atšķīrās no saglabātā; vecā versija saglabāta blakus">
												mainīts {s.changedOn}
											</Badge>
										)}
									</td>
									<td className="small">{CAT[s.category]}</td>
									<td className="small">nolasīts {s.readOn}</td>
									<td className="small">{s.paragraphs} rindk.</td>
									<td className="small" onClick={(e) => e.stopPropagation()}>
										{s.kind === "url" && (
											<button className="ghost small" disabled={!!busy} title="Nolasīt vēlreiz no likumi.lv" onClick={() => run(`re:${s.id}`, () => call("library.reread", s.id), (r) => setNote((r as { changed: boolean }).changed ? `${s.title}: teksts mainījies, saglabāta jaunā versija.` : `${s.title}: teksts nav mainījies.`))}>
												{busy === `re:${s.id}` ? "…" : "↻"}
											</button>
										)}
										{s.kind !== "builtin" && (
											<button className="ghost small" disabled={!!busy} title="Noņemt no bibliotēkas (faili paliek bibliotēkas mapē)" onClick={() => run(`rm:${s.id}`, () => call("library.remove", s.id))}>
												✕
											</button>
										)}
										{s.kind === "builtin" && <span className="dim">iebūvēts</span>}
									</td>
								</tr>
							))}
						</>
					)}
					{projectId && (
						<tr className="group-head">
							<td colSpan={5}>
								Piemērojamie normatīvi <span className="dim">· pēc apstiprinātiem profila faktiem{app.data ? ` · saraksts sastādīts ${app.data.readOn}` : ""}</span>
							</td>
						</tr>
					)}
					{projectId && app.error ? (
						<tr>
							<td colSpan={5}>
								<Err error={app.error} />
							</td>
						</tr>
					) : null}
					{projectId &&
						rows
							.filter((r) => showOut || r.state !== "neattiecas")
							.map((r) => (
								<Fragment key={r.id}>
									<tr className={r.inLibrary && selectedId === r.inLibrary.id ? "sel" : ""}>
										<td>
											<Badge tone={STATE_TONE[r.state]}>{r.state}</Badge> {r.title}
											<div className="dim small">
												{[...r.because, ...r.missing.map((m) => `nav zināms: ${m}`), ...r.notMatched.map((m) => `neattiecas: ${m}`)].join(" · ")}
											</div>
											<div className="dim small" title={r.why.quote}>
												pamatojums:{" "}
												<a href={r.why.url} target="_blank" rel="noreferrer">
													{r.why.act}, {r.why.point}
												</a>
												{r.quoteFound === true && (
													<>
														{" "}
														<Badge tone="ok" title="Citāts atrasts bibliotēkā saglabātajā tekstā">citāts pārbaudīts</Badge>
													</>
												)}
												{r.quoteFound === false && (
													<>
														{" "}
														<Badge tone="bad" title="Citāts nav atrasts bibliotēkā saglabātajā tekstā: akts, iespējams, grozīts — pārlasi un pārbaudi">citāts nav atrasts</Badge>
													</>
												)}
												{r.caveat && <div>{r.caveat}</div>}
											</div>
										</td>
										<td className="small">{CAT[r.category]}</td>
										<td colSpan={3} className="small">
											{r.inLibrary ? (
												<button className="ghost small" title="Atvērt priekšskatā pie pamatojuma rindkopas" onClick={() => show(r.inLibrary!.id, r.kind === "likumi" && r.why.actId === r.actId ? r.why.quote : undefined)}>
													bibliotēkā · nolasīts {r.inLibrary.readOn}
													{r.inLibrary.changedOn ? ` · mainīts ${r.inLibrary.changedOn}` : ""}
												</button>
											) : r.kind === "likumi" ? (
												<>
													<span className="dim">nav bibliotēkā</span>{" "}
													<button className="small" disabled={!!busy} onClick={() => run(`app:${r.id}`, () => call("library.addUrl", r.url!, r.category, r.title))}>
														{busy === `app:${r.id}` ? "Lasa…" : "Ielādēt no likumi.lv"}
													</button>
												</>
											) : (
												<>
													<span className="dim">maksas standarts — pievieno savu PDF</span>{" "}
													<a href={r.catalogue!} target="_blank" rel="noreferrer">
														LVS katalogs
													</a>{" "}
													<button className="small" disabled={!!busy} onClick={() => addFile("lvs", r.title)}>
														Pievienot PDF
													</button>
												</>
											)}
										</td>
									</tr>
								</Fragment>
							))}
					{projectId && app.data && (
						<tr>
							<td colSpan={5} className="dim small">
								{out.length > 0 && (
									<button className="ghost small" onClick={() => setShowOut(!showOut)}>
										{showOut ? "Slēpt" : "Rādīt"} neattiecīgos ({out.length})
									</button>
								)}{" "}
								{app.data.notRead}
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}
