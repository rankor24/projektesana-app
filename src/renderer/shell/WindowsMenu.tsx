// The Windows menu in the top bar: every window the current page can show, ticked when open. A closed one opens where the
// page's default keeps it (layout.reopen); "Atjaunot izkārtojumu" puts every window back to this page's default. Whatever the user
// moves stays as moved and is kept in layout.json, so this is the way back, never a reset that happens by itself.
import { useEffect, useRef, useState } from "react";
import { allWindows } from "../../shared/layout";
import { pageById, pageWindows } from "../../shared/pages";
import { useWindows, windows, WINDOW_TITLE } from "../windows";
import { tr } from "../i18n";

export function WindowsMenu() {
	const { page, layout } = useWindows();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
		const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("mousedown", away);
		document.addEventListener("keydown", esc);
		return () => {
			document.removeEventListener("mousedown", away);
			document.removeEventListener("keydown", esc);
		};
	}, [open]);
	const shown = new Set(allWindows(layout));
	const list = pageWindows(page);
	// windows the user brought here from elsewhere (open_panel, a link) are listed too, so they can be closed from here
	for (const id of shown) if (!list.includes(id)) list.push(id);
	return (
		<div className="win-menu" ref={ref}>
			<button className="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={tr("Šīs lapas logi: atvērt aizvērto, atjaunot izkārtojumu")}>
				{tr("Logi")} ▾
			</button>
			{open && (
				<div className="win-menu-pop" role="menu" aria-label={tr("Logi")}>
					<div className="win-menu-head">{tr(pageById(page)?.title ?? page)}</div>
					{list.map((id) => (
						<button key={id} role="menuitemcheckbox" aria-checked={shown.has(id)} className="win-menu-item" onClick={() => windows.toggleOnPage(id)}>
							<span className="win-menu-tick">{shown.has(id) ? "✓" : ""}</span>
							{WINDOW_TITLE[id] ?? id}
						</button>
					))}
					<div className="win-menu-sep" />
					<button
						className="win-menu-item"
						onClick={() => {
							windows.resetLayout();
							setOpen(false);
						}}
					>
						<span className="win-menu-tick" />
						{tr("Atjaunot izkārtojumu")}
					</button>
				</div>
			)}
		</div>
	);
}
