import { useEffect, useState } from "react";
import { api, onGather, pickFolder } from "../api";
import { Badge, Empty, Err, useAction, useLoad } from "../ui";
import type { CalendarEntry, ProjectRow, Task } from "../types";
import type { Screen } from "../App";

const SETUP: Record<string, { label: string; kind?: "ok" | "warn" }> = {
	"not started": { label: "uzstādīšana nav sākta" },
	"in progress": { label: "uzstādīšana procesā", kind: "warn" },
	complete: { label: "uzstādīšana pabeigta", kind: "ok" },
};

export function Dashboard({ selected, onSelect, onOpen }: { selected: string | null; onSelect: (p: ProjectRow) => void; onOpen: (p: ProjectRow, s: Screen) => void }) {
	const list = useLoad(() => api<ProjectRow[]>("projectsList"), []);
	const agent = useLoad(() => api<{ ready: boolean; reason: string }>("agentStatus"), []);
	const act = useAction();
	const [name, setName] = useState("");
	const [folder, setFolder] = useState<string | null>(null);
	const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
	const [step, setStep] = useState<string | null>(null);
	const [all, setAll] = useState<{ root: string; busy: boolean; result: Record<string, { ok: boolean; reason?: string }> | null } | null>(null);

	async function create() {
		if (!folder) return;
		const m = await act.run(() => api("projectsCreate", folder, name));
		if (m) {
			setName("");
			setFolder(null);
			list.reload();
		}
	}
	/** The normal way in: point at the folder the project already lives in. */
	async function openFolder() {
		const f = await pickFolder("Izvēlies projekta mapi (ar PU, zemes dokumentiem, tehniskajiem noteikumiem …)");
		if (!f) return;
		setScan({ done: 0, total: 0 });
		const m = await act.run(() => api("projectsOpenFolder", f));
		setScan(null);
		if (m) list.reload();
	}
	async function gatherAll(root: string) {
		setAll({ root, busy: true, result: null });
		const r = await act.run(() => api<Record<string, { ok: boolean; reason?: string }>>("gatherAll", root));
		setAll({ root, busy: false, result: r ?? null });
		list.reload();
	}
	useEffect(
		() =>
			onGather((e) => {
				if (e.type === "scan") setScan({ done: e.done, total: e.total });
				else if (e.type === "scan-done") setScan(null);
				else if (e.type === "start") setStep(e.section);
				else if (e.type === "end" || e.type === "failed") setStep(null);
			}),
		[],
	);
	const sel = list.data?.find((p) => p.root === selected && !p.missing) ?? null;

	return (
		<>
			<h1>Projekti</h1>
			<div className="card gather">
				<h3>Atvērt projekta mapi</h3>
				<div className="row">
					<button className="btn primary" disabled={act.busy} onClick={openFolder}>
						Izvēlēties projekta mapi…
					</button>
					{scan && (
						<span className="muted">
							Pārskatu mapi{scan.total ? `: ${scan.done} no ${scan.total}` : "…"}
						</span>
					)}
				</div>
				<div className="muted" style={{ marginTop: 6 }}>
					Norādi mapi, kur projekts jau atrodas. Aģents izlasa visus failus un pats aizpilda 1.–8. paneli (PU, zemes dokumenti, tehniskie noteikumi, piemērojamie panti); tu tikai pārbaudi. Mapē netiek mainīts nekas, tiek pievienota tikai maza .bv mape.
				</div>
				<Err text={act.err} />
			</div>
			{agent.data && !agent.data.ready && (
				<div className="card" style={{ borderColor: "var(--warn)" }}>
					<b>Aģents nav pieslēgts.</b> {agent.data.reason} Bez aģenta darbojas: mapes pārskatīšana, failu lomu ieteikumi, atsauces uz likumiem no dokumentiem, termiņu aprēķins, likumu bibliotēka. Faktu nolasīšanu no dokumentiem (7.–8., 5.–6. panelis, piemērojamie panti) dara tikai aģents — pieslēdz to: Iestatījumi → Aģents.
				</div>
			)}
			<details className="card">
				<summary style={{ cursor: "pointer" }}>Projekts no nulles (tukša mape)</summary>
				<div className="row" style={{ marginTop: 8 }}>
					<input type="text" placeholder="Projekta nosaukums" value={name} onChange={(e) => setName(e.target.value)} />
					<button className="btn" onClick={async () => setFolder(await pickFolder("Izvēlies projekta mapi (tukša vai jauna)"))}>
						{folder ? folder : "Izvēlēties mapi…"}
					</button>
					<button className="btn primary" disabled={!folder || !name.trim() || act.busy} onClick={create}>
						Izveidot
					</button>
				</div>
			</details>
			<Err text={list.err} />
			{list.data && list.data.length === 0 && <Empty>Nav projektu. Izveido pirmo augstāk.</Empty>}
			<div className="grid">
				{list.data?.map((p) => (
					<div key={p.root} className="card" style={p.root === selected ? { borderColor: "var(--accent)" } : undefined}>
						{p.missing || !p.meta ? (
							<>
								<h3>Mape nav atrasta</h3>
								<div className="mono">{p.root}</div>
								<button className="btn" onClick={async () => (await act.run(() => api("projectsForget", p.root)), list.reload())}>
									Noņemt no saraksta (mape netiek dzēsta)
								</button>
							</>
						) : (
							<>
								<h3>{p.meta.name}</h3>
								<div className="mono muted">{p.root}</div>
								<div className="row" style={{ margin: "8px 0" }}>
									<Badge kind={SETUP[p.setup ?? "not started"].kind}>{SETUP[p.setup ?? "not started"].label}</Badge>
									<Badge>revīzijas: {p.revisions}</Badge>
									{p.reviewItems ? <Badge kind={p.approved === p.reviewItems ? "ok" : "warn"}>apstiprināts {p.approved}/{p.reviewItems}</Badge> : null}
									<Badge kind={p.openPins ? "warn" : undefined}>atvērti pin: {p.openPins}</Badge>
									<Badge>uzdevumi: {p.openTasks}</Badge>
									<Badge>faili: {p.files ?? 0}</Badge>
									{p.factsProposed ? <Badge kind="warn">jāpārbauda: {p.factsProposed}</Badge> : null}
									{p.factsConfirmed ? <Badge kind="ok">apstiprināti dati: {p.factsConfirmed}</Badge> : null}
								</div>
								<div className="row">
									<button className="btn primary" disabled={all?.busy || agent.data?.ready === false} title={agent.data?.ready === false ? "Vajag pieslēgtu aģentu (Iestatījumi → Aģents)" : undefined} onClick={() => gatherAll(p.root)}>
										{all?.busy && all.root === p.root ? `Aģents lasa mapi${step ? ` (${step})` : ""}…` : p.gathered ? "Savākt visu no mapes vēlreiz" : "Savākt visu no mapes"}
									</button>
									<button className="btn" onClick={() => onOpen(p, "p7")}>
										7. PU
									</button>
									<button className="btn" onClick={() => onOpen(p, "p5")}>
										5. Tehniskie noteikumi
									</button>
									<button className="btn" onClick={() => onOpen(p, "p2")}>
										2. Piemērojamie panti
									</button>
								</div>
								{all?.root === p.root && all.result && (
									<div className="muted" style={{ marginTop: 4 }}>
										{Object.entries(all.result).map(([k, v]) => `${k}: ${v.ok ? "gatavs" : `neizdevās — ${v.reason}`}`).join(" · ")}
									</div>
								)}
								{p.next && <div className="muted">Tuvākais termiņš: {p.next.date} — {p.next.title}</div>}
								<div className="row" style={{ marginTop: 8 }}>
									<button className="btn primary" onClick={() => onSelect({ ...p })}>
										Izvēlēties
									</button>
									<button className="btn" onClick={() => onOpen(p, "p9")}>
										Čats
									</button>
									<button className="btn" onClick={() => onOpen(p, "p10")}>
										Skati
									</button>
									<span className="grow" />
									<button className="btn danger" title="Mape netiek dzēsta" onClick={async () => (await act.run(() => api("projectsForget", p.root)), list.reload())}>
										Noņemt
									</button>
								</div>
							</>
						)}
					</div>
				))}
			</div>
			{sel && <WorkPanel root={sel.root} />}
		</>
	);
}

function WorkPanel({ root }: { root: string }) {
	const tasks = useLoad(() => api<Task[]>("tasksList", root), [root]);
	const cal = useLoad(() => api<CalendarEntry[]>("calendarFor", root), [root]);
	const act = useAction();
	const [title, setTitle] = useState("");
	const [due, setDue] = useState("");

	async function add() {
		if (await act.run(() => api("taskAdd", root, title, due || null))) {
			setTitle("");
			setDue("");
			tasks.reload();
			cal.reload();
		}
	}
	return (
		<div className="split" style={{ marginTop: 16 }}>
			<div className="card">
				<h2>Uzdevumi</h2>
				<div className="row" style={{ marginBottom: 8 }}>
					<input type="text" placeholder="Uzdevums" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
					<input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
					<button className="btn primary" onClick={add} disabled={!title.trim() || act.busy}>
						Pievienot
					</button>
				</div>
				<Err text={act.err ?? tasks.err} />
				{tasks.data?.length === 0 && <Empty>Nav uzdevumu.</Empty>}
				{tasks.data?.map((t) => (
					<label key={t.id} className="row" style={{ padding: "3px 0" }}>
						<input
							type="checkbox"
							checked={t.done}
							onChange={async (e) => {
								await act.run(() => api("taskDone", root, t.id, e.target.checked));
								tasks.reload();
								cal.reload();
							}}
						/>
						<span style={{ textDecoration: t.done ? "line-through" : undefined }}>{t.title}</span>
						{t.due && <span className="muted">({t.due})</span>}
					</label>
				))}
			</div>
			<div className="card">
				<h2>Kalendārs</h2>
				{cal.data?.length === 0 && <Empty>Nav termiņu. Tie parādās no uzdevumiem un pieprasītajiem tehniskajiem noteikumiem.</Empty>}
				<div className="cal">
					{cal.data?.map((c, i) => (
						<div key={i} style={{ display: "contents" }}>
							<b>{c.date}</b>
							<span>{c.title}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
