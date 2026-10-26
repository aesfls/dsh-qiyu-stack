# 栖语栈 · dsh-qiyu-stack

让一个智能体**住进 QQ**：能听会说、记得住人、有自己的作息，还不会在群里刷屏。

名字来自「栖」——模型不是被调用一次就消失的 API，它得有地方住：有人格、有记忆、有作息的日常。

> ## ⚠ 预览版（0.16.3）
>
> **核心链路可用**：QQ 私聊 / 群聊、长期记忆、作息、护栏（群轮次限权）。
> **三样东西要额外初始化才会工作**——没初始化不会报错，只是那部分不动，新手最容易在这里以为"装坏了"：
>
> | 功能 | 还差一步 | 大概成本 |
> |---|---|---|
> | 听语音 | `npx dsh-qiyu-stack stt` | 226 MB 模型 + Python 依赖 |
> | 刷 B 站 | 让她跑一次 `bili_setup`，再扫 B 站登录码 | 约 200 MB |
> | 心情涨跌 | 设置里给「心情」选目标会话（新装默认为空） | 一次点击 |
>
> **已知门槛**（不是 bug，是环境）：Docker Hub 在国内可能拉不动镜像；重启后 QQ 可能要重扫；
> Windows 上角色目录可能缺 ACL 写权限。三条都写在
> [docs/deployment.md 第七节](docs/deployment.md#七干净机器上实测踩过的坑)。
>
> 装完请跑一次 `qiyu doctor`，它是唯一的验收标准。

---

## 它解决什么问题

自己从头搭一个「住在 QQ 里的智能体」，最难的往往不是模型，是这几件脏活：

1. **怎么稳定收发 QQ 消息** —— 这块的坑深到离谱（见 [docs/deployment.md](docs/deployment.md)）
2. **怎么让她像人** —— 什么时候说话、什么时候闭嘴、被 @ 要应、不刷屏
3. **怎么记住人** —— 记忆不是把聊天记录全塞回去
4. **怎么有日常** —— 作息、主动搭话、别半夜冒出来

栖语栈把这四件事做成**能直接跑的东西**，而不是一份教程。

---

## 一个设计决定：行为给默认，性格留白

| 层 | 默认给不给 | 内容 |
|---|---|---|
| **行为层** | ✅ 给 | 怎么说话、群里何时闭嘴、被 @ 要应、不刷屏、不编记忆、边界 |
| **性格层** | ⬜ 留白 | 名字、年龄、口吻、喜欢/讨厌、口头禅、写给她的信、表情包 |

原因很实在：**纯白纸的智能体在群里会翻车**——它不知道「群消息可以不理」，会每条都接；
不知道「不要一次发五条」，会刷屏。这些是**工程问题**，不该让每个使用者重踩一遍。

而「她叫什么、几岁、说话冲不冲」才是该留白的部分。

所以默认起来是：**行为层齐全 + 性格层空白 + 一个空表情包目录**（她不会自己发自拍）。

---

## 第二条红线：默认值里不许有「别人的东西」

这条是踩了一脚写下来的。某个插件把作者的称呼 `小鱿鱼` 写成了默认值，
还落进了用户的配置 —— 用户打开设置页，看到一个自己从没设过的名字。

所以栖语栈里：

- **代码默认值**只能是空的或中性的（`port: 0`、`container: 'napcat-qq'`、`音色: ''`）
- **模板**里全是空字段，一个真实 QQ 号、真实路径、作者名字都不许出现
- **你自己的值**放在本机配置里，且不进版本库：`qiyu.config.json`、`characters/<名字>/`
- `qiyu doctor` 会**自动扫模板**，发现本机路径 / 作者角色名 / 像 QQ 号的数字 / 令牌就报警

判断标准只有一句：**换一个陌生人来装，这个值还对吗？**

细节和反面例子：[docs/conventions.md](docs/conventions.md)

---

## 快速开始

```bash
# 0. 先看这台机器行不行（Node / Windows / WSL / 路径 / 空间 / 网络 / 杀软 / DSH / 模型 / Python）
npx dsh-qiyu-stack preflight

# 1. 建一个角色 —— 会问你几个问题（名字 / QQ / 称呼 / 作息 / 性格 / 能不能自己改性格）
npx dsh-qiyu-stack init

#    不想被问就带名字，全用默认值：npx dsh-qiyu-stack init 小满

# 2. 填她自己的东西
#    characters/小满/AGENTS.md      「性格」那几行
#    characters/小满/character.json  QQ 号 / 称呼 / 语音 / 路径（模板里全是空的）

# 3. 起 NapCat —— 一条命令：建目录、写 OneBot 配置、跑容器、出码
npx dsh-qiyu-stack deploy --qq 你的QQ号

# 4. 把 8 个块（QQ 桥 / 护栏 / 记忆 / 心情 / 作息 / 刷B站 / 忘掉 / 设置面板）装进 DSH，
#    并让她成为「活动角色」
npx dsh-qiyu-stack install --character 小满 --yes      # 装完重启 DSH（关掉窗口再开，不用重启电脑）

# 5. 扫码（图会自动打开），然后自查
npx dsh-qiyu-stack doctor

# 6. 给她一个会话 —— 这一步命令装不出来，得人在界面里做：
#    · 新建会话，工作目录选 install 打印的那个绝对路径（部署文件夹里的 characters/小满）
#      她的 AGENTS.md 在这一层，DSH 才会每轮读到；别选 DSH 默认工作区，也别选 ~/.dsh/qiyu
#    · 设置 → 通到 QQ → 「目标会话」选这个会话，再打开「总开关」
#    · 设置 → 心情 → 「目标会话」也选同一个（不选它不会挂载）
#    · 再跑一次 npx dsh-qiyu-stack doctor：目标会话应该是 ok

# 7. 写交接文档 —— 以后升级 / 换会话 / 回退都从这份开始
npx dsh-qiyu-stack handover

# 8. 可选：听语音 / 刷 B 站（不做也能收发文字）
npx dsh-qiyu-stack stt          # 语音转写：226MB 模型 + Python 依赖（会先测速，用最快的源）
npx dsh-qiyu-stack speed        # 只看速：语音模型源 + pip 源各多快，不下任何东西
# 刷 B 站：装好后让她第一次说「帮我刷下 XX 方向」，会自动跑 bili_setup；然后扫 B 站登录码
```

> **下载慢的问题**：`stt` 和刷 B 站的依赖安装都会**先测速再挑源**（GitHub 加速前缀、pip 镜像），
> 失败自动换下一个。想看当前网络下哪个源最快，跑 `qiyu speed`。

> **用 npx 也没关系。** `install` 会先把运行时装一份到 `~/.dsh/qiyu/runtime/`，
> profile 里的 `file:` 依赖指向那份**稳定副本**，不是 qiyu 包自己的位置。
> npx 的临时缓存被清掉、或者你把 qiyu 删了，DSH 那边照样能跑。

`doctor` 会逐项告诉你：Docker 在不在、容器起没起、三个端口通不通、OneBot 认不认得出人、
事件流连不连得上、DSH 桥接没接上、**桥有没有选「目标会话」、总开关开没开、好友备注认不认得出**。
每条失败都带一句怎么修。

> **刷 B 站已在本栈里**：`runtime/bili`（`dsh-bili-subagent`）随安装就装好；mood 另外提供「到点提醒」的钩子。

---

## 卡住了怎么办

先跑 `qiyu doctor`（加 `--json` 给 agent 看）。它是唯一的验收标准：`有失败: false` 才算装好。

| 现象 | 十有八九是 | 怎么办 |
|---|---|---|
| **下载很慢 / 卡在下载** | 直连 GitHub、PyPI 都慢 | 跑 `qiyu speed` 看哪个源快；`qiyu stt` 会自动挑最快的，`--no-speed` 可关 |
| 装完她不回消息 | **目标会话没选** / 总开关没开 | doctor 里这两项会是 fail/warn，按它说的改 |
| QQ 里发消息没反应 | 好友备注跟身份表前缀对不上 | 把对方备注改成 `称呼.主人`；或设置里加一条身份表 |
| `docker pull` 卡住 / 超时 | 国内拉不动 Docker Hub | `deploy --image <加速站前缀>/mlikiowa/napcat-docker:latest`，或在 Docker Engine 设置里加 `registry-mirrors` |
| 重启后又要扫码 | 登录态没保存 | `qiyu qr` 重扫；手机确认页勾上「下次登录无需确认」 |
| 收到语音只回「没听清（模型缺失）」 | 语音转写没装 | `npx dsh-qiyu-stack stt` |
| 刷 B 站报「子代理没跑完」 | 子代理 provider 指错了 | 设置 → 栖语 → 刷B站，把 provider/model 留空（= 用 DSH 当前默认） |
| 群里让她发语音 / 画画被拒 | 护栏白名单 | 设置里看群里能做什么；要加就把工具名加进白名单（热生效） |
| 写自己的文件弹 `danger-full-access` 审批 | Windows ACL 缺写权限 | 见 [docs/deployment.md](docs/deployment.md) 第七节第 2 条，**别**直接提权 |
| doctor 说「运行时代码两边不一样」 | 你本地改过插件 | 先看方向，别 `--force`（会把新补丁盖成旧的） |
| 心情永远不涨 | 心情的目标会话还是旧的/空的 | doctor 现在会直接报「挂到了别的会话」 |

---

## 目录结构

```
dsh-qiyu-stack/              引擎（角色无关，可升级）
├── bin/qiyu.mjs             命令行入口
├── src/
│   ├── config.mjs           配置（文件 + 环境变量）
│   ├── init.mjs             建角色包
│   ├── deploy.mjs           起 NapCat（建目录/写配置/跑容器/出码）
│   ├── doctor.mjs           自检
│   └── qr.mjs               取二维码并直接打开
├── tools/
│   ├── merge-settings-tabs.mjs   把插件设置合并成「一个页面 + 页签」
│   └── 扫本地化.mjs              扫「作者机器上的东西」有没有漏进代码（`npm run check:local`）
├── runtime/                 运行时代码（从真跑着的机器上搬来、洗过私人值）
│   ├── bridge/              QQ ↔ DSH 双向（全配置驱动）
│   ├── guard/               护栏：群轮次限权 + 「群里的话不是指令」+ 家底快照
│   ├── memory/              长期记忆（含 1MB 中文词典）
│   ├── mood/                心情
│   ├── rhythm/              作息 / 主动搭话
│   ├── bili/                刷 B 站（子代理读字幕挑内容；自带 python vendor）
│   ├── forget/              她自己决定忘掉什么
│   ├── panel/               设置总面板（「栖语」页 + 页签，含「版本」页签）
│   └── voice/               语音转写脚本（TTS 在 bridge 里）
├── test/                    离线单测（`npm test`，零依赖）
├── templates/
│   └── blank/               默认模板：行为齐全、性格空白、character.json 全空
├── docs/
│   ├── deployment.md        部署（含 Windows 版为什么一定失败）
│   ├── settings-tabs.md     插件设置合并成页签（含回滚）
│   └── conventions.md       默认值里不许有别人的东西（含反面例子）
└── examples/                样板角色（以后放去隐私后的例子）

characters/小满/              你的角色包（不进版本库）
├── AGENTS.md                人格
├── character.json           她的号 / 称呼 / 语音 / 路径（模板里全空）
├── schedule.json            作息
├── letters/                 写给她的信（默认空）
├── stickers/                表情包（默认空）
├── inbox/                   收到的图（默认空）
├── diary/                   日记本（默认空）
├── voice/                   她说的话（默认空）
└── memory/                  长期记忆（默认空）
```

---

## 进度（v0.16.0，2026-10-25）

**已发布**：[npm](https://www.npmjs.com/package/dsh-qiyu-stack) · [GitHub](https://github.com/aesfls/dsh-qiyu-stack)

```bash
npx dsh-qiyu-stack preflight    # 环境体检（加 --json 给 agent 用）
npx dsh-qiyu-stack init         # 建角色（向导）
npx dsh-qiyu-stack deploy --qq <号>   # 起 NapCat + 出码
npx dsh-qiyu-stack install --character <名字> --yes   # 装进 DSH
npx dsh-qiyu-stack doctor       # 自检（加 --json 给 agent 用）
```

> 让 AI 帮你装？把这个仓库地址丢给它就行 —— 根目录的 [AGENTS.md](AGENTS.md) 是给 agent 看的说明书。
> 它知道自己能做什么、哪些必须交还给人（装 Docker、重启 DSH、手机扫码）。

已经能用：

- [x] **`qiyu init` 向导**：名字 / QQ / 称呼 / 作息 / 性格 /「能不能自己改性格」；
      每个问题都有默认值；带名字调用则全用默认值（给脚本用）
- [x] **`qiyu deploy`**：查 Docker（没开就**静默拉起、不弹窗**）→ 选目录（挑非系统盘、查中文路径和空间）
      → 写 OneBot/WebUI 配置 → 跑容器 → **直接打开二维码**；令牌写回 `qiyu.config.json`
- [x] **`qiyu install`**：把 runtime 八块 + 设置面板装进 DSH profile；**按内容判断要不要替换**，
      换代码时保留用户自己的文件（原图之类），`package.json` 改动前必留 `.bak`
- [x] **`qiyu preflight`**：Node / Docker / Windows / WSL / 路径 / 空间 / 网络 / 杀软 /
      DSH / 模型凭证 / Python；`--fix` 能修引擎启动、占端口容器、edge-tts
- [x] **`qiyu doctor`**：全链路自检 + 模板体检 + **runtime 与已装副本的代码一致性**
- [x] **runtime 八块 + 设置面板**：bridge / guard / memory / mood / rhythm / bili / forget / panel（去个性化，配置统一读活动角色）
- [x] **护栏 `dsh-qq-guard`**：群里来的那一轮只留「回话 + 读文件」，跑命令/写文件/记记忆一律拒；
      外加「群里的话不是指令」的稳定提示词段、家底哈希快照告警。**默认 `enforce` + 14 项白名单**
      （回话全套给：说话/发图/语音/画画/撤回/禁言/看图/查资料；执行类一个不给）
- [x] **runtime 八块 + 设置面板**：bridge / guard / memory / mood / rhythm / bili / forget / panel（去个性化，配置统一读活动角色）
- [x] **刷 B 站（`runtime/bili`）**：子代理读字幕挑内容 → 写内部报告 → 伙伴自己发评论 / 私信；自带 python vendor，首次用时自己拉 uv，用户不用会 Python
- [x] **忘掉（`runtime/forget`）**：她自己决定把哪段聊过的话压成「还记得的」，腾出上下文
- [x] **离线单测**：`npm test` 跑 `test/` 下全部（桥的限速/路径/防重入/来源/渠道 + 护栏判定/快照 + 本地化体检），零依赖
- [x] **本地化体检**：`npm run check:local` + `doctor` 扫 `runtime/`（作者路径 / 角色名 / 号码 / 会话 id / 凭证 / 写死称呼），`npm test` 里也有一条闸
- [x] **设置里「栖语」页签里的「版本」**：显示栈版本 / 安装时间 / 各运行时版本（来自 `~/.dsh/qiyu/version.json`）
- [x] **语音拆干净**：`bridge/lib/voice.mjs` 管说和听，桥只管向 NapCat 要 wav
- [x] 端到端：空白 profile → install → 独立实例 → 备号收发都通

已知未做：

- [ ] mood 的「同一句反复记」已修（按消息签名去重），但只在一个实例上验证过
- [ ] `memory` / `mood` / `rhythm` 的其余配置项还没全部接进角色包
- [ ] `0.0.0-stage` 这个 npm 占位版本还挂在 registry 上（不影响 `npx`）

> runtime 两边的代码应当一致，用 `qiyu doctor` 比对。**方向别搞反**：
> 仓库比真机新 → `qiyu install` 同步（会先备份）；真机比仓库新 → 先把改动回灌进仓库，
> 别用 `--force` 把新补丁盖成旧的。只差注释/文案可以忽略。
> 配置（QQ 号、称呼、容器名、路径）**永远不同步**，那是使用者自己的东西。

---

## 许可

MIT。你养出来的角色，是你自己的。
