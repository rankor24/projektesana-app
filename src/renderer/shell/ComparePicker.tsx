// Salīdzināt (A | B): any two files of the project, compared by their kind — PDF sheets (overlay or side by side), DWG
// (CadCraft's DWGCOMPARE), IFC models (one scene, two colours) and documents word by word (DOCX, XLSX, TXT; a PDF too, as
// text). One dialog for every way in: the Versijas page, a file's "Salīdzināt ar…" in Faili and Avoti, Ctrl+K. The older
// file goes left (A), the newer right (B); the pair opens as a tab of the viewer.
import { useMemo, useState, useSyncExternalStore } from "react";
import { modeOfFile, pairMode, type CompareMode } from "../../shared/compare2d";
import type { Source } from "../../core/model";
import { call } from "../bridge";
import { ui, useUi } from "../state";
import { useLoad } from "../ui";
import { tr } from "../i18n";

export interface Item {
	ref: string;
	label: string;
	file: string;
	date: string;
	mode: CompareMode;
}

let state: { open: boolean; a: string | Item | null } = { open: false, a: null };
const subs = new Set<() => void>();
const set = (s: typeof state) => ((state = s), subs.forEach((f) => f()));
/**
 * Opens the dialog; `a` = a file already chosen as one side: its compare ref ("src:<id>", a model's rel), or the whole item
 * for a file the scan did not register (Faili: "file:<root>:<rel>").
 */
export const comparePicker = { open: (a: string | Item | null = null) => set({ open: true, a }), close: () => set({ open: false, a: null }) };
/** The picker item for a file of the Faili tree, or null when its kind cannot be compared. */
export function fileItem(ref: string, name: string, mtime: string | null): Item | null {
	const mode = modeOfFile(name);
	return mode ? { ref, label: name, file: name, date: (mtime ?? "").slice(0, 10), mode } : null;
}
const useOpen = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state);

const fileOf = (s: Source) => s.container?.inner ?? s.paths[0]?.split("::").pop() ?? s.title;
const MODE_TITLE: Record<CompareMode, string> = { sheet: "PDF lapas", ifc: "IFC modeļi", dwg: "DWG rasējumi", text: "Dokumenti (teksts)" };

export function ComparePicker() {
	const { open, a: presetA } = useOpen();
	const { projectId } = useUi();
	if (!open || !projectId) return null;
	const key = typeof presetA === "string" ? presetA : (presetA?.ref ?? "");
	return <Dialog key={key} projectId={projectId} preset={presetA} />;
}

function Dialog({ projectId, preset }: { projectId: string; preset: string | Item | null }) {
	const presetA = typeof preset === "string" ? preset : (preset?.ref ?? null);
	const sources = useLoad(() => call("sources.list", projectId), [projectId]);
	const models = useLoad(() => call("models.list", projectId), [projectId]);
	const items = useMemo<Item[]>(() => {
		const out: Item[] = [];
		for (const s of sources.data ?? []) {
			const f = fileOf(s);
			const m = modeOfFile(f);
			// IFC sources come through the models list (it also knows revisions and archived copies)
			if (m && m !== "ifc") out.push({ ref: `src:${s.id}`, label: s.title, file: f, date: (s.versions[s.versions.length - 1]?.mtime ?? "").slice(0, 10), mode: m });
		}
		for (const m of models.data ?? []) out.push({ ref: m.rel, label: m.name, file: m.name.endsWith(".ifc") ? m.name : `${m.name}.ifc`, date: m.mtime.slice(0, 10), mode: "ifc" });
		if (preset && typeof preset !== "string" && !out.some((x) => x.ref === preset.ref)) out.push(preset);
		return out.sort((x, y) => x.label.localeCompare(y.label));
	}, [sources.data, models.data, preset]);
	const [a, setA] = useState<string | null>(presetA);
	const [b, setB] = useState<string | null>(null);
	const [q, setQ] = useState("");
	const [asText, setAsText] = useState(false);
	const ia = items.find((x) => x.ref === a);
	const ib = items.find((x) => x.ref === b);
	const mode = ia && ib ? pairMode(ia.file, ib.file, asText) : null;
	const bad = typeof mode === "string" && !["sheet", "ifc", "dwg", "text"].includes(mode) ? mode : null;
	// B is picked among files of A's kind (a PDF can also go with a document when compared as text)
	const fits = (x: Item) => !ia || x.ref !== ia.ref && (x.mode === ia.mode || (asText && ["sheet", "text"].includes(x.mode) && ["sheet", "text"].includes(ia.mode)));
	const shown = items.filter((x) => (!q || `${x.label} ${x.file}`.toLowerCase().includes(q.toLowerCase())) && (a ? fits(x) : true));
	const go = () => {
		if (!ia || !ib || !mode || bad) return;
		// the older one is A: by date, the order picked when the dates are equal
		const [x, y] = ib.date && ia.date && ib.date < ia.date ? [ib, ia] : [ia, ib];
		ui.show({ kind: "compare", a: x.ref, b: y.ref, aLabel: `${x.label} · ${x.date}`, bLabel: `${y.label} · ${y.date}`, mode: mode as CompareMode, ...(mode === "sheet" ? { only: false } : {}) });
		comparePicker.close();
	};
	return (
		<div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && comparePicker.close()}>
			<div className="modal cmp-pick" role="dialog" aria-label={tr("Salīdzināt divus failus")}>
				<div className="row" style={{ alignItems: "baseline" }}>
					<b>{tr("Salīdzināt divus failus")}</b>
					<span className="dim small">{tr("PDF, DWG, IFC, DOCX, XLSX, TXT: vecākais pa kreisi (A), jaunākais pa labi (B)")}</span>
					<span className="grow" />
					<button className="ghost small" onClick={comparePicker.close}>
						✕
					</button>
				</div>
				<div className="cmp-pick-slots">
					<Slot name="A" item={ia} onClear={() => (setA(null), setB(null))} />
					<span className="dim">→</span>
					<Slot name="B" item={ib} onClear={() => setB(null)} />
				</div>
				<div className="row">
					<input autoFocus placeholder={a ? tr("meklēt B…") : tr("meklēt A…")} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
					{ia && ["sheet", "text"].includes(ia.mode) && (
						<label className="small" title={tr("Rakstīts dokuments, izdrukāts PDF: salīdzina vārdus, ne līnijas")}>
							<input type="checkbox" checked={asText} onChange={(e) => setAsText(e.target.checked)} /> {tr("kā teksts")}
						</label>
					)}
				</div>
				<div className="cmp-pick-list">
					{(sources.loading || models.loading) && !items.length && <div className="dim">…</div>}
					{!sources.loading && !models.loading && !shown.length && <div className="dim">{a ? tr("Nav otra šāda veida faila.") : tr("Projektā nav failu, ko salīdzināt.")}</div>}
					{shown.slice(0, 400).map((x) => (
						<button
							key={x.ref}
							className={`cmp-pick-item ${x.ref === a || x.ref === b ? "on" : ""}`}
							onClick={() => {
								if (!a) setA(x.ref);
								else setB(x.ref);
								setQ("");
							}}
						>
							<span className="badge">{x.mode === "sheet" ? "PDF" : x.mode.toUpperCase()}</span>
							<span className="grow">{x.label}</span>
							<span className="dim small">{x.date}</span>
						</button>
					))}
				</div>
				{bad && <div className="err small">{tr(bad)}</div>}
				<div className="row">
					{ia && ib && mode && !bad && <span className="dim small">{tr(MODE_TITLE[mode as CompareMode])}</span>}
					<span className="grow" />
					<button className="primary" disabled={!ia || !ib || !!bad} onClick={go}>
						{tr("Salīdzināt")}
					</button>
				</div>
			</div>
		</div>
	);
}

function Slot({ name, item, onClear }: { name: string; item: Item | undefined; onClear: () => void }) {
	return (
		<div className={`cmp-slot ${item ? "set" : ""}`}>
			<span className="cmp-slot-name">{name}</span>
			{item ? (
				<>
					<span className="grow">{item.label}</span>
					<span className="dim small">{item.date}</span>
					<button className="ghost small" onClick={onClear} title={tr("Notīrīt")}>
						✕
					</button>
				</>
			) : (
				<span className="dim">{tr("izvēlies sarakstā")}</span>
			)}
		</div>
	);
}
