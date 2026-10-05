# PaperNest

<img src="branding/icon-master.png" width="112" alt="PaperNest icon">

A lightweight desktop app for local documents. Open Markdown to read or edit it, and quickly inspect code, configuration, logs, and images.

[简体中文](README.md) · [English](README.en.md)

> This is a personal continuation of [MDmeow](https://github.com/zakee039/MDmeow). Windows portable and installer downloads are available in [Releases](https://github.com/baihejiangnan/PaperNest/releases/latest). Upstream installers do not include this repository's additions.

## What it does

| Task | Current capability |
| --- | --- |
| Read and edit Markdown | Milkdown/Crepe WYSIWYG view and a source view with line numbers and syntax highlighting. Headings, lists, tasks, tables, links, footnotes, and math are supported. |
| Inspect other files | JSON, YAML, TOML, source code, logs, and plain text open in Code mode with find, replace, and light editing. Images open in their own tabs. |
| Navigate local documents | Multiple tabs, a file tree, heading outline, folder search, back/forward navigation, drag and drop, and session restore. |
| Work with files | Save, Save As, rename, create, duplicate, and delete. File tree actions can reveal files and folders in the system file manager. |
| Export and customize | Export HTML or print to PDF; adjust fonts, accent color, light/dark/system theme, shortcuts, and window behavior. |

The file tree loads directories on demand. While visible, it periodically refreshes the root and expanded folders, refreshes when the app regains focus, and rereads collapsed folders when reopened. Dot-prefixed entries and symbolic links remain hidden. Relative images and local links in Markdown resolve from the current document. Images can be enlarged, aligned, and resized. Binary files are not opened as text. Unsupported file formats or text encodings show an amber capsule centered near the top of the window. It disappears after four seconds, can be dismissed manually, and lets you keep reading.

On Windows, “Open in File Explorer” opens the selected folder, or opens a file's parent folder with that file selected. Using the menu in the tree's blank area opens its current root folder.

Ordinary file-tree clicks reuse a preview tab. Choose “Open in new tab” from a file's context menu to keep a separate tab: it appears immediately and shows “Opening file…” while reading. You can switch or close it during loading; completion keeps your current selection and never reopens a closed tab. Replacing an edited preview requires confirmation.

Opening a file in a new window uses a single-document window in the same app process. Multiple windows and Explorer location actions passed Windows development-build checks; see [development notes](docs/development.md). Remaining Windows release-candidate checks are in [TODO](TODO.md). Linux and macOS releases and on-device checks are deferred.

## Get started

Windows x64 users can download the portable EXE or MSI installer from the [latest release](https://github.com/baihejiangnan/PaperNest/releases/latest). WebView2 Runtime is required.

To build from source, you need Node.js 20+, pnpm, and stable Rust (1.85 or newer). Windows also needs Visual C++ Build Tools, Windows SDK, and WebView2.

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

Check the frontend build with `pnpm build`. Package locally with `pnpm tauri build`, or run `pnpm release:windows` for the Windows x64 portable EXE, MSI, updater signatures, `latest.json` and `SHA256SUMS.txt`. The release workflow builds Windows artifacts for a `vX.Y.Z` tag and requires `TAURI_SIGNING_PRIVATE_KEY`; Linux/macOS releases are deferred. Updater signatures are verified by the app; Windows Authenticode certificate signing is not configured. Automatic update checks are off by default and can be enabled in settings to receive this project's signed releases.

## Common shortcuts

| Action | Default |
| --- | --- |
| New tab | `Ctrl/Cmd+N` |
| Open file | `Ctrl/Cmd+O` |
| Save / Save As | `Ctrl/Cmd+S` / `Ctrl/Cmd+Shift+S` |
| Close tab | `Ctrl/Cmd+W` |
| Export HTML / PDF | `Ctrl/Cmd+E` |
| Markdown render / source | `Ctrl/Cmd+/` |
| Find / Replace | `Ctrl/Cmd+F` / `Ctrl/Cmd+H` |
| Settings | `Ctrl/Cmd+,` |

App shortcuts can be rebound in Settings. The file tree menu offers create, copy path, rename, and delete actions. **Deletion moves files and folders to the system recycle bin** and asks for confirmation by default. Recycling errors never fall back to permanent deletion.

## Files and data

PaperNest reads and writes ordinary local files without importing them into a proprietary project. Markdown remains plain text. Standard image links and common HTML `<img>` tags can both render:

```md
![Diagram](./assets/diagram.png)

<img src="./assets/diagram.png" alt="Diagram" style="zoom:50%;" data-align="center">
```

Preferences and session state are stored in `settings.toml` and saved as settings change. Portable data can live in a `data/` folder next to the executable; installed builds use the system user-data directory. The app does not sync documents to a cloud service, so back up your files and settings separately when moving computers.

## Project map

| Path | Purpose |
| --- | --- |
| `src/` | Frontend, Markdown and Code modes, tabs, and file tree. |
| `src-tauri/` | Rust file operations, windows, settings, platform integration, and packaging. |
| `docs/development.md` | Local commands and manual regression steps. |
| `ARCHITECTURE.md` | Frontend/backend boundaries and data flow. |
| `docs/design.md` | Interface design constraints. |
| `TODO.md` | Items awaiting verification. |

The stack includes Tauri v2, Rust, TypeScript, Milkdown/Crepe, CodeMirror, and KaTeX. The project is distributed under the [MIT License](LICENSE.md).

## Upstream acknowledgments

Thanks to [zakee039's MDmeow](https://github.com/zakee039/MDmeow), the direct foundation for this project, and to the earlier [Ali Naderi / Mowl](https://github.com/naderi/mowl). PaperNest builds on their work with local file reading, a file tree, image previews, and interface changes. The original copyright and MIT license notice remain in [LICENSE.md](LICENSE.md).

The default theme uses Obsidian-style neutral surfaces and a purple accent. Confirmations and messages are in-app dialogs. Delete confirmation shows file counts and saved Markdown references; “Do not ask again” can be reset in General settings. Deleted files and folders can be restored from the system recycle bin. See the [global UI specification](docs/design.md).
