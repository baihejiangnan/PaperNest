import type { Text } from "@codemirror/state";

/** Keep the original bytes until an edit, and retain its line-ending style
 * when serializing CodeMirror's normalized document positions. */
export function serializeCodeText(doc: Text, loadedDoc: Text, loadedText: string): string {
  if (doc.eq(loadedDoc)) return loadedText;
  const lineBreak = loadedText.match(/\r\n|\r|\n/)?.[0] ?? "\n";
  return doc.sliceString(0, doc.length, lineBreak);
}
