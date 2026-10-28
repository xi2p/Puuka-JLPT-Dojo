# 项目结构与试卷格式

本文面向维护者。安装和日常操作见[使用指南](USER-GUIDE.md)，已收录试卷见[题库目录](QUESTION-BANK.md)。

## 目录

| 路径 | 用途 | 是否随项目分发 |
| --- | --- | --- |
| `server.js` | 本机 HTTP 服务、进度读写、更新接口 | 是 |
| `exam-store.js` | 扫描、校验和加载试卷 | 是 |
| `public/` | 页面、样式、播放器与浏览器进度处理 | 是 |
| `exams/` | 本机已下载的试卷 JSON 和运行资源 | 仅题库仓库分发，程序仓库忽略 |
| `updater.js` | 从程序仓库获取程序更新 | 是 |
| `scripts/library-manager.js` | 题库目录、按套下载、校验与移除 | 是 |
| `scripts/`、根目录 `.cmd` | 部署、启动、检查和测试入口 | 是 |
| `tests/fixtures/` | 独立答案序列及内容核验基准 | 是，不参与日常运行 |
| `docs/` | 使用及维护文档 | 是，制作记录除外 |
| `data/progress.json` | 个人作答记录 | 否 |
| `.runtime/` | 便携 Node.js 路径和本机版本信息 | 否 |
| `tmp/imports/`、`docs/imports/` | 制作断点、识别结果及核对记录 | 否 |

原始资料保留在外部资料库。网站运行不需要 PDF / Word、OCR 页面图、ASR 数据、模型或制作脚本，这些文件不要复制进 `exams/`。

## 本机运行

需要 Node.js 20 或更新版本，无第三方 npm 运行依赖。

```sh
npm start
node scripts/check-exams.js
npm test
```

服务绑定 `127.0.0.1`，默认端口为 3300。Windows 部署脚本负责查找已有 Node.js，必要时下载官方便携版并校验哈希；启动和更新脚本分别调用 `server.js`、`updater.js`。

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `JLPT_PORT` | `3300` | HTTP 端口 |
| `JLPT_STATE_FILE` | `data/progress.json` | 进度文件，支持绝对路径 |
| `JLPT_EXAMS_DIR` | `exams/` | 扫描题库的根目录 |
| `JLPT_NO_BROWSER` | 未设置 | 启动脚本设置后不自动打开浏览器 |

测试时必须使用独立进度文件和端口。例如在项目目录运行：

```powershell
$env:JLPT_PORT = '3371'
$env:JLPT_STATE_FILE = 'tmp/manual-review/progress.json'
npm start
```

验收完按 `Ctrl+C` 停止服务。不要用个人 `data/progress.json` 做测试，也不要通过播放音频验证页面；自动化核对使用离线解码、识别、波形和时间轴。

## 试卷如何被发现

`exam-store.js` 递归扫描题库根目录中的 `manifest.json`，找到一份试卷后停止向该目录内部递归。目录可以分层；关联记录使用的是 `manifest.id`，不是文件夹名称。

试卷 ID 和题目 ID 一经发布应保持稳定。相同 ID 出现在多个有效目录时，该 ID 暂不加载，其他有效试卷仍可使用；问题可通过 `/api/library-status` 查询。不要用新 ID 修补同一套试卷，否则旧作答记录无法正确关联。

典型目录：

```text
exams/
  n1-2024-12/
    manifest.json
    exam.json
    assets/
      listening.mp3
```

只收录言語知識・読解的试卷不需要音频目录。确实需要的图示可以放在本卷 `assets/` 中；可用文字或表格表达的内容优先直接重建，以便搜索、缩放和阅读。

## manifest.json

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

`data` 和 `audio` 使用本卷目录内的相对路径。`referenceMinutes` 是练习参考时间，不会触发自动交卷。题量从实际内容计算，不按年份或级别写死。

听力来源缺失、删节、版本错误或无法完整核验时，可交付文字阅读版：

- manifest 设置 `listeningOmitted: true`，省略 `audio`。
- `exam.json` 仍保留 `r`、`l` 两部分，`l.groups` 必须为空。
- 首页明确显示未收录聴解，评分只包含实际收录的题目。

不要用占位音频、猜测原文或编造时间点补足听力。普通试卷未设置此标记时，必须提供有效音频。

## exam.json

顶层保存 `id`、`title`、`level`、`year`、`month` 和 `sections`。其中 `r` 对应言語知識・読解，`l` 对应聴解；每部分有 `title`、`shortTitle` 和 `groups`。

### 题组

| 字段 | 内容 |
| --- | --- |
| `id`、`number`、`title` | 稳定组 ID、原卷問題编号及标题 |
| `instruction` | 本组作答说明 |
| `questions` | 按原卷顺序排列的小题 |
| `blocks` | 阅读正文块，含 `label`、`html`、`questionIds` |
| `transcript` | 本组真实听力原文，交卷后显示 |
| `audioOnly` | 本组题干或选项需听录音作答 |

`blocks[].questionIds` 引用关联的小题 ID。HTML 只用于经过核对的正文、脚注和表格，不放脚本或外部跟踪资源。下划线用 `<u>` 表达。

### 小题

| 字段 | 内容 |
| --- | --- |
| `id` | 笔试如 `r-1`，听力如 `l-1-1`，卷内唯一 |
| `label`、`text` | 展示题号和题干 |
| `options`、`optionCount` | 选项文字及实际数量，通常为 3 或 4 |
| `answer` | 从 1 开始的参考答案编号 |
| `illustrationHtml` | 小题所需图示的展示内容 |
| `audioStart` | 最终运行音轨中的起点，单位为秒，可用小数 |
| `excludeFromScoring` | `true` 表示不参与评分 |
| `sourceNote` | 缺漏、疑义或修正依据，复盘时显示 |

录音中才有选项的题可使用空 `options`，仍应填写真实 `optionCount`。同段对话的两个小问各有独立 ID 和答案，共用 `audioStart`；加载器据此识别共用音轨，不另造两个起点。

来源不可靠的小题保留参考信息，用 `sourceNote` 说明具体问题，并设为不计分。不计分题不会进入正确率分母或错题跳转；不能靠填一个推测答案通过格式检查。

## 个人进度

进度格式为 `version: 1`，`attempts` 中每条记录有独立 `id` 和 `examId`。记录包括答案、题组笔记、检查标记、用时、页面位置及音频设置。最多保留 100 条作答记录。

浏览器主存储键为 `puuka-jlpt.practice.v1`；旧键由 `legacy-storage.js` 验证并迁移。服务器进度文件与浏览器存储都只在本机使用，导出的 JSON 才是跨电脑恢复入口。导入会替换记录，不做合并。

原始进度文件路径不作为静态文件开放；页面通过本机 `/api/state` 读写进度。不要把本机服务当成有账号隔离的多人服务器部署。

## 本机接口

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/health` | 检查服务是否运行 |
| `GET /api/exams` | 试卷目录与计算后的题量 |
| `GET /api/library-status` | 重新扫描并返回异常目录 |
| `GET /api/exams/:id` | 完整试卷内容 |
| `GET /api/exams/:id/audio-data` | 供内存播放器使用的音频数据 |
| `GET /exams/:id/assets/…` | 试卷运行资源，音频支持范围请求 |
| `GET /api/state`、`POST /api/state` | 读取和保存个人进度 |
| `POST /api/update/check` | 检查远端版本 |
| `POST /api/update/apply` | 安装程序更新，不修改题库 |

更新接口校验 Origin，并要求 `X-Puuka-Request: 1`。`exams/` 不是任意文件下载目录。试卷 ZIP 导入入口已经移除，个人进度 JSON 导入仍保留。

## 更新机制

固定更新源为[浙大 GitLab](https://git.zju.edu.cn/3240104224/puuka-jlpt-dojo)的 `master` 分支。程序更新器固定一次提交 SHA，再分页读取文件树，比较本机 Git blob SHA1，只下载变化的程序文件并核验哈希；`exams/` 不在允许范围内。

暂存和回滚备份位于项目 `tmp/`。程序文件写入失败会回滚。题库目录与每套试卷独立下载、校验和安装，见[程序与题库的维护](LIBRARY-MANAGEMENT.md)。

个人进度、便携运行环境、Git 元数据和制作断点不参与替换。程序的本地修改可能被程序更新覆盖，同 ID 试卷的修改可能被该卷更新覆盖，维护者应通过版本管理保存修改。更新后手动重启服务。

## 新增或修正试卷

1. 按 manifest ID 查重，检查是否已有制作断点或同套任务。
2. 在 `tmp/imports/<id>/` 整理题面、文章、脚注、图表、选项及独立答案，保留核对依据。
3. 核对音轨内容与版本。无法完整核验时按文字阅读版交付；整套文字也不可用时，记录缺件并跳过，不发布残缺卷。
4. 在最终运行音轨上核对报号和逐题起点，完成下述压缩检查。
5. 写入 `exams/<id>/exam.json` 及必要资源。候选 manifest 先在临时目录校验，确认后才放入正式目录，使试卷对页面可见。
6. 按 `tests/fixtures/` 的现有格式保存独立答案和内容基准；详细制作说明留在 `docs/imports/`。
7. 运行结构检查和 `npm test`，再用独立进度文件、端口做本机接口与页面验收，检查作答、交卷、复盘和资源加载。
8. 验收后记录收录范围，向题库仓库导出并提交试卷及目录，程序仓库只提交对应基准和必要文档。遵守 `.gitignore`，不强制加入制作文件或个人记录；推送后核对远端提交。

### 音频体积与校验

超过 96 kbps 的原始 MP3 可用现有 FFmpeg 的 `libmp3lame -q:a 2` 制作一次高质量 VBR 版本，保持采样率、声道、音量、停顿和完整时间轴，不裁切、加速或降噪。仅在实际变小、完整解码无误、时长差小于 0.1 秒且逐题定位核验通过时采用。

96 kbps 及以下、已经优化或无体积收益的音轨不反复有损转码。`exams/` 只留最终使用的一份音频；原件库保持不动，制作记录注明输入、输出参数、体积和核验结果。这是体积与听辨质量的折中，不是数学无损压缩。

制作和自动化验收禁止向扬声器输出音频。不点击播放或回听，不调用系统播放器；使用离线识别、解码和时间轴检查。需要实际播放时须另行获得明确授权。
