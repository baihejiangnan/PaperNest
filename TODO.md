# 当前任务与验证

这里记录尚需行动的项目事项，不替代源码或 [README](README.md) 的当前功能说明。完成一项后删除或更新其状态，避免让旧的验证记录看起来仍是新问题。

| 优先级 | 事项 | 当前状态与完成条件 |
| --- | --- | --- |
| 待验证 | 右键链接选择浮层桌面回归 | 构建与 27 项浏览器检查通过；实际 WebView2 中核对同级文件读取、相对链接保存后跳转、浅深主题与键盘取消，浏览器目录 IPC 模拟范围见 [开发说明](docs/development.md)。 |
| 待验证 | 新增胶囊通知的桌面回归 | 前端构建与 23 项浏览器组件检查通过；最新独立 debug 测试实例已重启，实际 WebView2 文件树点击 ProductIcon 已显示 D 款通知，原文档保留，自动消失与重复触发正常。v0.1.1 EXE/MSI 已生成并通过更新验签；浅深与系统主题、窄窗口、新标签／拖放入口及桌面 Esc 等仍待核对，验证步骤见 [开发说明](docs/development.md)。 |
| 待完成 | 文件命令路径范围 | `read_document`、`write_document`、`read_image_data_url` 与工作区命令仍接受前端传入的任意路径。导出清洗与无脚本打印框架已切断“恶意文档 → 脚本 → IPC”链路，但仍需按已打开文件、工作区与对话框选择维护允许范围，并覆盖拖放、命令行参数、链接跳转与会话恢复入口。 |
| 待验证 | 导出安全改动的桌面补测 | WebView2 中 CSP、无脚本打印框架、导出清洗、设置损坏提示与围栏保存已实测（见 [开发说明](docs/development.md)）。仍需人工确认系统打印对话框与实际 PDF 外观、深色主题下导出、远程图片代理开关两种情况下的显示。 |
| 待完成 | Rust 测试使用全局临时目录 | 部分测试（`assets`、`commands`、`delete_info`、`export`、`recycle`、`workspace`）直接写 `std::env::temp_dir()` 根目录；新测试已改用 `tempfile::tempdir()`。受限环境中可设 `TEMP`/`TMP` 到工作区目录运行。 |
| 暂定 | Linux/macOS 发行与实机确认 | 按当前发行范围暂定，不阻塞 Windows 发行。`src-tauri/src/workspace.rs` 的 `open_workspace_location` 将所有非 Windows 平台都交给 `xdg-open`，macOS 对应打开方式待实现。Linux/macOS 的回收站移入与恢复、窗口创建、文件管理器打开方式、文件拖放及发行包仍需在对应系统检查。 |

Windows P0/P1 回归及 v0.1.0 正式发行已完成；[v0.1.2 正式发行](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.1.2) 已发布为最新版本，源码已推送 main，六个文件的公开下载和更新入口核对通过。标签触发的 CI 因缺少仓库签名密钥停止；本次使用本地签名并验签的产物完成发布。测试步骤、证据范围和发行核对见 [docs/development.md](docs/development.md)。Windows 结果不代表 Linux/macOS 已完成实机验证。
