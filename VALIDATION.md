# 验证记录

日期：2026-09-19。所有测试仅使用合成歌词和音频。

- 本机 Node.js 24.15.0，npm 11.12.1。
- 单元及集成测试：19 项通过，包含真实 Python 双向兼容测试。覆盖歌词配对与时间戳、offset、状态和历史、时间边界与重叠、项目备份校验、IndexedDB 并发写入、XLSX 合并范围与文本安全。
- 原 Python CLI：从原实现生成 XLSX，Web 导入并导出后由原实现读取，数据和合并范围完全一致；原提交为 `d61296eb31b01b692c8fd3a30ee42578a4e59dca`。
- 本机 Google Chrome：8 项端到端测试通过。覆盖完整编排、真实 WAV 播放、高亮、暂停/变速/定位/循环、刷新恢复、Excel/JSON 下载、LRC 与整体偏移、备份重新关联、非法文件保留原数据、短歌曲替换、手机无横向溢出、存储失败、多标签页冲突、项目切换。
- 桌面和手机：使用 `scripts/capture.mjs` 生成截图并检查控制台异常与页面溢出。
- WebKit：官方与备用下载地址均 TLS 连接失败，本机未能执行。CI 已配置 WebKit，但未推送远程，因此尚无 CI 运行结果。
- Safari 与 Microsoft Edge 产品浏览器：未做实际验证；不将 Chrome 或 WebKit 的结果冒充这些浏览器的结果。

TypeScript 检查、生产构建和格式检查通过；`npm audit` 为 0 漏洞。

生产构建产物位于 `dist/`；未部署站点，未创建远程仓库。

## 2026-09-20 播放器交互修正

- `npm run check`：13 项单元/集成测试通过，Python 专项默认跳过；类型检查与构建通过。
- `npm run format:check` 与 `git diff --check` 通过。
- Chrome Playwright：6 项通过。新增真实合成音频 A/B 回跳、反向区间拒绝、替换清除、播放跟随开关、精确出入点校验、缩放边缘拖动、重叠回退和撤销测试。
- 本轮未运行 WebKit，未验证 Safari。
