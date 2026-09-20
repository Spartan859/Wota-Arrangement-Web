# Wota · 编排工作台

纯浏览器的光棒编排工具。把双语歌词分成段落，边听歌曲边打点，编辑动作与备注，导出兼容原 Python 工具的 Excel 编排表。

文件处理、项目保存和音频播放均在本机浏览器完成。无需 Python、后端或账号。

## 启动

要求 Node.js 22.12+（推荐 Node.js 24）与 npm。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址，默认 `http://127.0.0.1:5173`。开发服务器只监听本机。

```sh
npm run build
npm run preview
```

生产产物位于 `dist/`，可由静态 HTTP 服务托管。不要直接双击 `index.html`；生产环境使用 HTTPS，开发可使用 localhost。应用不依赖外部字体、图片或在线歌曲服务。

## 一次编排

1. 新建项目并填写歌名、BPM；通过“打开”导入标准 `.xlsx` 或 `.json`。
2. 在下方时间轴空白处点击新建段落；段落块可拖动和调整左右边界。
3. 上方当前段落卡片中点击类型、拍数、双语歌词、技 / 动作编排或备注进行编辑。
4. 导入 TXT 或打开 LRC 选择歌词；LRC 同一时间戳只能选一条日文，其余自动组成中文。
5. 导入本地歌曲，使用时间轴定位、拖动和缩放进行对时；点击段落块可循环练习。
6. 预览并导出 Excel；JSON 只保存当前编排、歌词、时间标记和音频元信息。

## 同步规则

- 时间使用秒（可带小数）；段落采用 `[开始, 结束)`，允许留白，不允许重叠，不能超出歌曲时长。
- 拍数直接使用正整数；BPM 建议时长为 `拍数 × 60 / BPM`。
- LRC 支持多时间戳和 `offset`，整体偏移在预览确认后应用。歌词时间在段落中保留。
- 只有段落对时而没有逐句时间时，只高亮段落。逐句高亮使用下一句时间作为终点；末句使用段落终点或歌曲终点。
- 播放器直接读取音频元素的当前时间，不靠计数器累加；标签页恢复前台后重新同步。后台定时和循环精度仍受浏览器调度影响，不是采样级音频编辑器。
- 拖动段落只改变编排顺序；时间顺序有冲突时提示检查。
- 音频使用浏览器原生解码，不转码。推荐 MP3 或 WAV；具体格式支持取决于浏览器和系统。

## 保存与文件兼容

项目和歌曲 Blob 存在当前站点的 IndexedDB；刷新恢复为暂停状态，保留播放位置。自动保存状态显示在歌名下方。

- **JSON**：包含段落、歌词、时间标记和音频文件信息，不包含音频文件。导入后需重新关联歌曲。
- **XLSX**：仅包含已编排段落，使用原工具的六列表头、歌曲/BPM 标题及合并结构。不包含时间标记或音频。
- Web 会保留空歌词块与纯动作块的区别；原 Python CLI 读取空歌词块时会将其转成“纯动作/无歌词”，这是原工具的既有行为。
- XLSX 导入仅支持标准模板。导入失败不替换当前项目；成功导入创建独立项目。
- 更换歌曲保留时间标记，时长不同会提示检查，越界段落无法定位或循环。
- 浏览器清理数据、隐私模式、切换域名或端口均可能影响草稿。请定期下载 JSON，同时自行保存原歌曲。
- 存储失败时仍保留内存中的编辑，可下载备份；多标签页使用版本检查防止覆盖，冲突时可保存副本或明确重新载入。
- 撤销/重做保存最近 100 次编辑；刷新后历史清空。音频文件关联和播放位置不属于编排撤销历史。

## 测试与维护

```sh
npm run check                  # 单元测试、类型检查、生产构建
npx playwright install chromium webkit
npm run test:e2e               # Chromium / WebKit 完整浏览器流程
npm run format:check
npm audit
```

本机已有 Chrome 时可以使用：

```sh
PLAYWRIGHT_CHROME_CHANNEL=chrome npm run test:e2e -- --project=chromium
```

验证与原 Python CLI 的双向兼容（仅生成临时合成数据，不修改原仓库）：

```sh
WOTA_CLI_PATH=/path/to/Wota-Arrangement-Tool \
PYTHON=/path/to/python-with-openpyxl \
npm test -- tests/python-compat.test.ts
```

CI 包含静态构建、Chromium/WebKit 测试及对原 CLI 提交 `d61296eb31b01b692c8fd3a30ee42578a4e59dca` 的兼容验证。原仓库若为私有，兼容 job 需要具备读取它的 token；本地测试不受影响。

开发服务器启动后，`node scripts/capture.mjs` 可生成合成内容的桌面/手机截图到 `test-results/`。

代码组织：`src/core/` 是纯数据及文件逻辑；`src/useProject.ts` 管理历史与持久化；`src/components/` 包含导入、编辑、预览与播放器；`src/App.tsx` 连接工作流。

ExcelJS 按需加载。其 Node 侧 `uuid` 依赖通过 npm override 固定在修复后的 11.x，ExcelJS 仅使用该包的 v4 接口；升级时需重新执行审计与兼容测试。

已知验证范围见 [VALIDATION.md](VALIDATION.md)。
