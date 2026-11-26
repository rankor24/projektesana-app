// The Settings window's map: four groups, eight pages, and an index of every setting with Latvian and English words people (and
// agents) search for it by. Pure data and pure functions, no React and no Electron: the window draws its navigation and its search
// from it, and main's registry (main/app-settings/registry.ts) takes each setting's "where do I change it" line from it, so the two
// can never name different places.
// Ported from OpenMausBot src/components/settings/settings-index.ts (pages + SETTINGS_INDEX + score + searchSettings). Changed: no
// places / accounts / Simple-Advanced (Boris: one mode, everything shown), no icons (this file must load in main), and the words are
// Latvian with English synonyms.
// Labels are Latvian source text: the window shows them through trDyn() (English entries in renderer/i18n/en/settings.ts).

export type SettingsGroupId = "projekts" | "ai" | "agenti" | "lietotne";
export type SettingsPageId = "paths" | "providers" | "backup" | "usage" | "team" | "limits" | "general" | "components";

export const SETTINGS_GROUPS: { id: SettingsGroupId; label: string }[] = [
	{ id: "projekts", label: "Projekts" },
	{ id: "ai", label: "AI" },
	{ id: "agenti", label: "Aģenti" },
	{ id: "lietotne", label: "Lietotne" },
];

export interface SettingsPageDef {
	id: SettingsPageId;
	group: SettingsGroupId;
	label: string;
	/** the page header's one line */
	intro: string;
	synonyms: string[];
}

export const SETTINGS_PAGES: SettingsPageDef[] = [
	{ id: "paths", group: "projekts", label: "Ceļi un standarts", intro: "Kur lietotne meklē biroja standartu un Revit MCP serveri, un kur tā glabā savus datus.", synonyms: ["paths", "path", "ceļi", "standards", "office standard", "folders", "mapes"] },
	{ id: "providers", group: "ai", label: "Pakalpojums un modelis", intro: "Kuru AI pakalpojumu aģenti izmanto, kā tajā pieteikties un kurš modelis un piepūle ir noklusējumā.", synonyms: ["ai", "providers", "models", "engines", "sign in", "api keys", "claude", "chatgpt", "codex", "openai"] },
	{ id: "backup", group: "ai", label: "Rezerve un atkopšana", intro: "Uz ko aģenti pārslēdzas, kad pakalpojumam ir limits vai pieteikšanās beigusies.", synonyms: ["backup", "fallback", "recovery", "limit", "holds", "rezerve"] },
	{ id: "usage", group: "ai", label: "Izmantojums", intro: "Cik tokenu un naudas aģenta darbi ir izmantojuši, pa projektiem.", synonyms: ["usage", "tokens", "cost", "spending", "izmaksas"] },
	{ id: "team", group: "agenti", label: "Komanda un prasmes", intro: "Aģentu nodaļas un paši aģenti (pievienot, pārdēvēt, pārkārtot, pārvilkt, iestatīt) un prasmju bibliotēka.", synonyms: ["team", "agents", "departments", "skills", "komanda", "nodaļas", "prasmes"] },
	{ id: "limits", group: "agenti", label: "Aģentu ierobežojumi", intro: "Cik aģenti drīkst strādāt reizē un cik tālu drīkst sarunāties savā starpā.", synonyms: ["limits", "limit", "parallel", "wave", "ierobežojumi", "robežas"] },
	{ id: "general", group: "lietotne", label: "Vispārīgi", intro: "Tavs vārds, saskarnes valoda un izskats.", synonyms: ["general", "user", "language", "theme", "look", "appearance", "izskats", "valoda"] },
	{ id: "components", group: "lietotne", label: "Komponentes", intro: "Revit MCP, BimCraft un CadCraft: vai tie ir gatavi, un Revit spraudņa ielikšana.", synonyms: ["components", "revit", "bimcraft", "cadcraft", "add-in", "integrations", "integrācijas"] },
];

export const pageById = (id: SettingsPageId): SettingsPageDef => SETTINGS_PAGES.find((p) => p.id === id)!;
export const groupLabel = (id: SettingsGroupId): string => SETTINGS_GROUPS.find((g) => g.id === id)!.label;

/** One setting (a row, a block, a button) search can open. `id` is the registry's id where an agent may read or change it. */
export interface SettingsIndexEntry {
	id: string;
	page: SettingsPageId;
	/** the block on the page that is scrolled to, focused and lit */
	anchor: string;
	label: string;
	/** Latvian and English words; typing any of them finds the setting */
	synonyms: string[];
	/** whole queries for which this entry comes first */
	topFor?: string[];
	/** opens another page of the app instead of a block here */
	jump?: "agenti" | "prasmes";
}

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
	// Projekts · Ceļi un standarts
	{ id: "paths.officeStandardPdf", page: "paths", anchor: "office-standard", label: "Biroja standarta PDF", topFor: ["standarts", "office standard"], synonyms: ["projekta mapju koks", "mapju koks", "biroja prasības", "folder tree", "pdf", "standard", "nosaukumi", "datumi"] },
	{ id: "paths.revitServerJs", page: "paths", anchor: "revit-paths", label: "Revit MCP servera fails (index.js)", synonyms: ["revit mcp", "mcp serveris", "mcp server", "index.js", "revit ceļš", "revit path", "serveris"] },
	{ id: "paths.revitNode", page: "paths", anchor: "revit-paths", label: "Revit MCP node.exe", synonyms: ["node", "node.exe", "runtime", "revit ceļš", "revit path"] },
	{ id: "paths.dataFolder", page: "paths", anchor: "data-folder", label: "Lietotnes datu mape", synonyms: ["data folder", "appdata", "dati", "mape", "krātuve", "storage", "kur glabājas"] },
	// AI · Pakalpojums un modelis
	{ id: "ai.provider", page: "providers", anchor: "model", label: "AI pakalpojums", topFor: ["provider", "pakalpojums"], synonyms: ["provider", "claude", "chatgpt", "codex", "openai", "anthropic", "xai", "gemini", "google", "ai", "dzinējs"] },
	{ id: "ai.model", page: "providers", anchor: "model", label: "Modelis", topFor: ["model"], synonyms: ["model", "gpt", "sonnet", "opus", "haiku", "noklusējuma modelis"] },
	{ id: "ai.effort", page: "providers", anchor: "model", label: "Piepūle", topFor: ["effort"], synonyms: ["effort", "reasoning", "thinking", "domāšana", "dziļums", "low", "high", "xhigh"] },
	{ id: "ai.signIn", page: "providers", anchor: "providers", label: "Pieteikšanās pakalpojumā", topFor: ["sign in", "log in", "login", "pieslēgties"], synonyms: ["pieslēgt", "pieteikties", "atslēgties", "sign out", "log out", "abonements", "subscription", "oauth", "claude", "chatgpt", "codex"] },
	{ id: "keys", page: "providers", anchor: "providers", label: "API atslēgas", topFor: ["api key", "api keys", "api atslēga"], synonyms: ["key", "keys", "atslēga", "atslēgas", "token", "setup-token", "parole", "secret", "openai", "anthropic", "kur dabūt"] },
	// AI · Rezerve un atkopšana
	{ id: "ai.backup", page: "backup", anchor: "backup", label: "Rezerves AI", topFor: ["backup", "rezerve"], synonyms: ["backup", "fallback", "rezerves pakalpojums", "limits", "usage limit", "lietojuma limits", "pārslēgties"] },
	{ id: "ai.automaticRecovery", page: "backup", anchor: "recovery", label: "Automātiskā atkopšana", synonyms: ["automatic recovery", "recovery", "retry", "mēģināt vēlreiz", "atkārtot", "gājiens neizdodas"] },
	{ id: "ai.holds", page: "backup", anchor: "holds", label: "Aizturētie pakalpojumi", synonyms: ["held", "hold", "aizturēts", "atbrīvot", "release", "rate limit", "limits", "kredīti", "credits"] },
	// AI · Izmantojums
	{ id: "ai.usage", page: "usage", anchor: "usage", label: "Izmantojums", topFor: ["usage", "tokens", "cost"], synonyms: ["tokeni", "izmaksas", "cena", "maksa", "spending", "naudas", "expenses", "izlietots"] },
	// Aģenti · Komanda un prasmes
	{ id: "agents.departments", page: "team", anchor: "departments", label: "Nodaļas", topFor: ["departments", "nodaļas"], synonyms: ["department", "nodaļa", "komanda", "team", "BPV", "vadītājs", "lead"] },
	{ id: "agents.page", page: "team", anchor: "departments", label: "Aģentu lapa", jump: "agenti", topFor: ["agents", "aģenti"], synonyms: ["agent", "aģents", "lomas", "roles", "specialisti", "specialists", "role"] },
	{ id: "agents.skills", page: "team", anchor: "skills", label: "Prasmju bibliotēka", jump: "prasmes", topFor: ["skills", "prasmes"], synonyms: ["skill", "prasme", "bibliotēka", "library", "import"] },
	// Aģenti · Aģentu ierobežojumi
	{ id: "agents.maxParallel", page: "limits", anchor: "parallel", label: "Cik palīgi drīkst strādāt reizē", synonyms: ["parallel", "concurrency", "palīgi", "helpers", "vienlaikus", "reizē", "max agents", "workers"] },
	{ id: "agents.maxTurns", page: "limits", anchor: "turns", label: "Soļu limits aģenta darbam", topFor: ["max turns", "soļu limits"], synonyms: ["turns", "steps", "soļi", "limits", "step limit", "max turns", "turn limit", "iterations", "stops", "apstājas", "go", "turpināt", "continue", "long run", "ilgs darbs", "main agent", "galvenais aģents"] },
	{ id: "agents.maxTurnsSub", page: "limits", anchor: "turns", label: "Soļu limits palīgiem un speciālistiem", synonyms: ["turns", "steps", "soļi", "limits", "step limit", "max turns", "helpers", "specialists", "palīgi", "speciālisti", "subagents", "lane"] },
	{ id: "agents.limits.exchangesPerTopic", page: "limits", anchor: "limits", label: "Ziņas par vienu tematu", synonyms: ["exchanges", "topic", "temats", "messages", "sarunas", "ziņas"] },
	{ id: "agents.limits.chainDepth", page: "limits", anchor: "limits", label: "Ziņu ķēdes dziļums", synonyms: ["chain", "depth", "ķēde", "dziļums"] },
	{ id: "agents.limits.runsPerWave", page: "limits", anchor: "limits", label: "Skrējieni vienā vilnī", synonyms: ["runs", "wave", "vilnis", "skrējieni", "runs per wave"] },
	{ id: "agents.limits.waveCost", page: "limits", anchor: "limits", label: "Viļņa izmaksu robeža ($)", synonyms: ["cost", "cost limit", "budget", "izmaksas", "budžets", "dolāri", "usd", "wave cost"] },
	{ id: "agents.limits.taskIterations", page: "limits", anchor: "limits", label: "Uzdevuma iterācijas", synonyms: ["iterations", "task", "uzdevums", "atkārtojumi", "loops"] },
	// Lietotne · Vispārīgi
	{ id: "app.userName", page: "general", anchor: "user", label: "Vārds, uzvārds", topFor: ["name", "vārds"], synonyms: ["name", "user", "lietotājs", "uzvārds", "signature", "paraksts", "decisions", "lēmumi"] },
	{ id: "app.language", page: "general", anchor: "language", label: "Valoda", topFor: ["language", "valoda"], synonyms: ["latviešu", "english", "angļu", "latvian", "lang", "saskarne", "interface"] },
	{ id: "app.theme", page: "general", anchor: "look", label: "Izskats", topFor: ["dark mode", "tumšs", "gaišs", "theme"], synonyms: ["dark", "light", "tumšs režīms", "gaišs režīms", "krāsas", "look", "skin", "appearance", "kā sistēmā", "system"] },
	// Lietotne · Komponentes
	{ id: "components.revit", page: "components", anchor: "revit", label: "Revit MCP", synonyms: ["revit", "mcp", "savienojums", "connection", "modelis", "model"] },
	{ id: "components.addins", page: "components", anchor: "addins", label: "Revit spraudnis", synonyms: ["add-in", "addin", "plugin", "spraudnis", "ielikt", "install", "revit 2026", "revit 2025"] },
	{ id: "components.bimcraft", page: "components", anchor: "bimcraft", label: "BimCraft", synonyms: ["3d", "ifc", "viewer", "skats", "bridge", "tilts"] },
	{ id: "components.cadcraft", page: "components", anchor: "cadcraft", label: "CadCraft", synonyms: ["dwg", "cad", "compare", "salīdzināšana", "autocad"] },
];

export const entryById = (id: string): SettingsIndexEntry | undefined => SETTINGS_INDEX.find((e) => e.id === id);

/** "Iestatījumi → AI → Rezerve un atkopšana → Rezerves AI": where a person changes it by hand. The registry and the agent say exactly this. */
export function settingWhere(id: string): string {
	const e = entryById(id);
	if (!e) return "Iestatījumi";
	const p = pageById(e.page);
	return `Iestatījumi → ${groupLabel(p.group)} → ${p.label} → ${e.label}`;
}

const norm = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
export const normQuery = norm;

/**
 * How well a query fits one label with its words: 100 = a whole query the entry is named for, 90 the label itself, 80 starts with it,
 * 70 a word of it starts with it, 60 every part is in it, 50 a synonym is it, 40 a synonym starts with it (or holds it, from 4 letters), 0 no.
 * (OpenMausBot settings-index.ts `score`, same ladder.)
 */
export function score(query: string, labels: readonly string[], words: readonly string[], topFor: readonly string[] = []): number {
	const q = norm(query);
	if (!q) return 0;
	if (topFor.some((t) => norm(t) === q)) return 100;
	let best = 0;
	for (const label of labels) {
		const title = norm(label);
		const v = title === q ? 90 : title.startsWith(q) ? 80 : title.split(/[\s,·&/()$-]+/).some((w) => w.startsWith(q)) ? 70 : q.split(" ").every((part) => title.includes(part)) ? 60 : 0;
		best = Math.max(best, v);
	}
	if (best) return best;
	const ws = words.map(norm);
	if (ws.some((w) => w === q)) return 50;
	if (ws.some((w) => w.startsWith(q) || (q.length > 3 && w.includes(q)))) return 40;
	return 0;
}

export interface SearchHit {
	entry: SettingsIndexEntry;
	score: number;
}

/** The entries a query finds, best first. `labels` gives the label in every language the window shows (Latvian and the displayed one). */
export function searchSettings(query: string, labels: (e: SettingsIndexEntry) => string[] = (e) => [e.label]): SearchHit[] {
	if (!norm(query)) return [];
	const hits: SearchHit[] = [];
	for (const entry of SETTINGS_INDEX) {
		// a page's own name and words find the page's settings too, below the settings that name the query themselves
		const page = pageById(entry.page);
		let s = score(query, labels(entry), entry.synonyms, entry.topFor);
		if (!s) {
			const viaPage = score(query, [page.label, groupLabel(page.group)], page.synonyms);
			if (viaPage) s = Math.min(viaPage, 45) - 10;
		}
		if (s > 0) hits.push({ entry, score: s });
	}
	return hits.sort((a, b) => b.score - a.score);
}
