# 推送与发行规则

供接手 agent 执行 PaperNest 的源码推送与 Windows x64 发行。先读 [AGENTS](../AGENTS.md)、当前 diff、[TODO](../TODO.md) 和最近[开发记录](development.md)，再按本次授权执行。详细验收与排障见 [发行验证与故障处理](development.md#发行验证与故障处理)；构建行为以[脚本](../scripts/build-release.ps1)和[工作流](../.github/workflows/release.yml)为准。

## 1. 确认范围与目标

| 用户指令 | 执行范围 |
| --- | --- |
| 修改代码／文档 | 完成本地工作，不自行推送或发布。 |
| 推送更新 | 检查、提交、推送当前工作分支，并正常快进同步 origin/main；不打发行标签。 |
| 编译／打包 | 核验本地产物，不公开发布。 |
| 发布新版本 | 完成以下全部六步，包含源码、标签、签名资产与公开核验。已有明确授权时连续执行，不逐步重复确认。 |

用户指定分支或要求 PR 时按其要求执行；分支保护要求 PR 时走 PR 流程。仅推送源码执行第 2、4 步及第 6 步的文档／交接收尾。

- 实际根目录以 `git rev-parse --show-toplevel` 为准，应包含 package.json、src-tauri/ 和 .git。
- origin：`https://github.com/baihejiangnan/PaperNest.git`；默认分支：`main`；发行分支：`codex/windows-release-X.Y.Z`。upstream 原项目仅作参考。
- Git 推送明确使用 origin；gh 命令带 `--repo baihejiangnan/PaperNest`。
- 保留已有改动；不使用强推、`reset --hard`、`clean -fd` 或删除标签解决常规问题。私钥／密码不进入源码、日志或发行资产，不擅自轮换更新公钥或上传私钥到 Secrets。
- PowerShell 每条关键外部命令检查 `$LASTEXITCODE`，失败即停止依赖步骤；`$ErrorActionPreference = 'Stop'` 不足以保证外部命令失败时停止。

## 2. 检查并提交源码

1. 查看 status、分支、remote、diff 与未跟踪文件，纳入本次授权的源码；无关格式改动、来源不明文件不提交也不删除。明确列出暂存文件，不直接 `git add .`／`git add -A`。未提交修复须随工作区交接，仅克隆远端不会获得它。
2. `git fetch origin --prune` 后检查目标分支；`git merge-base --is-ancestor origin/main HEAD` 必须成功，目标工作分支也不得被非快进覆盖。否则先整合并验证。
3. 正式发行复用或创建发行分支，确认版本为 `X.Y.Z`、标签为 `vX.Y.Z`。用户未指定时，对 origin 最近 PaperNest 正式发行增加补丁号并说明；不能按继承的原项目 v1.x 标签选择版本。
4. 四处应用版本一致：package.json、src-tauri/tauri.conf.json、Cargo.toml、Cargo.lock 中 `papernest` 的 version；不全局替换依赖版本。保持产品名、应用标识、更新地址与公钥。
5. 更新受影响的 README、架构、开发记录和 TODO；检查无冲突、调试入口或凭据。release/、release.__staging/、target/、node_modules/ 和 output/tmp/ 等产物不提交，正式预览资料按实际范围判断。
6. `git diff --check` 后验证并提交，检查 staged diff。只改文档无需构建；改代码／脚本／工作流须前端构建、全部 `test:*` 和 Rust 锁定依赖测试通过。发行构建已包含前端构建，无须重复：

```powershell
pnpm run '/^test:/'
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
# 源码推送／CI 发行路径另运行 pnpm build；本地发行构建已包含它。
```

## 3. 选择发布者并构建

推送发行标签前，用 `gh secret list --repo baihejiangnan/PaperNest` 只核对密钥名称，选择唯一资产发布者：

| 条件 | 路径 |
| --- | --- |
| 无云端签名密钥，本地有匹配密钥 | 从已提交源码本地签名构建，执行第 5 步草稿发布；如实记录标签触发的 CI 停止状态。 |
| 有云端签名密钥 | 完成本地必要验证，推送标签后由 CI 构建、验签及发布；本地不同时上传。 |
| CI 失败 | 先诊断；确认没有仍在发布的任务和会被覆盖的公开资产，才继续已授权的本地发布。缺少匹配密钥时签名发行不能完成。 |

所有发行路径先设置下列变量，版本须已按第 2 步确定；最后一行仅用于本地签名构建，说明文件先准备好：

```powershell
$releaseVersion = 'X.Y.Z'
$releaseTag = "v$releaseVersion"
$releaseBranch = "codex/windows-release-$releaseVersion"
pnpm release:windows -NotesFile "output/tmp/release-notes-$releaseVersion.md"
```

等待进程结束，核对退出码和 `Result: PASS`。脚本检查 MSI 关联动作，使用内嵌公钥验证 EXE／MSI 签名及篡改拒绝，并生成元数据和校验和。普通 tauri build 成功不等于签名发行通过；当前没有 Windows Authenticode 证书签名。

产物必须对应已提交的最终源码。构建后若出现需提交的 tracked 改动，审查、提交后重新构建。记录源码提交与资产哈希，不能使用旧 debug 程序、测试包或其他版本产物。

本次明确六文件集合如下；本地可能保留旧版本文件，禁止用 `release/*` 上传：

| 文件 | 要求 |
| --- | --- |
| `PaperNest-X.Y.Z.exe`、其 `.sig` | 便携程序与自身签名。 |
| `PaperNest_X.Y.Z_x64.msi`、其 `.sig` | 安装包与自身签名。 |
| `latest.json` | 两个平台入口、各自签名与实际 size、版本、UTC pub_date；notes 可为空，有说明时与 Release 一致。 |
| `SHA256SUMS.txt` | 前五项的 SHA-256；UTF-8 无 BOM、LF，不包含自身。 |

元数据版本为 X.Y.Z；`windows-x86_64` 对应 MSI，`windows-x86_64-portable` 对应 EXE，URL 均为 `https://github.com/baihejiangnan/PaperNest/releases/download/vX.Y.Z/<对应文件名>`。签名与对应 .sig 一致，size 与程序字节数一致；使用脚本生成，不手工改写。

涉及更新／安装／会话的改动，按[更新安装与恢复验收](development.md#更新安装与恢复验收)验证自动启动、唯一主实例、文件／标签及源版本支持的阅读位置恢复、取消和失败处理。逻辑／模拟测试不能替代真实 MSI 升级；未验证项写入 TODO 和说明，实际可用性或验签失败须解决后发布。

## 4. 推送源码与标签

本地构建验证完成后，或 CI 路径完成必要本地验证后，记录 HEAD。发行时先核对本地／远端同名标签和 Release：不存在才创建附注标签；存在则核实所属任务与指向，不盲目重建。已公开标签和资产不移动、不覆盖；修复使用新版本。

仅推送源码时使用当前授权分支，不创建或推送标签：

```powershell
$pushBranch = (git branch --show-current).Trim()
git push --atomic origin "HEAD:refs/heads/$pushBranch" 'HEAD:refs/heads/main'
```

正式发行在第 3 步变量基础上执行：

```powershell
git tag -a $releaseTag -m "PaperNest $releaseTag"
git push --atomic origin "HEAD:refs/heads/$releaseBranch" 'HEAD:refs/heads/main' "refs/tags/$releaseTag"
git branch --set-upstream-to="origin/$releaseBranch"
```

仅推送本次标签，不用 `git push --tags`。通过 `git ls-remote origin` 核对 main、工作分支和标签解引用提交，不能只看 push 日志。后续证据可另做文档提交同步分支，原发行标签不移动。

## 5. 发布完整资产

**本地路径**先创建草稿，复用本次已有草稿；超时后先核对，不重复创建。发行说明面向使用者，写明便携／安装包选择和验证限制：

```powershell
$releaseAssets = @(
  "release/PaperNest-$releaseVersion.exe",
  "release/PaperNest-$releaseVersion.exe.sig",
  "release/PaperNest_$($releaseVersion)_x64.msi",
  "release/PaperNest_$($releaseVersion)_x64.msi.sig",
  'release/latest.json', 'release/SHA256SUMS.txt'
)
gh release create $releaseTag @releaseAssets --repo baihejiangnan/PaperNest --verify-tag --draft --title "PaperNest $releaseTag" --notes-file "output/tmp/release-notes-$releaseVersion.md"
# 草稿核验通过后才公开：
gh release edit $releaseTag --repo baihejiangnan/PaperNest --draft=false --prerelease=false --latest
```

公开前核对：标签／源码／说明正确；恰好六项资产且 state 为 uploaded；逐项 size 和 GitHub digest 与本地一致（无 digest 时认证下载计算哈希）；元数据和签名通过第 3 步要求。不完整时保留草稿处理，修订后重新核对。

**CI 路径**观察工作流直到发布完成，执行相同资产核验及第 6 步。当前工作流直接公开并允许覆盖文件，禁止对已公开版本重新运行或随意 dispatch；CI 不会自动完成下一步公开下载和客户端验收。

## 6. 公开核验与收尾

以下发行核验全部通过，才能报告“正式发行完成”：

1. Release 公开、非草稿、非预发布且为 latest；通过认证管理 API 核对目标版本，再匿名核验 `https://github.com/baihejiangnan/PaperNest/releases/latest/download/latest.json`。
2. 匿名下载全部六资产至独立核验目录，逐项大小与 SHA-256 和本次构建产物一致，并实际验证 SHA256SUMS.txt；CI 路径使用本次工作流产物对照，不能拿独立重建的包比对。GitHub 列表或上传成功不能替代下载核验。
3. 元数据两个平台键都符合第 3 步契约；分别从其中 URL 下载 MSI／EXE，核对大小、哈希和各自签名。按[公开更新入口验证](development.md#公开更新入口验证)运行真实客户端联网测试，输出须为本次版本的 installed 和 portable 两项 PASS，不能接受旧 latest 的通过结果。
4. 核对标签解引用提交等于构建源码，main 和发行分支包含该提交；更新开发记录／TODO，记录 Release 链接、源码与版本、资产哈希、测试和公开核验结果、CI 状态及实际未验证范围。
5. 检查工作区和远端引用，向用户报告版本、链接、推送目标与剩余事项；跨 agent 交接另记录分支／HEAD、未提交文件、产物／草稿和已完成步骤，避免漏掉本地修复或重复运行。

另在保留的较低版本安装／便携客户端按开发说明验证“检查更新 → 下载验签 → 使用新版 → 自动启动／会话恢复”。缺少客户端或隔离环境时明确记为待验证，不能把联网测试写成完整安装链路通过。网络／CDN／限流故障按具体错误重试，不关闭 TLS 或跳过签名；历史验证和当前测试分别记录，可靠证据且源码未变时不无理由重做。
