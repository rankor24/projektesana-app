# Phase 0 spike (throwaway)

**Status: NOT RUN.** No Revit instance was connected when this was built (`list_revit_instances` → count 0). Everything the app does with Revit
(`src/main/revit/commands.ts`) is written from the add-in source (`ExecuteCodeEventHandler.cs`: `Execute(Document document, object[] parameters)`,
result serialised as JSON) and the Revit API, and is tested only against a fake Revit (`test/helpers.ts`).

## Run it (Boris)

1. Open any model in Revit with the MCP switched on, a floor plan view in it.
2. `node --import tsx spike/run-spike.ts "D:\Code\BIM\revit-mcp\server\build\index.js" "D:\temp\spike-out"`
3. Read the table. It exports the active document only; nothing is saved or changed.

## What each line decides

| Line | If it fails |
|---|---|
| export PDF + PDF file exists | check the file name Revit gives; adjust `exportPdf` options (`PDFExportOptions` needs Revit ≥ 2022) |
| PDF content rectangle | crop boundaries not drawn → pins cannot be turned into model coordinates; try `HideCropBoundaries = false` options or measure from sheet viewports |
| view geometry | `ViewPlan`-only fields; sections/elevations return `level: null` (expected) |
| export IFC + file exists | IFC export may need `transactionMode: "auto"` (already set) or office export settings (skills `revit-ifc-export-classes`, `ifc-property-set-txt`) |
| model summary | rooms/levels/wall+floor counts for the revision summary |

Items from spec §6 not covered by the spike because they need design decisions or are not Revit-API-trivial: create/duplicate views and sheets,
open/create a document from the office template, link topo + shared coordinates, roofs/stairs. They stay on the list in `docs/CHECKLIST.md` as `not done`.
