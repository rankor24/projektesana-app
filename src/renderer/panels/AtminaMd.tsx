// Atmiņa → Aģentu atmiņa: the agents' plain-Markdown memory (office, departments, agents), what agents changed in themselves with an Undo,
// and the problems with the app itself that agents reported. Three sections of one page:
//   1. every memory file: who keeps it (the only agent that writes it), how much of it a run starts with, and an editor — the user may
//      edit any file; a save that would cover a write an agent made meanwhile is refused (the page sends the hash it read);
//   2. the journal of agents' own changes (memory, role text, skill drafts) with the text before and after, and Atsaukt;
//   3. the app problem log (report_app_issue): open / fixed, copy to clipboard for pasting into a fix request.
// The files themselves are plain Markdown in <app data>\memory, so they open in any editor too (agent/memory-md.ts).
import { useState } from "react";
import type { AppIssue, MemoryFileInfo, MemoryFileText, MemoryKind, SelfChange } from "../../shared/memory-types";
import { call, errText } from "../bridge";
import { Badge, Empty, Err, useLoad } from "../ui";
import { locale, tr } from "../i18n";

const KIND: Record<MemoryKind, string> = { office: tr("Birojs"), department: tr("Nodaļas"), agent: tr("Aģenti") };
const CHANGE_KIND: Record<SelfChange["kind"], string> = { memory: tr("atmiņa"), role: tr("loma"), skill: tr("prasme") };

const when = (iso: string) => new Date(iso).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });

/** Text to the clipboard; a textarea and the old command when the clipboard API is refused. */
async function copy(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const t = document.createElement("textarea");
		t.value = text;
		document.body.appendChild(t);
		t.select();
		document.execCommand("copy");
		t.remove();
	}
}

export function AgentMemory() {
	return (
		<>
			<MemoryFiles />
			<Changes />
			<Issues />
		</>
	);
}

function MemoryFiles() {
	const files = useLoad<MemoryFileInfo[]>(() => call("memoryMd.list"), []);
	const [open, setOpen] = useState<{ kind: MemoryKind; id: string } | null>(null);
	return (
		<section className="amd-section">
			<h3>{tr("Markdown atmiņa")}</h3>
			<div className="dim small">{tr("Vienkārši Markdown faili mapē memory. Katru failu raksta tikai viens aģents (turētājs); tu vari rediģēt jebkuru. Aģents starta brīdī saņem biroja, savas nodaļas un savu atmiņu (jaunākais un visvairāk lietotais vispirms); nodaļas atmiņa uzvar pretrunā.")}</div>
			{files.error ? <Err error={files.error} /> : null}
			{(["office", "department", "agent"] as MemoryKind[]).map((k) => (
				<div key={k} className="amd-group">
					<div className="dim small amd-head">{KIND[k]}</div>
					{(files.data ?? []).filter((f) => f.kind === k).map((f) => (
						<div key={`${f.kind}/${f.id}`}>
						<div className={`amd-row ${open?.kind === f.kind && open.id === f.id ? "on" : ""}`}>
							<span className="amd-name" title={f.id}>{f.label}</span>
							<Badge tone="dim" title={tr("Vienīgais aģents, kas raksta šo failu")}>{tr("raksta:")} {f.keeper}</Badge>
							<Gauge f={f} />
							<span className="grow" />
							<button className="small" onClick={() => setOpen(open?.kind === f.kind && open.id === f.id ? null : { kind: f.kind, id: f.id })}>{f.exists ? tr("Atvērt") : tr("Izveidot")}</button>
						</div>
						{open?.kind === f.kind && open.id === f.id && <Editor key={`${f.kind}/${f.id}`} kind={f.kind} id={f.id} onSaved={files.reload} onClose={() => setOpen(null)} />}
						</div>
					))}
				</div>
			))}
		</section>
	);
}

/** How much of the file a run starts with: loaded of the file's characters. Amber when part of it waits for memory_read. */
function Gauge({ f }: { f: MemoryFileInfo }) {
	if (!f.exists) return <span className="dim small">{tr("nav faila")}</span>;
	const cut = f.loaded < f.chars;
	return (
		<span className={`small ${cut ? "amd-cut" : "dim"}`} title={tr("Zīmes, ko aģents saņem starta brīdī, no visām faila zīmēm; pārējo viņš lasa ar memory_read")}>
			{tr("ielādē {loaded} no {chars} zīmēm", { loaded: f.loaded, chars: f.chars })}
		</span>
	);
}

function Editor({ kind, id, onSaved, onClose }: { kind: MemoryKind; id: string; onSaved: () => void; onClose: () => void }) {
	const doc = useLoad<MemoryFileText>(() => call("memoryMd.read", kind, id), [kind, id]);
	const [text, setText] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const shown = text ?? doc.data?.text ?? "";
	const save = () =>
		call("memoryMd.write", kind, id, shown, doc.data?.hash ?? "")
			.then(() => (setText(null), setErr(null), doc.reload(), onSaved()))
			.catch((e) => setErr(errText(e)));
	return (
		<div className="amd-editor">
			{doc.error ? <Err error={doc.error} /> : null}
			<textarea className="mono" rows={12} value={shown} placeholder={tr("- 2026-11-23 · ieraksts (katrs ieraksts savā rindā ar domuzīmi)")} onChange={(e) => setText(e.target.value)} />
			{err && <div className="err">{err}</div>}
			<div className="row">
				<span className="dim small grow">{tr("Saglabājot, iepriekšējais teksts paliek versijās un izmaiņu sarakstā zemāk.")}</span>
				<button className="small ghost" onClick={onClose}>{tr("Aizvērt")}</button>
				<button className="small" disabled={text === null} onClick={() => (setText(null), setErr(null))}>{tr("Atcelt izmaiņas")}</button>
				<button className="small primary" disabled={text === null} onClick={save}>{tr("Saglabāt")}</button>
			</div>
		</div>
	);
}

function Changes() {
	const list = useLoad<SelfChange[]>(() => call("selfChanges.list"), []);
	const [err, setErr] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);
	const undo = (c: SelfChange) => {
		if (!confirm(tr("Atsaukt šo izmaiņu? Pašreizējais teksts paliek versijās."))) return;
		call("selfChanges.undo", c.id)
			.then((r) => (setErr(null), setDone(r), list.reload()))
			.catch((e) => (setDone(null), setErr(errText(e))));
	};
	return (
		<section className="amd-section">
			<h3>{tr("Aģentu izmaiņas sevī")}</h3>
			<div className="dim small">{tr("Ko aģenti mainījuši savā atmiņā, lomā un prasmju melnrakstos, ar tekstu pirms un pēc. Jauna prasme ir melnraksts, līdz to atzīmē kā pārbaudītu Prasmēs.")}</div>
			{err && <div className="err">{err}</div>}
			{done && <div className="small" style={{ color: "var(--ok)" }}>{done}</div>}
			{list.error ? <Err error={list.error} /> : null}
			{!list.loading && (list.data ?? []).length === 0 && <Empty title={tr("no data")}>{tr("Aģenti vēl nav mainījuši neko sevī.")}</Empty>}
			{(list.data ?? []).slice(0, 80).map((c) => (
				<div key={c.id} className={`text-page amd-change ${c.undone ? "undone" : ""}`}>
					<div className="row">
						<Badge>{CHANGE_KIND[c.kind]}</Badge>
						<b className="grow">{c.target}</b>
						<Badge tone="info">{c.by === "user" ? tr("lietotājs") : c.agent || tr("aģents")}</Badge>
						<span className="dim small">{when(c.at)}</span>
						{c.undone ? <Badge tone="dim" title={c.undoneAt ? when(c.undoneAt) : undefined}>{tr("atsaukts")}</Badge> : <button className="small" onClick={() => undo(c)}>{tr("Atsaukt")}</button>}
					</div>
					{c.reason && <div className="small dim">{c.reason}</div>}
					<details>
						<summary className="dim small">{tr("Pirms un pēc")}</summary>
						<div className="amd-diff">
							<div>
								<div className="dim small">{tr("Pirms")}</div>
								<pre>{c.before ?? tr("(nebija)")}</pre>
							</div>
							<div>
								<div className="dim small">{tr("Pēc")}</div>
								<pre>{c.after}</pre>
							</div>
						</div>
					</details>
				</div>
			))}
		</section>
	);
}

const issueText = (i: AppIssue) => `Lietotnes problēma: ${i.title}\nKur: ${i.where || "—"}\nAģents: ${i.agent || "—"} · ${when(i.at)}\n\n${i.details}`;

function Issues() {
	const list = useLoad<AppIssue[]>(() => call("appIssues.list"), []);
	const [all, setAll] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const rows = (list.data ?? []).filter((i) => all || i.status === "open");
	const open = (list.data ?? []).filter((i) => i.status === "open");
	const flag = (i: AppIssue) =>
		call("appIssues.setStatus", i.id, i.status === "open" ? "fixed" : "open")
			.then(() => (setErr(null), list.reload()))
			.catch((e) => setErr(errText(e)));
	const doCopy = (id: string, text: string) => void copy(text).then(() => (setCopied(id), setTimeout(() => setCopied(null), 1500)));
	return (
		<section className="amd-section">
			<h3>{tr("Lietotnes problēmas")}</h3>
			<div className="dim small">{tr("Ko aģenti ziņojuši par pašu lietotni (trūkst rīka, nepareizs nolasījums, avārija) ar report_app_issue; projekta piezīmēs tas neiekļūst.")}</div>
			<div className="row">
				<button className={!all ? "primary" : ""} onClick={() => setAll(false)}>{tr("Atvērtās")} ({open.length})</button>
				<button className={all ? "primary" : ""} onClick={() => setAll(true)}>{tr("Visas")} ({(list.data ?? []).length})</button>
				<span className="grow" />
				<button className="small" disabled={open.length === 0} onClick={() => doCopy("*", open.map(issueText).join("\n\n---\n\n"))}>{copied === "*" ? tr("Nokopēts") : tr("Kopēt visas atvērtās")}</button>
			</div>
			{err && <div className="err">{err}</div>}
			{list.error ? <Err error={list.error} /> : null}
			{!list.loading && rows.length === 0 && <Empty title={tr("no data")}>{all ? tr("Neviens aģents vēl nav ziņojis par lietotnes problēmu.") : tr("Atvērtu problēmu nav.")}</Empty>}
			{rows.map((i) => (
				<div key={i.id} className="text-page amd-issue">
					<div className="row">
						<Badge tone={i.status === "open" ? "warn" : "ok"}>{i.status === "open" ? tr("atvērta") : tr("izlabota")}</Badge>
						<b className="grow">{i.title}</b>
						<span className="dim small">{i.agent} · {when(i.at)}</span>
					</div>
					{i.where && <div className="small dim">{tr("Kur:")} {i.where}</div>}
					{i.details}
					<div className="row" style={{ marginTop: 6 }}>
						<span className="grow" />
						<button className="small" onClick={() => doCopy(i.id, issueText(i))}>{copied === i.id ? tr("Nokopēts") : tr("Kopēt")}</button>
						<button className="small" onClick={() => flag(i)}>{i.status === "open" ? tr("Atzīmēt kā izlabotu") : tr("Atvērt no jauna")}</button>
					</div>
				</div>
			))}
		</section>
	);
}
