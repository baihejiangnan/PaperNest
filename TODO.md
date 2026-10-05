# 当前任务与验证

这里记录尚需行动的项目事项，不替代源码或 [README](README.md) 的当前功能说明。完成一项后删除或更新其状态，避免让旧的验证记录看起来仍是新问题。

| 优先级 | 事项 | 当前状态与完成条件 |
| --- | --- | --- |
| 发行 | Windows 发布 | P0/P1 回归已完成；最终修复包的 MSI 升级返回 0，安装文件与 MSI 内嵌程序哈希一致，实际 WebView2 启动、设置面板与图片手势复测通过，控制台无错误或警告。剩余替换草稿中的六个发行文件、公开发布及核对正式下载和更新 URL。当前仅有更新签名，没有 Authenticode 证书签名。 |
| 暂定 | Linux/macOS 发行与实机确认 | 按当前发行范围暂定，不阻塞 Windows 发行。`src-tauri/src/workspace.rs` 的 `open_workspace_location` 将所有非 Windows 平台都交给 `xdg-open`，macOS 对应打开方式待实现。Linux/macOS 的回收站移入与恢复、窗口创建、文件管理器打开方式、文件拖放及发行包仍需在对应系统检查。 |

测试步骤见 [docs/development.md](docs/development.md)。以上“已实现”仅指当前工作区源码，不代表已发布版本或完成手动回归。
