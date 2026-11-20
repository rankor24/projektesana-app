// Text preview for sources that are not PDFs (docx, xlsx, old Office through COM, OCR text): the cached text per page.
// Selecting text puts it in the Fokuss, as in the PDF view.
import { textFocus } from "../../shared/focus-items";
import { call } from "../bridge";
import { ui, useUi } from "../state";
import { Empty, Err, useLoad } from "../ui";
import { tr } from "../i18n";

export function TextView({ sourceId, title, page }: { sourceId: string; title: string; page?: number }) {
	const { projectId } = useUi();
	const t = useLoad(() => (projectId ? call("sources.text", projectId, sourceId) : Promise.resolve(null)), [projectId, sourceId]);
	if (t.error) return <Err error={t.error} />;
	if (!t.data) return <Empty title={tr("no data")}>{tr("Šim avotam teksta nav (nav nolasīts vai formāts netiek lasīts).")}</Empty>;
	return (
		<div className="fill-col">
			<div className="viewer-bar">
				<b>{title}</b>
				<span className="dim small">
					{tr("{v} lapas · {state}", { v: t.data.pages.length, state: t.data.state })}{t.data.reason ? ` · ${t.data.reason}` : ""}
				</span>
			</div>
			<div className="viewer-body">
				{t.data.pages.map((p, i) => (
					<div
						key={i}
						className="text-page"
						style={page === i + 1 ? { borderColor: "var(--accent)" } : undefined}
						onMouseUp={() => {
							const sel = window.getSelection()?.toString() ?? "";
							if (sel.trim().length >= 3) ui.focusAdd(textFocus(sourceId, title, i + 1, sel));
						}}
					>
						<div className="dim small">{tr("lpp.")} {i + 1}</div>
						{p || <span className="dim">{tr("(tukša lapa)")}</span>}
					</div>
				))}
			</div>
		</div>
	);
}
