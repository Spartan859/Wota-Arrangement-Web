# Wota · 编排工作台

本地优先的光棒编排工具。把双语歌词分成段落，边听歌曲边打点，编辑动作与备注，导出兼容原 Python 工具的 Excel 编排表；需要时可将编排和音乐发布为只读在线分享页。

未登录时，文件处理、项目保存和音频播放仍全部在本机浏览器完成，无需 Python、后端或账号。只有主动发布在线分享时，才会把脱敏后的编排快照和所选音乐上传到 Wota 服务。

## 启动

要求 Node.js 22.12+（推荐 Node.js 24）与 npm。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址，默认 `http://127.0.0.1:5173`。开发服务器只监听本机。

需要同时调试在线分享、Keycloak 和数据库时，先复制 `.env.example` 为 `.env`，再启动隔离 Compose 栈：

```sh
cp .env.example .env
docker compose --profile local-mail up -d --build
npm run dev:all
```

本地服务地址：

- Web 与 API 反向代理：`http://127.0.0.1:8080`
- Keycloak：`http://127.0.0.1:8081`
- Mailpit 邮件捕获：`http://127.0.0.1:8025`
- Vite 开发服务器：`http://127.0.0.1:5173`

```sh
npm run build
npm run preview
```

生产产物位于 `dist/`，可由静态 HTTP 服务托管。不要直接双击 `index.html`；生产环境使用 HTTPS，开发可使用 localhost。应用不依赖外部字体、图片或在线歌曲服务。

## Docker

仓库提供多阶段 `Dockerfile`，包含静态 Web、API 和迁移运行目标。Compose 栈包含 Web/Nginx、API、PostgreSQL、Keycloak、Postfix 或 Mailpit。需要 Docker Engine 与 Compose v2：

```sh
docker compose --profile local-mail up -d --build
```

默认访问 `http://127.0.0.1:8080`，API 健康检查为 `http://127.0.0.1:8080/api/health`。停止服务：

```sh
docker compose down
```

本地邮件使用 `local-mail` profile 和 Mailpit；生产邮件使用 `production-mail` profile 和 Postfix 中继。生产凭据只放在服务器 `/opt/wota-stack/.env`，不得提交。项目草稿和未发布音频仍保存在浏览器 IndexedDB；发布后的音频保存在 Compose 持久化卷。

GitHub Actions 的 CI 位于 `.github/workflows/ci.yml`：所有分支和 PR 执行单元测试、类型检查、构建、格式检查、Python XLSX 兼容测试和容器构建；推送到 `main` 或 `v*` 标签时，额外将镜像发布到 GitHub Container Registry。Chromium/WebKit Playwright 测试只在本地运行，不进入 CI。

生产发布位于 `.github/workflows/deploy.yml`。`main` 的 CI 全部通过后，Actions 构建 Web/API 固定提交镜像并发布到 GHCR，再通过受限 SSH 命令在 `/opt/wota-stack` 拉取 Compose 镜像。宿主 Nginx 将 `wota.satintin.com` 路由到 Web/API，将 `auth.wota.satintin.com` 路由到 Keycloak。仓库的 `production` Environment 需要配置 `DEPLOY_SSH_KEY` 和 `DEPLOY_KNOWN_HOSTS`；一次性 root 安装可参考 `deploy/install-compose-runtime.sh`。

## 一次编排

1. 新建项目并填写歌名、BPM；通过“打开”导入标准 `.xlsx` 或 `.json`。
2. 在下方时间轴空白处点击新建段落；选中段落后用“当前作为入点”（`[`）和“当前作为出点”（`]`）打点；拖动左右边缘也可调整。普通点击单选，使用 `Ctrl` / `⌘` 切换选择，`Shift` 选择连续段落；多选后拖动段落主体可保持间距整体移动。
3. 上方当前段落卡片中点击类型、拍数、双语歌词、技 / 动作编排或备注进行编辑。
4. 导入 TXT 或打开 LRC 选择歌词；LRC 同一时间戳只能选一条日文，其余自动组成中文。
5. 导入本地歌曲，使用时间轴定位、拖动和缩放进行对时；选中段落后可点击卡片的“循环”练习。A/B 练习直接在播放位置点击“选 A”（`A`）“选 B”（`B`），再开始或退出循环。
6. 预览并导出 Excel；JSON 只保存当前编排、歌词、时间标记和音频元信息。

## 同步规则

- 时间使用秒（可带小数）；段落采用 `[开始, 结束)`，允许留白，不允许重叠，不能超出歌曲时长。
- 拍数直接使用正整数；BPM 建议时长为 `拍数 × 60 / BPM`。
- LRC 支持多时间戳和 `offset`，整体偏移在预览确认后应用。歌词时间在段落中保留。
- 只有段落对时而没有逐句时间时，只高亮段落。逐句高亮使用下一句时间作为终点；末句使用段落终点或歌曲终点。
- 播放器直接读取音频元素的当前时间，不靠计数器累加；标签页恢复前台后重新同步。后台定时和循环精度仍受浏览器调度影响，不是采样级音频编辑器。
- 拖动段落块整体移动时间区间，左右边缘调整入点/出点；多个已对时段落可以保持各自时长和相互间距整体移动。拖动会限制在歌曲范围和未选中片段边界；打点仍校验时间和重叠。编排列表顺序保持不变。
- 开启“跟随播放”时，编辑卡片随播放头切换；暂停或关闭跟随后可以手动选择段落。打开编辑弹窗或输入文字时暂缓切换。
- 音频使用浏览器原生解码，不转码。推荐 MP3 或 WAV；具体格式支持取决于浏览器和系统。

## 保存与文件兼容

项目和歌曲 Blob 存在当前站点的 IndexedDB；刷新恢复为暂停状态，保留播放位置。自动保存状态显示在歌名下方。

- **JSON**：包含段落、歌词、时间标记和音频文件信息，不包含音频文件。导入后需重新关联歌曲。
- **XLSX**：仅包含已编排段落，使用原工具的六列表头、歌曲/BPM 标题及合并结构；同一张表底部附单行光棒累计用量和逐人换棒列表。不包含音频或完整走位数据，重新导入 XLSX 只恢复段落编排。
- Web 会保留空歌词块与纯动作块的区别；原 Python CLI 读取空歌词块时会将其转成“纯动作/无歌词”，这是原工具的既有行为。
- XLSX 导入仅支持标准模板。导入失败不替换当前项目；成功导入创建独立项目。
- 更换歌曲保留时间标记，时长不同会提示检查，越界段落无法定位或循环。
- 浏览器清理数据、隐私模式、切换域名或端口均可能影响草稿。请定期下载 JSON，同时自行保存原歌曲。
- 存储失败时仍保留内存中的编辑，可下载备份；多标签页使用版本检查防止覆盖，冲突时可保存副本或明确重新载入。
- 撤销/重做保存最近 100 次编辑；刷新后历史清空。音频文件关联和播放位置不属于编排撤销历史。

## 在线分享与账号

导出窗口的“在线分享”会首次创建固定链接；再次发布同一项目会覆盖在线快照并递增版本。发布快照不包含 `lyricSource` 原文、本地音频 ID、播放位置等本地状态。默认每个账号有 100 MiB 音频配额，编排 JSON 不计入音频配额。

- 分享页无需登录，任何持有随机链接的人都可以查看；每位访客独立播放，不进行多人实时同步。
- 云端音乐只提供支持 Range 的流式播放，不提供下载按钮。删除云端音乐后分享链接继续有效，访客可在本机选择同一首歌并通过同步偏移校准。
- `/shares` 显示登录用户的在线编排、用量、音频恢复/删除和分享取消操作。
- `/admin` 显示 Keycloak 用户、音频用量、分享和配额；管理员可扩容、删除用户文件并邀请其他管理员。
- 普通用户通过 Keycloak 公开注册并完成邮箱验证；服务器脚本 `npm run admin:create -- --email <email> --name <name>` 用于首个管理员。

主要 API：

```text
GET    /api/public/shares/:token
GET    /api/public/shares/:token/audio
GET    /api/session
GET    /api/shares
POST   /api/shares
POST   /api/shares/:id/audio
DELETE /api/shares/:id/audio
DELETE /api/shares/:id
GET    /api/admin/users
GET    /api/admin/users/:id/shares
PATCH  /api/admin/users/:id/quota
POST   /api/admin/admins
```

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

“按拍数设出点”（`E`）根据当前段落入点、拍数和 BPM 计算出点，重叠或越界时保留原值。`L` 开始或退出 A/B 循环。快捷键在输入框或弹窗中不触发。
LRC 原文、文件名和偏移量随项目保存。页头显示来源与偏移；点击来源可重新编辑或导入，点击偏移打开选词弹窗。偏移用于源歌词预览及后续加入的歌词，不重复移动已编排歌词或段落出入点。
双语歌词使用左右两个多行输入框；再次打开 LRC 默认进入已载入来源的多选界面。

## 队形画布

队形画布记录全曲舞者走位。添加舞者后可拖动圆点，点击左右半圆设置左右手光棒颜色；拖动或换色会在当前播放时刻自动记录全员关键帧。关键帧之间按直线插值，颜色在关键帧时切换。可从当前时刻起让舞者入场或退场，队形数据保存在 JSON，不写入 XLSX。

画布右上方“画布尺寸”可设置宽度（320–4000）和高度（240–3000），默认 800×600。尺寸决定舞台比例，实际显示自适应面板；“按比例缩放舞者站位”默认不勾选，保留所有关键帧中相对画布正中心的偏移；勾选后站位随长宽按比例缩放，越界时移至最近边界。尺寸及站位变更可一并撤销并随项目保存。光棒选色弹窗可切换“左右手同时”，一次设置双手颜色。

播放头的竖线和时间标签都可直接拖动定位，按缩放及横向滚动后的轨道计算时间。开始拖动会暂停，松手后保持暂停；不改变段落、队形关键帧或撤销历史。播放头获得焦点时还可用左右方向键、Home / End 定位。

队形标题栏提供舞者选择、添加、删除、重命名、入场、退场、画布尺寸和“显示名字”控制。开启显示名字后，姓名以圆点上方气泡显示；气泡位于舞台顶层，不遮挡舞者圆点交互。

队形圆点首次点击只选中，已选中圆点再次点击打开光棒颜色编辑；编辑弹窗也可重命名舞者。颜色面板只显示极色版本、黑色“没拿棒”和特殊色，旧项目中的基础色会兼容映射到对应极色。

空格切换播放／暂停，长按不重复切换；按钮、复选框、滑块、下拉框获得焦点后同样生效，不触发控件自身的空格操作。文字/数值输入、文本域、可编辑内容、弹窗或输入法组合输入期间不触发播放快捷键。播放按钮悬停提示显示该快捷键。

## 一次性光棒用量

导出弹窗用一行汇总各颜色累计消耗；换棒列表每人一行，以时间戳和左右双色圆点展示，长序列可横向滚动。悬停、触摸或键盘聚焦圆点可查看左右手颜色、状态和新增根数。每只手首次取棒或换到另一种非黑色计 1 根，换回之前的颜色也重新计数；连续同色和纯走位关键帧不重复计数，黑色表示未持棒、不计根数。退场后再次入场按重新取棒统计。统计覆盖全部已保存关键帧，超出歌曲时长的关键帧会提示检查。

Excel 不再添加第二张表：主表底部附单行颜色汇总及每人一行“时间戳＋双色圆点”图片，单元格批注提供文字颜色明细。换棒列表仅列出取新棒记录，不显示双手未持棒或退场记录，单手未持棒的半圆留白。原六列编排数据保持与 Python 工具兼容。统计是由关键帧即时计算的，不保存成额外项目字段。
