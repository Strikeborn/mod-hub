# Security

Mods are other people's code. Many contain programs, DLL plugins (SKSE, ASI loaders, RimWorld assemblies) or scripts, and they come from sites that host anyone's uploads. Mod Hub treats every mod as untrusted until it has been checked, and it never sends your files anywhere.

## Malware checks

| What | How |
|------|-----|
| **Microsoft Defender** | Each new or changed mod folder, and its download archive, gets a custom scan: `MpCmdRun.exe -Scan -ScanType 3 -File <path>`. Exit code 0 means clean and 2 means a threat was found (Defender quarantines it as usual). This works on demand even when another antivirus such as Malwarebytes is the main one and Defender runs in passive mode. |
| **VirusTotal** (optional free API key) | Only the **SHA-256 fingerprint** of each program, DLL or script, and of the download archive, is looked up (`GET /api/v3/files/<sha256>`). **Files are never uploaded**, because uploads become available to VirusTotal's paying customers. "Open on VirusTotal" opens the fingerprint's page, so you can upload by hand if you choose. Free keys allow 4 lookups per minute, and Mod Hub paces itself to that. |
| **Malwarebytes** | It has no command-line scanner, so Mod Hub can't ask it to scan one mod. Its real-time protection checks files as they're written. |
| **Flagging** | Cards show how many programs, DLLs or scripts a mod contains and the last check's result. Results are kept per mod in `%APPDATA%\mod-hub\security.json` and checked again when those files change. |

File types counted as executable content: `.exe .dll .asi .scr .com .bat .cmd .ps1 .vbs .vbe .js .jse .wsf .hta .msi .jar .lnk .sys`.

## Writing game files

- Mod Hub only changes the game's own mod list: RimWorld `ModsConfig.xml`, Project Zomboid `mods\default.txt` and save `mods.txt` files, and Isaac `disable.it`. It refuses while the game is running and backs up every file it changes to `%APPDATA%\mod-hub\backups\`.
- Lists owned by another tool are read-only: Mod Organizer 2 profiles, and BG3's `modsettings.lsx` (Vortex).
- Nothing is extracted by home-made archive code. Archives are listed with 7-Zip.

## Steam

- Workshop ratings are read through the Steam client as **Spacewar (app 480)**, Valve's free test app, so no real game shows as played and no anti-cheat game is involved.
- Searching for re-uploads of removed Workshop mods has to run as that mod's game. It never does this in the background for anti-cheat games (CS2, TF2, Dota 2, Garry's Mod, Rust and others). VAC only runs inside a game's own process, but there's no reason to involve those games.
- Subscribe and unsubscribe use the game's own app ID, and only when you click them.

## Keys, logins and personal data

- The Nexus and VirusTotal API keys live in `%APPDATA%\mod-hub\settings.json`. The Nexus site login (embedded browser) lives in Mod Hub's Electron profile in `%APPDATA%`. **None of these are ever in this repository** (see `.gitignore`).
- Nothing about your mods or library is sent anywhere except the lookups described above: Steam Workshop details, the Nexus API with your key, and VirusTotal fingerprints with your key.

## Reporting a problem

Please open a GitHub issue, or a private security advisory for anything sensitive, at https://github.com/Strikeborn/mod-hub/security.
