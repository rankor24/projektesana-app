// Faili (task 8.3): the project's folders and files as a tree, like Explorer, with what the app knows laid over it — the
// scan's role chip, whether a file is a source the agent can read — and a way into the preview for every file that has
// one. Read-only. Three roots: the office folder, the drafts' staging, the project's own data. Folders load one level at
// a time; the box filters what is loaded and "Meklēt" searches every name below the root.
import { useEffect, useState } from "react";
import type { FileEntry, FileList, FileRoot } from "../../shared/api";
import { sourceFocus } from "../../shared/focus-items";
import { call, errText } from "../bridge";
import { ui, useUi } from "../state";
import { Badge, Empty, Err, useLoad } from "../ui";

const PREVIEW = new Set([".pdf", ".ifc", ".docx", ".doc", ".xlsx", ".xls", ".txt", ".rtf", ".msg"]);
const extOf = (n: string) => (/\.[^.\\/]+$/.exec(n)?.[0] ?? "").toLowerCase();
const size = (n: number | null) => (n === null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`);
const parentOf = (rel: string) => rel.split("::")[0].replace(/[\\/][^\\/]*$/, "");

export function Faili() {
	const { projectId, tick } = useUi();
	if (!projectId) return <Empty title="nav projekta">Atver projektu panelī Projekts.</Empty>;
	return <FileTree key={projectId} projectId={projectId} tick={tick} />;
}

function FileTree({ projectId, tick }: { projectId: string; tick: number }) {
	const roots = useLoad<FileRoot[]>(() => call("files.roots", projectId), [projectId]);
	const [root, setRoot] = useState<FileRoot["key"]>("projekts");
	const [lists, setLists] = useState<Record<string, FileList>>({});
	const [open, setOpen] = useState<Set<string>>(new Set());
	const [q, setQ] = useState("");
	const [found, setFound] = useState<FileList | null>(null);
	const [err, setErr] = useState<string | null>(null);

	const load = (rel: string) =>
		call("files.list", projectId, root, rel)
			.then((l) => setLists((m) => ({ ...m, [rel]: l })))
			.catch((e) => setErr(errText(e)));

	// a new root, a new project or a rescan: start again from the top level
	useEffect(() => {
		setLists({});
		setOpen(new Set());
		setFound(null);
		setErr(null);
		void load("");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [root, tick]);

	const toggle = (e: FileEntry) => {
		const next = new Set(open);
		const key = e.kind === "file" ? `${e.rel}::` : e.rel;
		if (next.has(key)) next.delete(key);
		else {
			next.add(key);
			if (!lists[key]) void load(key);
		}
		setOpen(next);
	};

	const openFile = (e: FileEntry) => {
		setErr(null);
		const ext = extOf(e.name);
		if (e.sourceId && PREVIEW.has(ext)) return ui.show({ kind: "source", sourceId: e.sourceId });
		if (ext === ".ifc" && !e.rel.includes("::")) return ui.show({ kind: "ifc", path: root === "projekts" ? e.rel : `file:${root}:${e.rel}`, label: e.name });
		call("files.open", projectId, root, e.rel).catch((x) => setErr(errText(x)));
	};

	const search = () => call("files.search", projectId, root, q).then(setFound).catch((e) => setErr(errText(e)));

	const rowOf = (e: FileEntry, depth: number) => {
		const key = e.kind === "file" ? `${e.rel}::` : e.rel;
		const expandable = e.kind === "dir" || !!e.inner;
		return (
			<div key={`${e.rel}`} className={`ftree-row ${e.kind}`} style={{ paddingLeft: 8 + depth * 16 }}>
				<button className="ghost small ftree-tw" disabled={!expandable} onClick={() => toggle(e)}>
					{expandable ? (open.has(key) ? "▾" : "▸") : ""}
				</button>
				<span className={`ftree-name ${e.kind === "file" ? "click" : ""}`} title={e.rel} onClick={() => (e.kind === "dir" ? toggle(e) : openFile(e))}>
					{e.kind === "dir" ? "📁 " : e.rel.includes("::") ? "↳ " : ""}
					{e.name}
				</span>
				{e.role && <Badge tone={e.roleFrom === "unconfirmed" ? "warn" : "info"} title={e.roleFrom ? `loma: ${e.roleFrom}` : undefined}>{e.role}</Badge>}
				{e.kind === "file" && !e.sourceId && root === "projekts" && !e.rel.includes("::") && <span className="dim small" title="Skenēšana šo failu nav reģistrējusi kā avotu: aģents to nelasa">nav avots</span>}
				<span className="grow" />
				<span className="dim small ftree-meta">
					{e.kind === "dir" ? `${e.files}${e.capped ? "+" : ""} faili` : `${size(e.size)}${e.mtime ? ` · ${e.mtime.slice(0, 10)}` : ""}`}
				</span>
				<span className="ftree-actions">
					{e.kind === "file" && (
						<button className="small" onClick={() => openFile(e)}>
							Atvērt
						</button>
					)}
					{e.sourceId && (
						<button className="small ghost" title="Nodod aģentam kā Fokuss" onClick={() => ui.focusAdd(sourceFocus(e.sourceId!, e.name, e.role ?? ""))}>
							+ Fokuss
						</button>
					)}
					<button className="small ghost" title="Atver mapi Explorerī" onClick={() => call("files.open", projectId, root, e.kind === "dir" ? e.rel : parentOf(e.rel)).catch((x) => setErr(errText(x)))}>
						Explorerī
					</button>
				</span>
			</div>
		);
	};

	const level = (rel: string, depth: number): React.ReactNode => {
		const l = lists[rel];
		if (!l) return <div className="dim small" style={{ paddingLeft: 8 + depth * 16 }}>ielādē…</div>;
		const f = q.trim().toLowerCase();
		const shown = f && !found ? l.entries.filter((e) => e.kind === "dir" || e.name.toLowerCase().includes(f)) : l.entries;
		return (
			<>
				{shown.map((e) => (
					<div key={e.rel}>
						{rowOf(e, depth)}
						{open.has(e.kind === "file" ? `${e.rel}::` : e.rel) && level(e.kind === "file" ? `${e.rel}::` : e.rel, depth + 1)}
					</div>
				))}
				{shown.length === 0 && <div className="dim small" style={{ paddingLeft: 8 + depth * 16 }}>{l.entries.length ? "nekas neatbilst filtram" : "tukša mape"}</div>}
				{l.hidden > 0 && (
					<div className="dim small" style={{ paddingLeft: 8 + depth * 16 }}>
						… vēl {l.hidden} nav parādīti (izmanto meklēšanu)
					</div>
				)}
			</>
		);
	};

	const current = roots.data?.find((r) => r.key === root);
	return (
		<div className="fill-col">
			<div className="tabs">
				{(roots.data ?? []).map((r) => (
					<button key={r.key} className={r.key === root ? "on" : ""} disabled={!r.exists} title={r.exists ? undefined : "Mapes vēl nav"} onClick={() => setRoot(r.key)}>
						{r.label}
					</button>
				))}
			</div>
			<div className="row" style={{ padding: "6px 10px" }}>
				<input className="grow" placeholder="filtrs ielādētajiem vai meklēt visos nosaukumos…" value={q} onChange={(e) => (setQ(e.target.value), setFound(null))} onKeyDown={(e) => e.key === "Enter" && q.trim().length >= 2 && search()} />
				<button disabled={q.trim().length < 2} onClick={search}>
					Meklēt
				</button>
				<button className="ghost" onClick={() => (setLists({}), setOpen(new Set()), void load(""))}>
					Atsvaidzināt
				</button>
			</div>
			{err && <div className="err" style={{ margin: "0 10px" }}>{err}</div>}
			{roots.error ? <Err error={roots.error} /> : null}
			<div className="ftree">
				{found ? (
					<>
						<div className="row small" style={{ padding: "2px 10px" }}>
							<b>Atrasts: {found.entries.length}</b>
							{found.hidden > 0 && <span className="dim">(rādīti pirmie {found.entries.length}; precizē vaicājumu)</span>}
							<button className="ghost small" onClick={() => setFound(null)}>
								Atpakaļ uz koku
							</button>
						</div>
						{found.entries.length === 0 && <div className="dim small" style={{ padding: 10 }}>Nekas neatbilst «{q}».</div>}
						{found.entries.map((e) => (
							<div key={e.rel}>
								{rowOf(e, 0)}
								<div className="dim small mono" style={{ paddingLeft: 40 }}>
									{e.rel}
								</div>
							</div>
						))}
					</>
				) : current && !current.exists ? (
					<Empty title="nav mapes">Šī saknes mape vēl nav izveidota.</Empty>
				) : (
					level("", 0)
				)}
			</div>
		</div>
	);
}
