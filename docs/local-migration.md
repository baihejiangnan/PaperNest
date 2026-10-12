# 本地独立仓库迁移记录

日期：2026-10-12。首次阶段只建立本地副本并验证开发版；随后用户授权建立公开仓库和发布，见文末后续范围。

## 来源与历史

- 来源为 PaperNest 当前工作区：基础提交 `6cd4a6a448f70529d58fe09135c401d361bee522`，包含迁移时 32 个已修改文件和 4 个新增源码／工作流文件。
- 使用 Git 文件清单复制 171 个版本控制范围内的文件，复制后逐一校验 SHA-256。未复制 `.git`、依赖、旧构建产物、便携配置、私钥或本机环境文件。
- 新仓库从自己的首次提交开始，默认分支 `main`；提交作者为 baihejiangnan，不继承原作者提交、共同作者尾注、分支或标签。后续提交若增加共同作者，GitHub 仍会按新记录统计贡献者。
- 中英文 README 中的 MDmeow、Mowl 致谢及 `LICENSE.md` 的原有 MIT 版权／许可声明均保留。
- 唯一影响运行行为的调整是 Vite 的默认监听地址改为 `127.0.0.1`，解决本机 Node 的 IPv6 绑定与 Tauri IPv4 就绪检查不一致的问题；另增加本记录和相关文档入口，并清理示例 JSON 行尾空格及 Code 编辑器文件末尾多余空行，以通过首次提交的空白检查。

## 检查与证据

- 按原 `pnpm-lock.yaml` 安装，未更新依赖版本或两个锁文件。
- `pnpm build`：TypeScript 检查和 Vite 生产构建通过。
- `pnpm run '/^test:/'`：全部六组通过；Unix 发行脚本组为 9 项通过，仅模拟构建流程。
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`：62 项通过、0 项失败、6 项显式忽略。忽略项涉及回收站、真实升级资产、签名资产及 Explorer 提权交接，不计为本次通过。
- 实际 WebView2 桌面验证：中文 Markdown 标题／任务列表／表格／代码高亮、details 展开、相对图片、源码视图切换、中文编辑保存及重新打开、普通 CRLF 文本读取、独立图片预览、文件树筛选、系统选择器打开 JSON、多个标签页、设置搜索和深色配色切换。
- 正常关闭后不传文件参数重新启动：两个文档标签、活动 Markdown、源码视图、原阅读位置附近、项目目录和深色主题恢复；保存的中文内容仍存在。现有安装版保持运行，测试实例使用独立配置。
- 日志、迁移文件清单与 SHA-256 清单位于忽略目录 `output/tmp/migration/`；测试文档位于其 `fixtures/` 子目录。它们不进入新仓库提交。

首次构建遇到本机 pnpm 共享存储中 esbuild 可执行文件的 Low 完整性标签，导致它无法删除 Node 创建的临时输入。为新副本创建了内容哈希一致的独立依赖文件，未更改系统权限、共享存储、锁文件或应用源码；之后普通 `pnpm build` 通过。若以后重新安装依赖重现错误，应检查依赖副本，不能将权限错误误判为源码迁移缺失。

## 隔离运行开发版

常规启动仍为 `pnpm tauri dev`。本次桌面验证使用独立应用标识及 APPDATA / LOCALAPPDATA，避免已安装版的单实例锁和共享阅读记录影响测试。便携配置及 WebView2 数据写入新副本的 `src-tauri/target/debug/`，不接触已安装版的设置。

以下命令从本仓库根目录运行；关闭已有的测试开发实例后可重复使用：

```powershell
$devDataRoot = Join-Path (Get-Location) 'output/tmp/migration'
New-Item -ItemType Directory -Force -Path "$devDataRoot/roaming", "$devDataRoot/local" | Out-Null
'{"identifier":"com.baihejiangnan.papernest.migration-test"}' | Set-Content "$devDataRoot/tauri-test.json" -Encoding utf8
$devPreviousAppData = $env:APPDATA
$devPreviousLocalAppData = $env:LOCALAPPDATA
try {
    $env:APPDATA = "$devDataRoot/roaming"
    $env:LOCALAPPDATA = "$devDataRoot/local"
    node node_modules/@tauri-apps/cli/tauri.js dev --config "$devDataRoot/tauri-test.json" -- --locked
} finally {
    $env:APPDATA = $devPreviousAppData
    $env:LOCALAPPDATA = $devPreviousLocalAppData
}
```

## 首次阶段的远端边界

没有配置 origin 或 upstream，没有创建任何 GitHub 仓库。README 历史下载链接、项目网站、关于页、更新入口、发行脚本与既有发行记录仍引用原 PaperNest 仓库，方便保留原有来源和下载；这不表示新副本已经发布。

以后确定新仓库后再同步调整这些入口，重新建立所需 CI Secrets、Releases 和 Pages。此次未打包 MSI、未执行真实安装／卸载／升级、未验证 macOS／Linux 桌面行为，也未发布或迁移 Stars、Issues、Releases。

## 后续公开仓库与发行范围

2026-10-12 用户将旧仓库重命名为私人 `baihejiangnan/PaperNest--old`，并授权新建公开 `baihejiangnan/PaperNest`、推送独立历史与发行。新仓库 ID 为 `1415008645`，与旧仓库 `1396965999` 不同；因此保留原项目／网站／更新 URL，无需改动客户端内嵌公钥。现有 0.2.4 客户端需要更高版本，下一版为 0.2.5。macOS 明确授权先发未公证测试版。正式结果与验证范围见[开发记录](development.md)；旧远端的 Stars、Issues 和旧 Releases 不自动迁移。

本次后续发行已完成：Windows/Linux v0.2.5 与 macOS 未公证测试版均公开；源码、平台包、签名／架构与公开下载证据见开发记录。旧仓库仍为私人 PaperNest--old，独立仓库仅包含本人新历史；原更新及网站地址保留。
