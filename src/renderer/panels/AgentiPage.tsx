// The Agents page: the agent list (Agenti), the Skills shortcut and the limits on how far agents may talk to each other.
// Was a block at the bottom of Settings; a page of its own, like BIM Crew's agents page.
import { useEffect, useState } from "react";
import type { Limits } from "../../shared/thread-types";
import { call, errText } from "../bridge";
import { Err, useLoad } from "../ui";
import { windows } from "../windows";
import { Agenti } from "./Agenti";
import { tr } from "../i18n";

export function AgentiPage() {
	const settings = useLoad(() => call("settings.get"), []);
	const [err, setErr] = useState<string | null>(null);
	const s = settings.data;
	useEffect(() => {
		setErr(null);
	}, [s]);
	const saveLimits = async (limits: Limits) => {
		setErr(null);
		try {
			await call("settings.set", { limits });
			settings.reload();
		} catch (e) {
			setErr(errText(e));
		}
	};
	return (
		<div className="page-scroll">
			<Err error={err} />
			<div className="section-title">{tr("Aģenti")}</div>
			<Agenti />
			<div className="row">
				<button className="ghost" onClick={() => windows.open("prasmes")}>
					{tr("Prasmes…")}</button>
				<span className="dim small">{tr("Biroja prasmju bibliotēka un tas, kuras prasmes kuram aģentam.")}</span>
			</div>
			<div className="section-title">{tr("Aģentu ierobežojumi")}</div>
			{s && <LimitInputs limits={s.limits} save={saveLimits} />}
			<div className="dim small">{tr("Cik tālu aģenti drīkst sarunāties savā starpā. Vilnis ir viss, ko izraisa viena tava darbība; tam sasniedzot robežu, rindā gaidošie darbi apstājas un “Gaida tevi” piedāvā turpināt.")}</div>
		</div>
	);
}

const LIMIT_ROWS: { key: keyof Limits; label: string; min: number; max: number; step?: number }[] = [
	{ key: "exchangesPerTopic", label: tr("Ziņas par vienu tematu (no katras puses)"), min: 1, max: 10 },
	{ key: "chainDepth", label: tr("Ziņu ķēdes dziļums"), min: 1, max: 20 },
	{ key: "runsPerWave", label: tr("Skrējieni vienā vilnī"), min: 1, max: 200 },
	{ key: "waveCost", label: tr("Viļņa izmaksu robeža ($)"), min: 0, max: 100000, step: 0.1 },
	{ key: "taskIterations", label: tr("Uzdevuma iterācijas"), min: 1, max: 10 },
];

/** The five limits. Saved on leaving a field; main puts each into its range, and the field shows what was kept. An empty cost field = no cost limit. */
function LimitInputs({ limits, save }: { limits: Limits; save: (next: Limits) => void }) {
	return (
		<>
			{LIMIT_ROWS.map((r) => (
				<label key={`${r.key}${limits[r.key]}`} className="row">
					<span style={{ width: 260 }}>{r.label}</span>
					<input
						type="number"
						min={r.min}
						max={r.max}
						step={r.step ?? 1}
						defaultValue={limits[r.key] ?? ""}
						placeholder={r.key === "waveCost" ? tr("nav robežas") : undefined}
						style={{ width: 110 }}
						onBlur={(e) => {
							const raw = e.target.value.trim();
							const v = raw === "" ? null : Number(raw);
							if (v !== limits[r.key] && !(v === null && r.key !== "waveCost")) save({ ...limits, [r.key]: v });
						}}
					/>
				</label>
			))}
		</>
	);
}
