<div align="center">

<img src="branding/icon-master.png" width="96" alt="PaperNest icon">

# PaperNest

A lightweight desktop app for reading and editing local documents.<br>
Open Markdown to read or edit it, and quickly inspect code, configuration, logs, and images.

[![Latest release](https://img.shields.io/github/v/release/baihejiangnan/PaperNest?label=release)](https://github.com/baihejiangnan/PaperNest/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-8a5cf5)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20Linux%20x64-555)](https://github.com/baihejiangnan/PaperNest/releases/latest)

[Windows / Linux downloads](https://github.com/baihejiangnan/PaperNest/releases/latest) · [macOS preview](https://github.com/baihejiangnan/PaperNest/releases/tag/macos-v0.2.5-preview.1) · [Website](https://baihejiangnan.github.io/PaperNest/) · [简体中文](README.md)

</div>

![PaperNest in light mode, with an expanded file tree and a Markdown document containing tasks, a table, code, and math](docs/assets/screenshots/main-light.png)

*Actual PaperNest v0.2.5 screenshots on Windows, using demo documents and a Chinese interface. More views appear below.*

---

## Contents

- [Highlights](#highlights)
- [Screenshots](#screenshots)
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

## Screenshots

The light-mode workspace is shown above. All screenshots below use v0.2.5 and the same set of demo files.

<details>
<summary><b>See more screenshots</b></summary>

### Dark mode

The same Markdown document and file tree, with the dark theme enabled.

![PaperNest workspace in dark mode](docs/assets/screenshots/main-dark.png)

### Markdown source

Press `Ctrl+/` to see line numbers, Markdown markup, and syntax highlighting.

![PaperNest Markdown source view](docs/assets/screenshots/markdown-source.png)

### Code mode

JSON configuration files open directly in Code mode without conversion to Markdown.

![PaperNest displaying a JSON configuration file in Code mode](docs/assets/screenshots/code-json.png)

### Editor settings

Adjust reading fonts, text size, and editing preferences, or preview the current document.

![PaperNest settings panel showing the editor category](docs/assets/screenshots/settings-editor.png)

### Tab menu

Right-click a tab to close groups of tabs, lock it against preview replacement, or move it to a separate window.

![PaperNest tab menu with close, lock, and move-to-window actions](docs/assets/screenshots/tabs-menu.png)

</details>

## Download and install

The current stable release is **v0.2.5**. Windows and Linux packages are in [stable Releases](https://github.com/baihejiangnan/PaperNest/releases/latest); macOS has a separate [unnotarized preview](https://github.com/baihejiangnan/PaperNest/releases/tag/macos-v0.2.5-preview.1).

| Platform | Packages | Choose a package |
| --- | --- | --- |
| Windows x64 | [Portable EXE](https://github.com/baihejiangnan/PaperNest/releases/download/v0.2.5/PaperNest-0.2.5.exe) / [MSI installer](https://github.com/baihejiangnan/PaperNest/releases/download/v0.2.5/PaperNest_0.2.5_x64.msi) | Run the EXE directly, or install the MSI and configure file associations. |
| Linux x86_64 | [AppImage](https://github.com/baihejiangnan/PaperNest/releases/download/v0.2.5/PaperNest-0.2.5-linux-x86_64.AppImage) / [deb](https://github.com/baihejiangnan/PaperNest/releases/download/v0.2.5/PaperNest-0.2.5-linux-x86_64.deb) / [rpm](https://github.com/baihejiangnan/PaperNest/releases/download/v0.2.5/PaperNest-0.2.5-linux-x86_64.rpm) | Choose for your distribution; see the release notes for compatibility. |
| macOS Intel / Apple Silicon | [Universal DMG preview](https://github.com/baihejiangnan/PaperNest/releases/tag/macos-v0.2.5-preview.1) | One package for both architectures; ad-hoc signed and **not notarized by Apple**. |

- Windows requires **WebView2 Runtime**. Windows Authenticode certificate signing is not configured, so Windows may report an unknown publisher on first run.
- All platforms include SHA-256 manifests. Windows EXE and MSI packages also include updater signatures; these are separate from an OS-trusted publisher certificate.
- On Windows, use Settings → Updates to check, download, and install without a GitHub login or token. Automatic checks are off by default; downloading and installing require confirmation. The app saves the reading session before updating and restores it afterward.
- Linux and macOS do not support in-app update installation; download new releases manually. Both passed native builds and tests. Linux also passed a window startup check; macOS passed architecture and signature checks inside the final DMG. Full on-device feature checks remain pending. See [development records](docs/development.md) and [TODO](TODO.md) for the verification scope.

> PaperNest builds on [MDmeow](https://github.com/zakee039/MDmeow). Download this repository's packages to use the features described here.

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

- The plus button opens a new tab for creating or opening a file. Tabs shrink when space is limited. The arrow beside the window controls switches, stacks, favorites, and closes tabs.
- Right-click a tab to close it, other tabs, tabs to its right, or all tabs; lock/unlock it; or move it to a new window. Right-click keeps the current document active. Locks prevent preview replacement for the current run and still allow explicit closure. Moving saves first and retains the source if saving is cancelled or window creation fails.
- Startup session restore is on by default. Launching without a file restores documents, the active tab, reading position, source view, and workspace root. Turn it off to start with a new tab; launching with a file opens that file. Windows installed and portable copies share the latest session and this preference for the same user. A failed file-open request keeps the previous session until another file opens or Save As succeeds.
- Favorites save the list of tabs that have file paths and can be restored from the arrow menu. Unsaved new files are not included.
- “Open in new tab” shows the tab immediately with “Opening file…” while reading. You can switch or close it during loading.
- Closing a tab, replacing a preview tab, quitting, or installing an update with unsaved edits offers Save, Don't save, or Cancel (Save all for several documents). If saving fails or Save As is cancelled, nothing is closed.
- “Open in new window” creates a single-document window in the same app process, without the file tree, outline, or tab bar.

</details>

<details>
<summary><b>Editing and context menus</b></summary>

- The editor context menu adds or edits links, finds text, formats text, converts headings and lists, and inserts tables, images, rules, code blocks, and math blocks. Shift+F10 opens it from the keyboard.
- “Add link / Edit link” opens a small popover near the selection. Type a URL or local path, or search sibling files of the current document to insert a relative link.
- Click an image to enlarge it, and adjust its alignment and size. Relative images and local links resolve from the current document's folder.
- Binary files are never opened as text. Unsupported formats or encodings show a short notice at the top of the window that disappears after four seconds.
- “Editor → Auto-save edited files” is off by default. When on, documents that already have a file are saved about 1.5 s after you stop typing, when you switch tabs, when the window loses focus, and on close. Untitled documents still ask. Opening a file never writes it.
- Saved Markdown uses `-` for bullet lists by default; switch to `*` or `+` under Editor (a choice already stored in `settings.toml` is kept). Underscores inside words, such as `CODE_MODE_PLAN`, are no longer backslash-escaped.

</details>

<details>
<summary><b>Settings</b></summary>

- Settings use category navigation on the left. “Search settings” finds names, config keys, and file extensions across categories.
- “Editor → Font → Preview current document” fades the settings overlay so you can see the document behind it. Press Esc to return.
- Delete confirmation shows file counts and referencing documents. “Do not ask again” can be reset in General settings.
- On Windows, “General → Windows Explorer” offers a “Show MD File in the Windows New menu” switch (off by default). It works even when the app is closed and never replaces your default app. Turn it off before deleting a portable copy.

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

**Settings stay local.** Preferences and session state are saved to `settings.toml` as they change. Windows portable builds keep `settings.toml` beside the EXE and WebView2 data and update caches in `data/`; an unwritable folder falls back to the user config directory. Installed builds use the system user config directory. Windows copies share session restore through `PaperNest/reading-session.toml` in the user config directory; other preferences stay separate. If a hand edit makes the file unreadable, the app reports it at startup, keeps the original as `settings.invalid-<time>.toml`, and runs with defaults.

**Deletes can be undone.** Files and folders go to the system recycle bin. If recycling fails, the app reports the error and never falls back to permanent deletion.

**No upload, no sync.** Documents are never synced to a cloud service, so back up your files and settings yourself when moving computers.

**Adjust your preferences.** Settings are grouped by category and saved immediately. Rich-text, source, and code-block context menus hide shortcut hints by default; enable them under General → Behavior → Show shortcut hints in content menus.

## Build from source

You need Node.js 20+, pnpm, and stable Rust (1.85 or newer). Windows also needs Visual C++ Build Tools, Windows SDK, and WebView2.

```bash
pnpm install --frozen-lockfile
pnpm tauri dev        # run the development build
pnpm build            # type-check and build the frontend
pnpm tauri build      # package locally
```

`pnpm release:windows` produces the Windows x64 portable EXE, MSI, updater signatures, `latest.json`, and `SHA256SUMS.txt`. See [development notes](docs/development.md) for debugging and regression checks, and [release rules](docs/release-rules.md) for the publishing process.

On the corresponding OS, run `pnpm release:macos` for a Universal DMG or `pnpm release:linux` for native-architecture AppImage, deb, and rpm packages. Outputs go to `release-unix/` with build provenance and SHA-256 manifests. A manual [cross-platform build workflow](.github/workflows/unix-candidates.yml) is also available. See [cross-platform development notes](docs/development.md#macoslinux-候选包准备) for dependencies, signing, and verification.

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

## Acknowledgments and license

Thanks to [zakee039's MDmeow](https://github.com/zakee039/MDmeow), the direct foundation for this project, and to the earlier [Ali Naderi / Mowl](https://github.com/naderi/mowl). PaperNest builds on their work with local file reading, a file tree, image previews, and interface changes.

PaperNest is distributed under the [MIT License](LICENSE.md), which keeps the original copyright and license notice.
