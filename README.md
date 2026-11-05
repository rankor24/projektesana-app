# Projektēšanas App

Desktop workstation for architectural design under Latvian building law (LBN / MK), from sketch to MBP to BP. An agent (Claude Agent SDK or Codex) draws and models in Revit through the Revit MCP; the result appears as PDF sheets and an IFC model; Boris pins, comments and approves page by page; everything is logged.

Design: `docs/superpowers/specs/2026-11-03-projektesana-app-design.md` · Plan: `docs/superpowers/plans/…-plan.md` · **Status against the design: `docs/CHECKLIST.md`**.

## Run

```bash
npm install
npm test            # unit + integration tests (spawns the built tools server: run npm run build first)
npm run typecheck   # main + renderer
npm run build       # tsc main, vite renderer, preload.cjs
npm run audit       # cross-checks docs/CHECKLIST.md against files and tests
npm start           # build + open the app
```

First run: Iestatījumi → Claude API key (Console key, stored encrypted) or Codex login; Revit MCP server path (`D:\Code\BIM\revit-mcp\server\build\index.js`).

## Revit has not been run yet

Everything that touches Revit was written from the add-in source and the Revit API and tested against a fake Revit (`test/helpers.ts`). Run the spike first, with a model open: see `spike/README.md`.

## Layout

| Path | What |
|---|---|
| `src/kernel/` | Liftable core (no imports from the rest): path guard, append-only log, project folder contract `.bv/`, file registry with SHA-256 and blobs, diffs (text, IFC by GlobalId, rooms), pins and review state |
| `src/main/rules/` | Rules module: `data/rules.json` is built by `scripts/build-rules.ts` from likumi.lv snapshots in `data/law-snapshots/`; quotes are cut out by code and verified by `verify.ts` |
| `src/main/chat/` | Setup chat prompt and the brief (facts need a verified quote) |
| `src/main/revit/` | One MCP client into Revit and the small snippets the app sends itself |
| `src/main/loop/` | Agent batch → revision (PDF, IFC, summary, diff), prompt order, PDF content rectangle |
| `src/mcp/` | `projektesana-tools` stdio MCP server (setup and model modes) |
| `src/renderer/` | UI: dashboard, laws 1–4, technical rules 5–6, PU / data 7–8, chat 9, views 10 (PDF + IFC), history |

## Rules the code enforces

- The agent has no tool to approve a page, delete an element, run raw Revit code, or write a source file.
- A brief fact needs a verbatim quote that code finds in a registered file or in Boris's own chat message.
- A rule ships only if its quote is in the likumi.lv snapshot; "Pārlasīt avotus" re-reads the live pages.
- Project folders get only a small `.bv/` folder (and `Izejas dati`, `Modelis`, `snapshots`, `approved`); no git is created inside them.
