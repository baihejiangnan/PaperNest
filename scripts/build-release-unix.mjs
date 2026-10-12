import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

// Candidate packages only: native builds, no tag creation or public upload.
export function releasePlan(requested, platform, arch, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid application version: ${version}`);
  if (requested === "linux") {
    if (platform !== "linux") throw new Error(`Linux release builds must run on Linux (current platform: ${platform}).`);
    const targetArch = { x64: "x86_64", arm64: "aarch64" }[arch];
    if (!targetArch) throw new Error(`Unsupported Linux architecture: ${arch}`);
    const prefix = `PaperNest-${version}-linux-${targetArch}`;
    return {
      platform: "linux", arch: targetArch, directory: `linux-${targetArch}`, target: null,
      bundles: "appimage,deb,rpm", signing: "none",
      artifacts: [["appimage", ".AppImage"], ["deb", ".deb"], ["rpm", ".rpm"]]
        .map(([folder, suffix]) => ({ folder, suffix, name: `${prefix}${suffix}` })),
    };
  }
  if (requested === "macos") {
    if (platform !== "darwin") throw new Error(`macOS release builds must run on macOS (current platform: ${platform}).`);
    if (!["x64", "arm64"].includes(arch)) throw new Error(`Unsupported macOS architecture: ${arch}`);
    return {
      platform: "macos", arch: "universal", directory: "macos-universal",
      target: "universal-apple-darwin", bundles: "dmg", signing: "ad-hoc",
      artifacts: [{ folder: "dmg", suffix: ".dmg", name: `PaperNest-${version}-macOS-universal.dmg` }],
    };
  }
  throw new Error("Usage: node scripts/build-release-unix.mjs <linux|macos>");
}

export function checkedVersion(root) {
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const tauriVersion = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")).version;
  const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  const lock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");
  const cargoVersion = cargo.split(/^\[/m).find((section) => section.startsWith("package]"))
    ?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const lockVersion = lock.split(/^\[\[package\]\]/m)
    .find((block) => /^name\s*=\s*"papernest"\s*$/m.test(block))
    ?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (![tauriVersion, cargoVersion, lockVersion].every((value) => value === version)) {
    throw new Error(`Application version mismatch: package=${version}, tauri=${tauriVersion}, cargo=${cargoVersion}, lock=${lockVersion}`);
  }
  return version;
}

function run(command, args, options) {
  console.log(`[candidate] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { ...options, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status ?? result.signal}`);
}

function sourceInfo(root) {
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
    if (result.error || result.status !== 0) throw new Error("Cannot record Git source state for candidate build.");
    return result.stdout.trim();
  };
  return { commit: git(["rev-parse", "HEAD"]), dirty: git(["status", "--porcelain"]) !== "" };
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = lstatSync(path);
    // Do not follow application bundle symlinks or directory loops.
    return stat.isDirectory() ? filesUnder(path) : stat.isFile() ? [path] : [];
  });
}

function removeInside(parent, path) {
  const child = relative(resolve(parent), resolve(path));
  if (!child || child === ".." || child.startsWith("../") || child.startsWith("..\\") || isAbsolute(child)) {
    throw new Error(`Refusing to remove a path outside ${parent}`);
  }
  rmSync(path, { recursive: true, force: true });
}

export function buildRelease({
  root = resolve(import.meta.dirname, ".."), requested,
  platform = process.platform, arch = process.arch, env = process.env,
  execute = run, getSourceInfo = sourceInfo, now = () => new Date(),
}) {
  root = resolve(root);
  // All validation precedes filesystem mutations, including output cleanup.
  const version = checkedVersion(root);
  const plan = releasePlan(requested, platform, arch, version);
  const source = getSourceInfo(root);
  const targetDir = join(root, "src-tauri", "target");
  const bundleRoot = plan.target
    ? join(targetDir, plan.target, "release", "bundle") : join(targetDir, "release", "bundle");
  const outputRoot = join(root, "release-unix");
  const destination = join(outputRoot, plan.directory);
  const staging = `${destination}.__staging`;
  const backup = `${destination}.__previous`;
  if (existsSync(backup)) throw new Error(`Previous interrupted build needs recovery: ${backup}`);
  const buildEnv = { ...env, CARGO_TARGET_DIR: targetDir };
  if (plan.platform === "macos") {
    // This entry point intentionally produces ad-hoc test candidates. Developer
    // ID signing / notarization require a separate, explicitly configured run.
    for (const key of ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID", "APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH"]) delete buildEnv[key];
    buildEnv.APPLE_SIGNING_IDENTITY = "-";
  }
  removeInside(targetDir, bundleRoot);
  const args = [join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"), "build", "--ci", "--bundles", plan.bundles];
  if (plan.target) args.push("--target", plan.target);
  args.push("--", "--locked");
  execute(process.execPath, args, { cwd: root, env: buildEnv });
  const artifacts = plan.artifacts.map((artifact) => {
    const matches = filesUnder(join(bundleRoot, artifact.folder)).filter((path) => path.endsWith(artifact.suffix));
    if (matches.length !== 1) throw new Error(`Expected exactly one ${artifact.suffix} artifact; found: ${matches.map((path) => basename(path)).join(", ") || "<none>"}`);
    return { ...artifact, source: matches[0] };
  });
  mkdirSync(outputRoot, { recursive: true });
  removeInside(outputRoot, staging);
  mkdirSync(staging);
  try {
    const files = artifacts.map((artifact) => {
      const path = join(staging, artifact.name);
      copyFileSync(artifact.source, path);
      const data = readFileSync(path);
      return { name: artifact.name, size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
    });
    writeFileSync(join(staging, "build-info.json"), `${JSON.stringify({
      version, kind: "candidate", platform: plan.platform, arch: plan.arch,
      signing: plan.signing, notarized: false, built_at: now().toISOString(), source, files,
    }, null, 2)}\n`, "utf8");
    const checksummed = [...files, {
      name: "build-info.json",
      sha256: createHash("sha256").update(readFileSync(join(staging, "build-info.json"))).digest("hex"),
    }];
    writeFileSync(join(staging, "SHA256SUMS.txt"), checksummed.map((file) => `${file.sha256}  ${file.name}\n`).join(""), "utf8");
    if (existsSync(destination)) renameSync(destination, backup);
    try { renameSync(staging, destination); }
    catch (error) {
      if (existsSync(backup)) renameSync(backup, destination);
      throw error;
    }
    removeInside(outputRoot, backup);
    console.log(`[candidate] ${destination} (${plan.signing}; not notarized)`);
    return destination;
  } finally {
    removeInside(outputRoot, staging);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { buildRelease({ requested: process.argv[2] }); }
  catch (error) { console.error(`[candidate] ${error.message}`); process.exitCode = 1; }
}
