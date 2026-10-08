<div align="center">

<img src="branding/icon-master.png" width="96" alt="纸间图标">

# 纸间 PaperNest

面向本地文件的轻量桌面阅读与编辑工具。<br>
打开 Markdown 即可阅读和修改，也能快速查看代码、配置、日志与图片。

[![最新版本](https://img.shields.io/github/v/release/baihejiangnan/PaperNest?label=%E7%89%88%E6%9C%AC)](https://github.com/baihejiangnan/PaperNest/releases/latest)
[![许可证](https://img.shields.io/badge/license-MIT-8a5cf5)](LICENSE.md)
[![平台](https://img.shields.io/badge/platform-Windows%20x64-555)](https://github.com/baihejiangnan/PaperNest/releases/latest)

[下载](https://github.com/baihejiangnan/PaperNest/releases/latest) · [项目介绍页](https://baihejiangnan.github.io/PaperNest/) · [English](README.en.md)

</div>

---

## 目录

- [功能亮点](#功能亮点)
- [下载与安装](#下载与安装)
- [快速上手](#快速上手)
- [快捷键](#快捷键)
- [文件与数据](#文件与数据)
- [从源码构建](#从源码构建)
- [项目结构与文档](#项目结构与文档)
- [致谢与许可](#致谢与许可)

## 功能亮点

| | |
| --- | --- |
| **所见即所得的 Markdown** | Milkdown/Crepe 渲染标题、列表、任务、表格、链接、脚注和数学公式；一键切换到带行号与语法高亮的源码视图。 |
| **不只是 Markdown** | JSON、YAML、TOML、代码、日志和纯文本进入 Code 模式，支持查找、替换与轻量修改；图片在独立标签页预览。 |
| **文件树与多标签页** | 按需读取目录，默认聚焦 Markdown 文档；标签页可堆叠、收藏和恢复，配合大纲、目录内搜索、前进/后退和会话恢复。 |
| **安全的文件操作** | 新建、重命名、复制、删除都在应用内完成；删除前显示引用情况，文件移入系统回收站，可随时恢复。 |
| **导出 HTML 与 PDF** | 导出独立 HTML，或通过系统打印输出 PDF；导出时移除文档中的脚本等可执行内容。 |
| **按习惯调整** | 浅色、深色或跟随系统；自定义强调色、字体和字号，快捷键可重新绑定，设置支持跨分类搜索。 |

## 下载与安装

当前正式发行 **Windows x64** 版本，在 [Releases](https://github.com/baihejiangnan/PaperNest/releases/latest) 下载：

| 包类型 | 文件 | 适合 |
| --- | --- | --- |
| 便携版 | `PaperNest-X.Y.Z.exe` | 免安装，放在任意目录或 U 盘中使用；数据可保存在程序旁的 `data/` 目录。 |
| 安装版 | `PaperNest_X.Y.Z_x64.msi` | 安装到系统，配合文件关联和右键“新建 MD 文件”使用。 |

- 运行需要 **WebView2 Runtime**（Windows 10/11 通常已内置）。
- 每个发行版附带 `.sig` 更新签名和 `SHA256SUMS.txt`，可用来核对文件。当前没有 Windows Authenticode 证书签名，首次运行时系统可能提示来源未知。
- 自动检查更新默认关闭，可在设置中开启；只获取本项目发布并经签名验证的版本，下载和安装前仍需确认。
- Linux 与 macOS 版本暂未发行。

> 本项目基于 [MDmeow](https://github.com/zakee039/MDmeow) 持续开发；原项目的安装包不包含这里的新增功能。

## 快速上手

1. **打开文件**：`Ctrl+O`、拖放文件到窗口，或在左侧文件树中点击。
2. **切换视图**：`Ctrl+/` 在 Markdown 渲染视图和源码视图之间切换。
3. **浏览目录**：文件树顶部的 ↑ 返回上一级，◎ 回到当前文档所在目录；右键文件夹可“设为根目录”。
4. **保留标签页**：普通点击会复用预览标签页；右键选择“在新标签页中打开”保留独立标签页，“在新窗口中打开”打开单文档窗口。
5. **调整外观**：`Ctrl+,` 打开设置，修改主题、强调色、字体和快捷键。

<details>
<summary><b>文件树</b></summary>

- 默认只显示 Markdown 文档（`.md`、`.markdown`、`.mdx`，不区分大小写）及其祖先文件夹。搜索下方的 MD 图标可关闭筛选，常规设置提供同一开关。
- 目录按需读取；显示时定期同步根目录和已展开的子目录，返回窗口时立即刷新。以点号开头的项目和符号链接会被隐藏。
- 往上一级后，路径栏以淡色保留原来更深的文件夹，点击即可回到那一层。路径段支持 Tab／Shift+Tab 遍历、Enter／空格进入。
- 拖动侧栏分隔线调整宽度，双击恢复默认；聚焦后可用方向键（Shift 加速）和 Home／End。
- Windows 下右键“在资源管理器中打开”会打开所选文件夹，或打开文件所在目录并选中该文件。

</details>

<details>
<summary><b>标签页与窗口</b></summary>

- 标题栏加号打开新标签页，可从空白页创建或打开文件；箭头菜单可切换、堆叠、收藏及关闭标签页。
- 收藏会保存有文件路径的标签页列表，之后可从箭头菜单恢复；未保存的新文件不会进入收藏。
- 右键打开独立标签页时立即显示标签，读取较慢时显示“正在打开文件…”；加载期间可以切换或关闭标签页。
- 切换有未保存修改的预览页前会先确认。
- “在新窗口中打开”在同一应用进程中创建只显示单个文档的窗口，不附带文件树、大纲或标签栏。

</details>

<details>
<summary><b>编辑与右键菜单</b></summary>

- 正文右键菜单可添加或编辑链接、查找文字、设置文本格式、转换标题与列表，以及插入表格、图片、分隔线、代码块和数学块；Shift+F10 可从键盘打开。
- “添加链接／编辑链接”在选区附近打开轻量浮层，可输入网址或本地路径，也可搜索当前文档的同级文件并插入相对链接。
- 点击图片可放大预览，并调整对齐和缩放。相对图片与本地链接以当前文档所在目录解析。
- 二进制文件不会按文本打开；不支持的格式或编码会在窗口顶部显示一条 4 秒后消失的提示，不打断阅读。

</details>

<details>
<summary><b>设置</b></summary>

- 设置使用左侧分类导航；顶部“搜索设置”可跨分类查找名称、配置键名和文件扩展名。
- “编辑器 → 字体”中的“预览当前文档”会淡化设置遮罩，直接查看背后文档的排版；按 Esc 返回。
- 删除确认显示文件数量和引用来源，勾选“不再询问”后可在“常规 → 删除文件前询问”恢复。
- Windows 的“文件关联 → Windows 资源管理器”提供“在右键‘新建’中显示 MD 文件”开关，默认关闭，即使应用未运行也能在系统“新建”菜单创建 `.md` 文件。不会覆盖现有默认打开程序；便携版删除前请先关闭此开关。

</details>

## 快捷键

| 操作 | 默认快捷键 |
| --- | --- |
| 新建标签页 | `Ctrl+N` |
| 打开文件 | `Ctrl+O` |
| 保存 / 另存为 | `Ctrl+S` / `Ctrl+Shift+S` |
| 关闭标签页 | `Ctrl+W` |
| 导出 HTML / PDF | `Ctrl+E` |
| 渲染 / 源码视图 | `Ctrl+/` |
| 查找 / 替换 | `Ctrl+F` / `Ctrl+H` |
| 设置 | `Ctrl+,` |

macOS 使用 `Cmd` 代替 `Ctrl`。应用级快捷键可在设置中重新绑定。

## 文件与数据

**普通文件，原样读写。** 纸间直接读写本地文件，不需要导入专用库或项目。Markdown 保持普通文本，标准图片链接和常见 HTML `<img>` 都能显示：

```md
![示意图](./assets/diagram.png)

<img src="./assets/diagram.png" alt="示意图" style="zoom:50%;" data-align="center">
```

**设置保存在本地。** 设置和会话状态保存在 `settings.toml`，修改后即时保存。便携版可使用程序旁的 `data/` 目录，安装版使用系统用户数据目录。手动编辑导致无法解析时，启动会提示错误，原文件另存为 `settings.invalid-<时间>.toml`，并以默认设置运行。

**删除可以撤回。** 文件和文件夹删除会移入系统回收站；移入失败时只提示错误，不会改为永久删除。

**不上传、不同步。** 应用不会把文档同步到云端，换电脑时请自行备份文件与设置。

## 从源码构建

需要 Node.js 20+、pnpm 和 Rust stable（最低 1.85）；Windows 还需要 Visual C++ Build Tools、Windows SDK 和 WebView2。

```bash
pnpm install --frozen-lockfile
pnpm tauri dev        # 启动开发版
pnpm build            # 检查前端类型与构建
pnpm tauri build      # 本机打包
```

`pnpm release:windows` 生成 Windows x64 便携 EXE、MSI、更新签名、`latest.json` 和 `SHA256SUMS.txt`。调试方法和回归清单见 [开发说明](docs/development.md)，正式发行流程见 [推送与发行规则](docs/release-rules.md)。

## 项目结构与文档

| 路径 | 内容 |
| --- | --- |
| `src/` | 前端界面、Markdown 与 Code 模式、标签页和文件树 |
| `src-tauri/` | Rust 文件操作、窗口、设置、平台集成和打包 |
| `docs/index.html` | [项目介绍页](https://baihejiangnan.github.io/PaperNest/)（GitHub Pages） |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 前后端边界、状态归属与数据流 |
| [docs/design.md](docs/design.md) | 全局 UI 规范与配色 |
| [docs/development.md](docs/development.md) | 本地命令、调试与回归记录 |
| [docs/release-rules.md](docs/release-rules.md) | 推送与发行规则 |
| [TODO.md](TODO.md) | 待验证和待完成事项 |

技术栈：Tauri v2 · Rust · TypeScript · Milkdown/Crepe · CodeMirror · KaTeX

> 多窗口和资源管理器定位已在 Windows 开发版完成回归；Windows 候选发行包的剩余检查见 [TODO](TODO.md)。Linux 与 macOS 的发行和实机确认暂定。

## 致谢与许可

感谢 [zakee039 的 MDmeow](https://github.com/zakee039/MDmeow) 提供了本项目的直接基础，也感谢更早的 [Ali Naderi / Mowl](https://github.com/naderi/mowl)。纸间在这些工作之上扩展了本地文件阅读、文件树、图片预览与界面体验。

本项目采用 [MIT License](LICENSE.md)，原有版权与许可文本保留在其中。
