// Render a small, safe subset of raw Markdown HTML as real editor content while
// preserving the original HTML node for Markdown round-tripping.
//
// Milkdown's default HTML node deliberately displays raw HTML as literal text.
// For PaperNest we special-case common authoring constructs:
//   * <img ...>          -> render as an actual image, preserving the raw HTML.
//   * <!--more-->        -> keep in the document, but hide it in WYSIWYG mode.
//   * <a>...</a>         -> hide paired markers and make their content clickable.
//   * <details>/<summary> -> collapsible section; see details-html.ts.

import { schemaCtx } from "@milkdown/kit/core";
import type { Crepe } from "@milkdown/crepe";
import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { parseDetailsOpening } from "./details-html";

/* eslint-disable @typescript-eslint/no-explicit-any */

const MORE_COMMENT = /^<!--\s*more\s*-->$/i;
const DETAILS_CLOSE = /^<\/details\s*>$/i;
const DIV_CLOSE = /^<\/div\s*>$/i;
const KBD_OPEN = /^<kbd\s*>$/i;
const KBD_CLOSE = /^<\/kbd\s*>$/i;
const LINK_CLOSE = /^<\/a\s*>$/i;

type SafeHtmlKind =
  | "details-open"
  | "details-close"
  | "summary"
  | "div-open"
  | "div-close"
  | "kbd-open"
  | "kbd-close";

function rawLinkHref(value: string): string | null {
  const trimmed = value.trim();
  if (!/^<a\b[^<>]*>$/i.test(trimmed)) return null;
  const template = document.createElement("template");
  template.innerHTML = `${trimmed}</a>`;
  const anchor = template.content.firstElementChild;
  if (!(anchor instanceof HTMLAnchorElement) || anchor.childNodes.length) return null;
  const href = anchor.getAttribute("href")?.trim() ?? "";
  if (!href || /^(?:javascript|data|vbscript):/i.test(href)) return null;
  return href;
}

function presentationDecorations(doc: ProseNode): DecorationSet {
  const ranges: Array<{ from: number; to: number }> = [];
  const openByParent = new Map<ProseNode, number[]>();
  const decorations: Decoration[] = [];
  type LinkPart = { from: number; to: number; image: boolean };
  type OpenLink = { from: number; to: number; href: string; parts: LinkPart[] };
  const linksByParent = new Map<ProseNode, OpenLink[]>();

  doc.descendants((node, pos, parent) => {
    if (!parent) return;
    const links = linksByParent.get(parent);
    if (node.type.name !== "html") {
      if (links?.length && node.isText) links[links.length - 1].parts.push({ from: pos, to: pos + node.nodeSize, image: false });
      return;
    }
    const value = String(node.attrs?.value ?? "").trim();
    const href = rawLinkHref(value);
    if (href) {
      const stack = links ?? [];
      stack.push({ from: pos, to: pos + node.nodeSize, href, parts: [] });
      linksByParent.set(parent, stack);
      return;
    }
    if (LINK_CLOSE.test(value)) {
      const open = links?.pop();
      if (!open) return;
      const marker = { class: "mdmeow-html-link-marker" };
      decorations.push(Decoration.node(open.from, open.to, marker));
      decorations.push(Decoration.node(pos, pos + node.nodeSize, marker));
      for (const part of open.parts) {
        const attrs = {
          class: "mdmeow-html-link",
          "data-mdmeow-link-href": open.href,
          role: "link",
          tabindex: "0",
        };
        decorations.push(part.image
          ? Decoration.node(part.from, part.to, attrs)
          : Decoration.inline(part.from, part.to, attrs));
      }
      return;
    }
    if (links?.length && parseRawImage(value)) {
      links[links.length - 1].parts.push({ from: pos, to: pos + node.nodeSize, image: true });
    }
    if (KBD_OPEN.test(value)) {
      const stack = openByParent.get(parent) ?? [];
      stack.push(pos + node.nodeSize);
      openByParent.set(parent, stack);
      return;
    }
    if (!KBD_CLOSE.test(value)) return;
    const stack = openByParent.get(parent);
    const from = stack?.pop();
    if (from !== undefined && from < pos) ranges.push({ from, to: pos });
  });

  decorations.push(...ranges.map(({ from, to }) =>
    Decoration.inline(from, to, { class: "mdmeow-kbd" }),
  ));
  return DecorationSet.create(doc, decorations);
}

export const safeHtmlPresentationPlugin = $prose(
  () =>
    new Plugin({
      state: {
        init: (_, state) => presentationDecorations(state.doc),
        apply(tr, previous) {
          return tr.docChanged ? presentationDecorations(tr.doc) : previous;
        },
      },
      props: {
        decorations(state) {
          return this.getState(state) ?? DecorationSet.empty;
        },
      },
    }),
);

interface RawImageAttrs {
  src: string;
  alt?: string;
  title?: string;
  width?: string;
  height?: string;
  align?: string;
  zoom?: string;
}

function parseRawImage(value: string): RawImageAttrs | null {
  const trimmed = value.trim();
  if (!/^<img\b/i.test(trimmed)) return null;

  const template = document.createElement("template");
  template.innerHTML = trimmed;
  const meaningful = [...template.content.childNodes].filter(
    (node) => node.nodeType !== Node.TEXT_NODE || Boolean(node.textContent?.trim()),
  );
  if (meaningful.length !== 1) return null;
  const el = meaningful[0];
  if (!(el instanceof HTMLImageElement)) return null;

  const src = (el.getAttribute("src") ?? "").trim();
  if (!src) return null;

  const attrs: RawImageAttrs = { src };
  const alt = el.getAttribute("alt");
  const title = el.getAttribute("title");
  const width = el.getAttribute("width");
  const height = el.getAttribute("height");
  const align = el.getAttribute("data-align") ?? el.getAttribute("align");

  if (alt) attrs.alt = alt;
  if (title) attrs.title = title;
  if (width && /^\d+(?:\.\d+)?(?:px|%)?$/.test(width.trim())) attrs.width = width.trim();
  if (height && /^\d+(?:\.\d+)?(?:px|%)?$/.test(height.trim())) attrs.height = height.trim();
  if (align && /^(left|center|right)$/i.test(align.trim())) attrs.align = align.trim().toLowerCase();

  const style = el.getAttribute("style") ?? "";
  const zoom = style.match(/(?:^|;)\s*zoom\s*:\s*([0-9]+(?:\.[0-9]+)?%?)/i)?.[1];
  if (zoom) attrs.zoom = zoom;

  return attrs;
}

export interface RawHtmlImagePresentation {
  align: "left" | "center" | "right";
  ratio: number;
  title: string;
}

/** Read the presentation metadata used by the shared image toolbar without
 * converting the underlying raw-HTML node into a Markdown image node. */
export function rawHtmlImagePresentation(
  value: string,
): RawHtmlImagePresentation | null {
  const image = parseRawImage(value);
  if (!image) return null;

  const zoom = Number.parseFloat(String(image.zoom ?? "100").replace("%", ""));
  const ratio = Number.isFinite(zoom) && zoom > 0
    ? (String(image.zoom ?? "").includes("%") ? zoom / 100 : zoom)
    : 1;

  return {
    align:
      image.align === "left" || image.align === "right"
        ? image.align
        : "center",
    ratio,
    title: image.title ?? "",
  };
}

export function buildRawHtmlImage(options: {
  src: string;
  alt?: string;
  title?: string;
  align?: RawHtmlImagePresentation["align"];
  ratio?: number;
}): string {
  const el = document.createElement("img");
  el.setAttribute("title", options.title ?? "");
  el.setAttribute("src", options.src);
  el.setAttribute("alt", options.alt ?? "");

  const ratio = Math.max(0.01, options.ratio ?? 1);
  if (Math.abs(ratio - 1) >= 0.0001) {
    el.style.setProperty("zoom", `${Math.round(ratio * 10000) / 100}%`);
  }
  el.setAttribute("data-align", options.align ?? "center");
  return el.outerHTML;
}

/** Update the editable metadata of a raw HTML <img>. The document continues to
 * round-trip as ordinary HTML compatible with Typedown-style image markup. */
export function updateRawHtmlImagePresentation(
  value: string,
  patch: Partial<RawHtmlImagePresentation>,
): string | null {
  const trimmed = value.trim();
  if (!parseRawImage(trimmed)) return null;

  const template = document.createElement("template");
  template.innerHTML = trimmed;
  const el = template.content.firstElementChild;
  if (!(el instanceof HTMLImageElement)) return null;

  // Never emit PaperNest-private source attributes. The runtime-only
  // data-mdmeow-html-img marker is added by toDOM and is not serialized.
  el.removeAttribute("data-mdmeow-image");
  if (!el.hasAttribute("title")) el.setAttribute("title", "");
  if (!el.hasAttribute("alt")) el.setAttribute("alt", "");

  if (patch.align) {
    el.setAttribute("data-align", patch.align);
    // Prefer our non-deprecated data attribute after the first toolbar edit.
    el.removeAttribute("align");
  }

  if (patch.ratio !== undefined) {
    const ratio = Math.max(0.01, patch.ratio);
    const style = el.style;
    if (Math.abs(ratio - 1) < 0.0001) style.removeProperty("zoom");
    else style.setProperty("zoom", `${Math.round(ratio * 10000) / 100}%`);
    if (!style.cssText.trim()) el.removeAttribute("style");
  }

  if (patch.title !== undefined) {
    el.setAttribute("title", patch.title);
  }

  return el.outerHTML;
}

function rawImageDom(value: string, image: RawImageAttrs): [string, Record<string, string>] {
  const attrs: Record<string, string> = {
    src: image.src,
    "data-type": "html",
    "data-value": value,
    "data-mdmeow-html-img": "true",
    "data-mdmeow-src": image.src,
  };
  if (image.alt) attrs.alt = image.alt;
  if (image.title) attrs.title = image.title;
  if (image.width) attrs.width = image.width;
  if (image.height) attrs.height = image.height;
  if (image.align) attrs["data-align"] = image.align;

  const styles: string[] = ["max-width:100%", "height:auto"];
  if (image.zoom) styles.push(`zoom:${image.zoom}`);
  if (image.align === "center") styles.push("display:block", "margin-left:auto", "margin-right:auto");
  else if (image.align === "right") styles.push("display:block", "margin-left:auto");
  else if (image.align === "left") styles.push("display:block", "margin-right:auto");
  attrs.style = styles.join(";");

  return ["img", attrs];
}

function safeMarkerDom(
  value: string,
  kind: SafeHtmlKind,
  extra: Record<string, string> = {},
): [string, Record<string, string>, string] {
  return [
    "span",
    {
      "data-type": "html",
      "data-value": value,
      "data-mdmeow-safe-html": kind,
      ...extra,
    },
    "",
  ];
}

function parseDivAlign(value: string): "left" | "center" | "right" | null {
  const trimmed = value.trim();
  if (!/^<div\b[^>]*>$/i.test(trimmed)) return null;
  const template = document.createElement("template");
  template.innerHTML = trimmed;
  const div = template.content.firstElementChild;
  if (!(div instanceof HTMLDivElement)) return null;
  const align = (div.getAttribute("align") ?? "").trim().toLowerCase();
  return align === "left" || align === "center" || align === "right"
    ? align
    : null;
}

function parseSummary(value: string): string | null {
  const trimmed = value.trim();
  if (!/^<summary\b[^>]*>[\s\S]*<\/summary\s*>$/i.test(trimmed)) return null;
  const template = document.createElement("template");
  template.innerHTML = trimmed;
  const meaningful = [...template.content.childNodes].filter(
    (node) => node.nodeType !== Node.TEXT_NODE || Boolean(node.textContent?.trim()),
  );
  if (meaningful.length !== 1) return null;
  const summary = meaningful[0];
  if (!(summary instanceof HTMLElement) || summary.tagName !== "SUMMARY") return null;
  return summary.textContent ?? "";
}

function summaryDom(value: string, title: string): [string, Record<string, string>, string] {
  return [
    "span",
    {
      "data-type": "html",
      "data-value": value,
      "data-mdmeow-safe-html": "summary",
      role: "button",
      tabindex: "0",
      contenteditable: "false",
      "aria-expanded": "false",
    },
    title,
  ];
}

function safeHtmlDom(value: string): [string, Record<string, string>, string] | null {
  const trimmed = value.trim();
  const details = parseDetailsOpening(trimmed);
  if (details) {
    if (details.summary === null) return safeMarkerDom(value, "details-open");
    // `<details>` and `<summary>` share one HTML block: the summary also opens
    // the section, so no separate (hidden) opening marker exists.
    const title = parseSummary(details.summary);
    return title === null ? null : summaryDom(value, title);
  }
  if (DETAILS_CLOSE.test(trimmed)) return safeMarkerDom(value, "details-close");
  if (DIV_CLOSE.test(trimmed)) return safeMarkerDom(value, "div-close");
  if (KBD_OPEN.test(trimmed)) return safeMarkerDom(value, "kbd-open");
  if (KBD_CLOSE.test(trimmed)) return safeMarkerDom(value, "kbd-close");

  const align = parseDivAlign(trimmed);
  if (align) return safeMarkerDom(value, "div-open", { "data-mdmeow-align": align });

  const summary = parseSummary(trimmed);
  if (summary !== null) return summaryDom(value, summary);

  return null;
}

// --- Block structure: <div align> ranges and <details> sections -------------
//
// Structural raw HTML is presented through ProseMirror node decorations rather
// than classes written onto block DOM: ProseMirror redraws a block's DOM when it
// notices outside mutations, which immediately discards such classes. Reader
// toggles live in plugin state, keyed by the summary node's position and mapped
// through edits, so the Markdown source is never touched.

interface StructureState {
  /** Summary position -> expanded, for sections the reader has toggled. */
  toggles: Map<number, boolean>;
  decorations: DecorationSet;
}

interface DetailsToggle {
  pos: number;
  expanded: boolean;
}

const structureKey = new PluginKey<StructureState>("mdmeow-safe-html-structure");

interface BlockHtml {
  detailsOpen: { open: boolean; merged: boolean } | null;
  summaryPos: number | null;
  detailsClose: boolean;
  divAlign: "left" | "center" | "right" | null;
  divClose: boolean;
}

function inspectBlock(block: ProseNode, blockPos: number): BlockHtml {
  const info: BlockHtml = {
    detailsOpen: null,
    summaryPos: null,
    detailsClose: false,
    divAlign: null,
    divClose: false,
  };
  block.descendants((node, offset) => {
    if (node.type.name !== "html") return;
    const value = String(node.attrs?.value ?? "").trim();
    const pos = blockPos + 1 + offset;
    const details = parseDetailsOpening(value);
    if (details) {
      if (details.summary === null) {
        info.detailsOpen ??= { open: details.open, merged: false };
      } else if (parseSummary(details.summary) !== null) {
        info.detailsOpen ??= { open: details.open, merged: true };
        info.summaryPos ??= pos;
      }
      return;
    }
    if (DETAILS_CLOSE.test(value)) info.detailsClose = true;
    else if (DIV_CLOSE.test(value)) info.divClose = true;
    else if (info.summaryPos === null && parseSummary(value) !== null) info.summaryPos = pos;
    else info.divAlign ??= parseDivAlign(value);
  });
  return info;
}

function structureDecorations(doc: ProseNode, toggles: Map<number, boolean>): DecorationSet {
  const blocks: Array<{ node: ProseNode; pos: number; html: BlockHtml }> = [];
  doc.forEach((node, pos) => blocks.push({ node, pos, html: inspectBlock(node, pos) }));

  const decorations: Decoration[] = [];
  const addClass = (index: number, className: string) => {
    const { node, pos } = blocks[index];
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: className }));
  };
  // Marker-only blocks (an HTML tag on its own) disappear in the rendered view.
  const hideIfEmpty = (index: number) => {
    if (blocks[index].node.textContent.trim() === "") addClass(index, "mdmeow-html-marker-block");
  };

  const divStack: Array<{ index: number; align: string }> = [];
  let section: { open: boolean; summaryIndex: number; summaryPos: number } | null = null;

  blocks.forEach(({ html }, index) => {
    if (html.divAlign) {
      hideIfEmpty(index);
      divStack.push({ index, align: html.divAlign });
    }
    if (html.divClose && divStack.length) {
      hideIfEmpty(index);
      const range = divStack.pop()!;
      for (let i = range.index + 1; i < index; i += 1) addClass(i, `mdmeow-html-align-${range.align}`);
    }

    if (html.detailsOpen) {
      section = { open: html.detailsOpen.open, summaryIndex: -1, summaryPos: -1 };
      // A standalone opening marker hides its block; the summary follows later.
      if (!html.detailsOpen.merged) {
        hideIfEmpty(index);
        return;
      }
    }
    if (section && section.summaryIndex < 0 && html.summaryPos !== null) {
      section.summaryIndex = index;
      section.summaryPos = html.summaryPos;
    }
    if (!html.detailsClose || !section) return;
    hideIfEmpty(index);

    const { summaryIndex, summaryPos, open } = section;
    section = null;
    if (summaryIndex < 0) return;
    const expanded = toggles.get(summaryPos) ?? open;
    decorations.push(Decoration.node(summaryPos, summaryPos + 1, {
      class: expanded ? "mdmeow-details-summary mdmeow-details-expanded" : "mdmeow-details-summary",
      "aria-expanded": String(expanded),
      "data-mdmeow-details-pos": String(summaryPos),
    }));
    if (!expanded) {
      for (let i = summaryIndex + 1; i < index; i += 1) addClass(i, "mdmeow-details-collapsed");
    }
  });

  return DecorationSet.create(doc, decorations);
}

function detailsSummaryAt(view: EditorView, event: Event): HTMLElement | null {
  const target = event.target instanceof Element ? event.target : null;
  const summary = target?.closest<HTMLElement>(".mdmeow-details-summary[data-mdmeow-details-pos]");
  return summary && view.dom.contains(summary) ? summary : null;
}

function toggleDetails(view: EditorView, summary: HTMLElement): void {
  const toggle: DetailsToggle = {
    pos: Number(summary.dataset.mdmeowDetailsPos),
    expanded: summary.getAttribute("aria-expanded") !== "true",
  };
  view.dispatch(view.state.tr.setMeta(structureKey, toggle).setMeta("addToHistory", false));
}

export const safeHtmlStructurePlugin = $prose(
  () =>
    new Plugin<StructureState>({
      key: structureKey,
      state: {
        init: (_, state) => ({
          toggles: new Map(),
          decorations: structureDecorations(state.doc, new Map()),
        }),
        apply(tr, previous) {
          const toggle = tr.getMeta(structureKey) as DetailsToggle | undefined;
          if (!tr.docChanged && !toggle) return previous;
          let toggles = previous.toggles;
          if (tr.docChanged) {
            toggles = new Map();
            for (const [pos, expanded] of previous.toggles) {
              const mapped = tr.mapping.mapResult(pos, 1);
              if (!mapped.deleted) toggles.set(mapped.pos, expanded);
            }
          }
          if (toggle) {
            toggles = new Map(toggles);
            toggles.set(toggle.pos, toggle.expanded);
          }
          return { toggles, decorations: structureDecorations(tr.doc, toggles) };
        },
      },
      props: {
        decorations(state) {
          return this.getState(state)?.decorations ?? DecorationSet.empty;
        },
        handleDOMEvents: {
          // Toggle on press so the click never becomes a node selection.
          mousedown: (view, event) => {
            const summary = detailsSummaryAt(view, event);
            if (!summary) return false;
            event.preventDefault();
            if (event.button === 0) toggleDetails(view, summary);
            return true;
          },
          keydown: (view, event) => {
            if (event.key !== "Enter" && event.key !== " ") return false;
            const summary = detailsSummaryAt(view, event);
            if (!summary) return false;
            event.preventDefault();
            toggleDetails(view, summary);
            return true;
          },
        },
      },
    }),
);

/** Patch Milkdown's existing `html` schema after Crepe has created it. */
export function patchHtmlMarkdown(crepe: Crepe): void {
  crepe.editor.action((ctx) => {
    const spec = (ctx.get(schemaCtx) as any).nodes?.html?.spec;
    if (!spec?.toDOM) return;

    const fallbackToDom = spec.toDOM.bind(spec);
    spec.toDOM = (node: any) => {
      const value = String(node.attrs?.value ?? "");
      if (MORE_COMMENT.test(value.trim())) {
        return [
          "span",
          {
            "data-type": "html",
            "data-value": value,
            "data-mdmeow-hidden-html": "more",
            "aria-hidden": "true",
          },
        ];
      }

      const image = parseRawImage(value);
      if (image) return rawImageDom(value, image);
      const safeHtml = safeHtmlDom(value);
      if (safeHtml) return safeHtml;
      return fallbackToDom(node);
    };

    const parseDOM = Array.isArray(spec.parseDOM) ? spec.parseDOM : [];
    spec.parseDOM = [
      {
        tag: 'img[data-mdmeow-html-img="true"]',
        getAttrs: (dom: HTMLElement) => ({ value: dom.dataset.value ?? "" }),
      },
      {
        tag: 'span[data-mdmeow-hidden-html="more"]',
        getAttrs: (dom: HTMLElement) => ({ value: dom.dataset.value ?? "<!--more-->" }),
      },
      ...parseDOM,
    ];
  });
}

/** Resolve local paths used by raw HTML images through the same Tauri bridge as
 * standard Markdown images. Remote/data/blob URLs pass straight through. */
export function resolveRawHtmlImages(
  host: HTMLElement,
  resolver: (src: string) => string | Promise<string>,
  isCurrent: () => boolean = () => true,
): void {
  requestAnimationFrame(() => {
    if (!isCurrent()) return;
    host.querySelectorAll<HTMLImageElement>('img[data-mdmeow-html-img="true"]').forEach((img) => {
      const raw = img.dataset.mdmeowSrc ?? img.getAttribute("src") ?? "";
      if (!raw) return;
      Promise.resolve(resolver(raw))
        .then((resolved) => {
          if (isCurrent() && host.contains(img) && img.dataset.mdmeowSrc === raw
            && resolved && img.getAttribute("src") !== resolved) img.src = resolved;
        })
        .catch(() => undefined);
    });
  });
}
