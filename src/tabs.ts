// Tab model + tab-strip rendering. One open document per tab; the heavy editor
// instance is shared (main.ts swaps content on activation). Inactive tabs cost
// only their text.

import { t } from "./i18n";
import { tabPathKey } from "./tab-path";

export interface Tab {
  id: string;
  path: string | null;
  /** Content as last saved or loaded. */
  saved: string;
  /** Current editor content for this tab. */
  content: string;
  dirty: boolean;
  scrollTop: number;
  /** Loaded image for a read-only image tab; null for text documents. */
  imageUrl: string | null;
  /** Empty landing page opened by the new-tab button. */
  startPage: boolean;
  /** File-tree clicks replace this tab rather than accumulating new tabs. */
  preview: boolean;
  /** Explicit "open in new tab" keeps this tab out of the preview slot. */
  pinned: boolean;
}

let seq = 0;
const nextId = () => `t${++seq}`;

export function baseName(path: string | null): string {
  if (!path) return t("doc.untitled");
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || t("doc.untitled");
}

export class TabBar {
  tabs: Tab[] = [];
  activeId = "";
  /** Keep the strip visible even with a single tab (settings-driven). */
  private alwaysShow = false;
  private stacked = false;

  /** Called after the active tab changes; `prev` is the tab we left (if any). */
  onActivate: (next: Tab, prev: Tab | null) => void = () => {};
  /** Called when the set of tabs or their identity changes (persist trigger). */
  onStructureChange: () => void = () => {};
  /** Called when the user asks to close a tab; main.ts decides (dirty guard). */
  onCloseRequest: (tab: Tab) => Promise<boolean> = async () => false;

  private readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    this.el.addEventListener("click", (e) => this.handleClick(e));
    this.el.addEventListener("auxclick", (e) => {
      if ((e as MouseEvent).button === 1) this.handleClick(e); // middle-click closes
    });
    new ResizeObserver(() => this.revealActiveTab()).observe(this.el);
  }

  get active(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  /** Show the strip with a single tab, or hide it (the default). */
  setAlwaysShow(on: boolean): void {
    if (this.alwaysShow === on) return;
    this.alwaysShow = on;
    this.render();
  }

  get isStacked(): boolean { return this.stacked; }

  setStacked(on: boolean): void {
    this.stacked = on;
    this.el.classList.toggle("stacked", on);
    this.revealActiveTab();
  }

  findByPath(path: string): Tab | undefined {
    const key = tabPathKey(path);
    return this.tabs.find((t) => t.path && tabPathKey(t.path) === key);
  }

  add(
    path: string | null,
    content: string,
    activate = true,
    imageUrl: string | null = null,
    startPage = false,
  ): Tab {
    const tab: Tab = {
      id: nextId(),
      path,
      saved: content,
      content,
      dirty: false,
      scrollTop: 0,
      imageUrl,
      startPage,
      preview: false,
      pinned: false,
    };
    this.tabs.push(tab);
    this.onStructureChange();
    if (activate) this.activate(tab.id);
    else this.render();
    return tab;
  }

  activate(id: string): void {
    if (id === this.activeId) return;
    const prev = this.active ?? null;
    const next = this.tabs.find((t) => t.id === id);
    if (!next) return;
    this.activeId = id;
    this.onActivate(next, prev);
    this.render();
  }

  /** Remove a tab unconditionally (dirty check happens in main.ts). */
  remove(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const wasActive = this.activeId === id;
    this.tabs.splice(idx, 1);
    this.onStructureChange();
    if (this.tabs.length === 0) {
      this.add(null, "", true, null, true);
      return;
    }
    if (wasActive) {
      const neighbour = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activeId = "";
      this.activate(neighbour.id);
    } else {
      this.render();
    }
  }

  /** Cheap update of the dirty dots without rebuilding the strip. */
  refreshDirty(): void {
    for (const tab of this.tabs) {
      const node = this.el.querySelector<HTMLElement>(`[data-tab="${tab.id}"]`);
      node?.classList.toggle("dirty", tab.dirty);
      const label = node?.querySelector(".tab-name");
      if (label) label.textContent = this.label(tab);
    }
  }

  render(): void {
    this.el.hidden = !this.alwaysShow && this.tabs.length <= 1;
    this.el.replaceChildren();

    for (const tab of this.tabs) {
      const item = document.createElement("div");
      item.className = "tab" + (tab.id === this.activeId ? " active" : "");
      item.classList.toggle("dirty", tab.dirty);
      item.dataset.tab = tab.id;
      item.setAttribute("role", "tab");
      item.setAttribute("aria-selected", String(tab.id === this.activeId));
      item.setAttribute("aria-label", this.label(tab));
      item.tabIndex = tab.id === this.activeId ? 0 : -1;
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.activate(tab.id);
        }
      });

      const name = document.createElement("span");
      name.className = "tab-name";
      name.textContent = this.label(tab);

      const close = document.createElement("button");
      close.className = "tab-close";
      close.dataset.close = tab.id;
      close.setAttribute("aria-label", t("tab.close"));
      close.textContent = "×";

      if (tab.imageUrl) {
        const icon = document.createElement("span");
        icon.className = "tab-image-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 18 6-6 4 4 3-3 4 4"/></svg>';
        item.append(icon);
      }
      item.append(name, close);
      this.el.appendChild(item);
    }

    this.revealActiveTab();
  }

  private revealActiveTab(): void {
    const activeItem = this.el.querySelector<HTMLElement>(".tab.active");
    if (activeItem) requestAnimationFrame(() => {
      if (activeItem.isConnected) activeItem.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  private label(tab: Tab): string {
    return tab.startPage ? t("tab.new") : tab.imageUrl
      ? baseName(tab.path).replace(/\.[^.]+$/, "")
      : baseName(tab.path);
  }

  private handleClick(e: Event): void {
    const target = e.target as HTMLElement;

    const closeId = target.closest<HTMLElement>("[data-close]")?.dataset.close;
    if (closeId) {
      e.preventDefault();
      const tab = this.tabs.find((t) => t.id === closeId);
      if (tab) void this.onCloseRequest(tab);
      return;
    }

    const tabId = target.closest<HTMLElement>("[data-tab]")?.dataset.tab;
    if (!tabId) return;
    if ((e as MouseEvent).button === 1) {
      e.preventDefault();
      const tab = this.tabs.find((t) => t.id === tabId);
      if (tab) void this.onCloseRequest(tab);
    } else {
      this.activate(tabId);
    }
  }
}
