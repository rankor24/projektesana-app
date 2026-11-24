// What the agent knows about the app itself (2.6.9: "agents must be experts in projektēšana-app"): every page and panel, what
// it shows, and the calls that read or change it (app_calls lists them all with parameters). Built from the page registry
// (shared/pages.ts), so a renamed or new page is in it; the calls per page are named here. Part of every standing text.
import { GLOBAL_TITLE, PAGES } from "../shared/pages.js";

/** The calls (or their prefixes) behind each page and panel, as app_calls names them. */
const CALLS: Record<string, string> = {
	parskats: "projects.dashboard, facts.*, findings.*",
	grafiks: "grafiks.items, stages.*, todos.*, timeline.clocks, clocks.*, deliveries.setPlanned/addPlanned; cilne Rutīnas: routines.* (rīki routine_list/create/change)",
	telpas: "rooms.* (inventarizācija, salīdzinājums ar modeli); labot telpas: set_inventory_rooms (visu tabulu), edit_inventory_room (vienu telpu), delete_inventory_rooms (dzēst)",
	prasibas: "requirements.*, findings.*, facts.*, expert.* (Ekspertīze)",
	avoti: "sources.* (loma: sources.setRole); lapu redzēt: view_page; Meklēšanas indekss: search.* (meklē ar search_project)",
	faili: "files.roots/list/search/open",
	normativi: "library.*",
	atmina: "memory.*, notes.*; Aģentu atmiņa: memoryMd.* (rīki memory_read/write); Aģentu izmaiņas sevī: selfChanges.*; Lietotnes problēmas: appIssues.* (rīks report_app_issue)",
	nodevumi: "deliveries.* (melnraksts, pārbaudes, lapas, pārdēvēšana, kopēšana uz 1.4), bcf.*",
	versijas: "versions.between, models.*, sheets.sets/diff/trace, compare.text, revit.files",
	koordinacija: "coordination.*",
	projekts: "projects.*, facts.* (profils)",
	iestatijumi: "settings.get, agent.providers, revit.status; iestatījumus maini ar app_settings (find, get, set, undo)",
	prasmes: "skills.*",
	agenti: "agents.*, departments.* (BD komandas imports: agents.importTeam)",};

export const APP_MAP = [
	"Lietotne (tu to pazīsti visu; nekad nesaki, ka lietotne kaut ko nevar, pirms neesi skatījis app_calls):",
	...PAGES.filter((p) => !p.hidden).map((p) => `- ${p.title}: ${p.hint}. ${CALLS[p.id] ? `Izsaukumi: ${CALLS[p.id]}.` : ""}`.trimEnd()),
	...Object.entries(GLOBAL_TITLE).map(([id, g]) => `- ${g.title}: ${g.hint}. ${CALLS[id] ? `Izsaukumi: ${CALLS[id]}.` : ""}`.trimEnd()),
	"- Sarunu panelis (nodaļas → aģenti → sarunas, Gaida tevi, Incidenti): threads.* (piespraust threads.pin, atjaunot arhivētu threads.reopen), pause.set (apturēt aģentu vai nodaļu, gaida lietotāja klikšķi), incidents.retry / incidents.dismiss (gaida lietotāju; BPV un nodaļas vadītājam savi incidentu rīki).",
	"Visu, ko lietotājs dara lapās, vari arī tu: app_read lasa, app_change maina pats, app_confirm gaida lietotāja klikšķi. Skenētu lapu (tabulu, zīmogu, rokrakstu) lasi pats ar view_page, ja koda OCR teksts ir kļūdains.",
].join("\n");
