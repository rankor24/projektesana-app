// A message the user wrote while the agent was answering (steering): shown at the end of the chat until the agent has read it.
// Until then it can be edited (Labot) or cancelled (Atcelt). When the run was stopped or failed, the message is kept for the user:
// Sūtīt sends it now, Labot and Atcelt as before.
import { useState } from "react";
import type { SteerView } from "../../shared/thread-types";
import { errText } from "../bridge";
import { tr } from "../i18n";

/** What the card says about the message: waits for the agent, or why it will not go by itself. */
export function heldLine(s: Pick<SteerView, "kept" | "detail">): string {
	switch (s.kept) {
		case "stopped":
			return tr("Aģents tika apturēts — ziņa nav nosūtīta");
		case "failed":
			return tr("Aģenta darbs beidzās ar kļūdu — ziņa nav nosūtīta");
		case "refused":
			return tr("Ziņu nevarēja nosūtīt: {why}", { why: s.detail ?? "" });
		default:
			return tr("Gaida aģentu — viņš to izlasīs pēc tekošā soļa");
	}
}

export interface HeldActions {
	/** the new text; false when the agent is reading the message now */
	edit: (text: string) => Promise<boolean>;
	cancel: () => Promise<boolean>;
	send: () => Promise<void>;
}

export function HeldMessage({ held, act }: { held: SteerView; act: HeldActions }) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [note, setNote] = useState<string | null>(null);
	const run = async (f: () => Promise<boolean | void>, tooLate?: string) => {
		setNote(null);
		try {
			if ((await f()) === false) setNote(tooLate ?? tr("Aģents ziņu jau lasa."));
		} catch (e) {
			setNote(errText(e));
		}
	};
	const save = () =>
		run(async () => {
			const ok = await act.edit(draft);
			if (ok) setEditing(false);
			return ok;
		});
	return (
		<div className={`msg user held${held.kept ? " kept" : ""}`} role="group" aria-label={tr("Ziņa gaida aģentu")}>
			<div className="held-head small">{heldLine(held)}</div>
			{held.attachments.length > 0 && (
				<div className="msg-attach">
					{held.attachments.map((a, i) =>
						a.thumb ? (
							<img key={i} src={a.thumb} alt={a.name} title={a.name} />
						) : (
							<span key={i} className="chip" title={a.name}>
								{a.kind === "image" ? "🖼" : "📄"} {a.name}
							</span>
						),
					)}
				</div>
			)}
			{editing ? (
				<textarea
					className="held-edit"
					rows={3}
					value={draft}
					autoFocus
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
						if (e.key === "Escape") setEditing(false);
					}}
				/>
			) : (
				held.text
			)}
			<div className="held-bar">
				{editing ? (
					<>
						<button className="small primary" disabled={!draft.trim() && held.attachments.length === 0} onClick={() => void save()}>
							{tr("Saglabāt")}
						</button>
						<button className="small ghost" onClick={() => setEditing(false)}>
							{tr("Atcelt labošanu")}
						</button>
					</>
				) : (
					<>
						{held.kept && (
							<button className="small primary" onClick={() => void run(() => act.send())}>
								{tr("Sūtīt tagad")}
							</button>
						)}
						<button
							className="small ghost"
							onClick={() => {
								setDraft(held.text);
								setEditing(true);
								setNote(null);
							}}
						>
							{tr("Labot")}
						</button>
						<button className="small ghost" onClick={() => void run(act.cancel, tr("Aģents ziņu jau lasa — to vairs nevar atcelt."))}>
							{tr("Atcelt")}
						</button>
					</>
				)}
				{note && <span className="small warn">{note}</span>}
			</div>
		</div>
	);
}
