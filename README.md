# 纸间 PaperNest

<img src="branding/icon-master.png" width="112" alt="纸间图标">

一个面向本地文件的轻量桌面阅读与编辑工具：打开 Markdown 即可阅读和修改，也能快速查看代码、配置、日志与图片。

[简体中文](README.md) · [English](README.en.md)

> 这是基于 [MDmeow](https://github.com/zakee039/MDmeow) 持续修改的个人版本。当前仓库保存源码和开发进度，尚未发布适用于新名称的安装包。旧项目的安装包不包含这里的新增功能。

## 能做什么

| 场景 | 当前能力 |
| --- | --- |
| 阅读与编辑 Markdown | Milkdown/Crepe 所见即所得视图；一键切换带行号和语法高亮的源码视图；支持标题、列表、任务、表格、链接、脚注及数学公式。 |
| 查看其他文件 | JSON、YAML、TOML、代码、日志和纯文本进入 Code 模式，支持查找、替换和轻量修改；图片在独立标签页预览。 |
| 管理本地文档 | 多标签页、文件树、标题大纲、目录内搜索、最近查看的前进/后退、拖放打开和会话恢复。标题栏加号打开新标签页，可从空白页创建或打开文件；箭头菜单可切换、堆叠、收藏及关闭标签页。 |
| 处理文件 | 保存、另存为、重命名、新建、复制和删除；文件或目录可从文件树菜单在系统文件管理器中定位。 |
| 输出和自定义 | 导出 HTML，通过系统打印流程输出 PDF；可调整字体、强调色、浅色/深色/跟随系统主题、快捷键和窗口行为。 |

文件树按需读取目录；显示时定期同步根目录和已展开的子目录，返回应用窗口时立即刷新，折叠目录在再次展开时重新读取。以点号开头的项目和符号链接仍会被隐藏。Markdown 中的相对图片与本地链接以当前文档所在目录解析。点击图片可以放大预览，并可调整对齐和缩放。对于二进制文件，应用不会将其当作文本打开。

默认使用 Obsidian 风格的中性色与紫色强调色。警告、确认与消息使用应用内弹窗；删除确认显示文件数量、引用来源和“不再询问”，可在常规设置中恢复删除前询问。文件和文件夹删除会移入系统回收站，可从回收站恢复；移入失败会提示错误，不会改为永久删除。全局组件规则见 [UI 规范](docs/design.md)。

收藏标签页会保存当前有文件路径的标签页列表，之后可从标题栏箭头菜单恢复；未保存的新文件内容不会进入收藏。
在文件树中普通点击文件会复用预览标签页；要保留文件的独立标签页，请右键选择“在新标签页中打开”。切换有未保存修改的预览页前会先确认。

“在新窗口中打开”使用同一应用进程中的单文档窗口，Windows 开发版已完成多窗口与资源管理器定位回归，记录见 [开发说明](docs/development.md)。Windows 候选发行包的剩余检查见 [TODO](TODO.md)；Linux 与 macOS 的发行和实机确认暂定。

## 获取与运行

目前请从源码构建。需要 Node.js 20+、pnpm 与 Rust stable（最低 1.85）；Windows 还需要 Visual C++ Build Tools、Windows SDK 和 WebView2。

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

检查前端构建：

```bash
pnpm build
```

本机打包可运行 `pnpm tauri build`；`pnpm release:windows` 生成 Windows x64 便携 EXE、MSI、更新签名、`latest.json` 和 `SHA256SUMS.txt`。发布工作流以 `vX.Y.Z` 标签构建 Windows 产物，需配置 `TAURI_SIGNING_PRIVATE_KEY`；Linux/macOS 发行暂定。更新签名用于应用内验签，当前没有 Windows Authenticode 证书签名。在发布页出现本项目的正式产物之前，请不要将上游版本视作本项目版本。自动检查更新默认关闭；发布自己的签名版本后可在设置中开启。

## 常用操作

| 操作 | 默认快捷键 |
| --- | --- |
| 新建标签页；在新标签页中创建文件 | `Ctrl/Cmd+N` |
| 打开文件 | `Ctrl/Cmd+O` |
| 保存 / 另存为 | `Ctrl/Cmd+S` / `Ctrl/Cmd+Shift+S` |
| 关闭标签页 | `Ctrl/Cmd+W` |
| 导出 HTML / PDF | `Ctrl/Cmd+E` |
| Markdown 渲染 / 源码 | `Ctrl/Cmd+/` |
| 查找 / 替换 | `Ctrl/Cmd+F` / `Ctrl/Cmd+H` |
| 设置 | `Ctrl/Cmd+,` |

应用级快捷键可以在设置中重新绑定。文件树右键菜单提供新建、复制路径、重命名和删除等操作；**删除会移入系统回收站**，默认操作前会弹出确认。

## 文件格式与数据

纸间直接读写本地文件，不要求导入到专用项目。Markdown 保持普通文本格式，标准图片链接与常见 HTML `<img>` 均可显示。例如：

```md
![示意图](./assets/diagram.png)

<img src="./assets/diagram.png" alt="示意图" style="zoom:50%;" data-align="center">
```

设置和会话状态保存在 `settings.toml`，修改设置后会即时保存。便携版的数据可位于程序旁的 `data/` 目录；安装版使用系统用户数据目录。应用不会自动同步文档到云端，换电脑时请另行备份自己的文件与设置。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `src/` | 前端界面、Markdown 与 Code 模式、标签页和文件树。 |
| `src-tauri/` | Rust 文件操作、窗口、设置、平台集成和打包。 |
| `docs/development.md` | 本地命令与手动回归步骤。 |
| `ARCHITECTURE.md` | 前后端边界与数据流。 |
| `docs/design.md` | 界面设计约束。 |
| `TODO.md` | 当前待验证事项。 |

技术栈为 Tauri v2、Rust、TypeScript、Milkdown/Crepe、CodeMirror 和 KaTeX。代码与图片图标均随仓库提供；项目采用 [MIT License](LICENSE.md)。

## 致谢上游

感谢 [zakee039 的 MDmeow](https://github.com/zakee039/MDmeow) 提供了本项目的直接基础，也感谢更早的 [Ali Naderi / Mowl](https://github.com/naderi/mowl)。纸间在这些工作之上扩展了本地文件阅读、文件树、图片预览与界面体验。原有版权与 MIT 许可文本保留在 [LICENSE.md](LICENSE.md)。
