// Process mode per project (task 14.2): the mode switch and the profile. The rules live in core/process.ts; this file reads the agents that
// exist (Iestatījumi → Aģenti), calls them as the user and tells the renderer to refresh.
// 14.7: the user's client change (a note and a message to bpv) and the learning round after H7 (a task to each agent of the profile, then "Pabeigt").
import type { SystemPost } from "../../agent/coordinator.js";
import type { Note } from "../../core/model.js";
import { type ProcessState, decideGate, changeProfile, finishLearning, learnRefusal, readProcess, recordClientChange, switchMode } from "../../core/process.js";
import { EKS, GATE_OF, LEADER } from "../../core/process-def.js";
import { exportDir, exportRegisters } from "../../core/registers.js";
import type { Registry } from "../../core/registry.js";
import type { Handlers } from "../../shared/api.js";
import { LEAD_ID } from "../../shared/thread-types.js";
import type { AppSettings } from "../settings.js";

type K = "process.get" | "process.setMode" | "process.setProfile" | "process.gate" | "process.export" | "process.change" | "process.learn" | "process.finish";

/** What the app asks of each agent after H7. The lessons come back as proposals to the office memory, so no client's name or address may be in them. */
export const ASK_LESSONS = "Ieraksti šī projekta mācības biroja atmiņā (write_note scope birojs, type learning). Bez klientu vārdiem un adresēm.";

/** The part of the agent session these handlers use: told when a gate was decided, and the app's own messages to agents. */
export interface ProcessSession {
	notesChanged(): void;
	postSystem?(projectId: string | null, items: readonly SystemPost[], o?: { once?: boolean }): { to: string }[];
}

/** After the user decides a gate, the leader of the stage the process is in now hears it as a system ask from the lead (R48): "<Hx> apstiprināts, stadija <S>." or "<Hx> atgriezts: <comment>",
 *  in its newest open thread of the project (one is made only when it has none), not in a new thread for every decision.
 *  Nothing is posted for S5 (eks leads it and only the user opens its thread: Gaida tevi carries a line for that), after H7 (the learning round is the user's button), or for a return
 *  that escalated the stage (nobody but the user may act on it). A post that fails does not undo the decision: the leader reads the new stage in its status text at its next run. */
function tellLeader(session: ProcessSession | undefined, projectId: string, before: ProcessState | null, after: ProcessState, d: { approve: boolean; comment?: string }): void {
	if (!session?.postSystem || !before || before.stage === "mācības" || before.stage === "done") return;
	if (after.stage === "mācības" || after.stage === "done") return;
	const to = LEADER[after.stage];
	if (to === EKS || (!d.approve && after.escalated)) return;
	const gate = GATE_OF[before.stage];
	const comment = (d.comment ?? "").trim();
	const text = d.approve ? `${gate} apstiprināts, stadija ${after.stage}.${comment ? ` Komentārs: ${comment}` : ""}` : `${gate} atgriezts: ${comment}`;
	try {
		session.postSystem(projectId, [{ from: LEAD_ID, to, kind: "ask", toOpen: true, title: `Gate ${gate}: ${d.approve ? "apstiprināts" : "atgriezts"}`, text }]);
	} catch {
		// the decision is written; the leader finds it in the status text
	}
}

export function processHandlers(d: { registry: Registry; settings: AppSettings; emit: (e: "data.changed", p: { projectId: string | null; what: string[] }) => void; /** the agent session: told when a gate was decided, so "Gaida tevi" is sent again */ session?: ProcessSession }): Pick<Handlers, K> {
	const existing = () => d.settings.agentSpecs().specs.map((s) => s.id);
	// a call that changed nothing announces nothing
	const changed = (id: string, before: ProcessState | null, after: ProcessState) => {
		if (JSON.stringify(before) !== JSON.stringify(after)) d.emit("data.changed", { projectId: id, what: ["process"] });
	};
	return {
		"process.get": (id) => readProcess(d.registry.store(id)),
		"process.setMode": (id, mode) => {
			const store = d.registry.store(id);
			const before = readProcess(store);
			const s = switchMode(store, mode, existing(), "user");
			changed(id, before, s);
			d.session?.notesChanged();
			return s;
		},
		"process.setProfile": (id, p) => {
			const store = d.registry.store(id);
			const before = readProcess(store);
			const s = changeProfile(store, p, existing(), "user");
			changed(id, before, s);
			d.session?.notesChanged();
			return s;
		},
		// the user only: no agent tool calls decideGate
		"process.gate": (id, decision) => {
			const store = d.registry.store(id);
			const before = readProcess(store);
			const s = decideGate(store, decision, new Date());
			changed(id, before, s);
			d.session?.notesChanged();
			tellLeader(d.session, id, before, s, decision);
			return s;
		},
		// the registers as files in <project data>/export/00_vadiba, from the state as it is now; the generated copy, nothing is read back from it
		"process.export": (id) => {
			const store = d.registry.store(id);
			const s = readProcess(store);
			if (!s) throw new Error("Procesa režīms nav ieslēgts.");
			return exportRegisters(store, exportDir(store), s);
		},
		// the user records what the client asked for: a `change` note, and bpv is asked to judge its impact (it applies the result with process_change_impact)
		"process.change": (id, text): Note => {
			const post = d.session?.postSystem;
			if (!post) throw new Error("Aģentu sesija nav pieejama.");
			const store = d.registry.store(id);
			const note = recordClientChange(store, text);
			d.emit("data.changed", { projectId: id, what: ["notes"] });
			d.session?.notesChanged();
			const title = `Izmaiņa: ${note.body.replace(/\s+/g, " ").slice(0, 60)}`;
			// "user" is never a message party: the lead stands in as the sender, and bpv's answer comes back to the lead's thread
			post.call(d.session, id, [{ from: LEAD_ID, to: "bpv", kind: "ask", title, text: `${note.body}\n\n(Piezīme ${note.id}.) Novērtē ietekmi ar process_change_impact.`, refs: [note.id] }]);
			return note;
		},
		// after H7: one task per agent of the profile. The lessons arrive as proposals of that agent to the office memory (write_note scope birojs); none is standing until the user accepts it
		"process.learn": (id) => {
			const post = d.session?.postSystem;
			const s = readProcess(d.registry.store(id));
			const refused = learnRefusal(s);
			if (refused) throw new Error(refused);
			if (!post) throw new Error("Aģentu sesija nav pieejama.");
			// an agent removed from the settings since the profile was made cannot be asked
			const have = existing();
			const agents = s!.profile.agents.filter((a) => a !== "user" && have.includes(a));
			// bpv sets the task for the others; for bpv itself the lead does
			const items: SystemPost[] = agents.map((a) => ({ from: a === "bpv" ? LEAD_ID : "bpv", to: a, kind: "task", title: "Mācības", text: ASK_LESSONS }));
			const asked = post.call(d.session, id, items, { once: true }).map((m) => m.to);
			return { asked };
		},
		// "Pabeigt": the user has gone through the proposals
		"process.finish": (id) => {
			const store = d.registry.store(id);
			const before = readProcess(store);
			const s = finishLearning(store, "user");
			changed(id, before, s);
			d.session?.notesChanged();
			return s;
		},
	};
}
