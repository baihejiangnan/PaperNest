import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/tab-path.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { tabPathKey } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
assert.equal(tabPathKey(String.raw`\\?\C:\回归 空格\文档.md`), tabPathKey(String.raw`C:\回归 空格\文档.md`));
assert.equal(tabPathKey(String.raw`\\?\UNC\server\share\文档.md`), tabPathKey(String.raw`\\server\share\文档.md`));
assert.equal(tabPathKey(String.raw`C:\Test\file.md`), tabPathKey("c:/test/file.md"));
assert.notEqual(tabPathKey(String.raw`C:\Test\file.md`), tabPathKey(String.raw`C:\Other\file.md`));
console.log("PASS: ordinary/extended Windows and UNC paths share tab identity; different files remain distinct.");
