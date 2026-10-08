import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual coordinator and rendering functions with only DOM/IPC
// boundaries stubbed. In particular, assertions run after the finally block.
const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["setUpdateActions", "setUpdateProgress", "renderVersionInfo", "checkVersion", "runVersionCheck"]);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, names.size);
const settingsHandler = ast.statements.find(node => ts.isExpressionStatement(node)
  && ts.isBinaryExpression(node.expression)
  && node.expression.left.getText(ast) === "settingsPanel.onCheckUpdates");
assert.ok(settingsHandler);
const { outputText } = ts.transpileModule([
  "let versionInfo = null, versionError = null, preparedVersion = null, versionBusy = false, versionCheckTask = null;",
  "let updatePrimaryAction = null, updateSecondaryAction = null;",
  ...functions.map(node => node.getText(ast)),
  settingsHandler.getText(ast),
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } });

const element = () => ({ hidden: true, disabled: false, textContent: "", style: {} });
const context = vm.createContext({
  settings: { proxy_enabled: false, proxy_url: "" },
  settingsPanel: {},
  persistSoon() {},
  t: (key, args) => args ? `${key}: ${Object.values(args).join(" ")}` : key,
  prepareLatestVersion() {}, usePreparedVersion() {}, openUrl() {},
  ...Object.fromEntries([
    "updateDot", "updateCheckButton", "updateStatusEl", "updateNotesEl",
    "updateProgressEl", "updateProgressBar", "updateProgressText", "updateActionsEl",
    "updatePrimaryButton", "updateSecondaryButton",
  ].map(name => [name, element()])),
});
vm.runInContext(outputText, context);
const check = () => vm.runInContext("checkVersion()", context);
const info = { currentVersion: "0.1.5", latestVersion: "0.1.6", updateAvailable: true,
  canDownload: true, mode: "installed", notes: "Fix updates", releaseUrl: "https://example.invalid/release" };

context.invoke = async () => { throw new Error("metadata returned HTTP 503"); };
await check();
assert.equal(context.updateStatusEl.hidden, false);
assert.match(context.updateStatusEl.textContent, /HTTP 503/);
assert.equal(context.updateCheckButton.disabled, false);
vm.runInContext("renderVersionInfo()", context);
assert.equal(context.updateStatusEl.hidden, false, "reopening About preserves the failure");
assert.match(await context.settingsPanel.onCheckUpdates(), /HTTP 503/, "settings retains the actual error");

context.invoke = async () => info;
await check();
assert.equal(context.updateStatusEl.textContent, "update.available: 0.1.6");
assert.equal(context.updateNotesEl.textContent, "Fix updates");
assert.equal(context.updatePrimaryButton.hidden, false);
assert.equal(context.updatePrimaryButton.textContent, "update.downloadInstalled");
assert.equal(context.updateDot.hidden, false);
assert.equal(context.updateCheckButton.disabled, false);

context.invoke = async () => ({ ...info, updateAvailable: false });
await check();
assert.equal(context.updateStatusEl.textContent, "update.latest");
assert.equal(context.updateCheckButton.disabled, false, "background no-update check releases the button");
assert.equal(context.updateDot.hidden, true);
assert.equal(context.updateActionsEl.hidden, true);

let complete;
let calls = 0;
context.invoke = () => { calls++; return new Promise(resolve => { complete = resolve; }); };
const background = check();
assert.equal(context.updateCheckButton.disabled, true);
const manual = context.settingsPanel.onCheckUpdates();
complete({ ...info, mode: "portable" });
await background;
assert.equal(await manual, "update.available: 0.1.6");
assert.equal(calls, 1, "manual check joins the pending background request");
assert.equal(context.updatePrimaryButton.textContent, "update.downloadPortable");
assert.equal(context.updateCheckButton.disabled, false);

context.invoke = async () => ({ ...info, canDownload: false });
await check();
assert.match(context.updateStatusEl.textContent, /update.assetPending/);
assert.equal(context.updatePrimaryButton.hidden, true);
assert.equal(context.updateSecondaryButton.hidden, false);
console.log("PASS: update errors survive finally/reopening and reach settings; retry, latest, concurrent checks and signed-package actions work.");
