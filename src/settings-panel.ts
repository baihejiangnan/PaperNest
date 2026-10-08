// The settings GUI: a full-screen overlay that fades in over the editor
// (Ctrl/Cmd+, or the gear button). One control per hand-editable settings.toml
// key. The panel is "dumb" — it renders controls and reports every change via
// `onChange`; main.ts owns the settings object, the apply-functions and the
// debounced save. App-managed keys (window geometry, open files) are not shown.

import { t, type I18nKey } from "./i18n";
import { activateModal, deactivateModal } from "./modal";
import {
  formatShortcut,
  shortcutFromEvent,
  type ShortcutAction,
  type ShortcutSettings,
} from "./shortcuts";
import {
  FILE_CATEGORY_ORDER,
  allAssociationExtensions,
  associationExtensionsByCategory,
  type FileCategoryId,
} from "./file-types";

/** The subset of `Settings` (main.ts) the panel reads/writes. */
export interface PanelSettings {
  language: string;
  spellcheck: boolean;
  quit_on_escape: boolean;
  always_show_tabbar: boolean;
  markdown_only: boolean;
  open_last_session: boolean;
  show_path: boolean;
  list_marker: string;
  auto_save: boolean;
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
}

export type SettingKey = keyof PanelSettings;
export interface NewMdMenuStatus {
  available: boolean;
  enabled: boolean;
  can_modify: boolean;
  conflict: string | null;
}
type SettingValue = string | number | boolean | string[];
type SettingsTab = "general" | "editor" | "shortcuts" | "associations" | "updates";

const TAB_LABELS: Record<SettingsTab, I18nKey> = {
  general: "settings.tab.general", editor: "settings.tab.editor",
  shortcuts: "settings.tab.shortcuts", associations: "settings.tab.associations",
  updates: "settings.tab.updates",
};
const TAB_DESCRIPTIONS: Record<SettingsTab, I18nKey> = {
  general: "settings.description.general", editor: "settings.description.editor",
  shortcuts: "settings.description.shortcuts", associations: "settings.description.associations",
  updates: "settings.description.updates",
};
const ASSOCIATION_LABELS: Record<FileCategoryId, I18nKey> = {
  markdown: "settings.associations.category.markdown", config: "settings.associations.category.config",
  web: "settings.associations.category.web", code: "settings.associations.category.code",
  text: "settings.associations.category.text",
};
type SearchResult = { tab: SettingsTab; label: string; section: string; target: string; terms: string };

function settingsIcon(name: SettingsTab | "search"): SVGElement {
  const paths = {
    general: '<path d="m9 3-.5 2-2 1-2-.5-2 3.5 1.5 1.5v3L2.5 15l2 3.5 2-.5 2 1L9 21h6l.5-2 2-1 2 .5 2-3.5-1.5-1.5v-3L21.5 9l-2-3.5-2 .5-2-1L15 3z"/><circle cx="12" cy="12" r="3"/>',
    editor: '<path d="m4 17 12-12 3 3L7 20H4zm10-10 3 3"/>',
    shortcuts: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h1m3 0h1m3 0h1M8 16h8"/>',
    associations: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5"/>',
    updates: '<path d="M20 7a8 8 0 1 0 0 10M20 3v5h-5"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = paths[name]; // Static icon paths; labels and search use textContent.
  return svg;
}

type Field =
  | { key: SettingKey; kind: "checkbox"; label: I18nKey; hint?: I18nKey }
  | {
      key: SettingKey;
      kind: "select";
      label: I18nKey;
      hint?: I18nKey;
      options: { value: string; label: I18nKey }[];
    }
  | { key: SettingKey; kind: "text"; label: I18nKey; placeholder?: I18nKey }
  | { key: SettingKey; kind: "number"; label: I18nKey; min: number; max: number }
  | { key: SettingKey; kind: "color"; label: I18nKey; defaultColor?: string }
  | {
      key: SettingKey;
      colorKey: SettingKey;
      kind: "checkboxColor";
      label: I18nKey;
      defaultColor: string;
    }
  | { action: ShortcutAction; kind: "shortcut"; label: I18nKey }
  | { action: "open_with"; kind: "action"; label: I18nKey };

interface Section {
  tab: SettingsTab;
  title: I18nKey;
  fields?: Field[];
  custom?: "proxy";
}

const SECTIONS: Section[] = [
  {
    tab: "general",
    title: "settings.section.appearance",
    fields: [
      {
        key: "language",
        kind: "select",
        label: "settings.language",
        options: [
          { value: "system", label: "settings.language.system" },
          { value: "en", label: "settings.language.en" },
          { value: "de", label: "settings.language.de" },
          { value: "ja", label: "settings.language.ja" },
          { value: "zh-CN", label: "settings.language.zh-CN" },
        ],
      },
      {
        key: "accent",
        kind: "color",
        label: "settings.accent",
        defaultColor: "#8A5CF5",
      },
      {
        key: "color_scheme",
        kind: "select",
        label: "settings.colorScheme",
        options: [
          { value: "system", label: "settings.language.system" },
          { value: "light", label: "settings.colorScheme.light" },
          { value: "dark", label: "settings.colorScheme.dark" },
        ],
      },
    ],
  },
  {
    tab: "general",
    title: "settings.section.behavior",
    fields: [
      { key: "markdown_only", kind: "checkbox", label: "settings.markdownOnly" },
      { key: "confirm_delete", kind: "checkbox", label: "settings.confirmDelete" },
      { key: "quit_on_escape", kind: "checkbox", label: "settings.quitOnEscape" },
      {
        key: "always_show_tabbar",
        kind: "checkbox",
        label: "settings.alwaysShowTabbar",
      },
      {
        key: "open_last_session",
        kind: "checkbox",
        label: "settings.openLastSession",
      },
      {
        key: "remember_window_position",
        kind: "checkbox",
        label: "settings.rememberWindowPosition",
      },
    ],
  },
  {
    tab: "general",
    title: "settings.section.proxy",
    custom: "proxy",
  },
  {
    tab: "editor",
    title: "settings.section.editor",
    fields: [
      { key: "spellcheck", kind: "checkbox", label: "settings.spellcheck" },
      {
        key: "list_marker",
        kind: "select",
        label: "settings.listMarker",
        options: [
          { value: "*", label: "settings.language.system" }, // label overridden below
          { value: "-", label: "settings.language.system" },
          { value: "+", label: "settings.language.system" },
        ],
      },
      { key: "auto_save", kind: "checkbox", label: "settings.autoSave", hint: "settings.autoSave.hint" },
      { key: "show_path", kind: "checkbox", label: "settings.showPath" },
      {
        key: "code_alternate_rows",
        colorKey: "code_alternate_row_color",
        kind: "checkboxColor",
        label: "settings.codeAlternateRows",
        defaultColor: "#F6F6F6",
      },
    ],
  },
  {
    tab: "shortcuts",
    title: "settings.section.shortcuts",
    fields: [
      { action: "new_tab", kind: "shortcut", label: "settings.shortcut.newTab" },
      { action: "open", kind: "shortcut", label: "settings.shortcut.open" },
      { action: "save", kind: "shortcut", label: "settings.shortcut.save" },
      { action: "save_as", kind: "shortcut", label: "settings.shortcut.saveAs" },
      { action: "close_tab", kind: "shortcut", label: "settings.shortcut.closeTab" },
      { action: "export", kind: "shortcut", label: "settings.shortcut.export" },
      {
        action: "toggle_source",
        kind: "shortcut",
        label: "settings.shortcut.toggleSource",
      },
      { action: "find", kind: "shortcut", label: "settings.shortcut.find" },
      { action: "replace", kind: "shortcut", label: "settings.shortcut.replace" },
      { action: "emoji", kind: "shortcut", label: "settings.shortcut.emoji" },
      { action: "settings", kind: "shortcut", label: "settings.shortcut.settings" },
    ],
  },
  {
    tab: "editor",
    title: "settings.section.fonts",
    fields: [
      {
        key: "editor_font",
        kind: "text",
        label: "settings.editorFont",
        placeholder: "settings.editorFont.placeholder",
      },
      {
        key: "editor_font_size",
        kind: "number",
        label: "settings.editorFontSize",
        min: 8,
        max: 40,
      },
      {
        key: "source_font",
        kind: "text",
        label: "settings.sourceFont",
        placeholder: "settings.sourceFont.placeholder",
      },
      {
        key: "source_font_size",
        kind: "number",
        label: "settings.sourceFontSize",
        min: 8,
        max: 40,
      },
    ],
  },
  {
    tab: "updates",
    title: "settings.updatePreferences",
    fields: [
      {
        key: "auto_check_updates",
        kind: "checkbox",
        label: "settings.autoCheckUpdates",
        hint: "settings.autoCheckUpdates.hint",
      },
    ],
  },
];

export class SettingsPanel {
  #el: HTMLElement;
  #open = false;
  #activeTab: SettingsTab = "general";
  #fontPreview = false;
  #query = "";
  #compactTabs = window.matchMedia("(max-width: 600px)");
  #get: () => PanelSettings;
  #path = "";
  #capturingShortcut: ShortcutAction | null = null;
  #openWithAvailable = false;
  #openWithRegistered = false;
  #openWithManagedByMsi = false;
  #openWithCanModify = false;
  #openWithBusy = false;
  #proxyTestBusy = false;
  #proxyTestState: "idle" | "ok" | "error" = "idle";
  #proxyTestDetail = "";
  #associationAvailable = false;
  #associationBusy = false;
  #registeredExtensions = new Set<string>();
  #newMdStatus: NewMdMenuStatus = { available: false, enabled: false, can_modify: false, conflict: null };
  #newMdBusy = false;
  #newMdError = "";
  #appVersion = "";
  #updateBusy = false;
  #updateStatus = "";

  /** Reports every user change. main.ts applies + persists. */
  onChange: (key: SettingKey, value: SettingValue) => void =
    () => {};
  onShortcutChange: (action: ShortcutAction, value: string) => void = () => {};
  onOpenWithToggle: () => void | Promise<void> = () => {};
  onRegisterAssociations: (extensions: string[]) => Promise<void> = async () => {};
  onSetDefaultAssociations: (extensions: string[]) => Promise<void> = async () => {};
  onNewMdMenuToggle: (enabled: boolean) => Promise<void> = async () => {};
  onOpen: () => void = () => {};
  onCheckUpdates: () => Promise<string> = async () => "";
  onProxyTest: (proxyUrl: string) => Promise<void> = async () => {};
  /** Return focus to the editor after closing. */
  onClose: () => void = () => {};

  constructor(getSettings: () => PanelSettings) {
    this.#get = getSettings;
    this.#el = document.createElement("div");
    this.#el.id = "settings-panel";
    this.#el.hidden = true;
    document.body.appendChild(this.#el);
    this.#el.addEventListener("click", event => {
      if (event.target === this.#el) this.#dismiss();
    });
    this.#build();
    this.#compactTabs.addEventListener("change", () => {
      this.#el.querySelector(".settings-tabs")?.setAttribute("aria-orientation", this.#compactTabs.matches ? "horizontal" : "vertical");
    });
  }

  /** The settings.toml path shown in the footer (known after get_settings). */
  setPath(path: string): void {
    this.#path = path;
    const foot = this.#el.querySelector(".settings-foot");
    if (foot) {
      foot.textContent = `${t("settings.savedNote")}  ${t("settings.fileAt", {
        path,
      })}`;
    }
  }

  get isOpen(): boolean {
    return this.#open;
  }

  get isCapturingShortcut(): boolean {
    return this.#capturingShortcut !== null;
  }

  setOpenWithStatus(
    available: boolean,
    registered: boolean,
    managedByMsi: boolean,
    canModify: boolean,
  ): void {
    this.#openWithAvailable = available;
    this.#openWithRegistered = registered;
    this.#openWithManagedByMsi = managedByMsi;
    this.#openWithCanModify = canModify;
    this.#refreshOpenWithControl();
  }

  setOpenWithBusy(busy: boolean): void {
    this.#openWithBusy = busy;
    this.#refreshOpenWithControl();
  }

  setAssociationStatus(available: boolean, registeredExtensions: string[]): void {
    this.#associationAvailable = available;
    this.#registeredExtensions = new Set(registeredExtensions.map((ext) => ext.toLowerCase()));
    if (this.#activeTab === "associations") this.#renderActiveTab();
  }

  setNewMdMenuStatus(status: NewMdMenuStatus, error = ""): void {
    this.#newMdStatus = status;
    this.#newMdError = error;
    this.#refreshNewMdControls();
  }

  #refreshNewMdControls(): void {
    const box = this.#el.querySelector<HTMLElement>("[data-new-md-menu]");
    if (!box) return;
    box.hidden = !this.#newMdStatus.available;
    const toggle = box.querySelector<HTMLInputElement>("input")!;
    if (!this.#newMdBusy) toggle.checked = this.#newMdStatus.enabled;
    toggle.disabled = this.#newMdBusy || !this.#newMdStatus.can_modify;
    const note = box.querySelector<HTMLElement>("[data-new-md-status]")!;
    note.classList.toggle("error", Boolean(this.#newMdError));
    note.textContent = this.#newMdStatusText();
    note.setAttribute("role", this.#newMdError ? "alert" : "status");
  }

  #newMdStatusText(): string {
    const conflict = this.#newMdStatus.conflict;
    return this.#newMdError || t(this.#newMdBusy ? "settings.newMd.busy"
      : conflict === "existing" ? "settings.newMd.existing"
      : conflict === "other_installation" ? "settings.newMd.otherInstallation"
      : conflict === "modified" ? "settings.newMd.modified"
      : this.#newMdStatus.enabled ? "settings.newMd.enabled" : "settings.newMd.disabled");
  }

  setVersion(version: string): void {
    this.#appVersion = version;
    if (this.#activeTab === "updates") this.#renderActiveTab();
  }

  #refreshOpenWithControl(): void {
    const row = this.#el.querySelector<HTMLElement>('[data-system-action="open_with"]');
    const btn = row?.querySelector<HTMLButtonElement>(".settings-action");
    if (!row || !btn) return;
    row.hidden = !this.#openWithAvailable;
    btn.disabled = this.#openWithBusy || !this.#openWithCanModify;
    if (this.#openWithManagedByMsi && !this.#openWithCanModify) {
      btn.textContent = t("settings.openWith.installed");
    } else {
      btn.textContent = t(
        this.#openWithRegistered ? "settings.openWith.remove" : "settings.openWith.register",
      );
    }
  }

  open(): void {
    if (this.#open) return;
    this.#open = true;
    this.#el.hidden = false;
    if (this.#query) this.#setSearch("");
    this.refresh();
    this.onOpen();
    activateModal(this.#el, () => this.#dismiss(), this.#el.querySelector<HTMLElement>(".settings-tab.active") ?? undefined);
    // next frame so the transition runs from the hidden state
    requestAnimationFrame(() => {
      if (!this.#open) return;
      document.getElementById("app")?.classList.add("settings-open");
      this.#el.classList.add("open");
    });
  }

  close(): void {
    if (!this.#open) return;
    this.#capturingShortcut = null;
    this.#setFontPreview(false);
    this.#open = false;
    this.#el.classList.remove("open");
    document.getElementById("app")?.classList.remove("settings-open");
    this.#el.hidden = true;
    this.onClose();
    deactivateModal(this.#el);
  }

  /** Rewrite every control from the current settings. */
  refresh(): void {
    if (this.#query.trim()) return;
    if (this.#activeTab === "associations") {
      this.#renderActiveTab();
      return;
    }
    const s = this.#get();
    for (const section of SECTIONS) {
      if (section.custom === "proxy") {
        this.#refreshProxyControls();
        continue;
      }
      for (const f of section.fields ?? []) {
        if (f.kind === "action") {
          this.#refreshOpenWithControl();
          continue;
        }
        if (f.kind === "shortcut") {
          const btn = this.#el.querySelector<HTMLButtonElement>(
            `[data-shortcut="${f.action}"]`,
          );
          if (btn && this.#capturingShortcut !== f.action) {
            btn.textContent = formatShortcut(s.shortcuts[f.action]);
            btn.classList.remove("listening", "conflict");
            btn.title = "";
          }
          continue;
        }
        if (f.kind === "checkboxColor") {
          const row = this.#el.querySelector<HTMLElement>(`[data-key="${f.key}"]`);
          if (!row) continue;
          const cb = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
          if (cb) cb.checked = Boolean(s[f.key]);
          this.#refreshColorControl(
            row.querySelector<HTMLElement>(`[data-color-key="${f.colorKey}"]`),
            s[f.colorKey],
            getComputedStyle(document.documentElement).getPropertyValue("--surface-secondary").trim() || f.defaultColor,
          );
          continue;
        }
        const ctl = this.#el.querySelector<HTMLElement>(`[data-key="${f.key}"]`);
        if (!ctl) continue;
        const raw = s[f.key];
        if (f.kind === "checkbox") {
          (ctl as HTMLInputElement).checked = Boolean(raw);
        } else if (f.kind === "color") {
          this.#refreshColorControl(ctl, raw, f.defaultColor ?? "#8A5CF5");
        } else {
          (ctl as HTMLInputElement | HTMLSelectElement).value = String(raw ?? "");
        }
      }
    }
  }

  /** Re-label everything after a language change. */
  retranslate(): void {
    this.#capturingShortcut = null;
    this.#build();
    this.refresh();
    if (this.#open) this.#el.querySelector<HTMLElement>(this.#query.trim() ? ".settings-search-input" : ".settings-tab.active")?.focus();
  }

  #emit(key: SettingKey, value: SettingValue): void {
    this.onChange(key, value);
  }

  #dismiss(): void {
    if (this.#fontPreview) this.#setFontPreview(false, true);
    else if (this.#query.trim()) this.#setSearch("", true);
    else this.close();
  }

  #setSearch(value: string, focus = false): void {
    this.#query = value;
    this.#capturingShortcut = null;
    const input = this.#el.querySelector<HTMLInputElement>(".settings-search-input");
    if (input) input.value = value;
    const clear = this.#el.querySelector<HTMLButtonElement>(".settings-search-clear");
    if (clear) clear.hidden = !value;
    this.#renderActiveTab();
    this.refresh();
    if (focus) input?.focus();
  }

  #searchResults(): SearchResult[] {
    const results: SearchResult[] = [];
    const add = (tab: SettingsTab, label: I18nKey, section: I18nKey, target: string, terms = "") => {
      results.push({ tab, label: t(label), section: t(section), target, terms });
    };
    for (const section of SECTIONS) {
      for (const field of section.fields ?? []) {
        const target = "action" in field ? `shortcut-${field.action}` : field.key;
        const terms = [target, field.kind === "checkboxColor" ? field.colorKey : "", "hint" in field && field.hint ? t(field.hint) : "",
          field.kind === "select" ? field.options.map(option => t(option.label)).join(" ") : ""].join(" ");
        add(section.tab, field.label, section.title, target, terms);
      }
    }
    add("general", "settings.proxy.status", "settings.section.proxy", "proxy_enabled", "proxy_enabled");
    add("general", "settings.proxy.address", "settings.section.proxy", "proxy_url", "proxy_url HTTP SOCKS5");
    add("general", "settings.proxy.test", "settings.section.proxy", "proxy_test");
    add("updates", "settings.currentVersion", "settings.tab.updates", "current_version", "PaperNest GitHub Releases " + t("settings.updateSource"));
    add("updates", "update.check", "settings.tab.updates", "check_updates", t("settings.updateSource"));
    add("editor", "settings.fontPreview.start", "settings.section.fonts", "font_preview", t("settings.fontPreview.hint"));
    add("associations", "settings.tab.associations", "settings.tab.associations", "file_associations", "file_associations " + t("settings.associations.register") + " " + t("settings.associations.setDefault"));
    if (this.#newMdStatus.available) add("associations", "settings.newMd.label", "settings.newMd.section", "windows_new_md", "windows_new_md ShellNew MD " + t("settings.newMd.hint"));
    for (const category of FILE_CATEGORY_ORDER) {
      for (const ext of associationExtensionsByCategory(category)) {
        results.push({ tab: "associations", label: ext, section: t(ASSOCIATION_LABELS[category]), target: `association${ext}`, terms: ext });
      }
    }
    const words = this.#query.trim().toLocaleLowerCase().split(/\s+/);
    return results.filter(result => {
      const text = `${result.label} ${result.section} ${t(TAB_LABELS[result.tab])} ${result.terms}`.toLocaleLowerCase();
      return words.every(word => text.includes(word));
    });
  }

  #renderSearch(content: HTMLElement): void {
    const results = this.#searchResults();
    const summary = document.createElement("p");
    summary.className = "settings-search-summary";
    summary.setAttribute("role", "status");
    summary.textContent = results.length ? t("settings.search.count", { count: String(results.length) }) : t("settings.search.empty");
    content.appendChild(summary);
    const list = document.createElement("ul");
    list.className = "settings-search-results";
    list.addEventListener("keydown", event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const buttons = [...list.querySelectorAll<HTMLButtonElement>("button")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      if (event.key === "ArrowUp" && index === 0) {
        this.#el.querySelector<HTMLInputElement>(".settings-search-input")?.focus();
      } else {
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        buttons[next]?.focus();
      }
    });
    for (const result of results) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const label = document.createElement("strong");
      label.textContent = result.label;
      const location = document.createElement("span");
      location.textContent = `${t(TAB_LABELS[result.tab])} / ${result.section}`;
      button.append(label, location);
      button.addEventListener("click", () => {
        this.#activeTab = result.tab;
        this.#query = "";
        this.#build();
        this.refresh();
        const target = this.#el.querySelector<HTMLElement>(`[data-setting="${result.target}"]`);
        if (!target) return;
        target.scrollIntoView({ block: "center" });
        target.classList.add("settings-located");
        target.addEventListener("focusout", event => {
          if (!target.contains(event.relatedTarget as Node | null)) target.classList.remove("settings-located");
        });
        const control = target.matches("button, input, select") ? target
          : target.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), button:not(:disabled)");
        if (control && !control.matches(":disabled")) control.focus({ preventScroll: true });
        else {
          const fallback = target.matches(":disabled") ? target.parentElement! : target;
          fallback.tabIndex = -1;
          fallback.focus({ preventScroll: true });
        }
      });
      li.appendChild(button);
      list.appendChild(li);
    }
    content.appendChild(list);
  }

  #setFontPreview(enabled: boolean, focus = false): void {
    this.#fontPreview = enabled;
    this.#el.classList.toggle("font-preview", enabled);
    const toggle = this.#el.querySelector<HTMLButtonElement>(".settings-font-preview-toggle");
    if (toggle) {
      toggle.textContent = t(enabled ? "settings.fontPreview.end" : "settings.fontPreview.start");
      toggle.setAttribute("aria-pressed", String(enabled));
      if (focus) toggle.focus({ preventScroll: true });
    }
  }

  #normalizeHex(value: string, fallback: string): string {
    const raw = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
      const [r, g, b] = raw.slice(1).split("");
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    return fallback.toUpperCase();
  }

  #refreshColorControl(
    control: HTMLElement | null,
    value: unknown,
    fallback: string,
  ): void {
    if (!control) return;
    const color = control.querySelector<HTMLInputElement>('input[type="color"]');
    const text = control.querySelector<HTMLInputElement>('input[type="text"]');
    const hex = this.#normalizeHex(typeof value === "string" ? value : "", fallback);
    if (color) color.value = hex;
    if (text) text.value = hex;
  }

  #colorControl(
    key: SettingKey,
    defaultColor: string,
    showReset: boolean,
  ): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "settings-color";
    wrap.dataset.key = key;
    wrap.dataset.colorKey = key;

    const color = document.createElement("input");
    color.type = "color";
    color.setAttribute("aria-label", t(key === "accent" ? "settings.accent" : "settings.codeAlternateRows"));
    const text = document.createElement("input");
    text.type = "text";
    text.setAttribute("aria-label", t(key === "accent" ? "settings.accent" : "settings.codeAlternateRows"));
    text.placeholder = defaultColor;
    text.spellcheck = false;

    const commit = (raw: string, syncText: boolean) => {
      const hex = this.#normalizeHex(raw, defaultColor);
      color.value = hex;
      if (syncText) text.value = hex;
      this.#emit(key, hex);
    };

    color.addEventListener("input", () => commit(color.value, true));
    text.addEventListener("input", () => {
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text.value.trim())) {
        commit(text.value, false);
      }
    });
    text.addEventListener("change", () => commit(text.value, true));

    wrap.append(color, text);
    if (showReset) {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "settings-color-clear";
      reset.textContent = t("settings.accent.clear");
      reset.addEventListener("click", () => {
        if (key === "code_alternate_row_color") { this.#emit(key, ""); this.refresh(); }
        else commit(defaultColor, true);
      });
      wrap.appendChild(reset);
    }
    return wrap;
  }

  #build(): void {
    this.#setFontPreview(false);
    this.#el.replaceChildren();

    const card = document.createElement("div");
    card.className = "settings-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "settings-title");

    const title = document.createElement("h2");
    title.id = "settings-title";
    title.append(settingsIcon("general"), document.createTextNode(t("settings.title")));

    const head = document.createElement("div");
    head.className = "settings-head";
    const tabs = document.createElement("nav");
    tabs.className = "settings-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-orientation", this.#compactTabs.matches ? "horizontal" : "vertical");
    tabs.setAttribute("aria-label", t("settings.title"));
    tabs.addEventListener("keydown", event => {
      const buttons = [...tabs.querySelectorAll<HTMLButtonElement>("button")];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0 || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].click();
    });
    const tabDefs = Object.entries(TAB_LABELS) as Array<[SettingsTab, I18nKey]>;
    for (const [id, label] of tabDefs) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-tab";
      button.id = `settings-tab-${id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", "settings-tab-content");
      button.setAttribute("aria-selected", String(id === this.#activeTab));
      button.tabIndex = id === this.#activeTab ? 0 : -1;
      button.classList.toggle("active", id === this.#activeTab);
      button.append(settingsIcon(id), document.createTextNode(t(label)));
      button.addEventListener("click", () => {
        if (this.#activeTab === id && !this.#query.trim()) { button.focus(); return; }
        this.#query = "";
        this.#activeTab = id;
        this.#build();
        this.refresh();
        this.#el.querySelector<HTMLElement>(".settings-tab.active")?.focus();
      });
      tabs.appendChild(button);
    }
    const x = document.createElement("button");
    x.type = "button";
    x.className = "settings-close";
    x.setAttribute("aria-label", t("about.close"));
    x.textContent = "×";
    x.addEventListener("click", () => this.close());
    const search = document.createElement("div");
    search.className = "settings-search";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "settings-search-input";
    input.placeholder = t("settings.search.placeholder");
    input.setAttribute("aria-label", t("settings.search.placeholder"));
    input.setAttribute("aria-controls", "settings-tab-content");
    input.value = this.#query;
    input.addEventListener("input", () => this.#setSearch(input.value));
    input.addEventListener("keydown", event => {
      if (event.isComposing) return;
      if (event.key === "Enter" || event.key === "ArrowDown") {
        const first = this.#el.querySelector<HTMLButtonElement>(".settings-search-results button");
        if (!first) return;
        event.preventDefault();
        if (event.key === "Enter") first.click();
        else first.focus();
      }
    });
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "settings-search-clear";
    clear.textContent = "×";
    clear.hidden = !this.#query;
    clear.setAttribute("aria-label", t("settings.search.clear"));
    clear.addEventListener("click", () => this.#setSearch("", true));
    search.append(settingsIcon("search"), input, clear);
    head.append(title, search, x);
    card.appendChild(head);

    const body = document.createElement("div");
    body.className = "settings-body";
    body.appendChild(tabs);

    const content = document.createElement("div");
    content.className = "settings-content";
    content.id = "settings-tab-content";
    content.setAttribute("role", "tabpanel");
    content.setAttribute("aria-labelledby", `settings-tab-${this.#activeTab}`);
    body.appendChild(content);
    card.appendChild(body);
    const foot = document.createElement("p");
    foot.className = "settings-foot";
    card.appendChild(foot);
    this.#el.appendChild(card);
    this.setPath(this.#path);
    this.#renderActiveTab();
  }

  #renderActiveTab(): void {
    const content = this.#el.querySelector<HTMLElement>(".settings-content");
    if (!content) return;
    content.replaceChildren();
    const searching = Boolean(this.#query.trim());
    content.setAttribute("role", searching ? "region" : "tabpanel");
    content.removeAttribute("aria-labelledby");
    content.removeAttribute("aria-label");
    if (searching) content.setAttribute("aria-label", t("settings.search.title"));
    else content.setAttribute("aria-labelledby", `settings-tab-${this.#activeTab}`);
    for (const tab of this.#el.querySelectorAll<HTMLButtonElement>(".settings-tab")) {
      const active = !searching && tab.id === `settings-tab-${this.#activeTab}`;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    const heading = document.createElement("div");
    heading.className = "settings-page-heading";
    const headingTitle = document.createElement("h3");
    headingTitle.textContent = t(searching ? "settings.search.title" : TAB_LABELS[this.#activeTab]);
    heading.appendChild(headingTitle);
    if (!searching) {
      const description = document.createElement("p");
      description.textContent = t(TAB_DESCRIPTIONS[this.#activeTab]);
      heading.appendChild(description);
    }
    content.appendChild(heading);
    if (searching) { this.#renderSearch(content); return; }

    if (this.#activeTab === "associations") {
      content.appendChild(this.#newMdControls());
      content.appendChild(this.#associationControls());
    }
    if (this.#activeTab === "updates") {
      content.appendChild(this.#updateControls());
    }

    const sections = SECTIONS.filter((item) => item.tab === this.#activeTab)
      .sort((a, b) => Number(b.title === "settings.section.fonts") - Number(a.title === "settings.section.fonts"));
    for (const section of sections) {
      const fs = document.createElement("fieldset");
      const lg = document.createElement("legend");
      lg.textContent = t(section.title);
      fs.appendChild(lg);
      if (section.title === "settings.section.fonts") {
        fs.className = "settings-fonts";
        const hint = document.createElement("p");
        hint.className = "settings-font-preview-hint";
        hint.textContent = t("settings.fontPreview.hint");
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "settings-action settings-font-preview-toggle";
        toggle.dataset.setting = "font_preview";
        toggle.textContent = t("settings.fontPreview.start");
        toggle.setAttribute("aria-pressed", "false");
        toggle.addEventListener("click", () => this.#setFontPreview(!this.#fontPreview, true));
        fs.append(hint, toggle);
      }
      if (section.custom === "proxy") {
        fs.appendChild(this.#proxyControls());
      } else {
        for (const f of section.fields ?? []) fs.appendChild(this.#control(f));
      }
      content.appendChild(fs);
    }
  }

  #newMdControls(): HTMLElement {
    const box = document.createElement("fieldset");
    box.dataset.newMdMenu = "";
    box.hidden = !this.#newMdStatus.available;
    const legend = document.createElement("legend");
    legend.textContent = t("settings.newMd.section");
    const row = document.createElement("label");
    row.className = "settings-row settings-row--checkbox";
    row.dataset.setting = "windows_new_md";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-describedby", "settings-new-md-hint settings-new-md-status");
    toggle.checked = this.#newMdStatus.enabled;
    toggle.disabled = this.#newMdBusy || !this.#newMdStatus.can_modify;
    toggle.addEventListener("change", async () => {
      const enabled = toggle.checked;
      this.#newMdBusy = true;
      this.#newMdError = "";
      this.#refreshNewMdControls();
      try { await this.onNewMdMenuToggle(enabled); }
      catch (error) { this.#newMdError = t("settings.newMd.failed", { error: String(error) }); }
      finally { this.#newMdBusy = false; this.#refreshNewMdControls(); }
    });
    const text = document.createElement("span");
    text.textContent = t("settings.newMd.label");
    row.append(toggle, text);
    const hint = document.createElement("p");
    hint.id = "settings-new-md-hint";
    hint.className = "settings-association-note";
    hint.textContent = t("settings.newMd.hint");
    const status = document.createElement("p");
    status.id = "settings-new-md-status";
    status.dataset.newMdStatus = "";
    status.className = "settings-association-note";
    status.setAttribute("aria-live", "polite");
    status.textContent = this.#newMdStatusText();
    box.append(legend, row, hint, status);
    return box;
  }

  #associationControls(): HTMLElement {
    const wrap = document.createElement("section");
    wrap.className = "settings-associations";
    wrap.dataset.setting = "file_associations";

    const toolbar = document.createElement("div");
    toolbar.className = "settings-association-toolbar";
    const left = document.createElement("div");
    const right = document.createElement("div");
    left.className = "settings-association-actions";
    right.className = "settings-association-actions";

    const makeButton = (label: I18nKey, handler: () => void | Promise<void>) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-action";
      button.textContent = t(label);
      button.addEventListener("click", () => void handler());
      return button;
    };

    const all = makeButton("settings.associations.selectAll", () => {
      this.#emit("file_associations", allAssociationExtensions());
      this.#renderActiveTab();
    });
    const none = makeButton("settings.associations.selectNone", () => {
      this.#emit("file_associations", []);
      this.#renderActiveTab();
    });
    const register = makeButton("settings.associations.register", async () => {
      if (this.#associationBusy || !this.#associationAvailable || !this.#openWithCanModify) return;
      this.#associationBusy = true;
      this.#renderActiveTab();
      try {
        await this.onRegisterAssociations([...this.#get().file_associations]);
      } finally {
        this.#associationBusy = false;
        this.#renderActiveTab();
      }
    });
    const defaults = makeButton("settings.associations.setDefault", async () => {
      const selected = [...this.#get().file_associations];
      if (
        this.#associationBusy ||
        !this.#associationAvailable ||
        !this.#openWithCanModify ||
        selected.length === 0
      ) return;
      this.#associationBusy = true;
      this.#renderActiveTab();
      try {
        await this.onSetDefaultAssociations(selected);
      } finally {
        this.#associationBusy = false;
        this.#renderActiveTab();
      }
    });
    register.disabled =
      this.#associationBusy || !this.#associationAvailable || !this.#openWithCanModify;
    defaults.disabled =
      this.#associationBusy ||
      !this.#associationAvailable ||
      !this.#openWithCanModify ||
      this.#get().file_associations.length === 0;
    left.append(all, none);
    right.append(register, defaults);
    toolbar.append(left, right);
    wrap.appendChild(toolbar);

    const selected = new Set(this.#get().file_associations.map((ext) => ext.toLowerCase()));

    for (const category of FILE_CATEGORY_ORDER) {
      const group = document.createElement("div");
      group.className = "settings-association-group";
      const title = document.createElement("h3");
      title.textContent = t(ASSOCIATION_LABELS[category]);
      const grid = document.createElement("div");
      grid.className = "settings-association-grid";
      for (const ext of associationExtensionsByCategory(category)) {
        const item = document.createElement("label");
        item.className = "settings-association-item";
        item.dataset.setting = `association${ext}`;
        item.classList.toggle("registered", this.#registeredExtensions.has(ext));
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(ext);
        checkbox.addEventListener("change", () => {
          const current = new Set(this.#get().file_associations.map((item) => item.toLowerCase()));
          if (checkbox.checked) current.add(ext);
          else current.delete(ext);
          const ordered = allAssociationExtensions().filter((item) => current.has(item));
          this.#emit("file_associations", ordered);
        });
        const text = document.createElement("code");
        text.textContent = ext;
        item.append(checkbox, text);
        grid.appendChild(item);
      }
      group.append(title, grid);
      wrap.appendChild(group);
    }

    if (!this.#associationAvailable) {
      const note = document.createElement("p");
      note.className = "settings-association-note";
      note.textContent = t("settings.associations.windowsOnly");
      wrap.appendChild(note);
    } else if (!this.#openWithCanModify) {
      const note = document.createElement("p");
      note.className = "settings-association-note";
      note.textContent = t("settings.openWith.installed");
      wrap.appendChild(note);
    }
    return wrap;
  }

  #updateControls(): HTMLElement {
    const box = document.createElement("section");
    box.className = "settings-update-box";
    box.dataset.setting = "current_version";
    const icon = document.createElement("div");
    icon.className = "settings-update-icon";
    icon.appendChild(settingsIcon("updates"));
    const copy = document.createElement("div");
    copy.className = "settings-update-copy";
    const versionLabel = document.createElement("span");
    versionLabel.className = "settings-update-caption";
    versionLabel.textContent = t("settings.currentVersion");
    const name = document.createElement("h4");
    name.textContent = "PaperNest ";
    const version = document.createElement("code");
    version.className = "settings-version";
    version.textContent = this.#appVersion ? `v${this.#appVersion}` : "—";
    name.appendChild(version);
    const source = document.createElement("p");
    source.className = "settings-update-source";
    source.textContent = t("settings.updateSource");
    const status = document.createElement("p");
    status.className = "settings-update-status";
    status.setAttribute("role", "status");
    status.textContent = this.#updateBusy ? t("update.checking") : this.#updateStatus;
    status.hidden = !status.textContent;
    copy.append(versionLabel, name, source, status);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-action";
    button.dataset.setting = "check_updates";
    button.disabled = this.#updateBusy;
    button.textContent = this.#updateBusy ? t("update.checking") : t("update.check");
    button.addEventListener("click", async () => {
      if (this.#updateBusy) return;
      this.#updateBusy = true;
      this.#updateStatus = "";
      this.#refreshUpdateControls();
      try {
        this.#updateStatus = await this.onCheckUpdates();
      } catch (err) {
        this.#updateStatus = t("update.failed", { err: String(err) });
      } finally {
        this.#updateBusy = false;
        this.#refreshUpdateControls();
      }
    });
    box.append(icon, copy, button);
    return box;
  }

  #refreshUpdateControls(): void {
    const button = this.#el.querySelector<HTMLButtonElement>('[data-setting="check_updates"]');
    if (button) {
      button.disabled = this.#updateBusy;
      button.textContent = t(this.#updateBusy ? "update.checking" : "update.check");
    }
    const status = this.#el.querySelector<HTMLElement>(".settings-update-status");
    if (status) {
      status.textContent = this.#updateBusy ? t("update.checking") : this.#updateStatus;
      status.hidden = !status.textContent;
    }
  }

  #proxyControls(): DocumentFragment {
    const fragment = document.createDocumentFragment();

    const statusRow = document.createElement("div");
    statusRow.className = "settings-row settings-row--proxy";
    statusRow.dataset.setting = "proxy_enabled";
    const statusLabel = document.createElement("span");
    statusLabel.className = "settings-label";
    statusLabel.textContent = t("settings.proxy.status");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "settings-action settings-proxy-toggle";
    toggle.dataset.proxyToggle = "true";
    toggle.addEventListener("click", () => {
      this.#emit("proxy_enabled", !this.#get().proxy_enabled);
      this.#proxyTestState = "idle";
      this.#proxyTestDetail = "";
      this.#refreshProxyControls();
    });
    statusRow.append(statusLabel, toggle);

    const addressRow = document.createElement("label");
    addressRow.className = "settings-row settings-row--proxy";
    addressRow.dataset.setting = "proxy_url";
    const addressLabel = document.createElement("span");
    addressLabel.className = "settings-label";
    addressLabel.textContent = t("settings.proxy.address");
    const address = document.createElement("input");
    address.type = "text";
    address.spellcheck = false;
    address.className = "settings-proxy-address";
    address.dataset.key = "proxy_url";
    address.placeholder = "http://127.0.0.1:7897  /  socks5://127.0.0.1:7893";
    address.addEventListener("change", () => {
      this.#proxyTestState = "idle";
      this.#proxyTestDetail = "";
      this.#emit("proxy_url", address.value.trim());
      this.#refreshProxyControls();
    });
    addressRow.append(addressLabel, address);

    const testRow = document.createElement("div");
    testRow.className = "settings-row settings-row--proxy";
    testRow.dataset.setting = "proxy_test";
    const testLabel = document.createElement("span");
    testLabel.className = "settings-label";
    testLabel.textContent = t("settings.proxy.test");
    const testWrap = document.createElement("span");
    testWrap.className = "settings-proxy-test";
    const testButton = document.createElement("button");
    testButton.type = "button";
    testButton.className = "settings-action";
    testButton.dataset.proxyTest = "true";
    testButton.textContent = t("settings.proxy.testButton");
    testButton.addEventListener("click", async () => {
      if (this.#proxyTestBusy) return;
      const value =
        this.#el.querySelector<HTMLInputElement>('[data-key="proxy_url"]')?.value.trim() ??
        this.#get().proxy_url.trim();
      if (!value) {
        this.#proxyTestState = "error";
        this.#proxyTestDetail = t("settings.proxy.addressRequired");
        this.#refreshProxyControls();
        return;
      }
      this.#proxyTestBusy = true;
      this.#proxyTestState = "idle";
      this.#proxyTestDetail = "";
      this.#refreshProxyControls();
      try {
        await this.onProxyTest(value);
        this.#proxyTestState = "ok";
      } catch (err) {
        this.#proxyTestState = "error";
        this.#proxyTestDetail = String(err);
      } finally {
        this.#proxyTestBusy = false;
        this.#refreshProxyControls();
      }
    });
    const result = document.createElement("span");
    result.className = "settings-proxy-result";
    result.dataset.proxyResult = "true";
    testWrap.append(testButton, result);
    testRow.append(testLabel, testWrap);

    fragment.append(statusRow, addressRow, testRow);
    // Construction happens before settings arrive from Rust. Hidden controls
    // are populated by refresh() when the panel opens; do not read them early.
    requestAnimationFrame(() => {
      if (this.#open) this.#refreshProxyControls();
    });
    return fragment;
  }

  #refreshProxyControls(): void {
    const s = this.#get();
    const toggle = this.#el.querySelector<HTMLButtonElement>("[data-proxy-toggle]");
    if (toggle) {
      toggle.textContent = t(
        s.proxy_enabled ? "settings.proxy.enabled" : "settings.proxy.disabled",
      );
      toggle.classList.toggle("active", s.proxy_enabled);
      toggle.setAttribute("aria-pressed", String(s.proxy_enabled));
    }

    const address = this.#el.querySelector<HTMLInputElement>('[data-key="proxy_url"]');
    if (address && document.activeElement !== address) {
      address.value = s.proxy_url ?? "";
    }

    const button = this.#el.querySelector<HTMLButtonElement>("[data-proxy-test]");
    if (button) {
      button.disabled = this.#proxyTestBusy;
      button.textContent = this.#proxyTestBusy
        ? t("settings.proxy.testing")
        : t("settings.proxy.testButton");
    }

    const result = this.#el.querySelector<HTMLElement>("[data-proxy-result]");
    if (result) {
      result.classList.toggle("ok", this.#proxyTestState === "ok");
      result.classList.toggle("error", this.#proxyTestState === "error");
      result.textContent =
        this.#proxyTestState === "ok"
          ? t("settings.proxy.ok")
          : this.#proxyTestState === "error"
            ? t("settings.proxy.failed")
            : "";
      result.title = this.#proxyTestDetail;
    }
  }

  #control(f: Field): HTMLElement {
    const row = document.createElement(
      f.kind === "shortcut" || f.kind === "action" || f.kind === "checkboxColor"
        ? "div"
        : "label",
    );
    row.className = "settings-row settings-row--" + f.kind;
    row.dataset.setting = "action" in f ? `shortcut-${f.action}` : f.key;

    const labelText = document.createElement("span");
    labelText.className = "settings-label";
    labelText.textContent = t(f.label);
    if ((f.kind === "select" || (f.kind === "checkbox" && f.key !== "auto_check_updates")) && f.hint) {
      const hint = document.createElement("span");
      hint.className = "settings-hint-text";
      hint.textContent = " — " + t(f.hint);
      labelText.appendChild(hint);
    }

    let control: HTMLElement;
    if (f.kind === "checkboxColor") {
      row.dataset.key = f.key;
      const left = document.createElement("label");
      left.className = "settings-checkbox-inline";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.key = f.key;
      cb.addEventListener("change", () => this.#emit(f.key, cb.checked));
      left.append(cb, labelText);
      const color = this.#colorControl(f.colorKey, f.defaultColor, true);
      row.append(left, color);
      return row;
    }

    if (f.kind === "checkbox") {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.key = f.key;
      cb.addEventListener("change", () => this.#emit(f.key, cb.checked));
      control = cb;
      if (f.key === "auto_check_updates") {
        cb.checked = this.#open && Boolean(this.#get().auto_check_updates);
        row.classList.add("settings-row--update-toggle");
        const copy = document.createElement("span");
        copy.className = "settings-toggle-copy";
        copy.appendChild(labelText);
        if (f.hint) {
          const hint = document.createElement("span");
          hint.className = "settings-toggle-hint";
          hint.textContent = t(f.hint);
          copy.appendChild(hint);
          hint.id = "settings-auto-update-hint";
          cb.setAttribute("aria-describedby", hint.id);
        }
        cb.setAttribute("role", "switch");
        cb.setAttribute("aria-label", t(f.label));
        row.append(copy, cb);
        return row;
      }
      row.prepend(cb);
      row.append(labelText);
      return row;
    }

    row.append(labelText);

    if (f.kind === "action") {
      row.dataset.systemAction = f.action;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-action";
      btn.addEventListener("click", async () => {
        if (this.#openWithBusy) return;
        this.setOpenWithBusy(true);
        try {
          await this.onOpenWithToggle();
        } finally {
          this.setOpenWithBusy(false);
        }
      });
      row.append(btn);
      this.#refreshOpenWithControl();
      return row;
    }

    if (f.kind === "shortcut") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "settings-shortcut";
      btn.dataset.shortcut = f.action;
      // Settings are loaded asynchronously after this panel is constructed;
      // `refresh()` fills the real binding once bootstrap has the payload.
      btn.textContent = "—";
      btn.addEventListener("click", () => {
        this.#capturingShortcut = f.action;
        this.#el.querySelectorAll<HTMLButtonElement>(".settings-shortcut").forEach((other) => {
          if (other !== btn) {
            other.classList.remove("listening", "conflict");
            const action = other.dataset.shortcut as ShortcutAction;
            other.textContent = formatShortcut(this.#get().shortcuts[action]);
            other.title = "";
          }
        });
        btn.classList.add("listening");
        btn.classList.remove("conflict");
        btn.textContent = t("settings.shortcut.capture");
        btn.title = t("settings.shortcut.cancelHint");
        btn.focus();
      });
      btn.addEventListener("keydown", (e) => {
        if (this.#capturingShortcut !== f.action) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          this.#capturingShortcut = null;
          btn.classList.remove("listening", "conflict");
          btn.textContent = formatShortcut(this.#get().shortcuts[f.action]);
          btn.title = "";
          return;
        }
        const binding = shortcutFromEvent(e);
        if (!binding) return;
        const duplicate = Object.entries(this.#get().shortcuts).find(
          ([action, value]) => action !== f.action && value === binding,
        );
        if (duplicate) {
          btn.classList.add("conflict");
          btn.textContent = t("settings.shortcut.conflict");
          window.setTimeout(() => {
            if (this.#capturingShortcut === f.action) {
              btn.classList.remove("conflict");
              btn.textContent = t("settings.shortcut.capture");
            }
          }, 900);
          return;
        }
        this.#capturingShortcut = null;
        btn.classList.remove("listening", "conflict");
        btn.textContent = formatShortcut(binding);
        btn.title = "";
        this.onShortcutChange(f.action, binding);
      });
      row.append(btn);
      return row;
    }

    if (f.kind === "select") {
      const sel = document.createElement("select");
      sel.dataset.key = f.key;
      for (const o of f.options) {
        const opt = document.createElement("option");
        opt.value = o.value;
        // list_marker options show the literal marker, not a translated label
        opt.textContent = f.key === "list_marker" ? o.value : t(o.label);
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => this.#emit(f.key, sel.value));
      control = sel;
    } else if (f.kind === "number") {
      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = String(f.min);
      inp.max = String(f.max);
      inp.dataset.key = f.key;
      inp.addEventListener("input", () => {
        // An empty or partial number must remain editable, without saving 0/NaN.
        if (inp.value !== "" && inp.validity.valid) this.#emit(f.key, Number(inp.value));
      });
      inp.addEventListener("change", () => {
        const n = Math.max(f.min, Math.min(f.max, Number(inp.value) || f.min));
        inp.value = String(n);
        this.#emit(f.key, n);
      });
      control = inp;
    } else if (f.kind === "color") {
      control = this.#colorControl(f.key, f.defaultColor ?? "#8A5CF5", true);
    } else {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.spellcheck = false;
      if (f.placeholder) inp.placeholder = t(f.placeholder);
      inp.dataset.key = f.key;
      inp.addEventListener("input", () => this.#emit(f.key, inp.value.trim()));
      inp.addEventListener("change", () => this.#emit(f.key, inp.value.trim()));
      control = inp;
    }

    row.append(control);
    return row;
  }
}
