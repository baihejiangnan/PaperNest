// Obsidian colours are defined in ui-theme.css. We still inject
// Crepe's light frame stylesheet because it contains the editor component
// structure; src/styles.css then owns the visual rendering.
import frameLight from "@milkdown/crepe/theme/frame.css?inline";
import {
  ensureSyntaxTree,
  syntaxTree,
  syntaxTreeAvailable,
} from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { classHighlighter, highlightTree } from "@lezer/highlight";

export const codePalette = {
  base: "var(--fg)",
  keyword: "var(--syntax-keyword)",
  functionName: "var(--syntax-function)",
  number: "var(--syntax-number)",
  type: "var(--syntax-type)",
  string: "var(--syntax-string)",
  definition: "var(--syntax-function)",
  operator: "var(--syntax-operator)",
  comment: "var(--muted)",
  link: "var(--accent-soft-foreground)",
  invalid: "var(--danger)",
} as const;

const codeEditorTheme = EditorView.theme(
  {
    "&": {
      color: codePalette.base,
      backgroundColor: "var(--bg)",
    },
    ".cm-scroller": {
      fontFamily: 'Consolas, "Courier New", Courier, monospace',
      fontSize: "14px",
      lineHeight: "18px",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      padding: "10px 0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--selection)",
    },
    ".cm-line": {
      minHeight: "18px",
      padding: "0 14px 0 12px",
    },
    ".cm-gutters": {
      color: "var(--muted)",
      backgroundColor: "var(--bar-bg)",
      borderRight: "1px solid var(--border)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--hover)",
      color: "var(--bar-fg)",
      border: "none",
    },
    ".tok-keyword": {
      color: codePalette.keyword,
      fontWeight: "600",
    },
    ".tok-variableName, .tok-propertyName, .tok-macroName": {
      color: codePalette.base,
    },
    ".tok-labelName": {
      color: codePalette.functionName,
    },
    ".tok-number, .tok-bool, .tok-atom, .tok-literal": {
      color: codePalette.number,
    },
    ".tok-typeName, .tok-className, .tok-namespace": {
      color: codePalette.type,
    },
    ".tok-string, .tok-string2, .tok-inserted": {
      color: codePalette.string,
    },
    ".tok-definition": {
      color: codePalette.definition,
    },
    ".tok-operator, .tok-punctuation": {
      color: codePalette.operator,
    },
    ".tok-meta, .tok-comment": {
      color: codePalette.comment,
      fontStyle: "italic",
    },
    ".tok-link, .tok-url": {
      color: codePalette.link,
      textDecoration: "underline",
    },
    ".tok-strong": {
      fontWeight: "700",
    },
    ".tok-emphasis": {
      fontStyle: "italic",
    },
    ".tok-invalid, .tok-deleted": {
      color: codePalette.invalid,
    },
  },
  { dark: false },
);

function semanticTokenDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  if (!tree.length) return Decoration.none;

  for (const { from, to } of view.visibleRanges) {
    highlightTree(
      tree,
      classHighlighter,
      (tokenFrom, tokenTo, classes) => {
        if (tokenTo > tokenFrom) {
          ranges.push(
            Decoration.mark({ class: classes }).range(tokenFrom, tokenTo),
          );
        }
      },
      from,
      to,
    );
  }
  return Decoration.set(ranges, true);
}

const semanticTokenPlugin = ViewPlugin.fromClass(
  class {
    readonly view: EditorView;
    tree;
    decorations: DecorationSet;
    parseFrame: number | null = null;

    constructor(view: EditorView) {
      this.view = view;
      this.tree = syntaxTree(view.state);
      this.decorations = semanticTokenDecorations(view);
      this.ensureVisibleSyntax();
    }

    update(update: ViewUpdate): void {
      const nextTree = syntaxTree(update.state);
      if (nextTree !== this.tree || update.viewportChanged || update.docChanged) {
        this.tree = nextTree;
        this.decorations = semanticTokenDecorations(update.view);
      }
      this.ensureVisibleSyntax();
    }

    ensureVisibleSyntax(): void {
      const tree = syntaxTree(this.view.state);
      if (!tree.length) return; // Plain text / no language parser enabled.

      const upto = this.view.visibleRanges.reduce(
        (max, range) => Math.max(max, range.to),
        0,
      );
      if (!upto || syntaxTreeAvailable(this.view.state, upto)) return;
      if (this.parseFrame !== null) return;

      // CodeMirror intentionally stops background parsing after a time/viewport
      // budget. For large files that can leave a later viewport without a
      // syntax tree, which made PaperNest appear to "stop highlighting" after a
      // certain length. Advance the parser in small frame-sized chunks until
      // the currently visible range is covered, without blocking a long scroll.
      this.parseFrame = requestAnimationFrame(() => {
        this.parseFrame = null;
        const target = this.view.visibleRanges.reduce(
          (max, range) => Math.max(max, range.to),
          0,
        );
        if (!target || syntaxTreeAvailable(this.view.state, target)) return;
        const parsed = ensureSyntaxTree(this.view.state, target, 40);
        if (parsed && parsed !== syntaxTree(this.view.state)) {
          // Equivalent to CodeMirror's forceParsing(), but kept local here to
          // avoid coupling to a second @codemirror/view package version pulled
          // in by language-data.
          this.view.dispatch({});
        }
        if (!syntaxTreeAvailable(this.view.state, target)) {
          this.ensureVisibleSyntax();
        }
      });
    }

    destroy(): void {
      if (this.parseFrame !== null) cancelAnimationFrame(this.parseFrame);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export const codeMirrorTheme = [
  codeEditorTheme,
  semanticTokenPlugin,
];

function themeStyleEl(): HTMLStyleElement {
  let el = document.getElementById("crepe-theme") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "crepe-theme";
    document.head.appendChild(el);
  }
  return el;
}

export function installEditorRendering(): void {
  themeStyleEl().textContent = frameLight;
}
