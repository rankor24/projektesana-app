// The card that floats by the quote (task 9.7): the proposed value, Apstiprināt / Noraidīt / Ierakstīt pats, the key's other
// values, ◀ ▶ through the waiting proposals (Enter confirms, Delete rejects). The source PDF opens at the cited page with the
// quote marked (PdfView). A value is never confirmed without its quote on screen: the buttons stay off until the cited page is the
// one shown (shared/fact-review.ts confirmProblem).
import { useEffect, useMemo, useState } from "react";
import type { Fact, Source } from "../../core/model";
import { afterDecision, confirmProblem, keyAction, othersFor, position, reviewQueue, step, type ReviewItem } from "../../shared/fact-review";
import { PROFILE_LABEL } from "../../shared/dashboard";
import { call, errText } from "../bridge";
import { factReview, useFactReview } from "../fact-review";
import { ui, useUi } from "../state";
import { useLoad } from "../ui";

const labelOf = (key: string) => PROFILE_LABEL[key.replace(/^profile\./, "") as keyof typeof PROFILE_LABEL] ?? key;

export function FactCard() {
	const r = useFactReview();
	const { view } = useUi();
	const facts = useLoad<Fact[]>(() => (r.projectId && r.current !== null ? call("facts.list", r.projectId) : Promise.resolve([])), [r.projectId, r.current !== null]);
	const sources = useLoad<Source[]>(() => (r.projectId && r.current !== null ? call("sources.list", r.projectId) : Promise.resolve([])), [r.projectId, r.current !== null]);
	const [own, setOwn] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const [queue, setQueue] = useState<ReviewItem[]>([]);
	const live = useMemo(() => reviewQueue(facts.data ?? [], labelOf), [facts.data]);

	// the walk is the waiting proposals as they are when the review starts; a decided fact leaves it (afterDecision)
	useEffect(() => {
		if (r.current === null) return setQueue([]);
		setQueue((q) => (q.length === 0 || r.current === "" ? live : q.filter((i) => live.some((l) => l.factId === i.factId))));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [live, r.current === null]);

	// "" = start at the first (or at the fact the review was started from)
	useEffect(() => {
		if (r.current === "" && queue.length) factReview.go(queue.find((i) => i.factId === r.startedAt)?.factId ?? queue[0].factId);
		else if (r.current === "" && live.length === 0 && facts.data) factReview.stop();
	}, [r.current, queue, live.length, facts.data, r.startedAt]);

	const item = queue.find((i) => i.factId === r.current) ?? null;
	// the source opens at the cited page with the quote marked
	useEffect(() => {
		if (!item) return;
		setErr(null);
		setOwn("");
		ui.show({ kind: "source", sourceId: item.sourceId, page: item.page, quote: item.quote });
	}, [item?.factId]); // eslint-disable-line react-hooks/exhaustive-deps

	const shown = view.kind === "source" || view.kind === "ifc" ? { sourceId: view.sourceId ?? null, page: view.page ?? null } : null;
	const problem = confirmProblem(item, shown, item?.factId ?? null);

	const decide = (id: string, state: "confirmed" | "rejected") => {
		if (!r.projectId) return;
		call("facts.decide", r.projectId, id, state)
			.then(() => {
				const a = afterDecision(queue, id);
				setQueue(a.queue);
				facts.reload();
				ui.bump();
				if (a.next) factReview.go(a.next.factId);
				else factReview.stop();
			})
			.catch((e) => setErr(errText(e)));
	};
	const confirm = () => item && !problem && decide(item.factId, "confirmed");
	const reject = () => item && decide(item.factId, "rejected");
	const writeOwn = () => {
		if (!item || !r.projectId || !own.trim()) return;
		call("facts.setByUser", r.projectId, item.key, own.trim())
			.then(() => {
				// his own value is the answer for this key: the proposal is set aside
				decide(item.factId, "rejected");
			})
			.catch((e) => setErr(errText(e)));
	};
	const go = (dir: 1 | -1) => {
		const n = step(queue, item?.factId ?? null, dir);
		if (n) factReview.go(n.factId);
	};

	useEffect(() => {
		if (!item) return;
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
			const a = keyAction(e, typing);
			if (!a) return;
			e.preventDefault();
			if (a === "confirm") confirm();
			else if (a === "reject") reject();
			else go(a === "next" ? 1 : -1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	if (!item) return null;
	const others = othersFor(facts.data ?? [], item);
	const srcTitle = sources.data?.find((s) => s.id === item.sourceId)?.title ?? item.sourceId;
	return (
		<div className="fact-card">
			<div className="row">
				<b>{item.label}</b>
				<span className="dim small">{position(queue, item.factId)}</span>
				<span className="grow" />
				<button className="ghost small" title="Iepriekšējais (←)" onClick={() => go(-1)} disabled={!step(queue, item.factId, -1)}>◀</button>
				<button className="ghost small" title="Nākamais (→)" onClick={() => go(1)} disabled={!step(queue, item.factId, 1)}>▶</button>
				<button className="ghost small" title="Beigt pārskatu" onClick={() => factReview.stop()}>×</button>
			</div>
			<div className="fact-value">{item.value}</div>
			<div className="small dim">
				{srcTitle}, lpp. {item.page} · {item.by === "agent" ? "aģenta priekšlikums" : item.by}
			</div>
			<div className="quote small">{item.quote}</div>
			<div className="small dim">{r.found === "whole" ? "Citāts ir iezīmēts lapā." : r.found === "start" ? "Lapā iezīmēts citāta sākums (rindas sadalītas citādi)." : "Citāts lapā nav atrasts (skenēta lapa?): lasi to šeit."}</div>
			{problem && <div className="err small">{problem}</div>}
			{err && <div className="err small">{err}</div>}
			<div className="row">
				<button className="primary" disabled={!!problem} title="Enter" onClick={confirm}>Apstiprināt</button>
				<button title="Delete" onClick={reject}>Noraidīt</button>
			</div>
			<div className="row">
				<input className="grow" placeholder="ierakstīt pats…" value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => e.key === "Enter" && writeOwn()} />
				<button className="small" disabled={!own.trim()} onClick={writeOwn}>Saglabāt</button>
			</div>
			{others.length > 0 && (
				<div className="small">
					<div className="dim">Citas vērtības šim laukam:</div>
					{others.map((o) => {
						const inWalk = queue.find((q) => q.factId === o.id);
						return (
							<div key={o.id} className="row">
								<span className="grow">
									{o.value} <span className="dim">· {o.state === "confirmed" ? "apstiprināts" : o.state === "proposed" ? "priekšlikums" : o.state}</span>
								</span>
								{inWalk && (
									<button className="small ghost" onClick={() => factReview.go(o.id)}>
										pārskatīt
									</button>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
