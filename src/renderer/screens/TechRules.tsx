import { useState } from "react";
import { api, pickFiles } from "../api";
import { Badge, Empty, Err, useAction, useLoad } from "../ui";
import type { FileRec, TrRow } from "../types";
import { GatherPanel, OpenFile } from "./Gather";

const STATUS = ["pieprasīts", "saņemts", "nav pieprasīts"] as const;

export function TechRules({ root, issuer }: { root: string; issuer: "state_municipal" | "network_owner" }) {
	const all = useLoad(() => api<TrRow[]>("trList", root), [root]);
	const files = useLoad(() => api<FileRec[]>("filesList", root), [root]);
	const act = useAction();
	const [who, setWho] = useState("");
	const [status, setStatus] = useState<(typeof STATUS)[number]>("pieprasīts");
	const [date, setDate] = useState("");
	const [pending, setPending] = useState<string | null>(null);
	const rows = (all.data ?? []).filter((r) => r.issuer === issuer);
	const mine = issuer === "state_municipal" ? "5" : "6";

	async function add() {
		const ok = await act.run(async () => {
			const r = await api<TrRow>("trAdd", root, { who, issuer, status, requestedOn: status === "pieprasīts" ? date || null : null, receivedOn: status === "saņemts" ? date || null : null, file: null, note: "" });
			if (pending) await api("trAttachFile", root, r.id, pending);
			return r;
		});
		if (ok) {
			setWho("");
			setDate("");
			setPending(null);
			all.reload();
			files.reload();
		}
	}
	async function attach(id: string) {
		const [p] = await pickFiles("Izvēlies saņemtos tehniskos noteikumus", [{ name: "Dokumenti", extensions: ["pdf", "docx", "doc", "xlsx", "txt", "edoc", "asice"] }]);
		if (!p) return;
		await act.run(async () => {
			await api("trAttachFile", root, id, p);
			await api("gatherScan", root);
		});
		all.reload();
		files.reload();
	}

	return (
		<>
			<h1>
				{mine}. {issuer === "state_municipal" ? "Tehniskie noteikumi — pašvaldība un valsts iestādes" : "Tehniskie noteikumi — inženiertīklu īpašnieki"}
			</h1>
			<GatherPanel
				root={root}
				section="tr"
				title="Aģents meklē tehniskos noteikumus"
				what="Aģents izlasa projekta mapi, atrod tehnisko noteikumu pieprasījumus un saņemtos dokumentus (abiem paneļiem kopā), ieraksta, kas tos izsniedz, kad pieprasīti un saņemti, un apbūves ierobežojumus — ar citātiem. Termiņu aprēķina programma."
				onChange={() => (all.reload(), files.reload())}
			/>
			<div className="muted" style={{ marginBottom: 10 }}>
				Termiņš: 11 darbdienas pēc pieprasījuma (MK 500, {issuer === "state_municipal" ? "27.1" : "27.2"} p.). Aprēķinā izlaistas sestdienas, svētdienas un svētku dienas (likums „Par svētku, atceres un atzīmējamām dienām”). <b>Dziesmu un deju svētku noslēguma diena nav iekļauta</b> — tās datums likumā nav norādīts.
			</div>
			<Err text={all.err} />
			{rows.length === 0 && <Empty>Šeit vēl nav neviena pieprasījuma. Spied „Savākt no projekta mapes” — vai pievieno pats zemāk.</Empty>}
			{rows.map((r) => (
				<div key={r.id} className="card">
					<div className="row">
						<b>{r.who}</b>
						<Badge kind={r.status === "saņemts" ? "ok" : r.status === "pieprasīts" ? "warn" : undefined}>{r.status}</Badge>
						{r.found && !r.found.confirmed && <Badge kind="warn">aģents atrada — pārbaudi</Badge>}
						<span className="grow" />
						{r.requestedOn && <span className="muted">pieprasīts {r.requestedOn}</span>}
						{r.deadline && (
							<span>
								termiņš līdz <b>{r.deadline.due}</b>
							</span>
						)}
						{r.receivedOn && <span className="muted">saņemts {r.receivedOn}</span>}
					</div>
					{r.found && (
						<div className="quote">
							<span className="mono">{r.found.file}</span> — „{r.found.quote.length > 240 ? r.found.quote.slice(0, 240) + "…" : r.found.quote}”
							<div className="row">
								<OpenFile root={root} path={r.found.file} />
								{!r.found.confirmed && (
									<>
										<button
											className="btn primary"
											onClick={async () => {
												await act.run(() => api("trConfirm", root, r.id));
												all.reload();
											}}
										>
											Pareizi
										</button>
										<button
											className="btn danger"
											onClick={async () => {
												await act.run(() => api("trRemove", root, r.id));
												all.reload();
											}}
										>
											Nav pareizi — noņemt
										</button>
									</>
								)}
							</div>
						</div>
					)}
					<div className="row" style={{ marginTop: 6 }}>
						{r.status === "pieprasīts" && (
							<ReceiveForm
								files={files.data ?? []}
								onPick={async () => {
									const [p] = await pickFiles("Izvēlies saņemtos tehniskos noteikumus");
									return p ?? null;
								}}
								onSave={async (receivedOn, file, abs) => {
									await act.run(async () => {
										await api("trUpdate", root, r.id, { status: "saņemts", receivedOn, file });
										if (abs) await api("trAttachFile", root, r.id, abs);
									});
									all.reload();
									files.reload();
								}}
							/>
						)}
						{r.file && (
							<>
								<span className="mono">{r.file}</span>
								<OpenFile root={root} path={r.file} />
							</>
						)}
						<button className="btn" disabled={act.busy} onClick={() => attach(r.id)}>
							{r.file ? "Nomainīt failu…" : "Pievienot saņemto failu…"}
						</button>
					</div>
				</div>
			))}
			<details className="card">
				<summary style={{ cursor: "pointer" }}>Pievienot pieprasījumu pašam</summary>
				<div className="row" style={{ marginTop: 8 }}>
					<input type="text" placeholder={issuer === "state_municipal" ? "Piem., pašvaldības būvvalde" : "Piem., gāzes, elektrības, ūdens tīklu īpašnieks"} value={who} onChange={(e) => setWho(e.target.value)} style={{ minWidth: 300 }} />
					<select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
						{STATUS.map((s) => (
							<option key={s}>{s}</option>
						))}
					</select>
					{status !== "nav pieprasīts" && <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title={status === "pieprasīts" ? "Pieprasīšanas datums" : "Saņemšanas datums"} />}
					{status === "saņemts" && (
						<button className="btn" onClick={async () => setPending((await pickFiles("Izvēlies saņemtos tehniskos noteikumus"))[0] ?? null)}>
							{pending ? pending.split(/[\\/]/).pop() : "Izvēlēties failu…"}
						</button>
					)}
					<button className="btn primary" disabled={!who.trim() || act.busy} onClick={add}>
						Pievienot
					</button>
				</div>
				<Err text={act.err} />
			</details>
		</>
	);
}

function ReceiveForm({ files, onSave, onPick }: { files: FileRec[]; onSave: (receivedOn: string, file: string | null, abs: string | null) => void; onPick: () => Promise<string | null> }) {
	const [d, setD] = useState("");
	const [f, setF] = useState("");
	const [abs, setAbs] = useState<string | null>(null);
	return (
		<>
			<span className="muted">Saņemts:</span>
			<input type="date" value={d} onChange={(e) => setD(e.target.value)} />
			<select value={f} onChange={(e) => setF(e.target.value)} disabled={!!abs}>
				<option value="">(fails no projekta mapes)</option>
				{files.map((x) => (
					<option key={x.path} value={x.path}>
						{x.path}
					</option>
				))}
			</select>
			<button className="btn" onClick={async () => setAbs(await onPick())}>
				{abs ? abs.split(/[\\/]/).pop() : "vai izvēlēties failu…"}
			</button>
			<button className="btn" disabled={!d} onClick={() => onSave(d, abs ? null : f || null, abs)}>
				Atzīmēt kā saņemtu
			</button>
		</>
	);
}
