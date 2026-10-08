// Recognise the raw HTML block that opens a collapsible <details> section.
// Kept free of DOM and Milkdown imports so scripts/test-details-html.mjs can
// exercise it directly in Node.
//
// Supported openings (CommonMark merges adjacent lines into one HTML block):
//   <details>
//   <details open>
//   <details>\n<summary>Title</summary>
//   <details open><summary><b>Title</b></summary>

export interface DetailsOpening {
  /** `<details open>`: the section starts expanded. */
  open: boolean;
  /** The complete `<summary>…</summary>` element when it shares the block. */
  summary: string | null;
}

const DETAILS_OPEN_TAG =
  /^<details(\s+open(?:\s*=\s*(?:""|''|"open"|'open'|open))?)?\s*>/i;
const SUMMARY_ELEMENT = /^<summary\b[^>]*>[\s\S]*<\/summary\s*>$/i;

export function parseDetailsOpening(value: string): DetailsOpening | null {
  const trimmed = value.trim();
  const tag = DETAILS_OPEN_TAG.exec(trimmed);
  if (!tag) return null;

  const open = Boolean(tag[1]);
  const rest = trimmed.slice(tag[0].length).trim();
  if (!rest) return { open, summary: null };
  if (!SUMMARY_ELEMENT.test(rest)) return null;
  return { open, summary: rest };
}
