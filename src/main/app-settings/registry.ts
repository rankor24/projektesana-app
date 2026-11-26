// The registry of the app's settings an agent can find, read and (by tier) change. One entry per setting; the TIER is the whole policy:
//   safe        the agent sets it, it applies at once, the user gets an Undo (host.ts)
//   secret      an API key or token: the agent never gets or gives a value; it asks the user to type it in Settings (and says where)
//   owner-only  readable and explainable, never written by an agent: sign-in, paths that start programs or feed the agent rules, the
//               name signed under the user's decisions
// Ported from OpenMausBot server/app-settings/registry.ts (+ docs/superpowers/specs/2026-11-12-app-settings-tool-design.md): the same
// entry shape { id, label, help, where, synonyms, tier, read, current, write } as a union on `tier`, so a safe entry must carry its
// schema and its write, and a secret or owner-only entry cannot carry one. Changed: this app's settings (settings.json fields and the
// provider keys), `where` / label / synonyms come from shared/settings-index.ts (the Settings window's own map), a write returns a
// refusal text or null, and an entry that touches several fields (the provider resets the model) keeps one `snap` / `restore` pair for Undo.
// Entries close over the deps; nothing here imports Electron.
import { z } from "zod";
import { LIMIT_RANGES } from "../../core/messages.js";
import type { HoldRow, ProviderRow } from "../../shared/api.js";
import { entryById, settingWhere } from "../../shared/settings-index.js";
import type { SettingTier } from "../../shared/app-settings.js";
import { DEFAULT_MAX_TURNS, DEFAULT_MAX_TURNS_SUB, MAX_TURNS_LIMIT, type Effort, type Settings } from "../../shared/types.js";
import type { Limits } from "../../shared/thread-types.js";

export interface RegistryDeps {
	settings: { get(): Settings; set(patch: Partial<Settings>): Settings; dir: string };
	/** the providers the app knows, with sign-in state and models (handler agent.providers) */
	providers(): Promise<ProviderRow[]>;
	holds(): Promise<HoldRow[]>;
}

interface Base {
	id: string;
	label: string;
	help: string;
	/** "Iestatījumi → AI → …": where the user changes it by hand */
	where: string;
	synonyms: string[];
	/** What a person or agent sees. Never a secret: a key reads as set or not set. */
	read(): string;
}
export interface SafeEntry extends Base {
	tier: "safe";
	/** the values the agent may send, in words */
	allowed: string;
	value: z.ZodType;
	/** the typed value as `write` takes it (for the log and for get) */
	current(): unknown;
	/** everything this entry may change, as one object; Undo gives it back to `restore`. Where one field changes only itself it is `current()`. */
	snap(): unknown;
	restore(snap: unknown): void;
	/** a refusal text, or null when it was written */
	write(value: unknown): Promise<string | null>;
}
export interface SecretEntry extends Base {
	tier: "secret";
}
export interface OwnerOnlyEntry extends Base {
	tier: "owner-only";
}
export type SettingEntry = SafeEntry | SecretEntry | OwnerOnlyEntry;

/** A setting's value as a person reads it; empty for unset. */
export const display = (v: unknown): string => (v === undefined || v === null || v === "" ? "" : typeof v === "string" ? v : typeof v === "boolean" ? (v ? "jā" : "nē") : JSON.stringify(v));
const shown = (v: unknown, unset = "nav") => display(v) || unset;

function meta(id: string, idOverride?: string): Pick<Base, "id" | "label" | "where" | "synonyms"> {
	const e = entryById(id);
	if (!e) throw new Error(`settings-index has no entry ${id}`);
	return { id: idOverride ?? id, label: e.label, where: settingWhere(id), synonyms: e.synonyms };
}

const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const LIMIT_KEYS = ["exchangesPerTopic", "chainDepth", "runsPerWave", "taskIterations"] as const;

export async function buildRegistry(deps: RegistryDeps): Promise<SettingEntry[]> {
	const rows = await deps.providers();
	const holds = await deps.holds().catch(() => [] as HoldRow[]);
	const s = () => deps.settings.get();
	const set = (p: Partial<Settings>) => void deps.settings.set(p);
	const rowOf = (id: string) => rows.find((r) => r.id === id);
	const provList = rows.map((r) => `${r.id}${r.configured ? "" : " (nav pieslēgts)"}`).join(", ");
	const modelsOf = (provider: string) => rowOf(provider)?.models ?? [];
	const signedInHint = (r: ProviderRow) => `${r.label} nav pieslēgts. Pieteikšanos veic tikai lietotājs: ${settingWhere("ai.signIn")}.`;

	const entries: SettingEntry[] = [];

	// ---- AI: provider, model, effort. The window resets model and effort when the provider changes, and effort when the model does; so does the agent.
	entries.push({
		...meta("ai.provider"),
		tier: "safe",
		help: "Kuru AI pakalpojumu aģenti izmanto pēc noklusējuma. Maina arī modeli un piepūli uz tā noklusējumu. Pakalpojumam jābūt pieslēgtam.",
		allowed: `pakalpojuma id: ${provList}`,
		value: z.string().trim().min(1).max(60),
		read: () => shown(s().provider),
		current: () => s().provider,
		snap: () => ({ provider: s().provider, model: s().model, effort: s().effort }),
		restore: (v) => set(v as Partial<Settings>),
		write: async (v) => {
			const row = rowOf(v as string);
			if (!row) return `Nezināms pakalpojums «${String(v)}». Ir: ${provList}.`;
			if (!row.configured) return signedInHint(row);
			if (s().provider !== row.id) set({ provider: row.id, model: "", effort: "" });
			return null;
		},
	});
	entries.push({
		...meta("ai.model"),
		tier: "safe",
		help: "Modelis, ar kuru strādā aģenti. Tukšs = pakalpojuma noklusējuma modelis. Maina piepūli uz modeļa noklusējumu.",
		allowed: "modeļa id no pašreizējā pakalpojuma saraksta, vai tukša virkne = noklusējums",
		value: z.string().trim().max(160),
		read: () => shown(s().model, "noklusējums"),
		current: () => s().model,
		snap: () => ({ model: s().model, effort: s().effort }),
		restore: (v) => set(v as Partial<Settings>),
		write: async (v) => {
			const model = v as string;
			const list = modelsOf(s().provider);
			if (model && !list.some((m) => m.id === model)) return `Pakalpojumam ${s().provider} nav modeļa «${model}». Ir: ${list.filter((m) => !m.legacy).map((m) => m.id).join(", ") || "(saraksts vēl nav ielādēts)"}.`;
			if (s().model !== model) set({ model, effort: "" });
			return null;
		},
	});
	entries.push({
		...meta("ai.effort"),
		tier: "safe",
		help: "Cik dziļi modelis domā. Tukšs = modeļa noklusējums. Ne katrs modelis atbalsta visus līmeņus.",
		allowed: `${EFFORTS.join(" | ")} vai tukša virkne = noklusējums (modelim jāatbalsta)`,
		value: z.union([z.literal(""), z.enum(EFFORTS)]),
		read: () => shown(s().effort, "noklusējums"),
		current: () => s().effort,
		snap: () => ({ effort: s().effort }),
		restore: (v) => set(v as Partial<Settings>),
		write: async (v) => {
			const effort = v as Effort | "";
			const list = modelsOf(s().provider);
			const model = list.find((m) => m.id === s().model);
			const ok = model ? model.efforts : [...new Set(list.flatMap((m) => m.efforts))];
			if (effort && ok.length && !ok.includes(effort)) return `${model ? `Modelis ${model.id}` : `Pakalpojums ${s().provider}`} neatbalsta piepūli «${effort}». Ir: ${ok.join(", ")}.`;
			set({ effort });
			return null;
		},
	});

	// ---- AI: backup and automatic recovery
	const backupShown = () => (s().backup ? `${s().backup!.provider}${s().backup!.model ? ` / ${s().backup!.model}` : ""}` : "nav");
	entries.push({
		...meta("ai.backup"),
		tier: "safe",
		help: "Uz ko aģenti pārslēdzas, kad pakalpojumam ir lietojuma limits vai pieteikšanās beigusies. Aģenta paša rezerve (Aģenti) ir svarīgāka. null = nav rezerves.",
		allowed: `null, vai {"provider": id, "model": id vai ""}; pakalpojumi: ${provList}`,
		value: z.union([z.null(), z.object({ provider: z.string().trim().min(1).max(60), model: z.string().trim().max(160).optional() }).strict()]),
		read: backupShown,
		current: () => s().backup ?? null,
		snap: () => ({ backup: s().backup ?? null }),
		restore: (v) => set(v as Partial<Settings>),
		write: async (v) => {
			if (v === null) return void set({ backup: null }), null;
			const b = v as { provider: string; model?: string };
			const row = rowOf(b.provider);
			if (!row) return `Nezināms pakalpojums «${b.provider}». Ir: ${provList}.`;
			if (b.model && !row.models.some((m) => m.id === b.model)) return `Pakalpojumam ${b.provider} nav modeļa «${b.model}».`;
			if (!row.configured) return signedInHint(row);
			set({ backup: { provider: row.id, model: b.model ?? "" } });
			return null;
		},
	});
	entries.push({
		...meta("ai.automaticRecovery"),
		tier: "safe",
		help: "Ieslēgta: ja gājiens neizdodas, pirms kāds rīks ir darbojies, to mēģina vēlreiz vienu reizi ar rezerves AI. Izslēgta: lietotājs nosūta ziņu vēlreiz.",
		allowed: "true | false",
		value: z.boolean(),
		read: () => display(s().automaticRecovery === true),
		current: () => s().automaticRecovery === true,
		snap: () => ({ automaticRecovery: s().automaticRecovery === true }),
		restore: (v) => set(v as Partial<Settings>),
		write: async (v) => (set({ automaticRecovery: v as boolean }), null),
	});

	entries.push({
		...meta("paths.revitDialogs"),
		tier: "owner-only",
		help: "Vai ekrāna palīgs (AI ar peli un Esc taustiņu, tikai Revit logos) drīkst atbildēt Revit logus, kas paliek atvērti, kamēr aģents gaida Revit. Tā ir aģenta pilnvara lietot peli, tāpēc to maina tikai lietotājs.",
		read: () => display(s().revitDialogsOnScreen !== false),
	});

	// ---- Agents: how many at once, and the five limits on how far they talk to each other
	entries.push({
		...meta("agents.maxParallel"),
		tier: "safe",
		help: "Cik palīgi un speciālisti drīkst strādāt vienlaikus. Katrs ir atsevišķs modeļa izsaukums un maksā savus tokenus.",
		allowed: "vesels skaitlis 1–6",
		value: z.number().int().min(1).max(6),
		read: () => String(s().maxParallelAgents),
		current: () => s().maxParallelAgents,
		snap: () => ({ maxParallelAgents: s().maxParallelAgents }),
		restore: (v) => set(v as Partial<Settings>),
		write: async (v) => (set({ maxParallelAgents: v as number }), null),
	});
	for (const [id, key, def, who] of [
		["agents.maxTurns", "maxTurns", DEFAULT_MAX_TURNS, "galvenais aģents"],
		["agents.maxTurnsSub", "maxTurnsSub", DEFAULT_MAX_TURNS_SUB, "palīgs vai speciālists"],
	] as const) {
		entries.push({
			...meta(id),
			tier: "safe",
			help: `Cik modeļa atbilžu (soļu) viens skrējiens drīkst veikt, pirms to aptur: ${who}. Augsts skaitlis nozīmē, ka aģents strādā, līdz uzdevums ir gatavs; pēc šī skaita skrējiens beidzas ar kļūdu «Sasniegts soļu limits». Noklusējums ${def}.`,
			allowed: `vesels skaitlis 1–${MAX_TURNS_LIMIT}`,
			value: z.number().int().min(1).max(MAX_TURNS_LIMIT),
			read: () => String(s()[key]),
			current: () => s()[key],
			snap: () => ({ [key]: s()[key] }),
			restore: (v) => set(v as Partial<Settings>),
			write: async (v) => (set({ [key]: v as number }), null),
		});
	}
	const LIMIT_HELP: Record<keyof Limits, string> = {
		exchangesPerTopic: "Cik ziņu par vienu tematu drīkst nosūtīt katra puse, pirms temats jāslēdz.",
		chainDepth: "Cik dziļi ziņa var izraisīt nākamo ziņu (aģents → aģents → aģents…).",
		runsPerWave: "Cik skrējienu drīkst izraisīt viena lietotāja darbība (vilnis); sasniedzot, rinda apstājas.",
		waveCost: "Viļņa izmaksu robeža dolāros; null = nav robežas. Sasniedzot, rinda apstājas.",
		taskIterations: "Cik reižu aģents drīkst labot uzdevuma rezultātu pēc pārbaudes.",
	};
	for (const key of [...LIMIT_KEYS, "waveCost"] as const) {
		const isCost = key === "waveCost";
		const [lo, hi] = isCost ? [0, 100000] : LIMIT_RANGES[key as Exclude<typeof key, "waveCost">];
		entries.push({
			...meta(`agents.limits.${key}`),
			tier: "safe",
			help: LIMIT_HELP[key],
			allowed: isCost ? "skaitlis > 0 (dolāri) vai null = nav robežas" : `vesels skaitlis ${lo}–${hi}`,
			value: isCost ? z.number().positive().max(hi).nullable() : z.number().int().min(lo).max(hi),
			read: () => shown(s().limits[key], "nav robežas"),
			current: () => s().limits[key],
			snap: () => ({ limits: { [key]: s().limits[key] } }),
			// main's settings.set lays a partial limits object over the current ones
			restore: (v) => set(v as Partial<Settings>),
			write: async (v) => (set({ limits: { [key]: v } as unknown as Limits }), null),
		});
	}

	// ---- App: look and language
	entries.push({
		...meta("app.theme"),
		tier: "safe",
		help: "Saskarnes izskats: kā sistēmā, tumšs vai gaišs.",
		allowed: "auto | dark | light",
		value: z.enum(["auto", "dark", "light"]),
		read: () => s().theme,
		current: () => s().theme,
		snap: () => ({ theme: s().theme }),
		restore: (v) => set(v as Partial<Settings>),
		write: async (v) => (set({ theme: v as Settings["theme"] }), null),
	});
	entries.push({
		...meta("app.language"),
		tier: "safe",
		help: "Lietotnes saskarnes valoda (aģenta teksti un dokumenti paliek latviski). Logs pārlādējas jaunajā valodā.",
		allowed: "lv | en",
		value: z.enum(["lv", "en"]),
		read: () => s().language,
		current: () => s().language,
		snap: () => ({ language: s().language }),
		restore: (v) => set(v as Partial<Settings>),
		write: async (v) => (set({ language: v as Settings["language"] }), null),
	});

	// ---- secret: one entry per provider that takes a key. Never a value, only whether one is there.
	for (const r of rows.filter((x) => x.auth.includes("api_key"))) {
		entries.push({
			...meta("keys", `keys.${r.id}`),
			label: `API atslēga: ${r.label}`,
			tier: "secret",
			help: `${r.label} atslēga vai pieteikšanās kods. Glabājas šifrēta lietotnē; to ievada tikai lietotājs.`,
			read: () => (r.configured && r.method === "api_key" ? "atslēga ir ievadīta" : r.configured ? `nav atslēgas (pieslēgts: ${r.method ?? "abonements"})` : "nav iestatīts"),
		});
	}

	// ---- owner-only
	entries.push({
		...meta("ai.signIn"),
		tier: "owner-only",
		help: "Pieteikšanās AI pakalpojumos (ChatGPT, Claude abonements…) un atteikšanās. Atmiņā paliek šifrēti pieteikšanās dati; to dara tikai lietotājs.",
		read: () => rows.filter((r) => r.configured).map((r) => `${r.label} (${r.method ?? "pieslēgts"})`).join(", ") || "neviens nav pieslēgts",
	});
	entries.push({
		...meta("ai.holds"),
		tier: "owner-only",
		help: "Pakalpojumi, kas aizturēti līdz limita atjaunošanai. Atbrīvot tos var tikai lietotājs.",
		read: () => holds.map((h) => `${h.label}${h.model ? ` ${h.model}` : ""} (${h.scope})`).join(", ") || "nav aizturētu",
	});
	entries.push({
		...meta("app.userName"),
		tier: "owner-only",
		help: "Vārds, kas tiek ierakstīts pie lietotāja lēmumiem un BCF komentāriem. Aģents to nemaina, lai nevarētu parakstīties lietotāja vārdā.",
		read: () => shown(s().userName, "nav norādīts"),
	});
	entries.push({
		...meta("paths.officeStandardPdf"),
		tier: "owner-only",
		help: "Biroja standarta PDF; no tā teksta aģenti ņem biroja prasību citātus. Faila nomaiņa maina aģentu noteikumus, tāpēc to dara tikai lietotājs.",
		read: () => shown(s().officeStandardPdf, "nav norādīts"),
	});
	entries.push({
		...meta("paths.revitServerJs"),
		tier: "owner-only",
		help: "Revit MCP servera fails (index.js), ko lietotne palaiž. Tā ir programma, tāpēc ceļu maina tikai lietotājs.",
		read: () => shown(s().revitServerJs, "standarta instalācija"),
	});
	entries.push({
		...meta("paths.revitNode"),
		tier: "owner-only",
		help: "node.exe, ar ko darbojas Revit MCP serveris. Tā ir programma, tāpēc ceļu maina tikai lietotājs.",
		read: () => shown(s().revitNode, "lietotnes node"),
	});
	entries.push({
		...meta("paths.dataFolder"),
		tier: "owner-only",
		help: "Mape, kurā lietotne glabā iestatījumus, projektus un žurnālus. Tikai lasāma.",
		read: () => deps.settings.dir,
	});
	return entries;
}

/** An entry as the agent reads it in find / get. */
export function entryLine(e: SettingEntry): string {
	return `${e.id} — ${e.label} [${e.tier}] = ${e.read()}`;
}

export type { SettingTier };
