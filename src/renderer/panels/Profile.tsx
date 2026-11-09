// The open project's profile: one row per profile key. The value in force (confirmed, else the newest proposal) with its
// source, page and quote; every other proposal for the key below it; the user confirms, rejects, or writes the value themself.
import { useState } from "react";
import { PROFILE_KEYS, profileOf, USER_LABEL, type Fact, type ProfileKey, type Source } from "../../core/model";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { Badge, Err, useLoad } from "../ui";

const LABEL: Record<ProfileKey, string> = {
	workType: "Būvniecības veids",
	group: "Ēkas grupa",
	procedure: "Procedūra",
	stagesInContract: "Stadijas līgumā",
	sections: "Sadaļas",
	funding: "Finansējums",
	"bim.bipPresent": "BIP ir",
	"bim.lodByStage": "LOD pa stadijām",
	use: "Lietošanas veids",
	totalAreaM2: "Kopējā platība, m²",
	floorsAbove: "Virszemes stāvi",
	floorsBelow: "Pazemes stāvi",
	address: "Adrese",
	cadastralNo: "Kadastra apzīmējums",
};

/** Keys that hold several values at once (one fact per stage / section). */
const MULTI = new Set<ProfileKey>(["stagesInContract", "sections"]);

export function Profile({ projectId }: { projectId: string }) {
	const facts = useLoad<Fact[]>(() => call("facts.list", projectId), [projectId]);
	const sources = useLoad<Source[]>(() => call("sources.list", projectId), [projectId]);
	const [err, setErr] = useState<string | null>(null);
	const [edit, setEdit] = useState<{ key: ProfileKey; value: string } | null>(null);
	if (facts.error) return <Err error={facts.error} />;
	const all = facts.data ?? [];
	const prof = profileOf(all);
	const title = (id: string) => sources.data?.find((s) => s.id === id)?.title ?? id;
	const act = (p: Promise<unknown>) => p.then(() => facts.reload()).catch((e) => setErr(errText(e)));

	const Cite = ({ f }: { f: Fact }) =>
		"sourceId" in f.source ? (
			<button className="ghost small" title={f.source.quote} onClick={() => "sourceId" in f.source && ui.show({ kind: "source", sourceId: f.source.sourceId, page: f.source.page })}>
				{title(f.source.sourceId)}, lpp. {f.source.page}
			</button>
		) : (
			<span className="dim small">
				{f.source.name || USER_LABEL}, {new Date(f.source.at).toLocaleDateString("lv-LV")}
			</span>
		);

	return (
		<div className="pane fill">
			{err && <div className="err">{err}</div>}
			<div className="dim small">Vērtības ar avotu un citātu. Aģenta priekšlikumi stājas spēkā, kad tos apstiprini. Ja dokumenta nav — ieraksti pats.</div>
			<table>
				<thead>
					<tr>
						<th style={{ width: 170 }}>Profils</th>
						<th>Vērtība</th>
						<th>Avots</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{PROFILE_KEYS.map((key) => {
						const k = `profile.${key}`;
						const rows = all.filter((f) => f.key === k && f.state !== "rejected").sort((a, b) => b.at.localeCompare(a.at));
						const shown = MULTI.has(key) ? rows : rows.filter((f) => f === prof[key] || f.state === "proposed");
						return (
							<tr key={key}>
								<td>
									<b>{LABEL[key]}</b>
								</td>
								<td colSpan={3}>
									{shown.length === 0 && <span className="dim">no data</span>}
									{shown.map((f) => (
										<div key={f.id} className="row" style={{ marginBottom: 2 }}>
											<span style={{ minWidth: 160 }}>
												{f.value} {f.state === "confirmed" ? <Badge tone="ok">apstiprināts</Badge> : <Badge tone="warn">priekšlikums ({f.by === "agent" ? "aģents" : f.by})</Badge>}
											</span>
											<Cite f={f} />
											{"quote" in f.source && <span className="quote small grow">{f.source.quote}</span>}
											{f.state === "proposed" && (
												<>
													<button className="small" onClick={() => act(call("facts.decide", projectId, f.id, "confirmed"))}>Apstiprināt</button>
													<button className="small ghost" onClick={() => act(call("facts.decide", projectId, f.id, "rejected"))}>Noraidīt</button>
												</>
											)}
											{f.state === "confirmed" && !MULTI.has(key) && (
												<button className="small ghost" onClick={() => act(call("facts.decide", projectId, f.id, "rejected"))}>Atsaukt</button>
											)}
										</div>
									))}
									{edit?.key === key ? (
										<div className="row">
											<input autoFocus value={edit.value} onChange={(e) => setEdit({ key, value: e.target.value })} />
											<button className="small primary" disabled={!edit.value.trim()} onClick={() => act(call("facts.setByUser", projectId, k, edit.value)).then(() => setEdit(null))}>Saglabāt</button>
											<button className="small ghost" onClick={() => setEdit(null)}>Atcelt</button>
										</div>
									) : (
										<button className="small ghost" onClick={() => setEdit({ key, value: "" })}>+ ierakstīt pats</button>
									)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			<OtherFacts facts={all.filter((f) => !f.key.startsWith("profile.") && f.state !== "rejected")} title={title} onDecide={(id, st) => act(call("facts.decide", projectId, id, st))} />
		</div>
	);
}

function OtherFacts({ facts, title, onDecide }: { facts: Fact[]; title: (id: string) => string; onDecide: (id: string, s: "confirmed" | "rejected") => void }) {
	if (!facts.length) return null;
	return (
		<>
			<div className="section-title">Citi fakti</div>
			<table>
				<tbody>
					{facts.map((f) => (
						<tr key={f.id}>
							<td className="mono small">{f.key}</td>
							<td>{f.value}</td>
							<td className="small">
								{"sourceId" in f.source ? (
									<button className="ghost small" title={f.source.quote} onClick={() => "sourceId" in f.source && ui.show({ kind: "source", sourceId: f.source.sourceId, page: f.source.page })}>
										{title(f.source.sourceId)}, lpp. {f.source.page}
									</button>
								) : (
									f.source.name || USER_LABEL
								)}
							</td>
							<td>
								{f.state === "proposed" ? (
									<>
										<button className="small" onClick={() => onDecide(f.id, "confirmed")}>Apstiprināt</button>
										<button className="small ghost" onClick={() => onDecide(f.id, "rejected")}>Noraidīt</button>
									</>
								) : (
									<Badge tone="ok">apstiprināts</Badge>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</>
	);
}
