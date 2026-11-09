// The law library (Avoti → Normatīvi): list, add from likumi.lv or from the user's own file, remove, re-read, and the
// acts that apply to the open project. Global: one library in the app data, shared by all projects (rules/library.ts).
//
// Only likumi.lv links are fetched, and only here in main: the renderer never talks to the web. Paid standards (LVS,
// EN, ISO) are never downloaded; the user adds the PDF they own. The page fetcher is injected so tests run offline.
import { join } from "node:path";
import { applicableActs, actIdOf, loadActMap } from "../../rules/applicable.js";
import { Library } from "../../rules/library.js";
import type { Registry } from "../../core/registry.js";
import type { EventName, EventSpec, Handlers, LibraryCategory } from "../../shared/api.js";
import type { AppSettings } from "../settings.js";

export interface LibraryDeps {
	settings: AppSettings;
	/** data folder shipped with the app (law snapshots, applicable-acts.json) */
	dataDir: string;
	registry: Registry;
	emit<E extends EventName>(event: E, payload: EventSpec[E]): void;
	/** GET a page and return its HTML; defaults to fetchLikumi */
	fetchPage?: (url: string) => Promise<string>;
}

const CATEGORIES: readonly LibraryCategory[] = ["likums", "mk", "lvs", "es"];
const LIKUMI = /^https:\/\/(?:www\.)?likumi\.lv\/(?:ta\/id\/|doc\.php\?id=)(\d+)/i;

/** A likumi.lv address as its canonical https://likumi.lv/ta/id/<n>; anything else is refused. */
export function likumiUrl(raw: string): { actId: string; url: string } {
	const m = LIKUMI.exec(raw.trim());
	if (!m) throw new Error("Pieņem tikai likumi.lv saites (https://likumi.lv/ta/id/…). LVS, EN un ISO standarti ir maksas — pievieno savu PDF.");
	return { actId: m[1], url: `https://likumi.lv/ta/id/${m[1]}` };
}

/** GET one likumi.lv page (30 s limit). */
export async function fetchLikumi(url: string): Promise<string> {
	let res: Response;
	try {
		res = await fetch(url, { headers: { "User-Agent": "Projektesana-App (law library)" }, signal: AbortSignal.timeout(30_000) });
	} catch (e) {
		throw new Error(`likumi.lv nav sasniedzams: ${(e as Error).message}`);
	}
	if (!res.ok) throw new Error(`likumi.lv atbildēja ar HTTP ${res.status}.`);
	return res.text();
}

const category = (c: string): LibraryCategory => {
	if (!CATEGORIES.includes(c as LibraryCategory)) throw new Error(`Nezināma kategorija: ${c}`);
	return c as LibraryCategory;
};

type K = "library.list" | "library.paragraphs" | "library.addUrl" | "library.addFile" | "library.remove" | "library.reread" | "library.applicable";

export function libraryHandlers(d: LibraryDeps): Pick<Handlers, K> {
	const lib = () => new Library(d.settings.libraryDir(), join(d.dataDir, "law-snapshots"));
	const fetchPage = d.fetchPage ?? fetchLikumi;
	const changed = () => d.emit("data.changed", { projectId: null, what: ["library"] });
	return {
		"library.list": () => lib().list(),
		"library.paragraphs": (sourceId) => {
			const l = lib();
			const source = l.list().find((s) => s.id === sourceId);
			if (!source) throw new Error(`Avots ${sourceId} nav bibliotēkā.`);
			return { source, paragraphs: l.paragraphs(sourceId) };
		},
		"library.addUrl": async (url, cat, title) => {
			const { actId, url: canonical } = likumiUrl(url);
			const l = lib();
			const have = l.list().find((s) => actIdOf(s) === actId);
			if (have) throw new Error(`Šis akts jau ir bibliotēkā: ${have.title} (nolasīts ${have.readOn}).`);
			const s = await l.addUrl(canonical, category(cat), fetchPage, title);
			changed();
			return s;
		},
		"library.addFile": async (file, cat, title) => {
			const s = await lib().addFile(file, category(cat), title);
			changed();
			return s;
		},
		"library.remove": (sourceId) => {
			lib().remove(sourceId);
			changed();
		},
		"library.reread": async (sourceId) => {
			const l = lib();
			const s = l.list().find((x) => x.id === sourceId);
			if (s?.url) likumiUrl(s.url); // only likumi.lv is fetched, also for links saved before this check existed
			const r = await l.reread(sourceId, fetchPage);
			changed();
			return r;
		},
		"library.applicable": (id) => {
			const map = loadActMap(d.dataDir);
			return { rows: applicableActs(map, d.registry.store(id).read("facts"), lib()), readOn: map.readOn, notRead: map.notRead };
		},
	};
}
