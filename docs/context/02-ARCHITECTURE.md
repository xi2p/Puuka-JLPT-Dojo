# 02 当前架构、数据与功能定位

本册基于 2026-10-30 本机程序提交 `27b8110` 的实现；已有详细字段说明见 [PROJECT-STRUCTURE.md](../PROJECT-STRUCTURE.md)。不以历史对话中的早期单卷方案为准。

## 目录和两套 Git 仓库

```text
JLPT_Website/                       程序仓库：GitHub，master
  .git/
  AGENTS.md                        后续 AI 阅读入口
  package.json                     Node >=20；start/test/update
  server.js                        本机服务和 API
  exam-store.js                    递归发现、校验和加载试卷
  updater.js                       只更新程序
  public/                          原生网页、样式、模块和角色图片
  scripts/                         部署、检查、题库管理与导出
  tests/fixtures/                  独立答案、内容和视觉回归基准
  docs/                            用户、维护、交接文档
  data/progress.json               个人记录，忽略，不对外静态开放
  .runtime/                        本机 Node 路径、程序版本、题库缓存
  tmp/                             制作、OCR、ASR、QA、暂存，忽略
  tools/                           本地 OCR 字库等，忽略
  exams/                           独立题库仓库：浙大 GitLab，master
    .git/
    .gitattributes                 * -text：按原始字节分发
    README.md
    catalog.json
    exams/
      n1-2024-12/
        manifest.json
        exam.json
        assets/listening.mp3
```

这台维护机采用上述双层目录。普通用户没有内层 Git 仓库，下载器可把卷放在 `exams/<id>/`；加载器递归扫描，两种都支持。同一 ID 不能在两个位置各保留一份。不要把外层题库仓库当作程序仓库的 submodule 加入，主仓库忽略整个 `/exams/`。

## 模块定位

| 文件 | 主要职责和修改入口 |
| --- | --- |
| `server.js` | 原生 HTTP、127.0.0.1 绑定、Host/Origin 检查、静态资源、范围请求、进度读写、维护互斥和接口 |
| `exam-store.js` | ID 和路径验证、manifest/JSON 加载、递归目录、重复 ID 隔离、题量统计、音轨与 assets 定位 |
| `public/app.js` | hash 路由、首页/筛选/下载、作答与题卡、记录/备份、交卷/复盘、播放器挂载、维护操作与保存状态 |
| `public/styles.css` | 页面布局、响应式、题号/旗子/选项、原卷书信/表格/竖排等呈现 |
| `public/exam-library.js` | 试卷目录/内容缓存、懒加载、进度验证、排除计分与成绩计算 |
| `public/paper-text.js` | 安全行内文字渲染、排序空格和星号、原卷选项列数与便条样式 |
| `public/question-flags.js` | 旧题组标记转为小题标记；未下载试卷或未知旧标记先保留 |
| `public/legacy-storage.js` | Puuka 主存储键、旧 KOTOBA/JLPT 存储迁移和字号兼容 |
| `public/listening-source.js` | Base64 分片解码为 Blob、一次加载复用、切换/取消防竞态、本机 MP3 兜底 |
| `public/question-audio.js` | 等待音频元数据、按题起点定位并播放、取消过时请求、时间格式化 |
| `public/service-connection.js` | 独立本机健康检测、失联/恢复通知；与外网连接无关 |
| `updater.js` | 固定 GitHub 提交、增量程序文件下载和哈希验证、回滚、记录本机版本 |
| `scripts/library-manager.js` | 题库 catalog 校验/缓存、版本判断、按套下载/校验/安装/移除、导出目录构建 |
| `scripts/export-library.js` | 维护者原地整理题库目录并生成 catalog；不自动 Git 提交推送 |
| `scripts/build-library-catalog.js` | 单独生成 catalog 文件 |
| `scripts/check-exams.js` | 内容、资源、题号与答案基准等结构检查入口 |
| `scripts/audit-content.js` | 只读内容审计，报告 errors/warnings |
| `scripts/audit-instructions.js` | 只读检查小题混入题组说明 |
| `scripts/deploy.ps1` | 找到现有 Node >=20；必要时下载非 C 盘便携版、验 SHA256、保存路径 |
| `scripts/test.js` | 枚举 `tests/*.test.js`，用 Node 原生测试运行器执行 |

根 `package.json` 是 CommonJS，`public/package.json` 将网页目录声明为 ES modules。不要因根目录没有 `type: module` 就改写网页模块。网站直接运行，无需 npm install；Python、OCR 和 ASR 只属于制作工具。

## 启动与本机边界

- `部署网站.cmd` 调 PowerShell 部署脚本；部署和启动分开。若已有满足版本的 Node，直接复用；必要的新便携环境放非 C 盘，路径写 `.runtime/node-path.txt`。
- `启动网站.cmd` 使用带引号的 `%~dp0` 定位，支持中文/空格路径；检测已有健康服务，避免重复启动。它通过系统 PowerShell 探测服务，不依赖 PowerShell 7。
- `更新网站.cmd`/`npm run update` 调程序更新器，更新后需手动重启旧服务、刷新网页。
- 服务默认 `127.0.0.1:3300`，不监听公网；只允许 localhost/127.0.0.1 Host。它不是有用户隔离的多人服务。

| 环境变量 | 默认及含义 |
| --- | --- |
| `JLPT_PORT` | `3300` |
| `JLPT_STATE_FILE` | 项目 `data/progress.json`，也可指定绝对路径 |
| `JLPT_EXAMS_DIR` | 项目 `exams/`，扫描根目录 |
| `JLPT_NO_BROWSER` | 启动 cmd 使用，设置后不自动打开浏览器 |

程序根的 `.gitattributes` 令 `.cmd`/`.ps1` 使用 CRLF，其余普通文本 LF；过去启动 cmd 曾因引号/编码出错，修改时需保留 Windows 路径引用和适当换行。题库仓库使用 `* -text`，不得套用程序仓库的换行转换规则。

## 试卷识别和稳定 ID

加载器在每层目录寻找 `manifest.json`，一旦找到便将该目录视为一卷，不继续向其内部寻找卷。忽略 `.git`、`__MACOSX` 和目录符号链接；扫描数量有限制。无效卷登记问题，其他有效卷继续可用。重复的有效 `manifest.id` 会使该 ID 暂不加载，不是随便选其中一份。

路径必须留在本卷目录内，不能使用绝对路径、反斜线越界或链接逃逸。JSON 最大 20 MiB。正常含聴解卷必须有非空音轨；文字阅读卷须明确 `listeningOmitted: true` 且 `l.groups` 为空。

`manifest.id` 是作答记录的卷关联键；`q.id` 是答案、旗子等的小题键。通常卷 ID 为 `n1-2024-12`，文字小题 `r-1`，听力 `l-1-1`；组 ID 常为 `r1`、`l1`，不能自行改成看似更整齐的新体系。文件夹名只是物理位置，可以迁移，但发布 ID 保持稳定。

## 运行 JSON 的关键字段

manifest 示例（字段完整说明见原维护文档）：

```json
{
  "schemaVersion": 1,
  "id": "n1-2024-12",
  "level": "N1",
  "year": 2024,
  "month": 12,
  "title": "2024年12月 日本語能力試験 N1",
  "referenceMinutes": 110,
  "data": "exam.json",
  "audio": "assets/listening.mp3"
}
```

文字阅读版去掉 `audio`，设置 `listeningOmitted: true`。可选 `cues` 指向本卷 `cues.json`；加载时有限数值会覆盖对应 `q.audioStart`。目前多数卷直接在 exam JSON 中保存起点，因此修定位前应检查是否有 cues 覆盖。

exam 顶层元信息与 manifest 对应，`sections` 恰好有 `r`、`l` 两部分。组有稳定 `id`、`number`、`title`、`instruction`、`questions`；阅读材料为 `blocks: [{label, html, questionIds}]`，听力原文在 `group.transcript`，需要仅听录音作答的组可设 `audioOnly`。文章块通过 `questionIds` 关联本组小题，不靠屏幕位置或全卷硬编码题号。

| 小题字段 | 说明和常见误用 |
| --- | --- |
| `id`、`label`、`text` | 稳定键、显示题号、实际小题题干；不要再贴一份整组说明 |
| `options`、`optionCount` | 选项按来源顺序；数量为3或4。录音才提供选项时 options 可空，但 optionCount 必须真实 |
| `answer` | 从1开始；数据始终需合法参考答案，即使不计分也不能填0蒙混结构校验 |
| `excludeFromScoring` | 必须明确 true 才排除；配合 sourceNote，保留练习但不进入正确率分母或错题跳转 |
| `sourceNote` | 来源缺漏、冲突或有据修正的解释，复盘显示 |
| `audioStart` | 最终运行整轨的秒数；同一段多问可相同。`sharedAudio` 由加载器比较同组起点生成 |
| `illustrationHtml` | 作答必需的局部图示/表格，可含经过核对的 HTML |
| `layout: "word-order"` | 显式启用排序题等宽横线及星号呈现；只对可靠核对过的题设置 |
| `choiceColumns` | 1、2、4，匹配原题选项列数；窄屏响应式调整 |
| `choiceStyle: "note"` | 便条独立边框及原文换行，不往 options 里塞复杂 HTML |

普通题干/选项由 `paperText` 先转义，只有无属性 `<u>`、`<b>`、`<br>` 等受支持行内标签保留；别把样式结构强塞进字符串。阅读 `html` 和 `illustrationHtml` 是制作人员可控的可信内容，只放必要标记，不引入脚本、外部资源或追踪请求。表格、框线、竖排和流程结构使用现有 `.source-*` 样式，按相近原卷复用。

## 作答、存储和成绩

网页 hash 路由采用 `#exam/<attemptId>/<r或l>/<组索引>` 和 `#results/<attemptId>`。URL 中是作答记录 ID，不是卷 ID。一次新练习对应独立 attempt；同卷可有多次记录，未交卷记录也出现在首页列表，可回到上次题组，单条删除经过确认。

进度 JSON 为 `version: 1`、`activeId`、`attempts`、`updatedAt`。attempt 包含 `id`、`examId`、`status`（active/submitted）、`answers`、题组 `notes`、小题 `flags`、`elapsed.r/l`、`position.section/group`、`audioTime`、`audioRate`、起止时间等。上限100条，导入体积上限约5 MB；笔记单条最长20,000字符。提交后答案锁定，新一轮不覆盖旧轮。

浏览器主键 `puuka-jlpt.practice.v1`。初始化验证服务器记录和浏览器候选，选择有效且较新的 `updatedAt` 版本，执行历史键/旗子迁移。不能把服务端文件默认当成永远最新，也不能盲目清空浏览器旧键。保存先写浏览器，约450ms后经队列 POST `/api/state`；服务端串行写临时文件再 rename。失联后保留待存状态，恢复时补存。备份 JSON 导入是**替换，不合并**；TXT报告不能恢复进度。

计时累计练习用时，不强制到时交卷。成绩依据当前试卷参考答案和 `excludeFromScoring` 实时计算，不是不可变的历史成绩快照；修答案/计分范围可能影响旧记录的复盘统计，发布应解释原因。界面可显示所有题的已答数，而成绩分母只含计分题，两者不能混淆。

当前成绩的言語知識/読解分区使用 N1 前7组、N2前9组这个组边界；结构加载器虽接受 N1—N5，完整产品和现有题库仅核验 N1/N2。将来支持旧制或其他级别时须重新设计并验证分项统计，不能只加 manifest 就认为完全支持。

## 音频和服务连接

`GET /api/exams/:id/audio-data` 将本机 MP3 读为 JSON Base64，网页分片解码为 `audio/mpeg` Blob 后播放，减少 IDM 对普通媒体链接的截获；成本是整轨传输和内存占用。支持选择本机对应 MP3，取消过时加载，切卷时释放 Blob。不要在排查时随意用另一卷音频兜底。

「播放本题」只在复盘显示，等待元数据后定位 `audioStart` 并立即播放；遇到较新的点击、切页、切卷时取消旧跳转。没有题尾自动停止功能。历史 `/api/listening-data` 和 `/media/listening.mp3` 仍映射样板卷 N2 2016.12，属兼容接口，新增卷不要依赖它们。

服务健康探测 `/api/health` 验证 `{app:"puuka-jlpt-dojo"}`，默认可见时约每3秒检查、2秒超时，用户操作另有节流触发。外网题库或 GitHub 请求失败不等于本机服务断开；不要让远端故障误报为「服务已断开」。

## API 和更新机制

核心接口见 [PROJECT-STRUCTURE.md](../PROJECT-STRUCTURE.md) 和 [LIBRARY-MANAGEMENT.md](../LIBRARY-MANAGEMENT.md)。主要为试卷目录/内容/音频、`/api/state`、`/api/library-status`、`/api/library/*`、`/api/update/*`。assets 路由只开放卷内 `assets/`，音轨支持 Range/HEAD；个人数据和任意项目路径不作为静态文件开放。维护 POST 检查本机 Origin 和 `X-Puuka-Request: 1`，程序更新与题库变更互斥。

**程序更新**：固定 GitHub master 的一次完整 SHA → 递归 Git 树（截断结果拒绝）→ 仅允许的程序文件 → 比较 Git blob SHA1 → 变化文件从固定 SHA 的 raw URL 获取 → 校验哈希 → 项目 tmp 暂存/备份 → 替换，写入失败回滚 → 更新 `.runtime/version.json` → 提示重启。Git blob hash 是 `SHA1("blob " + 字节数 + NUL + 原始字节)`，不是普通文件 SHA1。GitHub API 的提交字段为 `sha`，与旧 GitLab 的 `id` 不同。

程序更新保护 exams、data、.runtime运行环境、.git及制作断点，不能实现自动下载全题库。程序本地修改可能被覆盖；它不是 git pull 或自动 merge。CLI 开发者不应运行用户更新器来同步自己的修改。

**题库目录与下载**：固定浙大 GitLab master 提交 ID → 同 SHA 下的 `catalog.json` → 校验 schema/ID/files/revision → 缓存在 `.runtime/library-catalog.json` → 合并本机状态。单纯刷新只获取元数据；网络失败仍可显示旧缓存和本机卷。每套 `revision` 由排序后的 `[path,size,sha256]` 清单计算，与程序 SHA 无关。

用户选卷后，从缓存固定提交读取文件，哈希相同文件本机复用，其余下载到项目 tmp；逐文件大小/SHA256、卷结构/ID/题量都通过才替换原卷。批量顺序处理，已成功卷保留，失败卷不发布；旧卷恢复失败时保留备份路径并报错。单文件上限256 MiB、单卷512 MiB。移除只删除该卷运行目录，不删除作答记录；重新下载同 ID 即重新关联。远端下架不会自动删除客户端已有卷。
