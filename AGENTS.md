# AGENTS.md — LuMusic 工程约定

面向 AI 编码代理与新成员的项目约定。**改动代码前请先阅读本文**；与 README.md 冲突时以本文为准。

## 项目概览

本地音乐播放器：**Rust (Tauri 2) + React 19 + Vite + zustand**，严格分层、零冗余依赖、行为必有测试。界面支持 简体中文 / English。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run check` | **完整质量门**：typecheck + vitest + cargo test，改动的收尾标准 |
| `npm run typecheck` | TS 严格模式双 tsconfig 检查（`tsconfig.json` / `tsconfig.node.json`） |
| `npm run test` / `test:watch` | 前端 vitest（jsdom） |
| `npm run test:rust` | 后端 cargo test |
| `npm run dev:mock` | 纯浏览器开发（内存 mock 数据，无需 Rust 工具链） |
| `npm run tauri dev` / `build` | 桌面应用调试 / 打包 |
| `npm run release` | 一键发版：release-it bump 版本（同步 tauri.conf/Cargo.toml/Cargo.lock）→ `chore(release)` 提交 → 推 `v*` tag，CI 随后打包并创建 GitHub Release |
| `npm start [-- --mock\|--build\|--check]` | 一键启动器（亦可用 `start.cmd` / `start.sh`） |

Windows 环境：shell 命令在 Git Bash 下执行，路径用正斜杠。

## 分层架构 — 依赖只能向下

### 前端 `src/`

```text
features/    UI 模块（library、player、playlists、settings、shell）
components/  通用 UI 基础件（Button、Slider、EmptyState…）
stores/      zustand store —— 所有后端调用必须经过 api/
api/         PlayerApi 接口 + tauri 实现 + mock 实现（UI 与后端的唯一接缝）
i18n/        locale store + en / zh-CN 文案词典
hooks/       事件桥（Tauri 事件 → store）
lib/         纯函数工具（如 formatDuration）
types/       与 Rust serde 对应的 DTO
```

**规则：**

- UI 代码**禁止**直接 `import '@tauri-apps/api/...'`；一律走 `@/api` 或 `@/api/window`（`windowApi` 在浏览器/测试中自动降级为 stub）。
- `@/api/mock.ts` 必须镜像后端可观察语义（搜索 AND 匹配、自动前进、同名播放列表覆盖等），保证组件测试与 `dev:mock` 永不触达 Tauri IPC。
- store 中不得出现 UI 逻辑；需要进入组件状态的数据流经 store（播放/曲库/播放列表），一次性读取（如 `settingsGet` / `appInfo`）可在组件 effect 中直接调 api。

### 后端 `src-tauri/src/`

```text
app/     薄 Tauri 命令 + PlayerService 编排 + poller 线程（自动前进/进度事件）
infra/   trait 之后的 IO 适配器：fs_scan(walkdir)、metadata(lofty)、
         audio(symphonia 解码 + rodio 输出)、persistence(JSON)
domain/  纯逻辑：Track、LibraryIndex、Queue（随机/循环规则）、Playlists、
         扫描规则、编码修复 —— 零 IO
```

**规则：**

- `domain/` 不允许任何 IO/异步；可测逻辑优先下沉到 domain。
- rodio 输出非 `Send`：音频引擎独占线程，经 channel proxy 暴露（`infra/audio/engine.rs`）。
- 扫描重阶段（遍历 + 读标签）不持服务锁，仅合并步骤短暂加锁，**扫描不阻塞播放**。
- 自动播放列表名（`All Tracks` / `Default`）由 `domain/scan.rs` 常量生成并持久化（同名覆盖语义），**后端始终存 canonical 英文名**。前端经 `@/lib/playlistDisplay` 按稳定 ID（`auto:all` / `auto:root`）做**显示层翻译**；不得把本地化名写回后端（重命名编辑器预填 canonical 名）。

## 测试规范

**铁律：任何行为变更必须附带钉住该行为的测试；`npm run check` 全绿才算完成。**

| 层 | 风格 |
| --- | --- |
| `domain` | 纯单元测试（固定种子的 shuffle、循环边界、修剪） |
| `infra` | 真实 fixture（`tempfile`/`hound`：WAV 解码、seek） |
| `app`（PlayerService） | mock scanner/metadata/persistence/**audio engine** |
| stores / hooks | vitest，在接缝处 `vi.mock('@/api', ...)`，store 状态用 `setState` 直播种 |
| components | testing-library 表达**用户行为**（双击播放、滑块 `change`+`pointerUp` 提交），定位优先 `data-testid` |

前端测试注意：

- 环境 jsdom；`vitest.setup.ts` 已桩掉 `ResizeObserver` 并给 `.track-body` 假尺寸——虚拟化表格依赖它，勿删。
- 跨 store 的组件测试（如 Sidebar）需同时 reset 相关 store 与 mock 的 `api`。
- 现有规模：**154 前端 + 135 后端**；新增行为时保持各层均有覆盖，而非只补一层。

## 工程约束

### 导入路径 — 强制 `@` 别名

- `@` → `src/`，配置在 `tsconfig.json`（`paths`）与 `vite.config.ts`（`resolve.alias`）。
- **禁止相对路径导入**：`../x`、`../../x`、同目录 `./x` 一律写成 `@/...`（如 `@/api`、`@/features/library/TrackTable`、`@/styles/global.css`）。
- 覆盖三类写法：`from '...'`、副作用 `import '...'`、以及测试里的 **`vi.mock('@/api', ...)` 字符串**。
- 新文件落位后，导入一律从 `@/` 起写。

### 国际化（i18n）

- **所有用户可见文案必须来自 `@/i18n` 词典，禁止在组件中硬编码字符串**（含 `aria-label`、`placeholder`、`title`）。示例文件路径 `C:\Users\me\Music` 这类 locale 无关字面量除外。
- 词典为扁平点分键（`library.searchPlaceholder`）；`en` 是源头，`zh-CN` 必须键集一致——`Record<MessageKey, string>` 类型强制，漏译/多译无法通过 typecheck。
- 参数插值用 `{count}` 风格；英文单复数用成对键（`trackCount` / `trackCountOne`），中文两键同值。
- 组件内用 `useTranslation()`（locale 切换自动重渲染）；store / 非组件模块用非响应式 `t()`。
- 语言检测优先级：localStorage（`lumusic.language`）> 系统 `zh*` → zh-CN > `en`；切换入口在设置页，同时持久化并同步 `<html lang>`。
- 已知边界（暂不翻译，勿“顺手”处理）：后端错误消息（需错误码改造）、自动播放列表的文件夹名（`auto:dir:*`，是用户数据名）。固定自动歌单（`All Tracks` / `Default`）例外——经 `@/lib/playlistDisplay` 按稳定 ID 做显示层翻译，存储名不变。

### 依赖与风格

- **零冗余依赖**：i18n 为自研（勿引入 i18next 等）；zustand/react-virtual 之外的新依赖需充分理由。
- TS `strict` 全开；无 ESLint/Prettier 配置，`npm run typecheck` 即静态门禁。
- 风格：单引号、分号、2 空格缩进、尾逗号；注释写"为什么"而非"是什么"。
- 提交信息：Conventional Commits，**只能使用英文**（标题与正文均不得出现中文，含示例名、文件名等一律英文），如 `feat(playlists): add context menu`、`fix(scan): follow symlinks`。

### 样式（CSS）

- 样式集中在 `src/styles/global.css`，颜色/圆角一律用 `:root` 设计令牌（`--bg-*`/`--fg-*`/`--accent*`），禁止硬编码色值。
- **原生 `<select>` 必须自绘箭头**：`appearance: none` + 内联 SVG 背景（参照 `.eq-select`）。WebView2 的原生下拉箭头不受 `padding-right` 影响、会紧贴右边缘；同时补 `:focus-visible` 边框高亮，与输入框一致。

### Non-goals（当前不做）

无缝播放、标签编辑、封面提取。遇到相关需求先确认范围。

（歌词已实现：`domain/lyrics.rs` 解析、`infra/lyrics.rs` 同名 `.lrc` 自动关联 + 编码修复、`features/lyrics` 渲染页，入口在播放模式按钮左侧。）

（均衡器已实现：`domain/equalizer.rs` RBJ biquad 设计 + 设置净化、`infra/audio/equalizer.rs` 实时滤波（`SharedEq` 代数计数，播放中换系数不重建 sink）、`features/player/EqualizerPanel` 弹出面板 + `lib/equalizer.ts` 内置预设，入口在歌词按钮右侧；配置持久化于 `settings.json` 的 `eq` 字段。）

（频谱已实现：`domain/spectrum.rs` 手写 radix-2 FFT + Hann 窗 + 对数频段聚合（24 柱，31Hz–16kHz，与 EQ 频段对齐）、`infra/audio/spectrum.rs` SPSC 无锁 tap（音频线程每采样仅原子写）+ 分析器、poller 50ms 分频（播放轮询/进度不变，频谱 ~20Hz 仅 Playing 发 `spectrum://frame`）、`features/player/SpectrumPanel` canvas 弹出面板（与 EQ 面板互斥，rAF 平滑、停播衰减归零），入口在 EQ 按钮右侧。）

（艺术特效已实现：`lib/artEffects.ts` 预设注册表 + localStorage 持久化（`lumusic.artEffect`，纯前端视觉偏好**不进后端设置**）、`features/player/ArtEffectsPanel` 预设选择弹窗（与 EQ/频谱弹窗三者互斥，点选即时预览不收起，入口 sparkles 按钮在频谱右侧）、`features/lyrics/artRenderers.ts` 五种 canvas 绘制器（极光/星空/气泡/粒子/波纹，确定性种子、面积缩放粒子数）+ `ArtBackground` 歌词页背景层（DPR≤2 自适应、rAF 循环、频谱帧平滑出能量驱动、帧过期即衰减；`off` 或页面关闭时不挂载、零开销）。）

（窗口状态已持久化：`domain/window.rs` 几何净化（低于 840×560 或荒谬值整体弃用）、`infra/persistence.rs` 增 `window.json`、`app/window_state.rs` 防抖保存（Resized/Moved 静默 500ms 后一次落盘；最大化只记标志、不覆盖正常尺寸）+ 启动恢复（tauri.conf `visible:false`，先恢复后显示避免 1100×720 闪现；保存位置不在任何显示器上时只丢位置保尺寸）；退出经 `RunEvent::Exit` 同步 flush。未引 `tauri-plugin-window-state`——零冗余依赖。）
