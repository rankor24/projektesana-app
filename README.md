# Projektēšanas App v2

Design workstation for SIA BŪVDIZAINS: one split view (2D/3D preview with annotation, agent chat) and floating panels
(Projekts, Avoti, Prasības, Telpas, Nodevumi, Atmiņa). The agent works through tools only; Revit through the Revit MCP only.

- Design decisions and facts: `docs/v2-design.md`
- Work order: `docs/v2-work-plan.md`
- Status per task: `docs/CHECKLIST.md` (kept by `npm run audit`)

## Rule: no real data in this repository

Tests run on invented fixtures under `test/fixtures/` (made-up names, numbers, addresses). Real projects are read only by the
running app on Boris's PC, from the office folders, which are read-only to the app. Nothing from a real project — file, name,
address, cadastral number, screenshot, log — is ever committed, including in commit messages.

## Commands

```
npm install
npm run typecheck
npm test
npm run build
npm start
```

Stack: Electron 43, React 19, Vite, TypeScript ESM, pi 1.4 (Codex sign-in default), pdfjs-dist, tesseract.js (Latvian), fflate.
