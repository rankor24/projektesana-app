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

## 2026-11-25: the two Revit MCP lines merged (40 tools)

Follows the 2.11.1 entry. His words (via the project chat): merge the two Revit MCPs so the app's MCP has all 40 tools.

| Done |
|---|
| **One Revit MCP, 40 tools.** `D:\Code\BIM\revit-mcp` (branch `bv/p1-safety`, local only: its only remote is the public upstream, never pushed) had 37 tools (`8b51cd3`); the zip `Revit-MCP-Bundle-2026-10-20-49242cc.zip` (31 tools) carried its full git history in `source\revit-mcp.gitbundle`. Both lines share `0067a70`. The zip's one commit (`49242cc`: `open_document`, `save_document`, `reload_links`) was fetched from that bundle and merged (commit `d97d28a`): its C# and node files came in unchanged, `command.json` is the union (35 add-in commands), the model-access packaging files and `merge-registry.mjs` were kept. Bundle `Revit-MCP-Bundle-2026-11-25-d97d28a` (Downloads) compiles for Revit 2024, 2025, 2026; its handshake lists 40 tools. |
| **The setup ships the MCP.** `electron-builder.yml` `extraResources` copies `resources/revit-mcp` (node runtime, server, add-ins 2024-2026, licenses) into the install folder; the 2.11.1 build holds all of it. The setup itself does not touch Revit's folders: the app puts the add-in into `%APPDATA%\Autodesk\Revit\Addins\<year>` at every start (`syncAddins`), for each Revit year found on the PC. Gap closed: `sync-revit-mcp.mjs` only warned when no bundle was found, so a build could ship without the MCP. `npm run dist` now runs it with `--strict` and stops. |
| **Agent levels unchanged.** `open_document`, `save_document`, `reload_links` are not in `revit-levels.ts`, so the app's agent does not get them (unknown tool = never; they open and save model files). Other MCP clients get them. Giving the agent any of them is his call. |

## 2026-11-25: steering: write to the agent while it works (version 2.12.0)

His request (via the project chat): while a chat's agent is running, Send turned into Apturēt and a second message was refused ("Aģents jau strādā"). He approved: Send stays active during a run, the extra message is held, shown in the chat where it can be edited or cancelled, and delivered to the agent after its current step (after the run if the engine cannot take it mid-run).

| Done in 2.12.0 |
|---|
| **Send stays active while the agent works.** Apturēt now sits beside Send (it shows while the dock follows a run). A message written meanwhile goes through `threads.hold` (main: `AgentSession.holdTo` → `Coordinator.hold`); a thread that is not busy any more answers `null` and the window sends the message the normal way. The old refusal stays for everything that is not the user's own chat box (routines, mail). |
| **The held message is a card at the end of the chat** (`HeldMessage.tsx`): dashed border, "Gaida aģentu — viņš to izlasīs pēc tekošā soļa", with **Labot** (edit the text in place; files stay) and **Atcelt** (take it back). Two messages in a row are one card (texts one under the other, all files, the newer Fokuss). A held card per thread, listed in `QueueView.steering`. |
| **Delivery.** pi engine: the message is handed to the agent (`Agent.steer`) and read after its current assistant turn and tool calls; the card goes and the message appears as a chat line when the agent has read it (saved in the thread, `steered` event). Edit and cancel take it back out of the agent's queue while it is still unread; "too late" once the agent is reading it. A new attempt after a wire retry or a failover is handed it again. |
| **Fallbacks.** The Claude subscription engine has no way in mid-run, and a message the agent did not read before the run ended starts a new run of the thread at once (activity log titled with the message; the chat shows the message above that run's card). A run that was **stopped** or **failed** does not send it: the card says why and offers **Sūtīt tagad**, Labot, Atcelt. |
| **Tests:** `test/21.3-steering.test.ts` (12: hold, merge, hand-over and read, withdraw, edit, stop and failure, release, runner wiring, chat-line order). Typecheck; i18n 15.2; IPC 0.4; log 21.0; chief 18.0 ran. |

**Not checked live:** the pi engine reading a steered message mid-run was tested through the runner with a scripted engine, not against a real model (his rule: he playtests). **Not done / his call:** a held message on a thread whose run waits in the queue is held until the run starts (it is not shown anywhere but the dock of that thread); attachments cannot be added or removed while editing a held message (cancel and send again).


## 2026-11-25: Comment tools window packs tight and shrinks to its contents (version 2.13.2)

Follows 2.10.2. His words (via the project chat): still not compact enough when resized. Screenshot of a ~190 px wide window: three header buttons, big empty gaps, one icon alone on a row, three tool icons spread out with padding, the colour dots on their own row, a lot of empty height under it.

**Causes** (read from the code, not guessed): (1) every group divider was a full-width line (`.ctool-sep`), so it forced a new row: the screen-grab icon sat alone before the first line, the colours alone after the last; (2) the colours were their own grid block that also took a whole row; (3) tools were centred, so the leftover width became padding around them; (4) the window could not get lower than 200 px (`MIN_H`), whatever its contents.

| Change | Where |
|---|---|
| From 100 px wide up, tools, the model's tools and the six colours flow as one run from the left; the group dividers are short vertical lines inside the run; icons 30 x 28 px; gaps 2 px. Under 100 px nothing changes: still the one column he asked for three times (§8). | `styles.css` (`.tg-slim[data-tier="s"/"m"]`) |
| The comment tools window alone may be as low as 72 px (`TOOLS_H`, one row of icons under the header); every other window keeps 200 px. | `shared/layout.ts` (`minHOf`), `FloatingWindow.tsx` |
| The window is as tall as its icons need: when he lets go of the left or right edge, the height is fitted to the re-flowed icons (shrinks when there is empty room, grows when icons are cut off). A double-click on the grip fits it at any time (also after the page's tools change). Dragging the top or bottom edge is still free. | `TabGroup.tsx` (`fitToolsHeight`), `FloatingWindow.tsx` |

**Test:** `test/9.0-layout.test.ts` (the tools window's minimum height; other windows unchanged). **Not checked live** (his rule): the fitting reads the real layout of the icons, which only the running app has.

## 2026-11-25: Moving the small comment tools window made it bigger (version 2.13.3)

His words: "weird behavior when i try to move resized smaller it gets bigger on it own" (two screenshots: the compact window, then a window about 290 x 200 with one colour dot wrapped).

**Cause (found by reading, not reproduced live: his rule).** In the layout model a resize followed by a move keeps the size exactly (checked with a script over `resize`, `focus`, `move`, `normalize`, `toggle`). The problem is on screen: every floating window has resize grips over its top corners (22 x 22 px) and top edge, and in the widened header of 2.10.2 the grip glyph «⋮⋮» sits at the far left, exactly under the top-left corner grip. Pressing the glyph to move the window started a resize from the top-left corner, so dragging made the window bigger. The top-right corner grip covered the right edge of the window buttons the same way.

| Change | Where |
|---|---|
| On the comment tools window the top corner grips are 8 x 8 px and the top edge grip 3 px (the other windows keep 22 / 6 px); the grip glyph moved 8 px right. Side and bottom grips are as before. | `styles.css` (`.fw:has(> .tg-slim) .fw-rz-*`, `.tg-grip`) |

**Not checked live** (his rule). If it still grows when he moves it, the next suspect is the tab strip's own double-click, which fits the height (2.13.2); say where he pressed.


## 2026-11-25: Context ring showed 1.18M / 262K (451%) and nothing compacted (version 2.13.5)

His words (via the project chat): the meter showed "Context 1.18M / 262K (451%)", almost all of it "base (rules, tools)", conversation about zero, "compaction starts at 200K", yet nothing was compacted. Thread on the Antigravity provider (Gemini).

**Cause (read from the code and the server's own source, and checked against the app's `usage.jsonl`).** The base is not that big. The meter showed the wrong number: for an Antigravity thread the app took the token counts of the prompt answer (`input + cacheRead + cacheWrite + output`) as "the size of the context". Google's server fills that `usage` as the **sum over every model call of the turn** (each call resends the whole history), and Gemini's input count already includes the cached part. One tool-heavy turn is 10 to 15 model calls: the real rows in `usage.jsonl` for his runs were 703,599 in + 475,258 cached + 3,790 out = 1,182,647 (his 1.18M exactly), and 1.3M, 1.7M for other turns. The "base" label came from the meter: with no messages in memory it scales the base estimate to whatever total it is given. And nothing compacted because (1) the number was not the context, and (2) Antigravity threads were never compacted at all (the engine keeps the conversation in Google's server session, so the app's compaction, which cuts in-memory messages, had nothing to cut; the button even said "Google keeps it").

The server does send the real figure: a `usage_update` notification (`used` = the prompt of its newest model call, `size` = the model's window). The app ignored it.

| Change | Where |
|---|---|
| The meter reads `usage_update`: the thread's size is the server's `used`, and the window is the server's `size` when it states one (not the catalogue's stand-in 262K). Without a `usage_update` the size grows by what the turn added (message + answer), never by the turn's sum. The run's billed counts still go to the usage log unchanged. | `antigravity/events.ts` (`antigravityContext`, `antigravityUsage`), `antigravity/run.ts`, `shared/types.ts` (`usage.context`), `thread-runner.ts` |
| For a session engine the bar splits the size into base (rules, skills, tool descriptions: the estimate) and the rest (conversation and tool results), so a long conversation is no longer all called "base". | `thread-runner.ts` (`context`) |
| An Antigravity thread past the compaction line (80% of the window, at most 200K) is compacted before the next message: the old session stays where it is (its id is recorded), a summary of the thread's chat lines is written (the summarizer is a one-off Antigravity session without the app's tools), and the message opens a **new** session that starts from the summary and the last ten lines word for word. The "saspiest" button does the same now. A failed summary changes nothing: the run goes on in the old session. | `thread-runner.ts` (`compactSession`, `sessionComplete`, `historyFor`, `compactNow`), `agent/session-compact.ts` |
| **The original is kept.** Before any compaction replaces a conversation, the whole original goes into the thread's database (`threads.db`, table `archives`: the engine, the engine's session id, sizes, the summary and the full body: for the pi engine every message with its tool calls and results, for an engine session the thread's chat lines since the last compaction). A compaction that could not store its original does not happen. The compaction line in the chat has "Atvērt oriģinālo sarunu", which reads it back (`threads.archive`, not offered to agents: it can be megabytes). | `core/threads-db.ts`, `core/threads.ts`, `session.ts` (`threadArchive`), `main/handlers/threads.ts`, `shared/api.ts`, `AgentDock.tsx` (`ArchiveView`) |
| A conversation rebuilt from the transcript (restart, new session) now also brings back the lines a session compaction kept word for word (`ChatEntry.keep`); older compaction lines behave as before. | `session-compact.ts` (`seedFromTranscript`) |

**Test:** `test/22.1-session-compaction.test.ts` (9 tests: the meter on a turn that billed 1.7M, the compaction into a new session with the old session id and the original stored, a session under the line left alone, a failing summary changing nothing, seed and plan, the archive table), `test/22.0-antigravity.test.ts` (the server's `usage_update` through a whole run on the stand-in server). Also ran: 16.2, 15.2, 0.4, 0.6, 21.0, 21.2, 21.3.

**Same rule for every provider (version 2.13.6, his words: "should be saved like that for all provider sessions").** The pi engine (every API-key provider) already summarized in memory; it now also stores the original (all messages with tool calls and results) before it does. Antigravity and the Claude subscription use the new-session compaction above. For the Claude subscription the Agent SDK's own auto-compaction is switched off (`DISABLE_AUTO_COMPACT=1` in the run's environment, `claude/run.ts`), otherwise it would compact inside the session first and lose the original; the app's line (80% of the window, at most 200K) does it instead, and the "saspiest" button works for it too. The summarizer is a one-off session of the same engine without the app's tools. Test: `22.1` (Claude case) and `claude-login` (environment).

**Not done / limits.** (1) A summary of a session thread is made from what was said (his messages and the agent's answers), not from the tool results the old session holds, as the rebuild after a restart always was; the old session itself is untouched at the engine (Google's server, or Claude's own session file). (2) The summarizer starts one extra short session at the engine per compaction. (3) With the SDK's auto-compaction off, a single turn that adds more than the room between the line and the real window would hit the model's limit; the chat then says "Konteksts ir pilns" and the button compacts. **Not checked live** (his rule): no real Antigravity or Claude run was made; Antigravity's behaviour is read from its own source (`acp_server/server.py`: `_maybe_send_usage_update`, `_extract_turn_usage`), and both engines are tested through stand-ins. Whether `DISABLE_AUTO_COMPACT` is honoured by the bundled Claude program is from its documented setting, not tried.

## 2026-11-25: the imported agents had no tools, and BPV could not edit the fleet (version 2.14.0)

His words (via the project chat): the in-app BPV said the imported discipline agents only get read tools, that modelling tools "must be granted in Settings → Agents", and that the Revit tool set lacks `delete_element` and `send_code_to_revit`. He checked Settings → Agents → BPV → Tools: every box was unticked. "Why we not have all agents setup correctly?" Then: "setup for all agents all tools and skills and allow BPV to actually edit whole fleet settings", and, when the first plan read as "all tools to all agents": "NO, LOGICALLY".

**Cause (read from the code).**
| What BPV said | True? | Why |
|---|---|---|
| Imported agents have `tools: []` | **True** | The team import (`mergeRole`, `team-import.ts`) wrote `tools: []` for every role; only the role text, name, department and skills came from the folder. |
| They only get read tools | **True, and worse for Revit** | A specialist is given every read tool of the app by itself, and the tools in its list. The Revit MCP's own reading tools (`get_current_view_elements`, …) are *not* given by themselves (`specialistTools`), so an agent with an empty list had no Revit at all. The Tools tab said "reading is always allowed" and did not list the Revit read tools, so nobody could tick them. |
| `revit.status`, `revit.views`, `revit.rooms`, `revit.files` | They are not tools | They are calls of the app (read through `app_read`), which every agent has. |
| Modelling tools "must be granted in Settings or run via lead" | **True** | `create_*`, `operate_element`, `revit_create_sheet`, `revit_save_copy`… are `confirm`/`run` tools: an agent has them only if its list names them, and a `confirm` one only with the level cap "user confirms" (the Tools tab hides confirm rows until that level is chosen). The lead (main agent) has every tool offered at its gate. |
| The app lacks `delete_element` and `send_code_to_revit` | **True, by design** | Both are `never` for every agent (`ALWAYS_NEVER`, `revit-levels.ts`; v2-design 4.2). The bundled Revit MCP has both; the app does not offer them. Kept: his correction ("logically") ruled out giving every agent everything. |
| BPV cannot edit other agents | **True** | The calls exist (`agents.save`, `agents.role.set` through `app_confirm`), but BPV had no `app_confirm` and a `run` level cap, so the confirm tools were filtered out. |
| `open_document`, `save_document`, `reload_links` | Not offered | Not in `revit-levels.ts` (unknown tool = never). |

| Done in 2.14.0 |
|---|
| **Every BD role has tools that fit it** (`src/shared/fleet-defaults.ts`). **AR**: the whole building model (levels, grids, walls, rooms, tags, sheets, plans, elevations, view settings, parameters, save, export, room inventory). **BK**: levels, grids, structural framing, its own model, sheets. **UK, AVK, GA, EL, ESS**: their own model (lines, points, surfaces, dimensions, parameters, sheets), no levels, grids or rooms. **BPV**: reads every model, opens and refreshes linked ones (`open_document`, `reload_links`), makes sheets and exports, runs the project (stages, clock, deliveries, inventory), `app_change` / `app_confirm` / `app_settings`; no modelling and no `save_document`. **UD**: colours and marks fire compartments, writes fire parameters, filters schedules. **TAM**: quantities and schedules (schedule filter), documents. **EKS**: reads the model, its own expert tools, never changes a model, a fact or a task. **AA, CD, EA, AK**: read the model, write their part as documents. **MEL**: documents and project data, no Revit. Everyone: notes, facts, requirements, tasks, pins, comments, viewer tools, documents for a delivery, checks. |
| **Skills.** The synced Revit skills that fit each role are added to its list (room dimension chains: AR; IFC export classes and property sets: AR, BK, the engineers, BPV; shared coordinates: AR, BPV). `revit-api` is left out on purpose: it teaches `send_code_to_revit`, which no agent has. The 16 roles' own skills were already assigned by the import; **an office skill is told to an agent only after he marks it tested on the Prasmes page** (the import leaves them as drafts), so those still need his mark. |
| **Revit document tools.** `open_document`, `save_document`, `reload_links` are `confirm` (each batch waits for his click). A batch that only opens a document skips the "active document must be the working copy" check, because opening the working copy is how an agent gets onto it when another project's model is active; the next batch that changes anything is held to the working copy again. |
| **The Tools tab lists the Revit MCP's reading tools** (they have to be ticked, unlike every other read tool) and says so. |
| **BPV edits the fleet.** New tool `agent_configure` (level `confirm`, BPV only, `src/agent/tools/fleet.ts`): one agent per call, as a patch (add or remove tools and skills; model, provider, effort, level cap, department, who it may write to; name, description; role text appended or rewritten, never shortened by half). It goes through the settings page's own `agents.save` / `agents.role.set`, so every check applies (a tool above the cap, an unknown tool, a context over the limit is refused with the reason). Before each save the old `agents.json` is copied to `agents\versions` and a line goes to `agents\fleet-changes.jsonl`. Nothing is deleted. |
| **Existing fleet set up once.** At the first start of this version `setupFleet` fills every agent whose tool list is **empty** with its role's tools and level cap (BPV, AR, BK and the other `confirm` roles get "user confirms"), and adds the synced skills. A list he made is kept. A marker file (`agents\.fleet-setup-1`) makes it run once, so anything he unticks afterwards stays unticked; the result is in `agents\fleet-setup.log` and the app log. The team import does the same for a new or empty agent. |
| **Context limit.** `SPECIALIST_FIXED_MAX` 16 000 → 28 000 tokens: every agent's read-tool declarations alone measure ~9 400, a modelling role's own tools add ~7 000 (AR ~21 700, BPV ~22 400), so 16 000 refused every one of them. It is a guard, not a budget. |

**Test:** `test/23.0-fleet-setup.test.ts` (10 tests: every role has a non-empty list; every tool exists, none is `never`, process or main-only; who models and who only reads; the three document tools `confirm`, delete and `send_code_to_revit` still `never`; each default spec passes `validateSpec` and fits the limit with a role text of the longest allowed size; `withFleetDefaults`; what a run gets (AR has Revit reading and modelling, an agent with no list has no Revit, `agent_configure` only for BPV at the `confirm` cap); `agent_configure` patch and through a bridge double; `setupFleet` once and idempotent). **Not checked live** (his rule): the first start on his PC, a confirmed `agent_configure` batch, `open_document` on a real model.

**Not done / his call.** (1) `delete_element` and `send_code_to_revit` stay `never`; if he wants deleting, the narrow option is `delete_element` at `confirm`, per batch, on the working copy. (2) Every agent that has a Revit tool takes the single Revit seat for its whole run, even when it never calls Revit (the 21.2 note above): with 13 agents holding Revit tools, a second agent that starts while another holds the seat runs without Revit and is told to ask. Taking the seat at the first Revit call would fix it; the Revit server is chosen when the run starts, so that is a larger change. (3) The imported skills are drafts until he marks them tested on the Prasmes page. (4) `test/17.1-team-import.test.ts` (2 tests) already failed before this change: with the shipped three agents the lead's context (19 552 tokens) is over its 18 000 guard, so a fresh-folder import is refused; his own app is unaffected because a save that makes the lead no heavier always goes through. (5) See the next entry for the tools real projects needed (built the same day).

## 2026-11-25: the agents get what a coding agent has: images, zoom, archives, conversions, drawings, spreadsheets (version 2.14.0)

His words (via the project chat), answering the list of what real project work was missing: spreadsheet writer with formulas, "add"; calculator, "no tool needed for simple arithmetics"; view any image, "yes and check other formats that may be needed, so agent can open archives or maybe even convert files"; zoom, "add all needed, doesn't it already have some python for it all?"; DWG and survey data, "Cad-craft not getting that?"; and "in short it should have all tools you have as an agent" (he was asking mostly about the Revit MCP tools; Revit stays MCP only).

**What was found.**
- **CadCraft can read drawings, the app never used that.** CadCraft's `agents.js` is DOM-free and written for assistants: it describes a drawing, lists and searches its objects, checks it, and plots a sheet to PDF or SVG; `dxf2000.js` and `dwg-save.js` write DXF and DWG. The app used CadCraft only to show and compare drawings (`src/sources/dwg.ts`). Tried in plain node on CadCraft's own sample drawings: reads, describes, searches, plots, writes DXF/DWG, and the written files read back. Point clouds: CadCraft's reader needs the browser (a map library through the page's import map), so only the LAS / LAZ **header** is read here; the viewer opens the clouds.
- **Python.** Python 3.14 is installed on this PC, and `run_command` (PowerShell, a click each time) can call it, but the app does not depend on it: everything below runs in the app (Node, Chromium, CadCraft, Windows' own System.Drawing), so it works on any office PC. 7-Zip and LibreOffice are on this PC; the tools use them when they are there (7z, rar, xz, Office-to-Office conversions) and say so when they are not.
- **The file tools he means already existed**, but no role had them: `read_file`, `list_dir`, `find_files` (read, every agent), and `write_file`, `edit_file`, `copy_file`, `move_file`, `run_command` (confirm). They are now in every role's list except the independent expert's.

| Done in 2.14.0 |
|---|
| **`write_spreadsheet`** (run): a new .xlsx with formulas. A text cell starting with `=` is a formula; a small evaluator (`src/sources/export/xlsx-formula.ts`: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, PRODUCT, ROUND, ROUNDUP, ROUNDDOWN, INT, ABS, SQRT, POWER, MOD, IF, AND, OR, NOT, SUMPRODUCT, IFERROR, ranges, other-sheet references, `;` or `,`) computes every formula before the file is saved: the values are returned to the agent (so a total can be checked), written as the cache (any viewer shows them; the workbook says fullCalcOnLoad, so Excel recalculates), and a formula that divides by zero, loops or points at nothing is refused with nothing saved. Goes into the open delivery's staging (like `write_document`), else the agent-work folder; never overwrites. No calculator tool, as he said: the evaluator is the check. |
| **`view_image`** (read): PNG, JPG, WebP; GIF, BMP, TIFF, ICO, EMF, WMF (turned into PNG by Windows' System.Drawing, paths passed as environment variables, never in the command text); a PDF page; a DWG / DXF (the model or one sheet, as PDF through CadCraft). **`region`** (fractions of the picture from the top left) zooms into one part: a PDF part is drawn at its own scale into a canvas of the part's size (`render.ts` `renderRegion`), so a corner of an A0 sheet costs what the corner costs; a photo part is cropped. `view_page` (registered sources) got the same `region`. Results are limited to 2000 px (3000 for a part) and ~4.5 MB; a big PNG goes out as JPEG. |
| **`archive_list`** (read) and **`archive_extract`** (run): zip, gz, tar, tgz built in; 7z, rar, xz, bz2, cab, iso … through 7-Zip. Extracts into a new folder of `<app data>gent-work\<project>\`, never into the project and never over anything; a path leaving the folder (`..`, a drive letter, an absolute path) is skipped and listed; more than 100 000 files or 4 GB is refused before anything is written; no passwords. |
| **`convert_file`** (run): images → png / jpg; pdf → png (pages, scale); dwg / dxf → pdf, svg, png, dxf, dwg (sheet, window, paper); docx → pdf (Word, else LibreOffice); doc, rtf, odt, xls, ods, ppt, pptx, odp, docx, xlsx → pdf, docx, xlsx, pptx, odt, csv (LibreOffice, own profile); xlsx → csv (semicolon, rows keep their numbers) and csv → xlsx. New files in `agent-work`; it says what is not supported instead of guessing, and points to `run_command`. |
| **`cad_describe`, `cad_objects`, `pointcloud_info`** (read): what is IN a drawing (units, extents, objects by type, layers, blocks and their uses, sheets with viewports and scales), the objects themselves with coordinates, length and area, found by type, layer, block, a word in a text or attribute, a window, a sheet; counts; one object in full; the LAS / LAZ header (points, bounds, scale, offset). One drawing is kept open per process, so a few questions read it once. |
| **Every role** has the new tools and the file tools (`fleet-defaults.ts`): so every role except the expert is now at level cap "user confirms". The expert (EKS) gets the new run tools (convert, unpack) and none that write files or run commands. Context limit measured again with all of it: the largest role (BPV) fits `SPECIALIST_FIXED_MAX` (28 000) with a role text of the longest allowed size. |

**Test:** `test/23.1-media-tools.test.ts` (10 tests: the formula evaluator including references across sheets, errors and unsupported functions; the xlsx written with cached values and read back; `write_spreadsheet` refusing an error and never overwriting; zip / tar / tgz / gz listed and unpacked with unsafe paths skipped; the archive tools; region checks; `viewImage` with a stand-in for `nativeImage` and for the page renderer; `cad_describe` / `cad_objects` on CadCraft's sample drawings; `convert_file` DWG → PDF / SVG / DXF with the DXF read back and DXF → DWG with the DWG read back, CSV ↔ XLSX; the LAS header). **Not checked live** (his rule, and Electron is not available in the tests): `nativeImage` crop and resize, the region render of a real PDF page, the System.Drawing conversion, 7-Zip and LibreOffice calls, Word's PDF.

**Not done / his call.** (1) Point clouds are read only as a LAS / LAZ header; reading and slicing the points would need CadCraft's cloud reader loaded without its browser import map. (2) No `grep` over the CONTENT of PDFs and Word files beyond what the project's search already indexes (`search_project`, `search_sources`); `find_files` searches names and plain text. (3) Audio and video are not converted (ffmpeg is on this PC; `run_command` can call it). (4) `.dwg` written by CadCraft is AutoCAD 2000 format: open it in the office's AutoCAD or Revit once before relying on it.

## 2026-11-25: after a compaction the agent did nothing and the chat said "working" (version 2.14.1)

His words: "After compaction wasn't resumed any actions" (screenshot: "Saruna saspiesta: 413K → ≈21K tokeni", then "The agent is working", Stop, Tasks 6/6, 12 waiting, no actions).

**What the logs say (read, not guessed).** The compaction itself worked (413,485 → 21,430 tokens, 50 s for the summary) and the new session started: the server's own transcript of it (`antigravity\profile\antigravity-acp\brain\<session>\.system_generated\logs\transcript_full.jsonl`) shows eleven steps in 20 s (the model reading the tool descriptions the server keeps as files), and then no step for nine minutes, until he pressed Stop. The app saw no event in that time (the server's own file reads are not reported as events, by design), so nothing showed, and a prompt to Google's server has no time limit. So two things were missing: the new session was never told to carry on (the summary read as background), and a server that stops answering (a stalled model call, or a quota backoff the server retries silently) held the run "working" for ever.

| Change | Where |
|---|---|
| A prompt with no sign of life (no update from the server, no app tool call going) for 5 minutes is cancelled; if the server honours the cancel, the **same session** gets one resume prompt ("continue from where you stopped") and the chat says so. A second stall, or a server that ignores the cancel, ends the run as an error in words ("Antigravity ilgi neko nedarīja …") so the held message and the next send are not stuck behind a run that never ends. An app tool that is running (a Revit batch, a question waiting for his click) keeps the run alive however long it is quiet. | `antigravity/run.ts` (`STALL_MS`, `STALL_RESUME`, the `prompt` watchdog) |
| The standing text of a session that starts from a compaction summary now says: this is the same work, not a new start; continue from «Procesā» and «Nākamie soļi» and from his last message, act with the tools at once, read again what the summary lacks. | `session-compact.ts` (`withSummary`), `thread-runner.ts` (`seedFor`) |

**Test:** `test/22.0-antigravity.test.ts` (a silent prompt is cancelled and resumed once in the same session; silent twice, or deaf to the cancel, ends as an error; a running tool call is not a stall), `test/22.1-session-compaction.test.ts` (the new session's text tells it to carry on, and its task is the message that started the run).

**Not done / limits.** Only the Antigravity engine has the watchdog; the Claude subscription and pi engines have their own retries and are unchanged. What the model does after the resume is Google's: if the server stays silent for 10 minutes again, the run ends as an error and he sends again. The new session still starts from a summary of what was said, not from the old session's tool results. **Not checked live** (his rule).

## 2026-11-25: agent notes appeared in an office project folder (office folders are read-only to agents) (version 2.14.2)

His words (via the project chat): `.md` work files dated 24 and 25 November (an RFI letter, an execution plan, a master plan / gap analysis, analyses, a matrix) were found in an office project folder on the B: drive. That folder must be read-only to the app.

**Who wrote them (read from the logs and the Antigravity transcripts, not guessed).** The app's own `write_file` tool, called by an agent on the Antigravity engine, not Antigravity's built-in file tools. The server's own transcript of the thread (`antigravity\profile\antigravity-acp\brain\<session>\.system_generated\logs\transcript_full.jsonl`) shows three `call_mcp_tool` → `write_file` calls in one step, and the results name the three files in the project folder (written 25 Nov 12:47 local). The Antigravity thread said so itself ("saved … into 3 new .md files in the project folder"). The earlier `.md` files of 24 Nov are of the same kind (analyses of the same project); whether each came from `write_file` could be proven only for 25 Nov, the 24 Nov threads' transcripts were not matched file by file.

**Why nothing stopped it.** Since 2.10.1 `write_file`, `edit_file` and `copy_file` have been **free of any click for a text note inside the open project's folder**, and the "open project's folder" is the office folder (`project.json` `root`); a relative path also meant that folder. The path guard of the design (`core/guard.ts` `checkWrite`: never write inside the source root) was never applied to these general tools; it covers the project store only. So the rule "the office folder is read-only" held for every tool except the one that gives an agent a text file.

**What the Antigravity engine itself did.** Its own tools were *not* the writer: the log shows its shell (`execute`) refused twice on 25 Nov ("refused a tool of the server's own"), which is the permission handler of `antigravity/run.ts` working. But the session was only protected by that refusal; the server's own writing, shell, browser and helper tools were still switched on. The stray `Projektesana.exe` started once by `localharness_external.exe` is not explained by this: no log line shows what started it, so it is **not proven** that the same hole was the cause; the only own-tool launch path visible in the logs is the shell, which is now off.

| Change | Where |
|---|---|
| **No agent tool writes into an office folder, whatever the click.** `write_file`, `edit_file`, `copy_file` (target), `move_file` (both ends) and `run_command` check the target against the roots of **all** projects (symlink and junction resolved, `..` and relative paths resolved, a `\server\share` path never allowed, a root on a missing drive skipped). Refused with the reason in the tool result; **the gate refuses before it asks**, so no click is even offered, and the batch card does not list it. | `agent/tools/project-write.ts` (`officeBlock`), `levels.ts` (`Gate` `deny`), `thread-runner.ts`, `tools/general.ts` |
| **Agent files go to the app's own per-project folder**, `<app data>\agent-work\<project>` (the folder `convert_file`, `archive_extract` and `write_spreadsheet` already used). A relative path of a write tool means that folder; a text note there needs no click (the old text is kept in `<app data>\backups\agent`); reading a relative path finds the project's file first, else the agent's note. `run_command` starts in that folder. | `project-write.ts` (`workFolder`, `resolveWrite`, `resolveRead`), `tools/general.ts` |
| **`run_command` that writes into an office folder is refused** when it names the folder (or runs in it) with a write verb or a redirect; a read (`Get-Content`, `dir`, `2>$null`) and a file or folder called "Copy of …" or `notes.md` are not touched. A text check cannot see a path a command builds itself, so for a command the user's click stays the last line (he sees the command). | `project-write.ts` (`shellBlock`) |
| **Antigravity's own writing, running and browsing tools are turned off for every session** (`write_to_file`, `replace_file_content`, `multi_replace_file_content`, `run_command`, `send_command_input`, `browser_subagent`, `invoke_subagent`, `search_web`, `read_url_content`, `generate_image`, `run_workflow` …, `session/new` `_meta.antigravity.disabledTools`). Reading stays (`view_file` is how the server shows the model a long tool result it saved to a file), and the permission refusal stays as the second wall. A runtime that refuses the long list gets the old minimal setup, logged. | `antigravity/acp.ts` (`ANTIGRAVITY_OWN_TOOLS_OFF`, `antigravitySessionSetup`), `antigravity/host.ts` |
| The Claude subscription engine runs with `tools: []` (no built-in tools) and the pi engine only has the app's tools, so this hole was the app's own tool, not an engine. | `claude/run.ts`, `pi/run.ts` (unchanged) |

**What I did not touch: the eight files already in the folder.** They are his, and he decides (moving or deleting is his): five from 24 Nov and three from 25 Nov, all in the root of the one project's office folder (their names are in the project chat, not in this repository: real project data). Proposal: he moves them himself to `<app data>agent-work<project>` (or his own notes folder) so that nothing stays in the office folder; the app will not write them back.

**Test:** `test/21.1-free-writes.test.ts` (rewritten, 13 tests: relative path = work folder, free text notes there, what still asks, every write tool refused in an office folder by relative / full / `..` / other project's path, a junction leading in, a network path, `run_command` named / in-folder / read / look-alike names, the read fallback, backups, `edit_file`, the gate refusing before asking, the Antigravity session setup), `test/22.0-antigravity.test.ts` (setup). Also ran: 0.5, 21.2 revit-no-shell, 17.2.

**Not done / limits.** (1) A shell command can reach a path in ways the text check cannot see; it still asks him first. (2) Reading the office folder by an agent is unchanged (read-only by design, and the server's `view_file` stays on). (3) `<app data>\agent-files\<project>.json` (the old "files the agent made" list) is no longer used; it can stay. (4) **Not checked live** (his rule); the disabled-tools list is names found in the runtime and the transcripts, and a name the runtime does not know is ignored by it, but this was not run against Google's server (that needs his signed-in account).
