import { invoke } from "@tauri-apps/api/core";
import { confirmDialog, message } from "./dialogs";
import { isImagePath, isMarkdownPath } from "./file-types";
import { activateModal, deactivateModal } from "./modal";
import { t } from "./i18n";

interface Entry { name: string; path: string; is_dir: boolean }
interface Directory { path: string; parent: string | null; entries: Entry[] }
interface DeleteInfo {
  is_dir: boolean; file_count: number; file_count_complete: boolean;
  backlink_count: number; backlink_file_count: number;
  backlinks: Array<{ path: string; name: string; count: number }>;
  scan_complete: boolean;
}
type Label = keyof typeof EN;

const EN = {
  files: "Files", outline: "Outline", parent: "Parent folder", search: "Search files",
  reveal: "Show current document", setRoot: "Show as root folder", path: "Folder path",
  newWindow: "Open in new window", newTab: "Open in new tab", newFile: "New file",
  newFolder: "New folder", duplicate: "Create copy", copyRelative: "Copy relative path",
  copyAbsolute: "Copy absolute path", location: "Open in File Explorer",
  rename: "Rename", delete: "Delete", cancel: "Cancel", ok: "OK",
  fileName: "New file name", folderName: "New folder name", renameTo: "New name",
  empty: "This folder is empty", noHeadings: "No headings in the current Markdown file",
  noResults: "No matching files", searchPlaceholder: "Search this folder and subfolders",
  error: "File operation failed: {error}",
};
const ZH: typeof EN = {
  files: "文件", outline: "大纲", parent: "上级目录", search: "搜索文件",
  reveal: "定位当前文档", setRoot: "设为根目录", path: "目录路径",
  newWindow: "在新窗口中打开", newTab: "在新标签页中打开", newFile: "新建文件",
  newFolder: "新建文件夹", duplicate: "创建副本", copyRelative: "复制相对路径",
  copyAbsolute: "复制绝对路径", location: "在资源管理器中打开",
  rename: "重命名", delete: "删除", cancel: "取消", ok: "确定",
  fileName: "新文件名", folderName: "新文件夹名", renameTo: "新名称",
  empty: "此文件夹为空", noHeadings: "当前 Markdown 文件没有标题",
  noResults: "没有匹配的文件", searchPlaceholder: "搜索当前目录及子目录",
  error: "文件操作失败：{error}",
};
const DE: typeof EN = {
  files: "Dateien", outline: "Gliederung", parent: "Übergeordneter Ordner", search: "Dateien suchen",
  reveal: "Aktuelles Dokument anzeigen", setRoot: "Als Stammordner anzeigen", path: "Ordnerpfad",
  newWindow: "In neuem Fenster öffnen", newTab: "In neuem Tab öffnen", newFile: "Neue Datei",
  newFolder: "Neuer Ordner", duplicate: "Kopie erstellen", copyRelative: "Relativen Pfad kopieren",
  copyAbsolute: "Absoluten Pfad kopieren", location: "Im Explorer öffnen",
  rename: "Umbenennen", delete: "Löschen", cancel: "Abbrechen", ok: "OK",
  fileName: "Neuer Dateiname", folderName: "Neuer Ordnername", renameTo: "Neuer Name",
  empty: "Dieser Ordner ist leer", noHeadings: "Keine Überschriften in der Markdown-Datei",
  noResults: "Keine passenden Dateien", searchPlaceholder: "Ordner und Unterordner durchsuchen",
  error: "Dateioperation fehlgeschlagen: {error}",
};
const JA: typeof EN = {
  files: "ファイル", outline: "アウトライン", parent: "親フォルダー", search: "ファイル検索",
  reveal: "現在のドキュメントを表示", setRoot: "ルートフォルダーとして表示", path: "フォルダーのパス",
  newWindow: "新しいウィンドウで開く", newTab: "新しいタブで開く", newFile: "新しいファイル",
  newFolder: "新しいフォルダー", duplicate: "コピーを作成", copyRelative: "相対パスをコピー",
  copyAbsolute: "絶対パスをコピー", location: "エクスプローラーで開く",
  rename: "名前を変更", delete: "削除", cancel: "キャンセル", ok: "OK",
  fileName: "新しいファイル名", folderName: "新しいフォルダー名", renameTo: "新しい名前",
  empty: "このフォルダーは空です", noHeadings: "見出しがありません",
  noResults: "一致するファイルがありません", searchPlaceholder: "フォルダー内を検索",
  error: "ファイル操作に失敗しました: {error}",
};

function label(key: Label, vars?: Record<string, string>): string {
  const lang = document.documentElement.lang;
  const value = (lang === "zh-CN" ? ZH : lang === "de" ? DE : lang === "ja" ? JA : EN)[key];
  return vars ? value.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "") : value;
}

function parentOf(path: string): string {
  const trimmed = path.replace(/[\\/]$/, "");
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (index < 0) return path;
  return trimmed.slice(0, /^[A-Za-z]:/.test(trimmed) ? Math.max(index, 2) : index) + (index === 2 && /^[A-Za-z]:/.test(trimmed) ? "\\" : "");
}
function nameOf(path: string): string { return path.split(/[\\/]/).filter(Boolean).pop() ?? path; }
/** Folders strictly below `root` down to `deep`, shallowest first, as real paths. */
function descendantsTo(root: string, deep: string): string[] {
  const separator = root.includes("\\") ? "\\" : "/";
  const names = deep.slice(root.replace(/[\\/]$/, "").length).split(/[\\/]/).filter(Boolean);
  const paths: string[] = [];
  let cursor = root;
  for (const name of names) {
    cursor = /[\\/]$/.test(cursor) ? cursor + name : cursor + separator + name;
    paths.push(cursor);
  }
  return paths;
}
function pathKey(path: string): string { return path.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase(); }
function within(path: string, root: string): boolean {
  const a = pathKey(path);
  const b = pathKey(root);
  return a === b || a.startsWith(`${b}/`);
}

function sameDirectory(a: Directory | undefined, b: Directory): boolean {
  return Boolean(a && a.parent === b.parent && a.entries.length === b.entries.length
    && a.entries.every((entry, index) => entry.name === b.entries[index].name
      && entry.path === b.entries[index].path && entry.is_dir === b.entries[index].is_dir));
}

export class WorkspaceSidebar {
  onOpen: (path: string) => Promise<void> = async () => {};
  onOpenInNewTab: (path: string) => Promise<void> = async () => {};
  onRename: (oldPath: string, newPath: string) => void = () => {};
  onBeforeDelete: (path: string) => Promise<boolean> = async () => true;
  getConfirmDelete: () => boolean = () => true;
  onConfirmDeleteChange: (value: boolean) => void = () => {};
  onDelete: (path: string) => void = () => {};
  onHeading: (index: number) => void = () => {};

  private root: Directory | null = null;
  /** Deepest folder visited on the current branch. Going up keeps it so the
   * breadcrumb can lead back down; switching to another branch replaces it. */
  private trail: string | null = null;
  private pendingRoot: string | null = null;
  private deleteBusy = false;
  private cache = new Map<string, Directory>();
  private expanded = new Set<string>();
  private currentPath: string | null = null;
  private content = "";
  private mode: "files" | "outline" = "files";
  private visible = false;
  private loadToken = 0;
  private searchTimer = 0;
  private searchToken = 0;
  private treeSyncTimer = 0;
  private treeSyncBusy = false;
  private nextDirectoryRead = 0;
  private directoryReads = new Map<string, number>();
  private readonly aside = document.getElementById("workspace-sidebar") as HTMLElement;
  private readonly tree = document.getElementById("workspace-tree") as HTMLElement;
  private readonly outline = document.getElementById("workspace-outline-view") as HTMLElement;
  private readonly menu = document.getElementById("workspace-menu") as HTMLElement;
  private readonly searchInput = document.getElementById("workspace-search") as HTMLInputElement;
  private readonly searchResults = document.getElementById("workspace-search-results") as HTMLElement;
  private rootLoading = false;

  constructor() {
    document.getElementById("btn-sidebar")?.addEventListener("click", () => this.show(!this.visible));
    document.getElementById("rail-files")?.addEventListener("click", () => { this.show(true); this.setMode("files"); });
    document.getElementById("rail-outline")?.addEventListener("click", () => { this.show(true); this.setMode("outline"); });
    document.getElementById("rail-search")?.addEventListener("click", () => this.openSearch());
    document.getElementById("workspace-files-tab")?.addEventListener("click", () => this.setMode("files"));
    document.getElementById("workspace-outline-tab")?.addEventListener("click", () => this.setMode("outline"));
    document.getElementById("workspace-up")?.addEventListener("click", () => {
      // While a folder is still loading, go up from it so quick repeated
      // clicks climb one level each instead of re-requesting the same parent.
      const from = this.rootLoading ? this.pendingRoot : null;
      const parent = from ? parentOf(from) : this.root?.parent;
      if (parent && (!from || pathKey(parent) !== pathKey(from))) void this.setRoot(parent);
    });
    document.getElementById("workspace-reveal")?.addEventListener("click", () => void this.revealCurrent());
    document.getElementById("workspace-search-toggle")?.addEventListener("click", () => this.toggleSearch());
    this.searchInput.addEventListener("input", () => {
      this.queueSearch();
    });
    this.aside.addEventListener("contextmenu", (event) => this.contextMenu(event));
    document.addEventListener("pointerdown", (event) => {
      if (!this.menu.contains(event.target as Node)) this.hideMenu();
    });
    window.addEventListener("resize", () => this.hideMenu());
    window.addEventListener("focus", () => {
      this.syncTreeNow();
      if (!this.searchInput.hidden && this.searchInput.value) this.queueSearch();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) window.clearTimeout(this.treeSyncTimer);
      else {
        this.syncTreeNow();
        if (!this.searchInput.hidden && this.searchInput.value) this.queueSearch();
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.menu.hidden) { event.preventDefault(); this.hideMenu(); }
    });
    this.retranslate();
  }

  retranslate(): void {
    (document.getElementById("workspace-files-tab") as HTMLElement).textContent = label("files");
    (document.getElementById("workspace-outline-tab") as HTMLElement).textContent = label("outline");
    (document.getElementById("workspace-up") as HTMLElement).title = label("parent");
    (document.getElementById("workspace-reveal") as HTMLElement).title = label("reveal");
    (document.getElementById("workspace-reveal") as HTMLElement).setAttribute("aria-label", label("reveal"));
    (document.getElementById("workspace-root-name") as HTMLElement).setAttribute("aria-label", label("path"));
    (document.getElementById("workspace-search-toggle") as HTMLElement).title = label("search");
    (document.getElementById("btn-sidebar") as HTMLElement).title = `${label("files")} / ${label("outline")}`;
    for (const [id, key] of [["rail-files", "files"], ["rail-outline", "outline"], ["rail-search", "search"]] as const) {
      const button = document.getElementById(id) as HTMLButtonElement;
      button.title = label(key);
      button.setAttribute("aria-label", label(key));
    }
    this.searchInput.placeholder = label("searchPlaceholder");
    this.renderTree();
    this.renderOutline();
  }

  show(value: boolean): void {
    const wasVisible = this.visible;
    this.visible = value;
    this.aside.hidden = !value;
    const button = document.getElementById("btn-sidebar") as HTMLButtonElement;
    button.classList.toggle("active", value);
    button.setAttribute("aria-expanded", String(value));
    this.syncRail();
    if (!value) this.invalidateSearch();
    else if (!wasVisible && !this.searchInput.hidden && this.searchInput.value) this.queueSearch();
    if (!value) window.clearTimeout(this.treeSyncTimer);
    else if (!wasVisible) this.syncTreeNow();
  }

  openSearch(): void {
    this.show(true);
    this.setMode("files");
    if (this.searchInput.hidden) this.toggleSearch();
    else this.searchInput.focus();
  }

  private async openEntry(path: string): Promise<void> {
    await this.onOpen(path);
  }

  setMode(mode: "files" | "outline"): void {
    this.mode = mode;
    (document.getElementById("workspace-files-view") as HTMLElement).hidden = mode !== "files";
    this.outline.hidden = mode !== "outline";
    for (const name of ["files", "outline"] as const) {
      const button = document.getElementById(`workspace-${name}-tab`) as HTMLButtonElement;
      button.classList.toggle("active", name === mode);
      button.setAttribute("aria-selected", String(name === mode));
    }
    if (mode === "outline") this.renderOutline();
    this.syncRail();
    if (mode === "files") this.syncTreeNow();
    else window.clearTimeout(this.treeSyncTimer);
  }

  private syncRail(): void {
    document.getElementById("rail-files")?.classList.toggle("active", this.visible && this.mode === "files");
    document.getElementById("rail-outline")?.classList.toggle("active", this.visible && this.mode === "outline");
  }

  async setDocument(path: string | null, content: string): Promise<void> {
    if (document.body.classList.contains("single-document-window")) return;
    this.currentPath = path;
    this.content = content;
    this.renderOutline();
    if (!path) { this.renderTree(); return; }
    const token = ++this.loadToken;
    if (!this.root || !within(path, this.root.path)) {
      await this.setRoot(parentOf(path));
    } else {
      await this.revealPath(path);
      this.renderTree();
    }
    if (token !== this.loadToken) return;
    this.show(true);
  }

  setContent(content: string): void {
    this.content = content;
    if (this.mode === "outline") this.renderOutline();
  }

  async setRoot(path: string): Promise<void> {
    this.invalidateSearch();
    this.rootLoading = true;
    this.pendingRoot = path;
    window.clearTimeout(this.treeSyncTimer);
    this.tree.hidden = false;
    this.searchResults.hidden = true;
    const token = ++this.loadToken;
    try {
      const dir = await invoke<Directory>("list_workspace_dir", { path });
      if (token !== this.loadToken) return;
      this.root = dir;
      this.trail = this.trail && within(this.trail, dir.path) ? this.trail : dir.path;
      this.cache.clear();
      this.directoryReads.clear();
      this.expanded.clear();
      this.cache.set(dir.path, dir);
      if (this.currentPath && within(this.currentPath, dir.path)) await this.revealPath(this.currentPath);
      if (token !== this.loadToken) return;
      this.rootLoading = false;
      this.renderTree();
      this.show(true);
      if (!this.searchInput.hidden && this.searchInput.value) this.queueSearch();
      this.scheduleTreeSync();
    } catch (error) {
      if (token === this.loadToken) {
        this.rootLoading = false;
        // A remembered deeper folder may have been moved or deleted meanwhile.
        if (this.trail && this.root && within(this.trail, path)) {
          this.trail = this.root.path;
          this.renderTree();
        }
        this.scheduleTreeSync();
        await this.report(error);
      }
    }
  }

  async refresh(path?: string): Promise<void> {
    if (!this.root) return;
    const dirPath = path ?? this.root.path;
    try {
      if (await this.readDirectory(dirPath)) this.renderTree();
    } catch (error) { await this.report(error); }
  }

  private async readDirectory(path: string): Promise<boolean> {
    const rootPath = this.root?.path;
    if (!rootPath || !within(path, rootPath)) return false;
    const key = pathKey(path);
    const readId = ++this.nextDirectoryRead;
    this.directoryReads.set(key, readId);
    const dir = await invoke<Directory>("list_workspace_dir", { path });
    if (this.root?.path !== rootPath || this.directoryReads.get(key) !== readId) return false;
    // A directory changed outside the app may invalidate the remembered branch.
    // Keep its last known parent rather than offering a stale breadcrumb button.
    const next = this.trail && within(this.trail, dir.path) ? descendantsTo(dir.path, this.trail)[0] : undefined;
    const trimmedTrail = Boolean(next && !dir.entries.some((entry) => entry.is_dir && pathKey(entry.path) === pathKey(next)));
    if (trimmedTrail) this.trail = dir.path;
    const changed = trimmedTrail || !sameDirectory(this.cache.get(path), dir);
    this.cache.set(dir.path, dir);
    if (key === pathKey(rootPath)) this.root = dir;
    return changed;
  }

  private treeSyncEnabled(): boolean {
    return this.visible && this.mode === "files" && !document.hidden && !this.rootLoading && Boolean(this.root);
  }

  private scheduleTreeSync(): void {
    window.clearTimeout(this.treeSyncTimer);
    if (this.treeSyncEnabled()) this.treeSyncTimer = window.setTimeout(() => this.syncTreeNow(), 2500);
  }

  private syncTreeNow(): void {
    if (!this.treeSyncEnabled() || this.treeSyncBusy) return;
    window.clearTimeout(this.treeSyncTimer);
    void this.syncVisibleDirectories();
  }

  private async syncVisibleDirectories(): Promise<void> {
    this.treeSyncBusy = true;
    const rootPath = this.root!.path;
    let changed = false;
    try {
      changed = await this.readDirectory(rootPath);
      const visit = async (dir: Directory): Promise<void> => {
        for (const entry of dir.entries) {
          if (this.root?.path !== rootPath || !this.treeSyncEnabled()) return;
          if (!entry.is_dir || !this.expanded.has(entry.path)) continue;
          try { changed = (await this.readDirectory(entry.path)) || changed; }
          catch { if (this.cache.delete(entry.path)) changed = true; continue; }
          const child = this.cache.get(entry.path);
          if (child) await visit(child);
        }
      };
      if (this.root?.path === rootPath && this.treeSyncEnabled()) await visit(this.root!);
      if (changed && this.root?.path === rootPath && this.treeSyncEnabled()) {
        this.renderTree();
        if (!this.searchInput.hidden && this.searchInput.value) this.queueSearch();
      }
    } catch {
      // The directory may be temporarily unavailable. Retry on the next tick.
    } finally {
      this.treeSyncBusy = false;
      this.scheduleTreeSync();
    }
  }

  /** The opposite of "Parent folder": show the current document's folder as
   * the root and bring the document's row into view. */
  private async revealCurrent(): Promise<void> {
    const path = this.currentPath;
    if (!path) return;
    const folder = parentOf(path);
    if (this.root && pathKey(this.root.path) === pathKey(folder)) {
      this.tree.hidden = false;
      this.searchResults.hidden = true;
      this.renderTree();
    } else {
      await this.setRoot(folder);
    }
    if (this.currentPath !== path) return;
    const row = Array.from(this.tree.querySelectorAll<HTMLElement>(".workspace-row.active"))[0];
    row?.scrollIntoView({ block: "nearest" });
    row?.focus({ preventScroll: true });
  }

  private async revealPath(path: string): Promise<void> {
    if (!this.root || !within(path, this.root.path)) return;
    const parent = parentOf(path);
    if (pathKey(parent) === pathKey(this.root.path)) return;
    const relative = pathKey(parent).slice(pathKey(this.root.path).length).replace(/^\//, "");
    let cursor = this.root.path;
    for (const segment of relative.split("/").filter(Boolean)) {
      let child = this.cache.get(cursor)?.entries.find((entry) => entry.is_dir && entry.name.toLowerCase() === segment);
      if (!child) {
        await this.readDirectory(cursor);
        child = this.cache.get(cursor)?.entries.find((entry) => entry.is_dir && entry.name.toLowerCase() === segment);
      }
      if (!child) return;
      cursor = child.path;
      this.expanded.add(cursor);
      await this.loadDir(cursor);
    }
  }

  private async loadDir(path: string): Promise<void> {
    if (this.cache.has(path)) return;
    await this.readDirectory(path);
  }

  private renderTree(): void {
    const scrollHost = document.getElementById("workspace-files-view") as HTMLElement;
    const scrollTop = scrollHost.scrollTop;
    const focused = this.tree.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).closest<HTMLElement>(".workspace-row[data-path]")?.dataset.path
      : undefined;
    this.tree.replaceChildren();
    this.renderBreadcrumb();
    (document.getElementById("workspace-up") as HTMLButtonElement).disabled = !this.root?.parent;
    (document.getElementById("workspace-reveal") as HTMLButtonElement).disabled = !this.currentPath;
    if (!this.root) return;
    if (!this.root.entries.length) {
      const empty = document.createElement("div"); empty.className = "workspace-empty"; empty.textContent = label("empty"); this.tree.append(empty);
    }
    this.renderEntries(this.root.entries, this.tree);
    scrollHost.scrollTop = scrollTop;
    if (focused) {
      const row = Array.from(this.tree.querySelectorAll<HTMLElement>(".workspace-row[data-path]"))
        .find((candidate) => candidate.dataset.path === focused);
      row?.focus({ preventScroll: true });
    }
  }

  /** Current root, then any remembered deeper folders (dimmed) to return to. */
  private renderBreadcrumb(): void {
    const crumbs = document.getElementById("workspace-root-name") as HTMLElement;
    const focusedPath = crumbs.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.path
      : undefined;
    crumbs.replaceChildren();
    if (!this.root) return;
    const current = document.createElement("span");
    current.className = "workspace-crumb current";
    current.dataset.path = this.root.path;
    // The current location is not an action, but can retain focus when a
    // breadcrumb button becomes the root after Enter/Space navigation.
    current.tabIndex = -1;
    current.textContent = nameOf(this.root.path);
    current.title = this.root.path;
    current.setAttribute("aria-current", "location");
    crumbs.append(current);
    const deeper = this.trail && within(this.trail, this.root.path) ? descendantsTo(this.root.path, this.trail) : [];
    for (const path of deeper) {
      const step = document.createElement("span");
      step.className = "workspace-crumb-step";
      const separator = document.createElement("span");
      separator.className = "workspace-crumb-separator";
      separator.textContent = "›";
      separator.setAttribute("aria-hidden", "true");
      const crumb = document.createElement("button");
      crumb.type = "button";
      crumb.className = "workspace-crumb";
      crumb.dataset.path = path;
      crumb.textContent = nameOf(path);
      crumb.title = path;
      crumb.addEventListener("click", () => void this.setRoot(path));
      step.append(separator, crumb);
      crumbs.append(step);
    }
    if (focusedPath) {
      const target = Array.from(crumbs.querySelectorAll<HTMLElement>(".workspace-crumb"))
        .find((crumb) => pathKey(crumb.dataset.path!) === pathKey(focusedPath));
      (target ?? document.getElementById("workspace-up"))?.focus({ preventScroll: true });
    }
  }

  private renderEntries(entries: Entry[], container: HTMLElement): void {
    for (const entry of entries) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "workspace-row";
      row.dataset.path = entry.path;
      row.dataset.directory = String(entry.is_dir);
      row.classList.toggle("active", pathKey(entry.path) === (this.currentPath ? pathKey(this.currentPath) : ""));
      row.title = entry.path;
      row.setAttribute("role", "treeitem");
      if (entry.is_dir) row.setAttribute("aria-expanded", String(this.expanded.has(entry.path)));
      const arrow = document.createElement("span"); arrow.className = "workspace-chevron"; arrow.textContent = entry.is_dir ? (this.expanded.has(entry.path) ? "⌄" : "›") : "";
      const icon = document.createElement("span"); icon.className = "workspace-icon"; icon.innerHTML = entry.is_dir
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
        : isImagePath(entry.path)
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 18 5-5 3 3 3-4 5 6"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>';
      icon.setAttribute("aria-hidden", "true");
      const name = document.createElement("span"); name.className = "workspace-name"; name.textContent = entry.name;
      row.append(arrow, icon, name);
      row.addEventListener("click", () => {
        if (entry.is_dir) void this.toggleFolder(entry.path);
        else void this.openEntry(entry.path);
      });
      container.append(row);
      if (entry.is_dir && this.expanded.has(entry.path)) {
        const children = document.createElement("div"); children.className = "workspace-children"; children.setAttribute("role", "group");
        const dir = this.cache.get(entry.path);
        if (dir) this.renderEntries(dir.entries, children);
        container.append(children);
      }
    }
  }

  private async toggleFolder(path: string): Promise<void> {
    if (this.expanded.has(path)) this.expanded.delete(path);
    else {
      this.expanded.add(path);
      try { await this.readDirectory(path); } catch (error) { this.expanded.delete(path); await this.report(error); }
    }
    this.renderTree();
  }

  private renderOutline(): void {
    this.outline.replaceChildren();
    if (!this.currentPath || !isMarkdownPath(this.currentPath)) return;
    let fence = false;
    let index = 0;
    for (const line of this.content.split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
      if (fence) continue;
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (!match) continue;
      const button = document.createElement("button"); button.type = "button"; button.className = "workspace-outline-item";
      button.dataset.level = String(match[1].length);
      button.textContent = match[2].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "");
      const headingIndex = index++;
      button.addEventListener("click", () => this.onHeading(headingIndex));
      this.outline.append(button);
    }
    if (!index) { const empty = document.createElement("div"); empty.className = "workspace-empty"; empty.textContent = label("noHeadings"); this.outline.append(empty); }
  }

  private toggleSearch(): void {
    const open = this.searchInput.hidden;
    this.invalidateSearch();
    this.searchInput.hidden = !open;
    this.tree.hidden = open && Boolean(this.searchInput.value);
    this.searchResults.hidden = !open || !this.searchInput.value;
    if (open) { this.searchInput.focus(); if (this.searchInput.value) this.queueSearch(); }
    else { this.searchInput.value = ""; this.tree.hidden = false; this.searchResults.hidden = true; }
  }

  private invalidateSearch(): void {
    window.clearTimeout(this.searchTimer);
    this.searchTimer = 0;
    this.searchToken++;
  }

  private queueSearch(): void {
    this.invalidateSearch();
    const query = this.searchInput.value.trim();
    this.tree.hidden = false;
    this.searchResults.hidden = true;
    if (!query || !this.root || this.rootLoading || !this.visible || this.searchInput.hidden) return;
    const token = this.searchToken;
    const rootPath = this.root.path;
    this.searchTimer = window.setTimeout(() => void this.search(token, rootPath, query), 180);
  }

  private searchIsCurrent(token: number, rootPath: string): boolean {
    return token === this.searchToken && !this.rootLoading && this.visible && !this.searchInput.hidden && this.root?.path === rootPath;
  }

  private async search(token: number, rootPath: string, query: string): Promise<void> {
    if (!this.searchIsCurrent(token, rootPath)) return;
    try {
      const results = await invoke<Entry[]>("search_workspace", { root: rootPath, query });
      if (!this.searchIsCurrent(token, rootPath)) return;
      this.tree.hidden = true;
      this.searchResults.hidden = false;
      this.searchResults.replaceChildren();
      for (const entry of results) {
        const row = document.createElement("button"); row.type = "button"; row.className = "workspace-row"; row.title = entry.path;
        row.dataset.path = entry.path;
        row.dataset.directory = String(entry.is_dir);
        row.textContent = `${entry.is_dir ? "📁" : "▤"}  ${entry.name}`;
        row.addEventListener("click", () => entry.is_dir ? void this.setRoot(entry.path) : void this.openEntry(entry.path));
        const subtitle = document.createElement("span"); subtitle.className = "workspace-result-path"; subtitle.textContent = parentOf(entry.path).slice(rootPath.length) || ".";
        this.searchResults.append(row, subtitle);
      }
      if (!results.length) { const empty = document.createElement("div"); empty.className = "workspace-empty"; empty.textContent = label("noResults"); this.searchResults.append(empty); }
    } catch (error) { if (this.searchIsCurrent(token, rootPath)) await this.report(error); }
  }

  private contextMenu(event: MouseEvent): void {
    if (this.mode !== "files" || !this.root) return;
    event.preventDefault();
    const row = (event.target as HTMLElement).closest<HTMLElement>(".workspace-row[data-path]");
    const path = row?.dataset.path ?? this.root.path;
    const isDir = row ? row.dataset.directory === "true" : true;
    const blank = !row;
    this.menu.replaceChildren();
    const item = (name: Label, action: () => void, danger = false) => {
      const button = document.createElement("button"); button.type = "button"; button.textContent = label(name); button.classList.toggle("danger", danger);
      button.addEventListener("click", () => { this.hideMenu(); action(); }); this.menu.append(button);
    };
    const divider = () => this.menu.append(document.createElement("hr"));
    if ((!isDir && !isImagePath(path)) || (isDir && this.currentPath)) item("newWindow", () => void this.run("open_workspace_window", { path: isDir ? this.currentPath : path }));
    if (!blank && !isDir) item("newTab", () => void this.onOpenInNewTab(path));
    if (!blank && isDir) item("setRoot", () => void this.setRoot(path));
    if (blank || isDir) {
      item("newFile", () => void this.create(path, false));
      item("newFolder", () => void this.create(path, true));
      item("search", () => { this.setMode("files"); if (this.searchInput.hidden) this.toggleSearch(); else this.searchInput.focus(); });
    }
    if (!blank && !isDir) item("duplicate", () => void this.duplicate(path));
    divider();
    item("copyRelative", () => void this.copyPath(path, true));
    item("copyAbsolute", () => void this.copyPath(path, false));
    item("location", () => void this.run("open_workspace_location", { path }));
    if (!blank) {
      divider();
      item("rename", () => void this.rename(path));
      item("delete", () => void this.delete(path, isDir), true);
    }
    this.menu.hidden = false;
    const rect = this.menu.getBoundingClientRect();
    this.menu.style.left = `${Math.max(4, Math.min(event.clientX, innerWidth - rect.width - 4))}px`;
    this.menu.style.top = `${Math.max(4, Math.min(event.clientY, innerHeight - rect.height - 4))}px`;
  }

  private hideMenu(): void { this.menu.hidden = true; }

  private async prompt(title: string, initial: string): Promise<string | null> {
    const dialog = document.getElementById("workspace-prompt") as HTMLElement;
    const input = document.getElementById("workspace-prompt-input") as HTMLInputElement;
    (document.getElementById("workspace-prompt-label") as HTMLElement).textContent = title;
    (document.getElementById("workspace-prompt-cancel") as HTMLElement).textContent = label("cancel");
    (document.getElementById("workspace-prompt-ok") as HTMLElement).textContent = label("ok");
    input.value = initial;
    dialog.hidden = false;
    activateModal(dialog, () => document.getElementById("workspace-prompt-cancel")?.click(), input);
    const dot = initial.lastIndexOf("."); input.setSelectionRange(0, dot > 0 ? dot : initial.length);
    return new Promise((resolve) => {
      const finish = (value: string | null) => { dialog.hidden = true; cleanup(); deactivateModal(dialog); resolve(value); };
      const ok = () => { if (input.value.trim()) finish(input.value.trim()); };
      const cancel = () => finish(null);
      const key = (event: KeyboardEvent) => { if (event.isComposing) return; if (event.key === "Enter") { event.preventDefault(); ok(); } else if (event.key === "Escape") { event.preventDefault(); cancel(); } };
      const backdrop = (event: MouseEvent) => { if (event.target === dialog) cancel(); };
      const okButton = document.getElementById("workspace-prompt-ok") as HTMLButtonElement;
      const validate = () => { okButton.disabled = !input.value.trim(); };
      validate();
      const cancelButton = document.getElementById("workspace-prompt-cancel")!;
      const cleanup = () => { okButton.removeEventListener("click", ok); cancelButton.removeEventListener("click", cancel); input.removeEventListener("keydown", key); input.removeEventListener("input", validate); dialog.removeEventListener("click", backdrop); };
      okButton.addEventListener("click", ok); cancelButton.addEventListener("click", cancel); input.addEventListener("keydown", key); input.addEventListener("input", validate); dialog.addEventListener("click", backdrop);
    });
  }

  private async create(parent: string, directory: boolean): Promise<void> {
    const name = await this.prompt(label(directory ? "folderName" : "fileName"), directory ? "New folder" : "New document.md");
    if (!name) return;
    const created = await this.run<string>("create_workspace_entry", { parent, name, directory });
    if (!created) return;
    await this.refresh(parent);
    if (directory) { this.expanded.add(created); await this.loadDir(created); this.renderTree(); }
    else await this.onOpen(created);
  }

  private async duplicate(path: string): Promise<void> {
    const copy = await this.run<string>("duplicate_workspace_file", { path });
    if (copy) await this.refresh(parentOf(path));
  }

  private async rename(path: string): Promise<void> {
    const name = await this.prompt(label("renameTo"), nameOf(path));
    if (!name || name === nameOf(path)) return;
    const renamed = await this.run<string>("rename_workspace_entry", { path, name });
    if (!renamed) return;
    if (this.trail && within(this.trail, path)) this.trail = renamed + this.trail.slice(path.length);
    this.onRename(path, renamed);
    await this.refresh(parentOf(path));
  }

  private async delete(path: string, directory = false): Promise<void> {
    if (this.deleteBusy) return;
    this.deleteBusy = true;
    try {
      let remember = false;
      if (this.getConfirmDelete()) {
        const details = document.createElement("div");
        details.className = "app-dialog-details";
        details.setAttribute("aria-live", "polite");
        details.textContent = t("dialog.deleteLoading");
        const ready = invoke<DeleteInfo>("get_workspace_delete_info", { root: this.root?.path ?? parentOf(path), path })
          .then(info => {
            const summary = document.createElement("p");
            summary.className = "app-dialog-file-summary";
            summary.textContent = t(info.file_count_complete ? "dialog.deleteFiles" : "dialog.deleteFilesPartial", { count: info.file_count });
            const references = document.createElement("p");
            references.className = "app-dialog-reference-summary";
            references.textContent = t(info.is_dir ? "dialog.deleteFolderReferences" : "dialog.deleteReferences", { count: info.backlink_count, files: info.backlink_file_count });
            details.replaceChildren(summary, references);
            if (info.backlinks.length) {
              const list = document.createElement("ul");
              list.className = "app-dialog-backlinks";
              for (const link of info.backlinks) {
                const row = document.createElement("li");
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = t("dialog.deleteReferenceFile", { name: link.name, count: link.count });
                button.title = link.path;
                button.addEventListener("click", () => {
                  details.dispatchEvent(new Event("dialog-dismiss", { bubbles: true }));
                  void this.onOpenInNewTab(link.path);
                });
                row.appendChild(button); list.appendChild(row);
              }
              details.appendChild(list);
            }
            const scope = document.createElement("p");
            scope.className = "app-dialog-scope";
            scope.textContent = t(info.scan_complete ? "dialog.deleteScanScope" : "dialog.deleteScanPartial");
            if (info.backlink_file_count > info.backlinks.length) scope.textContent += ` ${t("dialog.deleteListPartial")}`;
            details.appendChild(scope);
          }).catch(error => {
            details.textContent = t("dialog.deleteScanFailed", { error: String(error) });
            throw error; // Keep Delete disabled when the target cannot be inspected.
          });
        const result = await confirmDialog(t("dialog.deleteBody", { name: nameOf(path) }), {
          title: t(directory ? "dialog.deleteFolderTitle" : "dialog.deleteTitle"), confirmLabel: t("dialog.delete"), danger: true,
          rememberLabel: t("dialog.dontAskAgain"), details, ready,
        });
        if (!result.confirmed) return;
        remember = result.remember;
      }
      if (!(await this.onBeforeDelete(path))) return;
      const done = await this.run<void>("delete_workspace_entry", { path });
      if (done === null) return;
      if (remember) this.onConfirmDeleteChange(false);
      if (this.trail && this.root && within(this.trail, path)) this.trail = this.root.path;
      this.onDelete(path);
      await this.refresh(parentOf(path));
    } finally { this.deleteBusy = false; }
  }

  private async copyPath(path: string, relative: boolean): Promise<void> {
    const value = relative && this.root ? (path.toLowerCase() === this.root.path.toLowerCase() ? "." : `./${path.slice(this.root.path.length).replace(/^[\\/]/, "").replace(/\\/g, "/")}`) : path;
    try { await navigator.clipboard.writeText(value); } catch (error) { await this.report(error); }
  }

  private async run<T>(command: string, args: Record<string, unknown>): Promise<T | null> {
    try { return (await invoke<T>(command, args)) ?? (true as T); }
    catch (error) { await this.report(error); return null; }
  }
  private async report(error: unknown): Promise<void> {
    await message(label("error", { error: String(error) }), { title: "PaperNest", kind: "error" });
  }
}
