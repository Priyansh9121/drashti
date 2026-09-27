# Drashti audit kit

Two read-only scripts that record how each ProPresenter machine is set up today, plus a checklist for the things a script cannot see. The results decide what Drashti must do before it can replace ProPresenter on that machine.

| Machine | Script | Needs |
| --- | --- | --- |
| ProPresenter 6 Mac | `audit-mac.sh` | The built-in Terminal. No installs, no administrator password. |
| ProPresenter 7 Windows PC | `audit-windows.ps1` | The built-in Windows PowerShell. No installs, no administrator rights. |
| Both | `SETUP-CHECKLIST.md` | A printout and a pen, filled in by the operators. |

## What the scripts do

They **only read**. They never change a setting, never edit, move or delete a file, and ProPresenter can stay open while they run. Each run creates one new folder named after the machine, for example `MANDIR-PC_20261004-101500`, containing:

- `audit-report.md`: the readable report.
- `audit.json`: the same data for the Drashti importers.

They record:

- the OS version, CPU, GPU and RAM, and whether Drashti's current Electron version can run on this machine;
- every connected display with its resolution and refresh rate (and, on Windows, the connection type such as HDMI, DisplayPort or SDI);
- audio devices; capture, SDI (Blackmagic, AJA), MIDI and Stream Deck devices; related software;
- the ProPresenter version and where its library, playlists, themes, configuration and media live (ProPresenter's own preferences are read first, then Documents and Application Support or AppData are searched);
- file counts and sizes;
- every font used in slide text, and whether each looks like a legacy (non-Unicode) Gujarati or Hindi font;
- every media file the library points to, and which are missing;
- fonts installed beyond the OS defaults.

Licence and registration keys, stream keys, passwords and e-mail addresses are redacted from both report files.

## Run it on the ProPresenter 6 Mac

1. Copy this `audit` folder to a USB drive (or to the Desktop).
2. Open **Terminal** (Applications, then Utilities, then Terminal).
3. Type `cd ` (with a space after it), drag the `audit` folder into the Terminal window, and press Return.
4. Paste this and press Return:

   ```bash
   bash audit-mac.sh
   ```

5. If macOS asks whether Terminal may access your Documents folder, Desktop or a removable volume, click **OK**. The script only reads.
6. It takes from ten seconds to a few minutes. The report folder appears next to the script.

To also copy ProPresenter's data and extra fonts to the USB drive, use this instead. Replace `USBNAME` with the drive's name as it appears on the Desktop:

```bash
bash audit-mac.sh --collect /Volumes/USBNAME
```

Add `--no-media` to leave out videos, images and audio if the drive is small:

```bash
bash audit-mac.sh --collect /Volumes/USBNAME --no-media
```

## Run it on the ProPresenter 7 Windows PC

1. Copy this `audit` folder to a USB drive (or to the Desktop).
2. Open the Start menu, type **PowerShell** and open **Windows PowerShell**. Do not choose "Run as administrator".
3. Go to the folder. For a USB drive that shows up as `E:`, paste:

   ```powershell
   cd E:\audit
   ```

   Tip: Shift and right-click the `audit` folder, choose **Copy as path**, then type `cd ` and paste.
4. Paste this and press Enter:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\audit-windows.ps1
   ```

   `-ExecutionPolicy Bypass` applies to this one run only and changes no setting on the PC.
5. It takes from a few seconds to a few minutes. The report folder appears next to the script.

To also copy ProPresenter's data, its registry settings and extra fonts to the USB drive `E:`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\audit-windows.ps1 -Collect E:\
```

Add `-NoMedia` to leave out videos, images and audio:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\audit-windows.ps1 -Collect E:\ -NoMedia
```

## The collect option

`--collect` (Mac) and `-Collect` (Windows) **copy, never move**, the ProPresenter data folders and the non-default font files to the destination. On Windows they also export ProPresenter's registry settings. The script checks the free space first and stops if the drive is too small. The copies go into a folder named `<machine>_<date>-collect`, with a `READ-ME-FIRST.txt` inside.

> **Treat the USB drive as sensitive.** The report files redact secrets, but the collected copies are raw. They can still contain licence or registration details, stream keys, passwords and personal data stored inside ProPresenter's settings and documents. Keep the drive with you, don't upload the copies to cloud storage, and wipe the drive when the import work is finished.

On the Drashti development Mac, put collected folders and reports in `migration-samples/` at the workspace root. That folder is outside the `app/` git repository, and nothing from it is ever committed.

## What to send back

1. The report folder from each machine (`audit-report.md` and `audit.json`).
2. The filled-in `SETUP-CHECKLIST.md`, or a photo of each page.
3. The collect folder, if you made one, handed over on the USB drive (not by e-mail or chat).

## Troubleshooting

| Message | What to do |
| --- | --- |
| Mac: "Operation not permitted" when reading a folder | Click OK when macOS asks for access. If you clicked "Don't Allow", open System Settings, then Privacy & Security, then Files and Folders, and turn on Terminal's access. |
| Windows: "running scripts is disabled on this system" | Use the full command above, starting with `powershell -NoProfile -ExecutionPolicy Bypass`. |
| "Cannot create ... Use --out / -OutDir" | The script's folder is read-only. Add `--out ~/Desktop` (Mac) or `-OutDir $HOME\Desktop` (Windows). |
| "Not enough free space" during collect | Use a bigger drive or add `--no-media` / `-NoMedia`. |
| The report says "Could not compile the built-in helper" (Windows) | The audit still finishes, with fewer display details and approximate font counts. Send it anyway. |

## Options

| Mac | Windows | Meaning |
| --- | --- | --- |
| `--out DIR` | `-OutDir DIR` | Put the report folder in DIR instead of next to the script. |
| `--collect DEST` | `-Collect DEST` | Also copy ProPresenter data and non-default fonts to DEST. |
| `--no-media` | `-NoMedia` | With collect: leave out videos, images and audio. |
| `--search-root DIR` | `-SearchRoot DIR` | Also look for ProPresenter folders and files under DIR, for example an external drive. |
| `--no-spotlight` | | Don't use Spotlight to find ProPresenter files. |
| `--skip-system` | `-SkipSystem` | Skip the hardware, display, audio and device sections (for testing). |
| | `-NoDefaultLocations` | Only search `-SearchRoot` (for testing). |

## For developers

The scripts share one JSON schema (`"schema": "drashti-audit/1"`). Both scripts fill the same fields, such as `propresenter.fontsUsedInSlideText`, `propresenter.mediaReferences`, `propresenter.locations` and `activeScreens`. Windows adds display connection types and signal sizes.

How the scripts read ProPresenter files:

- **ProPresenter 4, 5 and 6** documents, playlists and templates are XML. Slide text is base64 RTF in `RTFData` (Mac) and XAML in `WinFlowData` (PP6 for Windows). Media and document paths are in `source` and `filePath` attributes.
- **ProPresenter 7** files (`.pro`, and the extension-less files under `Themes`, `Playlists` and `Configuration`) are protobuf. The scripts don't need the schema. They find each RTF blob and each `file://` URL or drive-letter path, and they read the protobuf length prefix in front of a string so the path is exact.
- **RTF** is read with a small parser. It takes the font table and counts, per font, Latin letters and Unicode Gujarati (U+0A80 to U+0AFF) and Devanagari (U+0900 to U+097F) characters. A Gujarati font whose text is all Latin letters is almost certainly a legacy non-Unicode font.
- **Bundles** (`.pro6x`, `.pro6plx`, `.probundle`, `.proplaylist`) are zip files. The scripts read the documents inside without extracting them to disk.

Tests (fixtures are synthetic placeholder data built by `test/make-fixtures.mjs`):

```bash
node tools/audit/test/run-tests.mjs          # fixture tests for whatever this OS can run
node tools/audit/test/run-tests.mjs --full   # also a real, unrestricted run on this machine
DRASHTI_PWSH=/path/to/pwsh node tools/audit/test/run-tests.mjs   # pick a PowerShell
pwsh -NoProfile -File tools/audit/test/check-windows-script.ps1  # parse, C# 5 and PS 5.1 compatibility
```

The fixture tests check that planted fonts, media and secrets are found or redacted, and that the fixture tree is byte-for-byte unchanged afterwards. CI runs them on `macos-latest` and on `windows-latest` with both Windows PowerShell 5.1 and PowerShell 7.
