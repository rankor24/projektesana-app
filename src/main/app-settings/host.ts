// The app_settings tool for the app: find, get, set and undo over the registry (registry.ts), where the entry's tier is the whole policy.
//   find  words (Latvian or English) -> up to 8 settings with their tier, value now and where the user changes them
//   get   one setting: value now, what it does, what values it takes, where it is
//   set   safe: validated, applied at once, logged with before and after, and announced to every window so the user sees an Undo;
//         secret / owner-only: never written; the user is told where, in a toast with a button that opens that place in Settings
//   undo  puts a change back, and only when the setting still holds what the change set (stale-safe)
// At most WRITE_BUDGET accepted sets per agent run (a run is one turn of one agent), so one confused or hijacked run cannot rewrite the app.
// Ported from OpenMausBot server/app-settings/host.ts (the write budget, undoable map keyed by request, UNDO_STALE, the tier branches) and
// docs/superpowers/specs/2026-11-12-app-settings-tool-design.md. Changed: no cards or holds (nothing waits for an answer: a safe change
// is applied and can be undone), the change is announced as an event instead of a chat card, and the log is the app's append-only JSONL.
// No Electron imports: the event sender is injected.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { appendLog } from "../../core/log.js";
import type { AppSettingChange, AppSettingEvent } from "../../shared/app-settings.js";
import { entryById, score } from "../../shared/settings-index.js";
import { buildRegistry, display, type RegistryDeps, type SafeEntry, type SettingEntry } from "./registry.js";

export const WRITE_BUDGET = 10;
export const UNDO_STALE = "Vērtība kopš tās izmaiņas ir mainīta; atsaukt vairs nevar, lai nepārrakstītu jaunāku izmaiņu.";

export interface HostDeps extends RegistryDeps {
	/** tells every window (main/main.ts: emit("appSettings.changed")) */
	emit(e: AppSettingEvent): void;
	/** the settings file changed: windows reload their settings (data.changed) */
	changed(): void;
	logFile?: string;
	now?: () => Date;
}

export interface AppSettingsRequest {
	action: "find" | "get" | "set" | "undo";
	query?: string;
	id?: string;
	value?: unknown;
	/** the agent run asking: the write budget is kept per run */
	run?: string | null;
	agent?: string | null;
}
export interface AppSettingsReply {
	ok: boolean;
	text: string;
	change?: AppSettingChange;
}

interface Undoable {
	entry: SafeEntry;
	before: unknown;
	/** the entry's whole state right after the change, as JSON: Undo goes ahead only while it is still this */
	afterKey: string;
}

export interface AppSettingsHost {
	handle(req: AppSettingsRequest): Promise<AppSettingsReply>;
	/** this session's changes, newest first */
	recent(): AppSettingChange[];
	/** the user's Undo (or an agent's, through handle); throws UNDO_STALE's text when the value has moved on */
	undo(changeId: string, by: string): Promise<AppSettingChange>;
}

const fail = (text: string): AppSettingsReply => ({ ok: false, text });
const ok = (text: string, change?: AppSettingChange): AppSettingsReply => ({ ok: true, text, ...(change ? { change } : {}) });

/** An agent sometimes sends a number, a boolean or an object as text; JSON gets one more try before the value is refused. */
function parseValue(entry: SafeEntry, raw: unknown) {
	const first = entry.value.safeParse(raw);
	if (first.success || typeof raw !== "string") return first;
	try {
		const again = entry.value.safeParse(JSON.parse(raw));
		return again.success ? again : first;
	} catch {
		return first;
	}
}

export function createAppSettingsHost(d: HostDeps): AppSettingsHost {
	const now = d.now ?? (() => new Date());
	const logFile = d.logFile ?? join(d.settings.dir, "logs", "app-settings.jsonl");
	const changes: AppSettingChange[] = [];
	const undoable = new Map<string, Undoable>();
	const spent = new Map<string, number>();

	const log = (kind: string, by: string, data: Record<string, unknown>) => {
		try {
			appendLog(logFile, { kind, by, data }, now());
		} catch {
			// a log that cannot be written must not undo a change the user is looking at
		}
	};
	/** Why this run may not make another accepted set (a write, or a request to the user); null = it may. */
	const overBudget = (run: string | null | undefined): string | null =>
		(spent.get(run ?? "no-run") ?? 0) >= WRITE_BUDGET ? `Šajā gājienā jau ir ${WRITE_BUDGET} iestatījumu izmaiņas vai lūgumi. Pasaki lietotājam, kas vēl jāmaina, un pārējo lai viņš apstiprina nākamajā gājienā.` : null;
	/** counted only once the set was accepted: a value that was refused costs nothing */
	const charge = (run: string | null | undefined) => {
		const key = run ?? "no-run";
		if (spent.size > 500) spent.delete(spent.keys().next().value as string);
		spent.set(key, (spent.get(key) ?? 0) + 1);
	};
	const byOf = (agent: string | null | undefined) => agent || "lead";

	const find = (entries: SettingEntry[], query: string): AppSettingsReply => {
		const q = query.trim();
		if (!q) return ok(`Iestatījumi (id [līmenis]):\n${entries.map((e) => `${e.id} [${e.tier}]`).join("\n")}\nIzmanto get ar id, lai redzētu vērtību.`);
		const hits = entries
			.map((e) => ({ e, s: score(q, [e.label, e.id], e.synonyms, entryById(e.id.startsWith("keys.") ? "keys" : e.id)?.topFor) }))
			.filter((h) => h.s > 0)
			.sort((a, b) => b.s - a.s)
			.slice(0, 8);
		if (!hits.length) return fail(`Nav iestatījuma pēc «${q}». Mēģini citus vārdus (latviski vai angliski) vai find bez query, lai redzētu visus.`);
		return ok(hits.map((h) => `${h.e.id} — ${h.e.label} [${h.e.tier}] = ${h.e.read()}\n  ${h.e.where}`).join("\n"));
	};

	const get = (entry: SettingEntry): AppSettingsReply => {
		const lines = [`${entry.id} — ${entry.label}`, `līmenis: ${entry.tier}`, `tagad: ${entry.read()}`, `ko dara: ${entry.help}`, `kur lietotājs to maina: ${entry.where}`];
		if (entry.tier === "safe") lines.splice(3, 0, `atļautās vērtības: ${entry.allowed}`);
		if (entry.tier === "secret") lines.push("Atslēgu tu nekad nesaņem un nedod; lietotājs to ievada pats (set parāda viņam, kur).");
		if (entry.tier === "owner-only") lines.push("To maina tikai lietotājs (set paskaidro, kur).");
		return ok(lines.join("\n"));
	};

	const asked = (entry: SettingEntry, by: string, run: string | null | undefined): AppSettingsReply => {
		const budget = overBudget(run);
		if (budget) return fail(budget);
		charge(run);
		const secret = entry.tier === "secret";
		const note = secret
			? `Aģents lūdz ievadīt: ${entry.label}. Atslēgu ieraksti pats lauciņā; aģents to neredz.`
			: `Aģents vēlas mainīt: ${entry.label}. To maina tikai lietotājs.`;
		d.emit({ kind: "ask", settingId: entry.id, label: entry.label, tier: entry.tier as "secret" | "owner-only", where: entry.where, by, note });
		log("app-settings.ask", `agent:${by}`, { id: entry.id, tier: entry.tier });
		return ok(
			secret
				? `${entry.label}: atslēgu nedrīkst ne dot, ne lasīt tev. Lietotājs saņēma ziņu ar pogu, kas atver ${entry.where}; tur viņš to ievada pats. Tagad: ${entry.read()}. Nelūdz atslēgu čatā.`
				: `${entry.label}: to maina tikai lietotājs, ne aģents. Lietotājs saņēma ziņu ar pogu, kas atver ${entry.where}. Tagad: ${entry.read()}. Pasaki viņam vienā rindā, kas jāizdara.`,
		);
	};

	const set = async (entry: SettingEntry, req: AppSettingsRequest): Promise<AppSettingsReply> => {
		const by = byOf(req.agent);
		if (entry.tier !== "safe") return asked(entry, by, req.run);
		const parsed = parseValue(entry, req.value);
		if (!parsed.success) return fail(`Vērtība neder iestatījumam ${entry.id}: ${parsed.error.issues.map((i) => i.message).join("; ")}. Atļauts: ${entry.allowed}.`);
		const before = entry.snap();
		const beforeShown = entry.read();
		const budget = overBudget(req.run);
		if (budget) return fail(budget);
		const refusal = await entry.write(parsed.data);
		if (refusal) return fail(`${entry.label}: ${refusal}`);
		charge(req.run);
		const afterShown = entry.read();
		if (JSON.stringify(entry.snap()) === JSON.stringify(before)) return ok(`${entry.label} jau ir ${afterShown}; nekas nav mainīts.`);
		const change: AppSettingChange = { id: `chg-${randomUUID().slice(0, 8)}`, settingId: entry.id, label: entry.label, before: beforeShown, after: afterShown, by, at: now().toISOString(), undone: false };
		undoable.set(change.id, { entry, before, afterKey: JSON.stringify(entry.snap()) });
		changes.unshift(change);
		if (changes.length > 50) undoable.delete(changes.pop()!.id);
		log("app-settings.change", `agent:${by}`, { id: entry.id, change: change.id, before: beforeShown, after: afterShown, run: req.run ? String(req.run).split(/[\\/]/).pop() : null });
		d.changed();
		d.emit({ kind: "change", change });
		return ok(`${entry.label}: ${beforeShown} → ${afterShown}. Lietotājs redz paziņojumu ar pogu Atsaukt. Atsaukšanas id: ${change.id}.`, change);
	};

	const undo = async (changeId: string, by: string): Promise<AppSettingChange> => {
		const change = changes.find((c) => c.id === changeId);
		const u = undoable.get(changeId);
		if (!change || !u) throw new Error("Šo izmaiņu vairs nevar atsaukt (lietotne tika restartēta vai izmaiņa ir veca).");
		if (change.undone) throw new Error("Šī izmaiņa jau ir atsaukta.");
		if (JSON.stringify(u.entry.snap()) !== u.afterKey) throw new Error(UNDO_STALE);
		u.entry.restore(u.before);
		change.undone = true;
		undoable.delete(changeId);
		log("app-settings.undo", by, { id: change.settingId, change: changeId, restored: change.before });
		d.changed();
		d.emit({ kind: "undone", change: { ...change } });
		return { ...change };
	};

	return {
		recent: () => changes.map((c) => ({ ...c })),
		undo,
		async handle(req) {
			try {
				if (req.action === "undo") {
					if (!req.id) return fail("undo: norādi izmaiņas id (chg-…), ko atdeva set.");
					const c = await undo(req.id, `agent:${byOf(req.agent)}`);
					return ok(`Atsaukts: ${c.label} atkal ir ${c.before}.`, c);
				}
				const entries = await buildRegistry(d);
				if (req.action === "find") return find(entries, req.query ?? "");
				const entry = entries.find((e) => e.id === req.id);
				if (!entry) {
					const near = req.id ? entries.filter((e) => e.id.includes(String(req.id)) || e.label.toLowerCase().includes(String(req.id).toLowerCase())).slice(0, 5) : [];
					return fail(`Nav iestatījuma ar id ${JSON.stringify(req.id ?? null)}. Izmanto find ar vārdiem.${near.length ? ` Līdzīgi: ${near.map((e) => e.id).join(", ")}.` : ""}`);
				}
				if (req.action === "get") return get(entry);
				if (req.action === "set") return await set(entry, req);
				return fail("action: find, get, set vai undo.");
			} catch (e) {
				return fail((e as Error).message);
			}
		},
	};
}

export { display };
