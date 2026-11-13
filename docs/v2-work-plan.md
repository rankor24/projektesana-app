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
| auto, read | `list_sources`, `read_source(id, pages)`, `search_sources(q)`, `search_law(q)`, `get_profile`, `list_requirements(filter)`, `list_findings(filter)`, `list_rooms`, `list_deliveries`, `delivery_checklist` (phase 7), `read_notes`, `get_focus`, `read_skill(name, path)` |
| auto, as proposal | `set_fact(key, value, source{quote})`, `add_requirement(origin, citation, text, appliesTo)`, `propose_justification(findingId, reason)`, `write_note(type, title, body)` |
| auto, annotate | `add_pin(target, text)`, `add_comment(pinId, text)`, `open_panel(name, filter)`, `highlight(ids)`, `draw_sketch(...)` (phase 5) |
| auto, run | `run_check(checkId)`, `export_room_table()`, `revit_export_pdf / revit_export_ifc / revit_save_copy / revit_view_geometry` (phase 6), `stage_revit_sheets / stage_ifc / stage_source_file` (phase 7: into the draft's staging folder only) |
| confirm per batch | Revit create and modify: the v1 allow-list (`create_level`, `create_grid`, `create_line_based_element`, `create_surface_based_element`, `create_point_based_element`, `create_room`, `tag_all_rooms`, `tag_all_walls`, `create_dimensions`, `operate_element`, `color_elements`, read tools) plus the named commands of phase 6 (views, sheets); `start_delivery`, `unstage_file` (phase 7) |
| never | `delete_element`, `send_code_to_revit`, any approve / close / mark-sent, the copy into `1.4_Nodevumi`, any write to a source file |

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
| 7.6 | Copy to `1.4_Nodevumi`: main process only, user click only, after a "Sagatavot" run with no blocking findings on exactly the staged set (a fingerprint of the files is kept with the check run). Target = the existing kind folder found by `findDeliveriesDir` + new `YYMMDD`; refuses if the kind folder is missing (no new folders in `01_Projektesana` except the dated delivery folder the standard asks for), if `YYMMDD` exists, or if any path leaves that folder; copies, compares hashes, rescans. The guard gets one function `checkDeliveryWrite` for exactly this path; `checkWrite` is unchanged | `src/core/guard.ts`, `src/sources/deliver-copy.ts`, `src/checks/gate.ts`, `src/sources/pipeline.ts`, `src/main/handlers/deliveries.ts` | fixture tree: copy lands and hashes match; second copy refused; missing kind folder refused; `..` in a name refused; with open errors refused | the staged MBP appears in `1.4` and the timeline chip turns from draft to real |
| 7.7 | Nodevumi page rebuilt: empty project → one "Nodot projektu" (kind, date) action; the active draft on top: checklist by group, each row with its status, citation and action (Eksportēt no Revit / Pievienot failu / Pamatot / "Uzdot aģentam" puts the row in Fokuss); staged files with "Atvērt mapi"; the three steps Sagatavot → Kopēt uz 1.4 (dialog shows the exact target path) → Atzīmēt kā nosūtītu; past deliveries from `1.4` below, collapsed; the TN form moves into the "Saskaņojumi" group | `src/renderer/panels/Nodevumi.tsx` | — (the user playtests) | the user takes a real project from nothing to a copied MBP on this page |

The user accepts phase 7 on a real project with the open model: a draft MBP from start to the copy in `1.4`.

Later in this phase line: office forms 01–04, 06, 13 filled through Word COM from the project's facts (docx + PDF), each a checklist row.

IFC file name (the user, 2026-11-10): `<BD code>_<daļa>_<YYMMDD>.ifc`, e.g. `BD427_AR_261110.ifc`.

## Phase 8 — From BIM Crew, and the viewer fixed

Date: 2026-11-12. Status: **for the user's approval.**
Why: BIM Crew (`D:\Code\BIM\BIM Crew`) has working pieces this app lacks. The user went through its pages and tools on 2026-11-12 and picked what comes over (list below). The user also found that **the IFC viewer does not show and IFC files are ignored**. That comes first (8.0–8.2), because the annotation view is the split view planned in `v2-design.md` decision 3.

The user's picks (2026-11-12):
- **Take**: ITO model audit + coordination reference; expert review parser; docx edit + md→docx; sheet → IFC trace; BIS renamer; checkpoints / undo + usage cost; command palette Ctrl+K; company memory (Atmiņa already covers one project); shared coordinates guide; dashboard for projects, task planner, calendar (project grafiks) **and a folders-and-files tab like BIM Crew's**; agents, sub-agents, delegate.
- **Later**: meeting notes; scheduler.
- **Skip**: BIP Writer, GIPP Writer (coordinator documents; this app reads the BIP); QA checklist builder (checks everywhere + the delivery checklist do it); Inbox (Asana, Trimble, email, WhatsApp); IFC workspace and IFC edit / patch (BimCraft is the viewer; the model changes only in Revit); Obsidian / V.A.U.L.T. tools.

Viewer, as found on 2026-11-12 (read in the code, not yet run):
1. `scripts/sync-bimcraft.mjs` looks for BimCraft at `..\getcadcraft\bimcraft` (= `D:\Code\BIM\getcadcraft\bimcraft`, which does not exist). The checkout is at `~\.opensrc\repos\github.com\getcadcraft\bimcraft`, with its vendor libraries (`three`, `manifold-3d`) fetched. The script only warns and exits 0, so `npm run build` passes, `resources/bimcraft` is never made, and `bimcraft://` answers 404 "nav konfigurēts" inside the preview frame.
2. `Preview.tsx` opens a source in `SourcePdf` when it is `.pdf` and in `TextView` for anything else, so an `.ifc` picked in Avoti never reaches `IfcView`. The only way into 3D is the "3D" button in Versijas.
3. `sources/models.ts` lists IFC files only under `01_Projektesana\1.2*`. IFC files in `1.1` (the existing building), in `1.4` deliveries and in staging are not models to the app.

Rules that hold for every task:
- **Port, don't run Python.** This app has no Python (`v2-design.md` 4.1). BIM Crew's `core/*.py` logic is ported to TypeScript, and its tests are re-made on invented fixtures. Word documents go through Word COM, using the same helper as the old formats (`resources/office-text.ps1`) and the office forms planned after 7.7. There is no python-docx.
- **One list, several views.** The Faili tab, the dashboard and the grafiks read the same registry, deliveries and clocks as Avoti, Projekts and the timeline (decision 8): a view, never a second copy of the data.
- The office folder stays read-only. Renamed files, written documents and guides land in the app's data folder or the draft's staging. Only 7.6 writes into `1.4`.
- Every new agent tool gets a level in the tools table (`v2-design.md` 4.2). A sub-agent runs with the levels of the agent that started it, never higher.
- Each task names the BIM Crew file it ports, and its commit message says so.

| Task | Build | Files | Tests | Done when |
|---|---|---|---|---|
| 8.0 | BimCraft wired: the sync looks in `BIMCRAFT_SOURCE`, then `~\.opensrc\repos\github.com\getcadcraft\bimcraft`, then `..\getcadcraft\bimcraft`; when none has `app\bimcraft.js` it **fails** `build`/`dist` with the paths it tried, and warns only for `typecheck`/`test`; missing vendor libraries also fail. Iestatījumi shows the BimCraft copy (source path, date, libraries, bridge add-on on), like the Revit MCP row; the tests that use BimCraft's real engine (5.1, 5.2, 5.3, 6.2) find it by the same lookup instead of skipping on a wrong path; `smoke:packaged` checks the shipped copy and the bridge add-on by file (no window: rule 6) | `scripts/bimcraft-source.mjs`, `scripts/sync-bimcraft.mjs`, `src/main/bimcraft-status.ts`, `src/renderer/panels/Iestatijumi.tsx`, `test/8.0-bimcraft-source.test.ts` | source lookup order; missing source and missing vendor libraries named; settings row states | `npm run build` makes `resources/bimcraft`, and the packaged exe opens BimCraft with the bridge add-on |
| 8.1 | IFC everywhere: `Preview` sends a source ending in `.ifc` to `IfcView` (bytes by source id through the path guard); the models list is the office file tree under `01_Projektesana` (1.1, 1.2, 1.4 and the rest: every `.ifc`, its part and section from the folders, `arhīvs` marked old and sorted last, never hidden; read from disk, so it works before a scan) plus the IFCs staged in drafts and the captured revisions; Avoti rows for IFC carry a "3D" mark; the checklist's "IFC modelis" row already reads the draft's own staged files, which are the same "uzmetums" entries | `src/renderer/shell/Preview.tsx`, `src/sources/models.ts`, `src/main/handlers/revit.ts`, `src/renderer/panels/Avoti.tsx`, `src/renderer/panels/Versijas.tsx`, `test/8.1-models-everywhere.test.ts` | invented tree with IFCs in 1.1, 1.2, 1.4 and arhīvs, a staged draft and a revision: all listed with part, section and state | an IFC picked in Avoti opens in 3D |
| 8.2 | Annotation view (decision 3): one toolbar over the preview for PDF and IFC with one note field (Electron has no `window.prompt`): **Piezīme** makes a pin, **Skice → aģentam** sends the selection with the note, and BimCraft's own panel keeps measure and sections. A 3D pin sits on the selected element (GlobalId) with the camera it was seen from (viewer space, to fly back) and BimCraft's own capture of the same view (IFC space, for BCF); the bridge draws every pin of the model as a numbered dot over the canvas that follows the camera, and a click on a dot or a row flies to it (a pin with no camera frames its element). A PDF pin sits on page x/y as before. The pins of the open file are listed beside it (numbered by creation so a number never moves; open first, then waiting for you, closed last) with Aizvērt / Atvērt vēlreiz, and reach the agent's Fokuss and prompt as in 6.4. `Piezīmes → BCF` exports the element pins as BCF topics with their camera and comments. No snapshot image is stored. **From BIM Crew:** `IfcViewerArtifact` selection/isolate handling as a reference for the UI only | `src/renderer/preview/IfcView.tsx`, `src/renderer/preview/Annotate.tsx`, `src/renderer/preview/SourcePdf.tsx`, `src/bimcraft-addon/projektesana/main.js`, `src/shared/bimcraft-protocol.ts`, `src/shared/pins-view.ts`, `src/core/pins.ts`, `src/checks/bcf.ts`, `test/8.2-annotate-bridge.test.ts`, `test/8.2-pins-3d.test.ts` | bridge on BimCraft's real add-on API and IFC engine with a fake viewer: capture, dots on their elements that follow the camera, click, fly to camera and to element, errors said; pin validation, prompt text, numbering, BCF topic and a round trip through BimCraft's own reader | a pin placed on a wall survives a restart, shows in 3D, and the agent names it in its next answer |
| 8.3 | **Faili** tab (a panel of its own, between Projekts and Avoti): the project folder as a tree like Explorer, one level at a time (folders first, files below counted by name and capped at 5 000, junk hidden, a long folder cut at 400 with the rest said); the scan laid over it: a folder's role chip, a file's role and its source ("nav avots" when the scan did not register it), the files found inside an .edoc / .asice listed under it; a box that filters what is loaded and a search over every name below the root (diacritics and case ignored); three roots: the office folder, the drafts' staging, the project's own data. A file opens in the preview when it is a registered source or an IFC, otherwise in the PC's own program; "+ Fokuss" hands a source to the agent; "Explorerī" opens the folder. Read-only; nothing outside the root can be listed (`..` refused). **From BIM Crew:** `components/ProjectSidebar.tsx`, `ArtifactPanel/FilesArtifact.tsx`, `server/src/files.ts` | `src/sources/tree.ts`, `src/main/handlers/files.ts`, `src/main/handlers/revit.ts`, `src/renderer/panels/Faili.tsx`, `src/shared/api.ts`, `src/shared/ui-instruction.ts`, `test/8.3-files-tree.test.ts` | tree from an invented office folder and invented sources: order, counts without junk, roles over folders and files, container rows, case-insensitive source match, escape refused, 400 cut, search with folded diacritics | the user finds any file of a real project in two clicks |
| 8.4 | Projects dashboard (Projekts → Projekti, the list becomes it; decision 8): on top what needs the user today across all projects (worst first, most urgent first; a click opens the project's panel with the delivery or the findings); below one card per project: stage, next delivery and the days to it, open findings by severity, the clock closest to its end, last scan. Red: folder missing, open errors, a late clock, a delivery past its planned date; amber: not scanned yet, warnings, a clock within 3 working days, a delivery within 7 days. **From BIM Crew:** `components/Dashboard.tsx`, `dashboard/{ProjectCard,AttentionPanel}.tsx` | `src/core/summary.ts`, `src/core/summary-types.ts`, `src/shared/dashboard.ts`, `src/renderer/panels/Dashboard.tsx`, `src/renderer/panels/Projekts.tsx`, `src/main/handlers/projects.ts`, `test/8.4-dashboard.test.ts` | summaries from invented projects with fixed today: red and amber rules, order within and across projects, stage and next delivery, received clocks done | the user sees which project needs them today |
| 8.5 | Project grafiks: calendar (month grid) with BIP grafiks dates, planned and sent deliveries, TN clocks, and the user's tasks; a task planner (new entity `Task`: id, title, due, state, refs to finding / pin / delivery, by). Agent tools `list_tasks` (read), `create_task` / `update_task` (proposal). **From BIM Crew:** `CalendarArtifact.tsx`, `calendar/{MonthGrid,DayPlanner,StageDatesDialog}.tsx`, `TaskPlannerArtifact.tsx`, `server/src/project-schedule.ts`, `core/grafik_schedule.py` | `src/core/model.ts`, `src/core/tasks.ts`, `src/renderer/panels/Grafiks.tsx`, `src/agent/tools/tasks.ts` | calendar items from invented deliveries + clocks; task round-trip | the user plans a week of one project on it |
| 8.6 | Command palette Ctrl+K: panels, projects, sources, task templates, recent files. **From BIM Crew:** `shell/CommandPalette.tsx` | `src/renderer/shell/CommandPalette.tsx`, `src/renderer/App.tsx` | ranking of an invented index | everything in the app opens from the keyboard |
| 8.7 | Checkpoints and undo: before any agent tool writes a file (staging, notes, app JSON), a copy goes to `<data>\checkpoints\`; the run card lists the writes with "Atsaukt" (a created file is moved aside, never deleted). Usage per run and per project: tokens in/out and cost when the provider reports it, shown on the run card and in Iestatījumi. **From BIM Crew:** `runtime/checkpoints.ts`, `runtime/file-locks.ts`, `HarnessArtifact.tsx` (usage) | `src/core/checkpoints.ts`, `src/agent/session.ts`, `src/renderer/shell/RunCard.tsx` | checkpoint → restore on a fixture file; created file moved aside | an agent write is undone with one click |
| 8.8 | Office memory: Atmiņa gets a second scope, **birojs**, notes in `<appData>\memory\`, read by the agent in every project; a project note can be promoted to an office one (the user's click); `write_note` takes a scope (proposal). **From BIM Crew:** `routes/company-memory.ts`, `tools/{save,list}-company-memory.ts`, `KnowledgeArtifact.tsx` | `src/core/notes.ts`, `src/renderer/panels/Atmina.tsx`, `src/agent/tools/context.ts` | scope round-trip; promote keeps the original | a lesson from one project is in the agent's answer on another |
| 8.9 | Model audit (ITO) and coordination reference: a per-project reference (base point, survey point, shared Z, IFC schema, the storey scheme with elevations) **seeded from the BIP, editable**, because BIPs contradict themselves; checked against each model: from Revit through the MCP read tools and from each IFC (site, project, building, storeys); findings grouped Novietne / Hierarhija / Stāvi, phrased as instructions to whoever opens that model; the HTML report as a staged file; a check in the registry, so it runs on every new IFC and in the delivery checklist. **From BIM Crew:** `server/src/ito/{reference,report,report-html,types}.ts`, `routes/model-audit.ts`, `ModelAuditTab.tsx` | `src/checks/checks/coordination.ts`, `src/core/coordination.ts`, `src/renderer/panels/Prasibas.tsx` | invented BIP seed with a wrong Z; two invented IFC headers, one off by a storey | the IFC row of a real draft shows the storey that does not match |
| 8.10 | Shared coordinates guide: from the reference (8.9) and the topo source, a step list for setting shared coordinates in Revit, as a note and a checklist row; the agent can use it with the `revit-shared-coordinates-z` skill. **From BIM Crew:** `core/coordinates_guide.py` | `src/rules/coordinates-guide.ts` | guide from an invented reference | a new section's model is set up from the guide |
| 8.11 | Sheet → IFC trace: for each change sheet compare names (area, room number, door mark), the label is found in the model; area checked against the sheet; nearby elements whose box moved between the two models (2 mm) listed as the likely cause, honest when a change has no label. **From BIM Crew:** `core/sheet_ifc_trace.py` | `src/sources/sheets/trace.ts`, `src/renderer/preview/SheetCompare.tsx` | invented change list + two invented IFCs: the moved wall found | a sheet change opens the element in 3D |
| 8.12 | Renamer: the staged files renamed to the BIP / office convention; the plan shown first (old → new, conflicts), applied on the user's click, staging only; the `filenames` check confirms after. **From BIM Crew:** `core/bis_renamer.py`, `core/gipp_renamer.py`, `BisRenamerArtifact.tsx` | `src/sources/rename.ts`, `src/renderer/panels/Nodevumi.tsx`, `src/agent/tools/deliveries.ts` (`rename_staged`, run) | rename plan on invented names (diacritics, duplicates) | a staged set passes `filenames` after one rename |
| 8.13 | Word documents through Word COM: the edit ops of `docx_edit.py` (replace, insert_after, append_text, set_cell, add_row, delete_row, delete_paragraph) and markdown → docx, then PDF; output to staging or app data only; agent tools `docx_outline` (read) and `docx_apply` / `write_document` (run, staging only). **From BIM Crew:** `core/docx_edit.py`, `core/md_to_docx.py`, `tools/docx-edit.ts` | `src/sources/export/word.ts`, `resources/office-word.ps1`, `src/agent/tools/documents.ts` | op list parsed and validated; the COM script on an invented docx (live) | the agent drafts a paskaidrojuma raksts into the draft MBP |
| 8.14 | Ekspertīze: an expert review (PDF / docx / md) read into findings per daļa and responsible person, each with its quote and page, tracked to closed; per-daļa fix lists; a source role "Ekspertīzes atzinums". **From BIM Crew:** `core/expert_review.py` | `src/sources/extract/expert.ts`, `src/checks/checks/expert.ts`, `src/renderer/panels/Prasibas.tsx` | invented review with 12 remarks across 4 daļas: all found with quotes | a real atzinums becomes findings the user closes one by one |
| 8.15 | Sub-agents and delegate: `run_subagent` (read-only helper, own context, parallel, short report) and `delegate` to named specialists (own prompt, own tools within the parent's levels, writes through path locks); each runs in its own lane on the activity feed and stops with Stop; an Aģenti page in Iestatījumi edits the specialists. **From BIM Crew:** `tools/{subagent,delegate}.ts`, `runtime/crew.ts`, `workers.ts`, `AgentsArtifact.tsx` | `src/agent/subagents.ts`, `src/agent/tools/agents.ts`, `src/renderer/shell/RunCard.tsx`, `src/renderer/panels/Iestatijumi.tsx` | a sub-agent is offered no tool above its parent's level; parallel cap | "check all six daļas' PDFs" runs as six lanes and one summary |

Order: 8.0 → 8.1 → 8.2 first (the viewer is broken, and the annotation view is the main view). Then 8.3–8.6 (the workspace the user uses every day). 8.7 before 8.15 (undo and locks before several agents write). 8.9 → 8.10, and 8.11, 8.12, 8.13, 8.14 in any order.

The user accepts phase 8 in two parts: 8.0–8.2 on a real project with its IFC models (open from Avoti, pin, agent answers), the rest each on its own "done when".

## Later (after phase 8)

From BIM Crew, picked "later" on 2026-11-12: **meeting notes** (audio → transcript → Atmiņa decisions, requirements and tasks; BIM Crew `meetings/transcription.ts`, `core/meeting_notes.py`; needs a local whisper) and the **scheduler** (scheduled agent runs: law re-read, TN clock reminders; `server/src/scheduler.ts`, `scheduled-runner.ts`).

Būvdarbi, nodošana, apsaimniekošana: parameters, BCF clash resolution, as-built against a laser scan. Combining the three apps once all three work.

## Spikes with a date

| Spike | When | Why it can wait |
|---|---|---|
| tesseract.js Latvian on the real scanned annex | task 1.5, first thing | it is inside the task |
| BimCraft inside Electron (ES modules, wasm, workers under Vite) | before 5.1 | nothing earlier needs it |
| Revit exports through short MCP calls | task 6.1 (the user: not now) | phases 1–5 read Revit only in 3.1 |
