// What the person is told when a provider is on hold, in one sentence of the chat's own language (the agents' text is Latvian; so is this line).
//
// Ported from OpenMausBot (Apache-2.0) server/limit-notices.ts: limitNoticeText ("Codex reached its limit until 14:00, so Kai is using Claude
// meanwhile." / "…so Kai waits: no backup you chose can take over.") and signedOutNoticeText, and server/limit-failover.ts resetClock.
// Adapted: the sentence names the agent, and says whether the run already carries on (retried on the backup), whether the next runs do (the run itself failed),
// or that nothing can (no backup chosen, or none usable).
import type { HoldScope } from "./classify.js";

/** "14:00", or "ot., 14:00" when the reset is not today. */
export function resetClock(at: number, now = Date.now()): string {
	try {
		const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
		return new Date(at).toLocaleString("lv-LV", { ...(sameDay ? {} : { weekday: "short", day: "numeric", month: "short" }), hour: "2-digit", minute: "2-digit" });
	} catch {
		return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
	}
}

export type Carry =
	/** this run is on the backup now (it started there, or was tried again there) */
	| "now"
	/** this run failed; the agent's next runs start on the backup */
	| "next"
	/** no backup can take over */
	| "none";

export interface NoticeFacts {
	/** the held provider (and model, for a model's own limit), as the person knows it */
	from: string;
	agent: string;
	scope: HoldScope;
	resetsAt?: number;
	/** the provider that carries on */
	to?: string;
	carry: Carry;
	now?: number;
}

export function holdNotice(f: NoticeFacts): string {
	const until = f.resetsAt ? ` līdz ${resetClock(f.resetsAt, f.now)}` : "";
	const what =
		f.scope === "signed-out" ? `${f.from} pieteikšanās ir beigusies`
		: f.scope === "credits" ? `${f.from}: kredīti ir iztērēti`
		: `${f.from} sasniedza lietojuma limitu${until}`;
	const fix = f.scope === "signed-out" ? " Pieslēdzies vēlreiz: Iestatījumi → Aģents." : "";
	const meanwhile = f.scope === "signed-out" ? "tikmēr" : f.resetsAt && f.scope !== "credits" ? "līdz tam" : "tikmēr";
	if (f.carry === "now" && f.to) return `${what}, tāpēc «${f.agent}» ${meanwhile} strādā ar ${f.to}.${fix}`;
	if (f.carry === "next" && f.to) return `${what}, tāpēc «${f.agent}» turpmāk ${meanwhile} strādā ar ${f.to}. Nosūti ziņu vēlreiz.${fix}`;
	return `${what}, tāpēc «${f.agent}» gaida: nav izvēlēta rezerves AI, kas varētu pārņemt (Iestatījumi → Aģents → Rezerves AI).${fix}`;
}
