// The preview area: left half of the split view. Shows a source (PDF view or text view), a model (IFC) or a comparison.
// Which viewer is chosen from the source's file type; phases 3–5 add the overlays, the IFC view and the compare views.
import { useEffect, type ReactNode } from "react";
import type { Source } from "../../core/model";
import { call } from "../bridge";
import { SourcePdf } from "../preview/SourcePdf";
import { IfcView } from "../preview/IfcView";
import { SheetCompare } from "../preview/SheetCompare";
import { TextView } from "../preview/TextView";
import { LawView } from "../preview/LawView";
import { ui, useUi } from "../state";
import { Empty, useLoad } from "../ui";

export function sourceExt(s: Source): string {
	const name = s.container?.inner ?? s.paths.find((p) => !p.includes("::")) ?? s.paths[0]?.split("::")[1] ?? "";
	return (/\.[^.\\/]+$/.exec(name)?.[0] ?? "").toLowerCase();
}

export function Preview({ extra }: { extra?: (kind: string) => ReactNode }) {
	const { projectId, preview } = useUi();
	const sources = useLoad<Source[]>(() => (projectId ? call("sources.list", projectId) : Promise.resolve([])), [projectId]);
	// what the chat's Auto mode sends: which file is open (selection, camera and page are reported by the views themselves)
	const srcTitle = preview?.kind === "source" ? sources.data?.find((x) => x.id === preview.sourceId)?.title : undefined;
	useEffect(() => {
		if (!preview) return ui.setView({ kind: null });
		if (preview.kind === "ifc") ui.setView({ kind: "ifc", label: preview.label, path: preview.path, sourceId: undefined });
		else if (preview.kind === "compare") ui.setView({ kind: preview.mode === "ifc" ? "compare" : "compare", label: `${preview.aLabel} ↔ ${preview.bLabel}`, path: `${preview.a}|${preview.b}`, sourceId: undefined });
		else if (preview.kind === "law") ui.setView({ kind: "law", label: "likums", sourceId: preview.sourceId, path: undefined });
		else {
			const ifc = sources.data?.find((x) => x.id === preview.sourceId);
			ui.setView({ kind: ifc && sourceExt(ifc) === ".ifc" ? "ifc" : "source", label: srcTitle ?? preview.sourceId, sourceId: preview.sourceId, path: undefined, ...(preview.page ? { page: preview.page } : {}) });
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [preview, srcTitle]);
	// the law library is global: its acts open without a project
	if (preview?.kind === "law") return <section className="preview"><LawView key={preview.sourceId} sourceId={preview.sourceId} quote={preview.quote} /></section>;
	if (!projectId) return <section className="preview"><Empty title="nav projekta">Atver vai pievieno projektu panelī Projekts.</Empty></section>;
	if (!preview) return <section className="preview"><Empty title="nav avota">Izvēlies avotu panelī Avoti.</Empty></section>;
	if (preview.kind === "ifc")
		return (
			<section className="preview">
				<IfcView projectId={projectId} key={preview.path} name={preview.label} load={() => (preview.path.startsWith("rev:") ? call("revisions.ifc", projectId, preview.path.slice(4)) : call("models.bytes", projectId, preview.path))} />
			</section>
		);
	const modelLoad = (ref: string) => () => (ref.startsWith("rev:") ? call("revisions.ifc", projectId, ref.slice(4)) : call("models.bytes", projectId, ref));
	if (preview.kind === "compare" && preview.mode === "ifc")
		return (
			<section className="preview">
				<IfcView projectId={projectId} key={`${preview.a}|${preview.b}`} name={preview.aLabel} load={modelLoad(preview.a)} compareWith={{ name: preview.bLabel, load: modelLoad(preview.b) }} />
			</section>
		);
	if (preview.kind === "compare" && preview.mode === "sheet")
		return (
			<section className="preview">
				<SheetCompare projectId={projectId} a={preview.a} b={preview.b} aLabel={preview.aLabel} bLabel={preview.bLabel} />
			</section>
		);
	if (preview.kind !== "source") return <section className="preview">{extra?.(preview.kind) ?? <Empty title="no data">Skats nav pieejams.</Empty>}</section>;
	const s = sources.data?.find((x) => x.id === preview.sourceId);
	if (!s) return <section className="preview"><Empty title="nav avota">{sources.loading ? "…" : "Avots vairs nav sarakstā."}</Empty></section>;
	const ext = sourceExt(s);
	// an IFC the scan found (Avoti, the agent's show_source): the 3D view, not the text view that has nothing to show
	if (ext === ".ifc")
		return (
			<section className="preview">
				<IfcView projectId={projectId} key={s.id} name={s.title} load={() => call("models.bytes", projectId, `src:${s.id}`)} />
			</section>
		);
	return (
		<section className="preview">
			{ext === ".pdf" ? (
				<SourcePdf key={s.id} projectId={projectId} sourceId={s.id} title={s.title} page={preview.page} />
			) : (
				<TextView sourceId={s.id} title={s.title} page={preview.page} />
			)}
		</section>
	);
}
