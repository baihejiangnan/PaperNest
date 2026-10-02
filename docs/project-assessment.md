# 项目评估与改进方案

> 此文保留评估时点的审查候选问题，尚未逐项复现，不是本次发行检查的完成清单。后续源码、性能测量和 Windows 回归状态以 [性能基线](performance-baseline.md)、[开发说明](development.md) 和 [TODO](../TODO.md) 为准；其中 Linux/macOS 发行已暂定。

评估依据：2026-10-01 对当前工作区源码（含未提交改动）的只读审查，覆盖 `src/`、`src-tauri/`、构建脚本、CI 与文档。已执行的检查：

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | 通过，无类型错误 |
| `vite build` | 通过；主 chunk 1,886 kB（gzip 592 kB），CSS 140 kB，`dist/` 共 4.8 MB |
| `cargo clippy --all-targets` | 0 error，8 warning（均为风格类） |
| `cargo test` | 29 通过，2 ignored（需真实回收站的 Windows 测试） |

以上检查在 Windows 主机上执行，macOS/Linux 条件编译分支未经编译验证。下文性能结论来自代码路径分析，**均未实测**；实施前应按 [性能改进实施方案](performance-review-proposals.md) 的测量方法记录基线。该文档已完成的四项（编辑回调复用文本、会话恢复单次读取、搜索过期查询失效、图片工具栏同步）不在此重复。

---

## 1. 总体评价

| 维度 | 评价 | 说明 |
| --- | --- | --- |
| 功能完整度 | 良 | 阅读、编辑、文件树、导出、更新、多语言齐备，产品定位清晰 |
| 安全 | **差** | CSP 关闭、导出 HTML 未清洗、打印 iframe 未隔离，叠加文件命令无路径范围，打开不可信文档存在任意文件读写风险 |
| 数据可靠性 | 中 | 保存非原子写；设置解析失败会静默回退默认值并在下次保存时覆盖 |
| 跨平台 | 中下 | 主要在 Windows 验证；前端路径逻辑写死 `\`，macOS 文件关联与"在 Finder 中显示"不可用 |
| 性能 | 中 | 主包未拆分；多数 Rust 命令为同步命令，在主线程执行；每次按键仍有多处全文扫描 |
| 可维护性 | 中 | `main.ts` 2,400 行承担几乎所有协调职责；路径、i18n、校验逻辑多处重复 |
| 工程化 | 差 | 无前端测试、无 lint/format、CI 仅在发版时运行，PR 无任何检查 |

---

## 2. 问题清单

优先级：**P0** 安全或数据丢失，应尽快修复；**P1** 明显的功能缺陷或性能瓶颈；**P2** 可维护性与体验改进。

### 2.1 安全

**S1（P0）打开恶意 Markdown 后导出 PDF，文档中的脚本可调用全部后端命令**

- [tauri.conf.json](../src-tauri/tauri.conf.json) `"csp": null`，未设置任何内容安全策略。
- [export.rs:26](../src-tauri/src/export.rs#L26) `opts.render.r#unsafe = true`，原始 HTML（`<script>`、`onerror=`）原样输出，也未开启 tagfilter。
- [main.ts:1284](../src/main.ts#L1284) 用 `frame.srcdoc = html` 打印，iframe 无 `sandbox`。srcdoc 页面与父窗口同源，脚本可通过 `parent.__TAURI_INTERNALS__.invoke` 调用 `write_document`、`read_document` 等命令。

方案：

1. 打印 iframe 加 `sandbox="allow-scripts allow-modals"`，不给 `allow-same-origin`，并验证 KaTeX 渲染与打印仍可用。
2. 导出 HTML 使用 `ammonia` 清洗，至少开启 comrak `extension.tagfilter`。
3. 设置 CSP：`default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'`。导出模板中的内联脚本用 hash 放行。逐项回归 Milkdown、CodeMirror 和 KaTeX 渲染。

**S2（P0）文件类 IPC 命令接受任意绝对路径**

[commands.rs](../src-tauri/src/commands.rs) 的 `read_document`、`write_document`、`rename_document`、`read_image_data_url`，以及 [workspace.rs](../src-tauri/src/workspace.rs) 的列目录、搜索、新建、复制、重命名、删除命令，均不校验路径范围。只有 `delete_info.rs` 校验了 root，真正执行删除的 `delete_workspace_entry` 并不校验。

方案：在 `AppState` 中维护一份按窗口区分的允许访问集合。集合只能由对话框选择、命令行参数、文件关联和文件拖放加入。所有文件命令先 `canonicalize`，再用 `starts_with` 判定。前端行为不变，只是越界路径会被拒绝。

**S3（P0）图片读取等同于任意文件读取，导出时会把敏感文件内联进 HTML**

[assets.rs](../src-tauri/src/assets.rs) 的 `to_data_url` 遇到未知类型时返回 `application/octet-stream`。导出时，`inline_images` 会把 `![](~/.ssh/id_rsa)` 这类引用 base64 内联到 HTML，用户分享导出文件即泄露内容。

方案：只接受 `image_mime` 能识别的图片扩展名，并结合 S2 的路径范围校验。

**S4（P1）远程图片代理**

[proxy.rs](../src-tauri/src/proxy.rs) 的问题：

- 可请求 `127.0.0.1` 和内网地址（SSRF / 绕过 CORS）。
- 不校验 `Content-Type`。
- 没有 Content-Length 时，`response.bytes()` 会先把整个响应读入内存，之后才检查 24 MB 上限。

方案：要求响应为 `image/*`；拒绝回环、链路本地和私有网段地址；参照 `update.rs` 按块累加，超过上限即中断。

**S5（P2）其它**

- 原始 HTML 链接用 `javascript|data|vbscript` 黑名单过滤（[html-markdown.ts:36](../src/html-markdown.ts#L36)），可被实体编码绕过。改为 http/https/相对路径白名单。
- 发布版仍开放 `core:webview:allow-internal-toggle-devtools`。
- 更新签名校验允许 legacy 签名，且未与版本号绑定，理论上存在降级风险。

### 2.2 数据可靠性与正确性

**D1（P0）保存不是原子写**

文档保存（[commands.rs:125](../src-tauri/src/commands.rs#L125)）和设置保存都直接调用 `std::fs::write`，崩溃、断电或磁盘满时文件可能被截断。`update.rs` 中已有 `write_atomic`。

方案：抽出公共的 `fs_util::write_atomic`：同目录临时文件 → `sync_all` → `rename`，并保留原文件权限。文档和设置统一使用。

**D2（P1）设置文件解析失败时静默使用默认值**

[settings.rs](../src-tauri/src/settings.rs) 的 `load()` 解析失败后返回默认设置。用户手改出语法错误后，下一次自动保存会用默认值覆盖整个文件。

方案：解析失败时先把原文件备份为 `settings.toml.bak`，在应用内提示错误位置，并在用户确认前暂停自动写回。

**D3（P1）退出流程可能卡死**

[main.ts:2021](../src/main.ts#L2021) `quitApp` 置 `closing = true` 后，如果 `captureGeometry` 或 `flushSettings` 抛错，`closing` 不会复位，窗口再也无法关闭。

方案：用 `try/finally` 保证无论如何都执行 `win.destroy()`。

**D4（P1）其它竞态与未处理异常**

- `openPath` 没有请求令牌，同一路径快速打开两次会产生重复标签。
- `settings-changed` 回调无条件调用 `applyProxySettings(true)`（[main.ts:2312](../src/main.ts#L2312)），每次外部编辑设置都会重建 Crepe，丢失撤销历史和光标。
- 设置监听存在竞态：先写文件、后记录 `last_write`，watcher 可能把应用自己的写入当成外部修改。
- 以下调用没有错误处理：`exportPdf`、`usePreparedVersion`、`persistSoon`。

方案：

- `openPath` 改为按路径合并进行中的请求。
- 仅在代理配置实际变化时重载编辑器。
- 写设置前先记录预期签名。
- 增加全局 `unhandledrejection` 处理，统一弹出应用内错误提示。

**D5（P1）表格格式化误改内容**（[mdfmt.rs](../src-tauri/src/mdfmt.rs)）

- 不跟踪代码块状态，代码块内类似表格的行会被重排。
- 无扩展名文件（LICENSE、Makefile）被当作 Markdown 格式化。
- 扩展名区分大小写，`.MD` 不会被格式化。
- CRLF 文件会出现混合换行。
- 列宽用字符数计算，中日韩全角字符无法对齐。

方案：

- 跟踪 ``` / `~~~` 栅栏状态。
- 仅对 `.md` / `.markdown`（不区分大小写）格式化。
- 保留原换行风格。
- 用 `unicode-width` 计算列宽。
- 为以上每种情况补测试。

**D6（P1）编码与大文件**

- 只支持 UTF-8：GBK/GB18030 文件报错，UTF-16 被判为二进制，对中文用户影响明显。
- `read_document` 不限文件大小，几百 MB 的日志会被整串经 IPC 传给前端。

方案：

- 用 `encoding_rs` 加 BOM 检测，读取时识别编码，保存时写回原编码。
- 设置大小阈值，例如超过 10 MB 时提示并以只读 Code 模式打开，超过 100 MB 时拒绝。

**D7（P2）其它**

- 只改大小写的重命名（`a.md → A.md`）在大小写不敏感的文件系统上会报"已存在"。
- `get_settings` 每次重读 `std::env::args()`，刷新页面会再次打开启动文件。
- 大纲按正则逐行识别标题，跳转时却按 DOM 中 `h1–h6` 的序号定位。遇到 Setext 标题、列表或引用中的 `#`、HTML 标题时会跳错。WYSIWYG 模式应直接从 ProseMirror 文档取 heading 节点。
- `lib.rs` 残留 `eprintln!("P0 trace…")` 调试输出。

### 2.3 跨平台

**X1（P0）前端路径逻辑写死 Windows 分隔符**

[main.ts:636–666](../src/main.ts#L636) 用 `` startsWith(`${source}\\`) `` 加 `toLowerCase()` 判断子路径。在 macOS/Linux 上重命名或删除文件夹时：

- 子文件的标签不会更新路径；
- 删除前不会提示未保存修改；
- 之后保存会写回已删除的路径。

`tabs.ts`、`workspace-sidebar.ts` 中的 `pathKey` 在 Linux 上会把 `A.md` 和 `a.md` 视为同一文件。

方案：新建 `src/paths.ts`，统一实现 `pathKey`、`isWithin`、`parentOf`、`baseName`。分隔符和大小写规则按平台决定（由后端 `get_settings` 返回平台信息），并替换各处重复实现。

**X2（P1）macOS 集成缺失**

- 双击 `.md` 只会启动应用、不会打开文件：[lib.rs](../src-tauri/src/lib.rs) 只从 argv 读取文件，没有处理 `RunEvent::Opened { urls }`。
- "在 Finder 中显示"不可用：[workspace.rs](../src-tauri/src/workspace.rs) 在所有非 Windows 平台都调用 `xdg-open`，macOS 应使用 `open -R <path>`。

**X3（P1）更新与签名只覆盖 Windows**

`release.yml` 只给 Windows job 注入签名私钥，`latest.json` 只写入 `windows-x86_64`，macOS 构建带 `--no-sign`。需要做出选择：要么补齐 macOS/Linux 的签名与更新清单，要么在 README 中明确说明自动更新仅支持 Windows。

**X4（P2）副窗口 WebView 数据目录只增不减**

每个副窗口按时间戳新建一个数据目录且从不清理，磁盘占用持续增长。改为窗口关闭时删除，或复用固定数量的目录。

### 2.4 性能

**P1-a 主包体积（预期收益：启动解析时间）**

主 chunk 1.9 MB，`vite.config.ts` 的 `chunkSizeWarningLimit: 2000` 让这一回归不可见。Crepe 的全部默认功能（含 Vue 运行时、KaTeX）都被静态导入，设置面板、更新流程、emoji 选择器、导出也在启动时同步加载。KaTeX 字体的 woff2/woff/ttf 三种格式全部打包。

方案：

1. 在 Crepe 的 `features` 中关闭未使用的功能。
2. `settings-panel`、`emoji`、更新、导出改为 `import()` 懒加载。
3. 用 `manualChunks` 把 milkdown、katex 拆为独立 chunk。
4. KaTeX 字体只保留 woff2。
5. 把 `chunkSizeWarningLimit` 降到 800，作为体积预算。

**P1-b 同步 IPC 命令阻塞主线程**

以下命令都是同步 `#[tauri::command]`，执行时会卡住界面：

- `read_document`、`write_document`（含表格格式化）
- `search_workspace`（最多遍历 10,000 个目录）
- `list_workspace_dir`
- `read_image_data_url`（最大 24 MB 加 base64）
- `render_html`
- 设置读写

方案：全部改为 `async fn` + `tauri::async_runtime::spawn_blocking`。这是低风险、高收益的机械改动。

**P1-c 每次按键的全文工作**

| 位置 | 每次变更的开销 | 方案 |
| --- | --- | --- |
| 代码块行号 `MutationObserver`（[editor.ts:102–189](../src/editor.ts#L102)） | 对所有代码块的每一行调用 `getBoundingClientRect`，强制同步布局 | 只重算发生变化的代码块；先批量读、再在下一帧批量写 |
| `safeHtmlPresentationPlugin`、`refreshSafeRawHtml`、`resolveRawHtmlImages`（[html-markdown.ts](../src/html-markdown.ts)） | 对全文 `descendants`，并为每个 html 节点重新解析 | 按 `tr.mapping` 和变更范围增量更新 |
| 字数统计（[text-stats.ts](../src/text-stats.ts)） | 对全文 `textBetween`，每个字符跑两次 Unicode 正则 | 改用 `requestIdleCallback` 或 300 ms 防抖；统计面板不可见时跳过 |
| 大纲（[workspace-sidebar.ts:428](../src/workspace-sidebar.ts#L428)） | 每次 split 全文、跑正则并重建 DOM，侧栏隐藏时也照做 | 侧栏不可见时跳过；标题列表不变时不重建 DOM |
| 查找（[find.ts:118–131](../src/find.ts#L118)） | 每次 docChanged 和每次上一个/下一个都全量 scan | 用 mapping 映射已有匹配；切换匹配时只改 active 装饰 |

**P1-d 图片传输与内存**

- 图片以 base64 data URL 经 JSON IPC 传输，24 MB 图片会变成约 32 MB 字符串。
- 每个标签保存 `saved` 和 `content` 两份全文。
- `Editor.imageCache` 是无上限的 Map。

方案：

- 注册异步自定义 URI scheme（例如 `papernest://`），后端在 S2 的路径范围内流式返回图片字节，前端改用 URL 引用。
- `imageCache` 改为 LRU，或在改用 URI scheme 后直接去掉。

**P2 其它**

- 文件树每次全量 `replaceChildren`，每一行都单独绑定监听器并重新解析 SVG。
- 展开的目录每 2.5 秒串行轮询一次。
- `search_workspace` 不跳过 `node_modules`，`delete_info` 却跳过，两边不一致。

方案：

- 文件树改用事件委托，缓存 SVG 节点。
- 中期用 `notify` crate 监听文件变化并推送事件，代替轮询。
- 统一搜索与删除统计的排除规则。

**P2 Rust 依赖瘦身**

- `comrak` 默认 features 引入了 syntect、onig、clap，后端用不到，应设 `default-features = false`。
- `reqwest` 同时拉入 native-tls 和 rustls，应统一为 `rustls-tls`。

预期可减少二进制体积和编译时间，需以 `cargo bloat` 前后对比确认。

### 2.5 可维护性

- **M1 `main.ts` 职责过多**：2,402 行，含 28 个顶层可变状态和 66 处 `getElementById`；"放弃修改"确认对话框重复 4 次，`editor.reload().then(...)` 重复 3 次。按领域拆分为：
  - `document-controller`：标签、视图、保存
  - `window-state`
  - `updater`
  - `export`
  - `tab-menu`
  - `paths`

  `settings` 改为带订阅的 store，`settings-changed` 不再手工逐字段复制。
- **M2 两套 i18n**：`workspace-sidebar.ts` 自带四语词典，通过 `document.documentElement.lang` 判断语言，与 `i18n.ts` 的类型化 key 体系分离。另有硬编码英文（[main.ts:618](../src/main.ts#L618)、`main.ts:943`）。统一并入 `i18n.ts`。
- **M3 依赖 Milkdown 内部结构**：`html-markdown.ts`、`image-block-markdown.ts`、`markdown-serializer.ts` 在运行时改写 schema 的 `toDOM`/`parseDOM`，共 11 处 `any`。保持版本精确锁定，并用往返测试兜底（见 2.6）。
- **M4 Rust 重复代码**：
  - Windows `\\?\` 前缀剥离写了 3 遍。
  - 图片 MIME 映射写了 2 遍。
  - 已依赖 `base64` crate，却又手写了一份 base64。
  - 两套文件名校验规则不一致。
  - Markdown 扩展名判断散落在 3 处。

  统一抽到 `fs_util.rs`。
- **M5 文档维护**：
  - [ARCHITECTURE.md](../ARCHITECTURE.md) 对 CI 的描述过时：文档写 5 个 target、`tauri-action`、draft，实际是 4 个 target、自写脚本、`draft: false`。
  - `CODE_MODE_REFACTOR_PLAN.md` 已过时，建议移到 `docs/history/`。
  - `development.md` 末段混入了一次性执行记录。
  - `proxy.rs` 中的 USER_AGENT 写死为 `PaperNest/1.7`，与 0.1.0 不符。

### 2.6 工程化

- **E1（P0）仓库状态**：
  - 外层 `PaperNest/` 是一个没有任何提交的空 git 仓库，容易在错误的根目录执行 git 或 pnpm 命令。
  - `recycle.rs`、`delete_info.rs`、`dialogs.ts`、`modal.ts`、`ui-theme.css` 等已被代码引用的文件尚未提交，按当前 HEAD 打 tag 会构建失败。
  - `.gitignore` 缺少 `.build-tmp/`、`.playwright-cli/`、`/output/`。
- **E2（P0）CI 不检查 PR**：只有 `release.yml`，由 tag 触发，发版流程中也不运行 `cargo test`。
- **E3（P1）前端零测试**：最容易回归的纯逻辑完全没有覆盖，包括 Markdown 往返、HTML 图片、查找、统计、路径工具。`output/playwright/verify.cjs` 写死了本机路径，无法在他处复现。
- **E4（P1）缺少 lint/format**：没有 ESLint、Prettier 和 rustfmt 检查，代码风格不统一。
- **E5（P2）工具链声明**：
  - 缺少 `packageManager`、`engines` 字段：CI 用 Node 24 + pnpm 12，文档写的是 Node 20+。
  - Tauri 的 JS 包是 `^2`，Rust crate 是 `"2"`，两端小版本可能不一致。
  - `build-release-unix.mjs` 不校验三处版本号是否一致，PowerShell 脚本会校验。

---

## 3. 实施路线

每阶段内的条目相互独立，可分别提交、分别回退。

### 阶段 0：仓库与 CI 基线（约 1 天）

1. 删除外层空仓库的 `.git`（或把 `.pnpm-store`、测试数据移出），补齐 `.gitignore`，提交所有已被引用的未跟踪源码。
2. 新增 `.github/workflows/ci.yml`，在 PR 和 push 到 main 时运行，覆盖 Windows 和 Linux 两个 runner：
   - `pnpm install --frozen-lockfile`
   - `pnpm build`
   - `cargo fmt --check`
   - `cargo clippy --all-targets -- -D warnings`
   - `cargo test`
3. 先修掉现有的 8 个 clippy warning，并执行一次 `cargo fmt`（单独提交，便于审阅）。
4. `release.yml` 在打包前运行 `cargo test`；unix 发布脚本补上版本一致性校验。

**验收：** 新 PR 自动运行检查并显示结果；从干净 clone 检出 HEAD 能构建成功。

### 阶段 1：安全与数据安全（约 3–5 天，P0）

| 顺序 | 条目 | 关键验收 |
| --- | --- | --- |
| 1 | S1：iframe sandbox + 导出清洗 + CSP | 含 `<script>`、`<img onerror>` 的 Markdown 导出 HTML/PDF 时不执行脚本；正常文档的公式、代码高亮、图片导出结果不变 |
| 2 | D1：原子写 | 写入过程中强制终止进程，原文件保持完整；保存后文件权限不变 |
| 3 | S2 + S3：路径范围 + 图片扩展名限制 | 越界路径和非图片文件被拒绝；文件树、拖放、文件关联、会话恢复、相对图片与链接仍正常 |
| 4 | X1：`paths.ts` | 在 Linux/macOS 上重命名、删除文件夹时，子标签路径更新、未保存提示出现、标签关闭均正确 |
| 5 | D3：退出流程 try/finally | 模拟 `captureGeometry` 抛错后仍能关闭窗口 |
| 6 | D2：设置解析失败保护 | 写入语法错误的 settings.toml 后，原文件不被覆盖，且出现应用内提示 |

S2 改动面最大，需配合 [development.md](development.md) 的手动回归清单逐项执行。

### 阶段 2：性能（约 1 周，P1）

1. **P1-b** 同步命令改为 async + `spawn_blocking`。先做这一项：改动机械、风险低，可直接消除搜索、大图和导出时的界面卡顿。
2. **P1-a** 包体积：Crepe 功能裁剪、懒加载、拆分 chunk、只保留 woff2 字体、设置体积预算。
3. **P1-c** 每键全文工作：按"行号布局 → 大纲与统计 → 查找 → safe-html"的顺序推进，每项先测量再改。
4. **D6** 大文件阈值与编码识别。
5. **P1-d** 图片改走自定义 URI scheme（依赖阶段 1 的 S2）。

测量方法沿用 [性能改进实施方案](performance-review-proposals.md)。建议补充以下样本与指标：

| 场景 | 样本 | 指标 |
| --- | --- | --- |
| 冷启动 | 空会话 / 恢复 20 个标签 | 首次可交互时间、主线程长任务 |
| 输入 | 2 MB Markdown，含 50 个代码块 | 单次按键处理时间的 P50/P95、强制布局次数 |
| 搜索 | 含 `node_modules` 的大目录 | 搜索期间界面是否可响应、总耗时 |
| 图片 | 20 MB 图片 | 打开耗时、内存峰值 |

### 阶段 3：跨平台与正确性（约 1 周，P1）

- X2：处理 macOS `RunEvent::Opened`，"在 Finder 中显示"改用 `open -R`。
- X3：决定 macOS/Linux 的更新策略，并相应修改 CI 或 README。
- D4、D5、D7：竞态修复、表格格式化修复、大纲改从 ProseMirror 文档取标题。
- S4、S5：远程图片代理加固、链接白名单、发布版关闭 devtools。

**验收：** macOS 和 Linux 实机执行 [development.md](development.md) 的回归清单，结果与 Windows 分开记录。

### 阶段 4：可维护性与测试（持续）

1. 引入 Vitest + happy-dom，优先覆盖：
   - `paths.ts`
   - Markdown 往返：序列化选项、HTML 图片、图片块
   - `text-stats`、`find` 匹配逻辑
2. 引入 ESLint（typescript-eslint，开启 `no-floating-promises` 和 `no-explicit-any`）与 Prettier，接入 CI。
3. 按 M1 的领域划分逐步拆分 `main.ts`：每次迁出一个领域，行为不变，有测试兜底。
4. 合并两套 i18n；Rust 重复代码统一到 `fs_util.rs`；依赖瘦身。
5. 把 `output/playwright` 中的临时脚本迁移为正式的 `@playwright/test` 配置，对 Vite 前端加 IPC mock 做冒烟测试。
6. 文档整理（M5），并在 `package.json` 中声明 `packageManager` 和 `engines`。

---

## 4. 优先级速览

| 优先级 | 条目 |
| --- | --- |
| P0 | S1 导出脚本执行、S2 路径范围、S3 图片任意读、D1 原子写、X1 路径分隔符、E1 仓库状态、E2 CI |
| P1 | S4 代理、D2 设置覆盖、D3 退出卡死、D4 竞态、D5 表格格式化、D6 编码与大文件、X2 macOS、X3 更新签名、P1-a～d 性能、E3 测试、E4 lint |
| P2 | S5、D7、X4、文件树与轮询、Rust 依赖、M1～M5、E5 |

本方案中的问题均来自源码审查，尚未逐项复现；性能收益为预期值。完成一项后，按 [AGENTS.md](../AGENTS.md) 的约定同步更新 TODO、ARCHITECTURE 或 README。
