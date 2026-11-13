# Phase 8: finished (2026-11-13), what is true now and what nobody has looked at

Branch `v2.5`, nothing pushed. One commit per task, 8.0 to 8.15 (`git log --oneline`), then the audit pass of 2026-11-13: `8.2 fix`,
`8.14 fix` and two `audit:` commits. Last run: typecheck clean, **407/407 tests**, `npm run build` OK, `npm run audit` = **63 tasks** with every
planned file, test and tool present; `docs/CHECKLIST.md` is committed with a "live" note per 8.x task (`scripts/audit.ts` LIVE).
The plan rows in `docs/v2-work-plan.md` describe what was built, including every deviation from BIM Crew. The BIM Crew file each
task ports is in a **git note** on its commit (`git log` shows it; the messages themselves did not say, against the phase rule).

What the audit pass found and fixed:
- 8.2: the PDF view had no **Skice → aģentam** (the plan's toolbar is one for PDF and IFC): now a dragged rectangle + the note go to the Fokuss as a sketch.
- 8.14: **Nolasīt atzinumu** promised the role "Ekspertīzes atzinums" and never set it: now through Avoti's `sources.setRole`, on the user's click only.
- The audit had silently skipped **8.8** (a carriage return in its row where `memory\rejected` was meant) and never checked **8.14's files**
  (an unescaped `|` shifted its columns): both rows fixed, and a row that does not parse or has the wrong cell count now fails the audit.

## What was never looked at (say this to anyone who asks "does it work")

- **No screen of 8.2 to 8.15 has been seen by anyone**: typecheck, build and tests only (the user's rule: no UI automation on their app). First things to look at:
  Nodevumi → Pārdēvēt (8.12), Prasības → Ekspertīze (8.14), Iestatījumi → Aģenti (8.15), the indented lane lines in the agent dock (8.15).
- **Word through COM (8.13)** was run for real on invented documents (all seven ops, PDF), not on a real project document.
- **Ekspertīze (8.14)** reads three layouts, tested on invented reviews only. A real Latvian atzinums may use a layout none of them match; the agent's `expert_add` is the way for those.
- **Sub-agents (8.15)** were tested with scripted agent loops. No lane has run against a real model; each lane spawns its own tools-server process (and a Revit MCP only if a Revit tool is given to it).
- Revit paths of 8.9 (levels of the open document) are untested live. The BIP's tables are not read (8.9 seeds from models and typed values). Checkpoint copies are not pruned (8.7).

## Traps that cost time (still true)

- Windows PowerShell 5.1 reads a **BOM-less UTF-8 .ps1 as ANSI** and treats curly quotes as string delimiters: `resources/office-word.ps1` has a BOM and uses « ». PowerShell variables are case-insensitive (`$ops` overwrote the `-Ops` parameter).
- The fixed context every request carries is guarded at 10 000 estimated tokens (`test/0.6-session-context.test.ts`); it was 9.0K before 8.13. Every new tool's description is paid on every request: keep them short.
- Tests: run with Temp on D: (`TEMP='D:\Temp\pj-tests' TMP='D:\Temp\pj-tests' npm test`). `D:\Temp\pj-tests` and the ~2,500 `pj-*` folders in `C:\Users\BD30\AppData\Local\Temp` are the user's to empty (never-delete-a-folder rule).
- Shell escaping: backslashes and `${}` in heredoc scripts get mangled; write `.mjs` edit scripts with the Write tool, or use Edit.
- Do not `git stash` with a working tree full of untracked work.

## Rules from the user's CLAUDE.md that bite here

Never delete a folder. Delegation is opt-in (ask before spawning a subagent). No real project data in the repo, tests or commits. Private repo stays private. Latvian UI text, English code and docs.
