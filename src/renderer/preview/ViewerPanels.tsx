// The viewer's side panels (task 9.3): Īpašības (the selected element's attributes and property sets), Elementu koks (project →
// site → building → storey → elements), IFC metadati (schema, project, file header), Faila metadati (the file as the project
// knows it) and Komentāri / BCF (the pins of the open file). Each is a layout window that floats over the viewer or docks to a
// side. The data comes from BimCraft's own IFC engine through the bridge (no IFC parsing of our own): the focused model
// publishes it to viewer-store's viewerInfo.
import { useCallback, useMemo, useState } from "react";
import type { Pin, Source } from "../../core/model";
import type { TreeNode } from "../../shared/bimcraft-protocol";
import { activeTab } from "../../shared/viewer";
import { call, errText } from "../bridge";
import { sourceExt } from "../shell/Preview";
import { ui, useUi } from "../state";
import { Badge, Empty, useLoad } from "../ui";
import { useViewer, useViewerInfo } from "../viewer-store";
import { PinPanel, useFilePins } from "./Annotate";
import { bimcraft } from "./IfcView";
import { tr } from "../i18n";

export function ViewerPanel({ id }: { id: string }) {
	if (id === "viewer.props") return <PropsPanel />;
	if (id === "viewer.tree") return <TreePanel />;
	if (id === "viewer.ifcmeta") return <IfcMetaPanel />;
	if (id === "viewer.filemeta") return <FileMetaPanel />;
	return <CommentsPanel />;
}

const NO_MODEL = <Empty title={tr("nav modeļa")}>{tr("Atver IFC modeli (Avoti, Faili vai Versijas): šis logs rāda tā datus.")}</Empty>;

function PropsPanel() {
	const info = useViewerInfo();
	const p = info.props;
	if (!p) return info.error ? <div className="err">{info.error}</div> : <Empty title={tr("nav elementa")}>{tr("Iezīmē elementu modelī.")}</Empty>;
	const attrs: [string, string | null][] = [
		["Klase", p.cls],
		["Nosaukums", p.name],
		["GlobalId", p.guid],
		["Tips", p.typeName],
		["ObjectType", p.objectType],
		["Tag", p.tag],
		["Apraksts", p.description],
	];
	return (
		<div className="pane fill">
			<table>
				<tbody>
					{attrs.filter(([, v]) => v).map(([k, v]) => (
						<tr key={k}>
							<td className="dim" style={{ width: 110 }}>{k}</td>
							<td className={k === "GlobalId" ? "mono small" : ""}>{v}</td>
						</tr>
					))}
				</tbody>
			</table>
			<button className="small" onClick={() => p.guid && ui.focusAdd({ kind: "element", id: p.guid, label: `${p.cls ?? "elements"} ${p.name ?? ""}`.trim(), data: { guid: p.guid, expressId: p.id, cls: p.cls, name: p.name } })}>{tr("→ aģentam")}</button>
			{p.sets.length === 0 && <div className="dim small">{tr("Īpašību kopu nav.")}</div>}
			{p.sets.map((s, i) => (
				<div key={`${s.name}${i}`}>
					<div className="section-title">
						{s.name} {s.fromType && <Badge tone="info">{tr("no tipa")}</Badge>}
					</div>
					<table>
						<tbody>
							{s.rows.map((r, j) => (
								<tr key={j}>
									<td className="dim" style={{ width: 160 }}>{r.name}</td>
									<td>{r.value}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			))}
		</div>
	);
}

function Node({ n, depth }: { n: TreeNode; depth: number }) {
	const [open, setOpen] = useState(depth < 3);
	const els = n.elements ?? [];
	const hasKids = n.children.length > 0 || els.length > 0;
	return (
		<div>
			<div className="tree-row" style={{ paddingLeft: depth * 14 }}>
				<button className="ghost small" disabled={!hasKids} onClick={() => setOpen(!open)}>{hasKids ? (open ? "▾" : "▸") : "·"}</button>
				<span className="dim small">{n.cls.replace(/^Ifc/, "")}</span> <b>{n.name ?? "—"}</b>
				{n.elementCount !== undefined && <span className="dim small"> {tr("· {elementCount} elementi", { elementCount: n.elementCount })}</span>}
			</div>
			{open && n.children.map((c) => <Node key={c.id} n={c} depth={depth + 1} />)}
			{open &&
				els.map((e) => (
					<div key={e.id} className="tree-row click" style={{ paddingLeft: (depth + 1) * 14 + 22 }} onClick={() => (bimcraft.send({ pj: 1, type: "select", ids: [e.id] }), e.guid && bimcraft.send({ pj: 1, type: "fly", guid: e.guid }))}>
						<span className="dim small">{e.cls.replace(/^Ifc/, "")}</span> {e.name ?? e.guid ?? e.id}
					</div>
				))}
			{open && n.elementCount !== undefined && n.elementCount > els.length && <div className="dim small" style={{ paddingLeft: (depth + 1) * 14 + 22 }}>{tr("… vēl")} {n.elementCount - els.length}</div>}
		</div>
	);
}

function TreePanel() {
	const info = useViewerInfo();
	if (!info.tree) return info.error ? <div className="err">{info.error}</div> : NO_MODEL;
	if (info.tree.length === 0) return <Empty title={tr("no data")}>{tr("Modelī nav telpiskās struktūras.")}</Empty>;
	return (
		<div className="pane fill">
			{info.tree.map((n) => (
				<Node key={n.id} n={n} depth={0} />
			))}
		</div>
	);
}

function IfcMetaPanel() {
	const info = useViewerInfo();
	const m = info.meta;
	if (!m) return info.error ? <div className="err">{info.error}</div> : NO_MODEL;
	const rows: [string, string | number | null][] = [
		[tr("Shēma"), m.schema],
		[tr("Projekts"), m.project.name],
		[tr("Garais nosaukums"), m.project.longName],
		[tr("Fāze"), m.project.phase],
		[tr("Programma"), m.header.application],
		[tr("Autors"), m.header.author],
		[tr("Faila datums"), m.header.timestamp],
		[tr("Stāvi"), m.storeys],
		[tr("Elementi"), m.elements],
	];
	return (
		<div className="pane fill">
			<table>
				<tbody>
					{rows.map(([k, v]) => (
						<tr key={k}>
							<td className="dim" style={{ width: 130 }}>{k}</td>
							<td>{v === null || v === "" ? <span className="dim">{tr("no data")}</span> : v}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function FileMetaPanel() {
	const { projectId } = useUi();
	const v = useViewer();
	const tab = activeTab(v);
	const sources = useLoad<Source[]>(() => (projectId ? call("sources.list", projectId) : Promise.resolve([])), [projectId]);
	if (!tab) return <Empty title={tr("nav faila")}>{tr("Atver failu.")}</Empty>;
	const t = tab.target;
	const s = t.kind === "source" || t.kind === "law" ? sources.data?.find((x) => x.id === t.sourceId) : undefined;
	const rows: [string, string | null | undefined][] =
		t.kind === "ifc"
			? [["Nosaukums", t.label], ["Atsauce", t.path], ["Veids", "IFC modelis"]]
			: t.kind === "compare"
				? [[tr("Salīdzinājums"), `${t.aLabel} ↔ ${t.bLabel}`], [tr("Veids"), t.mode === "ifc" ? tr("IFC modeļi") : tr("lapas")]]
				: s
					? [["Nosaukums", s.title], ["Loma", s.role], ["Veids", sourceExt(s).replace(".", "").toUpperCase() || s.kind], ["Mape", s.folderKey], ["Faili", s.paths.join("\n")]]
					: [["Avots", t.kind === "source" || t.kind === "law" ? t.sourceId : null]];
	return (
		<div className="pane fill">
			<table>
				<tbody>
					{rows.filter(([, val]) => val).map(([k, val]) => (
						<tr key={k}>
							<td className="dim" style={{ width: 110 }}>{k}</td>
							<td style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{val}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** The pins of the open file (a model's element pins, a document's page pins): list, close, reopen, fly to; Piezīmes → BCF. */
function CommentsPanel() {
	const { projectId } = useUi();
	const v = useViewer();
	const tab = activeTab(v);
	const [active, setActive] = useState<string | null>(null);
	const [msg, setMsg] = useState<string | null>(null);
	const sources = useLoad<Source[]>(() => (projectId ? call("sources.list", projectId) : Promise.resolve([])), [projectId]);
	const t = tab?.target ?? null;
	const asModel = t?.kind === "ifc" || (t?.kind === "source" && !!sources.data?.find((s) => s.id === t.sourceId && sourceExt(s) === ".ifc"));
	const name = t?.kind === "ifc" ? t.label : t?.kind === "source" ? sources.data?.find((s) => s.id === t.sourceId)?.title : undefined;
	const belongs = useCallback(
		(p: Pin) => (asModel ? "elementGuid" in p.target && (p.target.model === undefined || p.target.model === name) : t?.kind === "source" && "sourceId" in p.target && p.target.sourceId === t.sourceId),
		[asModel, name, t],
	);
	const pins = useFilePins(projectId ?? "", belongs);
	const items = useMemo(() => pins.items, [pins.items]);
	if (!projectId) return <Empty title={tr("nav projekta")} />;
	if (!t || (t.kind !== "ifc" && t.kind !== "source")) return <Empty title={tr("nav faila")}>{tr("Atver modeli vai dokumentu: šeit ir tā piezīmes.")}</Empty>;
	const select = (p: Pin) => {
		setActive(p.id);
		ui.focusAdd({ kind: "pin", id: p.id, label: p.text.slice(0, 50), data: { state: p.state, target: p.target } });
		if ("elementGuid" in p.target) bimcraft.send({ pj: 1, type: "fly", ...(p.target.camera ? { camera: p.target.camera } : { guid: p.target.elementGuid }) });
		else if ("page" in p.target && p.target.page && t.kind === "source") ui.show({ kind: "source", sourceId: t.sourceId, page: p.target.page });
	};
	return (
		<div className="fill-col">
			{msg && <div className="dim small" style={{ padding: "2px 10px" }}>{msg}</div>}
			<PinPanel
				projectId={projectId}
				items={items}
				activeId={active}
				onSelect={select}
				onChanged={() => (pins.reload(), ui.bump())}
				onError={setMsg}
				footer={
					asModel ? (
						<div className="pin-foot">
							<button className="small" disabled={items.length === 0} title="Piezīmes uz elementiem kā BCF fails (Solibri, Navisworks, BimCraft)" onClick={() => call("bcf.exportPins", projectId).then((f) => setMsg(`BCF: ${f}`)).catch((e) => setMsg(errText(e)))}>
								Piezīmes → BCF
							</button>
						</div>
					) : undefined
				}
			/>
		</div>
	);
}
