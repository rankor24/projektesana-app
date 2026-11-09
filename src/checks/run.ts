// Runs the checks subscribed to an event and turns their results into findings.
// - a new result → an open finding; the same result next time updates it (key = check id + result key);
// - a finding whose result is gone → closed (fixed);
// - an overridden finding stays overridden while its check still fails: the override records the user's reason and never
//   changes the check (the next run still produces the result, it just does not reopen it);
// - requirements a check covers get status failed / met (justified rows keep their status).
import { newId, USER_LABEL, type Finding, type Requirement, type Who } from "../core/model.js";
import type { ProjectStore } from "../core/store.js";
import { checksFor, getCheck, type CheckContext, type CheckEvent, type CheckResult } from "./registry.js";

export interface RunSummary {
	ran: string[];
	results: number;
	open: number;
	failedChecks: { id: string; error: string }[];
	skipped: { id: string; reason: string }[];
}

/** An info note the user removed: the same result (key and message) is not raised again; a different message is. */
export interface Dismissed {
	key: string;
	message: string;
	at: string;
}

export async function runChecks(store: ProjectStore, event: CheckEvent, opts: Omit<CheckContext, "store"> & { only?: string[] }): Promise<RunSummary> {
	const list = opts.only ? opts.only.map((id) => getCheck(id)).filter((c): c is NonNullable<typeof c> => !!c) : checksFor(event);
	const ctx: CheckContext = { ...opts, store };
	const now = new Date().toISOString();
	const produced = new Map<string, { checkId: string; r: CheckResult }>();
	const ran: string[] = [];
	const failedChecks: RunSummary["failedChecks"] = [];
	const skipped: RunSummary["skipped"] = [];
	const met = new Set<string>();
	const failedReq = new Set<string>();
	const dismissed = new Map(store.readMeta<Dismissed[]>("dismissed", []).map((x) => [x.key, x.message]));
	for (const c of list) {
		try {
			const out = await c.run(ctx);
			if (out.skipped) {
				skipped.push({ id: c.id, reason: out.skipped });
				continue;
			}
			ran.push(c.id);
			for (const r of out.results) {
				if (r.severity === "info" && dismissed.get(`${c.id}:${r.key}`) === r.message) continue;
				produced.set(`${c.id}:${r.key}`, { checkId: c.id, r });
				if (r.requirementId) failedReq.add(r.requirementId);
			}
			for (const m of out.met ?? []) met.add(m);
		} catch (e) {
			// a check that crashes is itself a finding: it must never look like "all fine"
			failedChecks.push({ id: c.id, error: (e as Error).message });
			produced.set(`${c.id}:__error`, { checkId: c.id, r: { key: "__error", severity: "error", message: `Pārbaude neizdevās: ${(e as Error).message}`, where: {} } });
			ran.push(c.id);
		}
	}
	const ranSet = new Set(ran);
	const prev = store.read("findings");
	const next: Finding[] = [];
	const seen = new Set<string>();
	for (const f of prev) {
		const p = produced.get(f.key);
		if (p) {
			seen.add(f.key);
			const reopened = f.state === "closed";
			next.push({ ...f, severity: p.r.severity, message: p.r.message, where: p.r.where, requirementId: p.r.requirementId ?? null, lastSeen: now, state: reopened ? "open" : f.state });
		} else if (ranSet.has(f.checkId) && f.state !== "closed") {
			// the check ran and no longer finds it: fixed
			next.push({ ...f, state: "closed", lastSeen: now });
		} else next.push(f);
	}
	for (const [key, p] of produced) {
		if (seen.has(key)) continue;
		next.push({ id: newId("x"), checkId: p.checkId, requirementId: p.r.requirementId ?? null, severity: p.r.severity, where: p.r.where, message: p.r.message, key, state: "open", firstSeen: now, lastSeen: now });
	}
	if (JSON.stringify(prev) !== JSON.stringify(next)) store.write("findings", next, { kind: "checks.ran", by: "app", data: { event, ran, results: produced.size } });

	if (met.size || failedReq.size) {
		const reqs = store.read("requirements");
		const upd: Requirement[] = reqs.map((r) => {
			if (r.status === "justified") return r;
			if (failedReq.has(r.id)) return { ...r, status: "failed" };
			if (met.has(r.id)) return { ...r, status: "met" };
			return r;
		});
		if (JSON.stringify(upd) !== JSON.stringify(reqs)) store.write("requirements", upd, { kind: "requirements.status", by: "app", data: { met: met.size, failed: failedReq.size } });
	}
	return { ran, results: produced.size, open: next.filter((f) => f.state === "open").length, failedChecks, skipped };
}

/** The user keeps a finding open no longer: the reason (and their name, if set) is recorded; the check is not changed. */
export function overrideFinding(store: ProjectStore, findingId: string, reason: string, by: Who = "user", name?: string): void {
	if (by !== "user") throw new Error("Atradumu pieņemt var tikai lietotājs, ne aģents.");
	if (reason.trim().length < 5) throw new Error("Pamatojums ir obligāts.");
	store.update(
		"findings",
		(all) => {
			const f = all.find((x) => x.id === findingId);
			if (!f) throw new Error(`Atradums ${findingId} nav atrasts.`);
			return all.map((x) => (x.id === findingId ? { ...x, state: "overridden" as const, decision: { by, ...(name ? { name } : {}), at: new Date().toISOString(), reason: reason.trim() }, proposal: undefined } : x));
		},
		{ kind: "finding.overridden", by, data: { findingId } },
	);
	const f = store.read("findings").find((x) => x.id === findingId)!;
	if (f.requirementId)
		store.update("requirements", (all) => all.map((r) => (r.id === f.requirementId ? { ...r, status: "justified" as const, evidence: [...r.evidence, `${name || USER_LABEL}: ${reason.trim()}`] } : r)), { kind: "requirement.justified", by, data: { id: f.requirementId } });
}

/** The user removes a finding that blocks nothing: an info note, a topic imported from BCF, or one already closed.
 *  An error or a warning stays until it is fixed or accepted with a reason. A removed info note is remembered by key and
 *  message: the same result is not raised again, new values (a different message) are. The log and versions\ keep it. */
export function removeFinding(store: ProjectStore, findingId: string, by: Who = "user"): void {
	if (by !== "user") throw new Error("Atradumu noņemt var tikai lietotājs, ne aģents.");
	const f = store.read("findings").find((x) => x.id === findingId);
	if (!f) throw new Error(`Atradums ${findingId} nav atrasts.`);
	if (!(f.severity === "info" || f.checkId === "bcf" || f.state === "closed")) throw new Error("Kļūdu vai brīdinājumu noņemt nevar: novērs cēloni vai pieņem to ar pamatojumu.");
	if (f.severity === "info" && f.state !== "closed" && f.checkId !== "bcf") {
		const list = store.readMeta<Dismissed[]>("dismissed", []).filter((x) => x.key !== f.key);
		store.writeMeta("dismissed", [...list, { key: f.key, message: f.message, at: new Date().toISOString() }]);
	}
	store.update("findings", (all) => all.filter((x) => x.id !== findingId), { kind: "finding.removed", by, data: { findingId, key: f.key, severity: f.severity } });
}

export function reopenFinding(store: ProjectStore, findingId: string): void {
	store.update("findings", (all) => all.map((x) => (x.id === findingId ? { ...x, state: "open" as const, decision: undefined } : x)), { kind: "finding.reopened", by: "user", data: { findingId } });
}

export const openFindings = (store: ProjectStore) => store.read("findings").filter((f) => f.state === "open").length;
