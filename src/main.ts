import { invoke } from "@tauri-apps/api/core";
import {
  availableMonitors,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
  primaryMonitor,
} from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ask, askSaveChanges, message } from "./dialogs";
import { dismissPreviewNotice, showUnsupportedPreviewNotice } from "./preview-notice";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Editor } from "./editor";
import { IMAGE_SOURCE_EVENT } from "./image-preview";
import { CodeEditor } from "./code-editor";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { TabBar, baseName, type Tab } from "./tabs";
import { isImagePath, isMarkdownPath, knownExtensions } from "./file-types";
import { installEditorRendering } from "./editor-theme";
import { FindBar, type FindTarget } from "./find-bar";
import { EmojiPicker } from "./emoji";
import { SettingsPanel, type SettingKey, type NewMdMenuStatus } from "./settings-panel";
import { activateModal, deactivateModal, hasActiveModal } from "./modal";
import { isListMarker, type ListMarker } from "./markdown-serializer";
import type { BlockActionId } from "./block-menu";
import { countTextUnits } from "./text-stats";
import { printHtml } from "./print-view";
import {
  formatShortcut,
  matchesShortcut,
  withDefaultShortcuts,
  type ShortcutSettings,
} from "./shortcuts";
import {
  t,
  setLang,
  onLangChange,
  applyStaticI18n,
  type LangPref,
} from "./i18n";

interface WindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  maximized: boolean;
  geometry_version: number;
}

const DEFAULT_WINDOW_WIDTH = 920;
const DEFAULT_WINDOW_HEIGHT = 680;

interface Settings {
  /** UI language: "system" (OS locale) | "en" | "de" | "ja" | "zh-CN". */
  language: LangPref;
  spellcheck: boolean;
  quit_on_escape: boolean;
  /** Bullet-list marker written on save: "*", "-" or "+". */
  list_marker: ListMarker;
  /** Save edited documents that already have a path automatically. */
  auto_save: boolean;
  /** Show the full file path (not just the name) in the editor header. */
  show_path: boolean;
  /** Reopen the previous session's tabs on startup. */
  open_last_session: boolean;
  /** Keep the tab bar visible even when only one file is open. */
  always_show_tabbar: boolean;
  markdown_only: boolean;
  editor_font: string;
  editor_font_size: number;
  source_font: string;
  source_font_size: number;
  code_alternate_rows: boolean;
  code_alternate_row_color: string;
  remember_window_position: boolean;
  file_associations: string[];
  windows_new_md: boolean;
  accent: string;
  color_scheme: string;
  confirm_delete: boolean;
  proxy_enabled: boolean;
  proxy_url: string;
  auto_check_updates: boolean;
  shortcuts: ShortcutSettings;
  open_with_prompt_dismissed: boolean;
  last_update_check: number;
  open_files: string[];
  active_tab: number;
  sidebar_width: number;
  window: WindowState;
}

interface SettingsPayload {
  settings: Settings;
  portable: boolean;
  fallback: boolean;
  location: string;
  open_with: string | null;
  version: string;
  load_error: { error: string; backup: string | null } | null;
}

interface OpenWithStatus {
  available: boolean;
  registered: boolean;
  managed_by_msi: boolean;
  can_modify: boolean;
  registered_extensions: string[];
}

interface VersionInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  mode: "portable" | "installed" | "unsupported";
  releaseUrl: string;
  notes: string;
  publishedAt: string | null;
  canDownload: boolean;
  assetName: string | null;
  assetSize: number | null;
}

interface PreparedVersion {
  version: string;
  mode: "portable" | "installed";
  path: string;
  alreadyDownloaded: boolean;
}

interface VersionTransferProgress {
  downloaded: number;
  total: number;
}

const win = getCurrentWindow();
const workspaceLaunch = (window as Window & { __PAPERNEST_LAUNCH?: { kind: "workspace_file"; path: string } }).__PAPERNEST_LAUNCH;
const secondaryWindow = Boolean(workspaceLaunch);
document.body.classList.toggle("single-document-window", secondaryWindow);
document.body.classList.toggle("windows-chrome", navigator.userAgent.includes("Windows"));
const editorHost = document.getElementById("editor") as HTMLElement;
const imageDocument = document.getElementById("image-document") as HTMLElement;
const imageElement = document.getElementById("image-document-content") as HTMLImageElement;
const sourceShell = document.getElementById("source-shell") as HTMLElement;
const sourceEl = document.getElementById("source") as HTMLElement;
const textStatsEl = document.getElementById("text-stats") as HTMLElement;
const titleEl = document.getElementById("doc-title") as HTMLElement;
const titleInput = document.getElementById("doc-title-input") as HTMLInputElement;
const editor = new Editor(editorHost);
const codeEditor = new CodeEditor(sourceEl);
const tabBar = new TabBar(document.getElementById("tabs") as HTMLElement);
const workspace = new WorkspaceSidebar();
const navigationHistory: string[] = [];
let navigationIndex = -1;
let navigatingHistory = false;

function updateNavigationButtons(): void {
  (document.getElementById("nav-back") as HTMLButtonElement).disabled = navigationIndex <= 0;
  (document.getElementById("nav-forward") as HTMLButtonElement).disabled = navigationIndex >= navigationHistory.length - 1;
}

function rememberNavigation(path: string | null): void {
  if (!path || secondaryWindow || navigatingHistory) return;
  if (navigationHistory[navigationIndex]?.toLowerCase() === path.toLowerCase()) return;
  navigationHistory.splice(navigationIndex + 1);
  navigationHistory.push(path);
  navigationIndex = navigationHistory.length - 1;
  updateNavigationButtons();
}

async function navigateHistory(step: number): Promise<void> {
  const next = navigationIndex + step;
  const path = navigationHistory[next];
  if (!path) return;
  navigatingHistory = true;
  try {
    await openPath(path);
    navigationIndex = next;
  } finally {
    navigatingHistory = false;
    updateNavigationButtons();
  }
}
const findBar = new FindBar(editorHost);
const emojiPicker = new EmojiPicker();
const settingsPanel = new SettingsPanel(() => settings);

let settings: Settings;
let openWithStatus: OpenWithStatus = {
  available: false,
  registered: false,
  managed_by_msi: false,
  can_modify: false,
  registered_extensions: [],
};
let switching = false;
/** User-selected Markdown source view. Non-Markdown tabs always use Code mode. */
let sourceMode = false;
/** The view that is currently mounted/visible. Kept separate from active tab
 *  so tab switches can first snapshot the previous tab correctly. */
let codeViewVisible = false;
let persistTimer: number | undefined;

function shouldUseCodeView(tab: Tab | undefined = tabBar.active): boolean {
  return !tab?.imageUrl && (sourceMode || Boolean(tab && !isMarkdownPath(tab.path)));
}

function setViewVisibility(tab: Tab | undefined = tabBar.active): void {
  const image = Boolean(tab?.imageUrl);
  const startPage = Boolean(tab?.startPage);
  const loading = Boolean(tab?.loading);
  codeViewVisible = shouldUseCodeView(tab);
  editorHost.hidden = loading || startPage || image || codeViewVisible;
  if (editorHost.hidden) editor.dismissTextMenus();
  sourceShell.hidden = loading || startPage || image || !codeViewVisible;
  imageDocument.hidden = loading || startPage || !image;
  (document.getElementById("new-tab-page") as HTMLElement).hidden = !startPage;
  (document.getElementById("document-loading") as HTMLElement).hidden = !loading;
  document.getElementById("document-pane")?.classList.toggle("start-page-active", startPage);
  document.getElementById("document-pane")?.classList.toggle("document-loading", loading);
  imageElement.src = tab?.imageUrl ?? "";
  imageElement.alt = image ? baseName(tab?.path ?? null) : "";
}

/** Current document text, from whichever view is active. */
function readView(): string {
  if (tabBar.active?.imageUrl || tabBar.active?.startPage || tabBar.active?.loading) return "";
  return codeViewVisible ? codeEditor.getText() : editor.getMarkdown();
}

let textStatsTotal = 0;
let textStatsTotalDirty = true;
let textStatsFrame: number | null = null;

function statsDocumentText(): string {
  return codeViewVisible ? codeEditor.getText() : editor.plainText();
}

function statsSelectionText(): string {
  return codeViewVisible ? codeEditor.selectionText() : editor.selectionText();
}

function updateTextStats(): void {
  textStatsFrame = null;
  if (!tabBar.active || tabBar.active.imageUrl || tabBar.active.startPage || tabBar.active.loading) {
    textStatsEl.hidden = true;
    return;
  }
  textStatsEl.hidden = false;

  if (textStatsTotalDirty) {
    textStatsTotal = countTextUnits(statsDocumentText());
    textStatsTotalDirty = false;
  }

  const selectedText = statsSelectionText();
  const hasSelection = selectedText.length > 0;
  const count = hasSelection ? countTextUnits(selectedText) : textStatsTotal;
  textStatsEl.dataset.selected = String(hasSelection);
  textStatsEl.textContent = t(hasSelection ? "stats.selected" : "stats.total", {
    count: count.toLocaleString(),
  });
}

function scheduleTextStats(recount = false): void {
  if (recount) textStatsTotalDirty = true;
  if (textStatsFrame !== null) return;
  textStatsFrame = requestAnimationFrame(updateTextStats);
}

let viewWriteGeneration = 0;

/** Load `md` into the active view (and restore a scroll offset). */
function writeView(md: string, scrollTop = 0): void {
  const generation = ++viewWriteGeneration;
  if (codeViewVisible) {
    switching = false;
    void codeEditor.setDocument(md, tabBar.active?.path ?? null, scrollTop);
    scheduleTextStats(true);
    return;
  }
  switching = true;
  editor.setContent(md);
  scheduleTextStats(true);
  requestAnimationFrame(() => {
    if (generation !== viewWriteGeneration) return;
    editorHost.scrollTop = scrollTop;
    switching = false;
  });
}

function viewScrollTop(): number {
  if (tabBar.active?.imageUrl) return imageDocument.scrollTop;
  return codeViewVisible ? codeEditor.scrollTop : editorHost.scrollTop;
}

/** How far the visible view is scrolled, as a 0..1 fraction of its range.
 *  Used to carry the reading position across a source/preview toggle. */
function viewScrollFraction(): number {
  const range = codeViewVisible
    ? codeEditor.scrollHeight - codeEditor.clientHeight
    : editorHost.scrollHeight - editorHost.clientHeight;
  if (range <= 0) return 0;
  const scrollTop = codeViewVisible ? codeEditor.scrollTop : editorHost.scrollTop;
  return Math.min(1, Math.max(0, scrollTop / range));
}

/** Restore the fraction after document layout and focus have both settled.
 * A later document write invalidates this restoration. */
function applyScrollFraction(frac: number): void {
  const generation = viewWriteGeneration;
  const tab = tabBar.active;
  const code = codeViewVisible;
  const run = () => {
    if (generation !== viewWriteGeneration || tab !== tabBar.active || code !== codeViewVisible) return;
    if (codeViewVisible) {
      const range = codeEditor.scrollHeight - codeEditor.clientHeight;
      codeEditor.scrollTop = range > 0 ? Math.round(frac * range) : 0;
    } else {
      const range = editorHost.scrollHeight - editorHost.clientHeight;
      editorHost.scrollTop = range > 0 ? Math.round(frac * range) : 0;
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
}

/** Push the appearance-related settings into CSS custom properties. */
function applyAppearance(): void {
  const scheme = settings.color_scheme;
  document.documentElement.dataset.theme = scheme === "light" || scheme === "dark" ? scheme
    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const s = document.documentElement.style;
  const setOrClear = (name: string, value: string) => {
    const v = (value ?? "").trim();
    if (v) s.setProperty(name, v);
    else s.removeProperty(name);
  };
  s.setProperty("--editor-font-size", `${settings.editor_font_size || 16}px`);
  s.setProperty("--source-font-size", `${settings.source_font_size || 15}px`);
  setOrClear("--editor-font", settings.editor_font);
  setOrClear("--source-font", settings.source_font);
  setOrClear("--accent", settings.accent);
  setOrClear("--code-alt-row-color", settings.code_alternate_row_color);
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (settings && settings.color_scheme !== "light" && settings.color_scheme !== "dark") {
    applyAppearance();
    if (settingsPanel.isOpen) settingsPanel.refresh();
  }
});

/** Switch the UI language and refresh every visible string. */
function applyLanguage(pref: LangPref): void {
  setLang(pref); // fires the onLangChange handler below (no-op if unchanged)
}

// One place to re-render every translatable surface after a language change.
onLangChange(() => {
  applyStaticI18n();
  editor.retranslate();
  codeEditor.contextMenu.close();
  findBar.retranslate();
  emojiPicker.retranslate();
  settingsPanel.retranslate();
  tabBar.render();
  if (!tabMenuEl.hidden) renderTabMenu();
  workspace.retranslate();
  updateSourceButton();
  updateShortcutTitles();
  void updateMaximizeButton();
  updateTitle();
  renderVersionInfo();
  scheduleTextStats();
});

function stem(path: string | null): string {
  return baseName(path).replace(/\.[^.]+$/, "") || "document";
}

function updateTitle(): void {
  const tab = tabBar.active;
  const mark = tab?.dirty ? "• " : "";
  const name = tab?.startPage ? t("tab.new") : baseName(tab?.path ?? null);
  const imageFolder = tab?.imageUrl && tab.path ? parentOfWorkspacePath(tab.path).split(/[\\/]/).filter(Boolean).pop() : null;
  const shown = settings?.show_path && tab?.path ? tab.path : imageFolder ? `${imageFolder} / ${stem(tab?.path ?? null)}` : name;
  titleEl.textContent = mark + shown;
  titleEl.title = tab?.path ?? "";
  void win.setTitle(`${mark}${name} — PaperNest`);
}

function cancelTitleRename(): void {
  titleInput.hidden = true;
  titleEl.hidden = false;
  updateTitle();
}

async function commitTitleRename(): Promise<void> {
  const tab = tabBar.active;
  if (!tab?.path || tab.loading) {
    cancelTitleRename();
    return;
  }
  const currentName = baseName(tab.path);
  const newName = titleInput.value.trim();
  if (!newName || newName === currentName) {
    cancelTitleRename();
    return;
  }
  try {
    const content = readView();
    const scrollTop = viewScrollTop();
    const wasCodeView = codeViewVisible;
    const oldPath = tab.path;
    const nextPath = await invoke<string>("rename_document", {
      path: tab.path,
      newName,
    });
    tab.path = nextPath;
    editor.setDocPath(nextPath);
    setViewVisibility(tab);
    if (wasCodeView !== codeViewVisible) {
      if (codeViewVisible) {
        await codeEditor.setDocument(content, nextPath, scrollTop);
      } else {
        writeView(content, scrollTop);
      }
    } else if (codeViewVisible) {
      void codeEditor.setLanguageForPath(nextPath);
    }
    tabBar.render();
    updateSourceButton();
    persistSoon();
    void workspace.setDocument(nextPath, content);
    void workspace.refresh(parentOfWorkspacePath(oldPath));
  } catch (err) {
    await message(t("dialog.renameError", { err: String(err) }), {
      title: "PaperNest",
      kind: "error",
    });
  } finally {
    cancelTitleRename();
  }
}

function parentOfWorkspacePath(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index === 2 && /^[A-Za-z]:/.test(path) ? path.slice(0, 3) : path.slice(0, index);
}

function beginTitleRename(): void {
  const tab = tabBar.active;
  if (!tab || tab.loading) return;
  if (!tab.path) {
    void saveAs();
    return;
  }
  const name = baseName(tab.path);
  titleInput.value = name;
  titleEl.hidden = true;
  titleInput.hidden = false;
  titleInput.focus();
  const dot = name.lastIndexOf(".");
  titleInput.setSelectionRange(0, dot > 0 ? dot : name.length);
}

function persistSoon(): void {
  if (secondaryWindow) return;
  const withPath = tabBar.tabs.filter((t) => t.path);
  settings.open_files = withPath.map((t) => t.path as string);
  const activePath = tabBar.active?.path ?? null;
  const idx = activePath ? settings.open_files.indexOf(activePath) : -1;
  settings.active_tab = idx < 0 ? 0 : idx;

  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    void invoke("save_settings", { settings });
  }, 800);
}

async function refreshOpenWithStatus(): Promise<OpenWithStatus> {
  openWithStatus = await invoke<OpenWithStatus>("get_open_with_status");
  settingsPanel.setOpenWithStatus(
    openWithStatus.available,
    openWithStatus.registered,
    openWithStatus.managed_by_msi,
    openWithStatus.can_modify,
  );
  settingsPanel.setAssociationStatus(
    openWithStatus.available,
    openWithStatus.registered_extensions,
  );
  return openWithStatus;
}

async function registerFileAssociations(extensions: string[]): Promise<void> {
  try {
    openWithStatus = await invoke<OpenWithStatus>("register_file_associations", {
      extensions,
    });
    settingsPanel.setOpenWithStatus(
      openWithStatus.available,
      openWithStatus.registered,
      openWithStatus.managed_by_msi,
      openWithStatus.can_modify,
    );
    settingsPanel.setAssociationStatus(
      openWithStatus.available,
      openWithStatus.registered_extensions,
    );
  } catch (err) {
    await message(t("dialog.openWithError", { err: String(err) }), {
      title: "PaperNest",
      kind: "error",
    });
    throw err;
  }
}

async function setOpenWithRegistration(register: boolean): Promise<void> {
  try {
    openWithStatus = await invoke<OpenWithStatus>(
      register ? "register_open_with" : "unregister_open_with",
    );
    settingsPanel.setOpenWithStatus(
      openWithStatus.available,
      openWithStatus.registered,
      openWithStatus.managed_by_msi,
      openWithStatus.can_modify,
    );
    settingsPanel.setAssociationStatus(
      openWithStatus.available,
      openWithStatus.registered_extensions,
    );
    settings.open_with_prompt_dismissed = register ? false : true;
    persistSoon();
  } catch (err) {
    await message(t("dialog.openWithError", { err: String(err) }), {
      title: "PaperNest",
      kind: "error",
    });
  }
}

async function initializeOpenWithIntegration(): Promise<void> {
  const status = await refreshOpenWithStatus();
  if (
    !status.available ||
    status.registered ||
    !status.can_modify ||
    settings.open_with_prompt_dismissed
  ) {
    return;
  }

  const register = await ask(t("dialog.openWithPrompt"), {
    title: "PaperNest",
    kind: "info",
  });
  if (register) {
    await setOpenWithRegistration(true);
  } else {
    settings.open_with_prompt_dismissed = true;
    persistSoon();
  }
}

/** Crepe may reformat Markdown on load; adopt that as the tab's baseline so a
 *  freshly loaded document does not show up as dirty. */
function adoptNormalized(tab: Tab): void {
  if (codeViewVisible) return; // Code mode keeps source text verbatim
  const md = editor.getMarkdown();
  tab.content = md;
  if (!tab.dirty) tab.saved = md;
}

function updateTabContent(tab: Tab, content: string): void {
  tab.content = content;
  tab.dirty = tab.content !== tab.saved;
  if (tab === tabBar.active) {
    tabBar.refreshDirty();
    updateTitle();
  }
  // No persist here: editing text changes nothing in settings.toml.
}

function markDirtyFromView(): void {
  const tab = tabBar.active;
  if (tab && !tab.imageUrl && !tab.startPage && !tab.loading) updateTabContent(tab, readView());
}

// --- tab wiring -------------------------------------------------------------

tabBar.onStructureChange = () => {
  persistSoon();
  if (!tabMenuEl.hidden) renderTabMenu();
};

function showTab(next: Tab): void {
  hideTabTooltip();
  editor.setDocPath(next.path);
  setViewVisibility(next);
  if (next.startPage || next.loading) {
    // Landing and loading pages have no document content to mount.
  } else if (next.imageUrl) {
    imageDocument.scrollTop = next.scrollTop;
  } else {
    writeView(next.content, next.scrollTop);
    adoptNormalized(next);
    editor.setSpellcheck(settings.spellcheck);
    codeEditor.setAlternateRows(settings.code_alternate_rows);
  }
  updateTitle();
  updateSourceButton();
  scheduleTextStats(true);
  if (!next.imageUrl && !next.startPage && !next.loading) (codeViewVisible ? codeEditor : editor).focus();
  persistSoon();
  if (next.loading) return;
  void workspace.setDocument(next.path, next.imageUrl ? "" : next.content);
  rememberNavigation(next.path);
}

tabBar.onActivate = (next: Tab, prev: Tab | null) => {
  if (prev && !prev.loading) {
    if (!prev.imageUrl && !prev.startPage) updateTabContent(prev, codeViewVisible ? codeEditor.getText() : editor.getMarkdown());
    prev.scrollTop = prev.imageUrl ? imageDocument.scrollTop : codeViewVisible ? codeEditor.scrollTop : editorHost.scrollTop;
    // Switching away is an auto-save point; prev is now saved from tab.content.
    if (prev !== next) void autoSaveTab(prev);
  }
  showTab(next);
};

workspace.onOpen = openPreviewPath;
workspace.onMarkdownOnlyChange = (value) => { settings.markdown_only = value; settingsPanel.refresh(); persistSoon(); };
workspace.onWidthChange = (value) => { settings.sidebar_width = value; persistSoon(); };
workspace.onOpenInNewTab = (path) => openPath(path, true);
workspace.getConfirmDelete = () => settings.confirm_delete !== false;
workspace.onConfirmDeleteChange = (value) => { settings.confirm_delete = value; settingsPanel.refresh(); persistSoon(); };
editor.onLinkClick = (href) => {
  void (async () => {
    try {
      if (/^https?:\/\//i.test(href)) { await openUrl(href); return; }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) return;
      const docPath = tabBar.active?.path;
      if (!docPath) throw new Error("Save this document before opening a relative link.");
      const path = await invoke<string>("resolve_workspace_link", { docPath, href });
      await openPath(path);
    } catch (error) {
      await message(String(error), { title: "PaperNest", kind: "error" });
    }
  })();
};
workspace.onHeading = (index) => {
  if (codeViewVisible && isMarkdownPath(tabBar.active?.path)) toggleSource();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    editorHost.querySelectorAll<HTMLElement>(".ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6")[index]?.scrollIntoView({ block: "start", behavior: "smooth" });
  }));
};
workspace.onRename = (oldPath, newPath) => {
  for (let i = 0; i < navigationHistory.length; i++) {
    const old = navigationHistory[i].toLowerCase();
    const source = oldPath.toLowerCase();
    if (old === source || old.startsWith(`${source}\\`)) navigationHistory[i] = newPath + navigationHistory[i].slice(oldPath.length);
  }
  const content = readView();
  const scrollTop = viewScrollTop();
  const wasCodeView = codeViewVisible;
  for (const tab of tabBar.tabs) {
    if (!tab.path) continue;
    const old = tab.path.toLowerCase();
    const source = oldPath.toLowerCase();
    if (old === source || old.startsWith(`${source}\\`)) {
      tab.path = newPath + tab.path.slice(oldPath.length);
    }
  }
  const active = tabBar.active;
  if (active?.path) {
    editor.setDocPath(active.path);
    setViewVisibility(active);
    if (wasCodeView !== codeViewVisible) writeView(content, scrollTop);
    else if (codeViewVisible) void codeEditor.setLanguageForPath(active.path);
    void workspace.setDocument(active.path, content);
  }
  tabBar.render(); updateSourceButton(); updateTitle(); persistSoon();
};
workspace.onBeforeDelete = async (path) => {
  markDirtyFromView();
  const dirty = tabBar.tabs.filter((tab) => tab.dirty && tab.path && (tab.path.toLowerCase() === path.toLowerCase() || tab.path.toLowerCase().startsWith(`${path.toLowerCase()}\\`)));
  if (!dirty.length) return true;
  return ask(t("dialog.discardChanges", { name: dirty.map((tab) => baseName(tab.path)).join(", ") }), { title: t("dialog.discardTitle"), kind: "warning", confirmLabel: t("dialog.discard"), danger: true });
};
workspace.onDelete = (path) => {
  const removed = tabBar.tabs.filter((tab) => tab.path && (tab.path.toLowerCase() === path.toLowerCase() || tab.path.toLowerCase().startsWith(`${path.toLowerCase()}\\`)));
  for (const tab of removed) tabBar.remove(tab.id);
  void workspace.setDocument(tabBar.active?.path ?? null, readView());
  persistSoon();
};

tabBar.onCloseRequest = async (tab: Tab) => {
  if (tab.startPage && tabBar.tabs.length === 1) {
    await quitApp();
    return true;
  }
  if (tab === tabBar.active) markDirtyFromView();
  if (!(await settleUnsaved([tab], "close"))) return false;
  if (!tabBar.tabs.includes(tab)) return true;
  autoSavePending.delete(tab);
  tabBar.remove(tab.id);
  persistSoon();
  return true;
};

editor.onChange = (markdown) => {
  const tab = tabBar.active;
  if (switching || codeViewVisible || !tab || tab.imageUrl || tab.startPage || tab.loading) return;
  updateTabContent(tab, markdown);
  noteUserEdit(tab);
  workspace.setContent(markdown);
  scheduleTextStats(true);
};
editor.onSelectionChange = () => {
  if (!codeViewVisible) scheduleTextStats();
};

codeEditor.onChange = () => {
  if (!codeViewVisible) return;
  const text = codeEditor.getText();
  const tab = tabBar.active;
  if (!tab || tab.imageUrl || tab.startPage || tab.loading) return;
  updateTabContent(tab, text);
  noteUserEdit(tab);
  workspace.setContent(text);
  scheduleTextStats(true);
};
codeEditor.onSelectionChange = () => {
  if (codeViewVisible) scheduleTextStats();
};

emojiPicker.onPick = (glyph) => {
  if (codeViewVisible) {
    codeEditor.insertText(glyph);
  } else {
    editor.insertText(glyph);
    markDirtyFromView();
  }
};
emojiPicker.onClose = () => (codeViewVisible ? codeEditor : editor).focus();

function applyProxySettings(reloadEditor: boolean): void {
  editor.setProxyConfig(settings.proxy_enabled, settings.proxy_url);
  if (!reloadEditor || codeViewVisible) return;
  switching = true;
  void editor.reload().then(() => {
    editor.setSpellcheck(settings.spellcheck);
    switching = false;
    markDirtyFromView();
  });
}

// The settings GUI reports each change here; we own the object + the save.
settingsPanel.onChange = (key: SettingKey, value) => {
  (settings as unknown as Record<string, unknown>)[key] = value;
  switch (key) {
    case "language":
      applyLanguage(value as LangPref);
      break;
    case "spellcheck":
      editor.setSpellcheck(settings.spellcheck);
      break;
    case "show_path":
      updateTitle();
      break;
    case "always_show_tabbar":
      tabBar.setAlwaysShow(settings.always_show_tabbar);
      break;
    case "markdown_only":
      workspace.setMarkdownOnly(settings.markdown_only);
      break;
    case "list_marker":
      if (isListMarker(settings.list_marker)) {
        editor.setListMarker(settings.list_marker);
        if (!codeViewVisible) {
          switching = true;
          void editor.reload().then(() => {
            editor.setSpellcheck(settings.spellcheck);
            switching = false;
            markDirtyFromView();
          });
        }
      }
      break;
    case "editor_font":
    case "editor_font_size":
    case "source_font":
    case "source_font_size":
    case "accent":
    case "color_scheme":
    case "code_alternate_row_color":
      applyAppearance();
      break;
    case "code_alternate_rows":
      codeEditor.setAlternateRows(settings.code_alternate_rows);
      break;
    case "auto_save":
      if (!settings.auto_save) cancelAutoSave();
      break;
    case "proxy_enabled":
    case "proxy_url":
      applyProxySettings(true);
      break;
    // quit_on_escape / open_last_session: no immediate effect
  }
  persistSoon();
};
settingsPanel.onShortcutChange = (action, value) => {
  settings.shortcuts[action] = value;
  updateShortcutTitles();
  settingsPanel.refresh();
  persistSoon();
};
let newMdMenuBusy = false;
let newMdMenuStatus: NewMdMenuStatus = { available: navigator.userAgent.includes("Windows"), enabled: false, can_modify: false, conflict: null };
function reportNewMdMenuError(error: unknown): void {
  settingsPanel.setNewMdMenuStatus(newMdMenuStatus, t("settings.newMd.failed", { error: String(error) }));
}
async function refreshNewMdMenu(): Promise<NewMdMenuStatus> {
  const status = await invoke<NewMdMenuStatus>("get_new_md_menu_status");
  newMdMenuStatus = status;
  settings.windows_new_md = status.enabled;
  settingsPanel.setNewMdMenuStatus(status);
  return status;
}
async function applyNewMdMenu(enabled: boolean): Promise<void> {
  if (newMdMenuBusy) return;
  newMdMenuBusy = true;
  try {
    const status = await invoke<NewMdMenuStatus>("set_new_md_menu", { enabled });
    newMdMenuStatus = status;
    settings.windows_new_md = status.enabled;
    settingsPanel.setNewMdMenuStatus(status);
    persistSoon();
  } catch (error) {
    try { await refreshNewMdMenu(); } catch { /* Keep the last verified state. */ }
    throw error;
  } finally { newMdMenuBusy = false; }
}
settingsPanel.onNewMdMenuToggle = applyNewMdMenu;
settingsPanel.onOpen = () => { void refreshNewMdMenu().catch(reportNewMdMenuError); };
window.addEventListener("focus", () => {
  if (settings && !newMdMenuBusy) void refreshNewMdMenu().catch(() => {});
});
// Losing window focus (switching to another app) is an auto-save point.
window.addEventListener("blur", () => {
  if (settings?.auto_save) void flushAutoSave();
});

settingsPanel.onOpenWithToggle = async () => {
  if (!openWithStatus.can_modify) return;
  await setOpenWithRegistration(!openWithStatus.registered);
};
settingsPanel.onRegisterAssociations = async (extensions) => {
  settings.file_associations = [...extensions];
  persistSoon();
  await registerFileAssociations(extensions);
};
settingsPanel.onSetDefaultAssociations = async (extensions) => {
  settings.file_associations = [...extensions];
  persistSoon();
  await registerFileAssociations(extensions);
  await openUrl("ms-settings:defaultapps?registeredAppUser=PaperNest");
};
settingsPanel.onCheckUpdates = async () => {
  await checkVersion();
  if (versionError) return t("update.failed", { err: versionError });
  if (!versionInfo) return t("update.checking");
  return versionInfo.updateAvailable
    ? t("update.available", { version: versionInfo.latestVersion })
    : t("update.latest");
};
settingsPanel.onProxyTest = async (proxyUrl) => {
  await invoke("test_proxy", { proxyUrl });
};
settingsPanel.onClose = () => (codeViewVisible ? codeEditor : editor).focus();

// --- file operations -------------------------------------------------------

function newTab(): void {
  tabBar.add(null, "", true, null, true);
}

function createDocumentFromStartPage(): void {
  const tab = tabBar.active;
  if (!tab?.startPage) return;
  tab.startPage = false;
  setViewVisibility(tab);
  writeView("");
  tabBar.render();
  updateTitle();
  updateSourceButton();
  editor.focus();
}

let previewOpenSequence = 0;

async function readPath(path: string, isRelevant = () => true): Promise<{ content: string; imageUrl: string | null } | null> {
  try {
    if (isImagePath(path)) {
      return { content: "", imageUrl: await invoke<string>("read_image_data_url", { docPath: null, src: path }) };
    }
    return { content: await invoke<string>("read_document", { path }), imageUrl: null };
  } catch (error) {
    if (isRelevant() && !showUnsupportedPreviewNotice(path, error)) {
      await message(String(error), { title: "PaperNest", kind: "error" });
    }
    return null;
  }
}

async function openPreviewPath(path: string): Promise<void> {
  const request = ++previewOpenSequence;
  const existing = tabBar.findByPath(path);
  if (existing) {
    tabBar.activate(existing.id);
    return;
  }

  const slot = tabBar.tabs.find((tab) => tab.preview)
    ?? (tabBar.active && !tabBar.active.pinned ? tabBar.active : undefined);
  const loaded = await readPath(path, () => request === previewOpenSequence);
  if (!loaded || request !== previewOpenSequence) return;

  if (slot && tabBar.tabs.includes(slot)) {
    if (slot === tabBar.active) markDirtyFromView();
    if (slot.dirty) {
      const proceed = await settleUnsaved([slot], "close");
      if (!proceed || request !== previewOpenSequence || !tabBar.tabs.includes(slot)) return;
      autoSavePending.delete(slot);
    }
    // Force onActivate to mount the newly loaded document even when the
    // preview slot is already the selected tab.
    if (slot === tabBar.active) tabBar.activeId = "";
    slot.path = path;
    slot.saved = loaded.content;
    slot.content = loaded.content;
    slot.dirty = false;
    slot.scrollTop = 0;
    slot.imageUrl = loaded.imageUrl;
    slot.startPage = false;
    slot.preview = true;
    tabBar.activate(slot.id);
  } else {
    const tab = tabBar.add(path, loaded.content, true, loaded.imageUrl);
    tab.preview = true;
  }
}

async function openPath(path: string, inNewTab = false): Promise<void> {
  ++previewOpenSequence;
  const existing = tabBar.findByPath(path);
  if (existing) {
    if (inNewTab) {
      existing.preview = false;
      existing.pinned = true;
      tabBar.render();
    }
    tabBar.activate(existing.id);
    void workspace.setDocument(existing.path, existing.content);
    return;
  }

  const loadingTab = inNewTab ? tabBar.add(path, "", true, null, false, true) : null;
  if (loadingTab) loadingTab.pinned = true;
  const loaded = await readPath(path, () => !loadingTab || tabBar.tabs.includes(loadingTab));
  if (loadingTab) {
    // Completion belongs to this tab even if the user has since switched or
    // closed it. Never activate another document on behalf of an older read.
    if (!tabBar.tabs.includes(loadingTab)) return;
    if (!loaded) {
      tabBar.remove(loadingTab.id);
      return;
    }
    loadingTab.saved = loaded.content;
    loadingTab.content = loaded.content;
    loadingTab.imageUrl = loaded.imageUrl;
    loadingTab.loading = false;
    if (tabBar.active === loadingTab) showTab(loadingTab);
    tabBar.render();
    persistSoon();
    return;
  }
  if (!loaded) return;
  const { content: text, imageUrl } = loaded;
  const image = imageUrl !== null;

  const cur = tabBar.active;
  if (!inNewTab && cur && !cur.path && !cur.dirty && cur.content === "") {
    cur.startPage = false;
    cur.path = path;
    cur.saved = text;
    cur.content = text;
    cur.dirty = false;
    cur.imageUrl = imageUrl;
    cur.preview = false;
    editor.setDocPath(path);
    setViewVisibility(cur);
    if (!image) {
      writeView(text);
      adoptNormalized(cur);
    }
    tabBar.render();
    editor.setSpellcheck(settings.spellcheck);
    updateSourceButton();
    if (!image) (codeViewVisible ? codeEditor : editor).focus();
    updateTitle();
    void workspace.setDocument(path, text);
    rememberNavigation(path);
  } else {
    const tab = tabBar.add(path, text, true, imageUrl); // triggers onActivate
    tab.pinned = inNewTab;
  }

  persistSoon();
}

async function openDialog(): Promise<void> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: "Documents / Code", extensions: knownExtensions() },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (typeof picked === "string") await openPath(picked);
}

async function wireFileDrop(): Promise<void> {
  await win.onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type === "enter" || payload.type === "over") {
      document.body.classList.add("mdmeow-file-drag");
      return;
    }

    document.body.classList.remove("mdmeow-file-drag");
    if (payload.type !== "drop") return;

    const paths = payload.paths;
    if (paths.length === 0) return;
    void (async () => {
      for (const path of paths) await openPath(path);
      try {
        await win.unminimize();
        await win.setFocus();
      } catch {
        /* not critical */
      }
    })();
  });
}

interface SaveOptions {
  /** Never replace the visible text, even when the backend reformatted it
   *  (auto-save and close): rewriting the view would reset cursor and undo. */
  keepView?: boolean;
  /** Auto-save: skip unchanged text and report failures once, without waiting. */
  quiet?: boolean;
}

const AUTO_SAVE_DELAY_MS = 1500;
/** Every write of one tab runs after the previous one has settled. */
const saveChains = new WeakMap<Tab, Promise<unknown>>();
/** Tabs edited by the user since their last auto-save attempt. Only these are
 *  auto-saved, so merely opening (or re-normalizing) a file never writes it. */
const autoSavePending = new Set<Tab>();
let autoSaveTimer: number | undefined;
let autoSaveError: { path: string; error: string } | null = null;

function queueTabSave(tab: Tab, job: () => Promise<boolean>): Promise<boolean> {
  const previous = saveChains.get(tab) ?? Promise.resolve();
  const run = previous.then(job, job);
  saveChains.set(tab, run.catch(() => {}));
  return run;
}

async function saveDoc(tab: Tab | undefined = tabBar.active, options: SaveOptions = {}): Promise<boolean> {
  if (!tab || tab.imageUrl || tab.loading) return false;
  if (!tab.path) return tab === tabBar.active ? saveAs() : false;
  return queueTabSave(tab, () => writeTab(tab, options));
}

async function writeTab(tab: Tab, options: SaveOptions): Promise<boolean> {
  // A tab closed while its save was queued has nothing left to write.
  if (!tabBar.tabs.includes(tab)) return true;
  if (!tab.path || tab.imageUrl || tab.loading || tab.startPage) return false;
  const path = tab.path;
  const md = tab === tabBar.active ? readView() : tab.content;
  if (options.quiet && md === tab.saved) {
    updateTabContent(tab, md);
    return true;
  }
  let written: string;
  try {
    // The backend beautifies GFM tables and returns the text it wrote.
    written = await invoke<string>("write_document", {
      path,
      contents: md,
    });
  } catch (e) {
    if (options.quiet) reportAutoSaveError(path, e);
    else await message(String(e), { title: "PaperNest", kind: "error" });
    return false;
  }
  if (autoSaveError?.path === path) autoSaveError = null;
  if (!tabBar.tabs.includes(tab) || tab.path !== path) return true;
  const active = tab === tabBar.active;
  const latest = active ? readView() : tab.content;
  const preview = active && !codeViewVisible;
  // In preview, keep Crepe's serialization as the baseline: table formatting
  // changes only the Markdown source and replacing the view would erase undo.
  // keepView does the same in Code mode: the submitted text is the baseline,
  // so the tab does not flip back to dirty because disk has formatted tables.
  tab.saved = preview || options.keepView ? md : written;
  if (!options.keepView && latest === md && written !== md && !preview) {
    if (active) writeView(written, viewScrollTop());
    tab.content = written;
  } else {
    tab.content = latest;
  }
  // Edits made while the write was in flight stay in the view and remain dirty.
  tab.dirty = tab.content !== tab.saved;
  tabBar.refreshDirty();
  updateTitle();
  if (!options.quiet) persistSoon();
  return true;
}

function reportAutoSaveError(path: string, error: unknown): void {
  const text = String(error);
  // One notice per file and error; the debounce must not stack dialogs.
  if (autoSaveError?.path === path && autoSaveError.error === text) return;
  autoSaveError = { path, error: text };
  void message(t("dialog.autoSaveFailed", { name: baseName(path), error: text }), { title: "PaperNest", kind: "error" });
}

/** A user edit: (re)start the auto-save debounce for this tab. */
function noteUserEdit(tab: Tab): void {
  if (!settings?.auto_save || !tab.path) return;
  autoSavePending.add(tab);
  window.clearTimeout(autoSaveTimer);
  autoSaveTimer = window.setTimeout(() => { void flushAutoSave(); }, AUTO_SAVE_DELAY_MS);
}

function cancelAutoSave(): void {
  window.clearTimeout(autoSaveTimer);
  autoSavePending.clear();
}

async function flushAutoSave(): Promise<void> {
  window.clearTimeout(autoSaveTimer);
  await Promise.all([...autoSavePending].map(autoSaveTab));
}

async function autoSaveTab(tab: Tab): Promise<void> {
  if (!autoSavePending.has(tab)) return;
  // Cleared before writing: edits during the write mark the tab pending again.
  autoSavePending.delete(tab);
  if (!settings.auto_save || !tabBar.tabs.includes(tab) || !tab.dirty) return;
  if (!tab.path || tab.imageUrl || tab.startPage || tab.loading) return;
  const ok = await queueTabSave(tab, () => writeTab(tab, { keepView: true, quiet: true }));
  // Failed: retry on the next switch, focus loss or edit; the notice is not repeated.
  if (!ok && tabBar.tabs.includes(tab) && tab.dirty) autoSavePending.add(tab);
}

/**
 * Before tabs are closed, replaced or the app quits: auto-save what it can,
 * then ask Save / Don't save / Cancel for the rest. True means "go ahead".
 */
async function settleUnsaved(tabs: Tab[], purpose: "close" | "quit" | "update"): Promise<boolean> {
  let dirty = tabs.filter((tab) => tab.dirty);
  if (settings.auto_save) {
    for (const tab of dirty) {
      if (!tab.path || tab.imageUrl || tab.loading) continue;
      autoSavePending.delete(tab);
      // Failures are reported here and the tab falls through to the question.
      await saveDoc(tab, { keepView: true });
    }
    dirty = dirty.filter((tab) => tabBar.tabs.includes(tab) && tab.dirty);
  }
  if (!dirty.length) return true;
  const name = dirty.map((tab) => baseName(tab.path)).join(", ");
  const body = purpose === "close" ? t("dialog.saveChangesBody", { name })
    : purpose === "quit" ? t("dialog.saveChangesQuit", { name })
      : t("update.unsavedInstall", { name });
  const choice = await askSaveChanges(body, dirty.length > 1 ? { saveLabel: t("dialog.saveAll") } : {});
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  for (const tab of dirty) {
    if (tabBar.tabs.includes(tab) && !(await saveBeforeClose(tab))) return false;
  }
  return true;
}

/** Save one tab for a close/quit; false (nothing discarded) on failure or cancelled Save As. */
async function saveBeforeClose(tab: Tab): Promise<boolean> {
  if (!tab.path) {
    // Save As works on the visible document, so show the untitled tab first.
    if (tab !== tabBar.active) tabBar.activate(tab.id);
    if (!(await saveAs())) return false;
  } else if (!(await saveDoc(tab, { keepView: true }))) {
    return false;
  }
  return !tab.dirty;
}

async function saveAs(): Promise<boolean> {
  const tab = tabBar.active;
  if (!tab || tab.imageUrl || tab.loading) return false;

  const dest = await save({
    defaultPath: tab.path ?? `${stem(tab.path)}.md`,
    filters: [{ name: "Documents / Code", extensions: knownExtensions() }],
  });
  if (!dest) return false;
  if (tabBar.active !== tab || !tabBar.tabs.includes(tab)) return false;

  const content = readView();
  const scrollTop = viewScrollTop();
  const wasCodeView = codeViewVisible;
  tab.path = dest;
  editor.setDocPath(dest);
  setViewVisibility(tab);
  if (wasCodeView !== codeViewVisible) {
    if (codeViewVisible) {
      void codeEditor.setDocument(content, dest, scrollTop);
    } else {
      writeView(content, scrollTop);
    }
  } else if (codeViewVisible) {
    void codeEditor.setLanguageForPath(dest);
  }
  const ok = await saveDoc(tab);
  if (ok) {
    tabBar.render();
    updateSourceButton();
    updateTitle();
    persistSoon();
    if (tab === tabBar.active) void workspace.setDocument(dest, tab.content);
    void workspace.refresh();
  }
  return ok;
}

async function closeActiveTab(): Promise<void> {
  const tab = tabBar.active;
  if (tab) await tabBar.onCloseRequest(tab);
}

// The tab menu stays available even when the tab strip is hidden or overflows.
const tabMenuEl = document.getElementById("tab-list-menu") as HTMLElement;
const tabListButton = document.getElementById("tab-list-button") as HTMLButtonElement;
const tabTooltip = document.getElementById("tab-tooltip") as HTMLElement;
const BOOKMARKED_TABS_KEY = "papernest.bookmarkedTabGroups";

interface BookmarkedTabs { id: number; paths: string[] }

function readBookmarkedTabs(): BookmarkedTabs[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BOOKMARKED_TABS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((group): group is BookmarkedTabs =>
      typeof group?.id === "number" && Array.isArray(group.paths) &&
      group.paths.every((path: unknown) => typeof path === "string"),
    ).slice(0, 20);
  } catch { return []; }
}

function writeBookmarkedTabs(groups: BookmarkedTabs[]): void {
  localStorage.setItem(BOOKMARKED_TABS_KEY, JSON.stringify(groups.slice(0, 20)));
}

function hideTabTooltip(): void { tabTooltip.hidden = true; }

function closeTabMenu(): void {
  tabMenuEl.hidden = true;
  tabListButton.setAttribute("aria-expanded", "false");
}

function menuDivider(): void {
  const divider = document.createElement("div");
  divider.className = "tab-menu-divider";
  divider.setAttribute("role", "separator");
  tabMenuEl.append(divider);
}

function menuItem(label: string, icon: string, action: () => void, disabled = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tab-menu-item";
  button.setAttribute("role", "menuitem");
  button.disabled = disabled;
  const glyph = document.createElement("span");
  glyph.className = "tab-menu-icon";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = icon;
  const name = document.createElement("span");
  name.className = "tab-menu-name";
  name.textContent = label;
  button.append(glyph, name);
  button.addEventListener("click", action);
  return button;
}

function renderTabMenu(): void {
  tabMenuEl.replaceChildren();
  tabMenuEl.append(menuItem(t(tabBar.isStacked ? "tab.unstack" : "tab.stack"), "▤", () => {
    tabBar.setStacked(!tabBar.isStacked);
    renderTabMenu();
    tabMenuEl.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }));
  const paths = tabBar.tabs.flatMap((tab) => tab.path ? [tab.path] : []);
  tabMenuEl.append(menuItem(t("tab.bookmarkAll", { count: String(paths.length) }), "☆", () => {
    try {
      writeBookmarkedTabs([{ id: Date.now(), paths }, ...readBookmarkedTabs()]);
      renderTabMenu();
      tabMenuEl.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    } catch (error) {
      void message(String(error), { title: "PaperNest", kind: "error" });
    }
  }, paths.length === 0));
  menuDivider();
  tabMenuEl.append(menuItem(t("tab.closeAll"), "×", () => {
    closeTabMenu();
    void (async () => {
      for (const tab of [...tabBar.tabs]) {
        if (!await tabBar.onCloseRequest(tab)) break;
      }
    })();
  }));
  menuDivider();
  for (const tab of tabBar.tabs) {
    const label = tab.startPage ? t("tab.new") : baseName(tab.path);
    const item = menuItem(label, tab.imageUrl ? "▧" : "▯", () => {
      tabBar.activate(tab.id);
      closeTabMenu();
    });
    item.title = tab.path ?? label;
    if (tab.dirty) item.querySelector(".tab-menu-name")?.prepend("• ");
    if (tab.id === tabBar.activeId) {
      const check = document.createElement("span");
      check.className = "tab-menu-check";
      check.textContent = "✓";
      item.append(check);
    }
    tabMenuEl.append(item);
  }
  const saved = readBookmarkedTabs();
  if (!saved.length) return;
  menuDivider();
  const heading = document.createElement("div");
  heading.className = "tab-menu-heading";
  heading.textContent = t("tab.bookmarked");
  tabMenuEl.append(heading);
  for (const group of saved) {
    const row = document.createElement("div");
    row.className = "tab-menu-group";
    const restore = menuItem(`${t("tab.restoreGroup", { count: String(group.paths.length) })} · ${new Date(group.id).toLocaleString()}`, "▣", () => {
      closeTabMenu();
      void (async () => { for (const path of group.paths) await openPath(path); })();
    });
    restore.title = group.paths.map(baseName).join("\n");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tab-menu-remove";
    remove.setAttribute("role", "menuitem");
    remove.title = t("tab.removeBookmark");
    remove.setAttribute("aria-label", t("tab.removeBookmark"));
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      writeBookmarkedTabs(readBookmarkedTabs().filter((item) => item.id !== group.id));
      renderTabMenu();
    });
    row.append(restore, remove);
    tabMenuEl.append(row);
  }
}

function wireTabChrome(): void {
  if (secondaryWindow) return;
  document.getElementById("new-tab-button")?.addEventListener("click", newTab);
  tabListButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!tabMenuEl.hidden) { closeTabMenu(); return; }
    hideTabTooltip();
    renderTabMenu();
    const bounds = tabListButton.getBoundingClientRect();
    tabMenuEl.style.right = `${Math.max(6, Math.round(window.innerWidth - bounds.right))}px`;
    tabMenuEl.style.top = `${Math.round(bounds.bottom + 4)}px`;
    tabMenuEl.hidden = false;
    tabListButton.setAttribute("aria-expanded", "true");
    tabMenuEl.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  });
  tabMenuEl.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const items = Array.from(tabMenuEl.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  });
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Node;
    if (!tabMenuEl.hidden && !tabMenuEl.contains(target) && !tabListButton.contains(target)) closeTabMenu();
  });
  window.addEventListener("resize", closeTabMenu);
  const tabs = document.getElementById("tabs") as HTMLElement;
  const showTooltip = (item: HTMLElement) => {
    const tab = tabBar.tabs.find((entry) => entry.id === item.dataset.tab);
    if (!tab) return;
    tabTooltip.textContent = tab.startPage ? t("tab.new") : baseName(tab.path);
    tabTooltip.hidden = false;
    const bounds = item.getBoundingClientRect();
    const left = bounds.left + bounds.width / 2 - tabTooltip.offsetWidth / 2;
    tabTooltip.style.left = `${Math.round(Math.max(8, Math.min(left, window.innerWidth - tabTooltip.offsetWidth - 8)))}px`;
    tabTooltip.style.top = `${Math.round(bounds.bottom + 7)}px`;
  };
  tabs.addEventListener("pointerover", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(".tab");
    if (item) showTooltip(item);
  });
  tabs.addEventListener("pointerout", (event) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !tabs.contains(next)) hideTabTooltip();
    else {
      const item = (next as HTMLElement).closest<HTMLElement>(".tab");
      if (item) showTooltip(item);
    }
  });
  tabs.addEventListener("focusin", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(".tab");
    if (item) showTooltip(item);
  });
  tabs.addEventListener("focusout", hideTabTooltip);
  tabs.addEventListener("scroll", hideTabTooltip);
  document.getElementById("start-create")?.addEventListener("click", createDocumentFromStartPage);
  document.getElementById("start-open")?.addEventListener("click", () => void openDialog());
  document.getElementById("start-close")?.addEventListener("click", () => void closeActiveTab());
}

// --- export ---------------------------------------------------------------

async function exportHtml(): Promise<void> {
  const tab = tabBar.active;
  if (tab?.imageUrl || tab?.loading) return;
  const dest = await save({
    defaultPath: `${stem(tab?.path ?? null)}.html`,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!dest) return;
  try {
    const html = await invoke<string>("render_html", {
      markdown: readView(),
      title: stem(tab?.path ?? null),
      docPath: tab?.path ?? null,
      forPrint: false,
    });
    await invoke("write_document", { path: dest, contents: html });
    await message(t("dialog.htmlExported"), { title: "PaperNest" });
  } catch (e) {
    await message(String(e), { title: "PaperNest", kind: "error" });
  }
}

async function exportPdf(): Promise<void> {
  const tab = tabBar.active;
  if (tab?.imageUrl || tab?.loading) return;
  try {
    const html = await invoke<string>("render_html", {
      markdown: readView(),
      title: stem(tab?.path ?? null),
      docPath: tab?.path ?? null,
      forPrint: true,
    });
    await printHtml(html);
  } catch (e) {
    await message(String(e), { title: "PaperNest", kind: "error" });
  }
}

// --- source view --------------------------------------------------------

const ICON_TO_SOURCE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>';
const ICON_TO_WYSIWYG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';

function updateSourceButton(): void {
  const btn = document.getElementById("btn-source") as HTMLButtonElement | null;
  if (!btn) return;
  const image = Boolean(tabBar.active?.imageUrl);
  const loading = Boolean(tabBar.active?.loading);
  for (const id of ["btn-save", "btn-save-as", "btn-export"]) {
    (document.getElementById(id) as HTMLButtonElement | null)?.toggleAttribute("disabled", image || loading);
  }
  const markdown = isMarkdownPath(tabBar.active?.path ?? null);
  btn.disabled = !markdown || loading;
  btn.innerHTML = markdown && sourceMode ? ICON_TO_WYSIWYG : ICON_TO_SOURCE;
  const label = markdown
    ? sourceMode
      ? t("toolbar.sourceBack.title")
      : t("toolbar.source.title")
    : t("toolbar.source.codeMode");
  const shortcut = settings?.shortcuts?.toggle_source;
  btn.setAttribute(
    "title",
    markdown && shortcut ? `${label} (${formatShortcut(shortcut)})` : label,
  );
}

function updateShortcutTitles(): void {
  if (!settings?.shortcuts) return;
  const newTabButton = document.getElementById("new-tab-button");
  if (newTabButton) newTabButton.title = `${t("tab.new")} (${formatShortcut(settings.shortcuts.new_tab)})`;
  const createButton = document.getElementById("start-create");
  if (createButton) createButton.textContent = `${t("start.create")} (${formatShortcut(settings.shortcuts.new_tab)})`;
  const openButton = document.getElementById("start-open");
  if (openButton) openButton.textContent = `${t("start.open")} (${formatShortcut(settings.shortcuts.open)})`;
  const saveBtn = document.getElementById("btn-save");
  if (saveBtn) {
    saveBtn.title = `${t("toolbar.save.aria")} (${formatShortcut(settings.shortcuts.save)})`;
  }
  const saveAsBtn = document.getElementById("btn-save-as");
  if (saveAsBtn) {
    saveAsBtn.title = `${t("toolbar.saveAs.aria")} (${formatShortcut(settings.shortcuts.save_as)})`;
  }
  const exportBtn = document.getElementById("btn-export");
  if (exportBtn) {
    exportBtn.title = `${t("toolbar.export.aria")} (${formatShortcut(settings.shortcuts.export)})`;
  }
  const settingsBtn = document.getElementById("btn-settings");
  if (settingsBtn) {
    settingsBtn.title = `${t("toolbar.settings.aria")} (${formatShortcut(
      settings.shortcuts.settings,
    )})`;
  }
  updateSourceButton();
}

function toggleSource(): void {
  const tab = tabBar.active;
  if (!tab || tab.loading || !isMarkdownPath(tab.path)) return;

  findBar.close();
  const md = readView();
  tab.content = md;
  const frac = viewScrollFraction(); // reading position in the outgoing view

  sourceMode = !sourceMode;
  setViewVisibility(tab);

  writeView(md);
  adoptNormalized(tab);
  tab.dirty = tab.content !== tab.saved;
  tabBar.refreshDirty();
  updateSourceButton();
  updateTitle();
  scheduleTextStats(true);
  if (codeViewVisible) codeEditor.focus();
  else editor.focus(true);
  applyScrollFraction(frac);
}

editorHost.addEventListener(IMAGE_SOURCE_EVENT, () => toggleSource());

// --- find / replace -----------------------------------------------------

const editorFindTarget: FindTarget = {
  selectionText: () => editor.selectionText(),
  setQuery: (q, cs) => editor.findSet(q, cs),
  step: (dir) => editor.findStep(dir),
  replace: (r) => editor.findReplace(r),
  replaceAll: (r) => editor.findReplaceAll(r),
  clear: () => editor.findClear(),
  focusView: () => editor.focus(),
};

const sourceFindTarget: FindTarget = {
  selectionText: () => codeEditor.selectionText(),
  setQuery: (q, cs) => codeEditor.findSet(q, cs),
  step: (dir) => codeEditor.findStep(dir),
  replace: (r) => codeEditor.findReplace(r),
  replaceAll: (r) => codeEditor.findReplaceAll(r),
  clear: () => codeEditor.findClear(),
  focusView: () => codeEditor.focus(),
};

function openFind(withReplace: boolean, selectedText?: string): void {
  findBar.bind(() => (codeViewVisible ? sourceFindTarget : editorFindTarget));
  findBar.open(withReplace, selectedText);
}

editor.onFindRequest = codeEditor.onFindRequest = text => openFind(false, text);
editor.getFindShortcut = codeEditor.getFindShortcut = () => formatShortcut(settings.shortcuts.find);

// --- about panel --------------------------------------------------------

const aboutEl = document.getElementById("about") as HTMLElement;
const updateDot = document.getElementById("update-dot") as HTMLElement;
const updateCheckButton = document.getElementById(
  "about-check-update",
) as HTMLButtonElement;
const updateStatusEl = document.getElementById(
  "about-update-status",
) as HTMLElement;
const updateNotesEl = document.getElementById(
  "about-update-notes",
) as HTMLElement;
const updateProgressEl = document.getElementById(
  "about-update-progress",
) as HTMLElement;
const updateProgressBar = document.getElementById(
  "about-update-progress-bar",
) as HTMLElement;
const updateProgressText = document.getElementById(
  "about-update-progress-text",
) as HTMLElement;
const updateActionsEl = document.getElementById(
  "about-update-actions",
) as HTMLElement;
const updateSecondaryButton = document.getElementById(
  "about-update-secondary",
) as HTMLButtonElement;
const updatePrimaryButton = document.getElementById(
  "about-update-primary-action",
) as HTMLButtonElement;
let versionInfo: VersionInfo | null = null;
let versionError: string | null = null;
let preparedVersion: PreparedVersion | null = null;
let versionBusy = false;
let versionCheckTask: Promise<void> | null = null;
let updatePrimaryAction: (() => void | Promise<void>) | null = null;
let updateSecondaryAction: (() => void | Promise<void>) | null = null;

function openAbout(): void {
  findBar.close();
  renderVersionInfo();
  aboutEl.hidden = false;
  activateModal(aboutEl, closeAbout);
}

function closeAbout(): void {
  aboutEl.hidden = true;
  deactivateModal(aboutEl);
}

function setUpdateActions(
  secondary: { label: string; action: (() => void | Promise<void>) | null } | null,
  primary: { label: string; action: (() => void | Promise<void>) | null } | null,
): void {
  updateSecondaryAction = secondary?.action ?? null;
  updatePrimaryAction = primary?.action ?? null;
  updateSecondaryButton.hidden = !secondary;
  updatePrimaryButton.hidden = !primary;
  if (secondary) updateSecondaryButton.textContent = secondary.label;
  if (primary) updatePrimaryButton.textContent = primary.label;
  updateActionsEl.hidden = !secondary && !primary;
}

function setUpdateProgress(downloaded = 0, total = 0): void {
  const ratio = total > 0 ? Math.min(1, downloaded / total) : 0;
  const percent = Math.round(ratio * 100);
  updateProgressEl.hidden = total <= 0;
  updateProgressBar.style.width = `${percent}%`;
  updateProgressText.textContent = `${percent}%`;
}

function renderVersionInfo(): void {
  updateCheckButton.disabled = versionBusy;
  updateCheckButton.textContent = versionBusy ? t("update.checking") : t("update.check");

  if (versionError) {
    updateDot.hidden = true;
    updateStatusEl.hidden = false;
    updateStatusEl.textContent = t("update.failed", { err: versionError });
    updateNotesEl.hidden = true;
    setUpdateActions(null, null);
    return;
  }

  if (!versionInfo) {
    updateStatusEl.hidden = true;
    updateNotesEl.hidden = true;
    setUpdateActions(null, null);
    return;
  }

  if (preparedVersion) {
    updateDot.hidden = false;
    updateStatusEl.hidden = false;
    updateNotesEl.hidden = true;
    updateStatusEl.textContent =
      preparedVersion.mode === "portable"
        ? t("update.downloadedPortable", { version: preparedVersion.version })
        : t("update.downloadedInstalled", { version: preparedVersion.version });
    if (preparedVersion.mode === "portable") {
      setUpdateActions(
        {
          label: t("update.openFolder"),
          action: () =>
            invoke("show_prepared_version", { version: preparedVersion!.version }),
        },
        { label: t("update.openNew"), action: usePreparedVersion },
      );
    } else {
      setUpdateActions(
        {
          label: t("update.releasePage"),
          action: () => openUrl(versionInfo!.releaseUrl),
        },
        { label: t("update.install"), action: usePreparedVersion },
      );
    }
    return;
  }

  if (!versionInfo.updateAvailable) {
    updateDot.hidden = true;
    updateStatusEl.hidden = false;
    updateStatusEl.textContent = t("update.latest");
    updateNotesEl.hidden = true;
    setUpdateActions(null, null);
    return;
  }

  updateDot.hidden = false;
  updateStatusEl.hidden = false;
  updateStatusEl.textContent = t("update.available", {
    version: versionInfo.latestVersion,
  });
  updateNotesEl.textContent = versionInfo.notes.trim();
  updateNotesEl.hidden = !versionInfo.notes.trim();

  if (!versionInfo.canDownload || versionInfo.mode === "unsupported") {
    setUpdateActions(
      {
        label: t("update.releasePage"),
        action: () => openUrl(versionInfo!.releaseUrl),
      },
      null,
    );
    if (!versionInfo.canDownload) {
      updateStatusEl.textContent += ` ${t("update.assetPending")}`;
    }
    return;
  }

  setUpdateActions(
    {
      label: t("update.releasePage"),
      action: () => openUrl(versionInfo!.releaseUrl),
    },
    {
      label:
        versionInfo.mode === "portable"
          ? t("update.downloadPortable")
          : t("update.downloadInstalled"),
      action: prepareLatestVersion,
    },
  );
}

async function checkVersion(): Promise<void> {
  // A manual check joins an automatic check already in progress, so the
  // settings panel receives its result rather than stale version information.
  if (versionCheckTask) return versionCheckTask;
  if (versionBusy) return;
  versionCheckTask = runVersionCheck();
  try {
    await versionCheckTask;
  } finally {
    versionCheckTask = null;
  }
}

async function runVersionCheck(): Promise<void> {
  versionBusy = true;
  versionError = null;
  preparedVersion = null;
  setUpdateProgress();
  renderVersionInfo();
  settings.last_update_check = Math.floor(Date.now() / 1000);
  persistSoon();
  try {
    versionInfo = await invoke<VersionInfo>("check_for_update", {
      proxyEnabled: settings.proxy_enabled,
      proxyUrl: settings.proxy_url,
    });
    renderVersionInfo();
  } catch (err) {
    versionInfo = null;
    versionError = String(err);
  } finally {
    versionBusy = false;
    renderVersionInfo();
  }
}

async function usePreparedVersion(): Promise<void> {
  if (!preparedVersion) return;
  markDirtyFromView();
  if (!(await settleUnsaved(tabBar.tabs, "update"))) return;
  cancelAutoSave();

  await captureGeometry();
  await flushSettings();
  await invoke("use_prepared_version", { version: preparedVersion.version });
  await win.destroy();
}

async function prepareLatestVersion(): Promise<void> {
  if (!versionInfo?.updateAvailable || !versionInfo.canDownload || versionBusy) {
    return;
  }

  versionBusy = true;
  updateCheckButton.disabled = true;
  updateStatusEl.hidden = false;
  updateStatusEl.textContent = t("update.downloading");
  updateNotesEl.hidden = true;
  setUpdateActions(null, null);
  const initialTotal = versionInfo.assetSize ?? 0;
  setUpdateProgress(0, initialTotal);

  try {
    preparedVersion = await invoke<PreparedVersion>("prepare_new_version", {
      expectedVersion: versionInfo.latestVersion,
      proxyEnabled: settings.proxy_enabled,
      proxyUrl: settings.proxy_url,
    });
    setUpdateProgress();
    updateStatusEl.textContent =
      preparedVersion.mode === "portable"
        ? t("update.downloadedPortable", { version: preparedVersion.version })
        : t("update.downloadedInstalled", { version: preparedVersion.version });

    if (preparedVersion.mode === "portable") {
      setUpdateActions(
        {
          label: t("update.openFolder"),
          action: () =>
            invoke("show_prepared_version", { version: preparedVersion!.version }),
        },
        {
          label: t("update.openNew"),
          action: usePreparedVersion,
        },
      );
    } else {
      setUpdateActions(
        {
          label: t("update.releasePage"),
          action: () => openUrl(versionInfo!.releaseUrl),
        },
        {
          label: t("update.install"),
          action: usePreparedVersion,
        },
      );
    }
  } catch (err) {
    preparedVersion = null;
    setUpdateProgress();
    updateStatusEl.textContent = t("update.failed", { err: String(err) });
    updateNotesEl.hidden = true;
    setUpdateActions(
      versionInfo
        ? {
            label: t("update.releasePage"),
            action: () => openUrl(versionInfo!.releaseUrl),
          }
        : null,
      null,
    );
  } finally {
    versionBusy = false;
    updateCheckButton.disabled = false;
    updateCheckButton.textContent = t("update.check");
  }
}

function maybeCheckVersionInBackground(): void {
  if (!settings.auto_check_updates) return;
  const now = Math.floor(Date.now() / 1000);
  const last = Number(settings.last_update_check) || 0;
  if (now - last < 24 * 60 * 60) return;
  void checkVersion();
}

function wireAbout(): void {
  document.getElementById("btn-about")?.addEventListener("click", openAbout);
  updateCheckButton.addEventListener("click", () => void checkVersion());
  updatePrimaryButton.addEventListener("click", () => {
    if (updatePrimaryAction) void updatePrimaryAction();
  });
  updateSecondaryButton.addEventListener("click", () => {
    if (updateSecondaryAction) void updateSecondaryAction();
  });
  aboutEl.querySelector(".about-close")?.addEventListener("click", closeAbout);
  aboutEl.addEventListener("click", (e) => {
    if (e.target === aboutEl) closeAbout(); // click on the backdrop
  });
  document.getElementById("about-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    void openUrl("https://github.com/baihejiangnan/PaperNest");
  });
  document.getElementById("about-upstream-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    void openUrl("https://github.com/zakee039/MDmeow");
  });
}

// --- export menu -------------------------------------------------------

const exportMenuEl = document.getElementById("export-menu") as HTMLElement;

function closeExportMenu(): void {
  exportMenuEl.hidden = true;
  document.getElementById("btn-export")?.setAttribute("aria-expanded", "false");
}

function toggleExportMenu(): void {
  const btn = document.getElementById("btn-export");
  if (!btn) return;
  if (!exportMenuEl.hidden) {
    closeExportMenu();
    return;
  }
  const r = btn.getBoundingClientRect();
  exportMenuEl.hidden = false;
  const menuWidth = exportMenuEl.offsetWidth;
  const menuHeight = exportMenuEl.offsetHeight;
  exportMenuEl.style.left = `${Math.round(Math.max(8, Math.min(r.right - menuWidth, window.innerWidth - menuWidth - 8)))}px`;
  exportMenuEl.style.top = `${Math.round(Math.max(8, Math.min(r.bottom + 4, window.innerHeight - menuHeight - 8)))}px`;
  btn.setAttribute("aria-expanded", "true");
}

function wireExportMenu(): void {
  const btn = document.getElementById("btn-export");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleExportMenu();
  });
  exportMenuEl.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>("button[data-act]")
      ?.dataset.act;
    closeExportMenu();
    if (act === "html") void exportHtml();
    else if (act === "pdf") void exportPdf();
  });
  document.addEventListener("pointerdown", (e) => {
    if (exportMenuEl.hidden) return;
    const t = e.target as HTMLElement;
    if (!exportMenuEl.contains(t) && !t.closest("#btn-export")) closeExportMenu();
  });
  window.addEventListener("resize", closeExportMenu);
}

// --- wiring --------------------------------------------------------------

function wireShortcuts(): void {
  window.addEventListener(
    "keydown",
    (e) => {
      // Let the focused shortcut control capture the key before app shortcuts
      // (this listener runs in capture phase on window).
      if (settingsPanel.isCapturingShortcut) return;
      if (hasActiveModal()) return;
      if (!(document.getElementById("workspace-prompt") as HTMLElement).hidden) return;
      if (secondaryWindow && [settings.shortcuts.open, settings.shortcuts.new_tab, settings.shortcuts.close_tab]
        .some((shortcut) => matchesShortcut(e, shortcut))) {
        e.preventDefault();
        return;
      }

      if (e.key === "Escape" && !exportMenuEl.hidden) {
        e.preventDefault();
        e.stopPropagation();
        closeExportMenu();
        return;
      }
      if (e.key === "Escape" && !tabMenuEl.hidden) {
        e.preventDefault();
        e.stopPropagation();
        closeTabMenu();
        tabListButton.focus();
        return;
      }

      // Esc-to-quit (opt-in). Runs after the block menu's own Esc handler,
      // which stops propagation while it is open.
      if (
        e.key === "Escape" &&
        !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      ) {
        if (settingsPanel.isOpen) {
          e.preventDefault();
          settingsPanel.close();
          return;
        }
        if (emojiPicker.isOpen) {
          e.preventDefault();
          emojiPicker.close();
          return;
        }
        if (!aboutEl.hidden) {
          e.preventDefault();
          closeAbout();
          return;
        }
        if (findBar.isOpen) {
          e.preventDefault();
          findBar.close();
          return;
        }
        if (dismissPreviewNotice()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (settings.quit_on_escape) {
          e.preventDefault();
          void quitApp();
          return;
        }
      }

      if (matchesShortcut(e, settings.shortcuts.save)) {
        e.preventDefault();
        void saveDoc();
      } else if (matchesShortcut(e, settings.shortcuts.save_as)) {
        e.preventDefault();
        void saveAs();
      } else if (matchesShortcut(e, settings.shortcuts.open)) {
        e.preventDefault();
        void openDialog();
      } else if (matchesShortcut(e, settings.shortcuts.new_tab)) {
        e.preventDefault();
        if (tabBar.active?.startPage) createDocumentFromStartPage();
        else newTab();
      } else if (matchesShortcut(e, settings.shortcuts.close_tab)) {
        e.preventDefault();
        void closeActiveTab();
      } else if (matchesShortcut(e, settings.shortcuts.export)) {
        e.preventDefault();
        toggleExportMenu();
      } else if (matchesShortcut(e, settings.shortcuts.toggle_source)) {
        e.preventDefault();
        toggleSource();
      } else if (matchesShortcut(e, settings.shortcuts.find)) {
        e.preventDefault();
        openFind(false);
      } else if (matchesShortcut(e, settings.shortcuts.replace)) {
        e.preventDefault();
        openFind(true);
      } else if (matchesShortcut(e, settings.shortcuts.emoji)) {
        e.preventDefault();
        emojiPicker.open(codeViewVisible ? null : editor.caretRect());
      } else if (matchesShortcut(e, settings.shortcuts.settings)) {
        e.preventDefault();
        if (settingsPanel.isOpen) settingsPanel.close();
        else settingsPanel.open();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey && !e.altKey &&
        e.key >= "0" && e.key <= "7" && e.key.length === 1
      ) {
        // Ctrl+0..7 → block type, mirroring the ⠿ menu (WYSIWYG only).
        if (codeViewVisible) return;
        e.preventDefault();
        const ids: BlockActionId[] = [
          "text", "h1", "h2", "h3", "bullet", "ordered", "quote", "code",
        ];
        editor.runBlockAction(ids[Number(e.key)]);
      }
    },
    { capture: true },
  );
}

function wireButtons(): void {
  document.getElementById("nav-back")?.addEventListener("click", () => void navigateHistory(-1));
  document.getElementById("nav-forward")?.addEventListener("click", () => void navigateHistory(1));
  document.getElementById("btn-save")?.addEventListener("click", () => void saveDoc());
  document.getElementById("btn-save-as")?.addEventListener("click", () => void saveAs());
  titleEl.addEventListener("pointerdown", (e) => e.stopPropagation());
  titleEl.addEventListener("click", beginTitleRename);
  titleInput.addEventListener("pointerdown", (e) => e.stopPropagation());
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitTitleRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelTitleRename();
      (codeViewVisible ? codeEditor : editor).focus();
    }
  });
  titleInput.addEventListener("blur", () => {
    if (!titleInput.hidden) void commitTitleRename();
  });
  document.getElementById("btn-source")?.addEventListener("click", () => toggleSource());
  document.getElementById("btn-settings")?.addEventListener("click", () => {
    if (settingsPanel.isOpen) settingsPanel.close();
    else settingsPanel.open();
  });
}

/** Immediately write settings, cancelling any pending debounced write. */
async function flushSettings(): Promise<void> {
  if (secondaryWindow) return;
  window.clearTimeout(persistTimer);
  try {
    await invoke("save_settings", { settings });
  } catch {
    /* nothing we can do on the way out */
  }
}

const WINDOW_GEOMETRY_VERSION = 2;
const GEOMETRY_CAPTURE_DELAY_MS = 180;
let geometryCaptureTimer: number | undefined;

/** Snapshot the current geometry.
 *
 * Position uses physical outer-frame pixels to avoid mixed-DPI drift between
 * monitors. Size stays logical so its perceived size remains stable. */
async function captureGeometry(): Promise<void> {
  if (secondaryWindow) return;
  if (!settings.remember_window_position) return;
  let minimized = false;
  try {
    minimized = await win.isMinimized();
  } catch {
    /* permission absent -> assume not minimized */
  }
  if (minimized) return;

  const maximized = await win.isMaximized();
  settings.window.maximized = maximized;
  if (maximized) return; // keep the last un-maximized size/pos to restore to

  const [pos, size, scaleFactor] = await Promise.all([
    win.outerPosition(),
    win.innerSize(),
    win.scaleFactor(),
  ]);
  const logicalSize = size.toLogical(scaleFactor || 1);
  if (onScreenish(pos.x, pos.y)) {
    settings.window.x = Math.round(pos.x);
    settings.window.y = Math.round(pos.y);
    settings.window.geometry_version = WINDOW_GEOMETRY_VERSION;
  }
  settings.window.width = Math.round(logicalSize.width);
  settings.window.height = Math.round(logicalSize.height);
}

function scheduleGeometryCapture(): void {
  if (!settings.remember_window_position) return;
  window.clearTimeout(geometryCaptureTimer);
  geometryCaptureTimer = window.setTimeout(() => {
    void captureGeometry().then(() => persistSoon());
  }, GEOMETRY_CAPTURE_DELAY_MS);
}

let closing = false;

async function updateMaximizeButton(): Promise<void> {
  const button = document.getElementById("window-maximize") as HTMLButtonElement;
  const maximized = await win.isMaximized();
  button.classList.toggle("maximized", maximized);
  const label = t(maximized ? "toolbar.restoreWindow" : "toolbar.maximize");
  button.title = label;
  button.setAttribute("aria-label", label);
}

function wireWindowControls(): void {
  document.getElementById("window-minimize")?.addEventListener("click", () => void win.minimize());
  document.getElementById("window-maximize")?.addEventListener("click", () => {
    void win.toggleMaximize().then(updateMaximizeButton);
  });
  document.getElementById("window-close")?.addEventListener("click", () => void quitApp());
  document.getElementById("titlebar")?.addEventListener("dblclick", (event) => {
    if (event.target === event.currentTarget || event.target === document.getElementById("tabs")) {
      void win.toggleMaximize().then(updateMaximizeButton);
    }
  });
  void updateMaximizeButton();
}

/** Save geometry + settings and close, asking about unsaved changes first. */
async function quitApp(): Promise<void> {
  if (closing) return;
  closing = true;
  markDirtyFromView();
  if (!(await settleUnsaved(tabBar.tabs, "quit"))) {
    closing = false;
    return;
  }
  cancelAutoSave();
  window.clearTimeout(geometryCaptureTimer);
  if (!secondaryWindow) {
    try {
      await captureGeometry();
    } catch (e) {
      console.error("cannot capture window geometry", e); // still quit
    }
    await flushSettings();
  }
  try {
    await win.destroy();
  } finally {
    closing = false; // if destroy failed the window is still open; allow a retry
  }
}

async function wireWindowState(): Promise<void> {
  await win.onResized(() => { scheduleGeometryCapture(); void updateMaximizeButton(); });
  await win.onMoved(() => scheduleGeometryCapture());

  await win.onCloseRequested(async (event) => {
    event.preventDefault();
    await quitApp();
  });
}

/** Reject Windows sentinel / corrupt values while still allowing large and
 * negative multi-monitor desktop coordinates. */
function onScreenish(x: number, y: number): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) < 1_000_000 &&
    Math.abs(y) < 1_000_000
  );
}

function originIsSafeForMonitor(
  x: number,
  y: number,
  monitor: NonNullable<Awaited<ReturnType<typeof primaryMonitor>>>,
): boolean {
  const area = monitor.workArea;
  const left = area.position.x;
  const top = area.position.y;
  const right = left + area.size.width;
  const bottom = top + area.size.height;

  // The title bar must remain safely reachable. If not, the saved position is
  // considered invalid and we fall back to the primary-screen center.
  return x >= left && y >= top && x <= right - 120 && y <= bottom - 48;
}

async function monitorForSavedWindow(w: WindowState) {
  if (
    w.geometry_version !== WINDOW_GEOMETRY_VERSION ||
    w.x === null ||
    w.y === null ||
    !onScreenish(w.x, w.y)
  ) {
    return null;
  }
  try {
    const monitors = await availableMonitors();
    return (
      monitors.find((monitor) => originIsSafeForMonitor(w.x!, w.y!, monitor)) ??
      null
    );
  } catch {
    return null;
  }
}

function fitLogicalSizeToMonitor(
  width: number,
  height: number,
  monitor: NonNullable<Awaited<ReturnType<typeof primaryMonitor>>>,
): { width: number; height: number } {
  const sf = monitor.scaleFactor || 1;
  const maxWidth = Math.max(480, Math.floor((monitor.workArea.size.width - 40) / sf));
  const maxHeight = Math.max(360, Math.floor((monitor.workArea.size.height - 40) / sf));
  return {
    width: Math.min(Math.max(480, width), maxWidth),
    height: Math.min(Math.max(360, height), maxHeight),
  };
}

async function ensureTitleBarVisible(): Promise<void> {
  try {
    const [pos, monitors] = await Promise.all([
      win.outerPosition(),
      availableMonitors(),
    ]);
    if (monitors.some((monitor) => originIsSafeForMonitor(pos.x, pos.y, monitor))) {
      return;
    }

    const [size, sf] = await Promise.all([win.innerSize(), win.scaleFactor()]);
    const logical = size.toLogical(sf || 1);
    await centerOnPrimary(logical.width, logical.height);
  } catch {
    await centerOnPrimary(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
  }
}

async function centerActualWindowOnPrimary(): Promise<void> {
  try {
    const monitor = await primaryMonitor();
    if (!monitor) {
      await win.center();
      return;
    }

    const outer = await win.outerSize();
    const area = monitor.workArea;
    const x =
      area.position.x + Math.max(0, Math.round((area.size.width - outer.width) / 2));
    const y =
      area.position.y + Math.max(0, Math.round((area.size.height - outer.height) / 2));
    await win.setPosition(new PhysicalPosition(x, y));
  } catch {
    try {
      await win.center();
    } catch {
      /* centering is cosmetic; keeping the window visible is preferable */
    }
  }
}

async function centerOnPrimary(width: number, height: number): Promise<void> {
  try {
    const monitor = await primaryMonitor();
    if (monitor) {
      const fitted = fitLogicalSizeToMonitor(width, height, monitor);
      const [oldOuter, oldInner] = await Promise.all([
        win.outerSize(),
        win.innerSize(),
      ]);
      const sf = monitor.scaleFactor || 1;
      const frameWidth = Math.max(0, oldOuter.width - oldInner.width);
      const frameHeight = Math.max(0, oldOuter.height - oldInner.height);
      const targetOuterWidth = Math.round(fitted.width * sf) + frameWidth;
      const targetOuterHeight = Math.round(fitted.height * sf) + frameHeight;
      const area = monitor.workArea;
      const x =
        area.position.x + Math.max(0, Math.round((area.size.width - targetOuterWidth) / 2));
      const y =
        area.position.y + Math.max(0, Math.round((area.size.height - targetOuterHeight) / 2));

      await win.setSize(new LogicalSize(fitted.width, fitted.height));
      await win.setPosition(new PhysicalPosition(x, y));
      return;
    }
  } catch {
    /* fall through to Tauri's native centering */
  }
  try {
    await win.center();
  } catch {
    /* centering is cosmetic; showing the window is still preferable */
  }
}

async function restoreWindow(): Promise<void> {
  const w = settings.window;
  await win.unmaximize();

  if (settings.remember_window_position) {
    const width = w.width > 200 ? w.width : DEFAULT_WINDOW_WIDTH;
    const height = w.height > 150 ? w.height : DEFAULT_WINDOW_HEIGHT;
    const monitor = await monitorForSavedWindow(w);

    if (monitor) {
      const fitted = fitLogicalSizeToMonitor(width, height, monitor);
      await win.setSize(new LogicalSize(fitted.width, fitted.height));
      await win.setPosition(
        new PhysicalPosition(Math.round(w.x!), Math.round(w.y!)),
      );

      const actual = await win.outerPosition();
      if (!originIsSafeForMonitor(actual.x, actual.y, monitor)) {
        await centerOnPrimary(fitted.width, fitted.height);
      }
    } else {
      await centerOnPrimary(width, height);
    }
    if (w.maximized) await win.maximize();
  } else {
    await centerOnPrimary(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
  }
  await win.show();
  if (!(await win.isMaximized())) {
    if (settings.remember_window_position) {
      await ensureTitleBarVisible();
    } else {
      // On Windows/WebView2, a hidden resize can settle after setSize()
      // resolves. Recenter once more after show using the real outer frame so
      // mixed-DPI systems never calculate the center from a stale size.
      await centerActualWindowOnPrimary();
    }
  }
  try {
    await win.setFocus();
  } catch {
    /* permission may be absent; not critical */
  }
}

async function restoreTabs(): Promise<void> {
  if (secondaryWindow) { tabBar.add(null, ""); return; }
  if (settings.open_last_session === false) {
    tabBar.add(null, "", true, null, true);
    return;
  }

  const files = settings.open_files ?? [];
  // Capture the saved index before add() persists a partially restored session.
  const savedActiveIndex = settings.active_tab ?? 0;
  const restored: Array<{ sourceIndex: number; tabId: string }> = [];
  for (const [sourceIndex, path] of files.entries()) {
    if (!path) continue;
    try {
      const tab = isImagePath(path)
        ? tabBar.add(path, "", false, await invoke<string>("read_image_data_url", { docPath: null, src: path }))
        : tabBar.add(path, await invoke<string>("read_document", { path }), false);
      restored.push({ sourceIndex, tabId: tab.id });
    } catch {
      // An unreadable file should not prevent the other session tabs opening.
    }
  }
  if (!restored.length) {
    tabBar.add(null, "", true, null, true);
    return;
  }
  const active = restored.find((item) => item.sourceIndex === savedActiveIndex) ?? restored[0];
  tabBar.activate(active.tabId);
}

async function bootstrap(): Promise<void> {
  const payload = await invoke<SettingsPayload>("get_settings");
  settings = payload.settings;
  workspace.setMarkdownOnly(settings.markdown_only !== false);
  workspace.setWidth(settings.sidebar_width ?? 0);
  settings.shortcuts = withDefaultShortcuts(settings.shortcuts);
  if (!isListMarker(settings.list_marker)) settings.list_marker = "-";
  settings.auto_save = settings.auto_save === true;

  setLang(settings.language ?? "system");
  applyStaticI18n();
  settingsPanel.setPath(payload.location);
  settingsPanel.setVersion(payload.version);
  settingsPanel.refresh();
  applyAppearance();
  installEditorRendering();
  editor.setListMarker(settings.list_marker);
  applyProxySettings(false);
  tabBar.setAlwaysShow(settings.always_show_tabbar);

  // React to hand edits of settings.toml (the file watcher emits this).
  void listen<Settings>("settings-changed", (e) => {
    const ext = e.payload;
    settings.language = ext.language ?? "system";
    settings.spellcheck = ext.spellcheck;
    settings.quit_on_escape = ext.quit_on_escape;
    settings.show_path = ext.show_path;
    settings.open_last_session = ext.open_last_session;
    settings.always_show_tabbar = ext.always_show_tabbar;
    settings.markdown_only = ext.markdown_only !== false;
    workspace.setMarkdownOnly(settings.markdown_only);
    settings.sidebar_width = ext.sidebar_width ?? 0;
    workspace.setWidth(settings.sidebar_width);
    tabBar.setAlwaysShow(ext.always_show_tabbar);
    settings.editor_font = ext.editor_font;
    settings.editor_font_size = ext.editor_font_size;
    settings.source_font = ext.source_font;
    settings.source_font_size = ext.source_font_size;
    settings.code_alternate_rows = ext.code_alternate_rows;
    settings.code_alternate_row_color = ext.code_alternate_row_color;
    settings.remember_window_position = ext.remember_window_position;
    settings.file_associations = ext.file_associations;
    if (!secondaryWindow && ext.windows_new_md !== settings.windows_new_md) {
      void applyNewMdMenu(ext.windows_new_md === true).catch(reportNewMdMenuError);
    }
    settings.accent = ext.accent;
    settings.color_scheme = ext.color_scheme;
    settings.confirm_delete = ext.confirm_delete;
    settings.auto_save = ext.auto_save === true;
    if (!settings.auto_save) cancelAutoSave();
    settings.proxy_enabled = ext.proxy_enabled;
    settings.proxy_url = ext.proxy_url;
    settings.auto_check_updates = ext.auto_check_updates;
    settings.last_update_check = ext.last_update_check;
    settings.shortcuts = withDefaultShortcuts(ext.shortcuts);
    settings.open_with_prompt_dismissed = ext.open_with_prompt_dismissed;
    applyLanguage(settings.language); // no-op if unchanged
    applyAppearance();
    codeEditor.setAlternateRows(settings.code_alternate_rows);
    applyProxySettings(true);
    updateShortcutTitles();
    editor.setSpellcheck(settings.spellcheck);
    updateTitle();
    settingsPanel.refresh();

    if (isListMarker(ext.list_marker) && ext.list_marker !== settings.list_marker) {
      settings.list_marker = ext.list_marker;
      editor.setListMarker(ext.list_marker);
      if (!codeViewVisible) {
        switching = true;
        void editor.reload().then(() => {
          editor.setSpellcheck(settings.spellcheck);
          switching = false;
          markDirtyFromView();
        });
      }
    }
  });

  const aboutVersion = document.getElementById("about-version");
  if (aboutVersion) aboutVersion.textContent = `v${payload.version}`;
  const aboutPath = document.getElementById("about-settings-path");
  if (aboutPath) aboutPath.textContent = payload.location;

  if (payload.fallback) {
    const hint = document.getElementById("settings-hint") as HTMLElement;
    hint.textContent = t("dialog.readonlyHint", { path: payload.location });
    hint.hidden = false;
  }

  await editor.init("");

  // Show the window early so a slow or failing later step can never leave it
  // stuck hidden in the taskbar.
  if (secondaryWindow) await win.show();
  else await restoreWindow();

  void listen<NewMdMenuStatus>("new-md-menu-changed", event => {
    newMdMenuStatus = event.payload;
    settings.windows_new_md = event.payload.enabled;
    settingsPanel.setNewMdMenuStatus(event.payload);
  });
  if (!secondaryWindow && settings.windows_new_md) {
    try { await applyNewMdMenu(true); }
    catch (error) { reportNewMdMenuError(error); }
  } else {
    await refreshNewMdMenu().catch(reportNewMdMenuError);
  }

  await restoreTabs();

  // A file passed on the command line (double-click / "Open with").
  if (secondaryWindow) {
    if (workspaceLaunch?.kind === "workspace_file") await openPath(workspaceLaunch.path);
  } else if (payload.open_with) await openPath(payload.open_with);

  // Further "open with" launches are routed here by the single-instance plugin.
  if (!secondaryWindow) void listen<string>("open-file", async (e) => {
    await openPath(e.payload);
    try {
      await win.unminimize();
      await win.setFocus();
    } catch {
      /* not critical */
    }
  });

  wireButtons();
  wireTabChrome();
  wireWindowControls();
  wireAbout();
  void listen<VersionTransferProgress>("update-download-progress", (event) => {
    if (!versionBusy) return;
    setUpdateProgress(event.payload.downloaded, event.payload.total);
  });
  wireExportMenu();
  if (!secondaryWindow) await wireFileDrop();
  updateSourceButton();
  updateShortcutTitles();
  wireShortcuts();
  await wireWindowState();

  // Do not block first paint on registry inspection. The lightweight Windows
  // Open With check runs only after the main window and editor are ready.
  if (!secondaryWindow) {
    void initializeOpenWithIntegration();
    maybeCheckVersionInBackground();
  }

  // settings.toml could not be used, so defaults are active and the next save
  // replaces it; Rust copied the original aside first.
  if (!secondaryWindow && payload.load_error) {
    const { error, backup } = payload.load_error;
    void message(
      backup
        ? t("dialog.settingsInvalid", { error, backup })
        : t("dialog.settingsInvalidNoBackup", { error }),
      { title: "PaperNest", kind: "warning" },
    );
  }
}

bootstrap().catch(async (e) => {
  try {
    await win.show();
    await win.setFocus();
  } catch {
    /* ignore */
  }
  await message(t("dialog.startupFailed", { err: String(e) }), {
    title: "PaperNest",
    kind: "error",
  });
});
