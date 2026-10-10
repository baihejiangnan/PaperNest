# 当前任务与验证

这里记录尚需行动的项目事项，不替代源码或 [README](README.md) 的当前功能说明。完成一项后删除或更新其状态，避免让旧的验证记录看起来仍是新问题。

| 优先级 | 事项 | 当前状态与完成条件 |
| --- | --- | --- |
| 待验证 | 初始化覆盖会话与普通启动恢复的平台回归 | 修复随 [v0.2.4](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.2.4) 发行：启动同步 ShellNew 不再清空会话；普通无文件启动按恢复开关恢复文件／活动标签／位置／源码视图／项目根目录，指定文件启动不混入旧会话。同用户跨 EXE 共享记录、滚动保存及独立桌面恢复已验证，见 [开发记录](docs/development.md#初始化覆盖会话与普通启动恢复2026-10-10v024-发行)。最终 MSI 的真实升级恢复、旧客户端双模式检查与下载、用户人工使用新版确认见 [0.2.4 发行记录](docs/development.md#windows-v024-发行构建2026-10-10)，不再列为未执行。仍待 Windows 10、Linux/macOS 实机核对；旧 EXE 不会读取新增共享记录。指定文件失败后保存门闩遗漏另列 P2，不能据已有通过项忽略。 |
| 待验证 | 更新完成后自动启动与阅读恢复的剩余验收 | [v0.2.2](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.2.2) 的辅助进程交接与恢复逻辑已随最终 v0.2.4 MSI 完成五场景 Windows 11 实测：被动升级自动启动、显式禁用安装器启动无重复实例、等待旧进程退出、安装器 1619 失败返回、日常恢复开关关闭时更新恢复；文件／活动与非活动标签位置／源码视图／项目根目录有证据。0.2.3 安装／便携双模式检查更新和下载验签通过，用户已人工完成使用新版，便携版真实升级不再待执行，详见 [发行记录](docs/development.md#windows-v024-发行构建2026-10-10)。保留：交互式 UAC 拒绝（未点“否”）、Windows 10、Linux/macOS 实机与发行、完整 MSI 卸载／安装取消界面回归；scenario E 的关闭开关为配置种子，设置面板用户交互未验证。提升权限安装器启动的实例仍有普通权限文件转发受 UIPI 拒绝的限制，需修复启动权限交接。 |
| P2 待修复 | 指定文件读取失败后会话保存一直暂停 | `explicitLaunchPending` 在指定文件读取失败后保持 true；之后通过 `openPath(path, true)` 新标签成功打开文件，或新建文档并成功 `saveAs()`，也不会解除。`persistSoon` 与严格 `flushSettings(true)` 均不写设置，重启回到旧会话。两条实际函数／模拟 IPC 回归已复现，见 [开发记录](docs/development.md#初始化覆盖会话与普通启动恢复2026-10-10v024-发行)；需在用户建立新有效会话时统一解除保护，并覆盖实际成功分支，本次文档收尾未修复代码。 |
| 待验证 | Windows 系统右键“新建 MD 文件”的平台与安装回归 | 功能已实现，默认关闭；真实 WebView2 开关／重启、Shell 菜单名称及创建空 `.md`、第三方冲突保护、卸载 CLI 清理通过，详见 [开发说明](docs/development.md#windows-系统新建-md-文件2026-10-08)。仍需 Windows 10、完整 MSI 升级／卸载、便携版跨目录移动及 Explorer 创建后重命名界面检查。 |
| 待验证 | MD 筛选与侧栏宽度的平台回归 | 前端构建、Rust 测试和 13 项 Edge 组件检查通过，详见 [开发说明](docs/development.md#md-文件树筛选与侧栏宽度2026-10-08)。仍需 Linux/macOS 实机与超大／网络目录性能检查。 |
| 待验证 | Markdown 折叠区块桌面回归 | 合并写法、`open` 属性及装饰呈现已实现，单元测试与浏览器组件检查通过，详见 [开发说明](docs/development.md#markdown-折叠区块2026-10-08)。仍需在实际 WebView2 中打开 README 核对点击、键盘切换、深色主题，以及编辑后切换状态是否保留；嵌套折叠暂不支持。 |
| 待验证 | 右键链接选择浮层桌面回归 | 构建与 27 项浏览器检查通过；实际 WebView2 中核对同级文件读取、相对链接保存后跳转、浅深主题与键盘取消，浏览器目录 IPC 模拟范围见 [开发说明](docs/development.md)。 |
| 待验证 | 新增胶囊通知的桌面回归 | 前端构建与 23 项浏览器组件检查通过；最新独立 debug 测试实例已重启，实际 WebView2 文件树点击 ProductIcon 已显示 D 款通知，原文档保留，自动消失与重复触发正常。v0.1.1 EXE/MSI 已生成并通过更新验签；浅深与系统主题、窄窗口、新标签／拖放入口及桌面 Esc 等仍待核对，验证步骤见 [开发说明](docs/development.md)。 |
| 待验证 | 保存确认与自动保存桌面回归 | 三选一未保存弹窗、`auto_save`（默认关闭）与 Markdown 保存格式已实现并随 [v0.1.6](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.1.6) 发行，构建、四项前端逻辑测试、Rust 测试和 46 项 Edge 组件检查通过，详见 [开发说明](docs/development.md#保存确认自动保存与-markdown-保存格式2026-10-08)。**本次发行未在桌面应用实测**，仍需在实际 WebView2 中核对：关闭／替换预览页／退出／安装更新时三个按钮的结果，未命名与多个未保存文档，自动保存在渲染与源码视图连续输入时光标与撤销不受影响，窗口失焦与切换标签页保存，写入失败提示一次。 |
| 待完成 | 文件命令路径范围 | `read_document`、`write_document`、`read_image_data_url` 与工作区命令仍接受前端传入的任意路径。导出清洗与无脚本打印框架已切断“恶意文档 → 脚本 → IPC”链路，但仍需按已打开文件、工作区与对话框选择维护允许范围，并覆盖拖放、命令行参数、链接跳转与会话恢复入口。 |
| 待验证 | 导出安全改动的桌面补测 | WebView2 中 CSP、无脚本打印框架、导出清洗、设置损坏提示与围栏保存已实测（见 [开发说明](docs/development.md)）。仍需人工确认系统打印对话框与实际 PDF 外观、深色主题下导出、远程图片代理开关两种情况下的显示。 |
| 待完成 | Rust 测试使用全局临时目录 | 部分测试（`assets`、`commands`、`delete_info`、`export`、`recycle`、`workspace`）直接写 `std::env::temp_dir()` 根目录；新测试已改用 `tempfile::tempdir()`。受限环境中可设 `TEMP`/`TMP` 到工作区目录运行。 |
| 暂定 | Linux/macOS 发行与实机确认 | 按当前发行范围暂定，不阻塞 Windows 发行。`src-tauri/src/workspace.rs` 的 `open_workspace_location` 将所有非 Windows 平台都交给 `xdg-open`，macOS 对应打开方式待实现。Linux/macOS 的回收站移入与恢复、窗口创建、文件管理器打开方式、文件拖放及发行包仍需在对应系统检查。 |

Windows P0/P1 回归及 v0.1.0 正式发行已完成；[v0.2.3 更新检查测试发行](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.2.3) 曾公开为 latest，仅把四处应用版本从 0.2.2 递增到 0.2.3，功能与 0.2.2 相同。本次 [v0.2.4 发行](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.2.4) 在其之上包含启动会话覆盖修复与跨 EXE 共享阅读记录；旧 v0.2.3 发行与标签保持不动。证据、公开核验与仍未验证的实机链路见 [开发说明](docs/development.md#windows-v024-发行构建2026-10-10)。
