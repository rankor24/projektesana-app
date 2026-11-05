# Projektēšanas App — design

Date: 2026-11-03. Status: **approved by Boris ("Implement all phases", 2026-11-03) and built; see `docs/CHECKLIST.md` for what is done, not run live, partial or open.**
Author: Claude, from a long design conversation with Boris Varlamovs (BIM specialist and architect, SIA BŪVDIZAINS.LV, Riga).

Read this first: lines marked **[Boris]** are what Boris decided, in his words or close to them. Lines marked **[my call]** are my choices; he has not agreed to them. Lines marked **[unverified]** are claims I did not check against real code or documents. Things only Boris can answer are in section 12.

---

## 1. Intent and why

Today Boris designs the architecture of Latvian buildings by hand, from sketch to MBP (būvprojekts minimālā sastāvā) to BP (būvprojekts), under the Latvian building regulations (LBN, Ministru kabineta noteikumi, LVS standards, local rules). The work is a long chain of documents and drawings that must agree with each other and with the law: the law, the local rules, the client's brief (PU), the site data, then the drawings and the model.

The Projektēšanas App is a desktop workstation for that chain. The centre of it is **drawings and models worked on in an annotative way**: an agent draws and models in Revit, the result appears in the app as PDF sheets and an IFC model, Boris comments on it with pins and notes, the agent revises, and every step is logged so it can be discussed later. Nothing counts as done until Boris approves each page and each model.

Why now: the Konkursu App (tender filling) is working and shows the pattern, a desktop app, an agent with strict tools, every value tied to a quote. This is the same idea for design.

## 2. Where it fits

Part of one family of apps, **[Boris]**: Konkursu App, BIM Crew, and this one. Separate apps now, very compatible, maybe combined into one later. BIM Crew holds the base (projects, tasks, calendar, BIM tools) that design also relies on.

How to keep them compatible **[my call]**:

- **The project folder is the shared interface.** Every project folder contains a `.bv/` folder with a small, documented set of files (`project.json`, `log.jsonl`, plus this app's own data). Any family app can open any project by reading it. This costs nothing now and is what makes "combine later" a move and not a rewrite.
- **Do not move the Konkursu App into a shared repository now.** It is working, and another session is changing its engine layer. The Projektēšanas App starts as its own repository (`D:\Code\BIM\projektesana-app`). The code that both apps need — project registry, `.bv` log and revision store, engine seam, path guard — is written in one folder with no imports from the rest of the app (`src/kernel/`), so it can be lifted into a shared package later by moving the folder. The Konkursu App adopts that package after it has proved itself here.
- UI language: Latvian, code and comments in English **[my call, guess]**.

## 3. Goals, non-goals, anti-goals

**Goals**

1. A new project can be started from zero in the app and, by the end of the first working day, has a **sketch model in Revit, a sketch plan and probably elevations** as PDF, approved or commented page by page. **[Boris]**
2. The law and the local rules are always in view, with the exact article. The app knows the route for a building: building group, procedure, required sadaļas, required content.
3. Every change to a drawing, model or document is visible as a difference, and every comment, decision and agent action is in a log.
4. Original files are never changed or corrupted. **[Boris]**

**Non-goals (first versions)**

- Not a CAD or BIM editor. Editing happens in Revit; the app shows, annotates and approves.
- No MEP, structure (BK) or other sadaļas yet. AR (architecture) and GP (ģenerālplāns) first. **[Boris]**
- No DWG viewer in the first slices (see section 12).
- No dashboard tasks/calendar in the first slices.
- No tender or BIP work; that is the Konkursu App and BIM Crew.

**Anti-goals (a failure even if it technically works)**

- The agent approving its own work, or any page counted as approved without Boris's click.
- A rule shown without an article number and a date it was read from. Invented or half-remembered legal content is worse than none.
- Any write to a source file (PU, Inv.lieta, topo, client documents).
- Placeholder data presented as real. If something is missing the screen says `no data`, `not configured`, or `run scan`.
- A pretty dashboard that shows nothing real.

## 4. What Boris decided

**[Boris]** The left sidebar follows his priority order:

| # | Panel | Content |
|---|---|---|
| 1–4 | Likumi | Latvian laws (likumi.lv), MK regulations, LVS standards, EU standards and law |
| 5–6 | Tehniskie noteikumi | local municipality (Riga or other), utility networks and others |
| 7–8 | PU un izejas dati | projektēšanas uzdevums / client brief (usually written, not a sketch); land documents, topography, Inventarizācijas lieta, point cloud when a building exists |
| 9 | Čats | where Claude and Boris discuss the next steps; Claude asks until the setup is complete |
| 10 | Skati | 2D PDF/DWG and 3D IFC viewers for comparison, annotation, comments; everything logged |

Other decisions:

- **Agent**: Claude Agent SDK with the Revit MCP, or Codex. The agent draws and models. Boris corrects it with pins and comments.
- **Revit MCP** is connected. A PDF of the view appears in the app until all pages and models are approved. Start with AR and GP drawings and models.
- **Central dashboard**: projects overview, creation, tasks, calendar, similar to BIM Crew.
- **Each project has its own folder**, chosen in the app. Folder structures differ per project because the client's BIM prasības (usually the BIP) define them.
- **Diff and change history**, especially for documents. Non-destructive and safe: originals never corrupted.
- **First real project starts from zero**: a new project, not a half-finished one.
- BIM stages Boris works in: Koncept, Skice, Tehniskais, Detalizācijas, Būvniecība, As Built. 10.1 MBP (AR, GP); 10.2 BP (AR, GP, plus MEP); 10.3 Būvniecība; 10.4 AIM / As built.

## 5. How the law shapes the app (rules module, first product slice)

Boris chose "Route and content rules" as the first slice: from the building's facts, the app tells which procedure applies, which sadaļas (markas) the documentation needs, and what each must contain.

Verified reading of the law (likumi.lv, 2026-11-03) is in the Vault: `D:\BV\02_BIM\Standards\Latvian Standards - LVS\Būvprojektēšanas process pēc LBN un MK (likumi.lv).md`. Key points the builder needs:

- **Hierarchy** (highest first): laws → MK regulations (LBN are MK regulations) → LVS standards (binding only where an LBN refers to them) → other EU states' standards → municipal plans and rules → technical rules from network owners → PU → site data. Deviations from a technical requirement need a separate approval (Būvniecības likums 9.1), never the PU alone.
- **Building group** (MK 500 §4 and annex 1) decides the route. For a **new building the group follows from the planned building in the PU** (floors, area, use). For an **existing building it comes from documents such as Inventarizācijas lieta**. [my call, guess: Boris said the group is "in building documents like Inv.lieta"; for a from-zero project there may be no such document]
- **Stages** (MK 500 §26.1): projekta koncepcija, skiču projekts, tehniskais projekts, darba projekts. The PU defines which are needed (MK 500 §18.3). Boris's BIM stages are not the legal stages; the VNĪ checkpoints KC/ST/DT/AP are contract milestones. The app must not mix them.
- **MBP content** (Ēku būvnoteikumi MK 529 §26): explanatory description, ģenerālplāns, phases, floor and roof plans with room schedule, façades with levels, characteristic sections. **BP composition** for groups 2 and 3: MK 529 §71–74. Formatting: LBN 202-18 (does not apply to sketches or pre-project documents; MBP and BP are formatted the same; PDF/GeoPDF; 68 markas in the annex).
- **BIM model via BIS** is required for publicly funded group-3 new builds started from 2025-01-01 (MK 529 §74.1, §236).
- **Not yet read** (the builder must read them from likumi.lv before encoding): LBN 201-15, 208-15, 211-15, 016-15 and others; TIAN (Riga's rules); the LVS list; the changes taking effect on 2027-03-01 (Būvniecības likums 15.1 "ieceres realizācija posmos", MK 500 §26.12.1, MK 529 §74.2 and §87.1). The vault note on Būvprojekts in `D:\BV` is wrong (it describes BP as a project-management document); do not use it.

**Design of the module** [my call]:

- Rules are **data**, not code: one entry per rule with `source` (act, article, paragraph), `url`, `read_on` date, `valid_from` / `valid_to`, `applies_when` (group, building type, stage), `requires` (sadaļa or content item), and a verbatim `quote`. The UI always shows the article next to the result.
- A rule without a quote read from likumi.lv does not ship. A single command re-reads a rule's source and flags it when the text changed.
- The module answers the questions: *which group?* *which procedure?* (paziņojums, paskaidrojuma raksts, or MBP plus būvatļauja; the exact thresholds are in MK 529 §7 and must be read, not typed from memory) *which sadaļas and content at this stage?* *what has to be requested and by when?* (technical rules: 11 working days, MK 500 §27).
- Output feeds the setup chat (section 7) and the checklist on the project page.
- Sidebar panels 1–6 show the **source text the rules were read from**: quoted excerpts with a link to likumi.lv and the read date, searchable. They are not a mirror of the whole legal corpus. Panels 5–6 are per project: each technical-rules request has a status (`pieprasīts`, `saņemts`, `nav pieprasīts`), the date asked, the legal deadline, and the received file. [my call]

## 6. The core loop: revisions and approval

This is the heart of the app and the riskiest part, because it depends on the Revit MCP.

```
brief + rules ──► agent (Claude SDK or Codex) ──► Revit MCP ──► Revit model (working copy)
                                                                     │
         ◄── pins, comments, approve ◄── app shows PDF + IFC ◄──────┘
                  (next revision)         revision = IFC + PDFs + summary + log
```

- **Revit stays the single source of truth for the model.** Boris may also edit it by hand; the next revision picks that up.
- **Revision** = one agent batch (or one manual save) producing: an IFC export, PDFs of the requested views, a JSON summary (levels, rooms with areas, wall/floor counts), and a log entry with the prompt and every tool call. The diff between revisions is computed on the IFC by GlobalId (added, removed, moved, changed) and on the room table. [my call]
- **Working copy** [my call]: the agent edits a working copy of the model (`<name>_WORK.rvt`). Before each batch the app asks Revit to save a copy. Only an approved revision is copied to the approved folder with a version suffix. A bad batch cannot damage the approved model.
- **Approval is per page and per model.** Each sheet and the model have their own state: `new`, `commented`, `approved`. A revision is complete when all pages and models are approved. Only Boris sets `approved`.
- **Pins and comments.** A pin on a PDF page is stored as page + normalized position + the view it came from + the crop box, scale and origin that view had at export. With those, the app can turn a pin into model coordinates and tell the agent "at (x, y) on level 1: …". A pin on the 3D model attaches to an element GlobalId. Comments are free text; the agent reads the open pins as its next task.
- **Everything is logged** in `log.jsonl`: revisions, pins, comments, approvals, agent tool calls, files imported. Nothing is deleted from the log.

### Revit MCP: what exists, what is missing

The fork is `D:\Code\BIM\revit-mcp` (TypeScript server over stdio, C# add-in, multi-instance router: `list_revit_instances`, `select_revit_instance`).

Exists today (tool names in `server/src/tools/`): `create_level`, `create_grid`, `create_line_based_element` (walls, beams; takes an **array**, so many are created in one call), `create_surface_based_element` (floors), `create_point_based_element` (doors, windows, furniture), `create_room`, `tag_all_rooms`, `tag_all_walls`, `create_dimensions`, `get_current_view_info`, `get_current_view_elements`, `get_available_family_types`, `analyze_model_statistics`, `export_room_data`, `get_material_quantities`, `ai_element_filter`, `operate_element`, `color_elements`, `delete_element`, `send_code_to_revit`, `store_*` / `query_stored_data`.

Missing and needed [unverified: the builder must confirm each against the C# command set before writing]:

0. **open or create a project document from the office template** and report which document is active. Until this exists, Boris opens the working copy himself and the app only checks that the active document is the expected one; with no Revit instance connected the screen says `not connected`.
1. create / duplicate views (floor plan, elevation, section) and set their scale and crop box;
2. create sheets and place views on them;
3. **export PDF** of sheets/views;
4. **export IFC** with the office's export settings (see skills `revit-ifc-export-classes`, `ifc-property-set-txt`);
5. save a copy of the model (working copy, snapshot);
6. read back a view's geometry (crop box, scale, origin, level) so pins can be turned into model coordinates;
7. link a topo/cadastre file and set shared coordinates (see skill `revit-shared-coordinates-z`);
8. roofs, stairs and similar sketch elements if the existing create tools do not cover them.

For a fast feasibility check, items 3–6 can first be done with short `send_code_to_revit` snippets (Boris's rule: small code only, one read or write per call, then verify) and promoted to named commands once they work. The Revit API has had a PDF export option since Revit 2022 [unverified: confirm for the Revit version in use].

There is no per-call approval inside the working copy: the safety gate is the working copy plus the revision approval, not a prompt for every wall. [my call]

The agent's allowed Revit tools start as an allow-list. `delete_element` and `send_code_to_revit` are **off for the agent in the first slice** [my call]; the app calls them itself for export and save.

## 7. Setup chat (panel 9)

A chat where Claude interviews Boris until the project setup is complete, then writes the **project brief** (`.bv/brief.json`). [Boris: "you ask questions untill all is setup up for future work."]

- Setup is **complete** when every item of the checklist is either filled (with its source) or explicitly marked unknown by Boris. The checklist comes from the rules module and the project's PU: object name and address; client; land unit (cadastral number, area); existing buildings; building group; procedure and stage; required sadaļas; planned use, floors and area; building zone limits and the local rules that apply (height, density, setbacks); technical rules requested/received; room program; BIP / BIM prasības and folder structure.
- **Every fact in the brief carries a source**: file + verbatim quote, or "Boris, <date>". The same discipline as the Konkursu App (model values must have a verbatim quote that code verifies).
- The agent has read access to the imported files and to the rules module only. It cannot touch Revit from the chat; modelling starts from an explicit "start modelling" step after setup.
- Prompt lesson from the Konkursu App: the model prompt holds about 700k characters and **cuts the end**. Small and important material (brief, rules, open pins) goes first, long documents last.

## 8. Files, history, safety

- **Project folder**: chosen by Boris when creating the project. The app does not impose a folder structure. If the BIP defines one, the app can read it and propose it; Boris decides. [Boris: structures differ per project.]
- `<project>/.bv/` is the app's own space: `project.json`, `brief.json`, `log.jsonl` (append-only), `revisions/`, `files.json` (registry of imported files with hash), the SQLite database if needed.
- **Source files are never written.** On first sight a file is registered with its SHA-256 and size. The app has no code path that opens a registered source for writing. A source that changed on disk is flagged as "changed outside the app", shown as a diff, and registered as a new version.
- **Any change to a document produces a new file** (copy-on-write) with a version suffix in the project's output folder, never an overwrite. Text and tables get a readable diff (text diff for DOCX/XLSX/PDF text). Drawings and models get the IFC and view diffs from section 6.
- **No git inside project folders** [my call]: the files are large, binary and live on shared drives; the revision store and log give the history and the "who/when/why".
- Original `.rvt` files that Boris opens are never used as the working copy; the app creates a copy first.

## 9. Architecture [my call]

- **Electron + React + TypeScript**, same as the Konkursu App (Electron 43, React 19, ESM). Reason: the same toolchain, tests, build and installer pipeline already work.
- **Engines**: reuse the Konkursu App's engine seam (`src/main/engines/types.ts`: `Engine { id, status(), run(opts) }`; Claude Agent SDK in `claude.ts`, Codex SDK in `codex.ts`). Claude = Console API key per person (Claude.ai subscription login is not allowed for third-party apps; Boris's standing decision). Codex = Boris's own subscription login. The seam must change in one place: today `RunOptions.mcp` is **one** MCP server; this app needs **two** (the Revit MCP and its own `projektesana-tools`). Claude's SDK takes `mcpServers: { name: {...} }`; Codex takes `mcp_servers` in its config with `enabled_tools`. Both already accept a map.
- A third engine, pi 1.4, was added to the Konkursu App on 2026-11-03 (commit `ac4e386`, `src/agent-pi/`) and is how BIM Crew runs. ~~Boris named the Claude SDK and Codex for this app. Keep the seam so pi can be added later.~~ **[Boris, 2026-11-05]: the family converges on the pi harness, like BIM Crew and the Konkursu App, so the apps can be combined.** Done: `src/agent-pi/` lifted from the Konkursu App; the Claude Agent SDK and Codex SDK engines were removed. Providers: Claude (API key only), ChatGPT/Codex and SuperGrok (sign-in), OpenAI, Gemini, OpenRouter, xAI (API key). Model and effort are picked from lists (pi catalog + each provider's live model list).
- **`projektesana-tools`** is the app's own stdio MCP server, modelled on `konkurss-app/src/mcp/server.ts` (path guard, verbatim-quote checks, audit log). Tools: `list_files`, `read_doc`, `project_brief`, `rules_for_stage`, `list_open_pins`, `resolve_pin`, `add_note`, `finish_revision`. It is the only way the agent reads project files or writes app state.
- **Viewers**: PDF with `pdfjs-dist`; IFC with `@ifc-lite` (the library chosen in BIM Crew's roadmap, `D:\Code\BIM\BIM Crew\docs\plans`). The annotation layer is the app's own (pins, comments, comparison of two revisions side by side).
- **Revit access**: the Revit MCP server runs as a child process per agent run (stdio), pointed at the chosen Revit instance. The app itself needs Revit calls for export and save-copy; it goes through the same MCP server via a small client so there is one path into Revit.
- **Python**: IFC diff and document diff tools as a frozen executable like `konkurss-tools` (PyInstaller), later; the first version can use the TypeScript IFC library if it can read GlobalIds [unverified].
- **Verification**: lint, tests and build only. Boris playtests himself; no browser or preview testing of his app by the agent.

## 10. Day-one acceptance scenario

This is "done" for the first version, **[Boris]** "sketch model, sketch plan, maybe elevations" at the end of the first day on a new project.

1. Create project; pick an empty folder. A `.bv/` appears; the project is in the list.
2. Drop in the PU and the site data (zemes dokumenti, topo, any technical rules). The app registers each file, proposes its role (PU, topo, Inv.lieta…) with a quote, and Boris confirms.
3. Setup chat runs until the checklist is full or marked unknown. The rules panel shows the group, the procedure, the required sadaļas for the sketch stage, each with its article.
4. "Start modelling": the agent creates levels, the building zone and a first layout in Revit from the brief, rooms with areas, tags, and the sheets (plan, elevations).
5. A revision appears: the plan and elevation PDFs side by side with the IFC model. Boris pins "move the stair 2 m east", comments on a room, approves two pages.
6. The agent revises. Revision 2 shows the difference. Boris approves the rest.
7. The approved model copy and PDFs are in the project folder; the log shows the whole day.

## 11. Build order (for the plan)

0. **Spike first (throwaway)**: with short `send_code_to_revit` snippets, export one view to PDF, one IFC and a model copy from a live Revit, and read back the view's crop box and scale. This decides feasibility of the whole loop. Not kept, rewritten as proper commands.
1. **Foundation**: repository, Electron shell, project folder contract (`.bv/`), registry, append-only log, file registry with hashes and copy-on-write, engine seam with two MCP servers. `src/kernel/` written as liftable.
2. **Rules module and setup chat** (Boris's first-slice choice): rules data with citations, the checklist, the interview, the brief.
3. **Revit loop, thin**: named Revit commands (views, sheets, PDF, IFC, save copy, view geometry), agent run, revision, a plain PDF page viewer with approve and comment. First end-to-end day-one scenario.
4. **Viewers and annotation**: pins on PDF and on IFC, pin → model coordinates, side-by-side revision comparison, IFC diff.
5. **Dashboard**: project overview, tasks, calendar; likely reads BIM Crew's data or Asana. Decision deferred.
6. Later: DWG, GP details, MBP and BP sections, other disciplines, sharing code into a family package.

The plan is written after Boris approves this document. The recommended skill for it is `superpowers:writing-plans`.

## 12. Open questions (only Boris can answer) and unverified items

**Boris must answer**

1. **Where does the room program come from for a new building?** The 2026 Duntes 8 PU (`E:\BV BIM\BD424-2026_Riga_Duntes 8\1.1.04_PU\…\1_1_pielikums_TEHNISKĀ SPECIFIKĀCIJA PROJEKTĒŠANAS UZDEVUMA TABULA.pdf`) is a renovation with no room program. If the client gives rooms and areas, the brief takes them; if only a written brief, the agent has to propose them and Boris corrects. This changes how much the agent designs.
2. **Which Revit template and version** are used for a new project, and where is the template? The agent needs levels, families, wall types and view templates that exist in it.
3. **DWG**: topo and the site plan usually arrive as DWG. Is converting them to PDF acceptable for the first versions, or must the app show DWG? (Viewing DWG in an Electron app needs a converter whose licence and format support I have not checked.)
4. Which **first real project**, so that the first run uses real documents.
5. UI language: Latvian? **[my call, guess]**

**Unverified (the builder must check before relying on them)**

- Return values of `get_current_view_info` and `get_current_view_elements` (do they include geometry?).
- That the Revit version in use supports PDF export through the API.
- That `@ifc-lite` reads GlobalIds and supports pin picking in the version BIM Crew pins.
- That the Codex SDK engine accepts two MCP servers at once in this app's sandbox settings.
- Exact thresholds for the three procedures in MK 529 §7; every rule in section 5 not yet read.
- The Duntes 8 counts quoted in the conversation (about 499 requirement rows, about 180 at concept/sketch stage, about 300 at tehniskais projekts) come from a text search of the PDF and are approximate.

## 13. Read first (the builder)

- `D:\Code\BIM\konkurss-app\src\main\engines\{types,claude,codex,pi}.ts`, `src\mcp\server.ts` (path guard), `src\main\project-state.ts`, `docs\CHECKLIST.md`: working versions of the engine seam, the MCP wiring and the "every value has a quote" discipline.
- `D:\Code\BIM\revit-mcp\` (`server/src/tools/`, `commandset/Commands/`, README), and the Claude skills `revit-api`, `revit-mcp-setup`.
- `D:\Code\BIM\BIM Crew\apps\server\src\runtime\` (`approvals.ts`, `mcp.ts`) for per-tool approvals, and its client for `@ifc-lite` and pdfjs.
- The Vault note on the building design process (path in section 5) and memory notes `reference_revit_mcp_learnings.md`, `feedback_revit_mcp_small_code.md`.
- likumi.lv for every act cited: Būvniecības likums (258572), MK 500 (269069), MK 529 (269164), LBN 202-18 (301303), LBN 200-21 (326992). Links: `https://likumi.lv/ta/id/<id>`.
