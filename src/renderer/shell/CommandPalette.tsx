// Command palette (task 8.6): Ctrl+K from anywhere. Panels, projects, the open project's sources, the agent's task templates and
// the files opened lately, in one list; type words, arrows and Enter. Ranking is shared/palette.ts. A template does not run:
// it lands in the agent's message box, as when its button is pressed, so the user reads it before it goes.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Source } from "../../core/model";
import { fold, rank, type PaletteItem } from "../../shared/palette";
import { sourceFocus } from "../../shared/focus-items";
import { call } from "../bridge";
import { ui, useUi } from "../state";
import { PANEL_TITLE, PANELS, windows, type PanelId } from "../windows";

const PANEL_HINT: Record<PanelId, string> = {
	projekts: "projekti, profils, nolasīšana",
	faili: "mapju koks, meklēšana",
	grafiks: "kalendārs, termiņi, uzdevumi",
	avoti: "dokumenti pa mapēm",
	prasibas: "prasības un atradumi",
	telpas: "telpu programma pret modeli",
	nodevumi: "nodot projektu, termiņi",
	atmina: "lēmumi un atbildes",
	versijas: "kas mainījās starp datumiem",
	iestatijumi: "ceļi, modelis, Revit",
};
const GROUP_LABEL = { recent: "nesen", panel: "panelis", project: "projekts", template: "aģenta uzdevums", source: "avots" } as const;

interface Entry extends PaletteItem {
	run: () => void;
}

export function CommandPalette() {
	const { projectId } = useUi();
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState("");
	const [pos, setPos] = useState(0);
	const [data, setData] = useState<{ projects: { id: string; name: string }[]; sources: Source[]; templates: { id: string; label: string; text: string }[] }>({ projects: [], sources: [], templates: [] });
	const input = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setOpen((o) => !o);
			} else if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// what can be found is read when the palette opens, so it is never older than the click that opened it
	useEffect(() => {
		if (!open) return;
		setQ("");
		setPos(0);
		setTimeout(() => input.current?.focus(), 0);
		void Promise.all([call("projects.list").catch(() => []), projectId ? call("sources.list", projectId).catch(() => []) : Promise.resolve([] as Source[]), call("tasks.list").catch(() => [])]).then(([projects, sources, templates]) => setData({ projects, sources, templates }));
	}, [open, projectId]);

	const entries = useMemo<Entry[]>(() => {
		const close = () => setOpen(false);
		const title = (id: string) => data.sources.find((s) => s.id === id)?.title;
		const list: Entry[] = [];
		for (const t of ui.recent(projectId)) {
			if (t.kind === "source") {
				const s = data.sources.find((x) => x.id === t.sourceId);
				if (s) list.push({ id: `recent:${s.id}`, group: "recent", label: s.title, hint: s.role, run: () => (ui.show({ kind: "source", sourceId: s.id }), close()) });
			} else list.push({ id: `recent:${t.path}`, group: "recent", label: t.label, hint: "modelis", run: () => (ui.show({ kind: "ifc", path: t.path, label: t.label }), close()) });
		}
		for (const id of PANELS) list.push({ id: `panel:${id}`, group: "panel", label: PANEL_TITLE[id], hint: PANEL_HINT[id], run: () => (windows.open(id), close()) });
		for (const p of data.projects) list.push({ id: `project:${p.id}`, group: "project", label: `${p.id} ${p.name}`, hint: "atvērt projektu", run: () => (ui.setProject(p.id), close()) });
		for (const t of data.templates) list.push({ id: `template:${t.id}`, group: "template", label: t.label, hint: t.text.slice(0, 80), run: () => (ui.draft(t.text), close()) });
		for (const s of data.sources) {
			if (s.kind === "photoSurvey") continue;
			list.push({ id: `source:${s.id}`, group: "source", label: s.title, hint: s.role, keywords: s.folderKey, run: () => (ui.show({ kind: "source", sourceId: s.id }), ui.focusAdd(sourceFocus(s.id, title(s.id) ?? s.title, s.role)), close()) });
		}
		return list;
	}, [data, projectId, open]);

	const shown = useMemo(() => {
		const byId = new Map(entries.map((e) => [e.id, e]));
		// a recent file is also a source: show it once, as recent
		const seen = new Set<string>();
		const dedup = entries.filter((e) => {
			const key = e.group === "recent" ? fold(e.label) : e.group === "source" ? fold(e.label) : e.id;
			if (e.group === "source" && seen.has(key)) return false;
			if (e.group === "recent") seen.add(key);
			return true;
		});
		return rank(dedup, q).map((i) => byId.get(i.id)!);
	}, [entries, q]);

	if (!open) return null;
	const run = (e?: Entry) => e?.run();
	return (
		<div className="palette-back" onMouseDown={() => setOpen(false)}>
			<div className="palette" onMouseDown={(e) => e.stopPropagation()}>
				<input
					ref={input}
					placeholder="Panelis, projekts, avots, aģenta uzdevums… (Esc aizver)"
					value={q}
					onChange={(e) => (setQ(e.target.value), setPos(0))}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") (e.preventDefault(), setPos((p) => Math.min(p + 1, shown.length - 1)));
						else if (e.key === "ArrowUp") (e.preventDefault(), setPos((p) => Math.max(p - 1, 0)));
						else if (e.key === "Enter") (e.preventDefault(), run(shown[pos]));
					}}
				/>
				<div className="palette-list">
					{shown.length === 0 && <div className="dim small" style={{ padding: 12 }}>Nekas neatbilst «{q}».{projectId ? "" : " Avoti parādās, kad ir atvērts projekts."}</div>}
					{shown.map((e, i) => (
						<div key={e.id} className={`palette-row ${i === pos ? "on" : ""}`} onMouseEnter={() => setPos(i)} onClick={() => run(e)}>
							<span className="palette-group">{GROUP_LABEL[e.group]}</span>
							<span className="palette-label">{e.label}</span>
							{e.hint && <span className="dim small palette-hint">{e.hint}</span>}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
