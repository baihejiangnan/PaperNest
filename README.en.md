# PaperNest

<img src="branding/icon-master.png" width="112" alt="PaperNest icon">

A lightweight desktop app for local documents. Open Markdown to read or edit it, and quickly inspect code, configuration, logs, and images.

[简体中文](README.md) · [English](README.en.md)

> This is a personal continuation of [MDmeow](https://github.com/zakee039/MDmeow). This repository currently hosts source code and work in progress; installers under the new name have not been released yet. Upstream installers do not include this repository's additions.

## What it does

| Task | Current capability |
| --- | --- |
| Read and edit Markdown | Milkdown/Crepe WYSIWYG view and a source view with line numbers and syntax highlighting. Headings, lists, tasks, tables, links, footnotes, and math are supported. |
| Inspect other files | JSON, YAML, TOML, source code, logs, and plain text open in Code mode with find, replace, and light editing. Images open in their own tabs. |
| Navigate local documents | Multiple tabs, a file tree, heading outline, folder search, back/forward navigation, drag and drop, and session restore. |
| Work with files | Save, Save As, rename, create, duplicate, and delete. File tree actions can reveal files and folders in the system file manager. |
| Export and customize | Export HTML or print to PDF; adjust fonts, accent color, shortcuts, and window behavior. |

The file tree loads directories on demand. Relative images and local links in Markdown resolve from the current document. Images can be enlarged, aligned, and resized. Binary files are not opened as text.

Opening a file in a new window now uses a single-document window in the same app process. This and some file tree actions still need manual checks in the [regression checklist](TODO.md). New cross-platform behavior has mainly been developed on Windows; Linux and macOS need on-device verification.

## Get started

Build from source for now. You need Node.js 20+, pnpm, and stable Rust. Windows also needs Visual C++ Build Tools, Windows SDK, and WebView2.

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

Check the frontend build with `pnpm build`. You can package locally with `pnpm tauri build`. The release workflow builds Windows, Linux, and macOS artifacts for a `vX.Y.Z` tag, but signed releases also require `TAURI_SIGNING_PRIVATE_KEY` in this new repository. Until this project's own artifacts appear on its Releases page, do not treat upstream downloads as this version. Automatic update checks are off by default until signed releases are available.

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

App shortcuts can be rebound in Settings. The file tree menu offers create, copy path, rename, and delete actions. **Deletion is currently permanent** and asks for confirmation first.

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
