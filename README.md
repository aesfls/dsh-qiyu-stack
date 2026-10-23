# 栖语栈 · dsh-qiyu-stack

让一个智能体**住进 QQ**：能听会说、记得住人、有自己的作息，还不会在群里刷屏。

名字来自「栖」——模型不是被调用一次就消失的 API，它得有地方住：有人格、有记忆、有作息的日常。

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

# 4. 把运行时（QQ 桥/记忆/心情/作息）装进 DSH，并让她成为「活动角色」
npx dsh-qiyu-stack install --character 小满 --yes      # 装完重启 DSH（关掉窗口再开，不用重启电脑）

# 5. 扫码（图会自动打开），然后自查
npx dsh-qiyu-stack doctor

# 6. 给她一个会话 —— 这一步命令装不出来，得人在界面里做：
#    · 新建会话，工作目录选 install 打印的那个绝对路径（部署文件夹里的 characters/小满）
#      她的 AGENTS.md 在这一层，DSH 才会每轮读到；别选 DSH 默认工作区，也别选 ~/.dsh/qiyu
#    · 设置 → 通到 QQ → 「目标会话」选这个会话，再打开「总开关」
#    · 再跑一次 npx dsh-qiyu-stack doctor：目标会话应该是 ok

# 7. 写交接文档 —— 以后升级 / 换会话 / 回退都从这份开始
npx dsh-qiyu-stack handover
```

> **用 npx 也没关系。** `install` 会先把运行时装一份到 `~/.dsh/qiyu/runtime/`，
> profile 里的 `file:` 依赖指向那份**稳定副本**，不是 qiyu 包自己的位置。
> npx 的临时缓存被清掉、或者你把 qiyu 删了，DSH 那边照样能跑。

`doctor` 会逐项告诉你：Docker 在不在、容器起没起、三个端口通不通、OneBot 认不认得出人、
事件流连不连得上、DSH 桥接没接上、**桥有没有选「目标会话」、总开关开没开、好友备注认不认得出**。
每条失败都带一句怎么修。

> **刷 B 站不在本栈范围**：那需要另装 `dsh-bili-scroll`；这里的 mood 只提供「到点提醒」的钩子。

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
│   └── merge-settings-tabs.mjs   把插件设置合并成「一个页面 + 页签」
├── runtime/                 运行时五块 + 设置面板（从真跑着的机器上搬来、洗过私人值）
│   ├── bridge/              QQ ↔ DSH 双向（全配置驱动）
│   ├── memory/              长期记忆（含 1MB 中文词典）
│   ├── mood/                心情
│   ├── rhythm/              作息 / 主动搭话
│   ├── panel/               设置总面板（「栖语」页 + 页签，含「版本」页签）
│   └── voice/               语音转写脚本（TTS 还在 bridge 里，待拆）
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

## 进度（v0.15.1，2026-10-23）

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
- [x] **`qiyu install`**：把 runtime 四块 + 设置面板装进 DSH profile；**按内容判断要不要替换**，
      换代码时保留用户自己的文件（原图之类），`package.json` 改动前必留 `.bak`
- [x] **`qiyu preflight`**：Node / Docker / Windows / WSL / 路径 / 空间 / 网络 / 杀软 /
      DSH / 模型凭证 / Python；`--fix` 能修引擎启动、占端口容器、edge-tts
- [x] **`qiyu doctor`**：全链路自检 + 模板体检 + **runtime 与已装副本的代码一致性**
- [x] **runtime 四块 + 设置面板**：bridge / memory / mood / rhythm / panel（去个性化，配置统一读活动角色）
- [x] **设置里「栖语」页签里的「版本」**：显示栈版本 / 安装时间 / 各运行时版本（来自 `~/.dsh/qiyu/version.json`）
- [x] **语音拆干净**：`bridge/lib/voice.mjs` 管说和听，桥只管向 NapCat 要 wav
- [x] 端到端：空白 profile → install → 独立实例 → 备号收发都通

已知未做：

- [ ] **还没有陌生人在干净机器上完整装过一遍**（最该验证的一环）
- [ ] mood 的「同一句反复记」已修（按消息签名去重），但只在千语身上验证过
- [ ] `memory` / `mood` / `rhythm` 的其余配置项还没全部接进角色包
- [ ] `0.0.0-stage` 这个 npm 占位版本还挂在 registry 上（不影响 `npx`）

> runtime 两边的代码应当一致，用 `qiyu doctor` 第 7.6 项比对；不一致就 `qiyu install --force`。
> 配置（QQ 号、称呼、容器名、路径）**永远不同步**，那是使用者自己的东西。

---

## 许可

MIT。你养出来的角色，是你自己的。
