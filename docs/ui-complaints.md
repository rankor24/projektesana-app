# UI design: Boris's complaints and what they require

Collected from the Phase 9 / version 2.6 sessions (2026-11-19 and 2026-11-20). His words are quoted as he wrote them. Each item
says what was built, what is still open, and where it stands. Status is as of version 2.6.2 plus the unreleased window-controls
fix (`14e0b8a`). "Open" means nothing has been done about it yet.

## 1. Principles he has stated (the rules every UI change has to meet)

| # | Principle | His words |
|---|---|---|
| P1 | The app copies BIM Crew's window system, whole | "look in bim-crew and copy whole thing how it works" · "I REPEAT AGAIN SEE HOW BIM CREW HANDLES IT!!!" |
| P2 | Every panel and tab is movable and detachable | "ALL PANELS MUST BE DETACHABLE AND COMFORTABLE TO MOVE AROUND" · "all panels and tabs are movable, so no matter how they start" |
| P3 | The app remembers how he arranged things | "make sure app remembers how panels were set up by user if it was changed" · "Thats the whole point of them staying where i placed them" |
| P4 | Nothing reloads or disappears when the page changes | "each time pages changes ifc viewer has to reload, why? why windows not persistent?" · "Why windows not staying visible when i switch page like in bim-crew?" |
| P5 | Every control is visible and clear | "UI IS NOT CLEAR TO SEE ALL BUTTONS" · "why they dissapear of the screen?" |
| P6 | The whole UI is one style at one scale | "its scale is wrong comparing to other app text and buttons sizes" · "so one style?" |
| P7 | Pages behave consistently | "Why only Overview, Schedule and Delivery keep as main view ... why others all opening as right side tabs?" |
| P8 | Not cluttered, readable | "Look how overcluttered it gets" · "all panels Tabs and so on are very hard to read and understand. UI still needs a lot more polish" |
| P9 | Start places do not matter, the setup does | "headers work differently now ... no matter how they start" |
| P10 | Real screenshots, not drawings | "what the fuck is that? place screenshots" |
| P11 | Everything must be reachable | "are you sure all systems have page and panel and easy accessible?" |
| P12 | Do not put useless things in | board comment: "not placing useless stuff" |

## 2. The complaints

### A. The Whiteboard plan against what was built

| # | Complaint | Status |
|---|---|---|
| A1 | "I dont see Comment Tools bar as is planned in 'Projektesana UI layout plan'" | Built as a column in 2.6, then made a window. The placement is still wrong, see B1. |
| A2 | "place current each page onto Whiteboard to compare with what we planned. Analysis what you missed and differed" | Done. 32-row gap table (X1–P6) with a verdict per row, then decision table at x=5450. |
| A3 | "what the fuck is that? place screenshots" | Done. My wireframes were removed, real screenshots placed. |
| A4 | "update Projektesana UI layout plan with new screenshots and analysis of features" | Done. Section "Version 2.6 as built", 10 screenshots plus a feature table. |
| A5 | Board marks: "HEADERS EXIST" on the Koordinācija / Versijas / Telpas / Pārskats header rows | Taken as settled: those rows were dropped from the work. |
| A6 | "if it differs think if now is better for my overall vision and should be kept as is?" | Answered per row in the decision table (D10: kept as built). |
| A7 | "Can we edit BIm-craft viewer too? ... UI is very weak in bim-craft now can be more compact tool belts and panels" | Done through our own add-on: 13 px type, the app's palette, dark, metric units. See E2 for what is left. |

### B. Where things are (placement and consistency)

| # | Complaint | Status |
|---|---|---|
| B1 | "Comment tools not in the approved places, why at the top?" (the plan: a slim column at the canvas edge) | Open. The slim slot beside the chat dock is planned, not built. |
| B2 | "wy commenting tool bar not attachable like all other?" | Done in 2.6.1: it is a window (`tools`) that floats, docks on any side, joins a tab group, pops out. |
| B3 | "Why only Overview, Schedule and Delivery keep as main view and force IFC viewer to be split horizontally? Why these 3 pages not together on left menu sidebar? why others all opening as right side tabs?" | Open. Waiting for his choice between A (every page opens beside the viewer) and B (every page is a main page). |
| B4 | "why split in the middle is not movable?" (page panel against the viewer, and two viewer panes) | Open. A drag handle with a remembered position is planned. |
| B5 | "Look how overcluttered it gets" (right dock with Changes / Sources / Requirements / Memory / Regulations / Files / Rooms, bottom dock with Versijas and Koordinācija windows, the model squeezed to a sliver) | Open. Planned: docked windows belong to their page and are shown only there. |
| B6 | "A lot of functionality for 2D not in place ... PDF/DWG/DOCS diff not in place and not visible in app or unaccessible" | Done in 2.6: Compare two files (Versijas, ⇄ in Faili and Avoti, Ctrl+K, the agent), PDF overlay or A \| B, DWG in CadCraft, documents word by word. |

### C. Windows: moving, resizing, staying

| # | Complaint | Status |
|---|---|---|
| C1 | "Resizing windows inside app sticks still sticks to mouse and laggy" | Fixed in 2.6.1: cover sheet over iframes, and geometry written straight to the element, so contents are not redrawn per pixel. |
| C2 | "even moving windows not working, they fly back to same place" | Fixed in 2.6.1 (the drop position was read from a stale value). |
| C3 | "Why windows not staying visible when i switch page like in bim-crew?" | Floating and docked windows share one layout since 2.6.1. Piling up is the open side of this, see B5. |
| C4 | "each time pages changes ifc viewer has to reload, why? why windows not persistent?" | Fixed in 2.6.2: the viewer and the 3D scene stay mounted and are only hidden. |
| C5 | "copy whole thing how bim-crew works, with bigger resize handles" | Mostly done in 2.6.1: shared layout, direct drag, 10 px edges and 22 px corners, Alt+drag, maximize. Not done: BIM Crew's edge-snap preview (half / quarter / full screen). |
| C6 | "if you set some default opening size for windows its all too small" | Fixed in 2.6.1: a new window opens about 55% × 72% of the screen, never under 720 × 520. |
| C7 | "app should open full Maximized size by the way" | Fixed in 2.6.1. |
| C8 | "I dont like how windows contolls look and behave, why they dissapear of the screen?" | Fixed in the source (`14e0b8a`, not in the 2.6.2 exe): tabs scroll in their own area, the buttons are pinned icons with tooltips, × shows on the front tab and on hover. |

### D. The chat

| # | Complaint | Status |
|---|---|---|
| D1 | "What the hell is that Conversation list? Chat is unusable that way." | Fixed in 2.6.2. |
| D2 | "NO APP ON A PLANET PUTS IT IN A CHAT" | Fixed in 2.6.2: the list is its own window, "Sarunas" (BIM Crew's Chat history), opened from the rail or one slim button in the chat header. The header keeps one line. |

### E. Readability and polish

| # | Complaint | Status |
|---|---|---|
| E1 | "all panels Tabs and so on are very hard to read and understand. UI still needs a lot more polish" | Partly: the tab strip (C8). Open: the rest of the pass below. |
| E2 | The BimCraft frame shows its website chrome ("Dev shell" badge, "About BimCraft", help button, PAPER / MODEL toggle) | Open. To hide in the shared stylesheet; same for CadCraft. |
| E3 | The Models table in the bottom dock is spread wide: the folder on the far left, the file name in the middle, the size on the far right | Open. |
| E4 | The comment tool bar's chips are low-contrast and dashed ("pick on the page") | Open. |
| E5 | "What is that?" (the Schedule key floating over the top bar) | Fixed (own class `gkey`, in 2.6.1). |
| E6 | CadCraft: "ca-craft ui also then needs adjustment in scale of text and buttons like bim-craft had" · "make PDF comparison viewer ... in style of new redesigned for our app size ... so one style? maybe even docs?" | Done in 2.6: BimCraft, CadCraft, the PDF and document viewers share one stylesheet and the same compact bar. |
| E7 | A red "null" box at the top of the Agents window (first screenshot, 2026-11-20) | Open. I could not trace it by reading; needs a reproduction. |

## 3. Open, in order of how often he has raised it

1. **One way for every page to open** (B3), waiting on his pick of A or B. It decides the rest of the layout.
2. **Overcrowding** (B5): docked windows belong to their page.
3. **Comment tools in the right place** (B1): the slim slot at the canvas edge.
4. **A movable split** (B4).
5. **The readability pass** (E1–E4): BimCraft chrome hidden, the Models table, low-contrast chips, and tab titles that say what the tab is.
6. **BIM Crew's edge-snap preview** (C5) if he still wants it.
7. **The "null" box** (E7).

## 4. How to work with these (from how he reacted)

- A UI change goes in only after the layout rule behind it is clear; he stopped an unannounced redesign with "changes not approved yet".
  What he has approved counts: the rows of the OpenMausBot adoption plan (new Settings, Agents page by department, the BD team) are approved UI and get built, not postponed.
- State the plan in a few lines first, then do it. Long questions annoy him; a wrong guess annoys him more.
- Do not run his real project in the app to test (his own rule). Pure logic goes into tests; how a drag feels is his to judge, and I say so.
- Read BIM Crew's code before inventing a behaviour: every time I invented one (the conversation list, the per-page layouts, the top tool bar) it was wrong.

## 5. Second round (2026-11-20, on version 2.6.3)

After "layout plan C" he looked at the real app again. His words, the rulings they contain, and what was done (version 2.6.4).
**Rulings (these replace earlier ones):** the list pages (Files, Sources, Requirements, Regulations, Memory, Rooms) open in the RIGHT
panel and stack there as tabs; the conversations are a SIDE panel like BIM Crew's session sidebar; the approved design is the
Whiteboard "Projektesana UI layout plan", not an idea of mine ("see fucking artifact where all approved design is modeled").

| # | Complaint | Done in 2.6.4 |
|---|---|---|
| 1 | "Because of 7 buttons windows cant be resized smaller. I dont like this at all. Window should just be able to snap when moved around, with highlighted areas where it can dock into." | A floating window's strip has two buttons (pop out, minimise); the dock-side and maximize buttons are gone. While a window is dragged, the four dock zones (bands at the work area's edges, 110–260 px deep) are drawn and the one under the pointer is lit; dropping there docks it. Minimum size 280 × 200. |
| 2 | "Why comment tool not availible always? it needs quick sceen area grab tool and annotations." | The tool bar always has "Ekrāna apgabals" (screen area), on every page and without a project: drag a rectangle on the window, draw on it (arrow, rectangle, circle, free line, six colours, undo), send: the picture goes into the chat as an attachment. The model viewer's frame is in the picture. |
| 3 | "Tabs visually not clear that these are different tabs and not just some buttons." | Tabs are cards: a border, rounded top corners, a darker strip; the tab in front has the panel's colour and an accent edge and is open to the panel below. |
| 4 | "Conversations why opens in floating window? was decided its a sidepanel SAME AS BIM-CREW" | The rail item and the chat's button open the conversations as the left side panel (between the rail and the chat), resizable, with a button to make it a window. |
| 5 | "Revert back so Files panel opens on right side panel and so other pages can stack in one panel when all opened." | Every list page docks on the right as a tab of one panel (520 px); opening another adds a tab; a second click on the tab in front closes it. |
| 6 | "Why coordination just auto opens all IFC models? remove that" | The 3D scene opens nothing by itself. A strip above it lists the models with a tick each; the choice is remembered per project; a click on a matrix row adds that model. |
| 7 | "Why Rooms, Requiremets and other panels opening on left side of the chat? that wasnt decided anywhere." | Same as 5: they open on the right. Nothing but the chat (and the conversation panel, when opened) is left of the viewer. |
| 8 | "There is no reference tab, what the hell is Coordination matrix even doing? I closed this panel and cant open again" | The reference is not a hidden tab beside the chat any more. The matrix, with no reference yet, has a "create the reference from the models" button of its own. The page's top strip has "Matrica" and "Atsauce" buttons that open or close those windows, so a closed one is one click away. |
| 9 | "In Chat what is Chat and What is room? where it came from? remove all redundant stupidities." | The Chat \| Room tabs, the room feed and the note box are removed from the chat. |

**Open after this round:** the readability pass beyond tabs and strips (BimCraft's website chrome, E2); the full comparison of every page against the board's
frames; BIM Crew's half / quarter / full-screen snap sizes (the zones dock to a side, they do not size a window).

## 6. Schedule page (2026-11-20, version 2.6.5)

His words: "Schedule page not complete. We Planned more of a grannt style calendar for whole project posmi seen and nodevuma
milestones. Calendar should be more usable like bim-crew, clicking adding tasks. Tasks creation small popup window same as bim-crew."

| Requirement | Done in 2.6.5 |
|---|---|
| Gantt-style calendar for the whole project | Grafiks opens on a Gantt (first tab): one date axis (months, Mondays), zoom Year / Quarter / Month / Week, a red line for today, "Šodien" scrolls back to it. |
| Stages (posmi) seen | Six stage rows. The bar is the stage's dates (set by clicking the row: the app had no stage dates before, they are kept per project); with none set, the span of the stage's own deliveries and clocks, drawn hatched; with nothing, no bar. The current stage is blue, a stage outside the contract is dim. |
| Deliveries (nodevumi) as milestones | ◆ on the stage row: hollow planned, green sent, red late; a click opens Nodevumi at that delivery. TN and approval clocks are thin bars (red when late). |
| Clicking adds tasks | Click an empty place on the task rows, or a day in the month / week calendar: BIM Crew's small popup opens where you clicked. |
| Small task popup, same as BIM Crew | Title, date, until, priority, assignee, status, notes, checklist; edit saves each field as you leave it, create saves once; Esc or a click outside closes. Left out on purpose: reminder, repeat, time of day (nothing in the app uses them). |
| Usable like BIM Crew | A task is a bar: drag it to move, drag its ends to change its first / last day; click it to edit. Month and week task chips open the same popup. |

**Not checked live:** the look and feel in the running app (I do not drive his app); the maths, data and checks are covered by tests 9.19 and 8.5.

### 6.1 Grafiks mouse navigation (2026-11-24, not yet built into a release)

His words: "Improve Grafik navigation so it pans/zooms with mouse and edits". Nothing more was said; what follows is what the
code now does, written by the session, not his rulings. BIM Crew's own timeline was not read (its folder was not reachable
from the cloud session), so the wheel rules below are a proposal for him to confirm.

| Need | Now (`src/renderer/panels/Gantt.tsx`, `src/shared/gantt.ts`) |
|---|---|
| Zoom with the wheel, at the pointer | Ctrl + wheel anywhere, or the plain wheel over the date ruler. Fast wheel ticks no longer jitter: each tick counts from the zoom already asked for, not from the last drawing (test 19.1). A pinch step is scaled up. |
| Pan | Drag an empty place (as before); the middle button pans from anywhere, over bars too; Shift + wheel and a trackpad swipe sideways (browser's own). The plain wheel over the rows scrolls them, and pans sideways when there is nothing to scroll up or down (it did nothing before). |
| Edit tasks | Drag a bar to move it, drag its ends to change the first / last day (as before). New: the dates show beside the pointer while dragging, the window scrolls when the pointer reaches its left or right side, and a save that fails puts the bar back (before it stayed where it was dropped). |
| Edit stages | New: a stage bar with dates of its own moves and resizes the same way (saves through `stages.setDates`). A hatched bar (drawn from deliveries, no dates set) is not draggable: click it to enter dates. |

**Not checked live:** the feel in the running app. `npm run typecheck` and the i18n test could not run in the cloud session (the npm registry is blocked there); `test/19.1-gantt-view.test.ts` ran.

## 7. Versions, Revit files, Settings (2026-11-20, version 2.6.6)

His words: "Why Versions for sheets not proposing same as Models proposing list of IFC from folders? DWG and PDF should be checked
separately PDF vs PDF versions, DWG vs DWG versions, but and also they have to be same PDF=DWG. Why revit files not listed from folder
as well? if specific Revit file is opened app will understand? Why in settings Bim craft libraries shown? delete or show all others too.
Settings need to be split up thematically in tabs same as bim-crew."

| Complaint | Done in 2.6.6 |
|---|---|
| Sheet versions not listed from the folders like the IFC models | Lapu izmaiņas lists every PDF and DWG under 01_Projektesana (the same walk as Models, `listProjectFiles`), one row per drawing (name without `_01`/`_v2`). Arhīvs files are in the chain, marked dim. Filters: all · with several versions · PDF ≠ DWG. |
| PDF vs PDF, DWG vs DWG | Each drawing has a PDF chain and a DWG chain (ordered by revision suffix, then date). Tick two of one kind (a tick of the other kind starts over) or "PDF ⇄" / "DWG ⇄" for the last two: PDF opens the sheet compare and fills the sheet-by-sheet list above, DWG opens CadCraft's compare. |
| PDF = DWG | Per drawing: sakrīt (newest PDF and DWG same suffix), versijas nesakrīt (`_02` vs `_01`), DWG jaunāks (DWG saved > 1 h after the PDF), tikai PDF / tikai DWG. A name-and-date check, said so on the page: the drawings' content is not compared. |
| Revit files not listed | The Revit tab lists the .rvt files of the project folder (Revit's `.0001.rvt` backups counted, not listed), each with "Atvērt" (opens in Revit). |
| Does the app know which Revit file is open? | Yes: it asks Revit for the open document's path (`Document.PathName`). Same path = "šis projekta fails" and the row is marked "atvērts Revit"; only the name matching (a local copy of a central model) is said as such; a file from elsewhere = "nav no šī projekta mapes". |
| BimCraft libraries shown in Settings | Replaced by one Components table on the Integrācijas tab: Revit MCP, BimCraft, CadCraft, each with its state and one line of what it does. The "16 libraries" count is gone; where a build copied BimCraft from is the row's tooltip. |
| Settings in thematic tabs like BIM Crew | Four tabs, BIM Crew's pill row: Vispārīgi (user, language, look), Aģents (provider, model, sign-in, usage), Integrācijas (components, Revit add-in), Ceļi (Revit server overrides, office standard PDF). The tab is remembered while the app runs. |

**Not checked live:** the look in the running app (his rule). Grouping, the PDF = DWG states, backups and the open-file match: test 5.6.

## 8. Comment tools: one icon column, always (2026-11-20, version 2.6.7)

His words (third time): "where are commenting tools gone?" · "found it through windows selector only. Why still not list with just
icons for tools? Should be compact vertical, i repeat again 3rd time."

**Why it kept coming back:** the tool bar laid itself out by its width (a CSS container query): under 200 px a column with a label
under each icon, wider a wrapped row of labelled buttons. The edge column was 96 px (icon + label), and a floating window could not be
narrower than 280 px, so a floated tool bar was always the wide labelled row. His saved layout had it floating (280 × 415).

**Ruling:** the comment tools are a compact vertical column of icons, wherever they are.

| Done in 2.6.7 |
|---|
| One layout at every width: a single column of 36 × 34 px icon buttons; the tool's name and hint are the tooltip. No labels, no width switch. |
| "Pick on the page" is an icon (⌖) too: lit when something is picked, its tooltip says what; a click clears it. Open comments: 💬 with a count badge. Colours: two swatches per row. |
| Edge column 96 → 52 px. Alone in a floating window the tools may be 60 px wide (other windows keep 280); the strip has no title and its buttons stack. With another window in the same tab group they float as a normal window. |
| Once, on start: tools floating (or minimised from floating) go back to the column beside the chat. Tools docked on a side stay there. |

**Not checked live** (his rule). Layout rules: test 9.17.

## 2026-11-24: Agents page

He asked: "Add Department view as tab in Agent page. and Edit Agent page so its Bim-crew and MousBot like".

| Done in 2.8.2 |
|---|
| The Agents page has three tabs, the app's usual tab row: Aģenti, Nodaļas, Noteikumi. The tab and the agent on screen are remembered while the app runs. |
| Aģenti is BIM Crew's agents page (AgentsArtifact.tsx): the list on the left (grouped by department, search, «+»), the chosen agent's settings beside it in the page, Saglabāt / Atcelt / Izņemt on top. Nothing chosen: «Izvēlies aģentu» with «+ Jauns aģents» (and the BD import while the team is missing). |
| The editor has OpenMausBot's bot panel on top (bot-panel/PanelShell.tsx): a hero with the agent's letters on its department's colour, its name, what it does, department · provider · model, then pill tabs for the sections (Loma, Vispārīgi, Modelis un rezerve, Rīki, Sazināšanās, Prasmes, MCP, Pārbaude). Tools and skills are chips that light when chosen. |
| Nodaļas is the team by department (drag, lead, order, rename, the import); «Labot» and «+ aģents» open the agent in the Aģenti tab. |
| Noteikumi: parallel helpers, the rules every agent gets, the Skills link, the limits. |
| Below 720 px (the page docked as a side panel) one column: the list, or the editor with «‹ Aģenti». Settings → Aģenti keeps the dialog (no room for two columns there). |
| Changing agent or tab with unsaved changes asks first. |

**Not checked live** (his rule).

## 2026-11-24: Telpas plan — pan, zoom, sort, filter

His words: "To this Room view should also add pan/zoom and add sorting filtering options" (with a screenshot of the floor plan: small rooms
are unreadable). He did not say which sort or filter options; the ones below were picked by the session from the room data, for him to confirm.

| Need | Now (`src/renderer/panels/Telpas.tsx` `TelpasPlan`, `src/shared/pan-zoom.ts`, `src/shared/rooms-plan.ts`) |
|---|---|
| Zoom | The wheel zooms at the pointer (no Ctrl needed: the plan has nothing to scroll). Same wheel steps as Grafiks. «−» «+» zoom at the centre, «Viss plāns» goes back to the whole floor. 100 % to 6000 %. Text stays the same size, so a small room shows its number, name and area once it has grown big enough. |
| Pan | Drag anywhere on the plan, or the middle button; a click that did not move still picks the room. The plan never leaves its box (no empty space). |
| Search | A box for room number or name. |
| Filter | All rooms · with differences · without differences · one kind of difference (only the kinds the floor has). The plan is laid out again for the rooms left, so a small room grows. «Notīrīt filtru» and a "shown / total rooms · m²" count. |
| Sort | Area large → small (as before), small → large, by number, by name, differences first. The order decides where each room sits in the layout. |
| Floor / filter / sort change | The view goes back to the whole plan. |

Also fixed: the plan's size was only watched when the tables were already loaded on the first drawing, otherwise it stayed 600 × 360.

**Not checked live** (his rule). The maths (pan, zoom, filter, sort) is covered by test 9.10 (`test/9.10-rooms-plan-view.test.ts`).
`npm run typecheck` and the i18n test could not run in the cloud session (no installed packages, the npm registry is blocked); the new
strings were checked against the English dictionary by script. Not tried in the app: the page's other floor-plan windows (differences, inventory).

## 2026-11-24: Telpas — delete wrong rooms, agent edits and deletes rooms

He asked: "add ability to select multiple rooms and delete them, have to allow agent to edit/delete existing rooms in app, it says it cant." (The agent's answer on screen: the app has no way to delete rows from the Rooms table; it offered only to change the role of the two source documents the wrong rooms came from.)

| Done (not built into a numbered version yet) |
|---|
| Telpas → Inventarizācija: a checkbox on each room row and one in the header (select all). A shift-click ticks the run between two rows. With rooms ticked a line shows «Atlasītas N telpas» with «Dzēst atlasītās» (asks first) and «Noņemt atlasi». Clicking a row elsewhere still opens the source page. |
| A deleted room is gone from the table, the comparison with the model, the checks and the Excel export. The table becomes a correction (the «labots» tag): the document is not read again over it, so **deleted rooms do not come back when the document is re-extracted**. «Atjaunot no dokumenta» (asks first) drops all corrections and deletions of that document. If every room is deleted, the empty table stays listed so it can be restored. |
| The agent's full rewrite (`set_inventory_rooms`) leaves out rooms that were deleted earlier and says how many it skipped, so it cannot quietly put the same wrong rooms back; `clear: true` forgets the deletions. |
| Agent: `list_rooms` now gives each room an `id`. New tools `delete_inventory_rooms` (ids or all, waits for the user's click) and `edit_inventory_room` (floor, no, name, area, height, page of one room; the agent's own change). The calls `rooms.delete` (click), `rooms.update` and `rooms.restore` are also open to the agent through `app_confirm` / `app_change`. |
| The rooms check no longer reports every model room as missing when all inventory rooms were deleted: it is skipped, as with no table. |

**Not done:** editing a room by hand on the screen (only the agent edits rooms); deleting from the Telpas page's plan view (another change is working on that view). **Not checked live** (his rule).

## 2026-11-24: Avoti → Normatīvi — "Piemērojamie normatīvi" collapsible

He asked: "Make Applicable Regulations also collapsible like Regulations."

| Done (not built into a numbered version yet) |
|---|
| The «Piemērojamie normatīvi» (Applicable regulations) header is now a click target with the same ▾ / ▸ toggle as the «Normatīvi» (library) header. Closed, the header stays and its rows, the load error and the «Rādīt neattiecīgos» / not-read footer are hidden. It starts open. |
| Same behaviour as the library section: plain per-open state in the panel (`Normativi.tsx`), **not remembered** between openings — the library section does not remember its state either, so nothing was added for one. |

No new strings (the arrows are not translated text). **Not checked live** (his rule). `npm run typecheck` and the i18n test could not run in the cloud session (npm registry blocked, no installed packages); the change is three conditions and one `useState` in an existing file.

## 2026-11-24: Chat — answered approvals fold to one line

He asked: "When commands asking approved/declined also add small button to collapse them down smaller." (Screenshot: several «Apstiprini partiju: run_command / write_file» cards stayed full size after «atbildēts», each with the whole batch text.)

| Done (not built into a numbered version yet) |
|---|
| An approval card (`ConfirmLine` in `src/renderer/shell/AgentDock.tsx`) now has a small ▾ / ▸ button at its right end. |
| **Waiting for an answer:** open, as before (batch text and «Atļaut» / «Noraidīt»). **Answered** (allowed, rejected, or answered elsewhere): it folds by itself to one line: «Apstiprini partiju: <tool>» and the answer badge. Chosen by the session, not by him: old approvals are history, and the batch is one click away. |
| The button opens or folds any card, answered or not. A card he opened or folded by hand stays as he left it; it does not re-fold when the answer arrives. The fold state is not saved when the chat is reloaded: answered cards come back folded. |

**Not checked live** (his rule). `npm run typecheck` and the i18n test could not run in the cloud session (packages are not installed); the one new string («Izvērst» → "Expand") was added to the English dictionary, «Sakļaut» already existed.

## 2026-11-24: Chat panel — decluttered (items 1–8 of his list)

He wrote (screenshots with red boxes): "1. Move model selector in chat 2. Agent name is visible below, remove 3. conversations is in sidebar, remove button 4. Lead Agent Thinking - absolutely usesless waste of space that is duplicated at the bottom too? 5. Stop button already exists 6. Why duplicated and stacked? we have full width, can be assigned to different sides. 7. Confirm cards duplicate when asking? fix that 8. Want to see Reasoning/Thinking (collapsible as option) 9. Need to have some debug or log view where can see ALL that agent does and receives like full verbose transcript in Claude." Item 9 is another change's work, not this one.

How the session read each item (the readings are the session's; he can correct them):

| # | Done (not built into a numbered version yet) |
|---|---|
| 1 | The model button («ChatGPT / Codex · gpt-… · pieslēgts») moved from the header to the message box's bar, in the empty space after «Skats: Auto / Manuāli» (the blue arrow). It reads «provider · model»; «· nav pieslēgts» is added, in red, only when not signed in (the tooltip has the full state). It still opens Iestatījumi. Long names are cut with «…» before the buttons are pushed. `AgentDock.tsx`. |
| 2 | The line under the header with the agent name and thread title is gone for the lead's chat (the name is on every run card). In another agent's thread the line stays, because nothing else says whose thread it is: **the session's choice, not his**. `ThreadPanel` in `ThreadList.tsx`. |
| 3 | The «Sarunas» button is gone from the chat (the sidebar has «Sarunas»). |
| 4 | The row «Vadošais aģents domā…» is gone: the thread on screen no longer gets a row in the jobs list (`LaneRows`). Other agents' running or queued threads keep their rows with their own «Apturēt». The bottom status bar stays as it was. |
| 5 | The row's second «Apturēt» went with item 4. The bottom status bar's «Apturēt» now shows only for a run of **another project**; for the open project, stopping is the message box's «Apturēt» (and «Apturēt visu» in the jobs controls). **The session's reading of item 5**: his red box was on the bottom bar. |
| 6 | The jobs controls (**Darbi: N**, the wave, «Pauzēt rindu», «Apturēt visu») are no longer a row of their own: they sit at the right end of the «Uzdevumi» row, so the two share one line (`LaneHead` in `Lane.tsx` passed to `PlanBlock` as `aside`). In a narrow dock they wrap under «Uzdevumi» instead of being cut. |
| 7 | An approval waiting for an answer shows **once**, in «Gaida tevi» above the chat. The chat line for it is hidden while «Gaida tevi» shows it and appears when it is answered (allowed / rejected, or answered elsewhere). `useThreads` has `pending(id)`. If another change that folds answered cards is merged too, the two fit (this one only decides when the line is drawn). |
| 8 | The model's reasoning already was a «Domā» step in the run card; it only could not be switched. New button in the message box's bar, **«Domāšana: sakļauta / atvērta / paslēpta»** (click to go round): *sakļauta* = as before (each a line, the one being written open); *atvērta* = every reasoning step open; *paslēpta* = no reasoning steps in the run card. Kept per computer (`src/renderer/reasoning-pref.ts`, localStorage), not in Iestatījumi. |

**Not done:** item 9. Reasoning is shown only if the model sends it (the ChatGPT / Codex provider may send little or none). **Not checked live** (his rule). `npm run typecheck` and the i18n test could not run in the cloud session (no installed packages); every `tr()` string was checked against the English dictionary by script, and the files were compiled for syntax only.

## 2026-11-24: Agent log (Žurnāls) — see everything the agent does and receives

He wrote (item 9 of a list about the chat panel; items 1–8 are another change): "Need to have some debug or log view where can see ALL that agent does and receives like full verbose transcript in Claude."

What the app already had: the dock's run card and the status strip (`src/main/activity.ts`, `src/shared/activity.ts`) show a short readable story, with tool inputs cut to 600 characters and answers to 2000, and no system text, no prompt, no timings. The chat transcript (`src/core/threads.ts`) keeps only the user's and the agent's messages. Neither shows what the model was actually sent.

| Done (not built into a numbered version yet) |
|---|
| **Recorder** `src/core/agent-log.ts`: every `RunEvent` of every run (the coordinator's one sink in `main.ts`) and what each attempt starts with (the model, the engine, the tools offered, the whole system text and the whole prompt: the thread runner's `attempt`) become entries in order. A helper or specialist's own run is recorded too, tagged with its lane (`subagents.ts`). Reasoning and answers that stream are one growing entry. A tool call has its whole arguments, a tool answer its whole text and how long it took; the engines now carry the whole copies next to the cut ones (`input`, `full` in `shared/types.ts`, only when they were cut), and `main.ts` takes them off before the dock and the activity lines see the event. Errors keep the provider's own text and hint. Each model turn's tokens and price are entries; the run's totals are in the list. |
| **Kept** in the run's folder: `runs/<run>/log.jsonl` (one entry per line) and `log.json` (the list row). Logs last 30 days (the two files are removed at the next start, never the folder); one run's log stops growing at 25 MB (it says so); one body is cut at 200 000 characters (marked, with the answer's real length shown). A failing disk never stops a run. |
| **Secrets**: keys, bearer tokens, JWTs, `…_TOKEN=` and `"api_key": "…"` style values and passwords are masked as `[***]` before an entry is kept, written or sent (`redact` in `src/shared/agent-log.ts`). |
| **Panel** `src/renderer/panels/AgentLog.tsx` («Žurnāls»): a tab in the right panel like the list pages (the rail's «Žurnāls» item, Ctrl+K, and a small button in the chat's header that opens the log of the thread you are looking at). It does not change the page. The run list and the transcript are split by a draggable handle (the share is remembered; side by side when the panel is wide, one above the other when narrow); the panel itself is a window like the others, so it can be resized, floated, docked or popped out. Each entry shows its time, the time since the run began, its kind, the helper it belongs to, and for a tool answer ✓ / ✗, how long it took and its size. Click opens or closes the body; «Atvērt visu» / «Aizvērt visu». Filters by kind (task, reasoning, answer, tools, errors, info), a search over titles, names and bodies, «Sekot jaunākajam» (follows a live run), copy one entry, «Kopēt visu» (the visible entries as Markdown), «Saglabāt .md» and «Saglabāt .jsonl». |
| **For the agent**: `agentlog.runs`, `agentlog.read` and `agentlog.export` are `never` in `shared/app-calls.ts`: the log is the user's debug view, large, and not for the agent's own context. |
| **Tests**: `test/21.0-agent-log.test.ts` (10 tests: order and content of entries, whole arguments and answers, masking of secrets in the file, the window's copy and memory, errors and stop, helpers' lanes, a growing block, cuts, reading in a later session, pruning, export, filters). |

**Not done:** the compaction summary text and the app's own `[lietotne]` notices are not recorded as their own entries (only the compaction's sizes and the notices as answer text); a run that was queued but never started has no log; the raw provider request (the JSON the SDK sent) is not logged, only what the app handed to the engine. **Not checked live** (his rule): the panel has not been opened in the built app; the recorder, its masking and the engines' event mapper were checked by test 21.0.
`npm run typecheck`, the whole i18n test and the contract test 0.4 could not run in the cloud session (no installed packages, the npm registry is blocked); the new files were checked with a global `tsc` (no new error against the branch before the change), test 21.0 and the layout test 9.0 ran from a scratch build, and the new strings were checked against the English dictionary by script.

## 2026-11-24: The agent asked for a click to write its own notes

He wrote: "Why agent asking to write notes? it should be allowed freely in project folder". (Screenshot: «Confirm the batch: write_file» with the text of a long `.md` analysis, and a second card «run_command» that rewrote the same note with a PowerShell regex.)

**Cause.** Since 2.6.9 `write_file` (and `copy_file`, `move_file`, `run_command`) have the level `confirm` (`src/agent/tools/general.ts`), and the gate (`levels.ts`, `Gate`) decided only by the tool's name: every `confirm` tool waits for a click, whatever the path. Nothing looked at where the file goes, so a note in the project folder asked the same as a write anywhere on the PC. Because there was no tool to change part of a file, the agent also fell back on `run_command` to edit its own notes, and that asked again.

| Done (not built into a numbered version yet) |
|---|
| The gate now asks a second question before it asks him: `freeWrite` (`src/agent/tools/project-write.ts`). A `write_file`, `edit_file` or `copy_file` (the target) runs **without a click** when the target is a plain-text file (`.md .markdown .txt .csv .tsv .json .yml .yaml .html .htm .log`) **inside the open project's folder**, and is either **new** or **a file the agent created itself** (the app remembers those per project in `<app data>\agent-files\<project>.json`, so it survives a restart). The batch card no longer lists such a call; a message with only such calls asks nothing. |
| **New tool `edit_file`** (replace a text in a file; an absent or repeated text is an error, `all: true` for every place), so the agent does not need `run_command` to fix a note. The old text is kept in `<app data>\backups\agent` first, as with `write_file`. |
| **Still asks:** any path outside the project folder (also through `..`, a folder or file link that leads out, another drive, a stream name `file.md:x`); a hidden folder (`.git`, anything starting with a dot) and Windows device names (`con.md`); a file type that is not plain text (`.docx`, `.pdf`, `.xlsx`, scripts); **overwriting or editing a file the agent did not create** (the office's own documents, even a `.md`); a project "folder" that is a drive root; `move_file`; `run_command` (also in the project folder); deletes (never). Overwriting after his click does not turn the file into the agent's. |
| The sub-agents' lanes are unchanged: a lane cannot reach `confirm` tools at all (`subagents.ts`), so it cannot write notes this way; a specialist whose spec says `maxLevel: confirm` gets the same free notes as the lead. |
| **Test** `test/21.1-free-writes.test.ts` (8 tests: what is free, what is not, own files, `edit_file`, links that lead out, the gate's batch, default without the lift). |

**Not done / his call:** `run_command` still asks even when it only touches the project folder (a command can do anything). If he also wants the agent's own notes to be freely overwritable when the file is one of the office's `.md`/`.txt` files, that is a one-line change (`freeWrite` ignoring the "agent made it" check; the old text is still kept in the backups). **Not checked live.** `npm run typecheck` and the full test run could not run in the cloud session (no installed packages, the npm registry is blocked): the new test ran from a scratch build with `zod` and the text readers stubbed, on Linux; the Windows-only parts (drive letters, upper/lower case of paths, junctions) were reasoned, not run.

## 2026-11-24: Comment tools window adapts to its shape (version 2.10.2)

His words: "Comment Tool window - can you make more dynamic so if changes to wide format, all header buttons arrange horizontally? and if wide
enough tools buttons can arrange to fit better." (screenshots: the floating tools window, a tall slim one, and a short wide one that only
showed the header and two tools with a scrollbar.)

This builds on §8 (a compact vertical column of icons); it does not undo it: narrow stays exactly the column he asked for, three times.

| Window width (its own, not the screen's) | Now (`TabGroup.tsx` sets `data-tier` from a ResizeObserver; rules in `styles.css`, `.tg-slim[data-tier]`) |
|---|---|
| under 100 px (the edge column, a slim float) | As before: window buttons stacked, one column of icons, colours two per row. |
| 100 – 139 px | Header still stacked; the icons wrap two or more per row; colours three per row. |
| 140 px and wider | Header: the grip on the left, the window buttons (to column, float, pop out, minimise) in one row on the right. Tools wrap into a grid as many per row as fit (centred, groups separated by a line); the six colours sit in one row. The page's open comments (💬) follow the tools in the grid (it no longer sticks to the bottom). |

The window stays resizable from every edge and corner; the shape follows the width as it is dragged. The width is measured with a
ResizeObserver, not a CSS container query, because a container would become the containing block of the comment box and the comment list
(they are fixed to the screen) and move them. **Not checked live** (his rule): typecheck and the focused tests run on his PC, see the release note.

## 2026-11-24: Parallel chats stayed "Queued"; a streamed answer lost its start; the run card repeated his message (version 2.10.3)

His words: "Why paralel chat not working and staying in queue?" (screenshot: a second Lead agent conversation, «Saruna» 16:01, showed only "Queued" while «Saruna» 15:47 was answering; Jobs: 2.)
And: "When i was switching chat sessions, it was responding, so i see only part of the response that was generated only when i opened chat page." (screenshot: the answer began in the middle of a sentence, while the Žurnāls log had it whole.)

And: "Why my message duplicated in response task?" (screenshot: under his message bubble the run card was titled with the same words.)

**Cause of the repeated message.** The run card's title was the first line of what was asked (`taskTitle`, 90 characters), which for a message typed in the chat is the message bubble right above it.

**Cause of the queue.** `pickNext` (`src/core/queue.ts`) skipped any queued item whose **agent** was already running in the same project, not only one whose
own conversation was running. All Lead agent conversations are the same agent, so the second one waited until the first ended. That rule came with the first queue
(phase 11, "one run per agent") and was never needed for safety: the run's state is per conversation (history, model, context are keyed by thread id), the write
locks are keyed by run, and the one Revit has its own seat.

| Done in 2.10.3 | |
|---|---|
| Two conversations of one agent now run side by side. A conversation that is itself still answering still refuses a second message from the user (it never piles up unseen). | `pickNext` |
| The slot limit stays (Iestatījumi → Aģenti, "parallel agents", default 3; a run waiting for an approval holds no slot). | `maxParallelAgents` |
| **Why something waits is shown**, in the chat ("Queued" line) and in the other-conversations row: the queue is paused, the agent is paused, the wave hit its limit, the conversation is still answering, or "Waiting for a free slot: 3 of 3 agents are working (Settings → Agents)". | `waitReason`, `QueueView.why`, `whyText` in `Lane.tsx` |
| **Revit is still one connection.** A run that is offered Revit tools takes the seat; a second run at the same time starts **without** Revit tools and its prompt says who has Revit. The holder is now named with its conversation (agent, title, time) instead of just "Lead agent", in that prompt and in the write-lock messages. | `thread-runner.ts` |
| **Streamed text is kept per run, whatever is on screen** (`shell/chat-lines.ts`): one window-wide listener builds each run's chat lines from its first event; coming back to a conversation whose run went on, the dock puts the whole text back with the run card instead of starting from the first event after the return. The buffer of a run is dropped when it ends (the saved history has the answer from then). | `chat-lines.ts`, `AgentDock.tsx` |
| The row «Lead agent thinking… Stop» in the screenshot was **not** the conversation on screen (that one has no row since 2.10.0): it was the other, running conversation. Such rows stay (they are how another chat is reached and stopped) but now name the conversation and its time, so two chats of one agent can be told apart. | `Lane.tsx` |

| The run card is titled with a task template's label when the run came from one, else «Uzdevums». His words are no longer the title; they stay one click away under «Uzdevums aģentam» in the card. The bottom status strip still shows the first line (it is not next to the message). | `template` on the start line (`shared/activity.ts`, `main/activity.ts`), `RunCard.tsx` |

**Not changed / his call.** The Revit seat is taken for a whole run, even when the run never calls a Revit tool; a second Lead chat that needs Revit while the first holds the
seat is told to ask him. Taking the seat only at the first Revit call would fix that, but the Revit server is chosen when the run starts; say if he wants it.
**Test** `test/21.2-parallel-chats.test.ts`. **Not checked live** (his rule).

## 2026-11-24: The agent clicked through Revit with a PowerShell script (version 2.11.0)

His words: "What is that command, why its asking permisions for literally all actions?" (the card «Lead agent · confirm the batch: run_command» with a script that finds "2. STĀVA 001" in Revit's project browser with Windows UI Automation and clicks it); then "doesn't use the Revit MCP view tools and falls back to shell commands. **never allowed**"; then, after the agent answered "the tools available in this session can't activate [the view] … I reported the missing command": "I dont understand why it says there is no such tool. add it then. mcp should be bundled with projektesana-app and installed at same time. improve revit mcp so it can open views and all it needs."

**Cause.** The Revit MCP server has no tool that opens a view, changes a schedule, or writes a parameter value (`operate_element` selects, colours, hides; nothing sets a parameter), and `send_code_to_revit`, the one tool that could, is never the agent's. So the agent had no way to do its task, and fell back on `run_command` (every `run_command` asks for a click, because a command can do anything).

| Done in 2.11.0 |
|---|
| **`run_command` can never drive Revit.** `revitShellBlock` (`src/agent/tools/levels.ts`) refuses before any click: UI Automation, `SendKeys`, window messages and similar (any window, not only Revit's: a script that does not name Revit can still click in it), taking hold of a Revit process (`Get-Process`/`Stop-Process`/`taskkill`/`Start-Process` with Revit), and the side door round the MCP (`RevitMCP\instances`, `Revit.exe`, journal files). The refusal names the tools to use. A refused command is also left out of the card of the other calls in the same message, and `run_command` itself refuses it where it would run. Ordinary commands, and commands on `.rvt` files (copy, list), still run. |
| **New agent tools** (`src/agent/tools/revit-model.ts`, short snippets through the app's own Revit client, a nonce on every reply): `revit_list_views`, `revit_open_view` (by id or exact name), `revit_get_view_settings` / `revit_set_view_settings` (category visibility such as Rooms, view template, crop, plan view range, phase: the "why are rooms not on the plan" tools), `revit_get_schedule` / `revit_set_schedule_filter` (add, set, remove, clear), `revit_list_models`, `revit_read_parameters` (by category or ids, **also from another open or linked model**, rooms with `placed` and area), `revit_set_parameter` (one parameter on many elements, custom ones like "Lietotāju skaits"; numbers with units are written as Revit reads them typed, never raw). Reads and opening a view run at once (level `run`, so a lane or a specialist only has them if its spec lists them); every change is `confirm`, per batch, and only on the project's working copy (the same rule as every `revit_*` batch). |
| **Standing text:** the system prompt (rule 6) and the Revit rules (rule 8) say: never a shell for Revit; these are the tools; if one is missing, say what is missing. |
| **The Revit MCP is bundled and kept in step.** The server and the add-in already shipped inside the app (`resources/revit-mcp`, from the Revit MCP bundle at build time). Two gaps closed: (1) the server inside the app now wins over an older `Revit-MCP-Node` install in `%LOCALAPPDATA%` (it was the other way round, so an old install could hide the shipped one); (2) at every start the app compares the add-in it ships with the one in `%APPDATA%\Autodesk\Revit\Addins\<year>` for each Revit year on the PC (`syncAddins`, a fingerprint file next to the plugin) and puts its own in place when it is missing or another version: no click, the old plugin is backed up first, the user's `commandRegistry.json` kept. If Revit holds the files it is tried again at the next start (the line is in the app log); Settings → Integrācijas still has the manual button. |

**Not done / his call:** the Revit MCP's own source is a separate project (`D:\Code\BIM\revit-mcp`, packaged by `packaging\Build-Bundle.ps1`), not in this repository and not reachable from the cloud; the new commands are therefore app-side, running through `send_code_to_revit` of the bundled server (so they work with the server and add-in as they are). Moving them into the MCP server itself (as tools of its own, so other clients such as Claude Code get them too) is a change in that project. **Not run against a live Revit:** the C# snippets are checked as text (balanced, the right API calls) and by review only; the first real call may need a fix. The setup itself does not write into Revit's add-in folder: the first start of the new version does. `npm run typecheck` and the focused tests run on his PC, see the release note.

## 2026-11-24: the missing view tools are now in the Revit MCP itself (version 2.11.1)

Follows the entry above. His words: "add it then. mcp should be bundled with projektesana-app and installed at same time. improve revit mcp so it can open views and all it needs." The 2.11.0 tools were app-side snippets; any other client of the Revit MCP (Claude Code, Codex) still had no tool to open a view.

| Done in 2.11.1 |
|---|
| **Nine native commands in the Revit MCP** (`D:\Code\BIM\revit-mcp`, commit `8b51cd3` on `bv/p1-safety`, local only: its only remote is the public upstream): `open_view`, `list_views`, `list_models`, `get_schedule`, `set_schedule_filter`, `read_parameters`, `set_parameter`, `get_view_settings`, `set_view_settings`. C#: `commandset/Services/ModelAccess/ModelOps.cs` (the Revit logic), `commandset/Commands/ModelAccess/ModelCommands.cs`; node: `server/src/tools/model_access.ts`; all in `command.json`. The server now lists 37 tools. |
| **`open_view` works across models.** The view he wanted ("2. STĀVA 001") lives in another open model than the active one (AR-11-004), which is why reading and exporting worked but opening did not. With `model`, that open model is made active first (`OpenAndActivateDocument`), then the view opens; `model` alone only switches. Reads (`list_views`, `get_schedule`, `read_parameters`, `get_view_settings`) take `model` and also work on linked models. **Every change goes only to the active model**: a change aimed at another model is refused with the sentence that says to `open_view model=…` first. |
| **The app's `revit_list_views` / `revit_open_view` take `model`** and then use the native commands; without `model` they work as in 2.11.0. |
| **An update now switches on new commands.** The installed add-in keeps its own `commandRegistry.json` (his on/off choices), and its list had 23 commands, so a new command would never have been loaded. `installAddins` (app) and `Install-RevitMCP.ps1` (bundle, `scripts/merge-registry.mjs`) now keep his list and add the commands it lacks, enabled; the log names them. |
| **Bundle.** `Revit-MCP-Bundle-2026-11-24-8b51cd3` (Downloads) built with `packaging\Build-Bundle.ps1` for Revit 2024, 2025, 2026; this version of the app ships its payload. |

**Not checked live:** Revit was closed on this PC, and a model is not opened to test on (his rule). The C# compiles for 2024, 2025 and 2026, the server starts and lists the tools, the bundle self-check passes, the registry merge has a test (`test/21.2-revit-no-shell.test.ts`). Not seen yet: `OpenAndActivateDocument` on an already-open model (the one API call whose behaviour in a real session decides if `open_view model=…` works as intended; the error then says "click its tab in Revit"), and the write commands on a real model. The add-in is placed into `%APPDATA%\Autodesk\Revit\Addins\<year>` at the app's first start, with Revit closed; restart Revit after.
**Not done / his call:** the old bundle folder `Revit-MCP-Bundle-2026-10-19-0067a70` (and its `.zip`, `.zip.sha256`) in Downloads is now superseded; delete it when he wants (a folder: not deleted by me).
