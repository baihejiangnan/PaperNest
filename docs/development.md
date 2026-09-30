# 本地开发与回归

从仓库根目录运行命令。应用由 Vite 前端和 Tauri/Rust 桌面壳组成；`src-tauri/tauri.conf.json` 是通用配置，平台配置在同目录的 `tauri.*.conf.json` 中。

## 环境与命令

- Node.js 20+、pnpm、Rust stable；Windows 还需要 MSVC Build Tools、Windows SDK 和 WebView2。具体安装与发布入口见 [README](../README.md#构建)。
- `pnpm install`：按 `pnpm-lock.yaml` 安装依赖。
- `pnpm tauri dev`：启动前端开发服务与桌面窗口；前端热更新，Rust 文件变化会重新编译并重启应用。
- `pnpm build`：TypeScript 类型检查及 Vite 前端产物构建。
- `cargo check --manifest-path src-tauri/Cargo.toml`：快速检查 Rust。
- `cargo test --manifest-path src-tauri/Cargo.toml`：运行现有 Rust 测试。
- `pnpm release:windows` / `pnpm release:linux` / `pnpm release:macos`：平台发布脚本；发布流程与产物由 [工作流](../.github/workflows/release.yml) 管理。

如果已经有开发实例占用 Vite 端口或单实例锁，先确认该实例及未保存内容，再重启开发命令。不要用旧的 `target/debug` 可执行文件来判断新改动是否生效；Rust 改动需要完成重新编译。

## 修改位置

| 需求 | 主要入口 |
| --- | --- |
| 文档/标签页/窗口协调 | `src/main.ts`、`src/tabs.ts` |
| Markdown 与图片 | `src/editor.ts`、`src/html-markdown.ts`、`src/image-block-markdown.ts`、`src/image-preview.ts` |
| Code 模式与文件类型 | `src/code-editor.ts`、`src/file-types.ts` |
| 文件树、大纲和菜单 | `src/workspace-sidebar.ts`、`src-tauri/src/workspace.rs` |
| 文件读写、设置与文件关联 | `src-tauri/src/commands.rs`、`src-tauri/src/settings.rs`、`src-tauri/src/windows_integration.rs` |
| 视觉与文案 | `src/styles.css`、`src/miku-cream.ts`、`src/i18n.ts`、`index.html` |

自定义 Rust IPC 命令须在 `src-tauri/src/lib.rs` 注册；前端新增 Tauri 窗口或插件 API 时检查 `src-tauri/capabilities/default.json`。数据流细节见 [ARCHITECTURE.md](../ARCHITECTURE.md)。

## 手动回归清单

此表是待执行的检查步骤，不能当作已通过的测试报告。使用临时测试目录和可丢弃副本进行有写入或删除的操作。

1. 从资源管理器双击 `.md`，确认当前文件打开、文件树定位正确；再次双击另一个文件时仍在同一应用进程内接收打开事件。
2. 在多级目录里切换文件树和大纲，检查当前项、缩进线、标题跳转、搜索、上级目录及空白区域菜单。
3. 在文件上选择“在新窗口中打开”，确认主窗口可继续交互；副窗口只有单文档内容及其操作，可保存和关闭。文件夹/文件的“在资源管理器中打开”分别检查目录与选中文件。
4. 打开长 Markdown，连续滚动至中间和末尾；检查相对路径图片、缩放预览及文档内本地链接。再打开图片文件，确认其独立预览不会进入文本编辑器。
5. 打开 `.txt`、日志、JSON、YAML、代码文件和未知扩展名的 UTF-8 文本，确认进入合适的 Code/Plain Text 模式；二进制文件应得到错误或专用预览，而非乱码文本。
6. 检查简单编辑/保存、另存为、未保存关闭提示、标题栏重命名、会话恢复，以及 Markdown HTML/PDF 导出。

Windows 上资源管理器与文件关联的结果不能替代 Linux/macOS 检查。当前待验证项集中在 [TODO.md](../TODO.md)。
