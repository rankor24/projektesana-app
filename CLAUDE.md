# Projektesana-app: standing rules (from Boris)

## Release: one launching exe, one setup, always the latest

- After a change Boris will look at, rebuild so that **both** are the newest version:
  the launching exe `release\win-unpacked\Projektesana.exe`, and the one setup `release\Projektesana-Setup-<version>.exe`
  (with its `.blockmap` and `latest.yml`).
- **Only one version of each.** No older setups, no extra build folders (`release\build-*`), no second launching exe anywhere in
  the project folder. Build straight into `release\` (`npm run dist`), never into a side folder.
- Before building, check that no `Projektesana.exe` from this folder is running
  (`Get-CimInstance Win32_Process -Filter "Name='Projektesana.exe'"`). A running app locks `release\win-unpacked`.
  Never kill his app: ask him to close it, then build. If it cannot be built in place, say so; do not make a second copy.
- Each build gets a new version number (patch for fixes, minor for a feature set): `package.json` and both
  `src/*-addon/projektesana/addon.json` carry it, and the setup file name follows it.
- When the new setup is built, delete the previous setup files in `release\` (files only; the next build's output replaces them).
  Folders are never deleted by me (global rule): name any leftover folder and let Boris delete it.

## GitHub

- Big changes (a version, a feature set, a round of his complaints) are committed and **pushed to `main` without asking**; the commit
  message names the version. Small fixes are committed locally and go out with the next big change, or when he asks.
- Other sessions work in this folder too: stage explicit files (never `git add -A`), leave their uncommitted work out, and say what
  went in and what stayed out.

## Design

- The approved design is the Whiteboard "Projektesana UI layout plan" and BIM Crew's behaviour (`D:\Code\BIM\BIM Crew`). Read them
  before inventing a layout. His complaints and rulings so far: `docs/ui-complaints.md`.
