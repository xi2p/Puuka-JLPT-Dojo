# 程序与题库的维护

程序仓库：[puuka-jlpt-dojo](https://git.zju.edu.cn/3240104224/puuka-jlpt-dojo)。题库仓库：[puuka-jlpt-dojo-lib](https://git.zju.edu.cn/3240104224/puuka-jlpt-dojo-lib)。两者独立发布，程序 ZIP 不含试卷或音频。

## 用户端

首次启动会读取本机目录，再联网刷新远端题库目录；刷新失败时继续使用上次缓存和已下载试卷。刷新目录只传输元数据，不下载音频。首页显示未下载、已下载、有更新三种状态，可以按级别、年份和下载状态筛选，选择一套或多套下载。

下载后的试卷位于本机 `exams/`，无需重启即可作答。移除本机试卷不删除个人记录；重新下载同 ID 后可继续使用原记录。程序更新不会下载、替换或删除试卷。

## 题库仓库

```text
catalog.json
exams/
  n1-2024-12/
    manifest.json
    exam.json
    assets/listening.mp3
```

目录格式为 `schemaVersion: 1` 和 `exams` 数组。每卷包含题量、收录范围、参考时间，以及 `files: [{path, size, sha256}]`。`revision` 根据文件清单计算，分别判断每套题库是否变化。目录本身不存程序版本；程序仍使用 `.runtime/version.json`。

题库 Git 属性使用 `* -text`，保留文件原始字节。不要开启自动换行转换后直接推送，否则目录里的 SHA256 会与远端文件不符。

## 发布题库

在程序项目的本机 `exams/` 完成制作和验收后：

```sh
node scripts/check-exams.js
npm test
node scripts/export-library.js <题库仓库的本机目录>
```

导出脚本校验试卷、仅复制运行文件，并重新生成 `catalog.json`，不执行 Git 操作。确认目录和试卷一致后，在题库仓库一起提交并推送。若仅需核对目录，可运行：

```sh
node scripts/build-library-catalog.js exams tmp/library-export/catalog.json
```

本机 `exams/` 已被程序仓库忽略，不要强制添加。题源、识别结果、临时文件和个人记录都不进入这两个仓库。题库下架时应从题库仓库删除对应目录并重新生成目录；客户端不会因此自动删除已经下载的试卷。

## 下载与保护

`scripts/library-manager.js` 使用题库仓库固定的一次提交读取目录与文件，避免下载过程中远端更新造成混版。先在项目 `tmp/` 暂存，逐文件检查大小和 SHA256，再通过试卷结构、ID 与题量检查，之后才替换本机目录。更新失败保留旧卷；批量下载中已经完成的卷保留，未完成的卷不进入题库。

已有本机试卷按 manifest ID 识别，无需重新下载。文件哈希相同的内容在更新时直接从本机复制。缓存目录保存在 `.runtime/library-catalog.json`，只用于离线展示和选择；本机试卷状态会重新检查，不以程序提交号推测。

| 接口 | 用途 |
| --- | --- |
| `GET /api/library/catalog` | 合并远端缓存与本机试卷状态，不主动联网 |
| `POST /api/library/refresh` | 刷新远端目录，不下载试卷 |
| `POST /api/library/download` | 下载请求中的 `ids` 数组 |
| `GET /api/library/download-status` | 当前文件、进度、已完成卷和错误 |
| `POST /api/library/remove` | 按 `id` 移除本机运行文件，保留进度 |

所有变更接口校验本机 Origin 和 `X-Puuka-Request: 1`，不接受任意仓库或下载地址。程序更新与题库变更互斥，文件路径和大小受限。所有下载来自固定 GitLab 项目，不上传本机题目、音频或作答记录。

## 本次迁移

59 套已验收试卷迁入题库仓库。程序仓库重建为不含 `exams/` 的新历史；旧克隆如需继续用于开发，应重新克隆程序仓库，并保留原本机 `exams/`、`data/` 和进度备份。不要将旧历史合并回新分支。GitLab 服务器上不可达旧对象的最终清理由平台管理，不影响新版程序 ZIP 的体积。
