import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual coordinator and rendering functions with only DOM/IPC
// boundaries stubbed. In particular, assertions run after the finally block.
const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["setUpdateActions", "setUpdateProgress", "renderVersionInfo", "checkVersion", "runVersionCheck",
  "snapshotSession", "persistSoon", "flushSettings", "restoreTabs", "usePreparedVersion", "applyNewMdMenu"]);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, names.size);
const settingsHandler = ast.statements.find(node => ts.isExpressionStatement(node)
  && ts.isBinaryExpression(node.expression)
  && node.expression.left.getText(ast) === "settingsPanel.onCheckUpdates");
assert.ok(settingsHandler);
const { outputText } = ts.transpileModule([
  "let versionInfo = null, versionError = null, preparedVersion = null, versionBusy = false, versionCheckTask = null;",
  "let updatePrimaryAction = null, updateSecondaryAction = null;",
  "let closing = false, sourceMode = false, sessionReady = false, persistTimer, geometryCaptureTimer;",
  "let newMdMenuBusy = false, newMdMenuStatus;",
  ...functions.map(node => node.getText(ast)),
  settingsHandler.getText(ast),
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } });

const element = () => ({ hidden: true, disabled: false, textContent: "", style: {} });
const context = vm.createContext({
  settings: { proxy_enabled: false, proxy_url: "" },
  secondaryWindow: true,
  settingsPanel: {},
  workspace: { rootPath: null, async setRoot(path) { this.rootPath = path; } },
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
// Exercise the real shutdown coordinator: saving must precede handoff/close,
// and a failed save/handoff/cancel must leave the reader open.
const events = [];
vm.runInContext("sessionReady = true", context);
const readingTab = { path: "C:/文档/reading.md", scrollTop: 0, id: "active" };
context.tabBar = { tabs: [readingTab], active: readingTab };
context.secondaryWindow = false;
context.viewScrollTop = () => 876.5;
context.window = { clearTimeout() {} };
context.markDirtyFromView = () => events.push("dirty");
context.settleUnsaved = async () => true;
context.cancelAutoSave = () => events.push("cancel-auto-save");
context.captureGeometry = async () => events.push("geometry");
context.win = { destroy: async () => events.push("close") };
context.invoke = async command => events.push(command);
vm.runInContext("preparedVersion = { version: '0.2.2' }; versionError = null", context);
await vm.runInContext("usePreparedVersion()", context);
assert.deepEqual(events, ["dirty", "cancel-auto-save", "geometry", "save_settings", "use_prepared_version", "close"]);
assert.deepEqual(Array.from(context.settings.open_files), [readingTab.path]);
assert.deepEqual(Array.from(context.settings.open_file_scroll_positions), [876.5]);

for (const failedCommand of ["save_settings", "use_prepared_version"]) {
  events.length = 0;
  context.invoke = async command => {
    events.push(command);
    if (command === failedCommand) throw new Error(`failed ${command}`);
  };
  await vm.runInContext("usePreparedVersion()", context);
  assert.ok(!events.includes("close"));
  if (failedCommand === "save_settings") assert.ok(!events.includes("use_prepared_version"));
  assert.match(context.updateStatusEl.textContent, new RegExp(failedCommand));
}
events.length = 0;
context.settleUnsaved = async () => false;
await vm.runInContext("usePreparedVersion()", context);
assert.deepEqual(events, ["dirty"]);
assert.equal(vm.runInContext("closing", context), false);

// add() intentionally mutates persisted state just like real restore callbacks.
// The original offsets/active index must be captured before those callbacks.
const restoredTabs = [];
context.tabBar = {
  add(path, content, activate, imageUrl, startPage) {
    const tab = { path, content, id: `restored-${restoredTabs.length}`, scrollTop: 0, startPage };
    restoredTabs.push(tab);
    context.settings.open_files = [];
    context.settings.open_file_scroll_positions = [];
    context.settings.active_tab = 0;
    return tab;
  },
  activate(id) { this.activeId = id; },
};
context.isImagePath = () => false;
context.invoke = async (_command, { path }) => {
  if (path === "missing.md") throw new Error("missing file");
  return `text for ${path}`;
};
context.settings = { open_last_session: false, open_files: ["a.md", "missing.md", "b.md"],
  open_file_scroll_positions: [120, 300, 876.5], active_tab: 2, session_source_mode: true };
await vm.runInContext("restoreTabs(true)", context);
assert.deepEqual(restoredTabs.map(tab => [tab.path, tab.scrollTop]), [["a.md", 120], ["b.md", 876.5]]);
assert.equal(context.tabBar.activeId, "restored-1");
assert.equal(vm.runInContext("sourceMode", context), true);
restoredTabs.length = 0;
await vm.runInContext("restoreTabs(false)", context);
assert.equal(restoredTabs[0].startPage, true, "ordinary startup still honors open_last_session=false");
restoredTabs.length = 0;
context.settings.open_last_session = true;
context.settings.open_files = ["a.md"];
context.settings.session_workspace_root = "C:/project";
await vm.runInContext("restoreTabs(false, true)", context);
assert.equal(restoredTabs[0].startPage, true, "an explicit file launch does not reopen unrelated old tabs");
assert.equal(context.workspace.rootPath, null, "an explicit file launch does not load the previous project");

// Real startup synchronizes ShellNew before restoreTabs(). A preference save
// with an empty tab strip must not overwrite the still-unrestored session.
const startupSaves = [];
const startupTimers = new Map();
context.window = {
  clearTimeout(id) { startupTimers.delete(id); },
  setTimeout(callback) { const id = Symbol(); startupTimers.set(id, callback); return id; },
};
context.settingsPanel.setNewMdMenuStatus = () => {};
context.settings = { windows_new_md: true, open_last_session: false, open_files: ["a.md", "b.md"],
  open_file_scroll_positions: [120, 876.5], active_tab: 1, session_source_mode: true,
  session_workspace_root: "C:/project" };
const savedSession = structuredClone(context.settings);
context.tabBar = { tabs: [], active: null };
context.invoke = async command => {
  if (command === "set_new_md_menu") return { enabled: true };
  if (command === "save_settings") startupSaves.push(structuredClone(context.settings));
};
vm.runInContext("sessionReady = false", context);
await vm.runInContext("applyNewMdMenu(true)", context);
assert.deepEqual(context.settings, savedSession, "ShellNew startup sync preserves the unread session");
assert.equal(startupTimers.size, 0, "initialization must not queue a partial session write");
await vm.runInContext("flushSettings(true)", context);
assert.deepEqual(startupSaves[0].open_files, savedSession.open_files, "early flush preserves the saved session");

let finishSecondRead;
context.tabBar.add = function(path, content) {
  const tab = { path, content, scrollTop: 0, id: `startup-${this.tabs.length}` };
  this.tabs.push(tab);
  vm.runInContext("persistSoon()", context);
  return tab;
};
context.tabBar.activate = function(id) { this.active = this.tabs.find(tab => tab.id === id); };
context.invoke = async (command, args) => {
  if (command === "read_document") {
    if (args.path === "b.md") await new Promise(resolve => { finishSecondRead = resolve; });
    return `text for ${args.path}`;
  }
  if (command === "save_settings") startupSaves.push(structuredClone(context.settings));
};
const startupRestore = vm.runInContext("restoreTabs(true)", context);
await new Promise(resolve => setImmediate(resolve));
assert.equal(context.tabBar.tabs.length, 1);
assert.deepEqual(context.settings.open_files, savedSession.open_files, "slow file reads do not truncate the saved session");
assert.equal(startupTimers.size, 0);
finishSecondRead();
await startupRestore;
assert.deepEqual(context.tabBar.tabs.map(tab => [tab.path, tab.scrollTop]), [["a.md", 120], ["b.md", 876.5]]);
assert.equal(context.tabBar.active.path, "b.md");
assert.equal(context.workspace.rootPath, "C:/project");
vm.runInContext("sessionReady = true; persistSoon()", context);
for (const callback of startupTimers.values()) await callback();
assert.deepEqual(Array.from(startupSaves.at(-1).open_files), savedSession.open_files);
assert.equal(startupSaves.at(-1).active_tab, 1);
assert.equal(startupSaves.at(-1).open_last_session, false);
context.settings.open_last_session = true;
context.tabBar.tabs = [];
context.tabBar.active = null;
context.invoke = async (_command, { path }) => `text for ${path}`;
vm.runInContext("sessionReady = false", context);
await vm.runInContext("restoreTabs(false)", context);
assert.deepEqual(context.tabBar.tabs.map(tab => tab.path), ["a.md", "b.md"]);
assert.equal(context.tabBar.active.path, "b.md", "ordinary no-file startup restores the active tab by default");
console.log("PASS: update feedback/concurrency, save-before-restart, startup ShellNew/slow-read session preservation, default restore and explicit-file/disabled startup.");
