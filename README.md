# Drashti

Drashti (v1.0, package `drashti`) is the presentation app for BAPS mandirs. It replaces ProPresenter 6 on the mandir's Mac and ProPresenter 7 on its Windows PC, on the same machines and the same screens. The plan is in `PLAN.md` at the workspace root.

## What is here so far

| Folder | What it is |
| --- | --- |
| `tools/audit/` | The read-only audit kit for the two ProPresenter machines, plus the operators' setup checklist. See `tools/audit/README.md`. |

## Open risk: minimum OS versions

Drashti currently targets **Electron 44** (the current stable release). Electron 44 runs on:

- **macOS 13 Ventura or later**, Intel or Apple silicon;
- **Windows 10 or later, 64-bit** (x64 or arm64). Electron 44 dropped 32-bit Windows.

The OS versions of the PP6 Mac and the PP7 PC are unknown until the audit runs. Each audit report says whether its machine can run Electron 44. If the Mac is older, the options are an older Electron line or a macOS upgrade:

| Electron | Oldest macOS it supports |
| --- | --- |
| 43 | macOS 12 Monterey |
| 37 | macOS 11 Big Sur |
| 32 | macOS 10.15 Catalina |

Electron only supports its latest three major versions with security fixes, so going back further than 42 means running an unsupported Electron.
