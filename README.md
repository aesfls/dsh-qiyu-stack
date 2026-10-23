# 栖语栈 · qiyu-dsh-stack

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
npx qiyu-dsh-stack preflight

# 1. 建一个角色 —— 会问你几个问题（名字 / QQ / 称呼 / 作息 / 性格 / 能不能自己改性格）
npx qiyu-dsh-stack init

#    不想被问就带名字，全用默认值：npx qiyu-dsh-stack init 小满

# 2. 填她自己的东西
#    characters/小满/AGENTS.md      「性格」那几行
#    characters/小满/character.json  QQ 号 / 称呼 / 语音 / 路径（模板里全是空的）

# 3. 起 NapCat —— 一条命令：建目录、写 OneBot 配置、跑容器、出码
npx qiyu-dsh-stack deploy --qq 你的QQ号

# 4. 把运行时（QQ 桥/记忆/心情/作息）装进 DSH，并让她成为「活动角色」
npx qiyu-dsh-stack install --character 小满 --yes      # 装完重启 DSH（关掉窗口再开，不用重启电脑）

# 5. 扫码（图会自动打开），然后自查
npx qiyu-dsh-stack doctor
```

> **用 npx 也没关系。** `install` 会先把运行时装一份到 `~/.dsh/qiyu/runtime/`，
> profile 里的 `file:` 依赖指向那份**稳定副本**，不是 qiyu 包自己的位置。
> npx 的临时缓存被清掉、或者你把 qiyu 删了，DSH 那边照样能跑。

`doctor` 会逐项告诉你：Docker 在不在、容器起没起、三个端口通不通、OneBot 认不认得出人、
事件流连不连得上、DSH 桥接没接上。**每条失败都带一句怎么修。**

---

## 目录结构

```
qiyu-dsh-stack/              引擎（角色无关，可升级）
├── bin/qiyu.mjs             命令行入口
├── src/
│   ├── config.mjs           配置（文件 + 环境变量）
│   ├── init.mjs             建角色包
│   ├── deploy.mjs           起 NapCat（建目录/写配置/跑容器/出码）
│   ├── doctor.mjs           自检
│   └── qr.mjs               取二维码并直接打开
├── tools/
│   └── merge-settings-tabs.mjs   把插件设置合并成「一个页面 + 页签」
├── runtime/                 运行时五块（从真跑着的机器上搬来、洗过私人值）
│   ├── bridge/              QQ ↔ DSH 双向（全配置驱动）
│   ├── memory/              长期记忆（含 1MB 中文词典）
│   ├── mood/                心情
│   ├── rhythm/              作息 / 主动搭话
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

## 现在的进度（v0.9）

已经能用：

- [x] **`qiyu init` 向导**：问名字、QQ、称呼、作息、性格、「能不能自己改性格」；
      每个问题都有默认值，回车就过；带名字调用则全用默认值（给脚本用）
- [x] **`qiyu deploy`** 一条命令起 NapCat：查 Docker → 查端口 → 建目录 → 写 OneBot/WebUI 配置
      → 拉镜像 → 跑容器 → 等 WebUI → **直接打开二维码**；令牌自动生成并写回 `qiyu.config.json`
- [x] `qiyu doctor` 全链路自检 + **模板体检**（扫出别人的路径/名字/QQ号/令牌）
- [x] `qiyu qr` 取登录二维码并**自动打开**（不是甩个路径让你自己找）
- [x] `tools/merge-settings-tabs.mjs` 一条命令把五六个插件的设置收进「插件」页做页签，
      带 `--dry-run` / `--restore`（见 [docs/settings-tabs.md](docs/settings-tabs.md)）
- [x] 部署文档：Docker + NapCat + 一个必勾的「下次登录无需确认」
- [x] 行为层人格模板
- [x] 默认值红线：中性默认 + 本机配置分离（见 [docs/conventions.md](docs/conventions.md)）
- [x] **runtime/ 五块已收进仓库**：bridge 全配置驱动、memory/mood/rhythm 原样搬、voice 只搬了脚本
      （私人路径/角色名/QQ号/令牌已清干净，见 [runtime/README.md](runtime/README.md)）
- [x] **`qiyu install`** 把 runtime 装进 DSH profile：默认只列清单，`--yes` 才动手；
      目标已存在就跳过（`--force` 覆盖且先备份），`profile/package.json` 改动前必留 `.bak`
- [x] **语音拆干净了**：`bridge/lib/voice.mjs` 管「说 + 听」，桥只管「向 NapCat 要 wav」；
      `install` 会把转写脚本放到 `~/.dsh/qiyu/`
- [x] **配置收敛到活动角色**：`install --character 小满` 把角色包拷到 `~/.dsh/qiyu/`，
      桥读身份的优先级变成 **`character.json` > `qq-bridge-config.json` > 代码默认值**
      （改人只改角色包，不碰插件配置）

- [x] **端到端真跑过一次**：空白 DSH profile → `qiyu install` → 起独立实例 → 桥接上备号
      → 发消息进群 ✅ → 群里 @ 她，话被转进会话 ✅（最后「她回话」那步因测试 profile 没配模型没验）

还差的：

- [x] ~~`memory` / `mood` / `rhythm` 也改读活动角色~~ —— 都接上了：
      rhythm 读 `schedule.json` 的时段、mood 读 `名字`/`称呼.主人`、memory 的名字兜底读 `名字`

> 五块现在**都从活动角色读配置**了：改 `characters/<名字>/` 就能换人，不用碰插件配置。

> 这一段是**从已验证能跑的实现里抽出来的**，不是照文档重写。

---

## 许可

MIT。你养出来的角色，是你自己的。
