# Projektēšanas App Implementation Plan

> **For agentic workers:** executed natively in one session (Boris: "Implement all phases"). Steps use checkboxes; the final audit task re-checks every box against the spec.

**Goal:** Desktop app where an agent models in Revit, Boris reviews PDFs/IFC with pins, approves per page, everything logged; law-grounded rules module and setup chat.

**Architecture:** Electron + React + TS (ESM, same toolchain as Konkursu App). `src/kernel/` is liftable (no app imports). Two MCP servers per agent run (Revit MCP + `projektesana-tools`). Revit reached through one stdio MCP client.

**Tech Stack:** Electron 43, React 19, vite 8, tsx test runner (`node --test`), `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, `@modelcontextprotocol/sdk`, zod, `pdfjs-dist`, `@ifc-lite` (verified at install).

**Spec:** `docs/superpowers/specs/2026-11-03-projektesana-app-design.md`

## Global Constraints

- Source files never written; copy-on-write with version suffix (§8).
- Log `.bv/log.jsonl` append-only; nothing deleted (§6, §8).
- Only Boris sets `approved`; agent tools cannot (§3 anti-goals).
- A rule ships only with a verbatim quote verified against a likumi.lv snapshot (§5).
- No fake/demo data: empty states say `no data` / `not connected` / `not configured` / `run scan`.
- Agent allow-list excludes `delete_element` and `send_code_to_revit` (§6).
- Claude = Console API key only; Codex = subscription login (§9).
- Prompt order: brief, rules, open pins first; long docs last (§7).
- Verification = lint/typecheck, tests, build only. No browser/preview testing. Never delete a folder. No git commit unless asked.
- UI Latvian, code English (§2).

## Review Focus

- File path outside project / `..` traversal → guard denies (task 1).
- Source file changed on disk → flagged `changed`, new version registered, original untouched (task 2).
- Log line torn/corrupt JSON → reader skips and reports, never throws (task 1).
- Rule quote edited → verifier fails (task 5).
- Agent asks to set `approved` → refused (task 8).
- Revit not connected → `not connected` state, no crash (task 7).

## Tasks

### Task 1: Kernel — guard, log, project contract
Files: `src/kernel/{guard,log,project,registry}.ts`; test `test/kernel.test.ts`.
- `checkRead/checkWrite(cfg: {root:string}, p:string): {ok:true,path}|{ok:false,reason}`; `.bv/` writable only via kernel.
- `appendLog(root, entry)`, `readLog(root): {entries, bad:number}`.
- `createProject(root, name)` makes `.bv/{project.json,log.jsonl,revisions/,files.json}`; `loadProject`.
- `Registry` (app-level projects list JSON): add/list/forget (forget never deletes folder).
- [ ] tests → fail → implement → pass.

### Task 2: Kernel — file registry, copy-on-write, diff
Files: `src/kernel/{files,diff}.ts`; test `test/files.test.ts`.
- `registerFile(root, path, role?)` → sha256+size; `rescan(root)` flags `changed`; `writeVersion(root, srcPath, content, outDir)` → `name_v2.ext`, never overwrite.
- `textDiff(a,b)` line diff; `ifcDiff(a,b)` by GlobalId (added/removed/changed); `roomDiff`.
- [ ] tests → implement → pass.

### Task 3: Shared types + engine seam with N MCP servers
Files: `src/shared/types.ts`, `src/main/engines/{types,claude,codex,index}.ts`; test `test/engines.test.ts`.
- `RunOptions.mcp: Record<string, McpLaunch>`; allow-list built from per-server tool lists; Claude `mcpServers` map; Codex `mcp_servers` + `enabled_tools`.
- [ ] tests on `claudeOptions`/`codexConfig` with two servers; deny of `delete_element`/`send_code_to_revit`.

### Task 4: Phase 0 spike scripts (throwaway)
Files: `spike/*.cs-snippets.json`, `spike/README.md`. Short `send_code_to_revit` snippets: export PDF, IFC, save copy, read view crop/scale. **Cannot run without live Revit; stays `not run`.**

### Task 5: Rules module
Files: `src/main/rules/{data,engine,verify,checklist}.ts`, `data/rules.json`; test `test/rules.test.ts`.
- Rule: `{id, act, actId, article, url, read_on, valid_from, valid_to, applies_when, requires[], quote}`.
- `groupOf(facts)` (MK 500 annex 1), `procedureOf(facts)` (MK 529 §7.x), `requiredSections(group, stage)`, `technicalRulesDeadline`.
- `verifyRules(rules, snapshotDir)`: quote ⊂ normalized snapshot.
- `checklist(facts)` from §7 list.
- [ ] tests incl. tampered quote.

### Task 6: projektesana-tools MCP server + setup chat + brief
Files: `src/mcp/server.ts`, `src/main/chat/{setup,brief}.ts`; test `test/tools.test.ts`.
- Tools: `list_files, read_doc, project_brief, rules_for_stage, list_open_pins, resolve_pin, add_note, finish_revision`; none sets approval. Brief facts need `source` (file+verbatim quote verified, or `Boris, date`).
- [ ] tests: quote verification, approval refusal.

### Task 7: Revit client + commands
Files: `src/main/revit/{client,commands}.ts`; test `test/revit.test.ts`.
- stdio MCP client to `revit-mcp` server; `status()` → connected|not connected; `exportPdf, exportIfc, saveCopy, viewGeometry` via snippets; JSON parsing of results.
- [ ] tests with parsing fixtures from real Revit API shapes only; live = `not run`.

### Task 8: Revision loop
Files: `src/main/loop/{revision,pins,approval}.ts`; test `test/loop.test.ts`.
- `startRevision`, `finishRevision` (IFC+PDF+summary+log), per page/model state `new|commented|approved`, `approve()` only from UI IPC, pin store with page/normalized pos/view/crop/scale/origin, `pinToModel()`.
- [ ] tests incl. pin math and approval completeness.

### Task 9: Electron shell + IPC + UI (screens 1–10 + dashboard)
Files: `src/main/{main,ipc}.ts`, `src/main/preload.cts`, `src/renderer/**`.
- Sidebar 1–10, dashboard (projects, create, tasks, calendar), PDF viewer (pdfjs) with pins, IFC viewer, compare, diff view, theme.
- [ ] typecheck + build.

### Task 10: Audit
- [ ] Walk spec §1–§13, tick each requirement with file evidence in `docs/CHECKLIST.md`; run typecheck, tests, build.
