// What an agent changed in the settings during this session, newest first, each with its before and after and an Undo button.
// Shown above the page in the Settings window as long as there is something to show, so an agent's change is never only a toast that was missed.
// Undo is stale-safe in main (main/app-settings/host.ts): a setting the user or another change has moved on since is not put back, and the
// reason is shown here.
import { useEffect, useState } from "react";
import { call, errText, on } from "../../bridge";
import { Err, useLoad } from "../../ui";
import { tr } from "../../i18n";

export function RecentChanges() {
	const rows = useLoad(() => call("appSettings.recent"), []);
	const [err, setErr] = useState<string | null>(null);
	useEffect(() => on("appSettings.changed", () => rows.reload()), []); // eslint-disable-line react-hooks/exhaustive-deps
	const list = (rows.data ?? []).slice(0, 6);
	if (list.length === 0) return null;
	const undo = (id: string) => {
		setErr(null);
		call("appSettings.undo", id)
			.then(rows.reload)
			.catch((e) => (setErr(errText(e)), rows.reload()));
	};
	return (
		<details className="st-recent" open={list.some((c) => !c.undone)}>
			<summary>{tr("Aģenta izmaiņas iestatījumos ({n})", { n: list.length })}</summary>
			{list.map((c) => (
				<div key={c.id} className={`st-change ${c.undone ? "done" : ""}`}>
					<span className="st-change-text">
						<b>{c.label}</b>: {c.before} → {c.after} <span className="dim small">· {c.by} · {new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
					</span>
					{c.undone ? <span className="dim small">{tr("atsaukts")}</span> : <button className="small" onClick={() => undo(c.id)}>{tr("Atsaukt")}</button>}
				</div>
			))}
			<Err error={err} />
		</details>
	);
}
