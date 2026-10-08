# PaperNest — Architecture & extension guide

This is the maintainer's map of the running app. Start with [AGENTS.md](AGENTS.md)
for project rules and [docs/development.md](docs/development.md) for commands.

---

## 1. Big picture

PaperNest is a **Tauri v2** desktop app:

```
┌───────────────────────────────────────────────┐
│  Rust  (src-tauri/)                            │
│  • windows, native dialogs, filesystem IPC      │
│  • #[tauri::command] functions                 │
│  • settings.toml  (portable, watched)          │
│  • single-instance + file associations         │
│  • Markdown → HTML export (comrak)             │
│  • GFM table pretty-printer                    │
├───────────────────────────────────────────────┤
│  Frontend  (src/)  — TypeScript + Vite,        │
│  no framework                                  │
│  • Milkdown "Crepe" editor (WYSIWYG)           │
│  • CodeMirror, tabs, file tree, outline        │
│  • image preview, block menu, shared theme       │
└───────────────────────────────────────────────┘
```

The frontend never touches the filesystem directly — it calls Rust commands via
`invoke(...)`. Rust never renders UI — it returns data / emits events.

**Why this stack:** a real inline‑WYSIWYG Markdown editor needs a browser
rich‑text engine (ProseMirror via Milkdown Crepe). Tauri gives that a small,
portable native shell using the OS WebView instead of bundling Chromium.

---

## 2. Repo layout

| Path | What |
|---|---|
| `index.html` | The shared page for the main window and content-only secondary windows. Toolbar, sidebar and overlays live here as static markup. |
| `src/main.ts` | **Orchestrator.** App state, all wiring, every command call. Start here. |
| `src/editor.ts` | Thin wrapper over one Crepe instance (`init` / `setContent` / `getMarkdown` / `setSpellcheck` / `setDocPath` / `runBlockAction` / `insertText` / `retranslate`). Also the image `proxyDomURL` hook — see §4, `.use(emojiInputRule)`, and the translated `Placeholder` feature text. |
| `src/tabs.ts` | `Tab` model + `TabBar` for Markdown, Code and image tabs. |
| `src/code-editor.ts`, `src/file-types.ts` | CodeMirror text editor and extension-to-mode/language classification. Unknown readable text falls back to Plain Text. |
| `src/workspace-sidebar.ts` | Lazy file tree, outline, search and context menus; calls `workspace.rs` for filesystem operations. Root navigation: ↑ (parent), ◎ `revealCurrent` (current document's folder), folder menu “set as root”, and a breadcrumb that keeps the deepest folder of the current branch (`trail`) after going up. The trail is frontend-only and not persisted; switching to another branch replaces it, rename/delete keeps it valid. |
| `src/image-preview.ts`, `src/image-toolbar.ts`, `src/html-markdown.ts`, `src/image-block-markdown.ts` | Read-only image lightbox, image actions and Markdown/HTML image round-tripping. |
| `src/text-context-menu.ts`, `src/text-context-actions.ts` | The themed document context menu, body-mounted submenu panels, keyboard navigation and selection-preserving ProseMirror/CodeMirror actions. |
| `src/link-picker.ts` | Non-modal selection-anchored link input, sibling-file filtering through existing directory IPC and relative link choices. |
| `src/editor-theme.ts` | Installs Crepe's structural frame CSS; `styles.css` owns the single built-in Obsidian document rendering. |
| `src/link-clipboard.ts` | ProseMirror `$prose` plugin: paste a URL over a selection / `Ctrl+K` → link it. |
| `src/block-menu.ts` | The `⠿` block menu (turn‑into, insert table / image / divider / blank line, duplicate, delete). Raw ProseMirror commands. Exports `runBlockAction(crepe, id)` — the turn‑into entries reachable by `Ctrl/Cmd+0`–`7` from `main.ts`, built from the live selection via `targetFromSelection`. |
| `src/emoji.ts` | `:shortcode:` input rule (`$prose`, same class as `find.ts`) + `EmojiPicker` popup (`#emoji-picker`, `Ctrl/Cmd+.`), backend‑agnostic like `find-bar.ts`. |
| `src/emoji-data.ts` | Hand‑curated ~230 common emoji (glyph + shortcode + keywords) and alias map. Native Unicode only, no dependency. |
| `src/i18n.ts` | In-app English, Chinese, Japanese and German strings, language changes and static `data-i18n*` markup. |
| `src/settings-panel.ts` | The settings GUI (`#settings-panel`, `Ctrl/Cmd+,` or the gear button). Full‑screen overlay that flips in over the editor; one control per hand‑editable `settings.toml` key. "Dumb" — reports each change via `onChange`; `main.ts` owns the object, the apply‑functions and the debounced save. |
| `src/markdown-serializer.ts` | `remarkStringifyOptionsCtx` tweaks: bullet‑list marker (`*`/`-`/`+`) and link/image handlers that stop `&` in URLs being escaped. Applied in `Editor.init` via `crepe.editor.config`. |
| `src/find.ts` | `$prose` plugin for WYSIWYG find: scans text nodes for the query, decorates matches, exposes state via `findKey`. |
| `src/find-bar.ts` | Find / replace UI shared by Markdown and Code modes. |
| `src/ui-theme.css` | Global light/dark tokens and HeroUI v3 semantic aliases. |
| `src/modal.ts`, `src/dialogs.ts` | Focus isolation, app confirmation/message dialogs and their queue; no native warning/message dialogs. |
| `src/preview-notice.ts` | Non-blocking amber preview notices for binary/non-UTF-8 files; a single notice with timer, hover/focus pause, dismissal and localized text. |
| `src-tauri/src/delete_info.rs` | Background read-only file/reference analysis for deletion confirmation. |
| `src-tauri/src/recycle.rs` | System recycle-bin operations. Windows uses a fresh COM STA and silent `IFileOperation` with `FOFX_RECYCLEONDELETE`; other desktop platforms use `trash`. Errors propagate to the in-app dialog, with no permanent-delete fallback. `delete_workspace_entry` awaits background completion before closing tabs, refreshing the tree or saving “do not ask again”. |
| `src/styles.css` | App shell, file tree, overlays and Obsidian document rendering. See [design rules](docs/design.md). |
| `src-tauri/src/lib.rs` | Tauri builder: single-instance plugin first, shared state, IPC command registry and settings watcher. `file_arg()` selects an existing file argument. |
| `src-tauri/src/commands.rs` | Settings, document read/write/rename, export and image-loading commands. `get_settings` also returns startup file and version information. |
| `src-tauri/src/workspace.rs` | Directory listing/search, local-link resolution, file actions, Windows Explorer integration and same-process secondary-window creation. |
| `src-tauri/src/settings.rs` | `settings.toml` — **the one settings file**: hand‑editable prefs (language, spellcheck, fonts, accent, color_scheme, confirm_delete, shortcuts, quit_on_escape, list_marker, show_path, open_last_session, always_show_tabbar) + app‑managed state (window, open tabs). Plus the 1 Hz file watcher + write‑signature tracking. |
| `src-tauri/src/portable.rs` | Resolves the portable data dir (next to exe; on macOS next to the `.app`); writability check + OS‑config fallback. |
| `src-tauri/src/new_md.rs`, `src-tauri/build.rs` | Per-user Windows ShellNew registration, ownership journal, rollback and uninstall cleanup; localized menu-name resources embedded in the EXE. |
| `src-tauri/src/export.rs` | `render_html`: Markdown → GFM HTML (comrak), sanitized with ammonia, wrapped in a self‑contained page (a script‑free variant for printing). |
| `src-tauri/src/fs_util.rs` | `write_atomic`: temp file in the target directory → fsync → rename over the target. Used by document saves, settings and update downloads. |
| `src/print-view.ts` | `printHtml`: the sandboxed print frame; renders KaTeX and highlight.js into it from the app. |
| `src-tauri/src/mdfmt.rs` | `format_tables`: pretty‑prints GFM tables in a Markdown string. |
| `src-tauri/assets/export/` | Bundled (offline) KaTeX + highlight.js + Obsidian-style light export CSS/template, `include_str!`‑ed by `export.rs`. |
| `src-tauri/tauri.conf.json`, `src-tauri/tauri.*.conf.json` | Shared and platform-specific window/bundle settings, including drag/drop and decorations. |
| `src-tauri/capabilities/default.json` | Tauri permission allow‑list. **Add a permission here whenever you call a new `window.*` / plugin API.** |
| `.github/workflows/release.yml` | Windows x64 portable EXE/MSI release: updater signing, embedded-key verification, artifact contract and SHA-256 checksums. Linux/macOS releases are deferred in TODO. |
| `scripts/gen-settings-example.mjs` | Writes a commented `settings.example.toml` from Tauri's `beforeBuildCommand` hook. Keep its keys in sync with `Settings`. |

---

## 3. Runtime files

Portable mode keeps settings beside the executable when writable (development:
`src-tauri/target/debug/`). Installed mode uses the user's config directory;
a read-only portable directory falls back there and shows a hint.

- **`settings.toml`** — the only settings file. Top half is hand‑editable
  (language, spellcheck, fonts, sizes, accent, shortcuts, `quit_on_escape`,
  `list_marker`, `show_path`, `open_last_session`); bottom
  half is app‑managed (window geometry, open tabs). The app writes it
  debounced (800 ms) and on quit; a 1 Hz watcher (`settings::watch`) picks up
  **external** edits and emits `settings-changed` → `main.ts` re‑applies
  appearance without a restart. The watcher skips the app's own
  writes by comparing a size+mtime signature (`AppState.last_write`).
  Text editing does **not** trigger a settings write. If the file exists but
  cannot be read or parsed at startup, `Store::load` copies it to
  `settings.invalid-<unix-seconds>.toml` beside it, the app runs on defaults,
  and the frontend shows a one-time warning with the error and backup path
  (`SettingsPayload.load_error`). A broken hand edit while running is logged by
  the watcher and ignored.
- **WebView2 data** (Windows) — `lib.rs` configures the main WebView's data
  directory before startup. Secondary windows use separate `workspace-webviews/`
  directories beside that profile: portable mode stays under the executable's
  `data/` directory, installed mode uses the user's local PaperNest data directory.
  Creating a window does not change process-wide WebView2 environment variables.

---

## 4. Core data flow

### Document / tabs
- Each webview window initializes its own frontend state. The main window keeps
  one Crepe instance, one CodeMirror editor and cheap tab records containing
  path, saved/content text, dirty/scroll state, an optional image URL and a
  start-page flag for blank new tabs and a loading flag for pending file reads.
- The main window's titlebar belongs to `#document-pane`, so its tabs start
  after the file sidebar. `TabBar` renders shrinking tabs while `main.ts`
  manages the fixed new-tab/menu buttons, hover tooltip and menu actions.
  Bookmarked groups contain only file paths and live in WebView localStorage;
  unsaved document content is never placed in a bookmark.
  A ResizeObserver keeps the active tab visible after window/sidebar size changes.
  `src/tab-path.ts` normalizes ordinary and extended Windows/UNC path forms when
  looking up an existing tab, so canonicalized paths reuse the same document.
- Ordinary file-tree clicks call `openPreviewPath()` and reuse one preview tab.
  The tree's "Open in new tab" command calls `openPath(path, true)` and marks
  that tab as pinned. It creates the tab before awaiting the file read and shows
  a loading status with editing/save/export disabled. Completion updates that
  same tab, mounts content only if it is still active, and ignores closed tabs
  and their late read errors. Pending editor callbacks cannot update a loading
  or start-page tab. `read_document` and `read_image_data_url` run file reads and
  image encoding in `tauri::async_runtime::spawn_blocking`, keeping synchronous
  filesystem work off the desktop event loop.
  A dirty preview requires confirmation before replacement;
  cancel keeps its content and path. Preview and pin flags are runtime tab state;
  session restore still stores only paths.
- Switching tabs → `TabBar.onActivate` → save the outgoing tab's text/scroll,
  then swap the visible view among Markdown, Code and image preview.
- `readView()` / `writeView()` abstract the active text editor; image tabs do
  not produce editable text.
  CodeMirror uses normalized line positions for search. Text serialization keeps
  the exact loaded text while unchanged (including after undo), and preserves
  the original newline style after edits through `src/code-text.ts`.
- `toggleSource()` carries the reading position across the switch: it records the
  outgoing view's scroll as a 0..1 fraction (`viewScrollFraction()`) and re-applies
  it to the incoming view (`applyScrollFraction()`). Proportional only — cheap
  (runs once per toggle), drifts where rendered height ≠ source length.
  `applyScrollFraction()` must run **after** the view's `.focus()` — focusing the
  CodeMirror editor can scroll its caret into view and
  would otherwise clobber the restored position.
- `switching` flag suppresses the change handler during programmatic swaps.
- `adoptNormalized()` — Crepe reformats Markdown on load; we adopt that as the
  clean baseline so a freshly opened file isn't marked dirty.
- Milkdown's debounced change listener passes its serialized Markdown to
  `main.ts`. A ProseMirror plugin tracks the host-document generation in a
  WeakMap: derived transactions such as generated heading IDs retain ownership,
  while `setContent()` and editor rebuilds invalidate older callbacks. Save,
  tab switch, close and quit read the active view directly so a pending listener
  cannot hide unsaved changes.
- Session restore reads each saved path once, skips individual read failures,
  then activates the tab identified by the original saved index.
- `WorkspaceSidebar.setDocument()` reveals the active file, lazily loads its
  directory, and derives Markdown headings for the alternate outline view.
  While the file pane is visible, it polls only the root and expanded folders
  every 2.5 seconds; focus or visibility restoration triggers an immediate
  refresh. Expanding a cached folder rereads it. Per-directory request IDs
  keep older reads from overwriting newer results, and unchanged listings do
  not rebuild the tree. This refreshes names and paths, not open document text.
  Each successful directory reread trims a remembered breadcrumb branch if its
  next folder no longer exists. Breadcrumb redraw restores focus by path; an
  activated return button becomes the current-location span with `tabIndex=-1`,
  retaining focus without adding a redundant Tab stop. Separators wrap with
  their destination buttons, and individual overlong names keep a full-path title.
  The secondary window skips sidebar/session restore and hides those controls.
- The file tree's `open_workspace_location` command uses a fresh COM STA off the
  desktop event loop. On Windows, `ShellExecuteW` opens the selected directory
  (or the tree root for a blank-area menu); `SHOpenFolderAndSelectItems` opens a
  file's parent and selects the item. Paths are resolved and converted from
  extended Windows paths to ordinary drive/UNC paths. Explorer integration must
  be verified at the app's normal desktop integrity level; a low-integrity
  development executable cannot call the normal desktop Shell successfully.

### Save
`saveDoc` → `invoke("write_document", …)`. Rust pretty‑prints GFM tables
(`mdfmt`, which leaves lines inside ``` / ~~~ code fences untouched), writes
through `fs_util::write_atomic` so a failed save never truncates the file, and
**returns the text it actually wrote**; the frontend resyncs the
view if it changed in Code mode. In preview mode, Crepe's serialization remains
the clean baseline so replacing the view does not erase undo history. When
editing continues during the asynchronous write, the completed save updates
the baseline without overwriting the newer view and leaves the tab dirty.

### Settings
Workspace preferences include `markdown_only` (default true) and app-managed
`sidebar_width` (CSS pixels, 0 = responsive default). The navigation-rail toggle
and general-settings checkbox share the same preference and debounced save.
The separator uses pointer capture, keyboard adjustment and a layout observer;
window resizing clamps the displayed width without losing the preferred width.
Tree and search commands accept optional `markdown_only`; omitted remains false
for other callers such as the link picker. Filtered directory reads retain only
`.md`/`.markdown`/`.mdx` files (the frontend's Markdown types) and directories
with visible Markdown descendants. Directory traversal runs in `spawn_blocking`,
skips hidden entries and links, and never reads document contents. Each request
shares a scan budget; folders left undecided stay visible, and expensive answers
are cached for 30 seconds so polling does not repeat full walks. Existing polling picks up descendant changes; root and per-directory
request generations reject responses from an earlier filter or root selection.

`get_settings` returns settings plus mode, location and startup-file metadata.
`save_settings` persists the whole `Settings` struct and records its signature.
External edits arrive as a `settings-changed` event.

`windows_new_md` defaults to false and controls Windows Explorer's New submenu.
`get_new_md_menu_status` and `set_new_md_menu` run off the UI thread; the latter
holds a per-user cross-process lock across registry mutation, verification and
settings save, with rollback on failure. `new-md-menu-changed` synchronizes windows;
opening settings or returning focus rechecks the actual registry state. Main-window
startup repairs enabled registrations after an update or move. Ordinary settings
saves mirror actual registration state to prevent stale windows from undoing it.
The ownership journal is under `HKCU\\Software\\PaperNest\\NewMarkdownMenu`;
it restores only values that still match our writes. Existing default applications,
UserChoice and third-party ShellNew entries are preserved. The MSI uninstall CLI
cleans only the current executable's registration and skips major-upgrade removal.

`SettingsPanel` uses a category sidebar and owns a transient font-preview state.
Preview clears the overlay and card backgrounds, retaining an opaque font-control
group; `modal.ts` keeps the visible document inert. Escape/backdrop first returns
to full settings, and closing or rebuilding clears preview. Font input emits
through the existing `onChange` → `applyAppearance` → debounced save path; preview
adds no persisted setting or IPC. `CodeEditor` places its document theme before
the shared Crepe theme so user source fonts and sizes take precedence.

Settings search is local, transient navigation state. Its index comes from
`SECTIONS` plus explicit proxy, version, preview and file-extension entries;
searching never constructs inactive controls or invokes system/network actions.
Results select a category, refresh from the current settings and focus the target.
The update card keeps its asynchronous status separate from the content renderer,
so completion cannot reset a preference or replace active search results.

### Opening files from the OS
`file_arg(argv)` finds the first existing file in the command line. Text-vs-
binary validation happens when `read_document` is called. First launch reads
`get_settings().open_with`; later launches are caught by
`tauri-plugin-single-instance`, which emits `open-file` to the running
main window and focuses it. On Windows, file association registration is
handled by `windows_integration.rs`. The file tree's "new window" action calls
an async Rust command that creates another WebView window in the same app
process; it does not start a second PaperNest process.

### Document context menus
`Editor` and `CodeEditor` own one `TextContextMenu` each. Rich text exposes inline
formatting, paragraph conversions and insertion; CodeMirror (including embedded
code blocks) exposes plain editing actions. Paragraph conversions and insertion
reuse `block-menu.ts`. Menu panels live under `body`, so editor scrolling cannot
clip them; submenu placement flips at screen edges and scrolls in small windows.
Actions capture the selection and document identity when opened, restore them
before editing, and check document ownership again after asynchronous clipboard
or link-input operations. Replacing a document closes its menu. `Editor` owns a
`LinkPicker` anchored to the selection, without a backdrop or background inert.
It uses `list_workspace_dir` on the current document's parent, excludes folders
and the current file, filters names locally, and returns encoded `./filename`
links. The selection label is preserved; at an empty caret, a picked file supplies
its readable name. Unsaved documents and failed directory reads retain manual
link input. A stale read cannot reopen or replace a newer picker. Document/path,
mode and language changes dismiss the picker; Esc restores its selection. Find
requests go through the shared find bar. No settings fields or Rust commands are added.

### Images in the editor
The WebView can't load `<img>` by filesystem path. Crepe's image‑block feature
takes a `proxyDomURL(src)` hook (set in `Editor.init` via `featureConfigs`), which
`Editor.resolveImageSrc` implements: remote / `data:` / `blob:` / `#…` targets
pass straight through; anything else is sent to the `read_image_data_url` Rust
command, which resolves it against the active document's folder (`Editor.docPath`,
kept current by `main.ts` on tab activate / open / save‑as), reads the file, and
returns a `data:` URL (≤ 24 MiB). Only image extensions whose file signature
matches an image format (SVG: text containing `<svg`) are accepted, so a
document cannot inline arbitrary local files into the view or an export.
Results are memo‑cached per `docPath + src`.
The Rust loader checks file metadata and bounds the read to 24 MiB + 1 byte
before encoding, including when a file grows after the metadata check.
HTML `<img>` and Markdown image forms are handled by the image conversion
modules so supported attributes survive round-trips. The editor observes newly
inserted HTML image DOM nodes and resolves their sources again when ProseMirror
recreates them while applying HTML presentation. Pending results only update
images still owned by the same document generation, path and source.
The read-only lightbox
receives an image source event and never changes the document. Opening an image
file directly creates an image tab rather than loading binary data as text.

### Export
`render_html(markdown, title, doc_path, for_print)` → comrak GFM (raw HTML kept)
→ ammonia sanitizing (scripts, event handlers, `javascript:` URLs, iframes and
other active content removed; `details`/`kbd`/sized images, task lists, footnotes
and math spans kept) → local images inlined → `template.html` with all CSS
inlined. The HTML export also inlines KaTeX + highlight.js and renders on load;
comrak emits math as `[data-math-style]` spans without delimiters.

PDF uses the `for_print` variant, which has no scripts. `printHtml` loads it as
`srcdoc` into a hidden iframe with `sandbox="allow-same-origin allow-modals"`
(no `allow-scripts`), so nothing in a document can run with the app's origin or
reach IPC. The app imports `katex` and `highlight.js/lib/common` on demand,
renders math and code into the frame, then calls `print()`; `afterprint`
removes the frame.

---

## 5. How to add things

### A toolbar button
1. `index.html` → add `<button id="btn-x">` with an inline SVG inside `#actions`.
2. `src/main.ts` → `wireButtons()` → `getElementById("btn-x")?.addEventListener("click", …)`.
3. Style is already generic (`#actions button`). Use `.active` / `disabled` as needed.

### The About panel
`#btn-about` in the titlebar → `#about` modal in `index.html`,
wired in `wireAbout()`. Version + settings path come from the `get_settings`
payload (`payload.version`, `payload.location`); the GitHub link opens externally
via `openUrl` (`@tauri-apps/plugin-opener`, covered by `opener:default`). Esc is
handled in `wireShortcuts()` ahead of find-bar / quit-on-escape.

### A block‑menu (⠿) entry
`src/block-menu.ts` → add an item to the right group in `GROUPS`. Give it an
`id: BlockActionId` to expose it through a matching shortcut where appropriate (wire it in
`main.ts` `wireShortcuts()` → `editor.runBlockAction(id)`).
- Selection‑based conversion → `turnInto(v => someProseMirrorCommand)`
  (it lifts list items out first).
- Structural edit → `structural((view, target) => { …view.dispatch(tr)… })`
  where `target` is `{ textPos, from, to, node }` for the hovered block.
- Do **not** use Milkdown's command registry (`callCommand`) from here — it
  silently no‑ops across the Vite dep boundary. Use `@milkdown/kit/prose/*`.
- `resolveTarget()` handles **atom top‑level blocks** (images) specially:
  `posAtCoords` can only return a position *inside* text content, never
  "inside" an atom, so hovering one always yields a depth‑0 (doc‑level)
  boundary position — read `$pos.nodeAfter`/`nodeBefore` for that case
  instead of `$pos.node(1)`.

### A setting in `settings.toml`
1. `src-tauri/src/settings.rs` → add field to `Settings` + `Default` (the struct
   has `#[serde(default)]`, so old files stay compatible).
2. `src/main.ts` → add it to the `Settings` interface.
3. `scripts/gen-settings-example.mjs` → add the key (with a comment) so the
   shipped `settings.example.toml` documents it. Update README's config block too.
   - **Appearance pref** (font/colour): apply it in `applyAppearance()` as a CSS
     var, and add it to the `settings-changed` merge list so external edits take
     effect live.
   - **Behaviour pref** (like `quit_on_escape`): read `settings.x` where needed;
     add it to the `settings-changed` merge too.
   - **App‑managed value**: call `persistSoon()` after you change it. Do *not*
     persist on every keystroke.
4. For a hand‑editable pref, also add a control in `src/settings-panel.ts`
   (`SECTIONS` → the right `<fieldset>`) and a `case` in `main.ts`'s
   `settingsPanel.onChange` handler that runs the same apply‑function.

### A translatable string
1. Add the key to the supported language dictionaries in `src/i18n.ts`
   (English, Chinese, Japanese and German).
2. Static markup in `index.html`: `data-i18n` / `data-i18n-title` /
   `data-i18n-aria` — picked up by `applyStaticI18n()` on boot and on every
   language change.
3. JS‑built DOM (find bar, emoji picker, block menu, settings panel, tab bar):
   call `t(key)` when building and expose a `retranslate()` the central
   `onLangChange` handler in `main.ts` calls.

### A new Rust command
1. Put the command in the Rust module that owns the behavior (`commands.rs`
   for documents/settings, `workspace.rs` for tree/window actions). Use an
   `async fn` for work such as creating another WebView window that must not
   block the event loop.
2. Register it in `lib.rs` → `tauri::generate_handler![…]`.
3. Call `invoke<T>("foo", { args })` from the frontend.
4. If it uses a `window.*` or plugin API on the JS side, add the matching
   permission to `capabilities/default.json`.

### A new export asset
Drop the file in `src-tauri/assets/export/`, `include_str!` it in `export.rs`,
add a `{{PLACEHOLDER}}` to `template.html`, and `.replace()` it in `render_html`.
Keep everything inlined so exports stay offline.

---

## 6. Decisions & constraints (don't re‑discover these the hard way)

- **Unsigned builds.** No Apple Developer account / Windows cert. Users get
  SmartScreen / Gatekeeper warnings on first launch; documented in the README.
  CI publishes SHA‑256 checksums.
- **File drag/drop is enabled.** `main.ts` listens for Tauri drag/drop events
  in the main window; platform window configuration controls native handling.
  Verify both dropping a file and editor-internal drag behavior when changing it.
- **File open from the OS uses argv.** Double‑click / "Open with" launches
  `PaperNest.exe <path>`. `tauri-plugin-single-instance` keeps it to one process and
  routes later opens into the running main window. Windows installer/portable
  association logic lives in `windows_integration.rs`.
- **Secondary windows stay in the same process.** Their WebView2 data directory
  is distinct on Windows, and their frontend does not restore the main window's
  tab session or file tree. Keep their document interactions separate from the
  main window's persisted session state.
- **`quit_on_escape`** (off by default). The block menu's Esc handler calls
  `stopImmediatePropagation()` so dismissing it never quits; other Crepe popups
  aren't guarded — revisit if it bites.
- **Minimized‑window position.** Windows reports ~`-32000` for a minimized
  window; `main.ts` filters bogus positions in `onMoved` and validates saved
  coordinates in `restoreWindow` (which also runs early + `setFocus`).
- **Milkdown command registry** is not reachable from our own modules (Vite
  pre‑bundles Crepe and our imports separately). Block menu uses raw ProseMirror
  commands from `@milkdown/kit/prose/*`. Marks/schema *are* shared, so
  `linkSchema.type(ctx)` etc. work.
- **Markdown source view shows Crepe‑normalised Markdown**, not the original file bytes,
  because that normalised form is the baseline for the dirty check and is what
  gets written on save.
- **CSP** (`tauri.conf.json`): scripts only from the app (`script-src 'self'`,
  no eval); styles allow `'unsafe-inline'` because KaTeX, CodeMirror and
  ProseMirror write `style` attributes; images allow `data:`/`blob:`/http(s) for
  local data URLs and remote images; IPC via `ipc:`/`http://ipc.localhost`.
  `devCsp` additionally allows the Vite HMR websocket. Adding a worker, remote
  script, `eval`-based library or new fetch target needs a CSP change and a
  check of the DevTools console for violations.
- **Exports are untrusted.** Documents may come from anyone. Keep the ammonia
  pass in `export.rs`, keep the print frame without `allow-scripts`, and keep
  local image inlining limited to real images.
- **File commands are not path-scoped yet.** `read_document`, `write_document`
  and the workspace commands accept any path the frontend passes (see TODO).
- **Keep the reading path light.** New features should avoid eagerly traversing
  whole directory trees or loading CodeMirror language packages before they are
  needed. Measure startup and long-document behavior before claiming an
  improvement.

---

## 7. Build / dev / release

Use [docs/development.md](docs/development.md) for local commands and manual
regression, and [`.github/workflows/release.yml`](.github/workflows/release.yml)
for the Windows release workflow. Keep `package.json`, `src-tauri/Cargo.toml`
and `src-tauri/tauri.conf.json`
versions aligned for releases.
