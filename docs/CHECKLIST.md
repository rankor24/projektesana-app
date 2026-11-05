# Checklist — design doc vs what exists

Source: `docs/superpowers/specs/2026-11-03-projektesana-app-design.md`. Plan: `docs/superpowers/plans/2026-11-03-projektesana-app-plan.md`.
`npm run audit` checks that every row's evidence file exists and (after `::`) that the named test exists, and fails if a `done` row has none.

Status words: **done** = built and covered by a test or build · **done, not run live** = built and tested against a fake Revit / no engine run, never run against a real one · **partial** · **not done** · **later** = the spec itself puts it after the first versions · **waiting Boris** = needs an answer from section 12.

| id | spec | requirement | status | evidence |
|---|---|---|---|---|
| G1 | §3.1 | Create a new project from zero, pick a folder, `.bv/` appears, project is in the list | done | test/api.test.ts::create, list, forget |
| G1b | §3.1 / §10 | By end of day one: sketch model in Revit, sketch plan, elevations as PDF, approved/commented page by page | done, not run live | test/loop.test.ts::a batch becomes a revision |
| G2 | §3.2 | Law and local rules always in view with exact article | done | src/renderer/screens/Laws.tsx |
| G2b | §3.2 | App knows the route: group, procedure, required sadaļas and content | partial | test/rules.test.ts::procedure: public group-3 |
| G3 | §3.3 | Every change visible as a difference; every comment, decision, agent action logged | done | test/loop.test.ts::revision 2 shows the difference |
| G4 | §3.4 | Originals never changed or corrupted | done | test/files.test.ts::writeVersion never overwrites |
| A1 | §3 anti | Agent never approves; no page approved without Boris's click | done | test/tools.test.ts::no agent tool can approve |
| A2 | §3 anti | No rule without article and read date; no invented legal content | done | test/rules.test.ts::a tampered quote fails verification |
| A3 | §3 anti | No write to a source file | done | test/kernel.test.ts::guard: sources and .bv are not writable |
| A4 | §3 anti | No placeholder data: `no data`, `not configured`, `not connected`, `run scan` | done | test/revit.test.ts::no Revit instance gives `not connected` |
| A5 | §3 anti | No dashboard that shows nothing real | done | test/work.test.ts::empty project has an empty calendar |
| S1 | §4 | Sidebar 1–10 in Boris's order (laws 1–4, technical rules 5–6, PU/data 7–8, chat 9, views 10) | done | src/renderer/App.tsx |
| S2 | §4 + Boris 2026-11-05 | Agent = the family's pi harness (src/agent-pi, lifted from Konkursu App); providers Claude (API key), ChatGPT/Codex and SuperGrok (sign-in), OpenAI/Gemini/OpenRouter/xAI (API key) | done, not run live | test/engines.test.ts::a full pi run (faux model) |
| S3 | §4 | Revit MCP connected; PDF of the view appears in the app until all pages and models approved | done, not run live | test/loop.test.ts::publishApproved refuses until everything is approved |
| S4 | §4 | Central dashboard: projects, creation, tasks, calendar | done | test/work.test.ts::tasks: add with due date |
| S5 | §4 | Each project has its own folder chosen in the app; structure not imposed | done | test/api.test.ts::create, list, forget |
| S6 | §4 | Diff and change history; non-destructive | done | test/work.test.ts::changed source keeps both versions' bytes |
| S7 | §4 | BIM stages Koncept/Skice/Tehniskais/Detalizācijas/Būvniecība/As built | partial | src/main/rules/types.ts |
| R1 | §5 | Rules as data: source, url, read_on, valid_from/to, applies_when, requires, verbatim quote | done | data/rules.json |
| R2 | §5 | A rule without a quote read from likumi.lv does not ship | done | test/rules.test.ts::every shipped rule has a verbatim quote |
| R3 | §5 | One command re-reads the sources and flags changed text | done | test/docs.test.ts::re-read |
| R4 | §5 | Answers: which group, which procedure, which sadaļas/content, what to request and by when | partial | test/rules.test.ts::technical rules: 11 working days |
| R5 | §5 | Output feeds the setup chat and the project checklist | done | test/api.test.ts::setup prompt |
| R6 | §5 | Panels 1–4 show source text with link and date; 5–6 per-project request status, date, deadline, file | done | src/renderer/screens/TechRules.tsx |
| R7 | §5 | Read and encode LBN 201-15, 208-15, 211-15, 016-15, TIAN, LVS list, 2027-03-01 changes | not done | src/main/rules/types.ts |
| R8 | §5 | Public holidays excluded from the 11-working-day count (from the holidays act; Song Festival closing day not dated in the law text) | done | test/rules.test.ts::holidays: Easter by computus |
| V1 | §6 | Revision = IFC + view PDFs + JSON summary + log; diff by GlobalId and room table | done, not run live | test/loop.test.ts::revision 2 shows the difference |
| V2 | §6 | Working copy `_WORK.rvt`; snapshot before each batch; only approved revisions copied out | done, not run live | test/loop.test.ts::publishApproved refuses until everything is approved |
| V3 | §6 | Approval per page and per model: new / commented / approved; only Boris sets approved | done | test/tools.test.ts::approval is per item |
| V4 | §6 | Pins: page + normalised position + view + crop box, scale, origin; pin → model coordinates | done, not run live | test/tools.test.ts::pin → model coordinates |
| V5 | §6 | Pin on 3D model attaches to element GlobalId | done, not run live | src/renderer/screens/IfcViewer.tsx |
| V6 | §6 | Revit command 0: open/create document from office template | not done | src/main/api.ts |
| V6b | §6 | Active document checked against the expected working copy; `not connected` otherwise | done | test/revit.test.ts::wrong active document stops the run |
| V7 | §6.1 | Create views, scale | partial | test/docs.test.ts::prepare views |
| V8 | §6.2 | Create sheets and place views | done, not run live | test/docs.test.ts::view snippets stay small |
| V9 | §6.3 | Export PDF | done, not run live | test/revit.test.ts::exportPdf passes folder and file name |
| V10 | §6.4 | Export IFC with the office's export settings | partial | src/main/revit/commands.ts |
| V11 | §6.5 | Save a copy of the model | done, not run live | test/loop.test.ts::a batch becomes a revision |
| V12 | §6.6 | Read back view geometry (crop box, scale, origin, level) | done, not run live | test/revit.test.ts::viewGeometry maps Revit's reply |
| V13 | §6.7 | Link topo / cadastre, set shared coordinates | not done | spike/README.md |
| V14 | §6.8 | Roofs, stairs and similar sketch elements | not done | spike/README.md |
| V15 | §6 | Agent allow-list excludes delete_element and send_code_to_revit | done | test/engines.test.ts::Revit allow-list never contains delete_element |
| C1 | §7 | Setup chat interviews until checklist is full or unknown; writes brief.json | done | test/brief.test.ts::setup is complete only when |
| C2 | §7 | Every brief fact has a source: file + verbatim quote, or Boris's own words | done | test/brief.test.ts::a fact needs a quote |
| C3 | §7 | Chat agent reads files and rules only; cannot touch Revit | done | test/mcp-server.test.ts::setup mode |
| C4 | §7 | Small important material first in the prompt | done | test/loop.test.ts::open pins go into the prompt before |
| F1 | §8 | `.bv/` with project.json, brief.json, log.jsonl (append-only), revisions/, files.json | done | test/kernel.test.ts::createProject builds .bv |
| F2 | §8 | Source files registered with SHA-256; changed source flagged, diffed, new version | done | test/api.test.ts::file diff shows what changed outside the app |
| F3 | §8 | Any change to a document produces a new file with a version suffix, never an overwrite | done | test/files.test.ts::writeVersion never overwrites |
| F4 | §8 | Text diff for DOCX / XLSX / PDF text | done | test/docs.test.ts::DOCX and XLSX text can be read and diffed |
| F5 | §8 | No git inside project folders | done | src/kernel/project.ts |
| F6 | §8 | Original `.rvt` never used as the working copy | done | test/api.test.ts::the work copy must be a _WORK file |
| X1 | §9 | Electron + React + TypeScript | done | package.json |
| X2 | §9 | Engine seam takes two MCP servers (Revit + projektesana-tools) | done | test/engines.test.ts::two servers in one run |
| X3 | §9 / Boris 2026-11-05 | pi is the one harness (Claude Agent SDK and Codex SDK engines removed) | done | src/main/engines/pi.ts |
| X4 | §9 | projektesana-tools server with list_files, read_doc, project_brief, rules_for_stage, list_open_pins, resolve_pin, add_note, finish_revision | done | test/mcp-server.test.ts::model mode exposes the working tools |
| X5 | §9 | Viewers: pdfjs-dist and @ifc-lite; own annotation layer; two-revision comparison | done | src/renderer/screens/Views.tsx |
| X6 | §9 | All Revit access through one MCP client | done | src/main/revit/client.ts |
| X7 | §9 | Python IFC/document diff tools | later | src/kernel/diff.ts |
| X8 | §9 | Verification by typecheck, tests and build only | done | package.json |
| X9 | §2 | `src/kernel/` liftable: no imports from the rest of the app | done | test/kernel-liftable.test.ts::src/kernel imports only |
| D1 | §10.1 | Create project; pick folder; list | done | test/api.test.ts::create, list, forget |
| D2 | §10.2 | Drop in PU and site data; app proposes the role with a quote; Boris confirms | done | test/docs.test.ts::role proposal quotes the words it matched |
| D3 | §10.3 | Setup chat to a full checklist; rules panel shows group, procedure, sadaļas with articles | done | test/api.test.ts::setup chat |
| D4 | §10.4 | "Start modelling": agent creates levels, rooms, tags, views | done, not run live | test/loop.test.ts::a batch becomes a revision |
| D5 | §10.5 | Plan + elevation PDFs beside the IFC; pins, comment, approve two pages | done, not run live | src/renderer/screens/Views.tsx |
| D6 | §10.6 | Revision 2 shows the difference; approve the rest | done | test/loop.test.ts::revision 2 shows the difference |
| D7 | §10.7 | Approved model copy and PDFs in the project folder; log shows the day | done | test/loop.test.ts::publishApproved refuses until everything is approved |
| B0 | §11.0 | Spike with send_code_to_revit: PDF, IFC, model copy, crop box and scale | partial | spike/run-spike.ts |
| B1 | §11.1 | Foundation: repo, shell, `.bv`, registry, log, file registry, engine seam | done | test/kernel.test.ts::log appends |
| B2 | §11.2 | Rules module and setup chat | done | test/rules.test.ts::group: public building over 1000 m2 |
| B3 | §11.3 | Thin Revit loop | done, not run live | test/loop.test.ts::a batch becomes a revision |
| B4 | §11.4 | Viewers, annotation, pin → coordinates, revision comparison, IFC diff | done | test/files.test.ts::ifcDiff by GlobalId |
| B5 | §11.5 | Dashboard | done | src/renderer/screens/Dashboard.tsx |
| B6 | §11.6 | DWG, GP details, MBP/BP sections, other disciplines, shared family package | later | docs/superpowers/specs/2026-11-03-projektesana-app-design.md |
| Q1 | §12 | Room program source for a new build | waiting Boris | docs/superpowers/specs/2026-11-03-projektesana-app-design.md |
| Q2 | §12 | Revit template and version | waiting Boris | docs/superpowers/specs/2026-11-03-projektesana-app-design.md |
| Q3 | §12 | DWG: converted to PDF acceptable, or must the app show DWG | waiting Boris | docs/superpowers/specs/2026-11-03-projektesana-app-design.md |
| Q4 | §12 | First real project | waiting Boris | docs/superpowers/specs/2026-11-03-projektesana-app-design.md |
| Q5 | §12 | UI language | waiting Boris | src/renderer/App.tsx |
| U1 | §12 | Unverified: Revit snippets run against a live Revit; PDF crop-frame assumption; `@ifc-lite` picking in this app; Codex with two MCP servers | not done | spike/README.md |
| ST1 | Boris 2026-11-05 | Settings: provider, model and effort pickers from pi catalog + provider live lists (no typed model names) | done | test/api.test.ts::model list comes from pi's catalog |
| ST2 | Boris 2026-11-05 | Settings: sign-in buttons ChatGPT / SuperGrok, API keys per provider (encrypted); Claude = API key only | done | test/ui/screens.ui.test.ts::settings: provider list with connect buttons |
| ST3 | Boris 2026-11-05 | A model released after pi's version appears from the live list and can be used | done | test/api.test.ts::a model the provider lists live |
| L1 | Boris 2026-11-05 | Panels 1–4: add other LBN/MK/LVS/EU by link or file; read date shown and explained; text searchable; re-read keeps old version | done | test/ui/screens.ui.test.ts::laws: add a likumi.lv link |
| L2 | Boris 2026-11-05 | LVS and ES pages show the references found in texts already read | done | test/ui/screens.ui.test.ts::LVS and ES pages list references |
| L3 | Boris 2026-11-05 | Agent searches the library by tool and cites paragraph, source and read date | done | test/library.test.ts::agent tool search_sources |
| E1 | Boris 2026-11-05 | No black screen: error boundary keeps the sidebar; renderer crash reloads; errors written to a log file; F5 reload | done | test/ui/screens.ui.test.ts::every sidebar screen mounts |
| E2 | Boris 2026-11-05 | Root cause of the reported black chat screen | not done | src/renderer/ErrorBoundary.tsx |
| P1 | Boris 2026-11-05 (the point of panels 1–8) | Panels 1–8 are gathered by the agent from the project folder, not typed in: open the folder, every file registered in place, read once, role PROPOSED with the words that justify it | done | test/gather.test.ts::opening a folder adds .bv |
| P2 | Boris 2026-11-05 | Panel 7 (PU/BIP) and panel 8 (land, topo, Inv.lieta): one agent run fills facts, each with a verbatim quote that code checks; Boris confirms, corrects or rejects | done, not run live | test/ui/screens.ui.test.ts::first minute: pick the project folder |
| P3 | Boris 2026-11-05 | Panels 5–6: the agent finds technical-rules requests and received documents in the folder (file + quote), Boris confirms; deadline still computed by code | done, not run live | test/ui/screens.ui.test.ts::panel 5: the agent's technical-rules request |
| P4 | Boris 2026-11-05 | Panels 1–4: laws the project's own documents name (found by code, with quote, "not in the library" said plainly) and paragraphs the agent cites for this project (quote checked against the library, reason required) | done, not run live | test/gather.test.ts::cite_law |
| P5 | Boris 2026-11-05 | Group and procedure are computed by the rules engine and carry the rule's own words; a person's answer is never overwritten | done | test/gather.test.ts::group and procedure are computed |
| P6 | Boris 2026-11-05 | Nothing the agent read from a file counts as set-up until Boris confirms it; the gather agent has no `mark_unknown` and no approve tool | done | test/gather.test.ts::facts from a file are PROPOSED |
| P7 | Boris 2026-11-05 | "Savākt visu no mapes" on the project card runs the four groups in order and reports each; no agent connected → reason, recorded | done | test/ui/screens.ui.test.ts::Pārskats: 'Savākt visu no mapes' |
| P8 | Boris 2026-11-05 | Scanned PDFs without text, unreadable formats and files too large to register are listed as such, not skipped silently | done | test/gather.test.ts::opening a folder adds .bv |
| F1 | Boris 2026-11-05 | File pickers wherever a file is needed: technical-rules received file, chat attach, Revit MCP server, extra files on panels 7–8; every file can be opened in its own program | done | test/ui/screens.ui.test.ts::chat: attach a file from anywhere |
