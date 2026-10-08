# 本地开发与回归

从仓库根目录运行命令。应用由 Vite 前端和 Tauri/Rust 桌面壳组成；`src-tauri/tauri.conf.json` 是通用配置，平台配置在同目录的 `tauri.*.conf.json` 中。

向远端推送或发布 GitHub Releases 前，必须阅读 [推送与发行规则](release-rules.md)。本文保留开发命令与历史验证证据；发行操作顺序、资产要求和完成条件以该规则为准。

## 环境与命令

- Node.js 20+、pnpm、Rust stable（最低 1.85）；Windows 还需要 MSVC Build Tools、Windows SDK 和 WebView2。具体安装与发布入口见 [README](../README.md#构建)。
- `pnpm install`：按 `pnpm-lock.yaml` 安装依赖。
- `pnpm tauri dev`：启动前端开发服务与桌面窗口；前端热更新，Rust 文件变化会重新编译并重启应用。
- `pnpm build`：TypeScript 类型检查及 Vite 前端产物构建。
- `pnpm test:code-text`：检查 CodeMirror 文本序列化的 CRLF、LF、CR、混合换行、空文本、编辑及撤销，防止打开文本后误判未保存。
- `pnpm test:tab-path`：检查普通 Windows 路径、扩展路径和 UNC 路径的标签身份，避免同一文件重复打开。
- `pnpm test:details-html`：检查 `<details>` 开始标记的识别，包括 `open` 属性及与 `<summary>` 合并在同一 HTML 块的 GitHub 写法；其他 HTML 保持原样显示。
- `pnpm test:markdown-serializer`：用 Milkdown 自带的 remark 包与默认处理器，加上 `src/markdown-serializer.ts` 的配置，往返序列化样例 Markdown：单词内下划线不加转义、列表符号、链接／图片／邮件地址写法，以及保存后重新解析得到相同文档树。ProseMirror 与 mdast 之间的转换需要 DOM，不在此测试内。
- `cargo check --manifest-path src-tauri/Cargo.toml`：快速检查 Rust。
- `pnpm test:update-ui`：运行实际更新协调与渲染函数，验证错误在 finally／重新打开后仍显示、设置页保留原因、失败重试、后台检查释放按钮，以及手动检查复用进行中的请求。
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib update::tests::public_metadata_downloads_and_verifies_both_windows_packages -- --ignored --nocapture`：联网读取公开 latest.json，下载 MSI 和便携 EXE，用内嵌公钥验签并检查篡改拒绝；不安装、不启动程序。常规 CI 默认跳过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：运行现有 Rust 测试。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib recycle::tests::windows_ -- --ignored --test-threads=1`：Windows 回收站集成测试，创建独立测试文件与文件夹，检查实际回收站条目后恢复；同时检查锁定文件失败时保留原文件。不会清空回收站。默认用系统临时目录，可通过 `PAPERNEST_TEST_RECYCLE_ROOT` 指定可回收且可写的测试目录。
- [CI 工作流](../.github/workflows/ci.yml)：push 与 PR 在 Windows 上依次运行 `pnpm install --frozen-lockfile`、`pnpm build`、五个 `pnpm test:*` 与 `cargo test`，不需要签名密钥，也不生成发行产物。本地提交前运行同一组命令即可对齐。
- `pnpm release:windows`：Windows x64 EXE/MSI、更新签名、元数据及 SHA-256 清单。脚本检查 MSI 实际关联动作与执行顺序，并通过应用内嵌公钥检查两个产物的有效签名及篡改拒绝；CI 再核对完整六文件集合和校验和。当前 [工作流](../.github/workflows/release.yml) 仅发行 Windows，Linux/macOS 的现有本地脚本暂定。

如果已经有开发实例占用 Vite 端口或单实例锁，先确认该实例及未保存内容，再重启开发命令。不要用旧的 `target/debug` 可执行文件来判断新改动是否生效；Rust 改动需要完成重新编译。

在受限执行环境中，工作区生成的 EXE 可能继承低完整性标记，即使窗口能正常显示，也无法调用正常桌面权限下的资源管理器；目录打开会返回错误码 5，文件定位会返回 `0x80070005`。这时先核对应用与 Explorer 的完整性等级。桌面验证应将最新已编译程序复制到独立的普通临时目录，在该目录使用测试配置启动；不修改工作区或系统目录的权限。已有下载版、安装版或开发版可能占用同一应用标识的单实例锁，检查进程时也应包括版本化的 EXE 名称，不能只检查 `PaperNest.exe`。

## 修改位置

### 更新查询与错误反馈修复（2026-10-08）

- 旧客户端查询 GitHub REST latest-release API，在共享出口的匿名配额耗尽时返回 403；关于页在 finally 重新渲染时隐藏了失败原因。检查和下载前复查改用公开 `latest/download/latest.json`，支持 UTF-8 BOM；MSI 与便携 EXE 分别使用自己的签名，并继续按内嵌公钥验签。旧 MSI-only 元数据的便携更新读取独立 EXE `.sig`。下载 URL 限定为本项目对应版本的 Release 文件。
- 前端保留具体错误，设置页与关于页均可读取；后台检查不弹窗，完成后始终释放按钮。手动检查复用进行中的后台请求。构建脚本生成两个 Windows 入口、大小、签名与 UTC 时间，可用 `-NotesFile` 附带说明；CI 增加更新 UI 逻辑测试。
- `pnpm build`、五项 `pnpm test:*` 通过。系统 TEMP 的权限问题通过仅为测试进程指定 `output/tmp/update-fix` 解决；工作区 Rust 测试剩余一项 HKCU 拒绝访问，将同一最新测试 EXE 复制到普通系统临时目录后运行全套，49 项通过、4 项默认忽略。没有修改目录权限。
- 显式运行联网集成测试通过：实际公开 v0.1.6 的 BOM 元数据、MSI 内联签名、便携 EXE 独立签名均可读取；两个实际程序下载验签通过，篡改均被拒绝。另从构建脚本 AST 执行真实元数据生成语句，核对两个入口、签名、大小、说明与日期。未安装或启动下载程序，未覆盖真实 WebView2 操作。此项为开发阶段验证，v0.2.0 发行证据另行记录。

### 保存确认、自动保存与 Markdown 保存格式（2026-10-08）

- 关闭有未保存修改的标签页、替换预览页、退出和安装更新改用 `askSaveChanges`（`src/dialogs.ts`）：保存（主按钮，初始焦点）、不保存（危险）、取消；Esc、关闭按钮与遮罩为取消。多个文档时为一次“全部保存”。未命名标签页会先激活再另存为；保存失败或取消另存为时中止关闭／退出，不丢弃内容。删除文件前的确认仍为放弃／取消。
- 新设置 `auto_save`（默认关闭，“编辑器”分类）。仅用户编辑过且有路径的文本标签页会写入：停止输入 1.5 秒后、切换标签页、窗口失去焦点，以及关闭／替换／退出时。同一标签页的写入经 `queueTabSave` 串行；写入期间的新编辑保持未保存并在下次保存。自动保存从不替换视图内容：后端格式化表格后磁盘与视图不同，以提交的文本作为基准，标签不会来回变为未保存；失败只按同一文件同一错误提示一次。
- 列表符号默认改为 `-`。`settings.toml` 会写出完整设置，已有用户文件中的 `list_marker = "*"` 保持不变。单词内部（两侧为字母或数字）的 `_` 不再写成 `\_`，图片替代文本相同；`<a@b.c>` 形式的邮件链接不再改写为 `<mailto:…>`。Milkdown 在下划线旁直接接 `*` 强调的写法（如 `a_*b*_c`）本身就会写错，与本改动无关，测试中断言其输出与原版一致。
- 自动检查（2026-10-08）：`pnpm build`、四个 `pnpm test:*`、`cargo test --locked --lib`（46 项通过，3 项 ignored）通过。Vite + 无头 Edge 组件检查 46 项通过：四种语言的按钮文字与样式、初始焦点在“保存”、背景 `inert`、保存／不保存／取消／Esc／关闭按钮／遮罩的结果、焦点恢复、“全部保存”、排队，以及删除类危险确认仍聚焦“取消”；360 px 宽德语与 900 px 中文截图中按钮未超出卡片。另以桩函数在 Node 中运行 `main.ts` 的保存函数：防抖只写一次、代码视图自动保存不改写视图、写入不重叠、写入期间的编辑保留、失败只提示一次、未编辑不写入、取消或另存为取消时中止。尚未在实际 WebView2 桌面窗口中操作。（此项为开发期本机记录；v0.1.6 发行构建时同一组测试为 45 项通过、1 项因执行环境拒绝 HKCU 写入而未通过，见下文“Windows v0.1.6 发行构建”。）

### Markdown 折叠区块（2026-10-08）

- 渲染视图支持 GitHub 常见写法：`<details>` 与 `<summary>` 写在相邻两行（同一个 HTML 块）、`<details open>` 默认展开，以及原有的各自独立成段写法；`<summary>` 内的 `<b>` 等标签只取文字。开始标记的识别在无 DOM 依赖的 `src/details-html.ts`，由 `pnpm test:details-html` 覆盖。
- 折叠、`<div align>` 对齐和标记段落隐藏改由 `src/html-markdown.ts` 中的 ProseMirror 插件以节点装饰呈现。此前直接写入段落 DOM 的类会在 ProseMirror 检测到外部修改后被重绘清除，导致旧写法也不能折叠、`</details>` 段落未隐藏。读者的展开／收起状态保存在插件状态中并随编辑映射位置，不写入 Markdown，也不进入撤销历史。
- 嵌套折叠只记录最近一层，暂不支持；源码视图与保存内容保持原样。
- 组件检查（Vite + 无头 Edge，2026-10-08）：四种写法初始展开状态正确，鼠标与 Enter 切换正常，其他位置编辑后切换状态保留，`<div align="center">` 居中，7 个纯标记段落隐藏，`getMarkdown()` 原样保留四种写法；中英文 README 的 4 个折叠区块均默认收起，无原始标签文本。尚未在实际 WebView2 桌面窗口中核对。

### MD 文件树筛选与侧栏宽度（2026-10-08）

- 文件树默认只显示 `.md`、`.markdown`、`.mdx`（大小写不敏感，与前端 Markdown 渲染类型一致）及包含可见 Markdown 文档的祖先目录；导航栏搜索下方的 MD 图标与常规设置共用 `markdown_only`。搜索遵循同一筛选。`sidebar_width` 保存拖动后的 CSS 宽度，0 表示响应式默认值；手动编辑配置即时应用。
- 递归目录判断在 Rust 后台线程进行，排除隐藏项与符号链接；不读取文档内容，找到一份 MD 即停止扫描该子树。每次列目录或搜索共享 5 万条目／0.8 秒的扫描预算，预算耗尽的文件夹按“可能含 MD”显示，不会被隐藏；扫描超过 2000 条目的结果缓存 30 秒，避免 2.5 秒目录轮询反复全量遍历，因此大目录深处新增／移走 MD 最多延迟 30 秒反映，小目录仍即时刷新。预算与缓存有单元测试；超大目录／网络目录的实际耗时仍需按实际工作区观察。
- 前端构建及文本序列化／标签路径脚本通过；Rust 43 项测试通过、3 项需要真实回收站或发行签名的既有测试未运行。新测试覆盖递归祖先、中文路径、大写后缀、非 MD 与空目录排除、隐藏项规则、最后一份 MD 新增／移走、搜索先筛选再限量，以及设置默认值与往返保存。
- Edge 中 13 项组件交互检查通过：开关默认值、深层 MD、关闭后还原文件／空目录、展开状态、搜索联动、鼠标拖动和保存回调、方向键／Shift／Home／End、双击恢复默认、480×420 窄窗口正文空间与放大后恢复偏好、设置开关同步、过期请求拒绝、后代 MD 刷新，以及隐藏侧栏时变更筛选不自动打开。浅深及窄窗口截图已检查。组件使用真实 WorkspaceSidebar 与 SettingsPanel，目录 IPC 与持久化回调使用隔离数据；不能替代桌面重启验证。
- 独立 debug 标识、独立便携配置的真实 WebView2 打包页面通过 8 项检查：默认 MD 筛选、中文深层 `.MD`、关闭筛选、真实搜索 IPC 联动、鼠标捕获拖动、双击及键盘、设置开关联动和实际 TOML 保存。正常关闭并重启后筛选关闭状态与 210 px 宽度均恢复；外部手改 TOML 后 MD 筛选开启与 360 px 宽度即时应用。循环 junction 不进入树或递归；空目录新增最后一份 MD 后自动出现，改为 TXT 后自动隐藏。页面／控制台错误为 0。测试未修改安装版配置或文件关联；使用回环 CDP 的测试实例在结束后正常关闭，没有生成 MSI 或发行版。

### Windows 系统“新建 MD 文件”（2026-10-08）

- 当前实现见 [交互与注册规则](design.md#windows-右键新建-md-文件)。配置键 `windows_new_md` 默认 false，设置面板、前端、Rust 和配置示例已同步；注册操作与普通“打开方式”分离。
- 前端类型检查／构建、文本序列化和标签路径脚本通过；Rust 默认测试 44 项通过、3 项既有集成测试显式跳过。新增隔离注册表测试覆盖默认类型保留、重复开关、第三方后写入保留、冲突拒绝、无类型时补足与撤销、写前日志中断恢复和日志路径校验。工作区测试 EXE 直接执行时注册表访问被执行环境拒绝；将同一已编译测试 EXE 复制到普通临时目录后完整运行通过，未修改系统权限。
- 使用独立 debug 标识、临时便携配置和实际 WebView2 打包页面验证开关默认关闭、启停与 TOML 保存、正常关闭后重启、设置搜索定位，以及已有第三方 ShellNew 时禁用控件／后端拒绝覆盖。最新构建还通过了已启用配置在注册被移除后启动修复，以及带过期 false 的普通设置保存仍保持实际启用状态的检查。测试路径包含中文、空格和逗号。现有 `.md` 默认 ProgID 与 `UserChoice` 在前后检查中一致。
- 通过 Windows 原生 NewMenu COM 处理器枚举实际菜单，显示“MD 文件”；调用同一处理器的菜单命令创建了 0 字节的 `MD 文件.md`，应用关闭后菜单仍有效。最初纯文本 MenuText 被系统忽略，改为本地化间接资源后生效；更新资源引用版本修饰符后旧 MUI 缓存得到刷新。此项验证真实 Shell 处理器，没有替换注册或文件创建逻辑；尚未人工操作 Explorer 的创建后重命名界面。
- 开启后正常关闭测试应用，再执行 `--papernest-msi-unregister-new-md` 清理入口，退出成功；自建 ShellNew 与所有权日志均已撤销，原默认程序保持不变。MSI 清理动作失败时不阻止卸载（`Return="ignore"`，与关联清理一致）。MSI fragment XML 已解析检查，尚未构建新 MSI 或执行完整升级／卸载。Windows 10、便携程序跨目录移动和 MSI 生命周期仍需实机检查。测试实例及回环调试端口已关闭，安装版与原配置未替换。

| 需求 | 主要入口 |
| --- | --- |
| 文档/标签页/窗口协调 | `src/main.ts`、`src/tabs.ts` |
| Markdown 与图片 | `src/editor.ts`、`src/html-markdown.ts`、`src/image-block-markdown.ts`、`src/image-preview.ts` |
| Code 模式与文件类型 | `src/code-editor.ts`、`src/file-types.ts` |
| 文件树、大纲和菜单 | `src/workspace-sidebar.ts`、`src-tauri/src/workspace.rs` |
| 文件读写、设置与文件关联 | `src-tauri/src/commands.rs`、`src-tauri/src/settings.rs`、`src-tauri/src/windows_integration.rs`、`src-tauri/src/new_md.rs` |
| 视觉与文案 | `src/styles.css`、`src/editor-theme.ts`、`src/i18n.ts`、`index.html` |

自定义 Rust IPC 命令须在 `src-tauri/src/lib.rs` 注册；前端新增 Tauri 窗口或插件 API 时检查 `src-tauri/capabilities/default.json`。数据流细节见 [ARCHITECTURE.md](../ARCHITECTURE.md)。

## 手动回归清单

此表是待执行的检查步骤，不能当作已通过的测试报告。使用临时测试目录和可丢弃副本进行有写入或删除的操作。

1. 从资源管理器双击 `.md`，确认当前文件打开、文件树定位正确；再次双击另一个文件时仍在同一应用进程内接收打开事件。
2. 在多级目录里切换文件树和大纲，检查当前项、缩进线、标题跳转、搜索、上级目录及空白区域菜单。
   根目录导航：从深层文档连续点 ↑（含快速连点），路径栏应保留更深的文件夹并可点击返回；点 ◎ 回到文档所在目录、高亮并聚焦文件；右键文件夹“设为根目录”后路径栏只剩新分支。Tab／Shift+Tab 按顺序遍历可返回的路径段，Enter／Space 进入后继续导航，自动刷新不丢焦点。窄侧栏下路径应换行，单个超长名称省略并可悬停查看完整路径，分隔符不单独占行，定位与搜索按钮保持可用；重命名或删除路径栏中的文件夹后点击剩余路径段不应报错。
   在资源管理器中直接新建、复制、重命名、删除根目录和已展开子目录里的文件，确认文件树在数秒内更新；折叠目录再次展开及从资源管理器切回应用时应立即更新。最小化窗口期间不持续读取目录。打开文档中的未保存编辑不应被外部文件变动覆盖。
3. 在文件上选择“在新窗口中打开”，确认主窗口可继续交互；副窗口只有单文档内容及其操作，可保存和关闭。“在资源管理器中打开”分别检查文件树空白处打开根目录、文件夹行打开该目录、文件行打开所在目录并选中文件，以及搜索结果的目标路径。覆盖中文、空格和逗号路径；核对实际资源管理器的位置和选择，不能仅以 IPC 成功作为通过依据。
4. 打开长 Markdown，连续滚动至中间和末尾；检查相对路径图片、缩放预览及文档内本地链接。再打开图片文件，确认其独立预览不会进入文本编辑器。
5. 打开 `.txt`、日志、JSON、YAML、代码文件和未知扩展名的 UTF-8 文本，确认进入合适的 Code/Plain Text 模式；二进制文件及非 UTF-8 文本应显示顶部居中的琥珀色胶囊提示，而非乱码文本。确认通知无须点击确认、文档和文件树仍可操作、4 秒后消失、悬停或键盘聚焦暂停、手动关闭和 Esc 关闭有效。连续点击失败文件时只显示一条并重置计时；旧预览读取与已关闭加载标签的延迟错误不再提示。检查浅色、深色与窄窗口；文件不存在或无权限仍显示具体错误。
6. 检查简单编辑/保存、另存为、未保存关闭提示、标题栏重命名、会话恢复，以及 Markdown HTML/PDF 导出。
   导出安全：用含 `<script>`、`<img onerror>`、`javascript:` 链接、`<iframe>` 及 `![](secret.txt)`／伪装成 `.png` 的文本文件的文档导出 HTML 和 PDF。HTML 文件中这些内容应已移除、非图片文件未内联；PDF 打印框架带 `sandbox`（无 `allow-scripts`），公式、代码高亮、表格、任务列表、脚注、`details`/`kbd` 与本地图片仍正常。DevTools 控制台除打印框架拒绝脚本的提示外不应有 CSP 报错。
   保存可靠性：围栏代码块内形似表格的行保存后保持原样；把 `settings.toml` 改成无效 TOML 后启动，应提示错误与 `settings.invalid-*.toml` 备份路径，备份内容与原文件一致。
7. 展开文件树后打开十余个文档，缩窄窗口，检查标签始终只在文档区域上方、自动缩窄且悬停显示完整文件名；用右侧箭头切换/堆叠/展开、收藏/恢复和全部关闭，含未保存内容时确认取消可中止批量关闭。点击加号，分别检查空白页的创建、打开和关闭入口。
   在浅色与深色主题下确认选中和未选中的标签关闭按钮均可见，悬停和键盘焦点可增强显示，文件名不与按钮重叠。
8. 在同一文件树连续普通点击不同 Markdown、文本和图片，确认复用一个预览标签页；右键“在新标签页中打开”后确认该页保留，再继续点击树内文件。编辑预览内容后取消切换，确认标签和编辑内容未被覆盖。
   右键打开读取较慢的文件时应立即显示标签与加载提示；在加载期间切换、再次打开同一路径、关闭或连续打开不同文件，确认不会出现重复标签、抢回焦点或重新打开已关闭标签。读取失败应提示错误并移除失败的标签；关闭后的过期错误不再弹出。加载期间保存不能写入空内容。

Windows 上资源管理器与文件关联的结果不能替代 Linux/macOS 检查。当前待验证项集中在 [TODO.md](../TODO.md)。

### 文件树根目录导航（2026-10-08）

- 新增 ◎“定位当前文档”、文件夹右键“设为根目录”及保留更深层级的路径栏；前端构建通过。
- debug 构建（临时配置开启回环 CDP）中以 `proj/app/src deep/doc.md` 实测：连续 ↑ 后路径栏为 `proj › app › src deep`，点 `app` 返回该层；◎ 回到 `src deep` 并聚焦 `doc.md`；快速连点两次 ↑ 正确上升两级（修正前只上升一级）；对 `other` 设为根目录后路径栏重置为新分支，再 ↑ 为 `proj › other`；右键菜单仅对文件夹显示该项；控制台无错误。
- 浅色与深色截图已核对；默认侧栏宽度下普通路径换行，名称完整。
- 三项补测已完成：使用独立应用标识、独立设置和可丢弃目录，在实际 WebView2 的打包页面 `tauri.localhost` 上通过真实右键菜单和 Rust IPC 检查祖先／最深目录重命名、取消重命名、取消删除及实际移入回收站。磁盘目标、路径栏和当前文档路径同步；删除后对应标签关闭，剩余文档仍能定位，失效路径段移除。未替换文件操作 IPC。
- 键盘补测发现路径栏重绘会丢失焦点，现按路径恢复焦点；进入的按钮变为当前位置时保留程序焦点，不增加多余的 Tab 停靠点。Tab／Shift+Tab、Enter／Space、进入后继续 Tab 到 ◎，以及目录自动刷新时的焦点保持均通过。读取目录时还会截短已不存在的记忆分支；外部改名祖先和最深目录的补测通过，此检查仅覆盖实际重新读取的目录。
- 超长中文／英文名称在 920×680 和原生 480×420 窗口、浅深两种主题下检查通过：名称省略、完整路径 title、路径按钮点击与键盘进入正常，侧栏无横向溢出，↑／◎／搜索保持在边界内。分隔符原先可能独占一行，现与后面的路径按钮一起换行。截图已核对。
- 最终独立 debug 构建的 17 项交互与布局检查通过，捕获的页面／控制台错误为 0；`pnpm build`、`pnpm test:code-text` 和 `pnpm test:tab-path` 通过。Linux/macOS 仍未实机验证，继续保留平台待办；本轮未生成 MSI 或发布发行版。

### 导出安全与保存可靠性（2026-10-08）

- 自动检查：`pnpm build`、`pnpm test:code-text`、`pnpm test:tab-path` 通过；`cargo test` 40 项通过，3 项需要实际回收站或发行产物的 ignored 测试未运行，新增覆盖导出清洗、打印无脚本变体、图片签名校验、原子写入及失败保留目标、设置损坏备份、代码围栏内表格不重排。
- 桌面实测：用带生产 CSP 的 debug 构建（仅构建时通过临时配置开启回环 CDP，未修改项目配置），在 WebView2 中打开含恶意 HTML 的测试文档。编辑器公式与代码块正常，本地 PNG 以 `data:` 加载，`secret.txt` 与伪装 `.png` 被拒绝，原始 HTML 仅以文本显示，控制台无 CSP 报错。PDF 打印框架 `sandbox="allow-same-origin allow-modals"`、无脚本，KaTeX 2 处（含 1 处块级）、代码高亮、表格、任务列表、脚注、`details` 正常，`print()` 被调用；文档脚本与 `onerror` 未执行，机密内容未内联。
- HTML 导出经应用命令生成后在无头 Edge 中渲染：公式与代码高亮正常，脚本、事件属性已移除。修改前 comrak 输出的公式不含 `$` 分隔符，模板的 auto-render 无法识别，HTML 导出中的公式实际未渲染；模板现直接渲染 `[data-math-style]`。
- 通过应用保存围栏中含表格的文档：围栏内容不变，围栏外表格被格式化，目录无残留临时文件。debug 实例的 `settings.toml` 改坏后启动，中文提示含解析错误与备份路径，备份与原文件逐字节一致；标题栏关闭后进程退出、设置正常写回，测试后已恢复该 debug 配置。
- 未覆盖：系统打印对话框与实际 PDF 输出外观、深色主题下的导出、Linux/macOS。

### 侧栏图标与设置候选预览（2026-10-07）

- 实际侧栏已将大纲移动到搜索上方，并用齿轮替换设置图标；原按钮 ID、事件绑定和可访问名称保留。前端构建通过。
- [设置 HTML 对比入口](../output/settings-previews/index.html) 提供 A 左侧分类、B 紧凑顶部标签、C 右侧抽屉三份独立预览。HTML、CSS、JS 与截图使用同目录相对路径，浏览器可离线打开；预览中的状态仅在当前页面内变化，不调用项目 IPC、不写入实际配置，不修改 Windows 文件关联或执行网络检查。
- Edge 中 39 项检查通过，运行错误为 0。覆盖三种布局、五个分类、搜索设置、浅深主题、字体效果、代理开关、快捷键捕获、文件类型选择、模拟版本状态、关闭／齿轮重新打开、Esc 及 480×640 视口；浅色、深色、窄窗口与对比入口截图已核对。这一阶段仅生成候选预览，后续实际接入见下项。
- 新增 [A＋C 组合预览](../output/settings-previews/d-combined.html)：分类导航＋编辑器页字体效果区。另有 23 项检查通过，运行错误为 0，覆盖正文／源码独立字体和字号、自动示例切换、代码隔行开关与颜色、示例标签键盘切换、恢复字体默认值、分类收起与搜索唤出预览、深色、40 px 大字号、960×720／480×700 上下布局、原 A／B／C 初始界面和组合入口；HTML 可离线与开发服务器打开，仍不调用实际设置或文件 IPC。

### A 设置面板与透明字体预览（2026-10-07）

- 实际设置采用 A 左侧分类布局，保留原设置和保存回调。字体区通过“预览当前文档”清除面板背景、淡化遮罩，只保留清晰的字体控件；字体与字号改为 input 时应用。修正 CodeMirror 文档主题优先级，使源码字体和字号不再被共享主题的固定值覆盖。
- 前端构建与 37 项 Edge 组件检查通过，运行错误为 0。覆盖五个分类、正文与源码真实编辑器的字体/字号实时变化、空字体恢复默认、空/越界数字处理、背景 inert、Tab 循环、Esc 两阶段退出、遮罩/按钮返回、关闭/重开/语言重建清理、方向键切换、更新/代理/快捷键/关联选择回调、文档内容保持，以及浅深主题、480×360 和 640×420 的边界与滚动。检查中发现的源码固定字号问题已修复并复测；浅深及透明、窄窗口截图已核对。
- 组件使用实际 `SettingsPanel`、`Editor` 与 `CodeEditor`；设置状态和系统/网络操作回调使用内存隔离，未写入用户配置、执行网络更新或修改文件关联。实际 WebView2 的视觉与持久化重启验证仍列于 TODO；未生成新安装包。

### 设置搜索与更新卡片（2026-10-07）

- 实际面板接入 A 预览中的版本卡片、分类图标／说明、顶部跨分类搜索，以及自动更新开关和检查周期说明。搜索索引复用字段定义并补充代理、版本、字体预览和扩展名；结果跳转、聚焦与突出对应控件，不直接改变设置或执行操作。
- 前端构建和 43 项 Edge 组件检查通过，运行错误为 0。覆盖真实版本及来源显示、更新回调／检查中禁用／成功／失败重试、开关值保持、中文与配置键名／多关键词／扩展名搜索、代理与快捷键定位、结果不改值、无结果、清除／Esc／重开、方向键及 Enter、IME 组合输入、异步检查不覆盖搜索、语言重建、字体预览与字号即时生效、定位后的 Tab 顺序、禁用检查按钮的焦点回退、文档内容保持、浅深主题、480×360 与 640×420 边界和滚动。浅深更新页、搜索结果及窄窗口截图已核对。
- 检查使用实际设置组件与编辑器，设置及更新回调在内存中隔离；未执行真实网络检查、写入用户配置或修改 Windows 文件关联。桌面 WebView2 的真实检查结果与持久化确认仍在 TODO。

### 链接选择浮层回归（2026-10-06）

- 右键添加／编辑链接改用正文选区附近的非模态浮层，支持手填网址与路径、同级文件筛选、方向键与 Enter 选择和点击提交。文件读取复用 `list_workspace_dir`，选中文本保留；空选区插入可读文件名，链接保存为带编码的相对路径。
- Edge 中 27 项检查通过，运行错误为 0。覆盖同级文件与当前文件／文件夹排除、文件名筛选、相对链接与原选区名称、手填网址、已有链接编辑、特殊字符文件名、空选区、方向键选择、Esc／关闭按钮／点击外部取消、源码模式关闭、无背景 inert、未保存文档、读取失败和延迟结果隔离、Windows 根目录／UNC／Unix 根目录、浅深主题与 480×360 视口边界。目录 IPC 在浏览器回归中使用隔离模拟，实际桌面目录读取与链接跳转仍待核对；未生成新安装包。

### 文档右键菜单回归（2026-10-06）

- 正文右键替换为应用内菜单，文本格式、段落设置和插入分支复用实际编辑器状态与现有块转换；包含链接输入、选中文字查找、撤销／重做及剪贴板操作。源码、普通文本与内嵌代码块提供纯文本菜单，菜单与四种 UI 语言同步。
- Edge 中 47 项交互检查通过，运行错误为 0。覆盖真实鼠标选区与加粗、倾斜、删除线、行内代码／数学、清除格式、标题转换、任务／普通列表与多段选区、表格单元格内格式、全部五项块插入、链接添加／编辑／移除／取消、复制／剪切／富文本及纯文本粘贴、撤销／重做、全选、选区查找、源码与内嵌代码块菜单、剪切失败保留原文及延迟粘贴不覆盖新文档；点击外部关闭、父菜单滚动收起分支并返回焦点也已检查。
- 浅色与深色、屏幕右下角子菜单向左展开，以及 480×360 可滚动菜单和键盘定位均有截图并核对。方向键进出分支、Esc 恢复选区、Shift+F10 打开菜单通过。`pnpm build` 与现有 Code 文本换行／编辑／撤销检查通过。浏览器回归使用隔离的内存剪贴板，不修改系统剪贴板；桌面 WebView2 的系统剪贴板集成尚未实测，未生成新发行安装包。

### HTML 图片正文加载回归（2026-10-06）

- 复现：在 `<div align="center">` 区域内使用指向本地文件的 `<img>`，HTML 呈现引起 ProseMirror 重建图片节点。原异步读取返回时旧节点已脱离文档，新节点保留相对路径而显示破图；放大预览重新解析路径，仍能显示图片。
- 编辑器现在观察新插入的 HTML 图片节点并重新解析其路径；异步结果同时核对文档代次、文档路径和图片源，避免快速切换文档后旧结果覆盖新图片。
- 使用用户提供的 README 内容和实际 Logo PNG 在 Edge 中检查：正文按原 `width="120"` 显示，放大预览及 Esc 返回正常，切换文档后正常，原 HTML 相对路径保留且不写入 data URL。慢速旧文档读取不能覆盖新文档同名图片，普通 HTML 图片和 Markdown 图片正常；7 项浏览器检查通过，运行错误为 0，`pnpm build` 通过。文件读取桥在该浏览器检查中由本地文件读取模拟；尚未在实际桌面 WebView2 中复测，也未重新生成发行安装包。

### 标签页打开回归（2026-10-05）

- 使用实际前端源码和隔离的 Tauri IPC 读取模拟，对比修复前后：延迟返回时，原实现没有创建新标签且关闭按钮透明度为 0；修复后立即出现固定标签与加载提示，浅色/深色关闭按钮正常显示。
- 浏览器回归覆盖加载期间禁止保存、切换后完成不抢回选择、关闭后不重开及忽略过期错误、连续读取乱序完成、旧 Markdown 回调隔离、未保存编辑保留、CRLF 保留与独立图片预览；有效请求读取失败时显示应用内错误，关闭提示后移除失败标签。920×680 和 640×420 界面截图已查看，应用错误为 0。读取模拟不等同于实机磁盘耗时测量。
- 前端构建、Code 文本与标签路径检查通过；Rust 测试 31 项通过，3 项原有显式集成测试跳过。新增后台读取测试检查 UTF-8/CRLF 原文、二进制拒绝、非法 UTF-8 和不存在文件的错误。
- 使用独立应用标识、临时配置与临时文件构建 Windows 测试程序，连接实际 WebView2 的打包页面 `tauri.localhost`，未替换读取 IPC。右键打开 Markdown、CRLF 文本和图片均在下一帧显示新标签并自动显示内容；重复打开同一路径复用标签，活动与非活动标签关闭均通过。通过设置面板切换浅色/深色后，关闭按钮可见且可点击，截图已核对。控制台错误与警告均为 0。此检查没有更新已安装程序或发布安装包。

### 资源管理器菜单回归（2026-10-05）

- 本次故障的开发实例完整性等级为 4096（低），桌面 Explorer 为 8192（中）。相同 Shell 调用的独立探针在工作区返回错误码 5，复制到普通临时目录后返回成功。修正启动位置后，保留现有 `ShellExecuteW` / `SHOpenFolderAndSelectItems` 实现；没有修改系统或工作区权限。
- 使用独立应用标识的最新打包页面 `tauri.localhost` 验证实际菜单与 Windows Explorer：在用户报错的 `output/tmp` 根目录、含中文和空格的文件夹、普通文件和搜索结果上操作均通过；另以可丢弃目录核对真正的空白区域、中文逗号文件夹、带逗号/方括号/与号的文件和嵌套搜索结果。每一步通过 Shell 的实际窗口位置及选中项核对，未替换 IPC；8 项菜单检查无错误弹窗，控制台错误与警告均为 0。
- 测试标签已关闭并恢复原文档。运行中的桌面预览保留此前标签页修复；已有下载版与安装版未被覆盖。

### Windows P0 回归记录（2026-10-01）

以下按执行时间保留回归过程，早期“待核对”项的最终结果见后续追加记录。Windows P0/P1 已完成，v0.1.0 正式发行的最终核对见本节末尾；Linux/macOS 仍暂定。

- 同进程新窗口：修复便携版副窗口数据目录后，使用含中文、空格和多级目录的 Markdown/普通文本，连续创建三个副窗口；仅有一个 PaperNest 应用进程，各窗口内容正常，没有文件树、大纲、标签栏或持续空白，主窗口仍能交互。另一个项目内可写测试文档在 Markdown 副窗口编辑后成功保存，已读取磁盘内容核对，关闭后主窗口保留；未保存文本的关闭提示与取消关闭也已操作验证。
- 资源管理器打开：最终测试版在独立临时便携目录正常启动，已通过真实桌面菜单核对：文件树空白区打开当前树根目录，目录项打开自身目录，文件项打开所在目录并选中文件。测试路径含中文、空格和三级目录，中文 Markdown 文件与带空格的普通文本文件都正确选中；操作后主窗口仍可交互。该测试版的单文档副窗口也正常显示，关闭后主窗口保留。
- 测试环境说明：仓库内测试目录继承了执行环境的删除限制，普通桌面启动曾在 WebView2 初始化时报“拒绝访问”；受限进程启动虽能显示窗口，但 Shell 调用失败。最终改用独立临时目录中的相同二进制完成桌面验证，未更改目录权限；临时启动诊断代码已移除。
- `pnpm build` 通过；Rust 测试 29 项通过，2 项回收站集成测试仍跳过。使用项目内可写临时目录运行文件测试；Vite 已排除 `output/tmp/` 与 `.build-tmp/`，避免监视锁定临时文件时因 `EBUSY` 退出。

### Windows P1 回归进行记录（2026-10-01）

以下使用同一临时便携版和独立可丢弃目录，通过真实 PaperNest 与资源管理器窗口操作；只记录已经取得的证据，剩余项目仍保留在 TODO。

- 文件树：新建 Markdown、编辑保存、重命名及创建副本后读取磁盘核对；副本与原文件 SHA-256 一致，新建目录存在。搜索能找到子目录文件，清空后恢复文件树。根目录和已展开子目录的外部新增、改名、删除均同步；一次改名检查约 3.2 秒后已更新。折叠目录期间创建文件，重新展开立即读到；上述操作没有覆盖当前未保存编辑。
- 阅读：JSON、YAML、TypeScript、普通文本及未知扩展名进入 Code/Plain Text，二进制文件显示应用内错误并保留原活动文档。100 节 Markdown 的中部和末尾无空白缺失；相对图片加载、图片独立预览、文档本地链接及预览关闭已验证，Ctrl+滚轮缩放仍待操作。
- 文本修复：桌面发现 CRLF 被 CodeMirror 规范化后误判为未保存。现在保留未编辑文档的原始文本，编辑后沿用原换行风格，搜索仍使用 CodeMirror 的规范化位置。`pnpm test:code-text` 通过；桌面切换 JSON、TypeScript、YAML、未知文本不再误弹未保存提示。
- 排版与导出：宽窄窗口表格换行和六级标题层次已查看，大纲点击六级标题正常跳转。导出菜单原先在右侧被裁切，已改为按窗口边界定位；修复后菜单完整可点击。HTML 已实际保存，产物包含 H1～H6、表格及内嵌相对图片；通过 WebView2“另存为 PDF”实际保存 325,538 字节的一页 PDF，文本提取及页面渲染核对六级标题、表格、图片和末尾标记，未见裁切或重叠。打印 iframe 已改为在 `afterprint` 后清理，避免固定时间提前移除。
- 主题与删除：文件和含子文件目录已实际移入系统回收站，再通过资源管理器恢复，读取内容一致；没有额外系统反馈窗口。锁定文件删除报应用内错误，原文件保留。引用数量和来源跳转正确；取消或 Esc 不保存“不再询问”，成功删除才持久化，设置可恢复删除确认。深浅主题、外部设置文件更新、删除弹窗 Tab/Shift+Tab 循环已操作；重启、设置快捷键及低高度检查结果见下方追加记录。
- 标签与保存：文件树普通点击复用预览标签，未保存切换时取消能保留内容；右键独立标签随后保持不被预览替换。堆叠/展开、收藏 9 页并恢复、批量关闭遇到未保存文档时 Esc 中止并保留修改均已操作。空白页创建、打开、关闭三个入口通过，创建的 Markdown 另存为后内容一致。20 个混合文件的会话恢复按原顺序完成，跳过活动文档之前的失效路径仍正确选中原活动长 Markdown。640×420 窗口里查看完整文件名提示；修复尺寸变化后的活动标签定位后，当前标签保持可见。普通路径重新打开已有文本仍只有 20 个标签。普通/扩展/UNC 路径身份差异另由 `pnpm test:tab-path` 覆盖。组件与后端性能测量见 [基线](performance-baseline.md)。
- 追加弹窗检查：640×420 的设置弹窗内容可滚动，关闭入口可见；设置标签方向键切换、快捷键捕获时 Esc 取消通过。重启保持浅色主题及删除确认。外部删除刚创建的统计测试目标后，删除弹窗显示读取失败，辅助功能树确认删除按钮 disabled；加入非法 UTF-8 Markdown 后，引用扫描明确提示统计未完成。关闭按钮退出确认后原文件仍存在，删除确认设置仍为 true。

### 性能与候选包核对

- 固定修改前提交与当前源码，在同一机器对编辑、恢复、搜索和图片分别记录 30 次热缓存样本、分项耗时和内存。完整测量范围、原始 JSON 与复现命令见 [性能基线](performance-baseline.md)。组件结果不替代 Windows WebView2 或完整应用启动测试。
- 标题 ID 的非历史追加事务会更换 ProseMirror 文档对象；以文档代次追踪回调归属后，标题编辑回调正常，切换内容及重建编辑器后的旧回调被拒绝。延迟保存期间的新编辑仍保留脏状态；搜索换词、清空、换根、关闭和过期错误各 30 例通过；21 张延迟加载的 Markdown/HTML 图片均显示。
- 当前 Rust 默认测试 29 项通过，3 项显式集成测试默认跳过（回收站 2 项、发行验签 1 项）。Windows 候选 EXE 与 MSI 分别执行发行验签测试，原文件通过、篡改文件被拒绝。产物签名为更新签名，未配置 Authenticode 证书。
- MSI 静态检查确认 x64、产品名 PaperNest、版本 0.1.0 和安装文件大小；解包后的程序与便携程序仅有 Tauri 的三字节包类型标记差异（`UNK` → `MSI`）。实际安装、文件关联与候选版功能回归仍以 TODO 为准。
- 便携候选包实测（2026-10-02）：正式构建在独立临时目录正常启动，界面来自打包的 `tauri.localhost`，21 个混合标签恢复。编辑 Markdown 标题后未保存标记出现，保存后消失，磁盘内容一致；保存后撤销仍保留编辑历史，撤销结果可再次保存。渲染/源码往返切换未产生误报。注册选定的 Markdown 扩展名后，注册命令指向当前候选 EXE。系统已有 Markdown 默认程序为 Obsidian，实际双击仍遵从该选择；PaperNest 的打开方式接收另行核对。
- 弹窗组件实测：内层消息 Esc 关闭后，外层仍存在，焦点回到其“Open message”，背景保持 inert；再次 Esc 关闭外层后，焦点回到打开按钮，背景解除 inert。原生候选包的遮罩等结果仍按下方清单执行。
- 安装版追加实测（2026-10-02）：MSI 中文向导成功安装及同版本升级，安装文件与 MSI 解包文件 SHA-256 一致；首次设置位于 Roaming/PaperNest，系统应用配色为浅色，默认跟随系统的界面一致。日志打开、编辑保存后磁盘内容一致；短编辑后关闭显示未保存提示，取消保留内容，撤销后回到干净状态。
- 安装关联缺口：发现 WiX 自定义动作所在 Fragment 未被引用，旧 MSI 不含注册/卸载动作。现已加入 CustomActionRef，注册安排在 InstallFinalize 后、自动启动前；发布脚本直接检查实际 MSI 的动作、命令、类型和顺序。内嵌公钥验签及篡改拒绝通过，程序注册钩子单独执行成功。最终 MSI 的实际安装/卸载关联仍待核对；一次静默升级在移除旧产品时因错误 1730（需要管理员）退出，原安装文件保留，不能把此结果记为安装通过。
- 目录停读组件检查：真实 WorkspaceSidebar 配合模拟 IPC 和 visibilitychange，可见期间轮询新增 1 次目录调用，隐藏 5.5 秒新增 0 次，恢复可见立即新增 1 次。原生窗口补测见下方；组件调用计数与桌面行为分别记录。
- 最终安装关联实测：通过资源管理器“打开方式 → PaperNest”连续打开两个 Markdown，安装版文件树选中对应文件，应用进程 ID 不变。安装后的 EXE 与最终 MSI 解包程序 SHA-256 相同。实际卸载后程序和开始菜单快捷方式移除，Roaming 中用户设置保留；资源管理器的打开方式菜单已不再列出 PaperNest。原 Markdown 默认程序保持 Obsidian。
- 追加桌面核对：上级目录按钮切换到父目录，活动文档保留。Markdown 输入后关闭及切换均显示未保存提示，遮罩取消、Esc 取消保留原修改；重新聚焦正文后撤销恢复干净状态。20 张本地图的文档中，将第一张缩为 50%、右对齐并设置标题，保存源码含 ratio=0.5、align=right、title=P1-IMAGE-TITLE，其余图片不变；安装重启后属性保持。
- 长文切换修复：原生安装版发现阅读/源码切换回到顶部。CodeMirror 的文档滚动恢复已移到异步语法加载前；阅读视图在文档布局及焦点恢复后恢复比例，并拒绝过期文档的恢复回调。用真实 Editor/CodeEditor 和从 main.ts 提取的切换函数检查 100 节文档，0.01、0.5、0.99 三处双向切换比例仅有像素取整误差，500 ms 后仍保持。最终 MSI 安装版在中部（约第 47～52 节）和末尾（第 97～100 节及结束标记）原生往返切换均保持位置，标题无未保存标记。
- 不支持回收的位置：Windows 后端分别验证普通 UNC 与扩展 UNC 拼写，均在调用 Shell 前拒绝回收。当前机器的 localhost/C$ 测试路径返回拒绝访问，未操作共享权限或网络凭据；这一项是实际 Windows 后端保护测试，不记作可访问网络共享上的原生弹窗回归。
- 最终 Rust 单元测试 30 项通过，3 项显式集成测试默认跳过。文件型测试需将 TEMP/TMP 指向项目内可写临时目录；执行环境默认临时目录以及一次普通临时目录配置均在创建测试文件时返回拒绝访问，改用项目内目录后全部通过。新增 UNC 拒绝测试无需创建共享或访问网络。
- 最终 MSI 补测：中文向导显示安装成功并启动应用。候选 MSI SHA-256 为 `aa87a3cecb79d6ee4520666c5344ce5611d3dc0a0af3b056f102da5125c74274`；已安装 EXE 与该 MSI 内嵌文件均为 `7cf0411a5879569e0481c9568670ff8c5d939b3fb4880d3509123f6f7fdc952b`。便携 EXE 的包类型标记不同，按自己的校验和与更新签名核对。
- 最小化/恢复原生补测：用应用最小化按钮最小化，工具确认窗口为 minimized；在独立回归目录新增 `00-minimize-restore-check.md`，恢复后文件树立即显示它，活动长文仍位于末尾。隐藏期间零目录读取由上面的组件计数验证，未将桌面截图解释为原生系统调用计数。
- 无权限删除原生补测：在本次安装目录选择 `Uninstall PaperNest.lnk`，确认目标为 1 个文件后尝试移入回收站。应用内显示操作失败、没有回退永久删除，错误码为 `0x80270021`（Windows SDK `sherrors.h` 中的 `COPYENGINE_E_ACCESS_DENIED_SRC`）。文件保留，删除前后 SHA-256 均为 `d447ad92d0e0292a63bc40788f2be3352e58e83666e5704a873b87fb27596f93`；未修改目录权限。
- 发行草稿准备：候选源码提交 `7e23e1d` 已上传到独立分支 `codex/windows-release-0.1.0`，远端默认分支未改动。六个 Windows 发行文件上传到 GitHub 草稿后，逐项比对 GitHub 资产 digest、size 与 uploaded 状态，均与本地验签产物一致；图片预览手势反馈仍待确认，未公开发布。私钥未进入源码或发行文件。
- 图片预览补测：最终安装版在多图文档打开第一张图片的预览，按 Esc 后遮罩关闭、文档与标签保留，再点击图片工具栏的预览按钮可重新打开。Ctrl+滚轮和按住右键拖动仍待原生手动反馈；桌面插件更新后的公开 API 仍不支持组合按住操作，没有用普通滚动或左键拖动代替这两项。
- 实际 WebView2 手势补测（2026-10-05）：通过仅传给测试进程的 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS，在回环地址启用临时 CDP，Playwright CLI 连接已安装程序的 `tauri.localhost` 页面。未加载开发服务器或替换应用代码。图片初始为 256×256、scale(1)；按住 Ctrl 滚轮后为约 286.72×286.72、scale(1.12)，按住右键移动后为 translate(50px, 40px)。松开 Ctrl 后滚轮未改变变换，Esc 正常关闭；窗口截图已核对放大和平移结果。此前记录的手动反馈缺口由本次实际安装版操作补齐。
- 最终设置修复与安装复测（2026-10-05）：启动控制台发现隐藏设置控件提前读取未加载设置，现已给该帧回调增加面板打开条件。重新构建的 EXE/MSI 均通过内嵌公钥验签及篡改拒绝检查，MSI 同版本升级返回 0；安装程序与 MSI 内嵌程序 SHA-256 均为 `c23d5097539dc83ce76aea57702c9cf6e44f9c1d0d901c9dbc06f57b83b3ef5e`。新安装版启动和打开设置面板后控制台均为 0 错误、0 警告，代理控件正常显示；同一新安装版重复 Ctrl+滚轮、右键拖动、普通滚轮不缩放及 Esc 关闭，结果与上项一致。测试后正常关闭应用，临时调试端口已不再监听。最终便携 EXE SHA-256 为 `a3212143c04a95010016b2feadc44b69426762a31104c765d5ff1137133e17ab`，MSI 为 `9bd6da946e7dcd3ccb8582299b90efcb7c221bf2973a97af41c8fadc825d4ea8`；此前候选包哈希只对应当时的测试产物。

- Windows 正式发行核对（2026-10-05）：[v0.1.0](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.1.0) 已公开发布为最新正式版本，发行标签指向 `e7117e09c500722ab0bfd92b449b48b6594418a7`，源码位于 `codex/windows-release-0.1.0`，默认分支未改动。六个最终产物的 GitHub digest、大小和上传状态与本地相同；公开发布后重新下载 EXE、MSI、两份签名、latest.json 和 SHA256SUMS.txt，六项 SHA-256 均一致。匿名访问应用使用的 GitHub latest-release API、latest/download/latest.json 和元数据中的 MSI URL 均通过核对。签名私钥未进入源码或发行文件；产物具有更新签名，没有 Authenticode 证书签名。
- 云端打包配置说明：公开发行生成标签后触发的 [release 工作流](https://github.com/baihejiangnan/PaperNest/actions/runs/37274135173) 在签名密钥检查处停止，因为仓库尚未配置 `TAURI_SIGNING_PRIVATE_KEY`；构建和发布步骤未执行，没有覆盖上述本地构建并验签的已发布产物。以后若使用云端自动打包，须先按本文构建说明配置相同签名密钥；本次手动发行和下载核对已完成。

## UI 与弹窗回归

### Windows v0.1.6 发行构建（2026-10-08）

- 发行源码提交 `4757697e1898a631d15d388edc915ad7e3ff506d`，是 v0.1.5（`1f792a1`）后 main 的下一提交，内容为 v0.1.5 之后的全部功能改动加上一项仅忽略 `.workbuddy-ai/` 的提交（`.gitignore` 一行）。改动为未保存更改弹窗改为“保存／不保存／取消”、可选自动保存（`auto_save`，默认关闭）、列表符号默认 `-` 且保存时不再转义词内下划线、深色模式行内公式颜色跟随主题紫色；四处应用版本统一为 0.1.6，更新公钥、签名构建脚本与发行工作流未改变。
- 从该提交验证：`pnpm build` 通过（1178 个模块）；`pnpm test:code-text`、`pnpm test:tab-path`、`pnpm test:details-html`、`pnpm test:markdown-serializer` 四项通过；`cargo test --manifest-path src-tauri/Cargo.toml --locked --lib` 为 **45 项通过、3 项显式忽略、1 项失败**。失败项 `new_md::registry::tests::registration_preserves_defaults_and_other_writers` 在 `src-tauri/src/new_md.rs:474` 的 `RegKey::predef(HKEY_CURRENT_USER).create_subkey(...).unwrap()` 处返回 `Os { code: 5, kind: PermissionDenied }`，**在本执行环境中未通过，不记为通过**。判定为环境限制而非本轮回归的依据：`src-tauri/src/new_md.rs` 自 v0.1.4 提交 `96e0020` 起未改动（`git diff f2df3ac..4757697 -- src-tauri/src/new_md.rs` 为空），本次会话中整个 HKCU 写入被系统拒绝（`New-Item HKCU:\…` 与 `reg add HKCU\…` 均返回拒绝访问），把同一测试 EXE 复制到普通临时目录单独运行仍是 code 5。该限制与上文“Windows 系统‘新建 MD 文件’（2026-10-08）”记录一致。
- `pnpm release:windows` 退出码 0，末行 `Result: PASS (updater-signed Windows release + metadata + SHA256 checksums)`；前端类型检查与构建、MSI 关联生命周期动作检查通过，EXE 与 MSI 分别通过内嵌公钥验签及篡改拒绝测试（该测试在本次构建中对两个产物各执行一次），构建后无 tracked 改动。本次构建环境的两个既有阻塞与绕行方式：① 上一版残留的 `src-tauri/target/release/bundle/msi/PaperNest_0.1.5_x64_en-US.msi` 因继承的 `Everyone:(DENY)(DC)` 拒绝删除 ACE 无法删除（占用进程已确认并终止，`takeown`/`icacls`/`del` 均失败），故把 `target/release/bundle` 整体改名为 `bundle-held` 使其不在构建脚本的清理路径内，脚本自建 `bundle/`，未修改任何脚本、ACL 或系统权限；② 顶层 PATH 中某个 `pnpm.ps1` 兜底指向本机不存在的 `pnpm.cjs`／`node.exe`，仅对该构建进程从 PATH 移除该目录后 `pnpm`（含 `tauri-cli 2.11.4`）正常可用。
- [v0.1.6 正式发行](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.1.6) 已公开为 latest，附注标签 `45bf651dbb3eaca9a8252216d44630e5a214702e` 解引用为上述源码提交，main 与 `codex/windows-release-0.1.6` 均已推送。草稿阶段核对六项资产名称、uploaded 状态、大小与 GitHub digest 后公开；匿名下载六个文件，大小与 SHA-256 均与本地一致，公开副本通过 SHA256SUMS.txt 校验。匿名 latest-release API、latest/download/latest.json、元数据中的 MSI URL 与签名全部通过核对。latest.json 带 UTF-8 BOM，与 v0.1.5 已发布文件一致，SHA256SUMS.txt 为无 BOM、LF。
- 便携 EXE SHA-256：`9b1b59f9eb2b6e5084fd340d9b07dedd180558e579a2f40c895d202a2934590d`；MSI SHA-256：`7718d78fd8223546e97ce54474b665371a9bd0b6ee63656e2e516cfe3408e3eb`。其余文件哈希见 Release 的 SHA256SUMS.txt。
- 标签触发的 [release 工作流](https://github.com/baihejiangnan/PaperNest/actions/runs/37795106357) 在 `Require updater signing secret` 步骤因缺少 `TAURI_SIGNING_PRIVATE_KEY` 停止，构建与 publish 被跳过。本次通过现有本地密钥签名发布，没有上传私钥。产物具有应用更新签名，没有 Windows Authenticode 证书签名。
- 发行源码提交的日常 CI 在 [main](https://github.com/baihejiangnan/PaperNest/actions/runs/37792088122) 和 [发行分支](https://github.com/baihejiangnan/PaperNest/actions/runs/37792088124) 均通过。
- 未覆盖范围：三选一未保存弹窗与 `auto_save` 只完成构建、逻辑脚本和浏览器组件检查，**尚未在实际 WebView2 桌面窗口中操作**；本次发行构建不等于安装／升级／卸载回归。

### Windows v0.1.5 发行构建（2026-10-08）

- 发行源码提交 `1f792a136955cef94cffc3facd9dbf4d2cb4dcb3`，从 v0.1.4 后的 main（`cd2e35c`）快进。改动为 Markdown 折叠区块（GitHub 合并写法、`<details open>`，折叠／`<div align>` 改由 ProseMirror 装饰呈现）、移除关于页 Miku 彩蛋并将 `miku-cream.ts` 改名为 `editor-theme.ts`、中英文 README 重构与项目介绍页重设计；四处应用版本统一为 0.1.5，更新公钥、签名构建脚本与发行工作流未改变。
- 从该提交验证：`pnpm test:code-text`、`pnpm test:tab-path`、`pnpm test:details-html` 通过；`cargo test --manifest-path src-tauri/Cargo.toml --locked --lib` 为 45 项通过、3 项显式忽略。pnpm 运行前依赖检查仅在当前命令环境关闭，锁文件未变。`pnpm release:windows` 前端类型检查与构建、MSI 关联生命周期检查通过，EXE 与 MSI 分别通过内嵌公钥验签及篡改拒绝测试；构建后无 tracked 改动。折叠区块仅完成浏览器组件检查，未在 WebView2 桌面窗口中核对。
- [v0.1.5 正式发行](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.1.5) 已公开为 latest，附注标签解引用为上述源码提交，main 与 `codex/windows-release-0.1.5` 均已推送。草稿阶段核对六项资产名称、uploaded 状态、大小与 GitHub digest 后公开；匿名下载六个文件，大小与 SHA-256 均与本地一致，公开副本通过 SHA256SUMS.txt 校验。匿名 latest-release API、latest/download/latest.json、元数据中的 MSI URL 与签名全部通过核对。latest.json 带 UTF-8 BOM，与 v0.1.4 已发布文件一致。
- 便携 EXE SHA-256：`f3c918e60d43fcb19bbf6146087929a6d115bef42fa3789824a50d19bf47b853`；MSI SHA-256：`b41fbb2a49964ee4f9256c295a5ba742f326a96bb7631992d19677880708b7c5`。其余文件哈希见 Release 的 SHA256SUMS.txt。
- 标签触发的 [release 工作流](https://github.com/baihejiangnan/PaperNest/actions/runs/37754489626) 在 `Require updater signing secret` 步骤因缺少 `TAURI_SIGNING_PRIVATE_KEY` 停止，publish 被跳过。本次通过现有本地密钥签名发布，没有上传私钥。产物具有应用更新签名，没有 Windows Authenticode 证书签名。
- 发行源码提交的日常 CI 在 [main](https://github.com/baihejiangnan/PaperNest/actions/runs/37754489795) 和 [发行分支](https://github.com/baihejiangnan/PaperNest/actions/runs/37754489614) 均通过。

### Windows v0.1.4 发行构建（2026-10-08）

- 发行源码提交 `96e002018c125563978a9bcf190e27f026c183ba`，基于 v0.1.3 文档提交 `a4287bd` 快进。改动为 Markdown 文件树筛选（`.md`／`.markdown`／`.mdx`，含扫描预算与 30 秒昂贵结果缓存）、可拖动侧栏宽度、Windows 右键“新建 MD 文件”及配套文档；四处应用版本统一为 0.1.4，更新公钥、签名构建脚本与发行工作流未改变。用户确认 `.md` 无文件类型时补充 `PaperNest.NewMarkdown` 的行为可接受，并要求筛选包含 `.markdown`／`.mdx`。
- 从该提交验证：`pnpm test:code-text`、`pnpm test:tab-path` 通过；`cargo test --manifest-path src-tauri/Cargo.toml --locked --lib` 为 45 项通过、3 项显式忽略。pnpm 运行前依赖检查（无 TTY 时试图重装 node_modules）仅在当前命令环境关闭，锁文件未变。`pnpm release:windows` 前端类型检查与构建、MSI 关联生命周期检查通过，EXE 与 MSI 分别通过内嵌公钥验签及篡改拒绝测试；构建后无 tracked 改动。
- 构建脚本的 MSI 检查不覆盖新增动作，另行查询实际 MSI：`PaperNestUnregisterNewMdAction` 类型 82（即 `Return="ignore"`）、命令 `--papernest-msi-unregister-new-md`、序号 3498，位于关联清理 3499 与 RemoveFiles 3500 之前，条件为 `REMOVE~="ALL" AND NOT UPGRADINGPRODUCTCODE`。未执行实际 MSI 安装／升级／卸载。
- [v0.1.4 正式发行](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.1.4) 已公开为 latest，附注标签解引用为上述源码提交，main 与 `codex/windows-release-0.1.4` 均已快进推送。草稿阶段核对六项资产名称、uploaded 状态、大小与 GitHub digest 后公开；匿名下载六个文件，大小与 SHA-256 均与本地一致。匿名 latest-release API、latest/download/latest.json、元数据中的 MSI URL 与签名全部通过核对。latest.json 带 UTF-8 BOM，与 v0.1.3 已发布文件一致，SHA256SUMS.txt 为无 BOM、LF。
- 便携 EXE SHA-256：`6c8dbf7fe9d21979c773bc5a25cb62f9b678bbd28c150d25bffbca1a274d1e47`；MSI SHA-256：`5e6002dbb4a3a2f2bcf69255eda29d001e0bc85e9fc54fd1adc505b58264cb83`。其余文件哈希见 Release 的 SHA256SUMS.txt。
- 标签触发的 [release 工作流](https://github.com/baihejiangnan/PaperNest/actions/runs/37737572467) 在 `Require updater signing secret` 步骤因缺少 `TAURI_SIGNING_PRIVATE_KEY` 停止，publish 被跳过。本次通过现有本地密钥签名发布，没有上传私钥。产物具有应用更新签名，没有 Windows Authenticode 证书签名。
- 发行源码提交的日常 CI 在 [main](https://github.com/baihejiangnan/PaperNest/actions/runs/37737572158) 和 [发行分支](https://github.com/baihejiangnan/PaperNest/actions/runs/37737572364) 均通过。

### Windows v0.1.3 发行构建（2026-10-08）

- 接手时发行分支已有本地提交 `bf2730a5f4559a1372316867eaf91f54d2f374a8`，远端 main 仍为 `70d15ef7e995a546d3cf3611464b71a54a7718de`，不存在远端 v0.1.3 标签或 Release。审查该提交的 32 个文件，未发现删除已跟踪文件；改动属于文件树导航、导出与保存加固、设置备份提示、配套文档和 CI。额外的 `/.pnpm-store/` 忽略规则仅排除本地缓存，四处应用版本统一为 0.1.3；更新公钥、签名构建脚本与发行工作流均未改变。Git 与当前磁盘状态无法完整证明未跟踪文件的历史删除行为。
- 从该干净提交重新验证：`pnpm test:code-text`、`pnpm test:tab-path` 通过；`cargo test --manifest-path src-tauri/Cargo.toml --locked --lib` 为 40 项通过、3 项显式忽略。仅对当前命令设置仓库内 TEMP/TMP，未修改系统目录权限；pnpm 运行前依赖检查仅在当前命令环境关闭，构建未改变锁文件。`pnpm release:windows` 前端类型检查与构建、MSI 关联生命周期检查均通过，EXE 与 MSI 分别通过内嵌公钥验签及篡改拒绝测试。
- 文件树导航的实际 WebView2 17 项交互与布局检查见上文；导出、围栏保存与设置损坏提示沿用本轮已记录的桌面实测。发行构建不等同于重新安装／卸载检查；实际 PDF 输出、深色导出及 Linux/macOS 继续保留待办。
- [v0.1.3 正式发行](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.1.3) 已公开为 latest，附注标签指向上述源码提交，main 与 `codex/windows-release-0.1.3` 均已快进推送。先上传草稿核对六项资产名称、uploaded 状态、大小与 GitHub digest，再公开发布；匿名下载六个文件，大小与 SHA-256 均与本地一致。匿名 latest-release API、latest/download/latest.json、元数据中的 MSI URL 与签名全部通过核对。
- 便携 EXE SHA-256：`eb595623e34e91f4c9fb0796a565fe8b5b59fb9c8dfd4efc8d0ddf63a2e35e48`；MSI SHA-256：`1809dbd3af233b06231758d55e117b30d0e7454dac4dbdd1066e31b3cdcee9b6`。其余文件哈希见 Release 的 SHA256SUMS.txt。旧版本带版本号的本地产物保留，上传仅包含本次六项文件。
- 标签触发的 [release 工作流](https://github.com/baihejiangnan/PaperNest/actions/runs/37722766645) 在 `Require updater signing secret` 步骤因缺少 `TAURI_SIGNING_PRIVATE_KEY` 停止，构建／发布步骤未运行。本次通过现有本地密钥签名发布，没有上传私钥到 GitHub。产物具有应用更新签名，没有 Windows Authenticode 证书签名。
- 发行源码提交的日常 CI 在 [main](https://github.com/baihejiangnan/PaperNest/actions/runs/37722766727) 和 [发行分支](https://github.com/baihejiangnan/PaperNest/actions/runs/37722766730) 均通过：锁定依赖安装、前端类型检查与构建、两个前端逻辑脚本及 Rust 测试全部成功。此结果与缺密钥停止的 release 工作流分别记录。

### Windows v0.1.2 发行构建（2026-10-07）

- 用户确认本轮界面检查没有问题并授权推送、发布。该确认与上述浏览器组件自动检查分别记录，不将其计为安装／卸载自动测试。设置界面桌面待确认项已关闭，其他明确列出的平台验证范围继续保留。
- 应用版本统一升为 0.1.2，继续使用现有更新签名公钥与本地私钥构建 Windows 便携版、MSI 和更新元数据；签名凭据不进入源码或发行文件。前端构建、文本与标签路径检查通过；Rust 默认检查 31 项通过、3 项显式集成检查跳过。EXE 和 MSI 分别通过内嵌公钥验签与篡改拒绝检查，MSI 关联生命周期动作检查通过。
- 六个产物已生成：便携 EXE、MSI、两份 `.sig`、latest.json 和 SHA256SUMS.txt。便携 EXE SHA-256 为 `a5d00f06140ac9db6cb4de135629fd035a318d7d79df5052837f45306550668c`，MSI 为 `65462a0c62e49151a33c063084c076cab88c921866ea3985435ae2e51f698355`。本机新版 pnpm 的自动依赖重装检查通过单次命令环境关闭，构建使用原锁定依赖，未改变依赖清单。
- 公开发行及下载核对：[v0.1.2](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.1.2) 已发布为最新正式版本，标签指向源码提交 `def166dd920db261e719c5c469b3a9226bbc5406`；源码已推送到 main 和 `codex/windows-release-0.1.2`。六个资产的 GitHub digest、大小与 uploaded 状态均一致；匿名下载全部六文件后 SHA-256 均与本地产物一致。应用使用的 latest-release API 与 latest/download/latest.json 均返回 0.1.2，元数据中的 MSI URL 和签名与本地一致。
- 标签触发的 [CI 构建](https://github.com/baihejiangnan/PaperNest/actions/runs/37569271857) 在要求 `TAURI_SIGNING_PRIVATE_KEY` 的步骤停止，构建和发布均未执行，没有覆盖本地签名并验签后上传的资产。云端自动构建仍需配置与应用内嵌公钥匹配的签名密钥；本次手动发行、公开下载及更新入口核对已完成。产物具有更新签名，没有 Authenticode 证书签名。

### Windows v0.1.1 发行构建（2026-10-05）

- 将 package.json、Tauri 配置、Cargo.toml 与 Cargo.lock 的应用版本统一为 0.1.1，保留现有更新公钥。前端类型检查及构建、Code 文本和标签路径检查通过；Rust 默认测试 31 项通过，3 项显式集成测试跳过。测试临时目录设置为工作区可写目录，避免受限环境的系统临时目录权限错误。
- `pnpm release:windows` 生成便携 EXE、MSI、两份更新签名、latest.json 和 SHA256SUMS.txt；MSI 关联生命周期动作及顺序检查通过，两个产物使用应用内嵌公钥验签通过，修改产物字节后的验签均被拒绝。便携 EXE SHA-256 为 `c93c9eea3b0fcd211d22f35899b846ef640f06a3494e3ffd99ff86534e53d30f`，MSI 为 `f6140c73153ca771df59f179c4b06cf6512b33962c3e9d918db330790c1ba536`。
- 本次变更的桌面与浏览器检查范围见上述标签页、资源管理器及下述通知记录；没有将 v0.1.0 的安装/卸载结果记为 v0.1.1 新安装测试。通知剩余桌面检查仍在 TODO 中保留。仓库尚未配置云端签名密钥，本次使用本地签名构建，产物没有 Authenticode 证书签名。
- 公开发行及下载核对（2026-10-06）：[v0.1.1](https://github.com/baihejiangnan/PaperNest/releases/tag/v0.1.1) 已公开发布为最新正式版本；标签及发行源码指向 `605d8bc38e322600d05dae51c41b35d9d23af192`，源码已正常推送至远端 main 和 `codex/windows-release-0.1.1`。六个 GitHub 资产的 digest、大小和 uploaded 状态与本地一致；匿名下载全部六文件后 SHA-256 均一致，应用使用的 latest-release API、latest/download/latest.json 及元数据中的 MSI 下载入口检查通过。
- 标签触发的 [CI 构建](https://github.com/baihejiangnan/PaperNest/actions/runs/37337295013) 在要求 `TAURI_SIGNING_PRIVATE_KEY` 的步骤停止，未执行构建和发布，没有覆盖本地验签后上传的六个文件。自动构建仍需配置与现有更新公钥匹配的签名密钥；本次手动发行和公开下载核对已完成。

- 通知桌面基本检查（2026-10-05）：以独立的 `com.baihejiangnan.papernest.desktop-preview` 标识构建最新 debug 程序（`tauri build --debug --no-bundle`，离线锁定依赖），正常关闭并更新原测试实例，原会话恢复为 `package.wxs`。在实际 WebView2 文件树中点击 `Icon/ProductIcon`，顶部居中的琥珀色提示显示，原文档保留，未出现“操作失败／知道了”确认框；随后提示自行消失，再次点击可重新显示。测试窗口保留给用户查看。本次未生成或替换正式 MSI；深浅／系统主题、窄窗口和更多打开入口仍按清单继续验证。

- 无法预览的琥珀色胶囊通知：`pnpm build` 通过；浏览器加载实际 `preview-notice.ts`、`i18n.ts`、主题 CSS，以及从 `main.ts` 提取的 `readPath` / `wireShortcuts`，使用模拟 IPC 完成 23 项组件检查。覆盖格式与编码失败分流、无权限和不存在错误保留、过期错误忽略、未知扩展名文本与图片读取、不抢焦点、焦点暂停及恢复、真实 4 秒消失、连续失败复用与重置、文件名安全显示、顶部居中、Esc 优先关闭通知及悬停暂停／恢复；浅色与深色组件截图已核对。这是前端组件验证，尚未重新打包或在桌面 WebView2 中复测本次通知变更。

- 检查浅色、深色、跟随系统切换，含 Markdown、代码隔行与语法高亮；关闭重启及外部编辑 settings.toml 后保持设置。
- 确认未保存修改、启动错误、更新提示均为应用内弹窗；系统文件选择器仍用于打开与另存为。
- 删除文件与目录时核对数量、已保存 Markdown 引用列表、来源跳转、红色按钮；检查取消/Esc/关闭/遮罩均不删除或保存“不再询问”。
- 勾选“不再询问”后完成删除，再检查其持久化、设置恢复和未保存提示仍保留。统计失败时删除应禁用，统计不全应明确标注。
- 使用临时文件和含子文件的目录确认移入系统回收站，再从回收站恢复并核对内容。检查锁定文件、无权限目录及不支持回收站的位置：应报错并保留原内容，不能回退到永久删除。
- 键盘检查 Tab/Shift+Tab 循环、关闭后焦点恢复、设置标签箭头切换、快捷键捕获的 Esc 与嵌套消息；在窄窗口与低高度窗口确认滚动、按钮和关闭入口可见。
- 本次前端构建、Rust 单元测试及 Windows 锁定文件保留测试通过；永久删除意图的回调拦截已验证。受限执行环境中的回收站集成测试仍默认跳过；正常桌面权限下的真实文件/目录移入、恢复、WebView2 无额外系统反馈及删除确认设置持久化已通过上面的 P1 操作核对。未修改目录权限。Linux/macOS 行为仍需对应系统实机回归。
