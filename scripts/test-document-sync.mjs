import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// Run the shipping coordinators; only editor/IPC/dialog boundaries are simulated.
const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["loadPath", "readPath", "flagExternalChange", "applyDiskDocument", "syncDocuments",
  "resolveDocumentConflict", "writeTab", "queueTabSave", "saveDoc", "saveAs", "autoSaveTab",
  "noteUserEdit", "flushAutoSave", "updateTabContent", "markDirtyFromView", "settleUnsaved", "saveBeforeClose"]);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, names.size);
const script = ts.transpileModule([
  "let sessionReady = true, switching = false, documentComposing = false, documentSyncBusy = false;",
  "let autoSaveTimer, autoSaveError = null, explicitLaunchPending = false; const AUTO_SAVE_DELAY_MS = 1500;",
  "const autoSavePending = new Set(), savingTabs = new Set(), saveChains = new WeakMap(), documentSyncErrors = new WeakMap();",
  ...functions.map(node => node.getText(ast)),
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function harness(image = false) {
  const disk = new Map([["doc.md", { content: "original", version: "v1", stamp: "s1" }]]);
  const tab = { id: "t1", path: "doc.md", content: "original", saved: "original", dirty: false,
    imageUrl: image ? "image:v1" : null, scrollTop: 400, disk: { version: image ? null : "v1", stamp: "s1" }, externalChange: false };
  let view = tab.content, mounts = 0;
  const writes = [], notices = [], timers = new Set(), outlined = [];
  const tabs = { tabs: [tab], active: tab, refreshDirty() {}, render() {} };
  const ctx = vm.createContext({
    tabBar: tabs, document: { hidden: false }, settings: { auto_save: true }, codeViewVisible: true,
    readView: () => view, viewScrollTop: () => 400,
    writeView(value, scroll) { assert.equal(scroll, 400); view = value; mounts++; },
    editor: { async refreshLocalImages() {}, setDocPath() {} },
    imageElement: {}, imageDocument: { scrollTop: 400 },
    setViewVisibility() {}, adoptNormalized() {}, scheduleTextStats() {}, updateTitle() {}, updateSourceButton() {},
    workspace: { async setDocument(path, text) { outlined.push([path, text]); }, async refresh() {} },
    hasActiveModal: () => false, persistSoon() {}, persistDocumentSession() {},
    showUnsupportedPreviewNotice: () => false, baseName: value => value, stem: () => "Untitled", knownExtensions: () => [],
    t: (key, args) => `${key}: ${JSON.stringify(args)}`, async message(body) { notices.push(body); },
    reportAutoSaveError(_path, error) { notices.push(String(error)); },
    async confirmDialog() { return { choice: "cancel" }; }, async askSaveChanges() { return "cancel"; },
    isImagePath: () => image, async save() { return "copy.md"; },
    window: { clearTimeout(fn) { timers.delete(fn); }, setTimeout(fn) { timers.add(fn); return fn; } },
    async invoke(command, args) {
      if (command === "get_document_stamps") return args.paths.map(path => ({ path,
        stamp: disk.has(path) ? { Ok: disk.get(path).stamp } : { Err: "missing file" } }));
      const current = disk.get(args.path);
      if (command === "get_document_version") return current?.version ?? null;
      if (command === "read_image_data_url") return `image:${disk.get(args.src).version}`;
      if (command === "read_document_state") {
        if (!current) throw "missing file";
        return { ...current };
      }
      assert.equal(command, "write_document_checked");
      writes.push({ ...args });
      if ((current?.version ?? null) !== args.expectedVersion) throw "PAPERNEST_DOCUMENT_CONFLICT";
      const written = { content: args.contents, version: `written-${writes.length}`, stamp: `written-${writes.length}` };
      disk.set(args.path, written);
      return written;
    },
  });
  vm.runInContext(script, ctx);
  return { tab, tabs, ctx, disk, writes, notices, timers, outlined, mounts: () => mounts,
    view: () => view, edit(value) { view = value; }, run: code => vm.runInContext(code, ctx),
    external(value = "external", stamp = "s2") { disk.set("doc.md", { content: value, version: value, stamp }); } };
}

{
  const h = harness(); h.external();
  await h.run("syncDocuments()");
  assert.equal(h.view(), "external");
  assert.equal(h.tab.saved, "external");
  assert.equal(h.tab.dirty, false);
  assert.equal(h.tab.scrollTop, 400);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.outlined, [["doc.md", "external"]]);
}
{
  const h = harness(); h.edit("local unsaved"); h.external();
  h.run("markDirtyFromView(); noteUserEdit(tabBar.active)");
  await h.run("syncDocuments()");
  assert.equal(h.view(), "local unsaved");
  assert.equal(h.tab.content, "local unsaved");
  assert.equal(h.tab.dirty, true);
  assert.equal(h.tab.externalChange, true);
  for (const action of ["noteUserEdit(tabBar.active)", "flushAutoSave()", "autoSaveTab(tabBar.active)", "saveDoc(tabBar.active, {quiet:true})"]) await h.run(action);
  assert.equal(h.writes.length, 0, "all automatic paths preserve the external version");
  await h.run("syncDocuments()");
  assert.equal(h.notices.length, 1, "a conflict does not repeatedly interrupt reading");
  assert.equal(await h.run('settleUnsaved([tabBar.active], "quit")'), false, "cancelled shutdown keeps conflicted local edits open");
  assert.equal(await h.run("saveDoc()"), false, "cancel preserves both versions");
  assert.equal(h.view(), "local unsaved");
  assert.equal(h.disk.get("doc.md").content, "external");
  h.ctx.confirmDialog = async () => ({ choice: "alternate" });
  await h.run("saveDoc()");
  assert.equal(h.view(), "external", "explicit reload is the only discard path");
  assert.equal(h.tab.externalChange, false);
  assert.equal(h.writes.length, 0);
}
{
  const h = harness(); h.external("same stamp, different bytes", "s1");
  await h.run("syncDocuments(true)");
  assert.equal(h.view(), "same stamp, different bytes", "focus/open checks also detect preserved metadata");
}
{
  const h = harness(); h.tabs.active = null; h.external("background update");
  await h.run("syncDocuments()");
  assert.equal(h.tab.content, "background update");
  assert.equal(h.tabs.active, null);
  assert.equal(h.mounts(), 0, "background tabs refresh without taking focus");
}
{
  const h = harness(); h.edit("local"); h.external();
  // No poll has run yet: the backend check still rejects the auto-save.
  h.run("markDirtyFromView(); noteUserEdit(tabBar.active)");
  await h.run("flushAutoSave()");
  assert.equal(h.disk.get("doc.md").content, "external");
  assert.equal(h.tab.externalChange, true);
  assert.equal(h.run("autoSavePending.size"), 0);
  h.ctx.confirmDialog = async () => ({ choice: "confirm" });
  assert.equal(await h.run("saveDoc()"), true);
  assert.equal(h.disk.get("doc.md").content, "local");
  assert.equal(h.tab.externalChange, false);
  assert.equal(h.tab.dirty, false);
}
{
  const h = harness(); h.edit("local"); h.external();
  await h.run("syncDocuments()");
  h.ctx.confirmDialog = async () => { h.external("newer external", "s3"); return { choice: "confirm" }; };
  assert.equal(await h.run("saveDoc()"), false, "approval of one version does not authorize overwriting a later change");
  assert.equal(h.disk.get("doc.md").content, "newer external");
  assert.equal(h.view(), "local");
}
{
  const h = harness(); h.edit("local"); h.external();
  await h.run("syncDocuments()");
  assert.equal(await h.run("saveAs()"), true);
  assert.equal(h.disk.get("doc.md").content, "external");
  assert.equal(h.disk.get("copy.md").content, "local");
  assert.equal(h.tab.path, "copy.md");
  assert.equal(h.tab.externalChange, false);
}
{
  const h = harness(); h.edit("local");
  const invoke = h.ctx.invoke;
  h.ctx.invoke = async (command, args) => {
    if (command === "write_document_checked") throw "permission denied";
    return invoke(command, args);
  };
  const originalDisk = h.tab.disk;
  assert.equal(await h.run("saveAs()"), false);
  assert.equal(h.tab.path, "doc.md");
  assert.equal(h.tab.disk, originalDisk);
  assert.equal(h.view(), "local");
}
for (const scenario of ["edit", "close", "reuse", "own save"]) {
  const h = harness(); h.external();
  const invoke = h.ctx.invoke;
  let finish;
  h.ctx.invoke = async (command, args) => {
    const result = await invoke(command, args);
    if (command === "read_document_state") await new Promise(resolve => { finish = resolve; });
    return result;
  };
  const checking = h.run("syncDocuments()");
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(finish);
  if (scenario === "edit") h.edit("typed while reading");
  if (scenario === "close") h.tabs.tabs = [];
  if (scenario === "reuse") { h.tab.path = "different.md"; h.tab.content = "different"; }
  if (scenario === "own save") { h.tab.disk = { version: "own save", stamp: "own stamp" }; h.tab.content = "own save"; }
  finish(); await checking;
  assert.equal(h.mounts(), 0, `${scenario}: a late read cannot replace the live view`);
  if (scenario === "edit") assert.equal(h.tab.content, "typed while reading");
}
{
  const h = harness(); h.edit("local");
  const invoke = h.ctx.invoke;
  h.ctx.invoke = async (command, args) => {
    if (command === "write_document_checked") {
      h.disk.set("copy.md", { content: "new external destination", version: "new", stamp: "new" });
    }
    return invoke(command, args);
  };
  assert.equal(await h.run("saveAs()"), false);
  assert.equal(h.disk.get("copy.md").content, "new external destination");
  assert.equal(h.tab.path, "doc.md");
  assert.equal(h.tab.externalChange, false, "destination conflicts do not mark the unchanged source as conflicted");
  assert.equal(h.view(), "local");
}
{
  const h = harness(); h.disk.delete("doc.md");
  await h.run("syncDocuments()");
  assert.equal(h.view(), "original");
  assert.equal(h.tab.externalChange, true);
  h.edit("local"); h.run("markDirtyFromView(); noteUserEdit(tabBar.active)");
  await h.run("flushAutoSave()");
  assert.equal(h.disk.has("doc.md"), false, "auto-save cannot resurrect a deleted file");
  h.external("restored", "s3");
  await h.run("syncDocuments()");
  assert.equal(h.view(), "local", "recreation still respects local edits");
}
{
  const h = harness();
  h.tab.saved = h.tab.content = "normalized preview"; h.edit("normalized preview");
  h.disk.get("doc.md").stamp = "touched";
  await h.run("syncDocuments()");
  assert.equal(h.mounts(), 0, "touching an unchanged file does not rebuild the editor");
  h.edit("edited preview"); h.run("markDirtyFromView()");
  assert.equal(await h.run("saveDoc()"), true);
  assert.equal(h.writes[0].expectedVersion, "v1", "disk identity is independent of Markdown normalization");
}
{
  const h = harness(true); h.external("image-v2");
  await h.run("syncDocuments()");
  assert.equal(h.tab.imageUrl, "image:image-v2");
  assert.equal(h.tab.dirty, false);
  assert.equal(h.mounts(), 0);
  h.ctx.imageElement.onload();
  assert.equal(h.ctx.imageDocument.scrollTop, 400);
}
{
  const h = harness(); h.external(); h.run("documentComposing = true");
  await h.run("syncDocuments()"); assert.equal(h.view(), "original");
  h.run("documentComposing = false"); h.ctx.hasActiveModal = () => true;
  await h.run("syncDocuments()"); assert.equal(h.view(), "original");
  h.ctx.hasActiveModal = () => false;
  await h.run("syncDocuments()"); assert.equal(h.view(), "external");
}

console.log("PASS: external refresh, dirty/auto-save conflicts, explicit resolution/Save As, stale reads, deleted files, normalization, images and composition guards.");
