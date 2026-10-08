# PaperNest 项目入口

PaperNest 是以快速阅读为优先的 Tauri v2 桌面文档应用。Markdown 使用 Milkdown/Crepe 渲染；其它可读取的文本使用 CodeMirror；图片可在文档中或独立标签页预览。轻量编辑、保存与导出仍是产品的一部分。

## 先读哪里

* [README.md](README.md)：产品定位、用户功能、安装与简短构建说明。
* [ARCHITECTURE.md](ARCHITECTURE.md)：前后端边界、状态归属、文件和窗口数据流。
* [docs/development.md](docs/development.md)：本地命令、调试与回归清单。
* [docs/release-rules.md](docs/release-rules.md)：推送与发行规则。执行提交、推送远端、版本升级、发行构建、打标签或 GitHub Releases 发布前必须阅读；规定目标仓库、发布流程、签名与下载核验、完成条件。
* [docs/design.md](docs/design.md)：全局 UI 规范、Obsidian 配色与 HeroUI 语义约定。
* [TODO.md](TODO.md)：当前待验证和待完成事项；以实际代码与用户反馈更新状态。
* [CODE\_MODE\_REFACTOR\_PLAN.md](CODE_MODE_REFACTOR_PLAN.md)：历史设计材料。它不是当前实现的权威说明，尤其“没有项目树”等早期设想已变化。

## 改动前要确认的边界

* `src/main.ts` 协调窗口、标签页、编辑器与 IPC；`src-tauri/src/lib.rs` 注册命令和单实例插件。文件读取和修改通过 Rust 命令完成，前端不直接访问本地文件系统。
* Markdown 渲染、普通文本 Code 模式、独立图片预览是不同的打开路径；不要把二进制文件按文本加载。相对图片和本地链接以当前文档路径解析。
* 文件树按需读取目录；“在新窗口中打开”应在**同一个应用进程**内创建只显示单个文档的窗口，不附带文件树、大纲或标签栏。
* `settings.toml` 同时包含用户偏好和应用会话状态。调整设置字段时同步检查 Rust、前端、设置面板与 `scripts/gen-settings-example.mjs`。
* Windows 文件关联、便携版数据位置和 WebView2 属于平台特有逻辑；不要从 Windows 开发结果推断 Linux/macOS 已验证。

## 工作与文档维护

* 用户要求“推送更新”或“发布发行版”时，按 [推送与发行规则](docs/release-rules.md) 判断执行范围并完成对应核验；不能把推送源码、生成安装包或上传草稿等同于正式发行完成。
* 保留工作区已有的未提交改动。修改前查看相关 diff 和当前源码，不把旧设计稿写成已实现事实。
* 优先更新现有主题；没有真实缺口时不新增文件。文档区分“当前实现”“目标”和“已实测”；编译通过不等于界面回归通过。
* 代码改变用户操作时检查 README；改变状态或 IPC 时检查架构；改变视觉规则时检查设计；改变命令或工具链时检查开发说明；待验证事项更新 TODO。
* 使用仓库相对链接，不在通用文档中写本机绝对路径。无需因重复检查刷新日期或生成空的进度记录。
