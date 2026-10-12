import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual coordinator and rendering functions with only DOM/IPC
// boundaries stubbed. In particular, assertions run after the finally block.
const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["setUpdateActions", "setUpdateProgress", "renderVersionInfo", "checkVersion", "runVersionCheck",
  "snapshotSession", "persistSoon", "persistDocumentSession", "flushSettings", "restoreTabs", "usePreparedVersion", "applyNewMdMenu"]);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, names.size);
const settingsHandler = ast.statements.find(node => ts.isExpressionStatement(node)
  && ts.isBinaryExpression(node.expression)
  && node.expression.left.getText(ast) === "settingsPanel.onCheckUpdates");
assert.ok(settingsHandler);
const { outputText } = ts.transpileModule([
  "let versionInfo = null, versionError = null, preparedVersion = null, versionBusy = false, versionCheckTask = null;",
  "let updatePrimaryAction = null, updateSecondaryAction = null;",
  "let closing = false, sourceMode = false, sessionReady = false, explicitLaunchPending = false, persistTimer, geometryCaptureTimer;",
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

// Explicit-launch persistence gate (src/main.ts bootstrap order):
//   explicitLaunchPending = startupFiles.length > 0; await openPath(...);
//   sessionReady = true; persistSoon();
// and openPath() clears explicitLaunchPending only after a successful load.
// With explicitFile=true the strip is deliberately only the empty start page, so
// a failed or slow read must not snapshot that empty strip over the stored
// session. bootstrap() itself is not driven here; this exercises the gate.
const explicitLaunchSaves = [];
const explicitTimers = new Map();
context.window = {
  clearTimeout(id) { explicitTimers.delete(id); },
  setTimeout(callback) { const id = Symbol(); explicitTimers.set(id, callback); return id; },
};
context.settings = { open_last_session: true, open_files: ["a.md", "b.md"], open_file_scroll_positions: [120, 876.5],
  active_tab: 1, session_source_mode: true, session_workspace_root: "C:/project" };
const explicitSavedSession = structuredClone(context.settings);
context.tabBar.tabs = [];
context.tabBar.active = null;
context.tabBar.add = function(path, content) {
  const tab = { path, content, scrollTop: 0, id: `explicit-${this.tabs.length}` };
  this.tabs.push(tab);
  vm.runInContext("persistSoon()", context);
  return tab;
};
context.invoke = async command => {
  if (command === "save_settings") explicitLaunchSaves.push(structuredClone(context.settings));
};
vm.runInContext("sessionReady = false", context);
await vm.runInContext("restoreTabs(false, true)", context);
const pending = () => vm.runInContext("explicitLaunchPending", context);
vm.runInContext("explicitLaunchPending = true", context);
vm.runInContext("sessionReady = true; persistSoon()", context);
for (const callback of explicitTimers.values()) await callback();
assert.equal(context.tabBar.tabs.length, 1, "an explicit-file launch leaves only the start page");
assert.equal(pending(), true, "the launch target is still unread: persistence stays suspended");
assert.equal(explicitLaunchSaves.length, 0,
  "a not-yet-open explicit target must not overwrite the stored session");
assert.deepEqual(context.settings.open_files, explicitSavedSession.open_files);
assert.deepEqual(context.settings.open_file_scroll_positions, explicitSavedSession.open_file_scroll_positions);
assert.equal(context.settings.session_workspace_root, "C:/project");

// Drive the actual open/save branches after a failed explicit-file launch.
// Only filesystem/dialog/rendering boundaries are stubbed; never clear the gate
// manually to simulate success.
const documentNames = new Set(["openPath", "openPreviewPath", "readPath", "saveAs", "saveDoc", "queueTabSave", "writeTab",
  "persistDocumentSession", "persistSoon", "snapshotSession", "flushSettings"]);
const documentFunctions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && documentNames.has(node.name?.text));
assert.equal(documentFunctions.length, documentNames.size);
const documentScript = ts.transpileModule([
  "let sessionReady = true, explicitLaunchPending = true, previewOpenSequence = 0, persistTimer, geometryCaptureTimer;",
  "const saveChains = new WeakMap(); let autoSaveError = null;",
  ...documentFunctions.map(node => node.getText(ast)),
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function documentHarness() {
  const writes = [], timers = new Map();
  let nextId = 0;
  const tabs = { tabs: [], active: null,
    findByPath(path) { return this.tabs.find(tab => tab.path === path); },
    add(path, content, activate = true, imageUrl = null, startPage = false, loading = false) {
      const tab = { id: String(nextId++), path, content, saved: content, scrollTop: 0, imageUrl, startPage, loading };
      this.tabs.push(tab);
      if (activate) this.active = tab;
      return tab;
    },
    activate(id) { this.active = this.tabs.find(tab => tab.id === id); },
    remove(id) { this.tabs = this.tabs.filter(tab => tab.id !== id); this.active = this.tabs.at(-1) ?? null; },
    render() {}, refreshDirty() {},
  };
  const ctx = vm.createContext({
    secondaryWindow: false, sourceMode: true, codeViewVisible: false, tabBar: tabs,
    settings: { open_files: ["old.md"], open_file_scroll_positions: [321], active_tab: 0 },
    workspace: { rootPath: "C:/project", async setDocument() {}, async refresh() {} },
    window: { setTimeout(fn) { const id = Symbol(); timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } },
    async invoke(command, args) {
      if (command === "save_settings") { writes.push(structuredClone(args.settings)); return; }
      if (command === "write_document") return args.contents;
      if (args.path === "broken.md" || args.src === "broken.png") throw Error("read failed");
      return command === "read_image_data_url" ? "data:image/png;base64,AA==" : "file content";
    },
    isImagePath: path => path.endsWith(".png"), showUnsupportedPreviewNotice: () => false, async message() {},
    editor: { setDocPath() {}, setSpellcheck() {}, focus() {} },
    showTab() {}, setViewVisibility() {}, writeView() {}, adoptNormalized() {}, updateSourceButton() {}, updateTitle() {}, rememberNavigation() {},
    readView: () => "new content", viewScrollTop: () => 740, stem: () => "Untitled", knownExtensions: () => [],
    async save() { return "new.md"; }, updateTabContent() {}, reportAutoSaveError() {},
    markDirtyFromView() {}, async settleUnsaved() { return true; }, autoSavePending: new Set(),
  });
  vm.runInContext(documentScript, ctx);
  return { ctx, tabs, writes, timers, run: code => vm.runInContext(code, ctx),
    gate: () => vm.runInContext("explicitLaunchPending", ctx) };
}

for (const scenario of ["new tab", "ordinary", "existing", "preview", "preview existing", "preview replace", "image", "save as", "save retry", "auto save retry"]) {
  const h = documentHarness();
  await h.run('openPath("broken.md")');
  await h.run("flushSettings(true)");
  assert.equal(h.gate(), true);
  assert.equal(h.writes.length, 0, `${scenario}: failed launch preserves old settings`);
  assert.deepEqual(h.ctx.settings.open_files, ["old.md"]);
  if (scenario === "save as" || scenario.endsWith("save retry")) {
    h.tabs.add(null, "");
    if (scenario.endsWith("save retry")) {
      const invoke = h.ctx.invoke;
      h.ctx.invoke = async (command, args) => {
        if (command === "write_document") throw Error("write failed");
        return invoke(command, args);
      };
      assert.equal(await h.run("saveAs()"), false);
      assert.equal(h.gate(), true);
      h.ctx.invoke = invoke;
      assert.equal(await h.run(scenario === "auto save retry" ? "saveDoc(tabBar.active, { quiet: true })" : "saveDoc()"), true);
    } else assert.equal(await h.run("saveAs()"), true);
  } else if (scenario.startsWith("preview")) {
    if (scenario === "preview existing") h.tabs.add("good.md", "file content");
    if (scenario === "preview replace") h.tabs.add(null, "");
    await h.run('openPreviewPath("good.md")');
  } else {
    if (scenario === "existing") h.tabs.add("good.md", "file content");
    if (scenario === "ordinary") h.tabs.add(null, "");
    await h.run(`openPath("${scenario === "image" ? "good.png" : "good.md"}", ${scenario === "new tab"})`);
  }
  await h.run("flushSettings(true)");
  assert.equal(h.gate(), false, `${scenario}: valid document resumes persistence`);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(Array.from(h.writes[0].open_files), [scenario.startsWith("save") || scenario === "auto save retry" ? "new.md" : scenario === "image" ? "good.png" : "good.md"]);
  assert.deepEqual(Array.from(h.writes[0].open_file_scroll_positions), [740]);
  assert.equal(h.writes[0].session_source_mode, true);
  assert.equal(h.writes[0].session_workspace_root, "C:/project");
  assert.equal(h.timers.size, 0, "strict flush replaces the pending debounce");
}

for (const scenario of ["failed new tab", "failed image", "save cancel", "save failure", "preview cancel", "closed read", "stale preview", "existing loading", "preview existing loading", "closed save"]) {
  const h = documentHarness();
  if (scenario === "failed new tab") await h.run('openPath("broken.md", true)');
  if (scenario === "failed image") await h.run('openPath("broken.png", true)');
  if (scenario.startsWith("save")) {
    h.tabs.add(null, "new content");
    if (scenario === "save cancel") h.ctx.save = async () => null;
    else h.ctx.invoke = async () => { throw Error("write failed"); };
    assert.equal(await h.run("saveAs()"), false);
  }
  if (scenario === "preview cancel") {
    const dirty = h.tabs.add(null, "unsaved"); dirty.dirty = true;
    h.ctx.settleUnsaved = async () => false;
    await h.run('openPreviewPath("good.md")');
  }
  if (scenario === "closed read" || scenario === "stale preview") {
    let finishRead;
    h.ctx.invoke = () => new Promise(resolve => { finishRead = resolve; });
    const opening = h.run(scenario === "closed read" ? 'openPath("slow.md", true)' : 'openPreviewPath("slow.md")');
    if (scenario === "closed read") h.tabs.remove(h.tabs.active.id);
    else h.run("++previewOpenSequence");
    finishRead("file content");
    await opening;
  }
  if (scenario.endsWith("existing loading")) {
    h.tabs.add("slow.md", "", true, null, false, true);
    await h.run(scenario.startsWith("preview") ? 'openPreviewPath("slow.md")' : 'openPath("slow.md", true)');
  }
  if (scenario === "closed save") {
    h.tabs.add(null, "");
    let finishWrite;
    h.ctx.invoke = () => new Promise(resolve => { finishWrite = resolve; });
    const saving = h.run("saveAs()");
    await new Promise(resolve => setImmediate(resolve));
    h.tabs.remove(h.tabs.active.id);
    finishWrite("new content");
    await saving;
  }
  await h.run("flushSettings(true)");
  assert.equal(h.gate(), true, `${scenario}: no valid replacement session`);
  assert.equal(h.writes.length, 0);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.ctx.settings.open_files, ["old.md"]);
}

// An overlapping read may still have a path but is not part of the session yet.
const overlapping = documentHarness();
overlapping.tabs.add("loading.md", "", false, null, false, true);
await overlapping.run('openPath("good.md", true)');
await overlapping.run("flushSettings(true)");
assert.deepEqual(Array.from(overlapping.writes[0].open_files), ["good.md"]);
// Drive the actual native coordinator: no request may read before editor/session
// startup, and a second native event must not overlap the first document read.
const nativeNames = new Set(["drainNativeFiles", "restoreInitialDocuments"]);
const nativeFunctions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && nativeNames.has(node.name?.text));
assert.equal(nativeFunctions.length, nativeNames.size);
const nativeJs = ts.transpileModule([
  "let nativeFilesReady = false, nativeFilesRequested = false, nativeFileTask = null;",
  "let sessionReady = false, explicitLaunchPending = false;",
  ...nativeFunctions.map(node => node.getText(ast)),
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const nativeReads = [], nativeOpens = [], nativeSaves = [], nativeRestores = [];
let batches = [["cold 中文.md", "two.md"]], releaseRead, signalReadStarted;
const readStarted = new Promise(resolve => { signalReadStarted = resolve; });
const nativeContext = vm.createContext({
  secondaryWindow: false, workspaceLaunch: null,
  invoke: async command => { nativeReads.push(command); return batches.shift() ?? []; },
  openPath: async (path, inNewTab) => {
    nativeOpens.push([path, inNewTab]);
    if (path === "slow.md") await new Promise(resolve => { releaseRead = resolve; signalReadStarted(); });
  },
  restoreTabs: async (...args) => nativeRestores.push(args),
  persistSoon: () => nativeSaves.push(vm.runInContext("[sessionReady, explicitLaunchPending]", nativeContext)),
  win: { async unminimize() {}, async setFocus() {} },
});
vm.runInContext(nativeJs, nativeContext);
const nativeRun = code => vm.runInContext(code, nativeContext);
await nativeRun("drainNativeFiles()");
assert.equal(nativeReads.length, 0, "early wake-up waits for startup");
await nativeRun('restoreInitialDocuments(false, ["cold 中文.md", "two.md"])');
assert.deepEqual(nativeRestores, [[false, true]], "native cold launch bypasses old session");
assert.deepEqual(nativeOpens, [["cold 中文.md", false], ["two.md", true]]);
assert.deepEqual(Array.from(nativeSaves[0]), [true, true], "failed reads keep old session gated");
nativeOpens.length = 0;
batches = [["slow.md", "second.md"], ["third.md"]];
nativeRun("nativeFilesReady = true");
const firstDrain = nativeRun("drainNativeFiles()");
await readStarted;
assert.deepEqual(nativeOpens, [["slow.md", true]]);
const secondDrain = nativeRun("drainNativeFiles()");
assert.equal(firstDrain, secondDrain, "concurrent events share one drain");
assert.equal(nativeReads.length, 1, "no second batch consumed during first read");
releaseRead();
await firstDrain;
assert.deepEqual(nativeOpens, [["slow.md", true], ["second.md", true], ["third.md", true]]);
assert.equal(nativeReads.length, 2, "event received during read is retained");
nativeContext.invoke = async () => { throw new Error("IPC unavailable"); };
await assert.rejects(nativeRun("drainNativeFiles()"), /IPC unavailable/);
assert.equal(nativeRun("nativeFileTask"), null, "failed drain releases the coordinator");
nativeContext.invoke = async () => ["retry.md"];
await nativeRun("drainNativeFiles()");
assert.deepEqual(nativeOpens.at(-1), ["retry.md", true]);
nativeRestores.length = 0;
await nativeRun("restoreInitialDocuments(false, [])");
assert.deepEqual(nativeRestores, [[false, false]], "ordinary startup still restores preferences");
console.log("PASS: update feedback/concurrency, save-before-restart, startup session protection, 21 real open/save persistence branches, and native startup/serialized file handoff.");

// A user lock is distinct from keeping an explicitly opened tab. Both preview
// lookup and an empty active slot must honour it without replacing its content.
for (const scenario of ["locked preview", "locked active", "locked empty"]) {
  const h = documentHarness();
  const original = h.tabs.add(scenario === "locked empty" ? null : "locked.md", scenario === "locked empty" ? "" : "original");
  original.locked = true;
  original.preview = scenario === "locked preview";
  await h.run(scenario === "locked empty" ? 'openPath("good.md")' : 'openPreviewPath("good.md")');
  assert.equal(h.tabs.tabs.length, 2, scenario);
  assert.equal(original.path, scenario === "locked empty" ? null : "locked.md");
  assert.equal(original.content, scenario === "locked empty" ? "" : "original");
  assert.equal(h.tabs.active.path, "good.md");
}
const lockDuringRead = documentHarness();
const readingSlot = lockDuringRead.tabs.add("locked.md", "original");
readingSlot.preview = true;
let finishLockedRead;
lockDuringRead.ctx.invoke = () => new Promise(resolve => { finishLockedRead = resolve; });
const delayedPreview = lockDuringRead.run('openPreviewPath("slow.md")');
readingSlot.locked = true;
finishLockedRead("new content");
await delayedPreview;
assert.equal(readingSlot.path, "locked.md", "locking during a pending read protects the old document");
assert.equal(lockDuringRead.tabs.tabs.length, 2);

const tabActionNames = new Set(["closeTabs", "moveTabToNewWindow"]);
const tabActionFunctions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && tabActionNames.has(node.name?.text));
assert.equal(tabActionFunctions.length, tabActionNames.size);
const tabActionJs = ts.transpileModule([
  "let tabActionBusy = false;",
  ...tabActionFunctions.map(node => node.getText(ast)),
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function tabActionHarness() {
  const events = [];
  const tabs = ["a", "b", "c"].map(id => ({ id, path: `${id}.md`, content: id, dirty: false, loading: false, startPage: false }));
  const tabBar = { tabs, active: tabs[0], remove(id) {
    events.push(`remove:${id}`);
    this.tabs = this.tabs.filter(tab => tab.id !== id);
  } };
  const ctx = vm.createContext({
    tabBar, autoSavePending: new Set(tabs),
    markDirtyFromView() { events.push("sync-view"); },
    persistSoon() { events.push("persist"); },
    async settleUnsaved(targets) { events.push(`settle:${targets.map(tab => tab.id).join(",")}`); return true; },
    async saveBeforeClose(tab) { events.push("save"); tab.path ??= "saved.md"; tab.dirty = false; return true; },
    async invoke(command, args) { events.push(`${command}:${args.path}`); },
  });
  vm.runInContext(tabActionJs, ctx);
  return { ctx, tabs, tabBar, events, run: code => vm.runInContext(code, ctx) };
}

const bulk = tabActionHarness();
await bulk.run("closeTabs(tabBar.tabs.slice(1))");
assert.deepEqual(bulk.events, ["sync-view", "settle:b,c", "remove:b", "remove:c", "persist"]);
assert.deepEqual(bulk.tabBar.tabs.map(tab => tab.id), ["a"]);
for (const outcome of ["cancel", "save failure"]) {
  const h = tabActionHarness();
  h.ctx.settleUnsaved = async () => false;
  await h.run("closeTabs([...tabBar.tabs])");
  assert.equal(h.tabBar.tabs.length, 3, `${outcome}: no partial close`);
  assert.equal(h.run("tabActionBusy"), false);
}
const concurrentClose = tabActionHarness();
let releaseClose;
concurrentClose.ctx.settleUnsaved = () => new Promise(resolve => { releaseClose = resolve; });
const pendingClose = concurrentClose.run("closeTabs([...tabBar.tabs])");
await concurrentClose.run("closeTabs([...tabBar.tabs])");
assert.equal(concurrentClose.tabBar.tabs.length, 3);
releaseClose(false);
await pendingClose;
assert.equal(concurrentClose.run("tabActionBusy"), false);

for (const scenario of ["saved", "dirty", "untitled", "cancel save", "window failure", "later edit", "loading", "start page"]) {
  const h = tabActionHarness();
  const tab = h.tabs[0];
  tab.dirty = ["dirty", "untitled", "cancel save"].includes(scenario);
  if (scenario === "untitled") tab.path = null;
  if (scenario === "cancel save") h.ctx.saveBeforeClose = async () => false;
  if (scenario === "loading") tab.loading = true;
  if (scenario === "start page") tab.startPage = true;
  if (scenario === "window failure") h.ctx.invoke = async () => { throw Error("window failed"); };
  if (scenario === "later edit") h.ctx.invoke = async () => { tab.content = "new edit"; tab.dirty = true; };
  if (scenario === "window failure") await assert.rejects(h.run("moveTabToNewWindow(tabBar.active)"), /window failed/);
  else await h.run("moveTabToNewWindow(tabBar.active)");
  assert.equal(h.tabBar.tabs.includes(tab), !["saved", "dirty", "untitled"].includes(scenario), scenario);
  assert.equal(h.run("tabActionBusy"), false, `${scenario}: release action guard`);
  if (scenario === "dirty" || scenario === "untitled") {
    assert(h.events.indexOf("save") < h.events.findIndex(event => event.startsWith("open_workspace_window:")));
  }
  if (["cancel save", "loading", "start page"].includes(scenario)) {
    assert(!h.events.some(event => event.startsWith("open_workspace_window:")));
  }
}
console.log("PASS: locked tabs survive navigation; bulk close is guarded and atomic on cancel; moving tabs saves first and preserves the source on failure or later edits.");
