<div align="center">

<img src="branding/icon-master.png" width="96" alt="PaperNest icon">

# PaperNest

A lightweight desktop app for reading and editing local documents.<br>
Open Markdown to read or edit it, and quickly inspect code, configuration, logs, and images.

[![Latest release](https://img.shields.io/github/v/release/baihejiangnan/PaperNest?label=release)](https://github.com/baihejiangnan/PaperNest/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-8a5cf5)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-555)](https://github.com/baihejiangnan/PaperNest/releases/latest)

[Download](https://github.com/baihejiangnan/PaperNest/releases/latest) · [Website](https://baihejiangnan.github.io/PaperNest/) · [简体中文](README.md)

</div>

---

## Contents

- [Highlights](#highlights)
- [Download and install](#download-and-install)
- [Getting started](#getting-started)
- [Shortcuts](#shortcuts)
- [Files and data](#files-and-data)
- [Build from source](#build-from-source)
- [Project map and docs](#project-map-and-docs)
- [Acknowledgments and license](#acknowledgments-and-license)

## Highlights

| | |
| --- | --- |
| **WYSIWYG Markdown** | Milkdown/Crepe renders headings, lists, tasks, tables, links, footnotes, and math. Switch to a source view with line numbers and syntax highlighting in one keystroke. |
| **More than Markdown** | JSON, YAML, TOML, source code, logs, and plain text open in Code mode with find, replace, and light editing. Images open in their own tabs. |
| **File tree and tabs** | Directories load on demand and focus on Markdown by default. Tabs can be stacked, favorited, and restored, alongside an outline, folder search, back/forward, and session restore. |
| **Safe file operations** | Create, rename, duplicate, and delete inside the app. Delete shows where a file is referenced and moves it to the system recycle bin. |
| **HTML and PDF export** | Export standalone HTML or print to PDF. Scripts and other executable content are removed on export. |
| **Make it yours** | Light, dark, or system theme; custom accent color, fonts, and size; rebindable shortcuts and searchable settings. |

## Download and install

The current release targets **Windows x64**. Download it from [Releases](https://github.com/baihejiangnan/PaperNest/releases/latest):

| Package | File | Best for |
| --- | --- | --- |
| Portable | `PaperNest-X.Y.Z.exe` | No installation. Run from any folder or USB drive; data can live in a `data/` folder next to the executable. |
| Installer | `PaperNest_X.Y.Z_x64.msi` | System install with file associations and the Explorer “New → MD File” entry. |

- **WebView2 Runtime** is required (usually preinstalled on Windows 10/11).
- Each release includes `.sig` updater signatures and `SHA256SUMS.txt` for verification. Windows Authenticode certificate signing is not configured, so Windows may warn about an unknown publisher on first run.
- Automatic update checks are off by default. When enabled, the app only accepts this project's signed releases and asks before downloading or installing.
- Linux and macOS releases are not available yet.

> PaperNest is developed on top of [MDmeow](https://github.com/zakee039/MDmeow). Upstream installers do not include this repository's additions.

## Getting started

1. **Open a file** with `Ctrl+O`, by dragging it onto the window, or from the file tree.
2. **Switch views** with `Ctrl+/` between rendered Markdown and source.
3. **Browse folders**: ↑ goes to the parent folder, ◎ returns to the current document's folder, and “Show as root folder” in a folder's context menu enters any subfolder.
4. **Keep tabs**: a normal click reuses a preview tab. Use “Open in new tab” to keep a separate tab, or “Open in new window” for a single-document window.
5. **Adjust the look** with `Ctrl+,` for theme, accent color, fonts, and shortcuts.

<details>
<summary><b>File tree</b></summary>

- By default only Markdown documents (`.md`, `.markdown`, `.mdx`, case-insensitive) and their parent folders are shown. The MD icon below search turns the filter off; General settings has the same switch.
- Folders load on demand. While visible, the tree syncs the root and expanded folders and refreshes when the window regains focus. Dot-prefixed entries and symbolic links stay hidden.
- After going up, the path bar keeps the deeper folders you came from (dimmed) so one click returns there. Path segments support Tab/Shift+Tab and Enter/Space.
- Drag the sidebar divider to resize it and double-click to reset. When focused, use the arrow keys (Shift for larger steps) and Home/End.
- On Windows, “Open in File Explorer” opens the selected folder, or a file's parent folder with the file selected.

</details>

<details>
<summary><b>Tabs and windows</b></summary>

- The plus button opens a new tab where you can create or open a file. The arrow menu switches, stacks, favorites, and closes tabs.
- Favorites save the list of tabs that have file paths and can be restored from the arrow menu. Unsaved new files are not included.
- “Open in new tab” shows the tab immediately with “Opening file…” while reading. You can switch or close it during loading.
- Replacing an edited preview tab asks for confirmation first.
- “Open in new window” creates a single-document window in the same app process, without the file tree, outline, or tab bar.

</details>

<details>
<summary><b>Editing and context menus</b></summary>

- The editor context menu adds or edits links, finds text, formats text, converts headings and lists, and inserts tables, images, rules, code blocks, and math blocks. Shift+F10 opens it from the keyboard.
- “Add link / Edit link” opens a small popover near the selection. Type a URL or local path, or search sibling files of the current document to insert a relative link.
- Click an image to enlarge it, and adjust its alignment and size. Relative images and local links resolve from the current document's folder.
- Binary files are never opened as text. Unsupported formats or encodings show a short notice at the top of the window that disappears after four seconds.

</details>

<details>
<summary><b>Settings</b></summary>

- Settings use category navigation on the left. “Search settings” finds names, config keys, and file extensions across categories.
- “Editor → Font → Preview current document” fades the settings overlay so you can see the document behind it. Press Esc to return.
- Delete confirmation shows file counts and referencing documents. “Do not ask again” can be reset in General settings.
- On Windows, “File associations → Windows Explorer” offers a “Show MD File in Explorer's New menu” switch (off by default). It works even when the app is closed and never replaces your default app. Turn it off before deleting a portable copy.

</details>

## Shortcuts

| Action | Default |
| --- | --- |
| New tab | `Ctrl+N` |
| Open file | `Ctrl+O` |
| Save / Save As | `Ctrl+S` / `Ctrl+Shift+S` |
| Close tab | `Ctrl+W` |
| Export HTML / PDF | `Ctrl+E` |
| Rendered / source view | `Ctrl+/` |
| Find / Replace | `Ctrl+F` / `Ctrl+H` |
| Settings | `Ctrl+,` |

macOS uses `Cmd` instead of `Ctrl`. App shortcuts can be rebound in Settings.

## Files and data

**Plain files, read and written as-is.** PaperNest works with ordinary local files and never imports them into a proprietary library. Markdown stays plain text, and both standard image links and common HTML `<img>` tags render:

```md
![Diagram](./assets/diagram.png)

<img src="./assets/diagram.png" alt="Diagram" style="zoom:50%;" data-align="center">
```

**Settings stay local.** Preferences and session state are saved to `settings.toml` as they change. Portable builds can use a `data/` folder next to the executable; installed builds use the system user-data directory. If a hand edit makes the file unreadable, the app reports it at startup, keeps the original as `settings.invalid-<time>.toml`, and runs with defaults.

**Deletes can be undone.** Files and folders go to the system recycle bin. If recycling fails, the app reports the error and never falls back to permanent deletion.

**No upload, no sync.** Documents are never synced to a cloud service, so back up your files and settings yourself when moving computers.

## Build from source

You need Node.js 20+, pnpm, and stable Rust (1.85 or newer). Windows also needs Visual C++ Build Tools, Windows SDK, and WebView2.

```bash
pnpm install --frozen-lockfile
pnpm tauri dev        # run the development build
pnpm build            # type-check and build the frontend
pnpm tauri build      # package locally
```

`pnpm release:windows` produces the Windows x64 portable EXE, MSI, updater signatures, `latest.json`, and `SHA256SUMS.txt`. See [development notes](docs/development.md) for debugging and regression checks, and [release rules](docs/release-rules.md) for the publishing process.

## Project map and docs

| Path | Contents |
| --- | --- |
| `src/` | Frontend, Markdown and Code modes, tabs, and file tree |
| `src-tauri/` | Rust file operations, windows, settings, platform integration, and packaging |
| `docs/index.html` | [Project website](https://baihejiangnan.github.io/PaperNest/) (GitHub Pages) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Frontend/backend boundaries, state ownership, and data flow |
| [docs/design.md](docs/design.md) | Global UI specification and colors |
| [docs/development.md](docs/development.md) | Local commands, debugging, and regression records |
| [docs/release-rules.md](docs/release-rules.md) | Push and release rules |
| [TODO.md](TODO.md) | Items awaiting verification |

Stack: Tauri v2 · Rust · TypeScript · Milkdown/Crepe · CodeMirror · KaTeX

> Multiple windows and Explorer location actions passed Windows development-build checks. Remaining Windows release-candidate checks are in [TODO](TODO.md). Linux and macOS releases and on-device checks are deferred.

## Acknowledgments and license

Thanks to [zakee039's MDmeow](https://github.com/zakee039/MDmeow), the direct foundation for this project, and to the earlier [Ali Naderi / Mowl](https://github.com/naderi/mowl). PaperNest builds on their work with local file reading, a file tree, image previews, and interface changes.

PaperNest is distributed under the [MIT License](LICENSE.md), which keeps the original copyright and license notice.
