# 推送与发行规则

本文件供后续 agent 执行 PaperNest 的代码推送、Windows 发行构建和 GitHub Releases 发布。规则整理自 v0.1.0、v0.1.1、v0.1.2 的实际操作；历史证据见 [开发与发行记录](development.md)。具体构建行为以 [Windows 构建脚本](../scripts/build-release.ps1)、[发行工作流](../.github/workflows/release.yml) 和 [更新实现](../src-tauri/src/update.rs) 为核对依据。实现变化时同步更新本文件，不照搬历史版本号或提交号。

## 1. 执行范围与目标仓库

| 用户指令 | 应执行的范围 |
| --- | --- |
| 修改代码、测试、撰写文档 | 完成对应本地工作；不据此自行推送或发布。 |
| 推送更新、同步远端仓库 | 检查并提交本次授权的改动，完成相应验证，推送当前工作分支；依本项目近两次发行习惯，以正常快进方式同步 origin/main。用户指定目标分支或要求 PR 时按其要求执行。不自动打发行标签。 |
| 编译、打包 | 生成并核验本地产物；不据此公开发布。 |
| 推送并发布发行版 / Releases | 完成本文件的正式发行流程，包括源码、标签、签名产物、公开发布及下载验证。已有明确授权时连续执行，不在每一步重复询问。 |

目标必须明确核对：

| 用途 | 地址 / 约定 |
| --- | --- |
| 自有仓库 origin | `https://github.com/baihejiangnan/PaperNest.git` |
| 正式 Releases | `https://github.com/baihejiangnan/PaperNest/releases` |
| 默认发布分支 | `main` |
| Windows 发行工作分支 | `codex/windows-release-X.Y.Z`，使用实际待发行版本 |
| 原项目 upstream | `https://github.com/zakee039/MDmeow.git`，仅作来源参考，不作为本项目推送或发行目标 |

所有命令在包含 package.json、src-tauri/ 和 .git 的实际仓库根目录执行。先用 `git rev-parse --show-toplevel` 确认，不能假定聊天工作目录就是仓库根目录。GitHub CLI 命令明确带 `--repo baihejiangnan/PaperNest`，Git 推送明确写 `origin`。

v0.1.0 当时只推送独立发行分支；v0.1.1 和 v0.1.2 已同步 main。本规则沿用后两次的做法。main 受保护或远端出现新提交时先处理实际差异，必要时走仓库要求的 PR 流程；不得强推绕过保护。

## 2. 推送前检查

1. 查看 `git status --short`、当前分支、`git remote -v`、相关 diff 与未跟踪文件。保留已有修改，确认本次授权的范围；避免直接 `git add .` 将配置、测试数据或无关工作一起提交。
2. `git fetch origin --prune` 后检查 origin/main、目标工作分支与 HEAD 的关系。同步 main 前确认 `git merge-base --is-ancestor origin/main HEAD` 成功；若不成功，先整合远端改动并验证，不能覆盖远端提交。
3. 确认没有未解决冲突、临时调试入口或凭据。检查 `.gitignore`；release/、release.__staging/、src-tauri/target/、node_modules/、output/tmp/、output/playwright/ 等产物与临时文件不提交。正式维护的预览资料可按本次改动范围提交，不能把整个 output/ 一概忽略或上传。
4. 检查用户操作说明、架构、设计、开发记录和 TODO 是否需要随代码更新。测试报告区分构建、组件检查、桌面实测和用户确认，不能将历史版本的验证写成新版本已实测。
5. 执行 `git diff --check`，按改动范围完成必要检查。普通文档修改不要求重打发行包；功能发行需执行下一节检查。
6. 使用明确文件列表暂存，检查 `git diff --cached --stat` 与 staged diff 后提交。提交信息描述最终改动，不把失败尝试或临时计划写成已实现行为。

PowerShell 中 `$ErrorActionPreference = 'Stop'` 不保证 Git、pnpm、Cargo、gh 等外部程序失败后自动停止。每个关键命令后检查 `$LASTEXITCODE`，失败即停止依赖它的后续步骤。不得在构建失败后继续提交发行标签或发布。

不使用 `reset --hard`、`clean -fd`、强制推送或删除远端标签来解决常规发布问题。遇到确实超出当前授权、会丢失他人工作的操作，再说明具体冲突并请求必要决定。

## 3. 版本与源码一致性

- 正式版本使用 `X.Y.Z`，标签使用 `vX.Y.Z`，创建附注标签。用户指定版本时按指定值；未指定时沿用最近发行习惯，对当前 PaperNest 正式版本增加补丁号，并在执行更新时说明所选版本。
- 仓库继承了原项目 v1.x 标签。不能用“最大的 Git 标签”决定 PaperNest 下一版。结合 origin 的正式 Releases、最近 PaperNest 标签和应用版本字段判断；三者不一致时先查明原因。
- 四处版本必须一致：package.json、src-tauri/tauri.conf.json、src-tauri/Cargo.toml，以及 src-tauri/Cargo.lock 中 `name = "papernest"` 对应的 version。不得全局替换 Cargo.lock 中依赖库的相同版本号。
- 保持产品名、应用标识、现有更新公钥及自有仓库更新地址。常规发行不生成新签名密钥，不改变客户端信任的公钥。
- 在发行分支提交最终源码和版本字段，再从该提交构建。构建后检查 tracked diff；若脚本生成了需要提交的源码或配置，先审查并提交，再重新构建。产物必须对应最终标签所指源码，不能用旧 target/debug 程序或其他版本安装包替代。
- 已发布的正式标签和同名资产保持不变。需要修复代码或二进制时发布新版本；不得移动已发布标签或用 `--clobber` 偷换文件。发布后的证据可另做文档提交，同步 main 和发行分支，原发行标签不移动。

## 4. Windows 检查与签名构建

当前正式发行范围为 Windows x64：便携 EXE 和 MSI。Linux/macOS 仍暂定，现有脚本不代表已经完成对应系统实测。工具链要求见 [环境与命令](development.md#环境与命令)。

正式构建前至少运行以下检查，每条均检查退出码：

```powershell
pnpm test:code-text
pnpm test:tab-path
cargo test --manifest-path src-tauri/Cargo.toml --locked --lib
pnpm release:windows
```

`pnpm release:windows` 已包含前端类型检查和构建，无须无理由重复运行。除上述检查外，完成本次功能必要的回归；Rust 默认跳过的集成测试要如实记录，不能写成全部通过。明确的平台暂定项可保留在 TODO；影响本次发行可用性或验签的失败必须解决后再发布。

环境处理沿用以下约定：

- 新环境按 `pnpm install --frozen-lockfile` 安装；不借发布之机升级依赖或重写锁文件。
- 若已有可用锁定依赖，但新版 pnpm 的运行前检查试图自动重装 node_modules，可针对当前命令暂时设置 `$env:pnpm_config_verify_deps_before_run = 'false'`。完成后恢复此前值，不修改全局配置，不用这一开关掩盖缺失或不匹配的依赖。
- 受限环境测试无法写系统临时目录时，将当前测试进程的 TMP/TEMP 指向仓库 output/tmp/ 下专用目录，完成后恢复环境；不修改目录权限或清空用户临时目录。
- 构建脚本默认将 Cargo 并行任务数设为 1，避免 Windows release LTO 的内存压力。不要为追求速度绕过已经存在的签名与 MSI 检查。

签名构建统一使用 `pnpm release:windows`，不能把 `pnpm build` 或普通 `pnpm tauri build` 的成功当作完整发行成功。脚本依次完成：

1. 检查版本及冲突，构建前端和 Tauri MSI，提取便携 EXE。
2. 检查 MSI 文件关联的实际自定义动作与执行顺序。
3. 使用 `TAURI_SIGNING_PRIVATE_KEY` 环境凭据，或本机用户目录 `.tauri/papernest-updater.key`，为 EXE 和 MSI 签名。环境密钥可配合 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；本机文件分支目前按空密码调用，不能假定支持任意加密文件。
4. 通过应用内嵌的 src-tauri/updater.pub 和实际 Rust 验证器，分别检查原文件验签通过、修改字节后验签失败。
5. 生成 latest.json 和 SHA256SUMS.txt，验证完整集合后才复制到 release/。

私钥、密码及其内容不得提交、打印、写入报告或作为资产上传。缺少原密钥时不能生成新密钥冒充兼容更新；可以继续完成源码推送及其他独立工作，但必须明确签名发行尚未完成。

当前产物具有应用更新签名，没有 Windows Authenticode 证书签名；两者不能混称。

## 5. 六个必需发行文件

设应用版本为 `X.Y.Z`，GitHub Release 必须包含以下六项：

| 文件 | 用途 |
| --- | --- |
| `PaperNest-X.Y.Z.exe` | Windows x64 便携程序 |
| `PaperNest-X.Y.Z.exe.sig` | 便携程序更新签名 |
| `PaperNest_X.Y.Z_x64.msi` | Windows x64 安装包 |
| `PaperNest_X.Y.Z_x64.msi.sig` | 安装包更新签名 |
| `latest.json` | 版本、windows-x86_64 MSI 下载 URL 与对应签名 |
| `SHA256SUMS.txt` | 前五项文件的 SHA-256，不包含自身 |

应用检查更新读取 `https://api.github.com/repos/baihejiangnan/PaperNest/releases/latest`，按便携／安装模式寻找上表精确文件名及对应 `.sig`，下载后用内嵌公钥验证。latest.json 也必须发布并保持一致，但当前应用不是仅靠该文件判断更新；只更新 JSON 而漏发 EXE/MSI 或签名会破坏更新能力。

latest.json 的 version 为 `X.Y.Z`，windows-x86_64 的 URL 必须指向 `https://github.com/baihejiangnan/PaperNest/releases/download/vX.Y.Z/PaperNest_X.Y.Z_x64.msi`，signature 与 MSI 的 `.sig` 文本一致。SHA256SUMS.txt 使用脚本生成的 UTF-8 无 BOM、LF 格式，每个条目均需实际重新计算核对。

本地 release/ 会保留旧版本带版本号的文件，而 latest.json 与 SHA256SUMS.txt 会更新。上传时只能使用本次版本的明确六文件列表，不能直接 `release/*`。GitHub 自动附带的 Source code 压缩包不计入这六项资产。

## 6. 推送源码和标签

正式发行使用或创建 `codex/windows-release-X.Y.Z`。已有合适分支就复用，不为同一次重试制造多个分支或重复提交。不要切换分支时丢弃工作区修改。

完成构建验证后，记录 `git rev-parse HEAD` 作为发行源码提交。先检查本地和 origin 是否已有同名标签：不存在才创建；存在时读取指向并确认是否属于当前任务，不能盲目重建。

以下为 PowerShell 命令示例，实际执行时替换版本，检查每条命令退出码，并先满足前文检查：

```powershell
$releaseVersion = 'X.Y.Z' # 替换为本次已确定的版本
$releaseTag = "v$releaseVersion"
$releaseBranch = "codex/windows-release-$releaseVersion"

git tag -a $releaseTag -m "PaperNest $releaseTag"
git push --atomic origin "HEAD:refs/heads/$releaseBranch" 'HEAD:refs/heads/main' "refs/tags/$releaseTag"
git branch --set-upstream-to="origin/$releaseBranch"
```

推送前必须已确认 origin/main 是 HEAD 的祖先，且远端目标分支不会被非快进覆盖。普通代码推送使用相同分支/main 策略但不创建或推送发行标签。明确推送本次标签，不能 `git push --tags` 把原项目标签一并推送。

推送后用 `git ls-remote origin` 核对 main、发行分支与标签；附注标签需检查其解引用后的提交。不要只依据本地分支名或一条“push 成功”日志判断远端内容。

## 7. 本地发行与云端工作流选择

v0.1.0～v0.1.2 的正式发行均使用本地签名构建。v0.1.2 发布时仓库尚未配置 `TAURI_SIGNING_PRIVATE_KEY`，标签触发的 CI 在密钥检查处停止；该次已通过本地上传和公开下载核验完成发行。这是历史状态，后续执行需重新检查，不能一直假定 CI 不可用。

每次发行先用 `gh secret list --repo baihejiangnan/PaperNest` 查看密钥名称，不读取或展示密钥值，并确认现有工作流配置：

- 未配置云端签名密钥、且本地具有匹配密钥：沿用本地构建及下一节的草稿发布。推送标签仍会触发 CI，检查并如实记录其停止位置；不能把缺密钥的 CI 标为通过。
- 已配置云端签名密钥：选择 CI 作为唯一资产发布者，完成本地必要验证后推送标签，观察 workflow 构建、验签和完整资产检查，直到公开发行与下载核验完成。本地与 CI 不同时向同一 Release 上传文件。
- CI 失败时先诊断原因，不能默认是缺密钥。仅在确认没有仍在运行的发布任务、没有已公开资产会被覆盖后，才继续已授权的本地发布。需要改源码或工作流时使用新版本，不移动已推送的发行标签。

当前工作流通过 `v*` 标签或 workflow_dispatch 触发，会直接发布正式版，并配置 `overwrite_files: true`。因此不得对已公开版本随意重新运行工作流或手动 dispatch，以免覆盖已发布资产。需要修改签名凭据或轮换密钥时，按用户明确要求单独处理；常规发布不擅自上传本机私钥到 GitHub Secrets。

## 8. 本地上传：先草稿核对，再正式发布

发行说明面向使用者，包含本次功能／修复、便携 EXE 与 MSI 的选择、必要限制。描述最终实现与验证范围，不宣称未测试的平台或安装行为。用 UTF-8 Markdown 文件配合 `--notes-file`，避免多行说明在命令中转义错误。

```powershell
$releaseVersion = 'X.Y.Z' # 替换为本次版本
$releaseTag = "v$releaseVersion"
$releaseAssets = @(
  "release/PaperNest-$releaseVersion.exe",
  "release/PaperNest-$releaseVersion.exe.sig",
  "release/PaperNest_$($releaseVersion)_x64.msi",
  "release/PaperNest_$($releaseVersion)_x64.msi.sig",
  'release/latest.json',
  'release/SHA256SUMS.txt'
)
# 事先创建说明文件，确认远端标签已存在，且没有同名发行。
gh release create $releaseTag @releaseAssets --repo baihejiangnan/PaperNest --verify-tag --draft --title "PaperNest $releaseTag" --notes-file "output/tmp/release-notes-$releaseVersion.md"
# 完成下述草稿检查后，才执行：
gh release edit $releaseTag --repo baihejiangnan/PaperNest --draft=false --prerelease=false --latest
```

重试前先 `gh release view` 或查询认证后的 Releases 列表，复用已有草稿；不要收到超时就重复创建。草稿可能无法从 `/releases/tags/{tag}` 取得，出现 404 时查看 Releases 列表和草稿 ID，不能据此断言不存在。

正式公开之前，使用 `gh api repos/baihejiangnan/PaperNest/releases/{release_id}` 核对草稿：

- tag_name 是本次标签、目标源码正确，说明和正式版属性正确。
- 六项资产名称恰好匹配，state 均为 uploaded；没有旧版本、日志、调试包或凭据。
- 每项 size 与本地一致，每项 GitHub digest（`sha256:...`）与本地 `Get-FileHash -Algorithm SHA256` 一致。digest 若不可用，不记为通过，应通过认证下载实际文件重新计算哈希。
- latest.json 与校验和已按第 5 节验证，两个程序均已通过内嵌公钥验签和篡改拒绝检查。

未通过核对时保留草稿处理具体问题，不公开不完整版本。草稿修订文件后重新核对全部六项。

## 9. 发布后的公开验证与收尾

以下各项全部完成，才能报告“正式发行完成”：

1. Release 为公开、非草稿、非预发布，并标记为 latest。匿名访问 `https://api.github.com/repos/baihejiangnan/PaperNest/releases/latest`，确认 tag_name 是本次版本。
2. 以未带 GitHub 认证信息的普通 HTTP 请求，下载全部六个公开资产到 output/tmp/ 下独立核验目录。逐项对比本地构建文件的 SHA-256 和大小；只查看 GitHub 资产列表不足以替代下载核验。
3. 匿名下载 `https://github.com/baihejiangnan/PaperNest/releases/latest/download/latest.json`，确认内容、版本、MSI URL 与签名匹配；并确认其中 MSI 入口可下载且哈希正确。PowerShell 可能把 application/octet-stream 响应当字节数组，应先保存文件再 `Get-Content -Raw | ConvertFrom-Json`，不要把解析方式错误误判为发行内容损坏。
4. 核对标签解引用后的源码提交与本次构建一致，main 和发行分支包含该提交。更新 [开发记录](development.md) 与 [TODO](../TODO.md)，写明 Release 链接、源码提交、测试范围、哈希、公开下载／更新入口结果和 CI 实际状态。新的验证记录可做文档提交，再正常推送 main 和发行分支；不重新构建或移动原标签。
5. 最后检查工作区与远端引用，说明剩余改动的归属。给用户简洁返回版本、Release 链接、推送目标、产物与验证结果；存在 CI 未配置或实际未验证的范围时如实说明，不把本地签名发行写成 CI 自动构建成功。

网络失败、CDN 暂未同步或 GitHub 限流时保留已完成的结果，按具体错误重试并说明尚未核验的部分。不能通过关闭 TLS 校验、跳过签名、仅凭上传成功就结束发行。

## 10. 交接给下一位 agent

接手推送时，先读 AGENTS.md、本文件、当前 diff、TODO 和最近开发记录。确认用户这次授权的是源码推送、打包还是正式发行，再从尚未完成的步骤继续。

任务跨会话时记录当前分支与 HEAD、版本／标签、构建和测试结果、产物所在目录与哈希、Release 草稿或公开链接、CI 状态及剩余步骤。不要在交接材料中包含私钥或密码。已有可靠验证且源码未变时不无理由重做；缺少证据的步骤不得猜测为完成。
