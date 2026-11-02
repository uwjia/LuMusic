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
- 侧边栏歌单右键菜单的「在资源管理器中打开」仅对 ID 可映射文件夹的歌单展示（`isFolderBackedPlaylist`），后端经 `domain::scan::auto_playlist_folder` **按 id 重新推导并校验路径不逃逸扫描根**（拼接名必须是单一 normal 分量），经 `infra/shell.rs` 的 `FolderRevealer`（explorer/open/xdg-open，spawn 后即分离）打开；手动歌单（含被采纳后保留 pl-\* id 的）无映射。

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
- 现有规模：**260 前端 + 192 后端**；新增行为时保持各层均有覆盖，而非只补一层。

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
- **主题（深/浅色）**：深色是 `:root` 默认调色板；浅色经 `<html data-theme="light">` 只覆盖 `--bg-*`/`--fg-*`/`--overlay` 与 `color-scheme`。偏好为纯前端 localStorage（`lumusic.theme`，`system|light|dark`；**未存储默认 `dark`，不看系统偏好**；仅显式选 `system` 才跟随系统并即时切换——持久化模式镜像语言 store，但**不做**语言式的首启系统检测；不进后端设置）。`--accent*`/`--danger` 不随主题变化（压 accent 的白字、频谱渐变均依赖）。
- **原生 `<select>` 必须自绘箭头**：`appearance: none` + 内联 SVG 背景（参照 `.eq-select`）。WebView2 的原生下拉箭头不受 `padding-right` 影响、会紧贴右边缘；同时补 `:focus-visible` 边框高亮，与输入框一致。

### Non-goals（当前不做）

无缝播放、标签编辑、封面提取。遇到相关需求先确认范围。

（歌词已实现：`domain/lyrics.rs` 解析、`infra/lyrics.rs` 同名 `.lrc` 自动关联 + 编码修复、`features/lyrics` 渲染页，入口在播放模式按钮左侧。）

（均衡器已实现：`domain/equalizer.rs` RBJ biquad 设计 + 设置净化、`infra/audio/equalizer.rs` 实时滤波（`SharedEq` 代数计数，播放中换系数不重建 sink）、`features/player/EqualizerPanel` 弹出面板 + `lib/equalizer.ts` 内置预设，入口在歌词按钮右侧；配置持久化于 `settings.json` 的 `eq` 字段。）

（频谱已实现：`domain/spectrum.rs` 手写 radix-2 FFT + Hann 窗 + 对数频段聚合（24 柱，31Hz–16kHz，与 EQ 频段对齐）、`infra/audio/spectrum.rs` SPSC 无锁 tap（音频线程每采样仅原子写）+ 分析器、poller 50ms 分频（播放轮询/进度不变，频谱 ~20Hz 仅 Playing 发 `spectrum://frame`）、`features/player/SpectrumPanel` canvas 面板（与 EQ 面板互斥，rAF 平滑、停播衰减归零；**固定于页面底部中央、紧贴播放条上缘（`bottom: 0`，柱体自播放条上缘向上生长、无任何预留条带；由 App 渲染于 `.content` 内——窗口居中会因左侧 220px 侧边栏而偏左）、无底色/边框/阴影、无标题文本、无频轴数字、柱体 50% 透明、`pointer-events: none` 点击穿透**——纯半透明柱状图，不遮挡也不拦截下层页面/歌词行的显示与点击），入口在 EQ 按钮右侧。）

（艺术特效已实现：`lib/artEffects.ts` 预设注册表 + localStorage 持久化（`lumusic.artEffect`，纯前端视觉偏好**不进后端设置**）、`features/player/ArtEffectsPanel` 预设选择弹窗（与 EQ/频谱弹窗三者互斥，点选即时预览不收起，入口 sparkles 按钮在频谱右侧）、`features/lyrics/artRenderers.ts` 八种 canvas 绘制器（极光/星空/气泡/粒子/波纹/月亮星空/落雪/小桥流水人家——月亮星空移植自 MyNo01 流水波动演示**仅取星月半景**：全页夜空渐变+70 颗确定性闪烁星（1.2–2.8 rad/s 柔和闪烁；初版 0.5–1.5 rad/s 慢呼吸不可感知，1.5–5 rad/s 又过快）+弦月光晕，未采用其海面/波浪；落雪移植自 MyNo01 科赫雪花演示的冬夜背景**仅取夜空与飘雪**：径向夜空渐变+64 片确定性飘雪（落速随音乐能量、按 dt 累积防回卷），未采用其中央科赫雪花；小桥流水人家为自研暮色村景（**无桥**，纯流水人家）：山影+落日+暖窗人家（窗灯随能量闪烁+水面碎光倒影）+炊烟+垂柳+26 只萤火；**全幅无直线地平线**——水面顶边为种子化波浪边、山体填至水线下防露直边、水线覆水岸雾带、右岸为 ±16px 起伏岸体压住村舍基座并渐隐入水，萤火/炊烟/水面流光沿用落雪式**无状态粒子**（位置纯由 time+种子求模推导，帧间零可变状态）；场景色为美术原色不进设计令牌；确定性种子、面积缩放粒子数）+ `ArtBackground` 歌词页背景层（DPR≤2 自适应、rAF 循环、频谱帧平滑出能量驱动、帧过期即衰减；`off` 或页面关闭时不挂载、零开销）。）

（窗口状态已持久化：`domain/window.rs` 几何净化（低于 840×560 或荒谬值整体弃用）、`infra/persistence.rs` 增 `window.json`、`app/window_state.rs` 防抖保存（Resized/Moved 静默 500ms 后一次落盘；最大化只记标志、不覆盖正常尺寸）+ 启动恢复（tauri.conf `visible:false`，先恢复后显示避免 1100×720 闪现；保存位置不在任何显示器上时只丢位置保尺寸）；退出经 `RunEvent::Exit` 同步 flush。未引 `tauri-plugin-window-state`——零冗余依赖。）

（播放队列已实现：`domain/queue.rs` 增 `insert_next`（同时改 items 与 play_order 两视图，shuffle 下也真正"下一首"）与 `remove_item`（拒绝移除正在播放行；光标前移除修正 position）；`app` 层 `player_queue_get/insert_next/append/remove/jump` 命令（队列空时插入即开播）；前端 `stores/queueStore` + `features/player/QueuePanel`（虚拟化弹窗，与 EQ/频谱/特效/音量五者互斥，行点击跳播、待播行可移除）+ `TrackTable` 可选 `contextMenuEntries` 右键「下一首播放/加入队列」（音乐库与歌单页共用）；队列经事件桥随每次 state 事件刷新。）

（系统媒体会话已实现：`app/media.rs` 经 `souvlaki`（SMTC/MPRIS，唯一纯 Rust 适配器）接 OS 层——`emit_state` 与 poller 进度分频同时推送元数据/状态/时间轴（元数据仅曲目变更时重发，避免时间轴重置）；硬件媒体键/锁屏/耳机按键回调经与托盘相同的 service 方法回放（Play/Play 一律不暂停、SeekBy/SetPosition 换算为 seek）；`MediaSnapshot`/`seek_target` 为纯函数可测，souvlaki 调用本身是薄壳。Windows 需 `window.hwnd()`，失败仅降级无 OS 集成。）

（淡入淡出已实现：`infra/audio/fade.rs` `SharedFade`（f32 位原子 + 双速率线性 ramp，按采样率换算步长；**上行分软/守卫两档，入口各自装定速率**）+ `FadeSource` 源包装（静息时增益恰为 1.0，位透明）。时长：淡出 120ms、软淡入 60ms、守卫淡入 20ms。场景规则（引擎自行推导，见 `engine::FadeIn`）：**淡出**用于暂停与切歌（旧 sink 满增益处被丢弃/暂停 = 阶跃不连续即爆音；`Command::Open` 在旧 sink 发声中时先 `fade_out`，`arm_deferred` 计时器（淡出 +100ms 余量：ramp 以回调"拉取"为准，大回调块下完成晚于名义时长，余量不够会截尾出咔哒）发 `OpenNow` 换源；`PauseNow` 同理）；**软淡入**仅"上一刻有声"的场景（延迟换源的新曲、暂停恢复）——把接缝听感变柔和；**守卫淡入**用于"上一刻本就静音"的场景（首次播放、自动前进、repeat-one、从暂停态切歌）——长淡入只会软化音乐本身的开头（专辑每轨边界/循环开头丢攻击力），20ms 仅防满电平起音 tick；**seek 即时重开、无 ramp**（增益连续）。延迟期间调用方持服务锁等待——**所有引擎命令都出自该锁**，天然串行无竞态（超车释放为防御路径）；代数计数令 Resume/Open/Stop/Seek 作废陈旧计时器。与 master volume、EQ 无关。）

（文件夹监视已实现：`app/watch.rs` 经 `notify 8`（ReadDirectoryChangesW/inotify 统一 API）递归监视扫描根——启动时按上次扫描根播种、每次扫描成功后 `set_root` 切换（切换丢弃旧根的 pending，避免错并进新根的自动歌单）。事件经**单通道去抖**（静默 800ms 或批次最长 3s 强制合并；编辑器写文件是事件风暴）；flush 时**以磁盘为准**分区（Changed 但已消失=移除、Removed 但又存在=刷新、目录不刷新），rename 事件拆成 源=移除/目标=新增；元数据读取在服务锁外（两段式，与扫描同），合并走 `service::merge_fs_changes` → 复用 `apply_scan`（增量重构全量列表：upsert 刷新轨、按精确路径或 `path_is_at_or_under`（大小写不敏感组件比较）剪枝消失项与整目录子树、自动歌单重排、**手动歌单经 `PlaylistCollection::retain_items` 清理死 id**（曲库子集语义：改名/移动/删除后不留僵尸行与虚高计数；仅自动歌单获得新增——手动歌单是人工策展，磁盘新增不会流入）、持久化）；有实际变更才发既有 `library://updated` 事件（前端事件桥自动刷新曲库+歌单及**当前打开歌单页**的曲目，零前端改动）。目录被删/无法监视仅降级为"不监视"。）

（M4A/AIFF/APE 格式已支持：symphonia features 增 `isomp4`+`aac`+`alac`（M4A=MP4 容器 + AAC/ALAC）与 `aiff`（PCM）；APE 经 `ape-decoder` crate（symphonia 无 APE 编解码，其 `ape` feature 仅标签）走 `infra/audio/ape_source.rs` 平行解码路径——`ApeStream` 接缝（测试喂合成 PCM 帧，真实现 `ApeDecoderStream` 在**专属预取线程**解码：APE 单帧可达 ~73728 块（~1.7s 音频）且熵解码 CPU 密集，在音频回调线程同步解码必欠载（杂音/停顿），故 worker 经 `sync_channel(4)` 预取已解码帧、seek 用代数计数作废陈旧帧、`locate_block` 纯函数镜像 decoder.seek 的帧/块拆分）+ `ApeSource`（f32 交错、8/16/24/32bit/大小端/float 变体、复用 `PosTracker`、采样级 seek 且越界钳制到实际落点），`engine.rs::DecodedSource` 按扩展名分派，EQ/淡入淡出/频谱链与格式无关；APE 仅支持 3.95+（解码器下限），损坏流按既有"跳过+警告"处理。`domain/scan.rs::SUPPORTED_EXTENSIONS` 相应加 `m4a`/`aif`/`aiff`/`ape`（**刻意不含** `.aac`——symphonia 0.5 的 `aac` feature 无 ADTS 读取器；不含 `.mp4`——视频容器会扫进影库；WavPack/DSD/Opus 上游无解码器），`api/mock.ts` 的 SUPPORTED_EXTENSIONS 必须镜像；lofty 解析失败的文件仍按文件名降级入库不丢弃。）
