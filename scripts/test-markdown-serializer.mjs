// Round-trips Markdown through PaperNest's remark-stringify configuration:
// Milkdown's own default handlers (read from @milkdown/kit/core) with the
// handlers and options from src/markdown-serializer.ts layered on top, using
// the same unified / remark-parse / remark-stringify / remark-gfm packages that
// Milkdown bundles. The ProseMirror <-> mdast step needs a DOM and is not
// covered here; it does not change how text nodes are escaped.
import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kitDir = await realpath(join(root, "node_modules", "@milkdown", "kit"));
const scope = dirname(kitDir); // .../node_modules/@milkdown (the kit's dependencies)
const fromPackage = async (dir, name) => {
  const require = createRequire(join(await realpath(dir), "package.json"));
  return import(pathToFileURL(require.resolve(name)).href);
};
const coreDir = join(scope, "core");
const { unified } = await fromPackage(coreDir, "unified");
const { default: remarkParse } = await fromPackage(coreDir, "remark-parse");
const { default: remarkStringify } = await fromPackage(coreDir, "remark-stringify");
const { default: remarkGfm } = await fromPackage(join(scope, "preset-gfm"), "remark-gfm");
const core = await import("@milkdown/kit/core");

const source = await readFile(new URL("../src/markdown-serializer.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const coreUrl = import.meta.resolve("@milkdown/kit/core");
const moduleText = outputText.replace(/(["'])@milkdown\/kit\/core\1/, JSON.stringify(coreUrl));
const serializer = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);
const { markdownSerializerOptions, unescapeIntrawordUnderscores } = serializer;

const milkdownDefaults = core.remarkStringifyOptionsCtx._defaultValue;
assert.equal(typeof milkdownDefaults?.handlers?.text, "function", "Milkdown default text handler is available");

const processor = (options) => unified().use(remarkParse).use(remarkGfm).use(remarkStringify, options);
const stringify = (markdown, marker = "-") => String(processor(markdownSerializerOptions(milkdownDefaults, marker)).processSync(markdown));
const stock = (markdown) => String(processor(milkdownDefaults).processSync(markdown));
const strip = (node) => {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) if (key !== "position") out[key] = strip(value);
  return out;
};
const tree = (markdown) => strip(unified().use(remarkParse).use(remarkGfm).parse(markdown));

// The escape helper only touches `\_` with a letter/digit on both sides.
assert.equal(unescapeIntrawordUnderscores("CODE\\_MODE\\_PLAN"), "CODE_MODE_PLAN");
assert.equal(unescapeIntrawordUnderscores("中\\_文 é\\_ü 1\\_000"), "中_文 é_ü 1_000");
assert.equal(unescapeIntrawordUnderscores("\\_lead trail\\_ a\\_\\_b"), "\\_lead trail\\_ a\\_\\_b");
assert.equal(unescapeIntrawordUnderscores("a\\\\\\_b"), "a\\\\\\_b", "an escaped backslash before the underscore stays");

// A typical project document is written back unchanged.
const agents = [
  "# PaperNest",
  "",
  "- [README.md](README.md)：产品定位。",
  "- [CODE_MODE_REFACTOR_PLAN.md](CODE_MODE_REFACTOR_PLAN.md)：历史设计材料。",
  "- `settings.toml` keeps snake_case keys such as list_marker and auto_save.",
  "",
  "Links keep queries: [search](https://example.com/?a=1&b=2).",
  "",
].join("\n");
assert.equal(stringify(agents), agents);
assert.match(stock(agents), /CODE\\_MODE\\_REFACTOR\\_PLAN/, "stock Milkdown output escapes intraword underscores");

// List marker preference; "-" is the default.
assert.equal(stringify("* a\n* b\n"), "- a\n- b\n");
assert.equal(stringify("- a\n- b\n", "*"), "* a\n* b\n");

// Escapes that matter are kept.
assert.equal(stringify("\\_lead and trail\\_\n"), "\\_lead and trail\\_\n");
assert.equal(stringify("x\\_\\_y\n"), "x\\_\\_y\n");
assert.equal(stringify("a\\_ b\n"), "a\\_ b\n");

// Image alt text and e-mail autolinks are written as they were.
assert.equal(stringify("![file_name](file_name.png)\n"), "![file_name](file_name.png)\n");
assert.equal(stringify("<foo_bar@example.com>\n"), "<foo_bar@example.com>\n");

// Re-opening the saved text must yield the same document for tricky inputs.
const corpus = [
  "snake_case file_name_v2 1_000 中_文 é_ü",
  "__init__ and _x_y_ and foo_bar_",
  "**a_b** *c_d* [x_y](u_v) ![i_j](k_l.png)",
  // Not listed: `a_*b*_c` style emphasis glued to underscores. Milkdown's own
  // emphasis handler already mis-writes it (same output with and without
  // PaperNest's handlers, asserted below); those underscores are not between letters.
  "www.foo_bar.com and foo_bar@example.com and http://a_b.example",
  "literal a\\_b, a\\\\_b and \\\\_c",
  "## heading_with_words",
  "| col_a | col_b |\n| --- | --- |\n| a_b | c_d |",
  "- item_one\n- item_two\n  - nested_item",
  "> quote_text with `code_span` and ~~strike_out~~",
  "___\n\n_ _ _\n\n\\___",
];
for (const markdown of corpus) {
  const written = stringify(markdown);
  assert.deepEqual(tree(written), tree(markdown), `same document after save:\n${markdown}\n---\n${written}`);
  assert.equal(stringify(written), written, `saving again is stable:\n${written}`);
}

assert.equal(stringify("a_*b*_c and a_**b**"), stock("a_*b*_c and a_**b**"));

console.log("PASS: intraword underscores, list marker, link/image/e-mail destinations and re-parse equivalence.");
