// The annotation view's shared pieces (task 8.2): the pins of the open file, numbered in the order they were made (so a
// dot's number never changes when another pin closes), listed beside the view with the open ones first. One list for the
// PDF view and the 3D view; a click on a row is the view's business (jump to the page, fly to the element).
import { useMemo } from "react";
import type { Pin } from "../../core/model";
import { call, errText } from "../bridge";
import { listOrder, numbered, type NumberedPin } from "../../shared/pins-view";
import { Badge, useLoad } from "../ui";

export type { NumberedPin };

/** The project's pins that belong to the open file, numbered by creation time. */
export function useFilePins(projectId: string, belongs: (p: Pin) => boolean): { items: NumberedPin[]; all: Pin[]; reload: () => void; error: unknown } {
	const pins = useLoad<Pin[]>(() => call("pins.list", projectId), [projectId]);
	const items = useMemo(() => numbered((pins.data ?? []).filter(belongs)), [pins.data, belongs]);
	return { items, all: pins.data ?? [], reload: pins.reload, error: pins.error };
}

export function PinPanel({ projectId, items, activeId, onSelect, onChanged, onError, footer }: { projectId: string; items: NumberedPin[]; activeId: string | null; onSelect: (p: Pin) => void; onChanged: () => void; onError: (m: string) => void; footer?: React.ReactNode }) {
	const act = (f: () => Promise<unknown>) => f().then(onChanged).catch((e) => onError(errText(e)));
	const open = items.filter((x) => x.pin.state !== "closed").length;
	return (
		<aside className="pin-panel">
			<div className="pin-head">
				<b>Piezīmes</b>
				<span className="dim small">
					{open} atvērtas no {items.length}
				</span>
			</div>
			{items.length === 0 && <div className="dim small" style={{ padding: 10 }}>no data: šim failam piezīmju nav.</div>}
			<div className="pin-list">
				{listOrder(items).map(({ pin, n }) => {
					const last = pin.comments.at(-1);
					return (
						<div key={pin.id} className={`pin-row ${activeId === pin.id ? "active" : ""} ${pin.state === "closed" ? "closed" : ""}`} onClick={() => onSelect(pin)}>
							<span className={`pin-n ${pin.state}`}>{n}</span>
							<div className="pin-body">
								<div>{pin.text}</div>
								<div className="small">
									<Badge tone={pin.state === "open" ? "warn" : pin.state === "resolved" ? "info" : "dim"}>{pin.state === "open" ? "atvērta" : pin.state === "resolved" ? "gaida tevi" : "aizvērta"}</Badge>{" "}
									<span className="dim">{pin.by === "agent" ? "aģents" : "tu"}{pin.comments.length ? ` · ${pin.comments.length} komentāri` : ""}</span>
								</div>
								{last && (
									<div className="small dim" style={{ marginTop: 2 }}>
										{last.by === "agent" ? "aģents" : "tu"}: {last.text}
									</div>
								)}
								<div className="pin-actions">
									{pin.state !== "closed" ? (
										<button className="small" title="Piezīmi aizver tikai tu" onClick={(e) => (e.stopPropagation(), act(() => call("pins.close", projectId, pin.id)))}>
											Aizvērt
										</button>
									) : (
										<button className="small ghost" onClick={(e) => (e.stopPropagation(), act(() => call("pins.reopen", projectId, pin.id)))}>
											Atvērt vēlreiz
										</button>
									)}
									{pin.state === "resolved" && (
										<button className="small ghost" onClick={(e) => (e.stopPropagation(), act(() => call("pins.reopen", projectId, pin.id)))}>
											Nav labi
										</button>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>
			{footer}
		</aside>
	);
}
