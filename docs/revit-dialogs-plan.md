# Plan: when Revit shows a popup and the agent's Revit calls stop

Status: **built on a branch, checked without a live Revit; not released** (results and open points: `docs/ui-complaints.md`, 2026-11-26 "Revit popup handling checked on the PC"). The text below is the plan as written before the build; where the build differs (the screen helper was built too, with a model that can click), the code is what counts. Written 2026-11-26 from the user's request: "properly plan some Computer Use, for times when Revit has popup window that needs clicking ok/cancel to continue/re-try."

Scope: this is the user's own, narrow exception to the rule of 2026-11-24 (agents use only the Revit MCP, never drive Revit through the shell or UI automation). It covers **Revit's own popup windows only**. The rule stays for everything else: `run_command` keeps refusing UI automation (`levels.ts` `UI_AUTOMATION`, `revitShellBlock`), and nothing here loosens that.

## 1. What happens today (read from the code, not run)

| Fact | Where |
|---|---|
| The bundled add-in handles **no** dialogs and **no** failures. No `DialogBoxShowing`, no `FailuresProcessing`, no `SetFailureHandlingOptions` anywhere in `plugin/` or `commandset/` of `D:\Code\BIM\revit-mcp`. The only dialogs it shows itself: `say_hello` (a TaskDialog) and one at start when every port is taken. | `plugin/Core/Application.cs`, `commandset` |
| `commandset/Utils/DeleteWarningSuperUtils.cs` (an `IFailuresPreprocessor`) exists but **nothing uses it**. It must not be switched on as it is: for an error it calls `ResolveFailure` and commits, and the default resolution of many errors is "delete elements". | grep: no reference |
| Every transaction is a plain `Transaction`, so Revit's own warning and error dialogs can appear. | `Utils/TransactionUtils.cs`, `ExecuteCodeEventHandler.cs` |
| Opening a model (`OpenAndActivateDocument`) can raise Revit's own dialogs (missing links, upgrade to this Revit version, worksets, "file is locked"). | `Services/ModelFiles/OpenDocumentEventHandler.cs` |
| What the agent sees when a dialog blocks Revit: **a timeout and nothing else.** Revit side waits 60 s (`send_code_to_revit`) or 600 s (`open_document`); the node server 120 s by default, 11 min for `open_document`; the app's own client 120 s (`src/revit/client.ts`); the agent's MCP client 300 s (`pi/mcp.ts`). The text says "timed out", not why. | those files |
| Risk I could not rule out from the source: an ExternalEvent raised before the timeout stays queued and may run **after** the dialog is closed, so a "retry" can do the change twice. To be proven live. | `ExternalEventCommandBase` is inside `RevitMCPSDK.dll`, no source here |

## 2. The three options

### (a) Inside Revit, in the add-in (Revit API events)

The add-in subscribes, at Revit start (`IExternalApplication.OnStartup`, already there), to:

- `UIControlledApplication.DialogBoxShowing`: fires for task dialogs and message boxes Revit raises, gives the dialog id and (for task dialogs) the text, and lets the add-in **answer it** (`OverrideResult`) or leave it.
- `ControlledApplication.FailuresProcessing`: fires when a transaction produces warnings or errors, before Revit shows its warning/error dialog; lets the add-in delete **warnings**, or roll the transaction back and return the failure text as an ordinary error.
- For our own batches: `Transaction.SetFailureHandlingOptions` with a preprocessor that deletes warnings only.

**How the agent learns a dialog blocks:**
1. The socket service of the add-in runs on its own threads (`SocketService.cs`), not on Revit's main thread. A new tiny command `get_dialog_state` is answered there, without an ExternalEvent, so it answers even while a dialog is open. It returns `{blocked, dialog: {id, title, text, buttons}, since}` from what the `DialogBoxShowing` handler recorded. **To prove live:** that the socket thread still answers while a modal dialog is up, and what clears the state (there is no "dialog closed" event; the handler returns before the dialog shows, so "closed" must come from the next Revit call finishing or from the dialog list the add-in keeps).
2. The app calls `get_dialog_state` whenever a Revit call is slower than about 15 s (no more waiting 120 s to learn nothing), and again when a call times out. The tool result then says "Revit shows dialog «…»: waiting" instead of "timed out".
3. Every dialog the add-in answered during a call is appended to that call's result ("auto-answered: «…» → Close"), so the agent knows what happened.

**Answers, by class** (the table lives in a file next to `commandRegistry.json`, `dialogPolicy.json`, so it can be changed without a new add-in):

| Class | Examples | Answer |
|---|---|---|
| A. Automatic, nothing is lost | information-only OK dialogs; "update available", "what's new"; a **warning** (elements overlap, room not enclosed, duplicate mark) | OK / close; warnings deleted (not the elements) |
| B. Default is the answer that loses nothing | "this will delete N elements", "unresolved references / link not found", "family already exists: overwrite", any error dialog | **Cancel / No / Close.** The operation then fails with the dialog text as its error, and the agent re-plans (this also gives the agent the reason). Only a rule in the table can pick another answer, and only on the project's working copy |
| C. Never answered by the app, the user decides | anything on a file outside the working copy (originals, B:), "save changes to X?" for such a file, synchronize with central, licence or sign-in, crash recovery, anything not in the table | left open; the app tells the user (section 4) |

The user's ruling of 2026-11-26 (agents work alone on the working copy, delete included) is respected: a class A or B answer needs no click. The principle for unknown dialogs is "do not guess": they stay open and the user is told.

**Learn mode first.** I cannot see which dialogs this office's Revit actually raises. Version 1 ships the handlers in *learn mode*: they answer nothing, they only log id, text, buttons and what call was running. After about a week the log shows the real list, and the table is written from it. Then auto mode is switched on.

**Originals on B:** unchanged guarantee. The add-in never writes to B:. A "Save changes?" for any file that is not the project's working copy is class C. A "Save" dialog for the working copy answers Save only when the policy says so. The hard guard stays the existing working-copy check in `thread-runner.ts`.

**Logging:** one line per dialog, JSON, `%APPDATA%\Projektesana\revit-dialogs.jsonl` (the app's own folder): time, Revit pid, document, call name, dialog id, text, buttons, what was answered and by which rule, or "left open". The app shows it in Iestatījumi → Revit and the agent gets the line in the tool result.

**Cost:** C# change in the separate add-in project (`D:\Code\BIM\revit-mcp`, local branch `bv/p1-safety`), rebuilt for Revit 2024, 2025, 2026, plus a small app change (the slow-call check, the message, the settings page). Smallest risk of the three: no screen access at all.

**What it will not catch:** dialogs that are not raised through the Revit API (Windows file dialogs, licence and sign-in windows, the "Revit is not responding" and crash windows, some old modal dialogs without an id). Those are class C and need the user, or option (b) later.

### (b) Windows UI Automation, from the app, Revit's dialog windows only

The app (not an agent shell) runs a small helper: lists the top-level windows of the Revit process the agent works in, finds dialog windows owned by Revit's main window, reads title, text and buttons, and presses a button by its automation id with the Invoke pattern (no mouse, no focus needed).

- **Signal:** the app polls every 2 s while a Revit call is running, so it knows within seconds. Works even when the add-in is stuck.
- **Safe answers:** the same A/B/C table, keyed by dialog title and button ids (task dialog buttons have fixed ids; the button *text* depends on Revit's language, so text is not used).
- **Risks:** needs an unlocked, connected desktop (UI Automation sees nothing on a locked screen or a disconnected remote session); with two Revit sessions it must pick the window by pid; it is a second way into Revit next to the MCP, which is exactly what the user's rule forbade, so it needs its own narrow tool (`revit_dialog_*`, never `run_command`), a whitelist in code, and the same log.
- **Cost:** a helper (PowerShell or a small .NET exe), its tests (can only be proven live), and the carve-out in the rules.

### (c) Real computer use (screenshots and clicks)

The model looks at the screen and clicks. Not recommended:

- the whole screen goes to a model provider (other windows, office files, other clients' drawings), which is against the "no real project data leaves" attitude of this project;
- it takes the user's mouse and keyboard while they work;
- no whitelist can be enforced, only asked of the model; slow and costly per dialog;
- the app's in-app agents run on several providers and none of them has a computer-use tool built in; it would be a new vision loop per provider.

The useful part of (c) is cheap: when a dialog is open and the add-in cannot answer it, the app can show the **user** a picture of that one window (not the screen) in the chat: "Revit waits for you here".

## 3. Recommendation

**Do (a) now, in learn mode first; add (b) later only if the log shows dialogs the add-in cannot see; do not build (c).**

Reasons: it stays inside "Revit only through the add-in" (no screen clicking, so the rule of 2026-11-24 is not touched); it sees the dialog text and can refuse by default, which a screen click cannot; it works with several Revit sessions (state is per Revit process); it can be tested harmlessly (`say_hello` shows a task dialog on demand, and a warning can be produced on a working copy). (b) is kept as the second layer for what slips through, and then it needs the user's go-ahead on the carve-out.

## 4. When nothing can answer (class C, or a dialog the add-in missed)

1. The agent's tool result says which dialog blocks and that the user has to act.
2. The app shows a card in the chat and a notification: the dialog text, which Revit (pid and document), and "Revit waits for you".
3. The run waits for the call (no re-sending the same batch). After a timeout the agent does **not** repeat a change; it first reads the model state.
4. If the user closes the dialog, the call finishes or fails normally. A call still stuck after 10 minutes ends the run with an error that names the dialog.

## 5. Build order (if (a) is chosen)

1. Add-in: `DialogBoxShowing` + `FailuresProcessing` handlers in learn mode, `get_dialog_state` on the socket thread, the JSONL log, `dialogPolicy.json` (empty table). Make a queued ExternalEvent carry its request id and expire with the call, so a timed-out call is never run later.
2. App: slow-call check and the "blocked by dialog" message in `RevitClient` and the agent's Revit tools, the card in the chat, the log in Iestatījumi → Revit, text in the Revit rules for the agents ("a dialog is not a tool failure: read it, do not repeat the batch").
3. Prove live on the user's PC with two Revit sessions: `say_hello` as the test dialog; a warning on a working copy; an open of a file with a missing link; a locked screen. Check the socket thread answers while a dialog is open.
4. Read the log for a week; write the real table; switch auto mode on.

Tests that can run without Revit: the policy table (which dialog gets which answer, unknown = left open, anything on a file outside the working copy = never answered), the slow-call message, the log line format. Per the lesson of 2.16.3, none of it counts as proven until the live run in step 3.

## 6. What this plan did not check

- No live Revit in this session: every statement about Revit API behaviour above (events, what clears the dialog state, whether queued ExternalEvents run later) is from the API as documented and must be proven on the PC.
- `RevitMCPSDK.dll` (the ExternalEvent base class) was not decompiled.
- BIM Crew (`D:\Code\BIM\BIM Crew`): only its top-level layout was read; nothing there handles Revit dialogs that I found, but I did not search it file by file.
