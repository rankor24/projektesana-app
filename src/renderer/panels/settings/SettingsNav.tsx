// The left column of Settings: a search box over the index of every setting, and the pages in four groups. Typing replaces the pages with
// the settings that match (in Latvian or English words); Enter or a click opens the first / the chosen one on its page, scrolled to and lit.
// Ported from OpenMausBot src/components/settings/SettingsNav.tsx (SettingsSearchField, SearchResults, highlight, arrow keys between hits).
// Changed: four groups of this app instead of place / account / app, no "elsewhere" hits, no Simple / Advanced footer.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getLang, tr, trDyn } from "../../i18n";
import { groupLabel, pageById, searchSettings, SETTINGS_GROUPS, SETTINGS_PAGES, type SettingsIndexEntry, type SettingsPageId } from "../../../shared/settings-index";

/** What a search result is called in the window's language and in Latvian, so either finds it. */
const labelsOf = (e: SettingsIndexEntry) => (getLang() === "en" ? [trDyn(e.label), e.label] : [e.label]);

function highlight(label: string, query: string): ReactNode {
	const q = query.trim().toLocaleLowerCase();
	const at = q ? label.toLocaleLowerCase().indexOf(q) : -1;
	if (at < 0) return label;
	return (
		<>
			{label.slice(0, at)}
			<mark className="st-mark">{label.slice(at, at + q.length)}</mark>
			{label.slice(at + q.length)}
		</>
	);
}

export function SettingsNav({ page, onPage, onHit }: { page: SettingsPageId | null; onPage: (p: SettingsPageId) => void; onHit: (e: SettingsIndexEntry) => void }) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const input = useRef<HTMLInputElement>(null);
	const hits = useMemo(() => searchSettings(query, labelsOf), [query]);
	useEffect(() => setActive(0), [query]);
	const open = (e: SettingsIndexEntry) => {
		setQuery("");
		onHit(e);
	};
	const searching = query.trim() !== "";
	return (
		<nav className="st-nav" aria-label={tr("Iestatījumu navigācija")}>
			<div className="st-search">
				<input
					ref={input}
					data-settings-search=""
					type="search"
					value={query}
					placeholder={tr("Meklēt iestatījumu…")}
					aria-label={tr("Meklēt iestatījumu")}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") return void (query ? (e.stopPropagation(), setQuery("")) : undefined);
						if (e.key === "ArrowDown") return (e.preventDefault(), setActive((i) => Math.min(hits.length - 1, i + 1)));
						if (e.key === "ArrowUp") return (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
						if (e.key === "Enter" && hits[active]) return (e.preventDefault(), open(hits[active].entry));
					}}
				/>
			</div>
			{searching ? (
				<div className="st-hits" role="listbox">
					{hits.length === 0 && <div className="dim small st-none">{tr("Nekas neatbilst «{query}». Mēģini citu vārdu, latviski vai angliski.", { query: query.trim() })}</div>}
					{hits.map((h, i) => {
						const p = pageById(h.entry.page);
						return (
							<button key={h.entry.id} role="option" aria-selected={i === active} data-settings-hit="" className={`st-hit ${i === active ? "on" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => open(h.entry)}>
								<span className="st-hit-title">{highlight(trDyn(h.entry.label), query)}</span>
								<span className="st-hit-where dim small">
									{h.entry.jump ? tr("atver citu lapu") : `${trDyn(groupLabel(p.group))} → ${trDyn(p.label)}`}
								</span>
							</button>
						);
					})}
				</div>
			) : (
				<div className="st-pages">
					{SETTINGS_GROUPS.map((g) => (
						<div key={g.id} className="st-group">
							<div className="st-group-title">{trDyn(g.label)}</div>
							{SETTINGS_PAGES.filter((p) => p.group === g.id).map((p) => (
								<button key={p.id} data-settings-page={p.id} className={`st-page ${page === p.id ? "on" : ""}`} aria-current={page === p.id ? "page" : undefined} onClick={() => onPage(p.id)}>
									{trDyn(p.label)}
								</button>
							))}
						</div>
					))}
				</div>
			)}
		</nav>
	);
}
