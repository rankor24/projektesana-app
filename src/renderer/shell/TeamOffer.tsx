// The offer of the BD team above the chat: while the 16 BD role agents are not in the app (no BPV among the agents), the conversations window says so and imports
// them in one click, from the folder used last time or a folder the user picks. Why here: the team is the app's working staff (plan D13, the 16 BD roles are the
// permanent agents), and an import hidden on the Aģenti page left the user looking at three agents and asking where the team was. The import itself is the Aģenti
// page's (agents.importTeam: the same checks as a save, the user's own settings never overwritten); this only starts it and shows what it made.
import { useState } from "react";
import type { AgentSpec } from "../../shared/agent-types";
import { BPV_ID } from "../../shared/departments";
import { call, errText } from "../bridge";
import { tr } from "../i18n";
import { useLoad } from "../ui";

export function TeamOffer({ specs, onDone }: { specs: AgentSpec[]; onDone: () => void }) {
	const settings = useLoad(() => call("settings.get"), []);
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [later, setLater] = useState(false);
	const [made, setMade] = useState<string | null>(null);
	// nothing before the list has loaded (an empty list is not "no team"), and nothing once BPV is there, except the line that says what the import made
	if (later || specs.length === 0) return null;
	const hasTeam = specs.some((s) => s.id === BPV_ID);
	if (hasTeam && !made) return null;
	if (made)
		return (
			<div className="waiting-block team-offer">
				<div className="row small">
					<span>{made}</span>
					<button className="ghost small" onClick={() => setMade(null)}>{tr("Labi")}</button>
				</div>
			</div>
		);
	const folder = settings.data?.teamFolder ?? null;
	const importFrom = async (f: string) => {
		setErr(null);
		setBusy(true);
		try {
			const r = await call("agents.importTeam", f);
			setMade(tr("BD komanda importēta: {created} jauni, {updated} atjaunoti aģenti, {skills} prasmes.", { created: r.created.length, updated: r.updated.length, skills: r.skills.imported.length }) + (r.skipped.length ? " " + tr("Izlaisti: {list}.", { list: r.skipped.map((s) => `${s.id} (${s.why})`).join(", ") }) : "") + (r.missing.length ? " " + tr("Mapē nav lomu: {list}.", { list: r.missing.join(", ") }) : ""));
			onDone();
		} catch (e) {
			setErr(errText(e));
		} finally {
			setBusy(false);
		}
	};
	const pick = async () => {
		try {
			const f = await call("dialog.pickFolder", tr("Mape ar BD komandu (01_….md … 16_….md un mape skilli)"));
			if (f) await importFrom(f);
		} catch (e) {
			setErr(errText(e));
		}
	};
	return (
		<div className="waiting-block team-offer">
			<div className="row small">
				<b>{tr("BD komanda vēl nav lietotnē")}</b>
			</div>
			<div className="small dim">{tr("Lietotnē ir {n} aģenti. BD komanda ir 16 lomu aģenti 8 nodaļās (BPV vada, EKS pārbauda). Importē tos no mapes ar lomu failiem 01_….md … 16_….md un mapi skilli.", { n: specs.length })}</div>
			<div className="row">
				{folder && (
					<button disabled={busy} onClick={() => void importFrom(folder)} title={folder}>
						{busy ? tr("Importē…") : tr("Importēt no {folder}", { folder })}
					</button>
				)}
				<button className={folder ? "ghost" : undefined} disabled={busy} onClick={() => void pick()}>
					{busy && !folder ? tr("Importē…") : tr("Importēt BD komandu…")}
				</button>
				<button className="ghost small" disabled={busy} onClick={() => setLater(true)} title={tr("Paslēpj līdz nākamajai palaišanai; imports ir arī lapā Aģenti")}>
					{tr("Vēlāk")}
				</button>
			</div>
			{err && <div className="small err">{err}</div>}
		</div>
	);
}
