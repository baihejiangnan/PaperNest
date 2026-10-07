import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { tabPathKey } from "./tab-path";

interface Entry { name: string; path: string; is_dir: boolean }
export interface LinkChoice { href: string; text?: string }
interface PickerOptions {
  value: string;
  docPath: string | null;
  anchor: { left: number; top: number; bottom: number };
  isCurrent: () => boolean;
  restore: () => boolean;
}

const safeTarget = (value: string) => Boolean(value.trim()) && !/^(javascript|data|vbscript):/i.test(value.trim());
function parentOf(path: string): string | null {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index < 0) return null;
  return path.slice(0, index === 0 || index === 2 && /^[a-z]:/i.test(path) ? index + 1 : index);
}
function fileChoice(entry: Entry): LinkChoice {
  const encoded = encodeURIComponent(entry.name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return { href: `./${encoded}`, text: entry.name.replace(/\.(md|markdown)$/i, "") };
}

/** Non-modal link input anchored to the selection; directory reads use existing IPC. */
export class LinkPicker {
  #panel: HTMLElement | null = null;
  #input!: HTMLInputElement;
  #list!: HTMLElement;
  #status!: HTMLElement;
  #submit!: HTMLButtonElement;
  #options: PickerOptions | null = null;
  #resolve: ((choice: LinkChoice | null) => void) | null = null;
  #entries: Entry[] = [];
  #results: Entry[] = [];
  #active = -1;
  #state: "loading" | "ready" | "unsaved" | "error" = "ready";

  open(options: PickerOptions): Promise<LinkChoice | null> {
    this.close();
    if (!options.isCurrent()) return Promise.resolve(null);
    this.#options = options;
    this.#entries = [];
    const directory = options.docPath ? parentOf(options.docPath) : null;
    this.#state = directory ? "loading" : "unsaved";
    const panel = document.createElement("div");
    this.#panel = panel;
    panel.className = "link-picker";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("context.linkPicker"));
    panel.innerHTML = `<div class="link-picker-field"><input type="text" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="link-picker-files" autocomplete="off" spellcheck="false"><button type="button" class="link-picker-submit">↵</button><button type="button" class="link-picker-close">×</button></div><div class="link-picker-caption"></div><div class="link-picker-files" id="link-picker-files" role="listbox"></div><div class="link-picker-status" role="status"></div><div class="link-picker-hint"></div>`;
    this.#input = panel.querySelector("input")!;
    this.#list = panel.querySelector(".link-picker-files")!;
    this.#status = panel.querySelector(".link-picker-status")!;
    this.#submit = panel.querySelector(".link-picker-submit")!;
    this.#input.value = options.value;
    this.#input.placeholder = t("context.linkPlaceholder");
    this.#input.setAttribute("aria-label", t("context.linkTarget"));
    this.#list.setAttribute("aria-label", t("context.siblingFiles"));
    this.#submit.title = t("context.applyLink");
    this.#submit.setAttribute("aria-label", t("context.applyLink"));
    const close = panel.querySelector<HTMLButtonElement>(".link-picker-close")!;
    close.title = t("context.cancelLink");
    close.setAttribute("aria-label", close.title);
    close.onclick = () => this.close(true);
    this.#submit.onclick = () => this.#choose({ href: this.#input.value.trim() });
    panel.querySelector(".link-picker-caption")!.textContent = t("context.siblingFiles");
    panel.querySelector(".link-picker-hint")!.textContent = t("context.linkHint");
    this.#input.addEventListener("input", () => this.#render());
    document.body.appendChild(panel);
    this.#render();
    this.#input.focus({ preventScroll: true });
    this.#input.select();
    document.addEventListener("pointerdown", this.#outside, true);
    document.addEventListener("keydown", this.#key, true);
    document.addEventListener("scroll", this.#scroll, true);
    window.addEventListener("resize", this.#dismiss);
    const result = new Promise<LinkChoice | null>(resolve => { this.#resolve = resolve; });
    if (directory) void invoke<{ entries: Entry[] }>("list_workspace_dir", { path: directory }).then(value => {
      if (this.#options !== options) return;
      if (!options.isCurrent()) { this.close(); return; }
      this.#entries = value.entries.filter(entry => !entry.is_dir && tabPathKey(entry.path) !== tabPathKey(options.docPath!))
        .sort((a, b) => a.name.localeCompare(b.name, document.documentElement.lang, { numeric: true, sensitivity: "base" }));
      this.#state = "ready";
      this.#render();
    }).catch(() => {
      if (this.#options !== options) return;
      this.#state = "error";
      this.#render();
    });
    return result;
  }

  close(restore = false, choice: LinkChoice | null = null): void {
    const options = this.#options, resolve = this.#resolve;
    this.#panel?.remove();
    this.#panel = null;
    this.#options = null;
    this.#resolve = null;
    document.removeEventListener("pointerdown", this.#outside, true);
    document.removeEventListener("keydown", this.#key, true);
    document.removeEventListener("scroll", this.#scroll, true);
    window.removeEventListener("resize", this.#dismiss);
    if (restore) options?.restore();
    resolve?.(choice);
  }
  #dismiss = () => this.close();
  #outside = (event: PointerEvent) => { if (!this.#panel?.contains(event.target as Node)) this.close(); };
  #scroll = (event: Event) => { if (!this.#panel?.contains(event.target as Node)) this.close(); };
  #choose(choice: LinkChoice): void {
    if (!this.#options?.isCurrent()) { this.close(); return; }
    if (!safeTarget(choice.href)) return;
    this.close(false, choice);
  }
  #key = (event: KeyboardEvent): void => {
    if (!this.#panel || event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); this.close(true);
    } else if (event.target === this.#input && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === "Enter") {
        const entry = this.#results[this.#active];
        this.#choose(entry ? fileChoice(entry) : { href: this.#input.value.trim() });
      } else if (this.#results.length) {
        this.#active = (this.#active + (event.key === "ArrowDown" ? 1 : -1) + this.#results.length) % this.#results.length;
        this.#markActive(true);
      }
    }
  };
  #render(): void {
    const query = this.#input.value.trim().toLocaleLowerCase().replace(/^\.\//, "");
    this.#results = this.#entries.filter(entry => entry.name.toLocaleLowerCase().includes(query)).slice(0, 200);
    this.#active = this.#results.length ? 0 : -1;
    this.#list.replaceChildren();
    this.#results.forEach((entry, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "link-picker-file";
      row.id = `link-picker-file-${index}`;
      row.setAttribute("role", "option");
      row.title = entry.name;
      const icon = document.createElement("span");
      icon.className = "link-picker-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h8"/></svg>';
      const label = document.createElement("span");
      label.textContent = entry.name;
      row.append(icon, label);
      row.addEventListener("pointerdown", event => event.preventDefault());
      row.addEventListener("pointerenter", () => { this.#active = index; this.#markActive(); });
      row.onclick = () => this.#choose(fileChoice(entry));
      this.#list.appendChild(row);
    });
    this.#markActive();
    this.#submit.disabled = !safeTarget(this.#input.value);
    const invalid = this.#input.value.trim() && !safeTarget(this.#input.value);
    this.#input.setAttribute("aria-invalid", String(Boolean(invalid)));
    this.#status.textContent = invalid ? t("context.linkInvalid") : this.#state === "loading" ? t("context.linkLoading")
      : this.#state === "unsaved" ? t("context.linkUnsaved") : this.#state === "error" ? t("context.linkReadFailed")
      : !this.#results.length ? t("context.linkNoFiles") : "";
    this.#status.hidden = !this.#status.textContent;
    this.#list.hidden = !this.#results.length;
    this.#position();
  }
  #markActive(scroll = false): void {
    [...this.#list.children].forEach((row, index) => row.setAttribute("aria-selected", String(index === this.#active)));
    const row = this.#list.children[this.#active];
    if (row) this.#input.setAttribute("aria-activedescendant", row.id);
    else this.#input.removeAttribute("aria-activedescendant");
    if (scroll) row?.scrollIntoView({ block: "nearest" });
  }
  #position(): void {
    if (!this.#panel || !this.#options) return;
    const panel = this.#panel, anchor = this.#options.anchor;
    const y = anchor.bottom + panel.offsetHeight + 6 <= window.innerHeight - 8 ? anchor.bottom + 6 : anchor.top - panel.offsetHeight - 6;
    panel.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(y, window.innerHeight - panel.offsetHeight - 8))}px`;
  }
}
