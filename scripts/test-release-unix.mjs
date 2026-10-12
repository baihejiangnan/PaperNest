import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildRelease, checkedVersion, releasePlan } from "./build-release-unix.mjs";

const version = "0.2.4";
const hash = (data) => createHash("sha256").update(data).digest("hex");
function write(path, data) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, data);
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "papernest-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(join(root, "package.json"), JSON.stringify({ version }));
  write(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version }));
  write(join(root, "src-tauri/Cargo.toml"), `[package]\nname = "papernest"\nversion = "${version}"\n\n[dependencies]\nother = "7"\n`);
  write(join(root, "src-tauri/Cargo.lock"), `[[package]]\nname = "other"\nversion = "7"\n\n[[package]]\nname = "papernest"\nversion = "${version}"\n`);
  write(join(root, "release/Windows.exe"), "published Windows package");
  return root;
}
function options(root, requested = "linux") {
  return {
    root, requested, platform: requested === "linux" ? "linux" : "darwin", arch: "x64", env: {},
    getSourceInfo: () => ({ commit: "a".repeat(40), dirty: true }),
    now: () => new Date("2026-10-11T00:00:00Z"),
  };
}
function bundleRoot(root, plan) {
  return join(root, "src-tauri/target", ...(plan.target ? [plan.target] : []), "release/bundle");
}
function fakeBuild(root, plan, inspect = () => {}) {
  return (command, args, settings) => {
    assert.equal(command, process.execPath);
    assert.deepEqual(args.slice(-2), ["--", "--locked"]);
    assert.equal(settings.env.CARGO_TARGET_DIR, join(root, "src-tauri/target"));
    assert.equal(existsSync(join(bundleRoot(root, plan), "stale.AppImage")), false);
    inspect(args, settings.env);
    for (const artifact of plan.artifacts) write(join(bundleRoot(root, plan), artifact.folder, `native${artifact.suffix}`), `binary-${artifact.suffix}`);
  };
}

test("native platform and architecture validation rejects unsupported builds", () => {
  assert.throws(() => releasePlan("linux", "win32", "x64", version), /must run on Linux/);
  assert.throws(() => releasePlan("macos", "linux", "x64", version), /must run on macOS/);
  assert.throws(() => releasePlan("linux", "linux", "ia32", version), /Unsupported/);
  assert.throws(() => releasePlan("invalid", "linux", "x64", version), /Usage/);
  assert.throws(() => releasePlan("linux", "linux", "x64", "../escape"), /Invalid/);
  assert.equal(releasePlan("linux", "linux", "arm64", version).directory, "linux-aarch64");
  assert.equal(releasePlan("macos", "darwin", "arm64", version).target, "universal-apple-darwin");
});

test("wrong host and mismatched versions leave existing outputs untouched", (t) => {
  const root = fixture(t);
  const old = join(root, "release-unix/linux-x86_64/previous.deb");
  write(old, "previous");
  const execute = () => assert.fail("must not build");
  assert.throws(() => buildRelease({ ...options(root), platform: "win32", execute }), /must run on Linux/);
  write(join(root, "src-tauri/Cargo.toml"), '[package]\nversion = "0.2.3"\n');
  assert.throws(() => buildRelease({ ...options(root), execute }), /version mismatch/);
  assert.equal(readFileSync(old, "utf8"), "previous");
  assert.equal(readFileSync(join(root, "release/Windows.exe"), "utf8"), "published Windows package");
});

for (const requested of ["linux", "macos"]) {
  test(`${requested} candidates have exact assets, provenance and valid LF checksums`, (t) => {
    const root = fixture(t);
    assert.equal(checkedVersion(root), version);
    const plan = releasePlan(requested, options(root, requested).platform, "x64", version);
    write(join(bundleRoot(root, plan), "stale.AppImage"), "stale");
    write(join(root, "release-unix", plan.directory, "obsolete"), "old");
    const env = { APPLE_SIGNING_IDENTITY: "Developer ID test", APPLE_PASSWORD: "not-a-secret-test-value" };
    const destination = buildRelease({ ...options(root, requested), env, execute: fakeBuild(root, plan, (args, buildEnv) => {
      assert.equal(args.includes("--no-sign"), false);
      if (requested === "macos") {
        assert.equal(buildEnv.APPLE_SIGNING_IDENTITY, "-");
        assert.equal(buildEnv.APPLE_PASSWORD, undefined);
        assert.equal(args[args.indexOf("--target") + 1], "universal-apple-darwin");
      }
    }) });
    assert.equal(env.APPLE_PASSWORD, "not-a-secret-test-value");
    assert.deepEqual(readdirSync(destination).sort(), [...plan.artifacts.map((file) => file.name), "build-info.json", "SHA256SUMS.txt"].sort());
    const manifest = JSON.parse(readFileSync(join(destination, "build-info.json"), "utf8"));
    assert.equal(manifest.version, version);
    assert.equal(manifest.kind, "candidate");
    assert.equal(manifest.source.dirty, true);
    assert.equal(manifest.signing, plan.signing);
    for (const file of manifest.files) {
      const data = readFileSync(join(destination, file.name));
      assert.equal(file.size, data.length);
      assert.equal(file.sha256, hash(data));
    }
    const sums = readFileSync(join(destination, "SHA256SUMS.txt"), "utf8");
    assert.equal(sums.includes("\r"), false);
    assert.equal(sums.charCodeAt(0) === 0xfeff, false);
    for (const line of sums.trimEnd().split("\n")) {
      const [sha256, name] = line.split("  ");
      assert.equal(sha256, hash(readFileSync(join(destination, name))));
    }
    assert.equal(existsSync(`${destination}.__staging`), false);
    assert.equal(existsSync(`${destination}.__previous`), false);
    assert.equal(readFileSync(join(root, "release/Windows.exe"), "utf8"), "published Windows package");
  });
}

test("build failure preserves the previous candidate", (t) => {
  const root = fixture(t);
  const previous = join(root, "release-unix/linux-x86_64/previous.deb");
  write(previous, "previous");
  assert.throws(() => buildRelease({ ...options(root), execute: () => { throw new Error("native build failed"); } }), /native build failed/);
  assert.equal(readFileSync(previous, "utf8"), "previous");
});

test("staging failure preserves the previous candidate and cleans partial output", (t) => {
  const root = fixture(t);
  const plan = releasePlan("linux", "linux", "x64", version);
  const destination = join(root, "release-unix/linux-x86_64");
  write(join(destination, "previous.deb"), "previous");
  assert.throws(() => buildRelease({
    ...options(root), execute: fakeBuild(root, plan), now: () => { throw new Error("metadata failed"); },
  }), /metadata failed/);
  assert.equal(readFileSync(join(destination, "previous.deb"), "utf8"), "previous");
  assert.equal(existsSync(`${destination}.__staging`), false);
});

for (const duplicate of [false, true]) {
  test(`${duplicate ? "ambiguous" : "missing"} packages cannot replace the previous candidate`, (t) => {
    const root = fixture(t);
    const plan = releasePlan("linux", "linux", "x64", version);
    const previous = join(root, "release-unix/linux-x86_64/previous.deb");
    write(previous, "previous");
    const execute = duplicate ? (command, args, settings) => {
      fakeBuild(root, plan)(command, args, settings);
      write(join(bundleRoot(root, plan), "deb", "extra.deb"), "duplicate");
    } : () => {};
    assert.throws(() => buildRelease({ ...options(root), execute }), /Expected exactly one/);
    assert.equal(readFileSync(previous, "utf8"), "previous");
  });
}

test("an interrupted output swap requires recovery instead of deleting the backup", (t) => {
  const root = fixture(t);
  const backup = join(root, "release-unix/linux-x86_64.__previous/previous.deb");
  write(backup, "recoverable");
  assert.throws(() => buildRelease({ ...options(root), execute: () => assert.fail("must not build") }), /needs recovery/);
  assert.equal(readFileSync(backup, "utf8"), "recoverable");
});
