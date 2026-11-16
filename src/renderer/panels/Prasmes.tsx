// Prasmes (task 13.6): the office's skills library next to the synced Revit skills. The office wrote its skills as <role folder>/<name>/SKILL.md; here they are
// imported (a folder dialog), listed by role group with the placeholder count and the state, opened read-only, marked tested, and given to agents.
// A skill is `gatavs` only with no {{AIZPILDĪT}} left and once the user ticked "Pārbaudīts"; a `melnraksts` is never listed to an agent. The text is edited
// outside the app (in any editor, in the office's skills folder); the page re-reads it when "Atjaunot" is pressed. The page decides nothing itself: the state and
// the refusals come from main.
import { useState } from "react";
import type { SkillInfo } from "../../shared/skill-types";
import { call, errText } from "../bridge";
import { Badge, Empty, Err, useLoad } from "../ui";

const SYNCED_GROUP = "Revit prasmes (iebūvētās)";
const NO_GROUP = "Bez grupas";

/** Skills by the group they were imported from; the built-in Revit ones first, then the office's groups in name order. */
function byGroup(skills: SkillInfo[]): { group: string; skills: SkillInfo[] }[] {
	const map = new Map<string, SkillInfo[]>();
	for (const s of skills) {
		const g = s.origin === "synced" ? SYNCED_GROUP : (s.group ?? NO_GROUP);
		map.set(g, [...(map.get(g) ?? []), s]);
	}
	const rank = (g: string) => (g === SYNCED_GROUP ? 0 : g === NO_GROUP ? 2 : 1);
	return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([group, list]) => ({ group, skills: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

export function Prasmes() {
	const lib = useLoad(() => call("skills.list"), []);
	const agents = useLoad(() => call("agents.list"), []);
	const [err, setErr] = useState<string | null>(null);
	const [msg, setMsg] = useState<string | null>(null);
	const [refused, setRefused] = useState<{ name: string; why: string }[]>([]);
	const [shown, setShown] = useState<{ name: string; text: string } | null>(null);
	const [agent, setAgent] = useState("");
	/** the ticks being edited for `agent`; null = as saved */
	const [picked, setPicked] = useState<string[] | null>(null);

	const skills = lib.data ?? [];
	const specs = agents.data?.specs ?? [];
	const current = specs.find((s) => s.id === agent);
	const ticks = picked ?? current?.skills ?? [];
	const office = skills.filter((s) => s.origin === "office");
	const drafts = office.filter((s) => s.state === "draft").length;
	const placeholders = office.reduce((n, s) => n + s.placeholders, 0);

	const run = async (f: () => Promise<void>) => {
		setErr(null);
		setMsg(null);
		try {
			await f();
		} catch (e) {
			setErr(errText(e));
		}
	};
	const importFolder = () =>
		run(async () => {
			const folder = await call("dialog.pickFolder", "Mape ar prasmēm (<grupa>\\<prasme>\\SKILL.md)");
			if (!folder) return;
			const r = await call("skills.import", folder);
			setRefused(r.refused);
			setMsg(r.imported.length || r.refused.length ? `Importētas ${r.imported.length} prasmes; nav importētas ${r.refused.length}.` : "Mapē nav neviena SKILL.md.");
			lib.reload();
		});
	const open = (s: SkillInfo) =>
		run(async () => {
			if (shown?.name === s.name) return setShown(null);
			setShown({ name: s.name, text: await call("skills.read", s.name) });
		});
	const tested = (s: SkillInfo, on: boolean) =>
		run(async () => {
			await call("skills.tested", s.name, on);
			lib.reload();
		});
	const tick = (name: string, on: boolean) => setPicked(on ? [...new Set([...ticks, name])] : ticks.filter((x) => x !== name));
	const pick = (id: string) => {
		setAgent(id);
		setPicked(null);
	};
	const save = () =>
		run(async () => {
			// the whole list goes to agents.save, which checks every spec as the Aģenti page's save does; only this agent's skills differ
			const next = specs.map(({ fixedTokens: _t, ...spec }) => (spec.id === agent ? { ...spec, skills: ticks } : spec));
			await call("agents.save", next);
			setPicked(null);
			setMsg("Saglabāts. Aģents jaunās prasmes redz nākamajā uzdevumā.");
			agents.reload();
		});

	return (
		<div className="page-scroll">
			<div className="row">
				<button onClick={importFolder}>Importēt mapi…</button>
				<button className="ghost" onClick={() => (lib.reload(), agents.reload())}>
					Atjaunot
				</button>
				<span className="dim small grow">
					Biroja prasmes: {office.length}, melnrakstos {drafts}, vietturu {placeholders}. Aģents saņem tikai gatavās: bez vietturiem un atzīmētas kā pārbaudītas. Tekstu labo savā redaktorā, mapē skills lietotnes datu mapē.
				</span>
			</div>
			{err && <div className="err">{err}</div>}
			{msg && <div className="small">{msg}</div>}
			{refused.map((r) => (
				<div key={r.name} className="small dim">
					Nav importēta {r.name}: {r.why}
				</div>
			))}
			{lib.error ? <Err error={lib.error} /> : null}

			<div className="section-title">Aģentam</div>
			<div className="row">
				<select value={agent} onChange={(e) => pick(e.target.value)}>
					<option value="">— izvēlies aģentu —</option>
					{specs.map((s) => (
						<option key={s.id} value={s.id}>
							{s.name || s.id}
						</option>
					))}
				</select>
				<button disabled={!current || picked === null} onClick={save}>
					Saglabāt prasmes
				</button>
				{picked !== null && <span className="small">nesaglabāts</span>}
				{agents.data?.shipped && <span className="dim small">Aģentu saraksts ir piegādātais; saglabājot tas tiek ierakstīts.</span>}
			</div>
			{!specs.length && !agents.loading && <div className="dim small">Nav speciālistu: aģenti tiek veidoti Iestatījumi → Aģenti.</div>}

			{!skills.length && !lib.loading ? (
				<Empty title="nav prasmju">Importē biroja prasmju mapi (poga augšā).</Empty>
			) : (
				byGroup(skills).map((g) => (
					<div key={g.group}>
						<div className="section-title">
							{g.group} <span className="dim small">({g.skills.length})</span>
						</div>
						{g.skills.map((s) => (
							<div key={s.name} className="confirm">
								<div className="row">
									{current && <input type="checkbox" checked={ticks.includes(s.name)} onChange={(e) => tick(s.name, e.target.checked)} title={`Dot ${current.name || current.id}`} />}
									<b className="mono">{s.name}</b>
									<Badge tone={s.state === "ready" ? "ok" : "warn"}>{s.state === "ready" ? "gatavs" : "melnraksts"}</Badge>
									{s.origin === "office" && s.placeholders > 0 && <Badge tone="bad">vietturi: {s.placeholders}</Badge>}
									<span className="grow" />
									{s.origin === "office" && (
										<label className="small" title={s.placeholders > 0 && s.state === "draft" ? `Vēl ir ${s.placeholders} vietturi` : "Aprēķina testa piemērs ir pārbaudīts"}>
											<input type="checkbox" checked={s.state === "ready"} disabled={s.placeholders > 0 && s.state === "draft"} onChange={(e) => tested(s, e.target.checked)} /> Pārbaudīts
										</label>
									)}
									<button className="small ghost" onClick={() => open(s)}>
										{shown?.name === s.name ? "Aizvērt" : "Atvērt"}
									</button>
								</div>
								<div className="small dim">{s.description}</div>
								{current && ticks.includes(s.name) && s.state === "draft" && <div className="small">Nav gatava: aģents to nesaņems, kamēr nebūs gatava.</div>}
								{shown?.name === s.name && <pre className="mono small" style={{ whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto", userSelect: "text" }}>{shown.text}</pre>}
							</div>
						))}
					</div>
				))
			)}
		</div>
	);
}
