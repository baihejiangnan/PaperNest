import { toggleMark } from "@milkdown/kit/prose/commands";
import { undo, redo } from "@milkdown/kit/prose/history";
import { AllSelection, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView as RichView } from "@milkdown/kit/prose/view";
import { EditorSelection } from "@codemirror/state";
import { undo as codeUndo, redo as codeRedo, selectAll } from "@codemirror/commands";
import type { EditorView as CodeView } from "@codemirror/view";
import type { LinkChoice } from "./link-picker";
import { t } from "./i18n";
import { formatShortcut } from "./shortcuts";
import type { BlockActionId, InsertActionId } from "./block-menu";
import type { TextMenuItem, TextMenuTarget } from "./text-context-menu";

const shortcut = (key: string) => formatShortcut(`Mod+${key}`);
const item = (id: string, label: string, icon: string, run: TextMenuItem["run"], extra: Partial<TextMenuItem> = {}): TextMenuItem => ({ id, label, icon, run, ...extra });
const findLabel = (text: string) => text.trim() && !text.includes("\n")
  ? t("context.findSelection", { text: text.replace(/\s+/g, " ").slice(0, 28) + (text.length > 28 ? "…" : "") })
  : t("context.find");

async function readClipboard(plain: boolean): Promise<{ text: string; html?: string }> {
  if (plain || !navigator.clipboard.read) return { text: await navigator.clipboard.readText() };
  const entries = await navigator.clipboard.read();
  let text = "", html: string | undefined;
  for (const entry of entries) {
    if (entry.types.includes("text/plain")) text = await (await entry.getType("text/plain")).text();
    if (entry.types.includes("text/html")) html = await (await entry.getType("text/html")).text();
    if (html || text) break;
  }
  return { text, html };
}

export function richContextTarget(view: RichView, event: MouseEvent, options: {
  isCurrent: () => boolean;
  block: (id: BlockActionId) => void;
  insert: (id: InsertActionId) => void;
  find: (text: string) => void;
  findShortcut?: string;
  pickLink: (value: string, restore: () => boolean) => Promise<LinkChoice | null>;
}): TextMenuTarget {
  const selection = view.state.selection;
  // A right click inside a selected range keeps it. Outside it, use the clicked
  // position. Keyboard invocation targets the host and keeps the live caret.
  if (event.target !== view.dom.parentElement && event.target instanceof Element && event.target.closest(".ProseMirror")) {
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (hit && (selection.empty || hit.pos < selection.from || hit.pos > selection.to)) {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))));
    }
  }
  const state = view.state;
  const doc = state.doc;
  const bookmark = state.selection.getBookmark();
  const restore = () => {
    if (!options.isCurrent() || view.state.doc !== doc || !view.dom.isConnected) return false;
    view.dispatch(view.state.tr.setSelection(bookmark.resolve(doc)));
    view.focus();
    return true;
  };
  const { from, to, empty, $from } = state.selection;
  const text = doc.textBetween(from, to, "\n");
  const editable = view.editable;
  const inline = editable && !$from.parent.type.spec.code && $from.parent.inlineContent;
  const marks = state.schema.marks;
  const existingLink = marks.link && ($from.marks().find(mark => mark.type === marks.link)
    ?? doc.nodeAt(from)?.marks.find(mark => mark.type === marks.link));
  let linkFrom = from, linkTo = to;
  if (empty && existingLink) {
    const spans: Array<{ from: number; to: number }> = [];
    $from.parent.forEach((child, offset) => {
      if (existingLink.isInSet(child.marks)) spans.push({ from: $from.start() + offset, to: $from.start() + offset + child.nodeSize });
    });
    for (let i = 0; i < spans.length; i++) {
      if (spans[i].from > from || spans[i].to < from) continue;
      let first = i, last = i;
      while (first > 0 && spans[first - 1].to === spans[first].from) first--;
      while (last + 1 < spans.length && spans[last].to === spans[last + 1].from) last++;
      linkFrom = spans[first].from;
      linkTo = spans[last].to;
      break;
    }
  }
  const markItem = (name: string, key: "context.bold" | "context.italic" | "context.strike" | "context.inlineCode", icon: string, hint?: string) => {
    const type = marks[name];
    const command = type ? toggleMark(type) : null;
    return item(name, t(key), icon, () => {
      if (restore()) command?.(view.state, view.dispatch, view);
    }, {
      disabled: !inline || !command?.(state), shortcut: hint,
      active: Boolean(type && (empty ? type.isInSet(state.storedMarks ?? $from.marks()) : doc.rangeHasMark(from, to, type))),
    });
  };
  const ancestor = (name: string) => {
    for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === name) return $from.node(depth);
    return null;
  };
  const paragraphItem = (id: BlockActionId, label: string, icon: string, active: boolean, hint?: string) =>
    item(id, label, icon, () => { if (restore()) options.block(id); }, {
      disabled: !editable || Boolean(ancestor("table")), active, shortcut: hint,
    });
  const task = ancestor("list_item")?.attrs.checked != null;
  const headings = Array.from({ length: 6 }, (_, index) => {
    const level = index + 1;
    return paragraphItem(`h${level}` as BlockActionId, t("context.heading", { level }), `h${level}`,
      $from.parent.type.name === "heading" && $from.parent.attrs.level === level,
      level <= 3 ? shortcut(String(level)) : undefined);
  });
  const copy = async (cut = false) => {
    const serialized = view.serializeForClipboard(state.selection.content());
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([serialized.text], { type: "text/plain" }),
        "text/html": new Blob([serialized.dom.innerHTML], { type: "text/html" }),
      })]);
    } else await navigator.clipboard.writeText(serialized.text);
    if (cut && restore()) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
  };
  const paste = async (plain: boolean) => {
    const content = await readClipboard(plain);
    if (!restore()) return;
    if (content.html && !plain) view.pasteHTML(content.html);
    else view.pasteText(content.text);
  };
  const format: TextMenuItem[][] = [
    [markItem("strong", "context.bold", "bold", shortcut("B")), markItem("emphasis", "context.italic", "italic", shortcut("I")), markItem("strike_through", "context.strike", "strike")],
    [markItem("inlineCode", "context.inlineCode", "code"), item("inline-math", t("context.inlineMath"), "math", () => {
      if (!restore()) return;
      const type = view.state.schema.nodes.math_inline;
      const tr = view.state.tr.replaceSelectionWith(type.create({ value: text || "x" }));
      view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, from)).scrollIntoView());
    }, { disabled: !inline || !state.selection.$from.sameParent(state.selection.$to) || !state.schema.nodes.math_inline })],
    [item("clear-format", t("context.clearFormat"), "clear", () => {
      if (!restore()) return;
      view.dispatch(empty ? view.state.tr.setStoredMarks([]) : view.state.tr.removeMark(from, to));
    }, { disabled: !inline })],
  ];
  const paragraphs: TextMenuItem[][] = [
    [paragraphItem("bullet", t("block.bulletList"), "bullet", Boolean(ancestor("bullet_list")) && !task, shortcut("4")),
      paragraphItem("ordered", t("block.numberedList"), "ordered", Boolean(ancestor("ordered_list")), shortcut("5")),
      paragraphItem("task", t("block.taskList"), "task", task)],
    headings.concat(paragraphItem("text", t("block.text"), "text", $from.parent.type.name === "paragraph" && !ancestor("bullet_list") && !ancestor("ordered_list") && !ancestor("blockquote"), shortcut("0"))),
    [paragraphItem("quote", t("block.quote"), "quote", Boolean(ancestor("blockquote")), shortcut("6"))],
  ];
  const insertItem = (id: InsertActionId, label: string, icon: string) =>
    item(`insert-${id}`, label, icon, () => { if (restore()) options.insert(id); }, { disabled: !editable });
  const insertion: TextMenuItem[][] = [
    [insertItem("table", t("block.table"), "table"), insertItem("image", t("block.image"), "image"), insertItem("divider", t("block.divider"), "divider")],
    [insertItem("code", t("block.codeBlock"), "code"), insertItem("math", t("context.mathBlock"), "math")],
  ];
  const links = [item("link", t(existingLink ? "context.editLink" : "context.addLink"), "link", async () => {
    const choice = await options.pickLink(existingLink?.attrs.href ?? "", restore);
    if (!choice || !restore()) return;
    const { href } = choice;
    const label = choice.text ?? href;
    let tr = view.state.tr;
    if (empty && !existingLink) tr = tr.insertText(label);
    const end = empty && !existingLink ? from + label.length : linkTo;
    tr = tr.removeMark(linkFrom, end, marks.link)
      .addMark(linkFrom, end, marks.link.create({ href }));
    view.dispatch(tr.scrollIntoView());
  }, { disabled: !inline || !marks.link })];
  if (existingLink) links.push(item("remove-link", t("context.removeLink"), "unlink", () => {
    if (restore()) view.dispatch(view.state.tr.removeMark(linkFrom, linkTo, marks.link));
  }, { disabled: !inline }));
  links.push(item("find", findLabel(text), "search", () => options.find(text), { shortcut: options.findShortcut }));
  return { restore, groups: [
    links,
    [{ id: "format", label: t("context.textFormat"), icon: "format", children: format },
      { id: "paragraph", label: t("context.paragraph"), icon: "paragraph", children: paragraphs },
      { id: "insert", label: t("context.insert"), icon: "insert", children: insertion }],
    [item("undo", t("context.undo"), "undo", () => { if (restore()) undo(view.state, view.dispatch); }, { disabled: !editable || !undo(state), shortcut: shortcut("Z") }),
      item("redo", t("context.redo"), "redo", () => { if (restore()) redo(view.state, view.dispatch); }, { disabled: !editable || !redo(state), shortcut: shortcut("Shift+Z") })],
    [item("cut", t("context.cut"), "cut", () => copy(true), { disabled: empty || !editable, shortcut: shortcut("X") }),
      item("copy", t("context.copy"), "copy", () => copy(), { disabled: empty, shortcut: shortcut("C") }),
      item("paste", t("context.paste"), "paste", () => paste(false), { disabled: !editable, shortcut: shortcut("V") }),
      item("paste-plain", t("context.pastePlain"), "paste", () => paste(true), { disabled: !editable, shortcut: shortcut("Shift+V") }),
      item("select-all", t("context.selectAll"), "select", () => { if (restore()) view.dispatch(view.state.tr.setSelection(new AllSelection(doc))); }, { shortcut: shortcut("A") })],
  ] };
}

export function codeContextTarget(view: CodeView, event: MouseEvent, options: {
  isCurrent: () => boolean;
  find: (text: string) => void;
  findShortcut?: string;
}): TextMenuTarget {
  const hit = event.target instanceof Element && event.target.closest(".cm-content")
    ? view.posAtCoords({ x: event.clientX, y: event.clientY }) : null;
  const selected = view.state.selection.main;
  if (hit !== null && (selected.empty || hit < selected.from || hit > selected.to)) view.dispatch({ selection: { anchor: hit } });
  const state = view.state;
  const doc = state.doc;
  const selection = state.selection;
  const restore = () => {
    if (!options.isCurrent() || view.state.doc !== doc || !view.dom.isConnected) return false;
    view.dispatch({ selection });
    view.focus();
    return true;
  };
  const range = selection.main;
  const text = state.sliceDoc(range.from, range.to);
  const editable = !state.readOnly;
  const replace = (value: string) => {
    if (restore()) view.dispatch({ changes: { from: range.from, to: range.to, insert: value }, selection: EditorSelection.cursor(range.from + value.length) });
  };
  const paste = async () => replace(await navigator.clipboard.readText());
  return { restore, groups: [
    [item("find", findLabel(text), "search", () => options.find(text), { shortcut: options.findShortcut })],
    [item("undo", t("context.undo"), "undo", () => { if (restore()) codeUndo(view); }, { disabled: !editable || !codeUndo({ state, dispatch: () => {} }), shortcut: shortcut("Z") }),
      item("redo", t("context.redo"), "redo", () => { if (restore()) codeRedo(view); }, { disabled: !editable || !codeRedo({ state, dispatch: () => {} }), shortcut: shortcut("Shift+Z") })],
    [item("cut", t("context.cut"), "cut", async () => { await navigator.clipboard.writeText(text); replace(""); }, { disabled: range.empty || !editable, shortcut: shortcut("X") }),
      item("copy", t("context.copy"), "copy", () => navigator.clipboard.writeText(text), { disabled: range.empty, shortcut: shortcut("C") }),
      item("paste", t("context.paste"), "paste", paste, { disabled: !editable, shortcut: shortcut("V") }),
      item("paste-plain", t("context.pastePlain"), "paste", paste, { disabled: !editable, shortcut: shortcut("Shift+V") }),
      item("select-all", t("context.selectAll"), "select", () => { if (restore()) selectAll(view); }, { shortcut: shortcut("A") })],
  ] };
}
