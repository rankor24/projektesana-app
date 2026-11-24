// Departments (nodaļas) and who may write to whom by default. Node-free: the main process (mail, the roster text, the settings
// handlers) and the window (the conversations tree, the Aģenti page) use the same rules, so the two cannot drift.
//
// Ported from OpenMausBot (Apache-2.0), server/peer-roster.ts: `hasTeamAuthority` (a title, a peer id or a membership is not a
// grant; a department nobody else is in fails closed), `canReach` / `reachRefusal` (the refusal says why and what changes it),
// `reachablePeers` (own department first in the roster). And server/department-grants.ts: a Chief in charge of every department
// is in charge of a new one (here: BPV is in charge of every department but Kvalitāte, with no list to keep up to date).
// Adapted to a design office: one team, one project at a time, the BD process (docs/BD §4, §7.3):
//   - OpenMausBot lets every bot reach every other and uses departments for authority only. Here the department is also the
//     default reach: the own department, BPV, and, for UD, everybody. A cross-department talk is an explicit grant
//     (`mayMessage` / `acceptsFrom`), as the process says: the other section's agreement is asked on purpose, then 3 exchanges
//     and up to BPV (the limits are in core/messages.ts).
//   - A department has a stable id; the name is a label. OpenMausBot names its sections by their text, so a rename has to rewrite
//     every bot and every saved fold; an id makes a rename one field.
//   - Left out: Team Cloud ownership (`botOwner`), audiences (`sameAudience`), hidden bots, the live-roster blocks (a person's
//     phone and a cloud team are not here).
import { LEAD_ID } from "./thread-types.js";
import type { AgentSpec } from "./agent-types.js";

export interface Department {
	id: string;
	name: string;
	/** the department lead (an agent id): assigns inside the department and keeps its memory; absent = BPV does (plan §10). Held and validated here, used by the runner. */
	lead?: string;
}

/** The ids the process names (core/process-def.ts has the same `eks`; this file stays node-free, so it carries its own). */
export const BPV_ID = "bpv";
export const EKS_ID = "eks";
export const UD_ID = "ud";
/** BPV is in charge of every department except this one: the internal ekspertīze reports to the human, not to BPV (docs/BD §4). */
export const KVALITATE_ID = "kvalitate";

/** The departments of docs/BD/openmausbot-adoption-plan.md §4 (decided 2026-11-23), in the order the panel shows them. */
export const DEFAULT_DEPARTMENTS: Department[] = [
	{ id: "vadiba", name: "Vadība" },
	{ id: "arhitektura", name: "Arhitektūra" },
	{ id: "teritorija", name: "Teritorija" },
	{ id: "konstrukcijas", name: "Konstrukcijas" },
	{ id: "inzeniertikli", name: "Inženiertīkli" },
	{ id: "specialas", name: "Speciālās" },
	{ id: "izmaksas", name: "Izmaksas" },
	{ id: KVALITATE_ID, name: "Kvalitāte" },
];

/** Where each BD role agent sits until the user files it elsewhere (§4 table). Keyed by the agent's id: the 16 roles of docs/BD
 *  (BPV, AR, AA, CD, AK, EA, BK, ŪK, AVK, GA, EL, ESS, UD, MEL, TAM, EKS). An agent with another id (the three that ship) is in none. */
export const DEFAULT_DEPARTMENT_OF: Readonly<Record<string, string>> = {
	bpv: "vadiba",
	ar: "arhitektura",
	aa: "teritorija",
	cd: "teritorija",
	mel: "teritorija",
	bk: "konstrukcijas",
	uk: "inzeniertikli",
	avk: "inzeniertikli",
	ga: "inzeniertikli",
	el: "inzeniertikli",
	ess: "inzeniertikli",
	ud: "specialas",
	ak: "specialas",
	ea: "specialas",
	tam: "izmaksas",
	eks: KVALITATE_ID,
};

/** The role number of a team file or skill group («02-arhitekts», `skilli\02-arhitekts`) → the agent id (agent/team-import.ts reads the folder with it). */
export const TEAM_IDS: Readonly<Record<string, string>> = {
	"01": "bpv",
	"02": "ar",
	"03": "aa",
	"04": "cd",
	"05": "ak",
	"06": "ea",
	"07": "bk",
	"08": "uk",
	"09": "avk",
	"10": "ga",
	"11": "el",
	"12": "ess",
	"13": "ud",
	"14": "mel",
	"15": "tam",
	"16": "eks",
};

export const DEPARTMENT_NAME_MAX = 60;
export const DEPARTMENTS_MAX = 40;

/** What the rules read of an agent. */
export type ReachSpec = Pick<AgentSpec, "id" | "department" | "mayMessage" | "acceptsFrom">;

/** The department id of an agent: the one it was filed in, or the default of its id. `undefined` = in none (the three shipped agents, or one the user took out
 *  of its department: `department: ""`). An id no department has is returned as it is: nobody else is in it, so the default reach there is the agent's own,
 *  BPV and UD only, which is the fail-closed case (OpenMausBot's "invalid saved grants fail closed"). */
export function departmentOf(spec: Pick<AgentSpec, "id" | "department">): string | undefined {
	if (spec.department !== undefined) return spec.department.trim() || undefined;
	return DEFAULT_DEPARTMENT_OF[spec.id];
}

/** The department's name for a message to a person; an id with no entry is shown as it is. */
const labelOf = (id: string | undefined, names?: readonly Department[]): string =>
	id === undefined ? "bez nodaļas" : ((names ?? DEFAULT_DEPARTMENTS).find((d) => d.id === id)?.name ?? id);

export type Reach = { ok: true } | { ok: false; why: "list" | "department"; reason: string };

/** May `from` write to `to`? The order is the whole rule, and the first line that decides wins:
 *   1. an explicit list that leaves the other out closes it (`from.mayMessage` without `to`, `to.acceptsFrom` without `from`): a list was always a restriction;
 *   2. an explicit list that names the other opens it, across departments too (the grant of the process's "other section's agreement");
 *   3. the lead (the user's own agent, in no department) writes to and takes from everybody, as it always did;
 *   4. the default by department: see `defaultReach`.
 *  Pure; `canSend` (core/messages.ts) calls it, and so do the roster text and the Aģenti page. `names` is only for the words of the refusal. */
export function mayReach(from: string, to: string, specs: readonly ReachSpec[], names?: readonly Department[]): Reach {
	if (from === to) return { ok: false, why: "department", reason: `Aģents «${from}» nevar sūtīt ziņu pats sev.` };
	const a = specs.find((s) => s.id === from);
	const b = specs.find((s) => s.id === to);
	if (a?.mayMessage && !a.mayMessage.includes(to)) return { ok: false, why: "list", reason: `Aģentam «${from}» nav atļauts sūtīt ziņas aģentam «${to}».` };
	if (b?.acceptsFrom && !b.acceptsFrom.includes(from)) return { ok: false, why: "list", reason: `Aģents «${to}» nepieņem ziņas no aģenta «${from}».` };
	if (a?.mayMessage?.includes(to) || b?.acceptsFrom?.includes(from)) return { ok: true };
	if (from === LEAD_ID || to === LEAD_ID) return { ok: true };
	if (!a || !b) return { ok: false, why: "department", reason: `Nezināms aģents «${a ? to : from}».` };
	return defaultReach(a, b, names);
}

/** The default reach between two agents with no explicit list that decides:
 *   - EKS is independent: it writes to every author but not to BPV, and nobody opens a topic with it (an answer to its own question always gets through, see `canSend`);
 *   - BPV writes to every agent and every agent writes to BPV (it is in charge of every department but Kvalitāte);
 *   - UD writes to every department (it issues requirements to all, docs/BD 00_README step 2), and takes the answers;
 *   - the design disciplines talk across departments directly (docs/BD projektesanas_process §7.3: "aģenti sazinās tieši, ja vajadzīga otras sadaļas
 *     piekrišana vai informācija"): two agents in known departments other than Kvalitāte reach each other; a department is authority (who BPV
 *     manages, roster order), not a wall (Boris, 2026-11-23);
 *   - otherwise only inside one department; a department the list does not know fails closed; two agents in none are the one department
 *     "bez nodaļas", so a team that never set departments works as before. */
function defaultReach(a: ReachSpec, b: ReachSpec, names?: readonly Department[]): Reach {
	if (b.id === EKS_ID) return { ok: false, why: "department", reason: "Ekspertīzes aģentam raksta tikai atbildes uz tā jautājumiem." };
	if (a.id === EKS_ID) return b.id === BPV_ID ? { ok: false, why: "department", reason: "Ekspertīzes aģents nesazinās ar BPV: tas ziņo cilvēkam." } : { ok: true };
	if (a.id === BPV_ID || b.id === BPV_ID || a.id === UD_ID) return { ok: true };
	const da = departmentOf(a);
	const db = departmentOf(b);
	if (da === db) return { ok: true };
	const known = new Set((names ?? DEFAULT_DEPARTMENTS).map((d) => d.id));
	const discipline = (d: string | undefined) => !!d && d !== KVALITATE_ID && known.has(d);
	if (discipline(da) && discipline(db)) return { ok: true };
	return {
		ok: false,
		why: "department",
		reason: `Aģents «${a.id}» (${labelOf(da, names)}) nevar rakstīt aģentam «${b.id}» (${labelOf(db, names)}): savā starpā raksta projektēšanas nodaļu aģenti, BPV un tie, ko lapā Aģenti atļauts (Drīkst rakstīt). Nodod to BPV.`,
	};
}

/** Is `spec` in a department BPV is in charge of? Every one but Kvalitāte, and never the EKS agent whatever it is filed under. The authority of phase C (assigning, retrying,
 *  configuring) reads this; reach above already says BPV may write to all of them. */
export function bpvManages(spec: Pick<AgentSpec, "id" | "department">): boolean {
	return spec.id !== EKS_ID && departmentOf(spec) !== KVALITATE_ID;
}

/** Roster order: the agent's own department first, the rest as they came (OpenMausBot's `reachablePeers`). */
export function ownDepartmentFirst<T extends ReachSpec>(self: ReachSpec, peers: readonly T[]): T[] {
	const own = departmentOf(self);
	return [...peers.filter((p) => departmentOf(p) === own), ...peers.filter((p) => departmentOf(p) !== own)];
}

/** A department id from a name: lower case, no diacritics, letters and digits joined by dashes; `taken` ids get -2, -3, … */
export function newDepartmentId(name: string, taken: readonly string[]): string {
	const base =
		name
			.toLowerCase()
			.normalize("NFD")
			.replace(/[̀-ͯ]/g, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 30) || "nodala";
	let id = base;
	for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
	return id;
}

/** A department list from the window, checked: ids as they are (a new one gets its id here), names 1–60 characters and different, and no department taken out
 *  while an agent is still in it (the user moves the agent first; nothing is moved silently). `specs` is the saved list of agents. */
export function checkDepartments(raw: unknown, specs: readonly Pick<AgentSpec, "id" | "department">[], current: readonly Department[]): { ok: true; list: Department[] } | { ok: false; error: string } {
	if (!Array.isArray(raw)) return { ok: false, error: "Nodaļu saraksts nav derīgs." };
	if (raw.length > DEPARTMENTS_MAX) return { ok: false, error: `Nodaļu var būt līdz ${DEPARTMENTS_MAX}.` };
	const list: Department[] = [];
	for (const r of raw as Partial<Department>[]) {
		const name = typeof r?.name === "string" ? r.name.replace(/\s+/g, " ").trim() : "";
		if (name.length < 1 || name.length > DEPARTMENT_NAME_MAX) return { ok: false, error: `Nodaļas nosaukums: 1–${DEPARTMENT_NAME_MAX} zīmes.` };
		if (list.some((d) => d.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `Nodaļa «${name}» atkārtojas.` };
		const given = typeof r?.id === "string" ? r.id.trim() : "";
		if (given && !/^[a-z0-9-]{1,40}$/.test(given)) return { ok: false, error: `Nodaļas identifikators «${given}» nav derīgs.` };
		if (given && list.some((d) => d.id === given)) return { ok: false, error: `Nodaļas identifikators «${given}» atkārtojas.` };
		// an id that is not in the saved list is a made-up one: the id of a new department comes from its name here
		const id = given && current.some((d) => d.id === given) ? given : newDepartmentId(name, [...list.map((d) => d.id), ...current.map((d) => d.id)]);
		const lead = typeof r?.lead === "string" ? r.lead.trim() : "";
		list.push(lead ? { id, name, lead } : { id, name });
	}
	// a lead is an agent of the saved list that is filed in that department (the user moves an agent first, then makes it the lead)
	for (const d of list) {
		if (!d.lead) continue;
		const who = specs.find((s) => s.id === d.lead);
		if (!who) return { ok: false, error: `Nodaļas «${d.name}» vadītājs: nezināms aģents ${d.lead}.` };
		if (departmentOf(who) !== d.id) return { ok: false, error: `Nodaļas «${d.name}» vadītājam ${d.lead} jābūt šajā nodaļā.` };
	}
	for (const gone of current.filter((d) => !list.some((x) => x.id === d.id))) {
		const inside = specs.filter((s) => departmentOf(s) === gone.id).map((s) => s.id);
		if (inside.length) return { ok: false, error: `Nodaļa «${gone.name}» nav tukša (${inside.join(", ")}): vispirms pārvieto aģentus.` };
	}
	return { ok: true, list };
}
