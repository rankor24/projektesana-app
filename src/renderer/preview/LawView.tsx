// Preview of one act or standard from the law library: its saved paragraphs, with the read date and source link.
// A quote (the paragraph a "Piemērojamie normatīvi" row cites) is highlighted and scrolled to. Selected text goes to the
// Fokuss with the act, link and read date, so the agent can cite it.
import { useEffect, useRef } from "react";
import { call } from "../bridge";
import { ui } from "../state";
import { Empty, Err, useLoad } from "../ui";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function LawView({ sourceId, quote }: { sourceId: string; quote?: string }) {
	const t = useLoad(() => call("library.paragraphs", sourceId), [sourceId]);
	const hit = useRef<HTMLDivElement | null>(null);
	const q = quote ? norm(quote) : null;
	useEffect(() => hit.current?.scrollIntoView({ block: "center" }), [t.data, q]);
	if (t.error) return <Err error={t.error} />;
	if (!t.data) return <Empty title="…" />;
	const { source, paragraphs } = t.data;
	// the quote may span several saved lines: mark every line that is part of it
	const marked = (p: string) => !!q && norm(p).length >= 3 && q.includes(norm(p));
	let first = true;
	return (
		<div className="fill-col">
			<div className="viewer-bar">
				<b>{source.title}</b>
				<span className="dim small">
					{paragraphs.length} rindkopas · nolasīts {source.readOn}
					{source.changedOn ? ` · mainīts ${source.changedOn}` : ""}
					{source.url && (
						<>
							{" · "}
							<a href={source.url} target="_blank" rel="noreferrer">
								{source.url}
							</a>
						</>
					)}
					{source.file ? ` · ${source.file}` : ""}
				</span>
			</div>
			<div
				className="viewer-body"
				onMouseUp={() => {
					const sel = window.getSelection()?.toString() ?? "";
					const text = norm(sel).slice(0, 1500);
					if (text.length >= 3)
						ui.focusAdd({ kind: "text", id: `law:${source.id}:${text.length}:${text.slice(0, 24)}`, label: `“${text.slice(0, 40)}${text.length > 40 ? "…" : ""}” (${source.title})`, data: { library: source.id, title: source.title, url: source.url, readOn: source.readOn, text } });
				}}
			>
				<div className="text-page">
					{paragraphs.map((p, i) => {
						const m = marked(p);
						const ref = m && first ? ((first = false), hit) : undefined;
						return (
							<div key={i} ref={ref} style={m ? { background: "var(--elev2)", borderLeft: "3px solid var(--accent)", paddingLeft: 6 } : undefined}>
								{p}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
