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
  /** File requested in a new tab; its content has not arrived yet. */
  loading: boolean;
  /** File-tree clicks replace this tab rather than accumulating new tabs. */
  preview: boolean;
  /** Explicit "open in new tab" keeps this tab out of the preview slot. */
  pinned: boolean;
  /** User lock: file-tree navigation must never replace this document. */
  locked: boolean;
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
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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
    this.reducedMotion.addEventListener("change", () => {
      if (this.reducedMotion.matches) {
        for (const item of this.el.querySelectorAll(".tab-opening")) item.classList.remove("tab-opening");
        this.revealActiveTab();
      }
    });
    new ResizeObserver(() => this.revealActiveTab()).observe(this.el);
  }

  get active(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  /** Show or hide the strip with a single tab, as configured in settings. */
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
    loading = false,
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
      loading,
      preview: false,
      pinned: false,
      locked: false,
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
    const items = new Map(
      [...this.el.querySelectorAll<HTMLElement>(".tab")].map((item) => [item.dataset.tab!, item]),
    );
    const animateNewTabs = items.size > 0 && !this.stacked
      && !this.reducedMotion.matches;
    this.el.hidden = !this.alwaysShow && this.tabs.length <= 1;
    const ids = new Set(this.tabs.map((tab) => tab.id));
    for (const [id, item] of items) {
      if (!ids.has(id)) item.remove();
    }

    for (const [index, tab] of this.tabs.entries()) {
      let item = items.get(tab.id);
      if (!item) {
        item = this.createTabElement(tab.id);
        if (animateNewTabs && !this.el.hidden) item.classList.add("tab-opening");
      }
      item.classList.toggle("active", tab.id === this.activeId);
      item.classList.toggle("dirty", tab.dirty);
      item.classList.toggle("locked", tab.locked);
      item.setAttribute("aria-selected", String(tab.id === this.activeId));
      if (tab.loading) item.setAttribute("aria-busy", "true");
      else item.removeAttribute("aria-busy");
      item.setAttribute("aria-label", tab.locked ? t("tab.lockedLabel", { name: this.label(tab) }) : this.label(tab));
      item.tabIndex = tab.id === this.activeId ? 0 : -1;
      const name = item.querySelector<HTMLElement>(".tab-name")!;
      name.textContent = this.label(tab);

      const close = item.querySelector<HTMLButtonElement>(".tab-close")!;
      close.setAttribute("aria-label", t("tab.close"));
      close.tabIndex = tab.id === this.activeId ? 0 : -1;

      const lockIcon = item.querySelector(".tab-lock-icon");
      if (tab.locked && !lockIcon) {
        const icon = document.createElement("span");
        icon.className = "tab-lock-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l-1 7 4 4v2H6v-2l4-4zM12 16v5"/></svg>';
        name.before(icon);
      } else if (!tab.locked) lockIcon?.remove();

      const imageIcon = item.querySelector(".tab-image-icon");
      if (tab.imageUrl && !imageIcon) {
        const icon = document.createElement("span");
        icon.className = "tab-image-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m4 18 6-6 4 4 3-3 4 4"/></svg>';
        name.before(icon);
      } else if (!tab.imageUrl) {
        imageIcon?.remove();
      }
      // Keep existing nodes (and their in-flight animation/focus) across updates.
      const position = this.el.children[index];
      if (position !== item) this.el.insertBefore(item, position ?? null);
    }

    this.revealActiveTab();
  }

  private createTabElement(id: string): HTMLElement {
    const item = document.createElement("div");
    item.className = "tab";
    item.dataset.tab = id;
    item.setAttribute("role", "tab");
    item.setAttribute("aria-haspopup", "menu");
    item.addEventListener("keydown", (event) => {
      if ((event.target as HTMLElement).closest(".tab-close")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.activate(id);
      }
    });
    const finishOpening = (event: AnimationEvent) => {
      if (event.target === item && event.animationName === "tab-open") {
        item.classList.remove("tab-opening");
        if (item.classList.contains("active")) this.revealActiveTab();
      }
    };
    item.addEventListener("animationend", finishOpening);
    item.addEventListener("animationcancel", finishOpening);

    const name = document.createElement("span");
    name.className = "tab-name";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab-close";
    close.dataset.close = id;
    close.textContent = "×";
    const content = document.createElement("span");
    content.className = "tab-content";
    content.append(name, close);
    item.append(content);
    return item;
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
