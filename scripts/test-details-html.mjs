import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/details-html.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { parseDetailsOpening } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

// Standalone opening markers.
assert.deepEqual(parseDetailsOpening("<details>"), { open: false, summary: null });
assert.deepEqual(parseDetailsOpening("  <DETAILS >\n"), { open: false, summary: null });
assert.deepEqual(parseDetailsOpening("<details open>"), { open: true, summary: null });
assert.deepEqual(parseDetailsOpening('<details open="">'), { open: true, summary: null });
assert.deepEqual(parseDetailsOpening("<details open='open'>"), { open: true, summary: null });

// GitHub-style: <details> and <summary> merged into one HTML block.
assert.deepEqual(parseDetailsOpening("<details>\n<summary><b>文件树</b></summary>"), {
  open: false,
  summary: "<summary><b>文件树</b></summary>",
});
assert.deepEqual(parseDetailsOpening("<details>\r\n<summary>Title</summary>\r\n"), {
  open: false,
  summary: "<summary>Title</summary>",
});
assert.deepEqual(parseDetailsOpening('<details open><summary class="x">Title</summary>'), {
  open: true,
  summary: '<summary class="x">Title</summary>',
});

// Not a details opening: stays literal HTML.
for (const value of [
  "</details>",
  "<details-x>",
  "<detailsopen>",
  '<details class="x">',
  "<details open data-x>",
  "<details>text",
  "<details>\n<summary>Unclosed",
  "<details>\n<summary>Title</summary>\nbody",
  "<summary>Title</summary>",
]) {
  assert.equal(parseDetailsOpening(value), null, value);
}

console.log("PASS: <details> openings, open attribute and merged <details>/<summary> blocks; other HTML stays literal.");
