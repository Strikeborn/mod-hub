# Plan: Mod Hub deploys Baldur's Gate 3 mods (taking over from Vortex)

Status: plan only. Nothing here is built yet beyond the read-only load order (`electron/loadOrder.ts`, `baldursGate3`).

## Why BG3 first

BG3 is the simplest game to deploy for:

- **Mods are single `.pak` files** in `%LOCALAPPDATA%\Larian Studios\Baldur's Gate 3\Mods`. There's no virtual file system and no file-conflict resolution between loose files, unlike Skyrim.
- **One config file** controls what loads: `PlayerProfiles\Public\modsettings.lsx` (the `Mods` node in Patch 7+).
- **The few other kinds are easy to spot:**
  - Script Extender: `bin\DWrite.dll` plus `ScriptExtenderSettings.json`.
  - Loose `Data\` overrides: rare and legacy.
  - "Bin" mods (e.g. native DLL loaders).

## How Vortex does it today (what we must coexist with)

- **Staging:** `%APPDATA%\Vortex\baldursgate3\mods\<mod folder>\<file>.pak`.
- **Deployment:**
  - Each `.pak` in `Mods\` is a **symlink** into staging (`deploymentMethod: symlink_activator`).
  - Vortex records every file it placed in `Mods\vortex.deployment.json`, with each file's `relPath`, `source` mod folder and time.
- **Load order:**
  - Vortex rewrites `modsettings.lsx` on deploy, keeping `modsettings.lsx.backup`.
  - It fills each `ModuleShortDesc` (Folder, Name, UUID, Version64, MD5, PublishHandle) from the `meta.lsx` inside each `.pak`, read with LSLib.
- **Rule:** Mod Hub never edits or removes files listed in `vortex.deployment.json`, and never rewrites `modsettings.lsx` while Vortex manages the game. Otherwise Vortex reports "external changes" and may undo ours.

## Phases

### 1. Read `.pak` metadata ourselves (no Vortex needed)
- Parse the LSPK header (v15/16/18), read the file list, and extract `Mods/<Folder>/meta.lsx` to get UUID, Folder, Name, Version64, Author, Description and Dependencies.
- Decompression: file entries are LZ4 (frame or block) or zlib.
  - Use `lz4js` or a small LZ4 block decoder. zlib is built into Node.
  - Use LSLib's `Divine.exe` only as a fallback.
- Gain:
  - Exact matching of `modsettings.lsx` entries to `.pak` files, instead of today's name heuristics.
  - Missing-dependency checks ("BG3SX needs BG3AF").
- Tests: build small `.pak` fixtures in tests. Never ship real mods.

### 2. Checks before Play (still read-only)
- **Script Extender:**
  - Is `bin\DWrite.dll` present?
  - Do any active mods declare SE use (`ScriptExtender\Config.json` in the pak), so they need it?
- **Dependencies:** a dependency is missing, or loads after the mod that needs it.
- **Stale entries:** `modsettings.lsx` lists a mod whose pak is gone. The game silently drops it, and saves complain.
- Paks in `Mods\` that the game won't load: not in `modsettings.lsx`, with no `meta.lsx`.
- Shown in the existing Issues panel, with **Auto-sort** (dependencies first, otherwise keep the order).

### 3. Mod Hub's own deployment ("Mod Hub manages BG3" switch, off by default)
- **Staging:** `%APPDATA%\mod-hub\deploy\baldursgate3\<mod>\` holds Mod Hub-installed mods (from a Nexus download or a local archive).
- **Deploy = for each enabled mod:**
  - Hardlink each pak into `Mods\`. A symlink would need admin or developer mode; fall back to a copy across drives.
  - Record each placed file in `Mods\modhub.deployment.json`, mirroring Vortex's format: relPath, source, size, mtime.
- **Write `modsettings.lsx`:**
  - Keep the `GustavDev`/`GustavX` base entry first, then mods in load order, with fields from `meta.lsx`.
  - Back up first. Keep the existing XML layout and version header the game wrote.
- **Purge:** remove only files listed in `modhub.deployment.json` whose size/mtime still match (otherwise ask). Never touch Vortex's files.
- **Guards:**
  - `bg3.exe`/`bg3_dx11.exe` must not be running.
  - If Vortex manages BG3, refuse unless the user picks "Take over from Vortex" (step 4).
- **Undo:** every deploy saves a snapshot (paks placed + previous `modsettings.lsx`), so "Undo last deploy" restores it exactly.

### 4. Taking over from Vortex (one-time, explicit, reversible)
1. Show the plan:
   - The N mods Vortex deployed (from `vortex.deployment.json`).
   - Their staging folders.
   - The current `modsettings.lsx` order.
2. Copy (not move) each Vortex staging folder into Mod Hub's staging, carrying over the Nexus id and version from Vortex's state, so update checks keep working.
3. The user purges BG3 in Vortex (Vortex removes its symlinks and its manifest). Mod Hub waits until `vortex.deployment.json` is gone.
4. Mod Hub deploys the same set in the same order.
5. Verify:
   - Every pak is present.
   - `modsettings.lsx` has the same UUIDs in the same order as before.
   - Show a diff if anything differs.
6. Rollback:
   - The previous `modsettings.lsx` is backed up, and Vortex's staging is untouched.
   - Re-deploying in Vortex restores the old setup.

### 5. Loadouts for BG3
- Loadouts become Mod Hub lists of mod UUIDs in order. Apply = enable/disable + deploy + write `modsettings.lsx`.
- Share codes (`MODHUB1:`) work as they do for other games. Missing mods link to their Nexus pages.

### 6. Script Extender management
- Detect, install (from the official GitHub release; checksum shown; never auto-run) and update `DWrite.dll` in `bin\`.
- Show SE's log folder and its last error in Play warnings.

## Out of scope for now
- Installing from mod.io (the game's built-in mod manager handles those; read them only).
- Loose-file `Data\` mods (warn only).
- Multiplayer sync.

## Risks and how we handle them
| Risk | Handling |
| --- | --- |
| Game patch changes the `modsettings.lsx` layout (it did in Patch 7) | Write by editing the existing XML in place; refuse and warn when the base-module node isn't recognised. |
| Vortex and Mod Hub both deploying | Take-over requires a Vortex purge first; both deployment manifests are checked before every deploy. |
| Hardlinks across drives fail | Fall back to copying; the manifest records which was used. |
| A pak's `meta.lsx` can't be read | Deploy the pak but leave it out of `modsettings.lsx`, and show it under Issues. |
| User edits files by hand | Purge only removes files that still match the manifest; anything changed is listed for the user to decide. |

## Order of work
Phase 1 → 2 (immediately useful, still read-only) → 3 behind the off-by-default switch, tested on fixture folders → 4 with the user watching → 5 → 6.
