import { message } from "./dialogs";
import { t } from "./i18n";

export interface TextMenuItem {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  children?: TextMenuItem[][];
  run?: () => void | Promise<void>;
}
export interface TextMenuTarget {
  groups: TextMenuItem[][];
  restore: () => boolean;
}

const paths: Record<string, string> = {
  link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  unlink: '<path d="m4 4 16 16m-11-4-2 2a4 4 0 0 1-6-6l2-2m12 0 2-2a4 4 0 0 1 6 6l-2 2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  format: '<path d="m14 3 7 7-8 8-7-7zM6 11l-3 3v5h5l3-3m3-13-8 8"/>',
  paragraph: '<path d="M13 4v16m5-16v16M20 4H9a5 5 0 0 0 0 10h4"/>',
  insert: '<path d="M4 6h16M4 18h16M12 9v6m-3-3h6"/>',
  bold: '<path d="M7 4h6a4 4 0 0 1 0 8H7zm0 8h7a4 4 0 0 1 0 8H7z"/>',
  italic: '<path d="M10 4h9M5 20h9M14 4 9 20"/>',
  strike: '<path d="M17 5c-2-2-9-2-9 2 0 2 3 3 5 3M4 12h16m-4 3c3 6-7 6-9 3"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16"/>',
  math: '<path d="M18 4H6l6 8-6 8h12"/>',
  clear: '<path d="m14 3 7 7-10 10H6l-4-4zM8 10l8 8m-5 2h10"/>',
  bullet: '<circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/><path d="M9 6h11M9 12h11M9 18h11"/>',
  ordered: '<path d="M3 4h2v5M3 9h4M3 15c4-3 5 0 1 3l-1 2h4M10 6h10M10 12h10M10 18h10"/>',
  task: '<rect x="3" y="4" width="15" height="16" rx="2"/><path d="m7 11 4 4L21 5"/>',
  text: '<path d="M4 5h16M4 10h16M4 15h16M4 20h11"/>',
  quote: '<path d="M4 5h6v7H4zm10 0h6v7h-6zM10 12c0 4-2 6-5 7m15-7c0 4-2 6-5 7"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 18 6-6 4 4 4-6 4 5"/>',
  divider: '<path d="M3 12h18"/>',
  undo: '<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>',
  redo: '<path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14"/>',
  cut: '<circle cx="5" cy="6" r="3"/><circle cx="5" cy="18" r="3"/><path d="m8 8 13 13M8 16 21 3"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  paste: '<path d="M8 5H4v16h16V5h-4"/><rect x="8" y="2" width="8" height="6" rx="2"/>',
  select: '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/>',
};

function iconMarkup(name: string): string {
  if (/^h[1-6]$/.test(name)) return `<span class="text-menu-heading">H${name.slice(1)}</span>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.text}</svg>`;
}

/** Body-mounted panels avoid clipping inside either editor's scrolling area. */
export class TextContextMenu {
  #panels: HTMLElement[] = [];
  #parents: HTMLButtonElement[] = [];
  #target: TextMenuTarget | null = null;
  #hoverTimer: number | null = null;
  constructor(private host: HTMLElement, private getTarget: (event: MouseEvent) => TextMenuTarget | null) {
    host.addEventListener("contextmenu", this.#onContext, true);
    host.addEventListener("keydown", this.#onContextKey, true);
    document.addEventListener("pointerdown", this.#onOutside, true);
    window.addEventListener("keydown", this.#onKey, true);
    window.addEventListener("resize", this.#dismiss);
    document.addEventListener("scroll", this.#onScroll, true);
  }

  close(restore = false): void {
    this.#cancelHover();
    this.#trim(0);
    const target = this.#target;
    this.#target = null;
    if (restore) target?.restore();
  }
  #dismiss = (): void => this.close();
  #onScroll = (event: Event): void => {
    const level = this.#panels.findIndex(panel => panel.contains(event.target as Node));
    if (level < 0) this.close();
    else this.#trim(level + 1);
  };
  #onOutside = (event: PointerEvent): void => {
    if (!this.#panels.some(panel => panel.contains(event.target as Node))) this.close();
  };
  #cancelHover(): void {
    if (this.#hoverTimer !== null) window.clearTimeout(this.#hoverTimer);
    this.#hoverTimer = null;
  }
  #onContextKey = (event: KeyboardEvent): void => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const rect = document.activeElement?.getBoundingClientRect() ?? this.host.getBoundingClientRect();
    this.host.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left + 24, clientY: rect.top + 24 }));
  };
  #onContext = (event: MouseEvent): void => {
    const target = this.getTarget(event);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
    this.#target = target;
    const panel = this.#build(target.groups, 0);
    panel.dataset.keyboard = String(event.target === this.host);
    this.#place(panel, event.clientX, event.clientY);
    this.#buttons(panel)[0]?.focus({ preventScroll: true });
  };
  #trim(level: number): void {
    const parent = this.#parents[level - 1];
    const focused = this.#panels.slice(level).some(panel => panel.contains(document.activeElement));
    this.#panels.splice(level).forEach(panel => panel.remove());
    this.#parents.splice(Math.max(0, level - 1)).forEach(parent => parent.setAttribute("aria-expanded", "false"));
    if (focused && parent?.isConnected) parent.focus({ preventScroll: true });
  }
  #build(groups: TextMenuItem[][], level: number): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "text-context-menu";
    panel.dataset.keyboard = this.#panels[0]?.dataset.keyboard ?? "false";
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", level ? this.#parents[level - 1]?.textContent ?? t("context.menu") : t("context.menu"));
    groups.filter(group => group.length).forEach(group => {
      const section = document.createElement("div");
      section.className = "text-menu-group";
      section.setAttribute("role", "group");
      group.forEach(item => {
        const button = document.createElement("button");
        button.type = "button";
        button.tabIndex = -1;
        button.dataset.action = item.id;
        button.setAttribute("role", item.active !== undefined ? "menuitemcheckbox" : "menuitem");
        if (item.active !== undefined) button.setAttribute("aria-checked", String(item.active));
        button.disabled = Boolean(item.disabled);
        const icon = document.createElement("span");
        icon.className = "text-menu-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = iconMarkup(item.icon);
        const label = document.createElement("span");
        label.className = "text-menu-label";
        label.textContent = item.label;
        button.append(icon, label);
        const tail = document.createElement("span");
        tail.className = "text-menu-tail";
        tail.setAttribute("aria-hidden", "true");
        if (item.children) {
          button.setAttribute("aria-haspopup", "menu");
          button.setAttribute("aria-expanded", "false");
          tail.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 5 7 7-7 7"/></svg>';
        } else tail.textContent = item.active ? "✓" : item.shortcut ?? "";
        button.append(tail);
        button.addEventListener("pointerdown", event => event.preventDefault());
        button.addEventListener("pointerenter", () => {
          this.#panels.forEach(panel => { panel.dataset.keyboard = "false"; });
          this.#cancelHover();
          if (button.disabled) return;
          button.focus({ preventScroll: true });
          if (this.#parents[level] === button) return;
          this.#hoverTimer = window.setTimeout(() => {
            this.#hoverTimer = null;
            this.#trim(level + 1);
            if (item.children) this.#openSubmenu(item, button, level);
          }, 100);
        });
        button.addEventListener("click", () => {
          this.#cancelHover();
          if (item.children) this.#openSubmenu(item, button, level, true);
          else {
            const target = this.#target;
            this.close();
            if (!target?.restore()) return;
            void Promise.resolve().then(() => item.run?.()).catch(error =>
              message(t("context.failed", { err: String(error) }), { kind: "error" }),
            );
          }
        });
        // Keep actions on the panel instead of exposing editor state in DOM.
        button.addEventListener("open-submenu", () => this.#openSubmenu(item, button, level, true));
        section.appendChild(button);
      });
      panel.appendChild(section);
    });
    panel.addEventListener("pointerenter", () => this.#cancelHover());
    document.body.appendChild(panel);
    this.#panels[level] = panel;
    return panel;
  }
  #openSubmenu(item: TextMenuItem, parent: HTMLButtonElement, level: number, focus = false): void {
    if (!item.children) return;
    this.#trim(level + 1);
    this.#parents[level] = parent;
    parent.setAttribute("aria-expanded", "true");
    const panel = this.#build(item.children, level + 1);
    const rect = parent.getBoundingClientRect();
    const parentRect = this.#panels[level].getBoundingClientRect();
    const x = parentRect.right + panel.offsetWidth + 4 <= window.innerWidth - 8
      ? parentRect.right + 4 : parentRect.left - panel.offsetWidth - 4;
    this.#place(panel, x, rect.top - 5);
    if (focus) this.#buttons(panel)[0]?.focus({ preventScroll: true });
  }
  #place(panel: HTMLElement, x: number, y: number): void {
    panel.style.left = `${Math.max(8, Math.min(x, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(y, window.innerHeight - panel.offsetHeight - 8))}px`;
  }
  #buttons(panel: HTMLElement): HTMLButtonElement[] {
    return [...panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  }
  #focus(button?: HTMLButtonElement): void {
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  #onKey = (event: KeyboardEvent): void => {
    if (!this.#target || event.isComposing) return;
    const focused = document.activeElement as HTMLButtonElement;
    const level = this.#panels.findIndex(panel => panel.contains(focused));
    if (level < 0) { this.close(); return; }
    const buttons = this.#buttons(this.#panels[level]);
    const index = buttons.indexOf(focused);
    const key = event.key;
    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End", "Escape", "Tab", "Enter", " "].includes(key)) {
      if (event.ctrlKey || event.metaKey || event.altKey) this.close(true);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.#panels.forEach(panel => { panel.dataset.keyboard = "true"; });
    this.#cancelHover();
    if (key === "Escape" || key === "Tab") this.close(true);
    else if (key === "ArrowRight") focused.dispatchEvent(new Event("open-submenu"));
    else if (key === "ArrowLeft" && level > 0) {
      const parent = this.#parents[level - 1];
      this.#trim(level);
      parent.focus({ preventScroll: true });
    } else if (key === "Enter" || key === " ") focused.click();
    else if (key === "Home" || key === "End" || key === "ArrowUp" || key === "ArrowDown") {
      const next = key === "Home" ? 0 : key === "End" ? buttons.length - 1
        : (index + (key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
      this.#focus(buttons[next]);
    }
  };
}
