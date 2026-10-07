// Thin wrapper around Milkdown Crepe: one editor instance, documents are
// swapped in place (tabbed editing keeps a single instance — see tabs.ts).
import { invoke } from "@tauri-apps/api/core";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import { $prose, replaceAll } from "@milkdown/kit/utils";
import { editorViewCtx } from "@milkdown/kit/core";
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import { linkFromClipboard } from "./link-clipboard";
import {
  installBlockMenu,
  runBlockAction,
  runInsertAction,
  type BlockActionId,
  type BlockMenuHandle,
} from "./block-menu";
import { emojiInputRule } from "./emoji";
import { t } from "./i18n";
import {
  configureMarkdownSerializer,
  type ListMarker,
} from "./markdown-serializer";
import { patchImageBlockMarkdown } from "./image-block-markdown";
import { imageToolbarPlugin } from "./image-toolbar";
import {
  IMAGE_PREVIEW_EVENT,
  ImagePreview,
  type ImagePreviewRequest,
} from "./image-preview";
import {
  patchHtmlMarkdown,
  refreshSafeRawHtml,
  resolveRawHtmlImages,
  safeHtmlPresentationPlugin,
} from "./html-markdown";
import { mikuCreamCodeMirrorTheme } from "./miku-cream";
import { EditorView as CodeView } from "@codemirror/view";
import { TextContextMenu } from "./text-context-menu";
import { LinkPicker } from "./link-picker";
import { richContextTarget, codeContextTarget } from "./text-context-actions";
import {
  findKey,
  findPlugin,
  statusOf,
  activeMatch,
  allMatches,
  type FindStatus,
} from "./find";

export class Editor {
  private crepe: Crepe | null = null;
  private blockMenu: BlockMenuHandle | null = null;
  private readonly host: HTMLElement;
  private readonly imagePreview = new ImagePreview();
  private lineNumberFrame: number | null = null;
  private readonly presentationObserver: MutationObserver;
  private readonly contextMenu: TextContextMenu;
  private readonly linkPicker = new LinkPicker();
  private readonly copyFeedbackTimers = new WeakMap<
    HTMLButtonElement,
    [number, number]
  >();
  private listMarker: ListMarker = "*";
  /** Path of the document in the active tab — the base for relative images. */
  private docPath: string | null = null;
  /** Changes when the host replaces the document or destroys its editor. */
  private documentGeneration = 0;
  private proxyEnabled = false;
  private proxyUrl = "";
  /** Resolved `data:` URLs, keyed by `docPath \0 src`. */
  private readonly imageCache = new Map<string, string>();

  /** Fires with Milkdown's already serialized Markdown after a content change. */
  onChange: (markdown: string) => void = () => {};
  /** Fires whenever the ProseMirror selection changes. */
  onSelectionChange: () => void = () => {};
  /** Opens a rendered Markdown link through the host application's routing. */
  onLinkClick: (href: string) => void = () => {};
  onFindRequest: (text: string) => void = () => {};
  getFindShortcut: () => string = () => "";

  constructor(host: HTMLElement) {
    this.host = host;
    this.contextMenu = new TextContextMenu(host, event => {
      const view = this.view();
      if (!view || event.target instanceof Element && event.target.closest("input, textarea, button")) return null;
      const generation = this.documentGeneration;
      const isCurrent = () => this.view() === view && generation === this.documentGeneration && !this.host.hidden;
      const codeDom = event.target instanceof Element ? event.target.closest<HTMLElement>(".cm-editor") : null;
      const code = codeDom ? CodeView.findFromDOM(codeDom) : null;
      const options = { isCurrent, find: (text: string) => this.onFindRequest(text), findShortcut: this.getFindShortcut() };
      if (code) return codeContextTarget(code, event, options);
      return richContextTarget(view, event, {
        ...options,
        pickLink: (value, restore) => {
          const doc = view.state.doc;
          return this.linkPicker.open({ value, restore, docPath: this.docPath,
            anchor: view.coordsAtPos(view.state.selection.to), isCurrent: () => isCurrent() && view.state.doc === doc });
        },
        block: id => this.runBlockAction(id),
        insert: id => { if (this.crepe) runInsertAction(this.crepe, id); },
      });
    });
    this.host.addEventListener(IMAGE_PREVIEW_EVENT, (event) => {
      const { src, alt } = (event as CustomEvent<ImagePreviewRequest>).detail;
      void Promise.resolve(this.resolveImageSrc(src)).then((resolved) => {
        this.imagePreview.open(resolved, alt);
      });
    });
    this.host.addEventListener("click", this.handleCodeToolClick);
    this.host.addEventListener("click", this.handleLatexPreviewClick);
    this.host.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>(".ProseMirror a[href]");
      const rawLink = target?.closest<HTMLElement>(".ProseMirror [data-mdmeow-link-href]");
      const href = (anchor?.getAttribute("href") ?? rawLink?.dataset.mdmeowLinkHref)?.trim();
      if (!href || href.startsWith("#")) return;
      event.preventDefault();
      event.stopPropagation();
      this.onLinkClick(href);
    }, { capture: true });
    this.host.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest<HTMLElement>(".ProseMirror [data-mdmeow-link-href]");
      if (!link || event.target !== link) return;
      event.preventDefault();
      event.stopPropagation();
      this.onLinkClick(link.dataset.mdmeowLinkHref ?? "");
    }, { capture: true });
    this.presentationObserver = new MutationObserver((mutations) => {
      let codeChanged = false;
      let imagesAdded = false;
      for (const mutation of mutations) {
        const target =
          mutation.target instanceof Element
            ? mutation.target
            : mutation.target.parentElement;
        if (target?.closest(".mdmeow-code-line-numbers")) continue;

        if (target?.closest(".milkdown-code-block")) {
          codeChanged = true;
        }

        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches(".milkdown-code-block, .cm-content, .cm-line") ||
            node.querySelector(".milkdown-code-block, .cm-content, .cm-line")
          ) {
            codeChanged = true;
          }
          // ProseMirror can recreate HTML images while applying structural
          // decorations. Resolve the replacement node as well as the initial
          // one; a pending read may still belong to a detached old node.
          if (
            node.matches('img[data-mdmeow-html-img="true"]') ||
            node.querySelector('img[data-mdmeow-html-img="true"]')
          ) {
            imagesAdded = true;
          }
        }
      }
      if (codeChanged) this.scheduleExternalCodeLineNumbers();
      if (imagesAdded) this.resolveHtmlImages();
    });
    this.presentationObserver.observe(this.host, {
      childList: true,
      subtree: true,
    });
  }

  private resolveHtmlImages(): void {
    const generation = this.documentGeneration;
    const docPath = this.docPath;
    resolveRawHtmlImages(this.host, this.resolveImageSrc, () =>
      generation === this.documentGeneration && docPath === this.docPath,
    );
  }

  private scheduleExternalCodeLineNumbers(): void {
    if (this.lineNumberFrame !== null) {
      window.cancelAnimationFrame(this.lineNumberFrame);
    }
    this.lineNumberFrame = window.requestAnimationFrame(() => {
      this.lineNumberFrame = null;
      this.renderExternalCodeLineNumbers();
    });
  }

  private renderExternalCodeLineNumbers(): void {
    for (const block of this.host.querySelectorAll<HTMLElement>(
      ".milkdown-code-block",
    )) {
      const previewOnlyLatex =
        block.querySelector(".preview-panel .katex-display") &&
        block.querySelector(".codemirror-host.hidden");
      if (previewOnlyLatex) {
        block.querySelector(":scope > .mdmeow-code-line-numbers")?.remove();
        continue;
      }

      const content = block.querySelector<HTMLElement>(".cm-content");
      const lines = content?.querySelectorAll<HTMLElement>(".cm-line");
      if (!content || !lines?.length) {
        block.querySelector(":scope > .mdmeow-code-line-numbers")?.remove();
        continue;
      }

      let rail = block.querySelector<HTMLElement>(
        ":scope > .mdmeow-code-line-numbers",
      );
      if (!rail) {
        rail = document.createElement("div");
        rail.className = "mdmeow-code-line-numbers";
        rail.setAttribute("aria-hidden", "true");
        block.appendChild(rail);
      }

      const blockRect = block.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      rail.style.top = `${contentRect.top - blockRect.top}px`;
      rail.style.height = `${contentRect.height}px`;

      const fragment = document.createDocumentFragment();
      lines.forEach((line, index) => {
        const lineRect = line.getBoundingClientRect();
        const number = document.createElement("span");
        number.textContent = String(index + 1);
        number.style.top = `${lineRect.top - contentRect.top}px`;
        number.style.height = `${lineRect.height}px`;
        number.style.lineHeight = `${lineRect.height}px`;
        fragment.appendChild(number);
      });
      rail.replaceChildren(fragment);
    }
  }

  private handleCodeToolClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest<HTMLButtonElement>(
      ".milkdown-code-block .tools-button-group .copy-button",
    );
    if (!button) return;

    const previous = this.copyFeedbackTimers.get(button);
    if (previous) {
      window.clearTimeout(previous[0]);
      window.clearTimeout(previous[1]);
    }

    button.classList.remove("mdmeow-copy-returning");
    button.classList.add("mdmeow-copy-success");

    const returnTimer = window.setTimeout(() => {
      button.classList.add("mdmeow-copy-returning");
    }, 620);
    const resetTimer = window.setTimeout(() => {
      button.classList.remove("mdmeow-copy-success", "mdmeow-copy-returning");
      this.copyFeedbackTimers.delete(button);
    }, 900);

    this.copyFeedbackTimers.set(button, [returnTimer, resetTimer]);
  };

  private handleLatexPreviewClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const clickedBlock = target.closest<HTMLElement>(".milkdown-code-block");

    // A block LaTeX preview behaves like a rendered formula by default.
    // Clicking the formula opens the source editor; clicking elsewhere folds
    // any open formula back to preview-only mode.
    for (const block of this.host.querySelectorAll<HTMLElement>(
      ".milkdown-code-block:has(.preview-panel .katex-display)",
    )) {
      const codeHost = block.querySelector<HTMLElement>(".codemirror-host");
      const toggle = block.querySelector<HTMLButtonElement>(
        ".preview-toggle-button",
      );
      if (!codeHost || !toggle) continue;

      const editing = !codeHost.classList.contains("hidden");
      if (editing && block !== clickedBlock) toggle.click();
    }

    if (!clickedBlock) return;
    const preview = target.closest<HTMLElement>(
      ".preview-panel .katex-display, .preview-panel .katex",
    );
    if (!preview) return;

    const codeHost = clickedBlock.querySelector<HTMLElement>(".codemirror-host");
    const toggle = clickedBlock.querySelector<HTMLButtonElement>(
      ".preview-toggle-button",
    );
    if (!codeHost?.classList.contains("hidden") || !toggle) return;

    event.preventDefault();
    toggle.click();
    requestAnimationFrame(() => {
      clickedBlock.querySelector<HTMLElement>(".cm-content")?.focus();
      this.scheduleExternalCodeLineNumbers();
    });
  };

  /** Bullet-list marker written on save. Applied on the next `init()`. */
  setListMarker(marker: ListMarker): void {
    this.listMarker = marker;
  }

  /** Tell the editor which file is being edited, so relative image paths
   *  (`![](pic.png)`, `![](../assets/pic.png)`) resolve against its folder. */
  setDocPath(path: string | null): void {
    this.contextMenu.close();
    this.linkPicker.close();
    this.docPath = path;
  }

  setProxyConfig(enabled: boolean, url: string): void {
    const nextUrl = url.trim();
    if (this.proxyEnabled === enabled && this.proxyUrl === nextUrl) return;
    this.proxyEnabled = enabled;
    this.proxyUrl = nextUrl;
    this.imageCache.clear();
  }

  /** `proxyDomURL` hook: map a Markdown image target to something the WebView
   *  can actually display. Remote / data URLs pass through; local paths are
   *  read by the backend and returned as a `data:` URL. */
  private resolveImageSrc = (src: string): string | Promise<string> => {
    const raw = (src ?? "").trim();
    const remote = raw.startsWith("//") ? `https:${raw}` : raw;
    if (/^https?:\/\//i.test(remote)) {
      if (!this.proxyEnabled) return src;
      const key = `proxy\u0000${this.proxyUrl}\u0000${remote}`;
      const cached = this.imageCache.get(key);
      if (cached) return cached;
      return invoke<string>("fetch_remote_image_data_url", {
        src: remote,
        proxyUrl: this.proxyUrl,
      })
        .then((url) => {
          this.imageCache.set(key, url);
          return url;
        })
        .catch(() =>
          "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='120' viewBox='0 0 240 120'%3E%3Crect width='240' height='120' rx='12' fill='%23f3f1ee'/%3E%3Cpath d='M96 42l48 36M144 42L96 78' stroke='%23b8b2aa' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E",
        );
    }
    if (
      !raw ||
      raw.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ||
      /^(data|blob):/i.test(raw)
    ) {
      return src;
    }
    const key = `${this.docPath ?? ""}\u0000${raw}`;
    const cached = this.imageCache.get(key);
    if (cached) return cached;
    return invoke<string>("read_image_data_url", { docPath: this.docPath, src: raw })
      .then((url) => {
        this.imageCache.set(key, url);
        return url;
      })
      .catch(() => src);
  };

  /** Create the underlying Crepe instance once. */
  async init(markdown: string): Promise<void> {
    await this.destroy();
    const crepe = new Crepe({
      root: this.host,
      // Content is loaded via `setContent` below, once the image-block Markdown
      // runners are patched — `defaultValue` would be parsed with Crepe's own
      // lossy image handling (see image-block-markdown.ts).
      defaultValue: "",
      featureConfigs: {
        [Crepe.Feature.CodeMirror]: {
          theme: mikuCreamCodeMirrorTheme,
          // Preview-capable blocks (currently LaTeX) render as their result by
          // default. Ordinary code blocks have no preview and stay editable.
          previewOnlyByDefault: true,
        },
        [Crepe.Feature.ImageBlock]: { proxyDomURL: this.resolveImageSrc },
        [Crepe.Feature.Placeholder]: { text: t("editor.placeholder") },
      },
    });
    const marker = this.listMarker;
    const generations = new WeakMap<object, number>();
    const documentOwnership = $prose(() => new Plugin({
      state: {
        init: (_, state) => { generations.set(state.doc, this.documentGeneration); },
        apply: (tr) => { generations.set(tr.doc, this.documentGeneration); },
      },
    }));
    crepe.editor
      .config((ctx) => configureMarkdownSerializer(ctx, marker))
      .use(linkFromClipboard)
      .use(findPlugin)
      .use(imageToolbarPlugin)
      .use(safeHtmlPresentationPlugin)
      .use(emojiInputRule)
      .use(documentOwnership);
    let updatedDoc: object | null = null;
    crepe.on((listener) => {
      listener.updated((_, doc) => { updatedDoc = doc; });
      listener.markdownUpdated((ctx, markdown) => {
        // Heading IDs are updated by a non-history appended transaction. That
        // produces a different doc object within the same host document, so
        // object identity would drop valid edits to headings. Track ownership
        // across host replacements instead, without serializing a second time.
        if (this.crepe !== crepe || !updatedDoc
          || generations.get(updatedDoc) !== this.documentGeneration) return;
        this.onChange(markdown);
        this.scheduleExternalCodeLineNumbers();
        this.resolveHtmlImages();
        refreshSafeRawHtml(this.host);
      });
      listener.selectionUpdated(() => {
        this.onSelectionChange();
      });
    });
    await crepe.create();
    this.crepe = crepe;
    patchImageBlockMarkdown(crepe);
    patchHtmlMarkdown(crepe);
    this.blockMenu = installBlockMenu(crepe);
    if (markdown) this.setContent(markdown);
    else this.scheduleExternalCodeLineNumbers();
  }

  /** Rebuild the instance in place, keeping the current content. */
  async reload(): Promise<void> {
    if (!this.crepe) return;
    await this.init(this.getMarkdown());
  }

  /** Replace the whole document without tearing the instance down. */
  setContent(markdown: string): void {
    this.contextMenu.close();
    this.linkPicker.close();
    this.documentGeneration++;
    this.crepe?.editor.action(replaceAll(markdown, true));
    this.resolveHtmlImages();
    refreshSafeRawHtml(this.host);
    this.scheduleExternalCodeLineNumbers();
  }

  getMarkdown(): string {
    return this.crepe?.getMarkdown() ?? "";
  }

  setSpellcheck(on: boolean): void {
    this.host
      .querySelector(".ProseMirror")
      ?.setAttribute("spellcheck", String(on));
  }

  focus(preventScroll = false): void {
    (this.host.querySelector(".ProseMirror") as HTMLElement | null)?.focus({ preventScroll });
  }

  /** Turn the block(s) touched by the selection into `id`'s type — the same
   *  conversion as the matching ⠿ menu entry (see block-menu.ts). */
  runBlockAction(id: BlockActionId): void {
    if (this.crepe) runBlockAction(this.crepe, id);
  }

  /** Re-label UI after a language change (block menu; placeholder waits for a
   *  reload — it is only visible on an empty document). */
  retranslate(): void {
    this.contextMenu.close();
    this.linkPicker.close();
    this.blockMenu?.retranslate();
  }

  dismissTextMenus(): void {
    this.contextMenu.close();
    this.linkPicker.close();
  }

  /** Insert plain text at the cursor (used for emoji). */
  insertText(text: string): void {
    const view = this.view();
    if (!view) return;
    view.dispatch(view.state.tr.insertText(text));
    view.focus();
  }

  /** Viewport rectangle of the caret, for anchoring popups. */
  caretRect(): DOMRect | null {
    const view = this.view();
    if (!view) return null;
    try {
      const c = view.coordsAtPos(view.state.selection.head);
      return new DOMRect(c.left, c.top, c.right - c.left, c.bottom - c.top);
    } catch {
      return null;
    }
  }

  // --- find / replace ----------------------------------------------------

  private view(): EditorView | null {
    return this.crepe?.editor.action((ctx) => ctx.get(editorViewCtx)) ?? null;
  }

  private status(): FindStatus {
    const view = this.view();
    return statusOf(view ? findKey.getState(view.state) : null);
  }

  private scrollToActive(): void {
    const view = this.view();
    if (!view) return;
    const m = activeMatch(findKey.getState(view.state));
    if (!m) return;
    const at = view.domAtPos(m.from);
    const el =
      at.node.nodeType === 1
        ? (at.node as HTMLElement)
        : at.node.parentElement;
    el?.scrollIntoView({ block: "center", inline: "nearest" });
  }

  /** Selected text, for pre-filling the find box. */
  selectionText(): string {
    const view = this.view();
    if (!view) return "";
    const { from, to } = view.state.selection;
    return from === to ? "" : view.state.doc.textBetween(from, to, " ");
  }

  /** Plain rendered text, excluding Markdown punctuation/markers. */
  plainText(): string {
    const view = this.view();
    if (!view) return "";
    return view.state.doc.textBetween(0, view.state.doc.content.size, "\n");
  }

  findSet(query: string, caseSensitive: boolean): FindStatus {
    const view = this.view();
    if (!view) return { count: 0, index: 0 };
    view.dispatch(
      view.state.tr.setMeta(findKey, { query, caseSensitive, active: 0 }),
    );
    this.scrollToActive();
    return this.status();
  }

  findStep(dir: 1 | -1): FindStatus {
    const view = this.view();
    if (!view) return { count: 0, index: 0 };
    view.dispatch(view.state.tr.setMeta(findKey, { step: dir }));
    this.scrollToActive();
    return this.status();
  }

  findClear(): void {
    const view = this.view();
    view?.dispatch(view.state.tr.setMeta(findKey, { query: "" }));
  }

  findReplace(replacement: string): FindStatus {
    const view = this.view();
    if (!view) return { count: 0, index: 0 };
    const m = activeMatch(findKey.getState(view.state));
    if (!m) return this.status();
    const tr = view.state.tr;
    if (replacement) tr.insertText(replacement, m.from, m.to);
    else tr.delete(m.from, m.to);
    // Keep the same ordinal so the selection lands on the following match.
    tr.setMeta(findKey, { active: findKey.getState(view.state)?.active ?? 0 });
    view.dispatch(tr);
    this.scrollToActive();
    return this.status();
  }

  findReplaceAll(replacement: string): FindStatus {
    const view = this.view();
    if (!view) return { count: 0, index: 0 };
    const matches = allMatches(findKey.getState(view.state));
    if (!matches.length) return { count: 0, index: 0 };
    const tr = view.state.tr;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      if (replacement) tr.insertText(replacement, m.from, m.to);
      else tr.delete(m.from, m.to);
    }
    tr.setMeta(findKey, { active: 0 });
    view.dispatch(tr);
    return this.status();
  }

  async destroy(): Promise<void> {
    this.contextMenu.close();
    this.linkPicker.close();
    this.documentGeneration++;
    this.imagePreview.close();
    if (this.lineNumberFrame !== null) {
      window.cancelAnimationFrame(this.lineNumberFrame);
      this.lineNumberFrame = null;
    }
    this.blockMenu?.dispose();
    this.blockMenu = null;
    if (this.crepe) {
      await this.crepe.destroy();
      this.crepe = null;
    }
    this.host.replaceChildren();
  }
}
