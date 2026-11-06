# Checklist — plan vs code

Written by `scripts/audit.ts` on 2026-11-06 14:18. Status per task of `docs/v2-work-plan.md`.
"built and tested" = the task's files exist and its tests pass in `npm test` (invented fixtures). "real" = its "done when" was also checked on a real project on Boris's PC (read-only, counts only). "live" = the part of its "done when" that needs Boris — his eyes on the UI, a hand-made reference, a live Revit or the sign-in — not claimed here.

| Task | Build | Files | Tests | Status |
|---|---|---|---|---|
| 0.1 | New repo, toolchain, scripts, `.gitignore`, README with the no-real-data rule | ✓ scripts/copy-preload.mjs<br>✓ scripts/sync-skills.mjs | — | built (UI); live: `npm start` opening the window is Boris's playtest |
| 0.2 | Carry over and clean: v1 `src/kernel/{guard,log,registry}.ts` → `src/core/`; v1 `src/main/… |  | 0.2-core.test.ts<br>0.2-pi.test.ts<br>0.2-rules.test.ts<br>0.2-text.test.ts | built and tested |
| 0.3 | Data model and store | ✓ src/core/model.ts<br>✓ src/core/store.ts | 0.3-store.test.ts | built and tested |
| 0.4 | Electron shell: window, preload, typed IPC; renderer with top bar, preview area, agent doc… | ✓ src/main/main.ts<br>✓ src/main/ipc.ts<br>→ src/main/preload.ts is src/main/preload.cts (Electron preload is CommonJS (.cts))<br>✓ src/renderer/App.tsx<br>✓ src/renderer/shell/* | 0.4-ipc.test.ts | built and tested; live: moving, docking, minimising a panel is Boris's playtest |
| 0.5 | Agent harness: pi runtime with Codex sign-in, settings with encrypted keys, tools MCP serv… | ✓ src/agent/*<br>✓ src/main/settings.ts | 0.5-agent.test.ts | built and tested; live: a chat turn through Codex needs Boris's ChatGPT sign-in in Iestatījumi |
| 1.1 | Project registry: pick the office project folder, parse the BD code from its name, create … | ✓ src/core/registry.ts<br>✓ src/renderer/panels/Projekts.tsx | 1.1-1.4-sources.test.ts | built and tested; live: the panel itself is Boris's playtest |
| 1.2 | Scan `01_Projektesana\1.1_Izejas dati` only: walk, role by office folder (`1.1.1`–`1.1.7` … | ✓ src/sources/scan.ts<br>✓ src/sources/roles.ts | 1.1-1.4-sources.test.ts | built and tested; real: a project with survey photo folders and 84 GB of point clouds: scanned in 17 s, each survey one row |
| 1.3 | Hashing in a worker thread, streamed, with progress events; duplicates merged by sha into … | ✓ src/sources/hash-worker.ts<br>✓ src/sources/dedupe.ts | 1.1-1.4-sources.test.ts | built and tested |
| 1.4 | `.edoc`: open the zip, list inner files as Sources with `container`, read signers from `ME… | ✓ src/sources/text/edoc.ts | 1.1-1.4-sources.test.ts | built and tested; real: a real .edoc: inner documents merged with their loose copies, 8 signers shown |
| 1.5 | OCR: image-only PDF pages rendered in an offscreen BrowserWindow with pdfjs, OCR'd with te… | ✓ src/sources/text/ocr.ts<br>✓ src/main/offscreen.ts | 1.5-ocr.test.ts | built and tested; real: a real scanned annex read by OCR with 702 Latvian letters |
| 1.6 | Old formats through the installed Office: `.doc`, `.xls`, `.msg` via one PowerShell COM he… | ✓ src/sources/text/office-com.ts<br>✓ resources/office-text.ps1 | 1.6-office.test.ts | built and tested |
| 1.7 | Avoti panel: one list grouped by office folder; per row: title, role, versions, duplicate … | ✓ src/renderer/panels/Avoti.tsx | — | built (UI); live: the panel itself is Boris's playtest |
| 1.8 | PDF preview: pdfjs view of any source, page navigation, text layer, selection → Fokuss | ✓ src/renderer/preview/PdfView.tsx<br>✓ src/agent/focus.ts | 1.8-focus.test.ts | built and tested; live: clicking a page region is Boris's playtest |
| 1.9 | Agent read tools and extraction: `list_sources`, `read_source`, `search_sources`, `set_fac… | ✓ src/agent/tools/sources.ts<br>✓ src/sources/extract/*.ts | 1.9-extract.test.ts | built and tested; live: the agent answering with page and quote needs the sign-in |
| 1.10 | Room table from the Kadastrālā / Inventarizācijas lieta: table rows (floor, number, name, … | ✓ src/sources/extract/kl.ts<br>✓ src/sources/export/xlsx.ts | 1.10-rooms.test.ts | built and tested; live: equal to the table Boris made by hand on a real project — his comparison |
| 1.11 | Projekts panel: profile facts with sources and confirm/reject; timeline skeleton with the … | ✓ src/renderer/panels/Projekts.tsx<br>✓ src/renderer/shell/Timeline.tsx | 1.11-stages.test.ts | built and tested; live: the profile and timeline on screen are Boris's playtest |
| 2.1 | Citations with version dates: each rule carries `actVersionDate` (the consolidated date sh… | ✓ src/rules/citations.ts<br>✓ scripts/reread.ts | 2.1-citations.test.ts | built and tested |
| 2.2 | Requirements from profile (law) and from documents (PU, BIP, TN, permit; agent-proposed, c… | ✓ src/rules/requirements.ts<br>✓ src/agent/tools/requirements.ts | 2.2-requirements.test.ts | built and tested; real: 152 PU rows and 3 office-standard rows on one project |
| 2.3 | Checks framework: registry, runs on events (source changed, fact confirmed, delivery prepa… | ✓ src/checks/registry.ts<br>✓ src/checks/run.ts | 2.3-checks.test.ts | built and tested; live: the top-bar counter on screen is Boris's playtest |
| 2.4 | First checks: completeness per delivery (MBP per MK 529 26; BP per 71/72, 73, 74, 74.1, 75… | ✓ src/checks/checks/*.ts | 2.4-first-checks.test.ts | built and tested; real: after the fix no false errors; 3 info rows where property documents are missing |
| 2.5 | Prasības panel: rows, filter by stage / section / origin / status, citation link, evidence… | ✓ src/renderer/panels/Prasibas.tsx | — | built (UI); live: the panel itself is Boris's playtest |
| 3.1 | Revit read-only client: short calls through the Revit MCP for rooms (number, name, level, … | ✓ src/revit/client.ts<br>✓ src/revit/commands.ts | 3.1-revit-read.test.ts | built and tested; live: the open model's rooms were read live through the Revit MCP; the app's list on screen is Boris's playtest |
| 3.2 | Room comparison: inventory table vs model rooms, tolerance per room type, numbering and na… | ✓ src/checks/checks/rooms.ts<br>✓ src/renderer/panels/Telpas.tsx | 3.2-rooms-compare.test.ts | built and tested; live: equal to the check sheets Boris made by hand — his comparison |
| 3.3 | Write `INV Area` values to the model (confirm per batch) | ✓ src/revit/commands.ts | 3.3-inv-area.test.ts | built and tested; live: writing INV Area into Boris's model is his click (the batch is shown first) |
| 3.4 | Geometry from a vector Kadastrālā lieta: lines and points per floor to CSV, shown as an ov… | ✓ src/sources/extract/kl-geometry.ts | 3.4-kl-geometry.test.ts | built and tested; live: the overlay matching the plan is Boris's eye |
| 3.5 | PU room programme vs model rooms | ✓ src/checks/checks/programme.ts | 3.5-programme.test.ts | built and tested |
| 4.1 | Read `1.4_Nodevumi`: folders to deliveries with stage mapping, date from folder name, item… | ✓ src/sources/deliveries.ts | 4.1-4.3-deliveries.test.ts | built and tested |
| 4.2 | TN and approval items with clocks (11 / 20 and 15 / 20 working days, holidays) on the time… | ✓ src/rules/workdays.ts<br>✓ src/renderer/shell/Timeline.tsx | 4.1-4.3-deliveries.test.ts | built and tested |
| 4.3 | Delivery gate: a delivery can be marked sent only with no open findings and Boris's click;… | ✓ src/checks/run.ts<br>✓ src/renderer/panels/Nodevumi.tsx | 4.1-4.3-deliveries.test.ts | built and tested; live: the panel itself is Boris's playtest |
| 5.1 | BimCraft embedded: its `app/ifc/*`, viewer and add-on API loaded in the preview; IFC open;… | ✓ src/renderer/preview/IfcView.tsx<br>✓ src/agent/tools/viewer.ts | 5.1-bimcraft-bridge.test.ts | built and tested; live: a real IFC opening in BimCraft and click-to-focus are Boris's playtest |
| 5.2 | IFC compare (`ifc-compare.js`) between two revisions or two exports | → src/renderer/preview/Compare.tsx is src/renderer/preview/IfcView.tsx (IFC compare is IfcView's compare mode (BimCraft paints it); the sheet compare is SheetCompare.tsx) | 5.2-ifc-compare.test.ts | built and tested; live: the painting on screen is Boris's playtest |
| 5.3 | BCF: read and write (`bcf.js`) with viewpoints; a finding becomes a BCF topic; BIM Crew's … | ✓ src/checks/bcf.ts | 5.3-bcf.test.ts | built and tested; live: opening the BCF in Solibri is Boris's |
| 5.4 | Sheet comparison: BIM Crew `blueprint-diff` pairing and pixel overlay ported, alignment on… | ✓ src/renderer/preview/SheetCompare.tsx<br>✓ src/sources/sheets/vector-diff.ts | 5.4-sheet-compare.test.ts | built and tested |
| 5.5 | Version timeline: sources, deliveries, revisions and app data between two dates in one lis… | → src/renderer/panels/Versions.tsx is src/renderer/panels/Versijas.tsx (panel files use the Latvian panel names) | 5.5-versions.test.ts | built and tested; live: the panel itself is Boris's playtest |
| 5.6 | `draw_sketch`: Boris draws with BimCraft's tools; the sketch (elements, GlobalIds, positio… | ✓ src/agent/tools/viewer.ts | 5.6-sketch.test.ts | built and tested |
| 6.1 | Revit export spike, now: PDF of a view, IFC with office settings, save a working copy, rea… | ✓ src/revit/exports.ts | 6.1-revit-exports.test.ts | built and tested; live: exports from the open model are Boris's click; view list and geometry were read live |
| 6.2 | Working copy and revisions: `_WORK` copy, capture after each batch (IFC, sheets, room tabl… | ✓ src/revit/revision.ts | 6.2-revisions.test.ts | built and tested; live: a revision after a real batch needs the sign-in and a working copy |
| 6.3 | Agent Revit tools at `confirm per batch`; skills bundled and offered per task; the rules a… | ✓ src/agent/tools/revit.ts<br>✓ src/agent/skills.ts | 6.3-6.5-agent-modelling.test.ts | built and tested; live: a confirmed batch needs the sign-in and a working copy open in Revit |
| 6.4 | Pins and sketches as tasks: open pins go first in the prompt; `resolve_pin` by the agent, … | ✓ src/agent/tools/pins.ts | 6.3-6.5-agent-modelling.test.ts | built and tested; live: a pin becoming a change needs the sign-in |
| 6.5 | Existing building from the inventory: levels, grids, walls, openings, rooms to the area to… |  | 6.3-6.5-agent-modelling.test.ts | built and tested; live: modelling an existing building is the live acceptance of phase 6 |

## Agent tools

Planned in the tool table: 34. Present: 34. None missing.
`delete_element` and `send_code_to_revit` are `never` (not offered; test 0.5 and 6.3).

## Problems

None.
