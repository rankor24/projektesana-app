// The agent's answers as formatted text (2.6.8: they showed as raw markdown, "**…**", "|---|" and "[name](source:s_…)"):
// headings, lists, tables, bold / italic / code (shared/markdown.ts, the parser the Word export uses), web links, and the
// project's sources by name. "[name](source:<id>)" and a bare source id both show the document's title and open it; the
// user never has to read an internal id.
import { Fragment, type ReactNode } from "react";
import { inlineRuns, parseMarkdown } from "../../shared/markdown";
import type { Source } from "../../core/model";
import { call, on } from "../bridge";
import { ui, useUi } from "../state";
import { useLoad } from "../ui";

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)|\b(s_[0-9a-f]{8,16})\b/g;

/** Text with links and bare source ids made into links; the rest stays text. */
function linked(text: string, titles: Map<string, string>, key: string): ReactNode[] {
	const out: ReactNode[] = [];
	let last = 0;
	let n = 0;
	for (const m of text.matchAll(LINK)) {
		if (m.index > last) out.push(text.slice(last, m.index));
		const k = `${key}-${n++}`;
		const target = m[2] ?? `source:${m[3]}`;
		const src = /^source:([\w-]+)(?:[#?](?:p|page=)?(\d+))?$/.exec(target);
		if (src && (m[3] === undefined || titles.has(src[1]))) {
			const page = src[2] ? Number(src[2]) : undefined;
			const label = m[1] ?? titles.get(src[1]) ?? src[1];
			out.push(
				<button key={k} className="md-src" title={titles.get(src[1]) ?? src[1]} onClick={() => ui.show({ kind: "source", sourceId: src[1], ...(page ? { page } : {}) })}>
					{label}
				</button>,
			);
		} else if (m[2] && /^https?:\/\//.test(m[2])) {
			out.push(
				<a key={k} href={m[2]} target="_blank" rel="noreferrer">
					{m[1]}
				</a>,
			);
		} else out.push(m[0]);
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
}

function Inline({ text, titles }: { text: string; titles: Map<string, string> }) {
	return (
		<>
			{inlineRuns(text).map((r, i) => {
				const body = linked(r.text, titles, String(i));
				if (r.code) return <code key={i}>{r.text}</code>;
				const el = r.i ? <em>{body}</em> : <>{body}</>;
				return r.b ? <strong key={i}>{el}</strong> : <Fragment key={i}>{el}</Fragment>;
			})}
		</>
	);
}

// the project's source titles by id, read once per project for every answer on screen; a scan or a role change reads them again
const titlesOf = new Map<string, Promise<Map<string, string>>>();
let listening = false;
const loadTitles = (projectId: string) => {
	if (!listening) {
		listening = true;
		on("data.changed", (e) => {
			if (!e.what || e.what.includes("sources")) titlesOf.clear();
		});
	}
	let p = titlesOf.get(projectId);
	if (!p) titlesOf.set(projectId, (p = call("sources.list", projectId).then((all: Source[]) => new Map(all.map((x) => [x.id, x.title] as const)))));
	return p;
};
const NONE = new Map<string, string>();

/** The chat names documents, never ids. */
function useSourceTitles(): Map<string, string> {
	const { projectId } = useUi();
	const s = useLoad(() => (projectId ? loadTitles(projectId) : Promise.resolve(NONE)), [projectId]);
	return s.data ?? NONE;
}

export function Markdown({ text }: { text: string }) {
	const titles = useSourceTitles();
	return (
		<div className="md">
			{parseMarkdown(text).map((b, i) => {
				if (b.k === "h") {
					const H = (["h3", "h4", "h5", "h6"] as const)[Math.min(b.level, 4) - 1];
					return (
						<H key={i}>
							<Inline text={b.text} titles={titles} />
						</H>
					);
				}
				if (b.k === "p")
					return (
						<p key={i}>
							<Inline text={b.text} titles={titles} />
						</p>
					);
				if (b.k === "ul" || b.k === "ol") {
					const L = b.k;
					return (
						<L key={i}>
							{b.items.map((t, j) => (
								<li key={j}>
									<Inline text={t} titles={titles} />
								</li>
							))}
						</L>
					);
				}
				if (b.k === "table")
					return (
						<div key={i} className="md-table">
							<table>
								<thead>
									<tr>
										{b.rows[0]!.map((c, j) => (
											<th key={j}>
												<Inline text={c} titles={titles} />
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{b.rows.slice(1).map((r, j) => (
										<tr key={j}>
											{r.map((c, k) => (
												<td key={k}>
													<Inline text={c} titles={titles} />
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					);
				return <hr key={i} />;
			})}
		</div>
	);
}
