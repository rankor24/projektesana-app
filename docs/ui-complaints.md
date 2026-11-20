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
