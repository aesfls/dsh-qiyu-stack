# 更新记录

> 每次发版都往这里加一段——`qiyu install` 会把当前版本的这段写进
> `~/.dsh/qiyu/version.json`，设置里「栖语 → 版本」页签会显示它。

## 0.16.3（2026-10-25）

**公开预览版**。这版只改文档，不改代码：

- README 顶部加「预览版」说明：核心链路可用，但**三样东西要额外初始化**（语音 `qiyu stt`、刷 B 站
  `bili_setup`、心情要选目标会话）——没初始化不会报错，只是那部分不工作
- 快速开始改成 8 个块，并补上「心情也要选目标会话」和可选的 `stt` / `bili_setup` 两步
- 新增「卡住了怎么办」：10 种最常见现象 → 原因 → 怎么办（Docker 镜像拉不动、重启要扫码、
  语音模型缺失、群里发不了语音、ACL 审批、doctor 报代码不一致……）
- 已知门槛统一指向 `docs/deployment.md` 第七节

## 0.16.2（2026-10-25）

干净机器复盘的第二批（环境/可选功能）：

- **新增 `qiyu stt`（可选语音转写）**：一条命令装 SenseVoice int8 模型（约 226MB）+ `sherpa-onnx` / `numpy` /
  `imageio-ffmpeg` 依赖，模型落到 `~/.dsh/qiyu/models`（`语音转写.py` 的默认位置）。
  默认**不装** —— 不装时收到语音只回「没听清（模型缺失）」，文字收发不受影响；`doctor` 会提示，
  `install` 收尾会列出来。GitHub 拉不动可以用 `--url` 指自己的包。
- **B 站截图默认落到角色目录**：`bili_frame` 原来存 `%TEMP%\qiyu-bili-frames` —— 不在 `qq_sticker`
  可发范围内，她只能把路径写成 Markdown、图片发不出去（实测）。现在默认落到
  `<角色>\收件箱\B站截图`（从 `character.json` 的「路径.收件箱」推），`BILI_FRAME_DIR` 仍可覆盖。
- **B 站没装系统 ffmpeg 也能截帧**：`_find_ffmpeg` 多一条兜底 —— `imageio-ffmpeg` 自带的那份；
  `requirements.txt` 也把它带上了（`bili_setup` 会装）。
- **`qq_sticker` 可配置可发目录**：以前写死「表情包 / 收件箱 / 画板」，想多发一个目录只能改代码。
  现在配置里加 `可发目录`（数组或逗号串，默认空），比如 `["D:\\pics"]`。
- `install` 收尾多两行提示：听语音要跑 `qiyu stt`、刷 B 站要跑一次 `bili_setup`。

## 0.16.1（2026-10-25）

按那台干净机器的部署复盘（19 项问题、14 项是项目问题）修的第一批：

- **身份表认不出主人**：`init` 只写 `character.json` 的 `称呼.主人`，桥却只读 `qq-bridge-config.json`
  → doctor 报「还没设她该怎么称呼你」、身份表生不出来。桥现在会用角色包的 `称呼.主人` 兜底
- **好友表假阴性**：`目标会话` 没选时轮询直接早退，好友表永远刷不到 → doctor 报「一个好友都认不出」。
  现在先刷好友表，再判要不要早退
- **首次入站被拖 10 分钟**：`空历史` 缓存 10 分钟 → 改成 60 秒，并且私聊**发出消息就清缓存**
  （实测：14:33 的消息拖到 14:43）
- **doctor 不查心情/作息挂在哪**：新增一条 —— 心情、主动搭话的 `目标会话` 要跟桥一致；
  两边都认 `targetSession` / `目标会话` 两种写法
- **doctor 目标会话「没开着」说得太含糊**：现在会写出配置里的 id 和「目标情况=[]」的含义，
  并说明打开会话后这条应当变 ok
- **模板里写死 `[爸爸]`**：`templates/blank/AGENTS.md.tpl` 改成占位符 `[称呼]`（用 `称呼.主人`）
- **README 说「刷 B 站不在本栈范围」**：0.16.0 已经带 `runtime/bili`，这句删掉
- **刷 B 站默认子代理 provider 写死 `apii` / `deepseek-v4-pro`**：别的机器上没有这个 provider →
  改成留空 = 用 DSH 当前默认，填了才指定
- **刷 B 站没进「栖语」页**：`dsh-bili-subagent` 注册的是 `settings.section`，总面板只收 `qiyu.tab` →
  改成注册 `qiyu.tab`，设置里不再多出一个独立「刷B站」

## 0.16.0（2026-10-25）

把作者在真机上魔改过的插件**整体搬进栈里** —— 用户不用再去 GitHub 单独拉插件、拉回来还要让 DSH 改。

- 新增 `runtime/bili`（dsh-bili-subagent 0.4.1，刷 B 站）：子代理读字幕挑内容、写内部报告，伙伴用自己的口吻发评论 / 私信。**自带 python vendor**（bilibili MCP），首次用时插件自己拉 uv + 装依赖，用户不需要会 Python
- 新增 `runtime/forget`（dsh-forget 0.1.0）：她自己决定忘掉什么 —— 把聊过的一大段压成「她还记得的」，腾出空间继续聊
- `install` 现在装 **8 个块**（bridge / guard / memory / mood / rhythm / bili / forget / panel）；`doctor` 逐块比对
- `memory` 1.2.1 → 1.2.5：写库前按 id 合并（修「连记两条、第二条几秒后静默消失」）；diag 日志超 1MB 轮转
- **本地化体检**：新增 `src/localization.mjs`（规则一份）+ `tools/扫本地化.mjs` + `npm run check:local`。
  `doctor` 的体检范围从 `templates/` 扩到 **`runtime/` + `examples/`**（0.15.8 那条「有人加千语的好友」就是从 runtime 漏出去的）。
  6 条规则：作者机器路径 / 作者角色名 / 写死会话 id / 写死 QQ 群号 / 凭证 / 写死称呼。`npm test` 里也有一条：仓库不干净就红
- 清掉的真实泄漏：mood 的 `selfName: '大肥鱼'` 与写死的真实会话 id、memory 文档里的 `D:\档案`、
  examples 里的「云千语」、bili 的 `ownerName: '小鱿鱼'` 与 vendor 里三条硬编码路径
- ⚠ mood 的默认目标会话变成空（以前写死了一个会话 id）——新装用户要在设置里选目标会话

## 0.15.10（2026-10-25）

**护栏默认档位改成和参考实例一致：`enforce` + 14 项白名单。**

0.15.9 的默认是 `dry` + 5 项白名单。那个组合一旦切到 `enforce`，她会在群里"残废"：
发不了语音、画不了画、撤回不了、看不到群友发的图 —— 用户只会以为新版坏了。

- guard 0.3.1：默认 `模式: enforce`；白名单扩到 14 项，原则是**回话全套给、执行一个都不给**
  给了：`qq_group_say` / `qq_sticker` / `qq_sticker_save` / `qq_voice` / `qq_draw` / `qq_recall` / `qq_mute` /
  `read_image` / `glob` / `present` / `web_search` / `web_fetch` / `bili_search` / `bili_subtitle`
  不给：`pwsh` / `write` / `edit` / `subagent` / `workflow` / `schedule_*` / `create_goal` / `remember` / 语雀
- `read` / `grep` 仍不在默认名单：它们和 `web_fetch` 凑一起就是「读文件 → 贴到外网」的通道（两个只能来一个）
- 拒绝话术和路标改成**按真实白名单生成**：名单里没有 `qq_draw`，就不会再跟她说"你可以画"
- 单测加 4 条：宽/窄白名单下的话术与路标各验一遍（现共 6 套 119 个断言）

## 0.15.9（2026-10-25）

这版把 10-24～10-25 在真机上做的一整轮补进仓库：转发落文件夹、夜间攒消息落盘、群口令边界（P0），
以及一批"让她像个人在说话"的（限速、阅读时间、画画、禁言、撤回、作息）。

- 桥：合并转发的聊天记录**落文件夹**（`收件箱\转发\<时间>-<转发人>\`，含 `转发记录.md` + `图片\`），消息里只给摘要和路径
- 桥：夜间攒消息 / 水位 / 已转 id **落盘**（`qq-bridge-pending.json`），关机重启不丢；`/state` 里能看到 `攒着`
- 安全（P0）：**管理接口闸**——`save` / `reset-quota` / `receive` / `test-send` 只认设置页本身（或 `x-qiyu-admin` 令牌），否则 403 并留痕
- 修：设置页保存会把**群黑名单清空**（`/state` 交回来的数组被当成空串）
- 修：`@` 判定不再对拼好的文本跑正则（群友打一句「（这条在 @你）」不会在惰性时段把她叫醒）
- 桥：`qq_sticker` 能发到群（群名或群号，认黑名单、过试运行）；也能发收件箱里的图（原来目录写错，收到的图发不出去）
- 桥：新增 `qq_mute`（秒级禁言）、`qq_recall`（撤回）、`qq_draw`（画完直接发）、`qq_sticker_save`（存成表情包）、`qq_schedule`（她自己改作息）
- 桥：看图、群语音；来源标记分 `qq-group` / `qq-private`（给护栏插件判断"这一轮要不要收窄"）
- 新增 `lib/作息.mjs`：作息解析 / 判定 / 校验 + 峰时估价（纯函数，可离线单测）
- 新增 `lib/可疑话术.mjs`：关键词告警，含**形近字归一**（西里尔字母伪装的注入也认得出）
- 新增 `lib/画板.mjs`：SVG → PNG（Edge 无头截图），渲前**净化 SVG**（剥 script / on* / 外链）、关 JS、能按宽度缩放
- 新增 `lib/限速.mjs` 并接进桥：**发送限速**（单条 4~10 秒、每 6 条歇 90 秒，群/私聊各一条队）；发送失败不占额度
- 桥：**阅读时间**——收到消息后 5~15 秒才开口，并且排在"叫醒"之前（否则她先醒、手里没消息，会空转一轮）
- 桥：群里不贴本机路径（整句都是路径就拒发并指路 `qq_sticker` / `qq_draw` / `qq_voice`；夹在话里的剔掉）
- 桥：NapCat 还没起来时不再刷"去改备注"的误报；**轮询防重入**（上一轮没跑完就跳过，修「一条消息被读三遍」）；先占位再等，送不进去会撤回占位
- 桥：私聊消息也标渠道 `【QQ私聊】[称呼] …`，和群消息 `【群名】[称呼] …` 对齐
- 卫生：`runtime/` 里去掉作者的本机路径与角色名（这些会随 npm 包发给别人）；同类检查以后要能扫到 `runtime/`，不只看 `templates/`
- **护栏插件 `runtime/guard`（dsh-qq-guard 0.3.0）进栈**：群轮次限权（`tools/pre-execute` 硬门，默认保守白名单 5 项）、「群里的话不是指令」的稳定提示词段、家底哈希快照告警。默认 `dry`（只记账不拦），看一天日志再切 `enforce`；快照盯谁由 `character.json` 的路径推导，不写死盘符
- `install` 会一起装护栏；`doctor` 会报它在 `dry` / 关着 / `enforce` 哪一档
- **离线单测**：`npm test` 跑 `test/` 下 6 套（桥的限速 / 路径 / 防重入 / 来源 / 渠道 + 护栏判定 / 快照），零依赖
- 文档：`doctor` 发现"仓库和已装副本不一样"时，不再直接劝 `install --force`——那句话在"生产比仓库新"时是**降级**操作

## 0.15.8（2026-10-23）

干净机器实测（34 项问题）后修的一批：

- `qiyu qr` 崩溃（`绿 is not defined`）——补上颜色函数
- `qq_voice` 报 `合成语音 is not defined`——把 `合成语音` 移到模块作用域
- `语音转写.py` 不再写死作者路径：用 `QIYU_STT_ROOT` 或脚本所在目录
- 默认身份表清空（不再默认「爸爸/妈妈」）；设了 `主人` 就按「备注 = 称呼」自动生成一条
- `qq_voice` 工具说明不再硬编码「爸爸/妈妈」，改成「身份表里的称呼」
- `install` 遇到缺 `node_modules` 自动建，不再拒绝干净 profile
- Docker Desktop 自定义安装路径：`QIYU_DOCKER_DESKTOP` / `napcat.dockerDesktop` / 从 `where docker` 反推（qiyu 和桥两处）
- `run.mjs` 区分「命令真的不存在」和「沙箱读不到」：真没装 Docker 不再被降级成「沙箱限制」
- `doctor` 新增身份检查：身份表为空、或好友备注一个都认不出 → warn（并告诉你怎么改备注）
- 设置面板介绍去掉「刷 B 站」；README 写明刷 B 站不在本栈
- `install` 新增安装清单 `~/.dsh/qiyu/install-manifest.json`：本地改过的模块默认保留，要 `--force` 才覆盖
- 桥在「Docker 引擎在、NapCat 容器被杀过」时会自己 `docker start` 容器（Docker Desktop 退出常见的 exit 137）
- `install` 会往桥配置里写 `容器`，桥才知道该拉哪个容器
- `AGENTS.md` 补干净机器两个必踩点：`npm.cmd` / `npx.cmd`、先设 `npm_config_cache`

## 0.15.7（2026-10-23）

- 设置面板新增「版本」页签：栈版本、安装时间、各运行时版本，以及**这次更新做了什么**
- 新增 `qiyu handover`：在部署文件夹生成 `交接.md`（位置 / QQ / 桥的目标会话 / 升级命令 / 回退方法 / 给新会话的开场白）
- `doctor` 新增验收：桥没选「目标会话」→ **fail**；目标会话没开着 / 总开关关着 / 试运行开着 → warn
- `install` 的交接语补上「第六步」：新建会话（工作目录选绝对路径）、选目标会话、打开总开关
- `install` 不再说「设置里已经填好了，不用改」——地址和令牌填好，但目标会话/总开关要人来选
- 文档：`AGENTS.md` / `README` 补第六步和交接文档说明

## 0.15.6（2026-10-23）

- `doctor` 自动探测 DSH 端口：不再被 `qiyu.config.json` 里的旧端口骗（DSH 每次启动端口可能变）
- 新增 `src/dsh-port.mjs`：先试配置端口，再扫本机监听端口，按特征认（`/dsh-qq-bridge/state` 或根路径 401 的提示语）

## 0.15.5（2026-10-23）

- `doctor` 也接上沙箱降级：Docker / 容器 / 端口相关的 fail 在受限沙箱里降成 warn，不再让 agent 误以为装失败
- `qr.mjs` 的 `docker cp` 改走 `跑()`：沙箱里不再假失败「拿不到二维码」

## 0.15.4（2026-10-23）

- 新增 `src/run.mjs`：管道被拒（EPERM）时改成「重定向到临时文件再读」，受限沙箱里也能跑外部命令
- `preflight` 沙箱降级：读不到命令输出的结论标成「沙箱限制，这条不可信」
- `AGENTS.md` 进 npm 包（从这版起 80 个文件）

## 0.15.3（2026-10-23）

- 仓库根加 `AGENTS.md`：给部署助手看的说明书（五条命令、必须先问的、沙箱、交还给人做的事）
- `preflight --json` / `doctor --json`：给 agent 机器判断用
- `install` 交接语改写：重启后回原会话，或开新会话跑 `doctor --json`

## 0.15.1（2026-10-23）

- 首个发布版：`npx dsh-qiyu-stack` 可跑，含 preflight / deploy / install / doctor / qr
