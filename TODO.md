# 当前任务与验证

这里记录尚需行动的项目事项，不替代源码或 [README](README.md) 的当前功能说明。完成一项后删除或更新其状态，避免让旧的验证记录看起来仍是新问题。

| 优先级 | 事项 | 当前状态与完成条件 |
| --- | --- | --- |
| 暂定 | Linux/macOS 发行与实机确认 | 按当前发行范围暂定，不阻塞 Windows 发行。`src-tauri/src/workspace.rs` 的 `open_workspace_location` 将所有非 Windows 平台都交给 `xdg-open`，macOS 对应打开方式待实现。Linux/macOS 的回收站移入与恢复、窗口创建、文件管理器打开方式、文件拖放及发行包仍需在对应系统检查。 |

Windows P0/P1 回归及 [v0.1.0 正式发行](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.1.0) 已完成。测试步骤、证据范围和发行核对见 [docs/development.md](docs/development.md)。Windows 结果不代表 Linux/macOS 已完成实机验证。
