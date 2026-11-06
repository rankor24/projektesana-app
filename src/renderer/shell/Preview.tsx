// The preview area: left half of the split view. Shows a source (PDF), a model (IFC) or a comparison.
import type { ReactNode } from "react";
import { useUi } from "../state";
import { Empty } from "../ui";

export function Preview({ children }: { children?: ReactNode }) {
	const { projectId, preview } = useUi();
	if (!projectId) return <section className="preview"><Empty title="nav projekta">Atver vai pievieno projektu panelī Projekts.</Empty></section>;
	if (!preview || !children) return <section className="preview"><Empty title="nav avota">Izvēlies avotu panelī Avoti.</Empty></section>;
	return <section className="preview">{children}</section>;
}
