// The open project's profile: one row per profile key. The value in force (confirmed, else the newest proposal) with its
// source, page and quote; every other proposal for the key below it; the user confirms, rejects, or writes the value themself.
import { useState } from "react";
import { PROFILE_KEYS, profileOf, USER_LABEL, type Fact, type ProfileKey, type Source } from "../../core/model";
import { call, errText } from "../bridge";
import { ui } from "../state";
import { commentSubject } from "../comment-subject";
import { Badge, Err, useLoad } from "../ui";
import { locale, tr } from "../i18n";

const LABEL: Record<ProfileKey, string> = {
	workType: tr("Būvniecības veids"),
	group: tr("Ēkas grupa"),
	procedure: tr("Procedūra"),
	stagesInContract: tr("Stadijas līgumā"),
	sections: tr("Sadaļas"),
	funding: tr("Finansējums"),
	"bim.bipPresent": tr("BIP ir"),
	"bim.lodByStage": tr("LOD pa stadijām"),
	use: tr("Lietošanas veids"),
	totalAreaM2: tr("Kopējā platība, m²"),
	floorsAbove: tr("Virszemes stāvi"),
	floorsBelow: tr("Pazemes stāvi"),
	address: tr("Adrese"),
	cadastralNo: tr("Kadastra apzīmējums"),
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
				{tr("{sourceId}, lpp. {page}", { sourceId: title(f.source.sourceId), page: f.source.page })}</button>
		) : (
			<span className="dim small">
				{f.source.name || USER_LABEL}, {new Date(f.source.at).toLocaleDateString(locale())}
			</span>
		);

	return (
		<div className="pane fill">
			{err && <div className="err">{err}</div>}
			<div className="dim small">{tr("Vērtības ar avotu un citātu. Aģenta priekšlikumi stājas spēkā, kad tos apstiprini. Ja dokumenta nav — ieraksti pats.")}</div>
			<table>
				<thead>
					<tr>
						<th style={{ width: 170 }}>{tr("Profils")}</th>
						<th>{tr("Vērtība")}</th>
						<th>{tr("Avots")}</th>
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
									{shown.length === 0 && <span className="dim">{tr("no data")}</span>}
									{shown.map((f) => (
										<div key={f.id} className="row" style={{ marginBottom: 2 }}>
											<span style={{ minWidth: 160 }}>
												{f.value} {f.state === "confirmed" ? <Badge tone="ok">{tr("apstiprināts")}</Badge> : <Badge tone="warn">{tr("priekšlikums (")}{f.by === "agent" ? tr("aģents") : f.by})</Badge>}
											</span>
											<Cite f={f} />
											{"quote" in f.source && <span className="quote small grow">{f.source.quote}</span>}
											{f.state === "proposed" && (
												<>
													<button className="small" onClick={() => act(call("facts.decide", projectId, f.id, "confirmed"))}>{tr("Apstiprināt")}</button>
													<button className="small ghost" onClick={() => act(call("facts.decide", projectId, f.id, "rejected"))}>{tr("Noraidīt")}</button>
												</>
											)}
											{f.state === "confirmed" && !MULTI.has(key) && (
												<button className="small ghost" onClick={() => act(call("facts.decide", projectId, f.id, "rejected"))}>{tr("Atsaukt")}</button>
											)}
										</div>
									))}
									{edit?.key === key ? (
										<div className="row">
											<input autoFocus value={edit.value} onChange={(e) => setEdit({ key, value: e.target.value })} />
											<button className="small primary" disabled={!edit.value.trim()} onClick={() => act(call("facts.setByUser", projectId, k, edit.value)).then(() => setEdit(null))}>{tr("Saglabāt")}</button>
											<button className="small ghost" onClick={() => setEdit(null)}>{tr("Atcelt")}</button>
										</div>
									) : (
										<button className="small ghost" onClick={() => setEdit({ key, value: "" })}>{tr("+ ierakstīt pats")}</button>
									)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			{/* every fact the rows above do not show: an agent's own key (profile.stageDates…, building.001…) must never be invisible */}
			<OtherFacts facts={all.filter((f) => !PROFILE_KEYS.some((k) => f.key === `profile.${k}`) && f.state !== "rejected")} title={title} onDecide={(id, st) => act(call("facts.decide", projectId, id, st))} />
		</div>
	);
}

function OtherFacts({ facts, title, onDecide }: { facts: Fact[]; title: (id: string) => string; onDecide: (id: string, s: "confirmed" | "rejected") => void }) {
	if (!facts.length) return null;
	return (
		<>
			<div className="section-title">{tr("Citi fakti")}</div>
			<table>
				<tbody>
					{facts.map((f) => (
						<tr key={f.id}>
							<td className="mono small">{f.key}</td>
							<td>{f.value}</td>
							<td className="small">
								{"sourceId" in f.source ? (
									<button className="ghost small" title={f.source.quote} onClick={() => "sourceId" in f.source && ui.show({ kind: "source", sourceId: f.source.sourceId, page: f.source.page })}>
										{tr("{sourceId}, lpp. {page}", { sourceId: title(f.source.sourceId), page: f.source.page })}</button>
								) : (
									f.source.name || USER_LABEL
								)}
							</td>
							<td>
								{f.state === "proposed" ? (
									<>
										<button className="small" onClick={() => onDecide(f.id, "confirmed")}>{tr("Apstiprināt")}</button>
										<button className="small ghost" onClick={() => onDecide(f.id, "rejected")}>{tr("Noraidīt")}</button>
									</>
								) : (
									<Badge tone="ok">{tr("apstiprināts")}</Badge>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</>
	);
}
