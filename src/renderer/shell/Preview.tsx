// The preview area: left half of the split view. Shows a source (PDF view or text view), a model (IFC) or a comparison.
// Which viewer is chosen from the source's file type; phases 3–5 add the overlays, the IFC view and the compare views.
import type { ReactNode } from "react";
import type { Source } from "../../core/model";
import { call } from "../bridge";
import { SourcePdf } from "../preview/SourcePdf";
import { IfcView } from "../preview/IfcView";
import { SheetCompare } from "../preview/SheetCompare";
import { TextView } from "../preview/TextView";
import { useUi } from "../state";
import { Empty, useLoad } from "../ui";

export function sourceExt(s: Source): string {
	const name = s.container?.inner ?? s.paths.find((p) => !p.includes("::")) ?? s.paths[0]?.split("::")[1] ?? "";
	return (/\.[^.\\/]+$/.exec(name)?.[0] ?? "").toLowerCase();
}

export function Preview({ extra }: { extra?: (kind: string) => ReactNode }) {
	const { projectId, preview } = useUi();
	const sources = useLoad<Source[]>(() => (projectId ? call("sources.list", projectId) : Promise.resolve([])), [projectId]);
	if (!projectId) return <section className="preview"><Empty title="nav projekta">Atver vai pievieno projektu panelī Projekts.</Empty></section>;
	if (!preview) return <section className="preview"><Empty title="nav avota">Izvēlies avotu panelī Avoti.</Empty></section>;
	if (preview.kind === "ifc")
		return (
			<section className="preview">
				<IfcView key={preview.path} name={preview.label} load={() => (preview.path.startsWith("rev:") ? call("revisions.ifc", projectId, preview.path.slice(4)) : call("models.bytes", projectId, preview.path))} />
			</section>
		);
	const modelLoad = (ref: string) => () => (ref.startsWith("rev:") ? call("revisions.ifc", projectId, ref.slice(4)) : call("models.bytes", projectId, ref));
	if (preview.kind === "compare" && preview.mode === "ifc")
		return (
			<section className="preview">
				<IfcView key={`${preview.a}|${preview.b}`} name={preview.aLabel} load={modelLoad(preview.a)} compareWith={{ name: preview.bLabel, load: modelLoad(preview.b) }} />
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
