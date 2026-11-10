# Projektēšanas App v2 — work order

Date: 2026-11-05. Status: **for the user's approval. Work starts at task 0.1 only after they approve this order.**
Design decisions and facts: `v2-design.md`. This file is the sequence of work: what is built, in which files, how it is tested, what makes it done.

## Working rules

1. **One task at a time, in this order.** A task is done when its tests pass, `npm run typecheck` and `npm run build` pass, and its "done when" line holds. A phase is done when the user has accepted it on the real projects named, on this PC.
2. **Nothing is faked.** Tests run on invented fixtures under `test/fixtures/` that mirror real document structure (made-up names, numbers, addresses). Real projects are read only by the running app on this PC. No real data in the repo, ever.
3. **Every v1 file that is carried over is read and cleaned first**, then copied into the new repo with its own new test. Nothing is moved wholesale.
4. **The agent's tools are the only way the agent touches anything.** Every tool has an approval level (`v2-design.md` 4.2).
5. **Revit calls are short, one action per call**, through the Revit MCP only.
6. **The user playtests. No browser automation, no UI test harness.** Verification is typecheck, tests, build, and their hands.
7. **Commits**: one per task, message starts with the task number (`1.3 hashing worker`). No real data in commit messages either.

## Stack (fixed)

Electron 43, React 19, Vite, TypeScript, ESM. pi 1.4 (`@earendil-works/pi-ai`, `pi-agent-core`) with ChatGPT/Codex sign-in default. Node 26 on this PC. Stdio MCP servers: the app's own tools server and the Revit MCP. `pdfjs-dist` for PDF, `tesseract.js` with the Latvian model for OCR, `fflate` for zip (`.docx`, `.xlsx`, `.edoc`). BimCraft modules (phase 5). Per-project data as JSON and JSONL files in the app's data folder; no database, no native modules in phases 0–4.

## Repository layout (new repo `repos\projektesana`)

```
package.json  tsconfig.main.json  tsconfig.renderer.json  vite.config.ts  electron-builder.yml
scripts/        sync-skills.mjs · copy-preload.mjs · audit.ts (plan vs code)
src/core/       model.ts (data model) · store.ts (per-project JSON store, versioned writes) · log.ts (append-only) · guard.ts · registry.ts
src/sources/    scan.ts (1.1 only) · roles.ts (office folder map) · hash-worker.ts · dedupe.ts · text/{pdf,docx,xlsx,edoc,office-com,ocr}.ts · extract/{pu,kl,cadastral,topo,taa,tn}.ts
src/rules/      library.ts · rules.ts (verified quotes) · citations.ts (version dates) · workdays.ts (holidays)
src/checks/     registry.ts · run.ts (events → findings) · checks/*.ts
src/agent/      pi/ (runtime, sign-in, models) · tools/ (MCP server, tool defs with approval levels) · focus.ts · skills.ts
src/revit/      client.ts · commands.ts (named short snippets) · exports.ts   (phase 3 read-only, phase 6 write)
src/main/       main.ts · ipc.ts · preload.cts · settings.ts (keys encrypted)
src/renderer/   App.tsx · shell/{TopBar,Timeline,Preview,AgentDock,WindowLayer,FloatingWindow}.tsx · panels/{Projekts,Avoti,Prasibas,Telpas,Nodevumi,Atmina}.tsx · preview/{PdfView,IfcView,Compare}.tsx
resources/skills/   build-time copy of the Revit skills (git-ignored)
test/           node:test · fixtures/ (invented) · one test file per task
docs/           v2-design.md · v2-work-plan.md · CHECKLIST.md (status per task, kept by scripts/audit.ts)
```

## Data model (task 0.3; the shapes every panel and tool use)

| Entity | Fields | Notes |
|---|---|---|
| Project | id (BD code), name, root (office folder), profile, createdAt | one data folder per id |
| Profile | facts keyed: workType, group, procedure, stagesInContract[], sections[] (from `1.2.xx` folders), funding, bim {bipPresent, lodByStage} | every value is a Fact |
| Source | id, kind: law / document / photoSurvey, folderKey (1.1.1…), paths[] (duplicates share one Source), title, role, versions[], signers[], container (for files inside an `.edoc`) | role from folder; confirmed once for `1.1.8+` |
| Version | sha256, size, mtime, seenAt, textState: ok / ocr / empty / unsupported / error, textCache, pages | content-addressed |
| Fact | id, key, value, source: {sourceId, sha, page, quote} or {kind: user, at}, state: proposed / confirmed / rejected, by, at | quote verified by code against the text cache |
| Requirement | id, origin: law / pu / bip / tn / permit / office, citation (law: act, actVersionDate, readOn, point, url; document: sourceId, page, quote), text, appliesTo {stages[], deliveries[], sections[], sheets[]}, checkId, status: open / met / failed / justified, evidence[] | |
| Finding | id, checkId, requirementId, severity, where {sourceId / sheet / elementGuid / roomNo}, message, state: open / closed / overridden, decision {by, at, reason} | override keeps the check unchanged |
| Delivery | id, stage (BIM), kind: SKICE / MBP / BP / DT / STARP / custom, plannedDate, submittedDate, folder, items[] {sheetNo, title, file, sha}, checksRun[] | read from `1.4`, planned from BIP grafiks |
| Revision | id, at, trigger: agentBatch / manualSave, ifc, sheets[], roomTable, summary, diffFromPrev | phase 6 |
| Pin | id, target {sheet, page, x, y, viewId} or {elementGuid}, text, by, state, findingId, requirementId | |
| Note | id, type: decision / answer / learning / question, title, body (markdown), refs[], by, at | Atmiņa; one file per note |
| Event | seq, at, by, kind, data | append-only `log.jsonl`, hidden |

Storage: `<appData>\Projektesana\projects\<BD>\` with `project.json`, `sources.json`, `facts.json`, `requirements.json`, `findings.json`, `deliveries.json`, `pins.json`, `notes\*.md`, `revisions\`, `text\<sha>.txt`, `log.jsonl`. Every write of a JSON file keeps the previous one as `<name>.<seq>.json` (the versioning of 4.4 in the design doc).

## Agent tools (task 0.5; approval levels per `v2-design.md` 4.2)

| Level | Tools |
|---|---|
| auto, read | `list_sources`, `read_source(id, pages)`, `search_sources(q)`, `search_law(q)`, `get_profile`, `list_requirements(filter)`, `list_findings(filter)`, `list_rooms`, `list_deliveries`, `read_notes`, `get_focus`, `read_skill(name, path)` |
| auto, as proposal | `set_fact(key, value, source{quote})`, `add_requirement(origin, citation, text, appliesTo)`, `propose_justification(findingId, reason)`, `write_note(type, title, body)` |
| auto, annotate | `add_pin(target, text)`, `add_comment(pinId, text)`, `open_panel(name, filter)`, `highlight(ids)`, `draw_sketch(...)` (phase 5) |
| auto, run | `run_check(checkId)`, `export_room_table()`, `revit_export_pdf / revit_export_ifc / revit_save_copy / revit_view_geometry` (phase 6) |
| confirm per batch | Revit create and modify: the v1 allow-list (`create_level`, `create_grid`, `create_line_based_element`, `create_surface_based_element`, `create_point_based_element`, `create_room`, `tag_all_rooms`, `tag_all_walls`, `create_dimensions`, `operate_element`, `color_elements`, read tools) plus the named commands of phase 6 (views, sheets) |
| never | `delete_element`, `send_code_to_revit`, any approve / close / mark-sent, any write to a source file |

Skills: `scripts/sync-skills.mjs` copies `revit-modeling`, `revit-drafting`, `revit-dimensioning`, `revit-api`, `revit-room-dimension-chains`, `revit-ifc-export-classes`, `revit-shared-coordinates-z`, `ifc-property-set-txt` from `~/.claude/skills` into `resources/skills/` at build time (the Konkursu App pattern). The agent gets each skill's `SKILL.md` as instructions for the matching task and reads snippets through `read_skill`.

---

## Phase 0 — Repository and skeleton

Goal: an empty app that opens, with the carried-over core and the data model in place. No feature yet.

| Task | Build | Files | Tests | Done when |
|---|---|---|---|---|
| 0.1 | New repo, toolchain, scripts, `.gitignore`, README with the no-real-data rule | root files, `scripts/copy-preload.mjs`, `scripts/sync-skills.mjs` | — | `npm run typecheck`, `npm run build`, `npm test` (0 tests) pass; `npm start` opens an empty window |
| 0.2 | Carry over and clean: v1 `src/kernel/{guard,log,registry}.ts` → `src/core/`; v1 `src/main/rules/{engine,verify,holidays,types}.ts` and `src/main/library/library.ts` → `src/rules/`; v1 `src/agent-pi/*` → `src/agent/pi/`; v1 `src/main/files/text.ts` → `src/sources/text/{pdf,docx,xlsx}.ts`; `data/law-snapshots` and `data/rules.json` → `data/` | as listed | new tests: guard denies traversal and source writes; log appends and skips torn lines; rule quotes verified against snapshots; workdays with holidays; pdf/docx/xlsx text on invented fixtures | each carried file has a test; no `fakeRevit`, no faux model anywhere |
| 0.3 | Data model and store | `src/core/model.ts`, `src/core/store.ts` | store round-trips every entity; a write keeps the previous version; log gets an event per write | `store.open(bd)` creates the folder set above |
| 0.4 | Electron shell: window, preload, typed IPC; renderer with top bar, preview area, agent dock, bottom panel bar, window layer. `FloatingWindow.tsx` and `WindowLayer.tsx` read from BIM Crew branch `feat/floating-workspace-ui`, adapted. Empty states: `nav projekta`, `nav avota`, `nav savienojuma` | `src/main/{main,ipc,preload}.ts`, `src/renderer/App.tsx`, `src/renderer/shell/*` | IPC contract test (every channel has a handler and a type) | shell opens; a panel window opens, moves, docks, minimises; nothing in it yet |
| 0.5 | Agent harness: pi runtime with Codex sign-in, settings with encrypted keys, tools MCP server with the approval-level registry (empty tool set except `get_focus`), `scripts/sync-skills.mjs` | `src/agent/*`, `src/main/settings.ts` | approval registry: a `never` tool is not offered; a `confirm` tool waits; sign-in state reported as `nav pieslēgts` | a chat turn with no tools answers through Codex; Fokuss header shows "nekas" |

The user accepts phase 0 when: the shell opens, a chat answers, nothing pretends to work.

## Phase 1 — Projekts and Avoti (sources read correctly)

Goal: open a real office project and see every input document right. This is where v1 failed.

| Task | Build | Files | Tests (invented fixtures) | Done when |
|---|---|---|---|---|
| 1.1 | Project registry: pick the office project folder, parse the BD code from its name, create the data folder, list projects | `src/core/registry.ts`, `src/renderer/panels/Projekts.tsx` | registry add/list/forget; forget never touches the folder | Projekts panel lists projects with BD code and name |
| 1.2 | Scan `01_Projektesana\1.1_Izejas dati` only: walk, role by office folder (`1.1.1`–`1.1.7` fixed map; `1.1.8+` by folder name, confirmed once and remembered), photo survey folders `YYMMDD_FF` aggregated to one Source with date and count, skip lists | `src/sources/scan.ts`, `src/sources/roles.ts` | fixture tree with 7 fixed folders, one `1.1.08_TAA`, a survey folder with 30 tiny PNGs: roles correct, survey = 1 source, `1.2` never touched | a project with 1 600 photos lists one survey row |
| 1.3 | Hashing in a worker thread, streamed, with progress events; duplicates merged by sha into one Source with several paths | `src/sources/hash-worker.ts`, `src/sources/dedupe.ts` | two fixture files with equal bytes become one Source with two paths; progress events arrive in order | the window never blocks while a network folder is read |
| 1.4 | `.edoc`: open the zip, list inner files as Sources with `container`, read signers from `META-INF/edoc-signatures-*.xml` (name, time) | `src/sources/text/edoc.ts` | fixture `.edoc` with 2 inner files and 3 signature XMLs: 2 Sources, 3 signers | an `.edoc` shows its inner documents and who signed |
| 1.5 | OCR: image-only PDF pages rendered in an offscreen BrowserWindow with pdfjs, OCR'd with tesseract.js `lav` in a worker; text cached per sha; state `ocr`; a page with nothing readable marked, never silently empty | `src/sources/text/ocr.ts`, `src/main/offscreen.ts` | fixture PDF made from rendered Latvian text with diacritics: OCR output contains the known words with ā, č, ē, ģ, ī, ķ, ļ, ņ, š, ū, ž | the real scanned annex reads in Latvian |
| 1.6 | Old formats through the installed Office: `.doc`, `.xls`, `.msg` via one PowerShell COM helper, called once per sha, cached; skipped with state `unsupported` and a reason when Office is absent | `src/sources/text/office-com.ts`, `resources/office-text.ps1` | helper contract test (arguments, JSON output); live test skipped when Word is absent | an old `.doc` PU is readable |
| 1.7 | Avoti panel: one list grouped by office folder; per row: title, role, versions, duplicate paths, signers, text state, pages; surveys as surveys; row ↔ preview selection | `src/renderer/panels/Avoti.tsx` | — (UI; the user) | the only file list in the app |
| 1.8 | PDF preview: pdfjs view of any source, page navigation, text layer, selection → Fokuss | `src/renderer/preview/PdfView.tsx`, `src/agent/focus.ts` | focus serialisation test (what the agent receives) | clicking a page region focuses it; Fokuss header updates |
| 1.9 | Agent read tools and extraction: `list_sources`, `read_source`, `search_sources`, `set_fact` with code-verified quotes; extraction prompts per role (PU → profile facts and requirement rows; cadastral → kadastra apzīmējums, area, owner; topo → author, date, validity; TAA → findings per element; TN → issuer, number, date, validity, conditions) | `src/agent/tools/sources.ts`, `src/sources/extract/*.ts` | `set_fact` refuses a quote not in the text; accepts one that is; each extractor on its fixture yields the known values | the agent answers "kāds ir kadastra apzīmējums?" with page and quote |
| 1.10 | Room table from the Kadastrālā / Inventarizācijas lieta: table rows (floor, number, name, area) from the text layer or OCR; export to Excel | `src/sources/extract/kl.ts`, `src/sources/export/xlsx.ts` | fixture KL PDF with a 3-floor table: 100 % rows, areas to one decimal | the table equals the one made by hand on a real project |
| 1.11 | Projekts panel: profile facts with sources and confirm/reject; timeline skeleton with the six BIM stages and the folder mapping (`SKICE`, `MBP` → Skice; `BP` → Tehniskais to Detalizācijas) | `src/renderer/panels/Projekts.tsx`, `src/renderer/shell/Timeline.tsx` | mapping test | profile shows with citations; timeline shows stages |

The user accepts phase 1 on: a project with 1 600 photos (opens without freezing, surveys as surveys); the project with the signed `.edoc`, the duplicate PDF and the scanned annex (one merged document, signers listed, annex in Latvian); the project whose room table was made by hand this week (equal table); the agent answering one PU question with a citation.

## Phase 2 — Prasības and checks

| Task | Build | Files | Tests | Done when |
|---|---|---|---|---|
| 2.1 | Citations with version dates: each rule carries `actVersionDate` (the consolidated date shown on likumi.lv), `readOn`, `validFrom`; re-read flags changed text | `src/rules/citations.ts`, `scripts/reread.ts` | changed snapshot text flags the rule; a rule with `validFrom` in the future is listed as upcoming | every law row opens its point on likumi.lv |
| 2.2 | Requirements from profile (law) and from documents (PU, BIP, TN, permit; agent-proposed, code-verified) | `src/rules/requirements.ts`, `src/agent/tools/requirements.ts` | group-3 public new build yields the MK 529 72 rows; PU fixture yields its numbered requirements with page and quote | Prasības has rows from two origins |
| 2.3 | Checks framework: registry, runs on events (source changed, fact confirmed, delivery prepared, pin resolved), findings store, override with reason, send back to agent | `src/checks/registry.ts`, `src/checks/run.ts` | an event runs the subscribed checks; an override closes the finding and the check still fails on the next run | top-bar counter counts open findings |
| 2.4 | First checks: completeness per delivery (MBP per MK 529 26; BP per 71/72, 73, 74, 74.1, 75.1, 76–80 by profile); one truth (address, cadastral number, areas across sources); citation still valid; deliverable file names (sheet number, title, no diacritics, `YYMMDD` folder) | `src/checks/checks/*.ts` | fixtures with one wrong address, one missing MBP item, one file with diacritics: three findings, each naming its requirement | a wrong address in a project is found |
| 2.5 | Prasības panel: rows, filter by stage / section / origin / status, citation link, evidence, findings view; `propose_justification` tool | `src/renderer/panels/Prasibas.tsx` | — | the one requirements list |

The user accepts phase 2 on: law rows by profile with exact citations for a real project; PU rows from its docx; a wrong address planted in a local copy found.

## Phase 3 — Telpas (existing building)

| Task | Build | Files | Tests | Done when |
|---|---|---|---|---|
| 3.1 | Revit read-only client: short calls through the Revit MCP for rooms (number, name, level, area), levels, active document; `nav savienojuma` state | `src/revit/client.ts`, `src/revit/commands.ts` | parser tests on recorded real reply shapes (recorded from the live Revit, not invented) | rooms of the open model are listed |
| 3.2 | Room comparison: inventory table vs model rooms, tolerance per room type, numbering and name mismatches, missing on either side; Telpas panel with row ↔ model selection | `src/checks/checks/rooms.ts`, `src/renderer/panels/Telpas.tsx` | fixture table vs fixture room list: known diffs | the diff equals the check sheets made by hand |
| 3.3 | Write `INV Area` values to the model (confirm per batch) | `src/revit/commands.ts` | — (live, recorded) | a check tag in Revit shows the inventory area |
| 3.4 | Geometry from a vector Kadastrālā lieta: lines and points per floor to CSV, shown as an overlay in the PDF preview | `src/sources/extract/kl-geometry.ts` | fixture vector PDF: known segment count and coordinates | the overlay matches the plan |
| 3.5 | PU room programme vs model rooms | `src/checks/checks/programme.ts` | fixture programme vs rooms | findings per missing or oversized room |

The user accepts phase 3 on the project modelled by hand this week, against the live model.

## Phase 4 — Nodevumi and timeline

| Task | Build | Files | Tests | Done when |
|---|---|---|---|---|
| 4.1 | Read `1.4_Nodevumi`: folders to deliveries with stage mapping, date from folder name, items from files; planned dates from the BIP grafiks (xlsx/docx table) or typed | `src/sources/deliveries.ts` | fixture `1.4` tree with SKICE, MBP, BP, Starpnodevums: stages and dates right | timeline chips are real |
| 4.2 | TN and approval items with clocks (11 / 20 and 15 / 20 working days, holidays) on the timeline | `src/rules/workdays.ts`, `src/renderer/shell/Timeline.tsx` | deadline across a holiday | a TN shows days left |
| 4.3 | Delivery gate: a delivery can be marked sent only with no open findings and the user's click; checks run on "prepare delivery" | `src/checks/run.ts`, `src/renderer/panels/Nodevumi.tsx` | gate refuses with an open finding | the Nodevumi panel |

The user accepts phase 4 on a project with real deliveries in `1.4`.

## Phase 5 — Viewer, compare, versions

| Task | Build | Files | Tests | Done when |
|---|---|---|---|---|
| 5.1 | BimCraft embedded: its `app/ifc/*`, viewer and add-on API loaded in the preview; IFC open; selection ↔ Fokuss; `highlight` tool | `src/renderer/preview/IfcView.tsx`, `src/agent/tools/viewer.ts` | add-on bridge contract test | a real IFC opens; clicking an element focuses it |
| 5.2 | IFC compare (`ifc-compare.js`) between two revisions or two exports | `src/renderer/preview/Compare.tsx` | — | added / removed / changed painted |
| 5.3 | BCF: read and write (`bcf.js`) with viewpoints; a finding becomes a BCF topic; BIM Crew's discipline sorting on top | `src/checks/bcf.ts` | fixture BCF round-trip | a finding opens in Solibri |
| 5.4 | Sheet comparison: BIM Crew `blueprint-diff` pairing and pixel overlay ported, alignment on the sheet frame added; vector compare from the pdfjs operator list (lines, texts, dimensions: added / removed / moved; dimension values listed); model-aware tracing through recorded view geometry | `src/renderer/preview/SheetCompare.tsx`, `src/sources/sheets/vector-diff.ts` | two fixture PDFs with one moved wall and one changed dimension: both found and named | a difference becomes a pin or a finding |
| 5.5 | Version timeline: sources, deliveries, revisions and app data between two dates in one list, each linked to its compare view | `src/renderer/panels/Versions.tsx` | — | "kas mainījās starp" works |
| 5.6 | `draw_sketch`: the user draws with BimCraft's tools; the sketch (elements, GlobalIds, positions) is captured as an instruction to the agent, never saved as the model | `src/agent/tools/viewer.ts` | sketch serialisation | a sketch appears in the agent's Fokuss |

The user accepts phase 5 on the reference BP set with its 16 models.

## Phase 6 — Agent modelling (the main goal)

| Task | Build | Files | Tests | Done when |
|---|---|---|---|---|
| 6.1 | Revit export spike, now: PDF of a view, IFC with office settings, save a working copy, read view geometry, each as one short call; then named commands | `src/revit/exports.ts` | parsers on recorded replies | a view exports from the app |
| 6.2 | Working copy and revisions: `_WORK` copy, capture after each batch (IFC, sheets, room table, summary, diff), v1 `loop/revision.ts` read and cleaned | `src/revit/revision.ts` | revision diff on two recorded exports | a revision appears after a batch |
| 6.3 | Agent Revit tools at `confirm per batch`; skills bundled and offered per task; the rules as system text: grids first, one wall per wall, split walls only at the exterior–interior junction, thin walls for protrusions, never rebuild what the user fixed, one action one call | `src/agent/tools/revit.ts`, `src/agent/skills.ts` | allow-list test; a `never` tool is not offered | the agent creates a level only after the user confirms the batch |
| 6.4 | Pins and sketches as tasks: open pins go first in the prompt; `resolve_pin` by the agent, closing by the user | `src/agent/tools/pins.ts` | prompt order test | a pin becomes a change |
| 6.5 | Existing building from the inventory: levels, grids, walls, openings, rooms to the area tolerance, checked by 3.2 after each batch | prompts and skills | — (live) | the model passes the room check |

The user accepts phase 6 live on an existing-building project, against the rules in 6.3.

## Phase 7 — Nodot projektu (the agent builds the delivery with the user)

Date: 2026-11-10. Status: **for the user's approval.**
Why: phase 4 made Nodevumi a mirror of `1.4_Nodevumi`: a delivery exists only after its folder does, so a project with nothing delivered shows "no data", and the agent can list deliveries but cannot make one. Phase 7 turns it around: the user starts "Nodot projektu" (kind + date), the app builds the checklist of what this delivery must contain, the agent produces the files with the user into a staging folder in the app's data folder, the checks run on the staged set, the user copies it into `1.4_Nodevumi\<KIND>\<YYMMDD>` with one confirmed click, then marks it sent (the 4.3 gate, unchanged).

The user's answers (2026-11-10): staging on C: plus a confirmed "Kopēt uz 1.4_Nodevumi" button; first version produces **Revit sheets → PDF** and **IFC**; office forms (01–06, 13) come later as docx filled through Word plus PDF.

Rules that hold for every task:
- A draft is a `Delivery` like any other (timeline chip, checks, gate), so nothing downstream learns a second shape. Its `items` are the staged files; `completeness` and `filenames` run on them unchanged.
- Staging is `<data>\nodevumi\<KIND>\<YYMMDD>\`: the same layout as the office folder, so what is checked is what gets copied.
- The office folder is written in exactly one place (7.6), on the user's click only; the agent has no tool for it and none for "nosūtīts".
- Revit: one sheet per call, nonce per call (as `exports.ts`); exports do not change the model.

| Task | Build | Files | Tests | Done when |
|---|---|---|---|---|
| 7.1 | Draft delivery: `Delivery.draft = { stagingDir, startedAt, copiedTo: string \| null }`; `deliveries.start(kind, date)` creates `draft_<KIND>_<YYMMDD>` and its staging folder; `mergeDeliveries` keeps drafts across a rescan and, once a real folder equals `copiedTo`, the real delivery takes over the draft's checks and history and the draft row goes | `src/core/model.ts`, `src/sources/deliveries.ts`, `src/main/handlers/deliveries.ts`, `src/shared/api.ts` | rescan keeps a draft; a copied draft joins its real folder; one draft per kind+date | an empty project shows a started MBP on the timeline |
| 7.2 | Checklist of the draft, derived (never stored): law rows for the kind (the `requirements` that `completeness` reads, status from `covering()` on the staged items, or "pamatots" from a justification); "Lapas no Revit" (staged sheets vs the model's sheet list: missing / extra / renamed); "IFC modelis"; "Saskaņojumi" = the TN and approval clocks (received or not, days left) | `src/checks/checklist.ts`, `src/shared/nodevums.ts` | invented MBP requirement set: staged `A-3_Fasades.pdf` closes the fasādes row, nothing else; an open TN shows as not done | the checklist of a fresh MBP lists what MK 529 26 asks, all "trūkst" |
| 7.3 | Revit sheets → PDF into staging, one call per sheet: `listSheets` snippet (id, number, name, current revision); file `<number>_<name>.pdf`, diacritics folded, `/\\:*?` removed; Revit's own PDF name checked after export; progress per sheet; a failed sheet stops and says which | `src/revit/exports.ts`, `src/revit/sheet-names.ts`, `src/revit/stage.ts`, `src/main/handlers/deliveries.ts` | name builder (diacritics, slashes, duplicates); parse a recorded `listSheets` reply; nonce mismatch refused | sheets of the open model land in staging and the "Lapas" row turns done |
| 7.4 | IFC into staging (office IFC settings as `exportIfc`), named `<BD code>_<daļa>_<YYMMDD>.ifc` (the user, 2026-11-10) | `src/revit/stage.ts`, `src/revit/sheet-names.ts` | file name builder | the "IFC modelis" row turns done |
| 7.5 | Agent: tools `start_delivery` (confirm), `delivery_checklist` (read), `stage_revit_sheets` (run; all or listed sheet numbers), `stage_ifc` (run), `stage_source_file` (run; copies a file from the project's sources into staging under a name the user confirms), `unstage_file` (confirm); task template "Nodot projektu" replaces "Pārbaudīt nodevumu": checklist first, then produce, then explain each open row with its citation and propose a justification where it does not apply; system prompt line: the goal on this panel is a delivery the user can send | `src/agent/tools/deliveries.ts`, `src/agent/tools/defs.ts`, `src/agent/tasks.ts`, `src/agent/prompt.ts`, `src/shared/activity.ts` | levels table: no copy / sent tool offered; `stage_*` refuse without a draft | asked "nodosim MBP", the agent starts the draft after the user confirms and fills it |
| 7.6 | Copy to `1.4_Nodevumi`: main process only, user click only, after a "Sagatavot" run with no blocking findings. Target = the existing kind folder found by `findDeliveriesDir` + new `YYMMDD`; refuses if the kind folder is missing (no new folders in `01_Projektesana` except the dated delivery folder the standard asks for), if `YYMMDD` exists, or if any path leaves that folder; copies, compares hashes, rescans. The guard gets one function `checkDeliveryWrite` for exactly this path; `checkWrite` is unchanged | `src/core/guard.ts`, `src/sources/deliver-copy.ts`, `src/main/handlers/deliveries.ts` | fixture tree: copy lands and hashes match; second copy refused; missing kind folder refused; `..` in a name refused; with open errors refused | the staged MBP appears in `1.4` and the timeline chip turns from draft to real |
| 7.7 | Nodevumi page rebuilt: empty project → one "Nodot projektu" (kind, date) action; the active draft on top: checklist by group, each row with its status, citation and action (Eksportēt no Revit / Pievienot failu / Pamatot / "Uzdot aģentam" puts the row in Fokuss); staged files with "Atvērt mapi"; the three steps Sagatavot → Kopēt uz 1.4 (dialog shows the exact target path) → Atzīmēt kā nosūtītu; past deliveries from `1.4` below, collapsed; the TN form moves into the "Saskaņojumi" group | `src/renderer/panels/Nodevumi.tsx` | — (the user playtests) | the user takes a real project from nothing to a copied MBP on this page |

The user accepts phase 7 on a real project with the open model: a draft MBP from start to the copy in `1.4`.

Later in this phase line: office forms 01–04, 06, 13 filled through Word COM from the project's facts (docx + PDF), each a checklist row.

IFC file name (the user, 2026-11-10): `<BD code>_<daļa>_<YYMMDD>.ifc`, e.g. `BD427_AR_261110.ifc`.

## Later (after phase 7)

Būvdarbi, nodošana, apsaimniekošana: parameters, BCF clash resolution, as-built against a laser scan. Combining the three apps once all three work.

## Spikes with a date

| Spike | When | Why it can wait |
|---|---|---|
| tesseract.js Latvian on the real scanned annex | task 1.5, first thing | it is inside the task |
| BimCraft inside Electron (ES modules, wasm, workers under Vite) | before 5.1 | nothing earlier needs it |
| Revit exports through short MCP calls | task 6.1 (the user: not now) | phases 1–5 read Revit only in 3.1 |
