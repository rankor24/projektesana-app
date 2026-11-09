# Projektēšanas App v2 — design decisions and facts

Date: 2026-11-05, revised through the evening. Status: **the decisions here are the user's; the work order is `v2-work-plan.md`.** This file holds what and why; the work plan holds what to do, in order.
Language rule: English prose; Latvian for UI strings, domain terms and file names.

---

## 0. Decisions the user has made (2026-11-05)

1. **Core = five steps**: Uzdevums, Izejas dati (with the existing-building model first), Skice, MBP and būvatļauja, Būvprojekts and ekspertīze. Iepirkums stays in the Konkursu App. Būvdarbi, nodošana and apsaimniekošana come later (parameters, BCF clash resolution, as-built checked against a laser scan). The three apps combine only when all three work.
2. **Any project size**, from a skice finished in a day to a project that runs two years.
3. **One main view**, as planned from the start: a **split view with the 2D/3D preview and annotation tools on one side and the agent chat on the other.** Not one page per stage. A stage is a position on a timeline, never a page that goes dead when the project moves on.
4. **BIM stages, each with its own deliveries**: Koncept, Skice, Tehniskais, Detalizācijas, Būvniecība, As-Built. A stage can have several deliveries (Detalizācijas often 3–4).
5. **The whole app is controlled by the AI agent.** It reaches every panel and all of their context, open or not. What the user selects (fields, rows, sheets, a panel) is **focused** for the agent, as in BIM Crew. Panels are floating windows over the preview, as in BIM Crew; they never replace the preview.
6. **Checks are everywhere.** Every stage and every action is checked. Pārbaude is not a page.
7. **Saskaņojumi belong to the timeline.** Technical conditions come before MBP for the design conditions, and again after for network connections, mostly MEP.
8. **Projekti and Pārskats are one thing. Avoti and Izejas dati are one thing.** No list appears twice.
9. **Precise citations** on every requirement, with the act version date.
10. **Checks run on all sheets and drawings**, not on whether each section has its own RVT file. (Section 6 point 5 of the earlier plan is dropped.)
11. **Fake tests deleted** (done, section 10). **Latvian OCR**: get it. **Old formats**: my call (section 8). **Node.js**: installed 2026-11-05.
12. **The main goal is unchanged: the AI agent models in 3D and 2D from the app.** The order of work is not a change of goal. Izejas dati comes first because v1 failed already there, at step 1, and nothing after it can be checked until the inputs are read correctly.
13. **Single-user.** Each person has their own projects and their own work; nothing is shared between users. App data stays on this PC with the app. The project folders on the office drive are read-only to the app.
14. **A totally new test pack.** The v1 tests are disposable. Each v2 step gets its own tests, on real documents. The 99 remaining v1 tests go with the code they test as that code is replaced.

---

## 1. Why gathering fails in v1

From reading the code and measuring real project folders read-only (the app could not be run on this PC until Node.js was installed today).

| # | Cause | Evidence | Effect |
|---|---|---|---|
| 1 | Opening a project scans the **whole** project folder, up to 5 000 files, including `1.2_Projekta dalas`, `02_Buvnieciba`, photos and archives | `src/main/gather/scan.ts` `walkProject`, called from `projectsOpenFolder` | BD424 has 1 645 photos in `1.1.03_FF` and 226 files in `1.1.12_arhivs`; BD410 has 547 archive files. All are registered and listed |
| 2 | Every file up to 100 MB is hashed with a whole-file synchronous read in the Electron main process | `src/kernel/files.ts` | The window freezes while an office network folder is read |
| 3 | The **role of a file is guessed from words in its text**, although the office folder standard already says what each folder holds | `src/main/files/roles.ts` | Wrong or missing roles; every file needs confirming |
| 4 | **`.edoc` is not read.** In BD427 the signed `.edoc` is the client's original PU package (PU docx + 4 annexes, 8 signatures) | `src/main/files/text.ts` reads only txt/pdf/docx/xlsx | The signed originals are "unsupported"; loose copies are read instead |
| 5 | **Duplicates are not recognised.** BD427 `Kadastrālā lieta.pdf` = `Pielikums Nr.1.pdf`; `TAA.pdf` = `Pielikums Nr.4.pdf` (same bytes) | hashes measured 2026-11-05 | The same document appears twice with different proposed roles |
| 6 | **Scans have no OCR.** BD427 `Pielikums Nr.3.pdf` is 15 pages of images | measured 2026-11-05 | Marked "empty"; nothing gathered |
| 7 | `.doc`, `.xls`, `.msg`, `.eml`, `.dwg` are not read | `text.ts` | Old client documents and correspondence are lost |
| 8 | Our own work files are registered as project inputs | BD427 `1.2.00_BIM\Inv_lieta\geom` (50 csv/txt), `tools` (14 ps1) | Noise in lists and in the agent prompt |
| 9 | The agent gathers about twenty single facts for the group calculation | `src/main/gather/sections.ts` | What the architect needs is not gathered: the room table, cadastral data, TAA findings, topo validity, TN conditions |
| 10 | The agent prompt lists every registered file | `buildGatherPrompt` | Thousands of lines of noise before the task |
| 11 | Panel 8 shows every file that is not PU or TN; panel 7 renders the same table | `src/renderer/screens/Inputs.tsx` | The long list shown twice |

---

## 2. What the office already defines (the app follows it)

Source: the office document "Projekta dokumentācijas organizatoriskā struktūra" (folder template `00_Projekta mapju koks`), checked against 27 project folders on the office drive on 2026-11-05.

| Folder | Office rule | How the app uses it |
|---|---|---|
| `01_Projektesana` | Design process only. **No new folders are created in it** | The app writes nothing into project folders |
| `1.1.1_Iepirkums` | Everything from the tender | Source of client requirements (TS, BIP); the tender itself stays in the Konkursu App |
| `1.1.2_Ipasuma dok` | Inventarizācija, zemesgrāmata, robežu plāns | Cadastral facts and the inventory room table |
| `1.1.3_FF` | Photo surveys, one folder per survey `YYMMDD_FF` | Shown as surveys (date, count), never as a file list |
| `1.1.4_PU` | PU attached to the contract, plus updated PU versions | Client requirements; PU versions compared |
| `1.1.5_Tehniskie not` | TN requested by the client or by us | TN items on the timeline with their clocks; conditions as requirements |
| `1.1.6_TOPO` | Topography; the latest is identified | Topo date and validity |
| `1.1.7_GI` | Geology | Present or missing |
| `1.1.8+` | Project-specific: TAA, info from the client, BIP, point clouds, archive, būvatļauja, BIS… | Role from the folder name; a new name is confirmed once |
| `1.2_Projekta dalas\1.2.xx_<sadaļa>\01_RVT, 02_DWG, 03_PDF, 04_IFC` | One folder per section; latest file kept, older ones in `arhīvs`; names `YYMMDD_nosaukums` | Sections in scope; the current sheets, models and IFC that the preview shows and the checks run on |
| `1.3_Komunikacija` | Correspondence | Later: TN requests and answers |
| `1.4_Nodevumi\SKICE / MBP / BP\YYMMDD` | Only what was submitted; dated the day of submission; files `<sheet no.>_<title>` | **Deliveries on the timeline are read from here**; names checked against the rule |
| `02_Buvnieciba\2.1–2.7` | Rīkojumi, FF, izpilduzmērījumi, izmaiņas, material approvals, protocols, communication | Later steps |
| All names | No diacritics; sequential numbering | Checked |

Office forms in the office forms folder `01_Veidlapas` (titullapa, autori, sastāvs, saturs, starplapas, skaidrojošais apraksts, pilnvaras, sapulču protokols, projektu vadības checklist) are the front matter and checklists deliverables are built from.

---

## 3. Project profile

A short set of facts, each with its source, that decides which deliveries and requirements apply:

- work type (jauna būvniecība, pārbūve, atjaunošana, restaurācija…), building group, procedure;
- deliveries in the contract (a skice only; skice and MBP; MBP and BP; BP only; a partial brief such as BD427's roof-structure DPU);
- sections in scope, read from the `1.2.xx` folders that exist (BD423 has only VD-SA and GP; BD404 has 21);
- funding (public or EU money adds the economic part; publicly funded group-III new build adds the BIM model, MK 529 74 and 74.1);
- client BIM requirements (BIP, LOD per stage).

A one-day skice therefore shows one delivery on the timeline, a short requirement list and the preview. A two-year BP shows six stages and twenty deliveries. Same view.

---

## 4. The one view

```
┌ BD427 · pārbūve · 2. grupa ─────────────────────────────── ⚠ 3 ─┐
│ Koncept ✓   Skice ◐ [260120 ✓][260211 ◐]   Tehniskais ○ (MBP · BP)   Detaliz. ○   Būvn. ○   As-Built ○ │
│ TN: Būvvalde ✓ 14.11 · Sadales tīkls ⏱ 6 wd · Ūdens ○          │
├──────────────────────────────────────────────┬──────────────────────────────────────┤
│  2D / 3D preview                             │  Agent                               │
│  AR-2-01 1. stāva plāns  ·  r3 ⇄ r2          │  Fokuss: AR-2-01, telpa 1-7, PU 12.3 │
│  [pins] [comment] [measure] [compare] [IFC]  │  > Telpa 1-7: 14,2 m² pret KL 15,1.  │
│                                              │    Ārsiena stāv uz KL ārlīnijas …    │
│                                              │  [Ko trūkst MBP?] [Pārbaudi lapu]    │
├──────────────────────────────────────────────┴──────────────────────────────────────┤
│ Projekts · Avoti · Prasības · Telpas · Nodevumi · Atmiņa                            │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar: project and timeline.** Project switcher and profile; the BIM stages with their deliveries as dated chips, read from `1.4_Nodevumi`; TN and approval items with their clocks on the same line, because they sit between deliveries. **Mapping (the user, 2026-11-05)**: `1.4.1_SKICE` and `1.4.2_MBP` belong to the BIM stage **Skice** (MBP is approximately the skiču stadija); `1.4.3_BP` spans **Tehniskais** to **Detalizācijas** (BP deliveries, DT deliveries); `Starpnodevums` and custom folders are deliveries inside whichever stage their date falls in; Koncept, Būvniecība and As-Built deliveries have no office folder yet and are entered by hand. Planned dates come from the BIP's schedule (grafiks) or a schedule the user provides; the app does not read the contracts folder. A counter of open findings. The timeline is always there, whatever the stage; past deliveries stay as history, future ones as plan.
- **Preview (left).** Sheets as PDF, the model as IFC, side by side when needed. Annotation: pins, comments, measure, compare two deliveries or two revisions. A finding from a check shows as a pin on the sheet or element it concerns. Clicking anything puts it in the agent's focus.
- **Agent (right).** The agent sees the whole project and every panel. **Fokuss** shows what the user has selected: sheets, pins, rooms, requirement rows, documents, a panel. Focused items go first in the prompt. The agent answers with citations or says "dokumentos nav". It extracts, drafts, annotates, and **models in Revit**, which is the main goal. The pattern that keeps that safe is v1's and Konkursu App's: narrow tools, no fact without a quote that code checks, short single-action Revit calls, a working copy, and the user's approval per sheet and per revision.
- **The rule, in three verbs (the user's question of 2026-11-05: "what if a code check fails because of a unique situation?").** **Code raises**: checks, citations, counts and clocks run deterministically and produce findings; a check never decides anything and never blocks by itself. **The agent proposes**: facts, requirements, drawings, Revit changes, and also *justifications* when a check fails for a real reason (on BD420 the inventory itself was wrong in three stairwells). **The user decides**: approves, rejects, or overrides a finding with a recorded reason ("Inv. lietas kļūda", with date and author), which closes it without changing the check. No one of the three has the last word alone. How much the agent may do before asking is a **per-tool approval level** in Settings, not a rule in the code (section 4.2).
- **Panels (bottom).** Each owns one list. **They open as floating windows over the preview, as in BIM Crew, and never replace it.** The preview is the main view and stays visible while a panel is open, because a panel is read against the drawing: the Telpas table next to the plan, a Prasības row next to the sheet it concerns. A panel window can be moved, resized, docked to the left or right edge, and minimised back to the bottom bar; several can be open at once; each remembers its place per project. A row in a panel and an object in the preview select each other: clicking a room in Telpas highlights it on the plan and in the model, clicking a pin opens its requirement row.
- **What the agent sees.** The agent has the context of **every panel, open or not**: each panel's list is a tool the agent can read at any time, so an unopened panel is not hidden from it. On top of that comes **Fokuss**: whatever the user has selected anywhere, in the preview (sheets, pins, rooms, elements) or in a panel (rows, documents, deliveries, a whole panel), goes first in the agent's prompt and is shown in the chat header so the user sees what the agent is looking at. The agent can also open and arrange panels itself, to show what it is talking about.

| Panel | The one list it owns | Notes |
|---|---|---|
| **Projekts** | Profile facts with sources; the timeline in full with dates | Projekti and Pārskats combined: the project switcher is here too |
| **Avoti** | Everything the project is based on: normatīvi (the law library, global, with versions and read dates) **and** this project's documents from `1.1` (PU and its versions, cadastral, topo, TAA, TN, permit, BIP), grouped by office folder, duplicates merged, `.edoc` opened with signers, scans with OCR, photo surveys as surveys | Izejas dati and the library were separate in v1; they are one list of sources |
| **Prasības** | Every requirement that applies, from any source: law by profile, PU, BIP, TN conditions, permit conditions. Per row: exact citation, where it applies (stage, delivery, section, sheet), how it is checked, status, evidence | Findings are rows with status "neizpildīts"; the top-bar counter opens this list filtered |
| **Telpas** | Rooms: inventory or Kadastrālā lieta table, model rooms, PU programme, per room with differences | The existing-building check and the programme check live here; export to Excel and to the Revit `INV Area` parameter |
| **Nodevumi** | Deliveries: for each, the sheets, documents and models it contains, as submitted, with the checks that passed or failed before it went out | The timeline's chips open here |
| **Atmiņa** | Project memory (section 5) | Replaces v1 "Žurnāls" |

Saskaņojumi: not a panel. A TN or approval is an item on the timeline (who, requested, received, valid until, approved, clock in working days) and its conditions are rows in Prasības. The documents themselves are in Avoti.

### 4.1 Preview, agent harness and what is reused

- **Agent harness**: pi 1.4, as in BIM Crew and the Konkursu App. One pi run connects two MCP servers: the app's own tools server and the **Revit MCP** (`mcp-server-for-revit`). v1 already has this wiring (`src/agent-pi/mcp.ts` `connectMcpServers`, `src/main/engines/index.ts` `revitLaunch`); the two-server test passed on this PC on 2026-11-05. It has never run against a live Revit; that is step 6's live check.
- **3D and 2D preview: BimCraft** (`repos\getcadcraft\bimcraft`, Apache-2.0, plain JavaScript modules on three.js, runs in a browser page, so it embeds in Electron). What it brings, already built and tested in its own repo:
  - its own IFC engine for IFC2x3, IFC4 and IFC4x3 (`app/ifc/`), with B-rep and NURBS geometry;
  - **Compare versions** (`ifc-compare.js`): two models, elements matched by GlobalId, added / removed / changed painted blue / red / ochre, lists and CSV;
  - **BCF 2.1** read and write with real camera viewpoints and snapshots (`bcf.js`), validated against the buildingSMART schemas;
  - clash check (`clash.js`), model checks (required properties, duplicate GlobalIds, elements on no storey), quantity and space totals;
  - plan view of a level beside the 3D view, measuring, sections;
  - its own DWG reader (`app/dwg/`) and PDF.js for sheets;
  - an **add-on API** (`addons/bimcraft-api.js`: model.read, selection, select, onChange, commands, panel sections). This is how the app and the agent drive the viewer: selection in the viewer becomes Fokuss; the agent selects, isolates and colours elements through it.
  - Licence: Apache-2.0 allows reuse in this app. The viewer is not given a name in the UI.
- **BimCraft's editing tools are for showing, not for modelling.** Every change to the model happens in Revit through the Revit MCP. The user uses the editing tools (walls, doors, windows, floors, rooms, dimensions, sections) to **draw what they want**: a wall moved, a door added, a room split. That sketch is an instruction to the agent, read through the add-on API with its GlobalIds and positions, together with pins and comments. The agent carries it out in Revit; the next export replaces the sketch with the real model, and the compare view shows whether the result matches the sketch. The sketch is never saved as the model.
- **BIM Crew** (`repos\BIM-AI-Crew`, branch `feat/agent-harness-v2`, commit `eb3edce` of 2026-11-05; the checked-out `main` holds only the early prototype). Compared on 2026-11-05 by reading the code:

| Feature | BIM Crew | BimCraft | Take |
|---|---|---|---|
| IFC engine | `@ifc-lite` (wasm), React viewer: select, box select, isolate, ghost, one section plane | own engine, IFC2x3 / IFC4 / IFC4x3, B-rep and NURBS, plan beside 3D, measure, sections | **BimCraft** |
| IFC compare | `ifc_diff_tool.py` through `ifcdiff` (IfcOpenShell), agent tool `compare_ifc_revisions`: JSON lists, nothing shown in 3D; needs Python packages this PC lacks | `ifc-compare.js`: matched by GlobalId, added / removed / changed painted in the model, lists, CSV, no Python | **BimCraft** for the view; BIM Crew's agent-tool shape (read-only tool returning groups) for the agent |
| BCF | `bcf_tool.py` via `bcf-client`: read, create, add topic and comment, snapshots, sorting by discipline, clash info from Solibri text, coordination report | `bcf.js`: BCF 2.0/2.1 read and write with real camera viewpoints from the viewer, selection, clipping, validated against the buildingSMART schemas, no Python | **BimCraft** for reading and writing; **BIM Crew's** discipline sorting and coordination report on top |
| Clash, model checks | none in the viewer (Solibri results come in as BCF) | clash worker, required properties, duplicate GlobalIds, elements on no storey | **BimCraft** |
| Model editing | `ifc_edit_tool.py`, `ifc_patch_tool.py`, `IfcMutationArtifact` (writes IFC) | IFC writer behind Draw tools and the add-on API | Neither writes the model; BimCraft's Draw tools are used for sketches only (above) |
| 2D page compare | `blueprint-diff`: PDF pages rendered to pixels, pixel diff on a 40 px grid into change zones, page pairing, an AI model (Gemini, Grok or Codex) describes the zones and reads the title block | none | **BIM Crew's**, improved (4.3) |
| Version control | `document_versions` table: numbered versions per document with text, revision code and file, compare and restore in `VersionControlPanel` | autosave and crash recovery only | **BIM Crew's** model, extended (4.4) |
| Agent harness | pi 1.4 runtime, approvals, agent tools | add-on API, no agent | **BIM Crew's** harness, BimCraft's API as the agent's hands in the viewer |

  Summary: for the 3D viewer, model compare, BCF and checks, BimCraft is more complete and needs no Python. For page compare, versioning and the agent, BIM Crew has what BimCraft lacks.

### 4.2 Per-tool approval levels (proposal; the user changes them in Settings)

Every agent tool has a level: **auto** (runs, result shown), **confirm** (runs after the user clicks), **never** (not offered to the agent). Defaults below. A failed check never changes a level; it only produces a finding that the user closes, overrides with a reason, or sends back to the agent.

| Tool group | Default | Examples |
|---|---|---|
| Read anything | auto | read a document, a panel's list, the model, the law library |
| Propose | auto, as proposals | set a fact with a quote, add a requirement row, write an Atmiņa note, propose a justification for a failed check; each is marked "ierosināts" until the user confirms |
| Annotate and show | auto | add a pin or comment, open or arrange a panel, highlight elements, draw a sketch in the viewer |
| Run checks, export | auto | run any check, export a room table, export PDF or IFC from Revit, save a working copy |
| Revit: create and modify | confirm per batch | levels, grids, walls, doors, windows, rooms, dimensions, views, sheets; one batch becomes one revision the user reviews |
| Revit: delete | never | `delete_element`; deletion is done by the user, or by the agent only after the user marks the element in the viewer |
| Decide | never | approve a sheet, close a finding, mark a delivery sent, confirm a fact: only the user's click |

### 4.3 2D sheet comparison

**Built in Projektēšanas App as part of v2 (the user, 2026-11-05).** BIM Crew's `blueprint-diff` is not changed; it can adopt the v2 version later when the apps combine. v2 starts from BIM Crew's code (page pairing, pixel diff into change zones, AI description of zones, title-block reading) and improves it where it is weakest. Its diff compares pixels in a 40 px grid, so a moved sheet frame or a different export scale makes everything "changed", and it cannot say what changed, only where. It also sends the drawing to an outside image model to describe the zones. The improvements below compare sheets by what they are made of:

1. **Same sheet, two deliveries or two revisions**, matched by sheet number.
2. **Vector compare** when both are vector PDFs: the drawing content is read with PDF.js, aligned on the sheet frame, and every line, text and dimension is classed as added, removed or moved. Changed dimension values and room areas are listed as text, not just coloured ("telpa 1-7: 14,2 → 15,1 m²").
3. **Overlay** for scans and raster PDFs: old in red, new in blue, common in grey, with a slider; alignment on the title block or on four picked points.
4. **Side by side** with linked pan and zoom, for the eye.
5. **Model-aware**: when the sheet comes from a Revit view whose geometry was recorded at export (crop box, scale, origin), a change on the sheet is traced to the IFC elements that changed between the two exports (`ifc-compare.js`), so a red cloud on the sheet names the wall that moved.
6. Every difference can become a pin, a BCF topic or a Prasības finding.

Points 2, 5 and 6 are the improvements over BIM Crew's version. Its pixel diff stays as the overlay mode (point 3), with alignment added, and its AI description of zones stays as an option once the vector compare has said what changed.

### 4.4 Version control: when and what changed

Yes, every change is versioned, without git in the project folders. The base is BIM Crew's `document_versions` model (numbered versions per document, revision code, compare and restore), extended to every kind of thing the app tracks:

- **Sources** (`1.1`): each document is registered by SHA-256; a changed file is a new version of the same document, never a replacement. Text documents show a text diff; PU versions show which requirement rows changed.
- **Deliveries** (`1.4_Nodevumi`): each dated delivery is a frozen version; any two can be compared (sheets as in 4.3, models as in 4.1).
- **Model revisions**: every agent batch or manual Revit save the app records produces a revision (IFC + sheet PDFs + room table); revisions compare by GlobalId and by room.
- **App data** (requirements, findings, pins, Atmiņa notes): an append-only history with who, when and why.
- **A timeline view** answers "kas mainījās starp 260120 un 260211": documents, requirements, sheets and model elements, in one list, each linked to its compare view.

---

## 5. Žurnāls, and what it becomes

In v1, Žurnāls is the append-only file `.bv/log.jsonl`: every file registered, every agent tool call, pin, approval and revision, with time and author. It is an **audit trail**: it answers "who did what, when" and nothing else. It is not knowledge.

v2 keeps the audit trail but hides it (it stays for "kad un kas"). What the user asked for is different and is a panel of its own, **Atmiņa**: the project's memory, readable and writable by the agent and by the user.

- **Decisions**: what the client chose and when (skice option, materials, scope), with the source message or protocol.
- **Answers**: what the client, būvvalde or a network owner said to a question.
- **Notes and learnings**: what the agent found out about this project (room naming conventions, inventory errors, tolerances agreed), kept so it never re-derives them.
- **Open questions**: what is still unanswered, who owes the answer.

Stored as markdown notes with front matter, one note per decision or topic, so they can live in or sync with the user's Obsidian vault and are searchable by the agent. This is the "local knowledge vault" the user described.

---

## 6. Checks: everywhere, on every action

There is no review stage. Checks run when a file is read, a sheet is exported, a delivery is prepared, a requirement is added, a pin is resolved. A failed check is a finding: a requirement row with status "neizpildīts", a pin on the sheet or element, a number in the top bar. A delivery can be marked "nosūtīts" only when its findings are closed and the user approves.

What is checked, on every sheet and drawing, not per file:

1. **Completeness for the delivery**: every requirement that applies to this delivery is met or has a recorded justification. MBP content per MK 529 26; BP content per MK 529 71 or 72, plus 73, 74, 74.1, 75.1 and the DOP (76–80) where the profile needs them; the permit's own conditions.
2. **One truth**: one address, one cadastral number and one set of areas across documents, sheets and models (a 2019 school BP sample had five different total areas).
3. **Model against sources**: inventory areas (existing buildings); the PU room programme; zoning numbers (intensity, green area, height, building lines).
4. **Coordination**: shared coordinates equal across section models; IFC classes (proxy count); clashes later through BCF.
5. **Deliverables**: file names follow the office rule (sheet number, title, no diacritics, `YYMMDD` folder); title-block fields per LBN 202-18; the sheet list of the delivery equals the sheet list in Revit.
6. **Citations**: every requirement still matches its source text (re-read of likumi.lv, PU version change).

---

## 7. Citations

Every requirement row carries:

- the verbatim text it was cut from;
- the exact place: act and point, e.g. **MK 529, 26.4.2.**, or PU file, page and line;
- for law: the act's consolidated version date shown on likumi.lv, the date the app read it, and a link to the point;
- when it applies (profile conditions) and from when (`valid_from`, e.g. the changes taking effect 2027-03-01);
- for territory rules: the version in force on the permit date (BL 16 1.1 d.).

v1's mechanism stays: a rule ships only if its quote is found in the saved likumi.lv text. It gains version dates.

---

## 8. Answers to the blocking questions

1. **Latvian OCR**: Windows has no Latvian OCR pack at all (checked 2026-11-05: 35 languages, no Baltic one), so the Windows engine is out. The app uses **tesseract.js** with the Latvian model: it runs inside the app, needs no admin and no install. Proof on the scanned BD427 annex is part of step 1. A page that still yields nothing is marked "skenēts — jāizlasa ar aci", never silently empty.
2. **Old formats, my call**: `.doc` and `.xls` through the installed Word and Excel, `.msg` through the installed Outlook, all via one small helper the app calls once per file and caches. No conversion by hand. `.dwg` stays unread (it is geometry; the PDF of the same sheet is read instead).
3. **Node.js**: installed 2026-11-05 (v26); the app typechecks, builds and runs its tests on this PC.
4. **App data**: single-user, nothing shared. The app and its data stay on this PC in the app's own folder; one data folder per project, keyed by the BD code. Nothing is written into the project folders on the office drive. v1's `.bv` folder inside the project root goes.
5. **Agent provider** (the user, 2026-11-05): **ChatGPT / Codex subscription sign-in is the default**; each user sets their own default in Settings. v1's pi engine already supports it. Claude stays API-key only.
6. **Revit** (the user, 2026-11-05): **Revit 2026**, new projects start from the office template `R26_Jaunbūve template 2026.rte` (on this PC in Downloads today; the app keeps its own copy in a templates folder and shows the template's date).
7. **Planned dates** (the user, 2026-11-05): from the BIP's schedule (grafiks) or a schedule the user provides. The app does not read the contracts folder.
8. **Privacy** (the user, 2026-11-05): the repo stays **public**. **No real data leaves to GitHub**: tests use invented names and invented documents that mirror the real structure (a made-up Kadastrālā lieta with made-up rooms, a made-up PU); acceptance on real projects happens only on this PC and is recorded in `docs/CHECKLIST.md` by result, not by content. Docs name projects by BD code only, no addresses, no client names, no office drive paths. This plan was scrubbed on 2026-11-05. Note: the v1 design spec and v1 tests already committed to the public repo contain a project address, a person's name and an old drive path; rewriting that history is the user's call.
9. **Revit export spike**: not now (the user, 2026-11-05); it runs before step 6.
10. **No mocks, no prototypes** (the user, 2026-11-05): the one view is built as the real app from step 1, not drawn first. Tests use invented fixtures (point 8); nothing else is ever a stand-in.
11. **New repository for v2** (the user, 2026-11-05). The v1 GitHub repo only served to move files to this PC and may be deleted; v1 history is not carried over. v2 starts as a fresh local git repo; the v1 code worth keeping (section 10) is copied in, read and cleaned, not moved wholesale. The GitHub remote is created when the user wants it, with the no-real-data rule from the first commit.

---

## 9. Build steps and acceptance (real projects, no fakes)

Each step is accepted by the user on real project folders, read-only, on this PC. Each step gets its own new tests, which run on **invented fixtures** that mirror the real documents' structure (section 8 point 8); the fixtures are built from what the real documents taught us, never from their content. Anything that needs Revit or an AI model is checked live and the result recorded. No step starts before the previous one is accepted: v1 failed at step 1 and everything built on top of it was unverifiable.

| Step | Builds | Accepted when |
|---|---|---|
| 1 | **The one view**: top bar with project and timeline, PDF preview of the project's documents and sheets, agent chat with Fokuss, panels Projekts and **Avoti** (real reading: office folders, hashing in a worker, duplicates merged, `.edoc` with signers, OCR, old formats) | BD424 opens without freezing and shows photo surveys as surveys; BD427 shows Kadastrālā lieta and Pielikums Nr.1 as one document, the `.edoc` with its 8 signers, annex 3 read by OCR; the agent answers a question about the BD427 PU with a page citation |
| 2 | **Prasības** with citations, and the checks of section 6 points 1, 2, 5, 6 running on every action | BD427: law rows by profile and PU rows from its docx, each with an exact citation the user can open; a wrong address in a test copy is found |
| 3 | **Telpas** | BD420 against the live Revit model gives the same differences as the `INV DIFF` sheets made by hand on 2026-11-04 |
| 4 | **Nodevumi** on the timeline, TN items with clocks, delivery checks | reference project B (MBP set): deliveries read from the folder, the three file-naming generations found |
| 5 | **BimCraft embedded** as the 3D/2D preview: IFC, compare versions, BCF, clash; the **improved sheet comparison** (4.3: vector compare, aligned overlay, model-aware tracing), built here and not in BIM Crew; version timeline (4.4) | reference project A (BP set): model and sheets side by side; two exports compared by GlobalId; a sheet change traced to the wall that moved; a finding exported as BCF and opened in Solibri |
| 6 | **Agent modelling from the app**, the main goal: existing building from the inventory first, then design changes; revisions as PDF and IFC, pins back to the agent, approval per sheet | BD427 live: the agent builds the existing-building model from the Kadastrālā lieta to the room-area tolerance, with grids first, one wall per wall, no rebuilds of what the user has fixed |
| later | Būvdarbi, nodošana, apsaimniekošana | — |

---

## 10. v1 code: kept, replaced, parked

- **Kept**: `src/kernel` (path guard, append-only log, file registry, copy-on-write; hashing moves to streaming), rules with verified quotes, the working-day calculator with holidays, the pi engine, the tools server, the law library, the PDF reading.
- **Replaced**: all screens and the navigation; `src/main/gather` (scan, roles, sections); the setup chat; the `.bv` folder inside projects.
- **Parked until their step**: the IFC viewer and pins (step 5), the agent modelling loop (step 6). They are the goal, not an afterthought; they wait only for the inputs to work.
- **Tests**: the fake ones were deleted on 2026-11-05 (39 deleted, 2 trimmed; 138 became 99; 28 checklist rows now say **not verified**). The remaining 99 are v1's and are disposable: they are not maintained and are removed together with the code they cover. On 2026-11-05 they ran once on this PC: 98 pass, 1 fails in the role-guessing code that v2 replaces.

---

## 11. Before step 1: what is still missing (re-read of the whole session, 2026-11-05 evening)

Honest answer to "do we have all we need to start building": **no.** The plan is a direction document. Three kinds of things are missing.

### 11.1 Mine to write before any code (no answer needed)

| # | Missing | Why it blocks |
|---|---|---|
| M1 | **Data model**: Project, Source and its Versions, Fact (value + verbatim quote + page), Requirement, Finding, Delivery, Revision, Pin, Note. One short schema document | Every panel reads and writes these; without one definition each panel invents its own, which is how v1's "Faili šajā panelī" happened twice |
| M2 | **The agent's tool list** for v2 and the Revit allow-list, plus how the `revit-modeling`, `revit-drafting` and `revit-dimensioning` skills get into the app (Konkursu App copies skills from `~/.claude/skills` at build time with `scripts/sync-skills.mjs`; same pattern here) | The agent's power is its tools; the skills built this week on reference projects A and B are its modelling knowledge and are not mentioned anywhere in v2 |
| M3 | **Step 1 acceptance script**: the exact clicks on BD424 and BD427 and what each must show | "Accepted by the user" needs a list, or it becomes "looks fine" |
| M5 | **Geometry from the Kadastrālā lieta** (lines and points to CSV, done as scratch tools on BD427 this morning) belongs in step 3 as a feature, not a scratch script | Day one of an existing-building project is modelling it; until step 6 the user models by hand and this is what speeds it up |

### 11.2 The user's answers (2026-11-05, evening)

| # | Question | Answer | Where it landed |
|---|---|---|---|
| B1 | Stage mapping: office folders are `1.4.1_SKICE`, `1.4.2_MBP`, `1.4.3_BP` plus `Starpnodevums` (21 of 25 projects have the folder, 6 have files) | MBP ≈ BIM Skice; BP ≈ Tehniskais to Detalizācijas | section 4, top bar |
| B2 | Planned dates, since most `1.4` folders are empty | From the BIP's grafiks, or the user provides one; contracts folder not read | section 8 point 7 |
| B3 | Public repo, test data, names in docs | Keep public; invented names and invented data in tests; no real data to GitHub | section 8 point 8; this plan scrubbed |
| B4 | Agent provider and key | Codex subscription sign-in is the default; each user sets their own | section 8 point 5 |
| B5 | Revit version and template | Revit 2026, `R26_Jaunbūve template 2026.rte` | section 8 point 6 |
| B6 | "Code owns the checks, the agent does the work, the user decides" | Not sure: a code check can fail in a unique situation | rewritten as three verbs in section 4, with per-tool approval levels in 4.2 |
| B7 | Run the Revit export spike now | No | section 8 point 9 |

### 11.3 Spikes to run before their step

| # | Spike | Blocks |
|---|---|---|
| S1 | **tesseract.js with the Latvian model** on BD427 `Pielikums Nr.3.pdf` (started, interrupted; not proven) | Step 1 |
| S2 | **BimCraft inside Electron**: its ES modules, wasm and workers under vite; selection through the add-on API | Step 5 |
| S3 | **Revit MCP exports** with short `send_code_to_revit` calls on the live Revit: PDF of a view, IFC with the office settings, save a copy, read a view's crop box and scale. v1's spike never ran. The server is the Revit MCP bundle on the office template drive (`payload\node-server\build\index.js`), with its own Node runtime installed under the user's local app data | Step 6 |
| S4 | **Missing Revit MCP commands** (v1 §6 list of eight: open from template, views and scale, sheets, PDF, IFC, save copy, view geometry, link topo) are still missing; which become named commands | Step 6 |

What is settled and does not need revisiting: the one view with floating panels (BIM Crew's `FloatingWindow.tsx` and `WindowLayer.tsx` on branch `feat/floating-workspace-ui` exist and can be taken), the panel list, checks everywhere, citations, BimCraft for the viewer, the improved sheet compare built here, versioning, single-user, new tests, step order.

## Appendix: the process, verified

Read on 2026-11-05 in the current likumi.lv text (the app's snapshots of 2026-11-03, or fetched that day).

| Step | Legal anchor |
|---|---|
| Uzdevums | MK 500 18.1–18.4 (what the PU states; carbon-binding materials for publicly funded new builds); BL 19.1 2. d. (the client prepares the PU) |
| Izejas dati | MK 500 18.1, 19, 22 (investigations); 38.6 (existing building's condition); BL 16 2. d. (design only with sufficient information) |
| Skice | MK 500 26.1.1–26.1.2 (koncepcija, skiču projekts); 26.2 (client approves solutions) |
| MBP un būvatļauja | MK 529 6 (intent types), 26 (MBP content, incl. planned simultaneous users in 26.1); BL 15 (permit conditions); decision within a month (MK 500 12.2.1) |
| Nosacījumi | MK 500 27.1–27.3 (TN 11 wd, networks up to 20; approvals 15 wd, up to 20); MK 529 62, 81–82 |
| Būvprojekts | MK 529 71 (group II), 72 (group III, UPP 72.5), 73, 74, 74.1 (BIM), 75.1, 76–80 (DOP); 83 (legal expertise: structures and fire); 87 (one electronic copy in BIS); mark 15 wd (MK 500 12.2.4); BL 16 1.1 d. (territory rules frozen at permit date) |
| Later steps | BL 16 2.2 d., 17, 21; MK 500 X (autoruzraudzība); MK 529 167 (11 acceptance attachments), 176 (warranty 3 / 5 years); DMPL 6 |

Not verified yet: MK 500 annex 1 group thresholds (in the rules module, not re-read); the text of the 2027-03-01 changes; LBN 405-21; MK 353 status.
