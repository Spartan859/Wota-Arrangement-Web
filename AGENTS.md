# Wota Arrangement Web · Agent Guide

本文件是 `/Users/dijkstra0x3/Github/Wota-Arrangement-Web` 的开发约定。先阅读这里，再按任务范围阅读 `README.md`、`VALIDATION.md` 和相关源码。

## 项目边界

这是一个纯浏览器 React + TypeScript + Vite 应用，用于双语歌词编排、动作备注、歌曲对时和排练循环。

- 不添加后端、账号、云同步或远程音频服务，除非用户另行要求。
- 文件解析、音频播放和项目保存都在浏览器完成；不要把用户歌词、歌曲或本地项目上传到外部服务。
- 兼容对象是原 Python 仓库 `/Users/dijkstra0x3/Github/Wota-Arrangement-Tool` 生成的标准 XLSX 模板。修改表格格式前必须先检查 `tests/python-compat.test.ts`。
- 个人歌词、歌曲、导出的 XLSX/JSON、音频、截图和构建产物不应提交到 Git。

## 环境与命令

要求 Node.js `>=22.12`，推荐 Node.js 24。首次安装和常用检查：

```sh
npm ci
npm run dev
npm run check
npm run format:check
npm audit
```

脚本含义：

- `npm run dev`：启动只监听 `127.0.0.1` 的 Vite 开发服务器。
- `npm run typecheck`：只运行 TypeScript 检查。
- `npm run test`：运行 `tests/**/*.test.ts` 中的 Vitest 测试。
- `npm run build`：类型检查并生成 `dist/`。
- `npm run test:e2e`：运行 Chromium 和 WebKit Playwright 测试；本机只有 Chrome 时使用 `PLAYWRIGHT_CHROME_CHANNEL=chrome npm run test:e2e -- --project=chromium`。
- `npm run format` / `npm run format:check`：统一或检查 Prettier 格式。
- `node scripts/capture.mjs`：用合成歌词和音频生成桌面、短屏及手机截图；不要替换为个人媒体文件。

开发服务器或测试服务启动后，优先使用本机地址访问。不要为了测试执行 `open`、修改系统浏览器配置或启动外部服务。

## 代码结构

- `src/core/model.ts`：`Project`、`Block`、`Lyric`、类型预设、项目校验、收纳/打包/插入/排序和历史快照的纯逻辑。
- `src/core/lyrics.ts`：TXT/LRC 解析、时间戳、多时间戳、`offset` 和整体时间偏移。
- `src/core/timing.ts`：时间格式化、BPM 八拍时长建议、段落区间校验、播放高亮和顺序冲突检查。
- `src/core/xlsx.ts`：ExcelJS 浏览器读写。读取合并单元格时只把主单元格作为字段值；必须保留连续块、空歌词行和纯动作块的语义。
- `src/core/storage.ts`：Dexie/IndexedDB。项目记录和音频 Blob 分开保存；版本号用于阻止多标签页静默覆盖。
- `src/useProject.ts`：当前项目、自动保存、撤销/重做、项目切换、冲突恢复。编排修改统一通过 `store.edit`。
- `src/components/`：歌词导入、段落编辑、Excel 预览、播放器和时间轴。
- `src/App.tsx`：工作台布局和跨组件工作流；业务规则尽量放入 `src/core/`，不要继续堆积到此文件。
- `tests/`：核心单元测试、存储/Excel 集成测试、Python 兼容测试和 Playwright 流程测试。

## 数据与编辑约束

- 项目模型当前 `schemaVersion` 为 `1`。新增字段必须考虑 `parseProject` 的校验、旧 JSON 导入和默认值；不要静默改变已有字段含义。
- ID 使用 `crypto.randomUUID()`，不要用数组下标作为持久化 ID。
- `store.edit` 默认记录撤销快照；播放时间、播放器就绪状态、A/B 点和跟随滚动等瞬时状态不应进入编排撤销历史。
- 文本输入要在 `blur` 或明确提交时更新；不要在每次按键时产生历史快照。
- 全局快捷键必须忽略输入框、文本域、选择框、输入法组合状态和打开的对话框。
- 任何用户可编辑的数值时间都要经过有限数、非负数、歌曲时长和区间关系校验。段落时间使用左闭右开 `[start, end)`，不允许重叠。
- 段落排序不自动修改时间；若时间顺序和列表顺序冲突，显示提示并保留用户数据。

## 歌曲同步约定

- HTMLAudioElement 的 `currentTime` 是唯一播放时钟；不要用定时器累加时间来代替它。
- 歌词时间可为空；没有逐句时间时只高亮已对时段落，不要伪造歌词时间。
- BPM 只用于给用户建议，确认后才写入结束时间；修改 BPM 不得重排已有时间。
- 段落循环必须检查有效的开始、结束和歌曲时长。更换项目或歌曲时停止播放并清理循环状态。
- 时间轴 A/B 循环是播放器的瞬时练习状态：依次选择 A 入点和 B 出点，B 必须晚于 A；更换歌曲或项目时清除 A/B 点。它不写入 XLSX，也不应污染编排撤销历史。
- 时间轴缩放后，选点必须根据可见时间轴元素的实际 `getBoundingClientRect()` 计算，不能假定容器宽度等于歌曲时长。
- 音频 Blob 只存当前浏览器的 IndexedDB。JSON 只保存音频元信息，不嵌入音频；导入 JSON 后必须提示重新关联歌曲。

## 文件格式兼容

XLSX 导出必须保持原工具的六列表头：

```text
段落 | 拍数 | 日文歌词 | 中文歌词 | 技 / 动作编排 | 备注
```

同时保持标题中的 `歌曲名 (BPM: bpm)`、相邻同类型段落的名称合并、块内拍数/动作/备注合并和交替底色。同步时间、歌曲 Blob、歌词池和暂存区不写入 XLSX。

- 空歌词块与纯动作块在 Web 模型中要区分；原 Python 读取标准表格时可能将没有歌词行的块解释为纯动作，这是兼容层的既有行为。
- 导出文本时不能把用户输入的 `=...` 等内容误写成 Excel 公式；相关行为由 `tests/xlsx.test.ts` 覆盖。
- 修改 Excel 结构或合并策略后，运行真实 Python 双向兼容测试：

```sh
WOTA_CLI_PATH=/Users/dijkstra0x3/Github/Wota-Arrangement-Tool \
PYTHON=/Users/dijkstra0x3/Github/Wota-Arrangement-Tool/venv/bin/python \
npm test -- tests/python-compat.test.ts
```

## 测试要求

每次改变核心逻辑至少运行相关 Vitest 测试和 `npm run typecheck`；涉及 UI、播放器、持久化或文件下载时运行对应 Playwright 测试。新增用户行为必须有失败路径测试，不要只测成功路径。

重点覆盖：

- TXT/LRC 的 BOM、空行、奇数行、多时间戳、`offset`、负时间和整体偏移。
- 收纳、跳过、打包、空段落、纯动作段落、插入位置、排序、撤销/重做。
- 段落起止时间的重叠、反向、越界和上一段结束时间快捷设置。
- 音频加载失败、歌曲替换后越界标记、播放暂停、变速、段落循环和 A/B 循环。
- IndexedDB 保存失败、同版本并发写入、多标签页冲突、刷新恢复和项目切换。
- 标准 XLSX 导入导出、合并单元格、空歌词块、纯动作块以及原 Python CLI 往返。
- 桌面、短屏和手机布局；页面不应出现横向溢出或控制台异常。

测试只使用合成歌词和合成 WAV。浏览器测试若因本机缺少 WebKit 或网络无法下载而不能执行，要在 `VALIDATION.md` 记录实际限制，不要声称 Safari 已验证。

## 修改流程

1. 先读取相关源码、测试和 README，确认数据流与现有行为。
2. 先修改纯逻辑和测试，再连接 UI；不要用测试专用分支绕开生产代码的校验。
3. 运行最小相关测试，再运行 `npm run check`、`npm run format:check` 和必要的端到端测试。
4. 检查 `git diff --check`、`git status --short`，确认没有 `dist/`、`node_modules/`、个人媒体或测试结果被加入。
5. 报告实际通过的命令和未能执行的浏览器/环境检查；不要把“启动成功”写成“部署成功”。

除非用户明确要求，不要创建远程仓库、推送、部署或修改原 Python 仓库。

## 自动提交与 push

每个独立的 `feat`、`fix`、`docs` 或 `chore` 完成并通过相关检查后，使用受限文件列表提交：

```sh
npm run commit -- <feat|fix|docs|chore> "简短说明" <文件>...
```

脚本只会暂存命令中明确列出的文件，提交前运行 `git diff --check` 并验证暂存区；不会提交依赖、构建产物、个人媒体、日志、账号数据或凭据。配置 `origin` 时会 push 当前分支；未配置 remote 或当前为 detached HEAD 时只完成本地提交并明确报告原因。每次运行前仍需先检查 `git status --short`，不要把已有的无关修改带入提交。
