# Mod Hub

Desktop mod library: scan Steam Workshop, game `Mods` folders, and Vortex staging; compare Workshop revisions; favorite locally; subscribe via Steam; Nexus track/download via API key and nxm links.

## Stack

- Electron + Vite + React + TypeScript + CSS (no Tailwind)
- Catalog stored in `%APPDATA%/mod-hub/` (Electron userData)

## Run (Windows)

```powershell
npm install
powershell -File tools\start-mod-hub.ps1        # built app; rebuilds first if sources changed
powershell -File tools\start-mod-hub.ps1 -Dev   # Vite dev server + hot reload + DevTools
```

**Use the desktop window titled "Mod Hub".** `http://localhost:5173` in a normal browser has no Electron bridge, so scanning won't work there.
`tools\create-mod-hub-shortcut.ps1` makes a desktop shortcut.

## Features

- **Library:** Steam Workshop (all libraries), game `Mods` folders, Vortex staging/downloads and Nexus metadata in one list (carousel, grid, or sortable table).
- **Workshop:** update detection, "Keep & unsubscribe" (copy into the game's local mods folder so Steam can't update/remove it), kept-copy updates, last-known details for mods removed from the Workshop.
- **Nexus:** track/untrack, nxm download, missing image/date fill-in via your API key, injected browse carousel.
- **Load order:** enable/disable in the game's own mod list (RimWorld `ModsConfig.xml`, Project Zomboid `mods\default.txt`, Isaac `disable.it`), RimWorld auto-sort from About.xml rules and drag-to-reorder. Refuses while the game runs and backs up config files first.
- **Loadouts:** RimWorld mod lists (`.rml`, also usable in-game), PZ saved lists and per-save lists, Mod Hub lists for Isaac. Apply, update, save as new.

## Settings

- **Nexus:** [Personal API key](https://www.nexusmods.com/users/myaccount?tab=api+access) for track/untrack on your account.
- **Steam:** Subscribe/unsubscribe go through the running Steam client.
- **Extra paths:** Add arbitrary mod folders to scan (manual installs, backups).

Data lives in `%APPDATA%\mod-hub\` (catalog, settings, thumbnail cache, config backups, loadouts).

## Notes

- The injected Nexus browse carousel uses `injectionRuntime.js` from the separate
  [Vortex mod-browser-carousel plugin](https://github.com/Strikeborn/nexus-vortex-mod-browser-carousel) repo, checked out next to this one as
  `vortex-builtin-mod-browser-enhanced/` (not part of this repo).

## License

Mod Hub is free software under the [GNU General Public License v3.0](LICENSE) (or any later version).
You can use, study, change and share it; if you distribute a modified version, it has to stay under the GPL
with its source code available.
