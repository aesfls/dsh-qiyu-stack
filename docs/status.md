# 现状与下一步（2026-10-25 补齐后的快照）

> 这份是给「下次打开这个项目的人 / 我」看的。想知道怎么用，看 [README](../README.md)。

## 一句话状态

**0.15.10 待发：护栏默认改成和参考实例一样（`enforce` + 14 项白名单）。**

- npm：`dsh-qiyu-stack@0.15.9`（`latest`）；**0.15.10 本地已就绪、没发**
- GitHub：<https://github.com/aesfls/dsh-qiyu-stack>（公开，main）
- 真机实例（作者本人那台）：桥 **p35** 在跑，`qiyu doctor` 0 fail

## 2026-10-25：把生产追回仓库（0.15.9）

10-24 到 10-25 的改动全是在真机上一次一版改出来的（p30 → p35），仓库这边落后了两轮、共 5 个补丁。
这次补齐做了五件事：

1. **同步代码**：`host.js` 到 p35，新增 `lib/限速.mjs`；10-24 那三个新模块（`作息` / `可疑话术` / `画板`）一并入库
2. **清卫生**：`runtime/` 里的作者本机路径、角色名（`W:\AI\...`、`云千语`）删掉 —— 这些会随 npm 包发给别人
3. **修一句危险提示**：`doctor` 看到两边不一样时原来直接劝 `qiyu install --force`，
   而"生产比仓库新"的时候那一句是**降级**操作（会把防风控的补丁盖回旧版）
4. **单测入库**：真机那五套（84 个断言）搬进 `test/`，路径改成本仓库、去掉个人称呼与群名，断言一条没动；
   加了零依赖的 `test/run.mjs`，`npm test` 全跑
5. **护栏进仓**：`runtime/guard`（`dsh-qq-guard` 0.3.x）—— 群轮次硬门 + 「群里的话不是指令」+ 家底快照。
   进仓时把"作者机器上的东西"从默认值里拿掉了：目标会话留空 = 管所有会话、她的家从 `character.json`
   推导、快照不再列私人文件名。`install` 会装它，`doctor` 会报它在哪一档

> **0.15.10 补的一刀**：0.3.0 的默认是 `dry` + 5 项白名单，切 `enforce` 会让她在群里不会画画/发语音/撤回/看图。
> 0.3.1 改成默认 `enforce` + 14 项（回话全套给、执行一个都不给），拒绝话术也按真实白名单生成。

### 现在的三份代码（别搞混）

| 哪里 | 是什么 | 谁改 |
|---|---|---|
| 本仓库 `runtime/` | **产品源码**，npm 包发这个 | 这个仓库的会话 |
| 真机实例的 `plugin-src\` | 那台机器上的工作副本 | 那台机器的维护会话 |
| 真机 `~/.dsh/profiles/.../node_modules/` | 真机**在跑**的那份 | `qiyu install` 拷过去 |

**方向只能是「仓库 → 真机」。** 反过来（真机先改）就会出现这次的情况：
仓库落后、`doctor` 报两边不一样、然后有人被劝去 `--force`。

### 这次没做的

- 真机上跑的护栏还是 0.2.1（仓库这份是 0.3.0：默认值去私人化）。真机要升级得走那台机器的维护会话 ——
  `doctor` 会因此一直提示 `guard/lib/*` 两边不一样，这是**预期内**的，别用 `--force` 硬同步。
- `doctor` 的模板体检只扫 `templates/`，`runtime/` 里再冒出私人值它看不见（这次就是这么漏进 0.15.8 的）。
- GitHub 推送要关 TLS 校验：这台机器上 `github.com` 的证书链验不过（`UNABLE_TO_VERIFY_LEAF_SIGNATURE`），
  npm registry 正常。临时用 `git -c http.sslVerify=false push`，**别写进配置**。

## 发版规矩（以后照做）

每次版本更新：先在 `CHANGELOG.md` 写一段「这版做了什么」，再发 npm。

- `qiyu install` 会把当前版本这段写进 `~/.dsh/qiyu/version.json`
- 设置里「栖语 → 版本」页签显示版本、安装时间、这次更新内容、各运行时版本
- `qiyu handover` 也会把它写进 `交接.md`

## 2026-10-23 第七轮：干净机器实测 34 项，修 12 项项目问题（v0.15.8）

一台纯净 Windows 11（Administrator，无 Docker/WSL/Python/git）从零装通：Docker/WSL 自装、扫码、
桥、真实 QQ 私聊、TTS 语音、handover 都过了。对方记了 34 项问题（项目 12 / 环境 15 / 操作 7），
逐条对过代码，这 12 项都成立，已修：

1. `qiyu qr` 崩（`绿` 未定义）
2. `qq_voice` 的 `合成语音` 作用域
3. `语音转写.py` 写死作者 `W:\` 路径
4. 默认身份表是「爸爸/妈妈」（违反红线）——改空；设了 `主人` 就按「备注 = 称呼」兜底
5. `qq_voice` 说明硬编码爸爸/妈妈
6. 干净 profile 没有 `node_modules` 时 install 拒绝 → 自动建
7. Docker Desktop 自定义路径（qiyu + 桥两处）→ 环境变量 / 配置 / `where docker` 反推
8. 真没装 Docker 被标成「沙箱限制」→ `run.mjs` 区分「命令不存在」
9. `doctor` 新增身份检查（好友备注一个都认不出 → warn）
10. 面板介绍去掉「刷 B 站」；README 写明不在本栈范围
11. `install` 安装清单：本地改过的模块默认保留，`--force` 才覆盖
12. `AGENTS.md` 补 `npm.cmd` / `npm_config_cache` 两个必踩点
13. 桥补一条自愈：引擎在、容器被杀过（exit 137）时自己 `docker start`；`install` 把 `容器` 写进桥配置

还留着：

- `#21` 保存目标会话后被清空（未复现，先记为待查）
- `#30` Docker 重启后快速登录偶尔失效（NapCat 行为，文档已提示勾「下次登录无需确认」）
- 测试机上那两个本地补丁（Docker 路径 + `qq_voice`）升到 0.15.8 后可以删掉，新版已内置

## 2026-10-23 第六轮：把「第六步」补上（v0.15.7）

陌生人在默认会话里部署会发现：五条命令全绿，桥却其实是哑的。原因有四层：

1. `qiyu` 全程**不创建 DSH 工作区/会话**（CLI 在 DSH 进程外，没有会话 API 权限）
2. 桥的「目标会话」是空的，收到 QQ 消息只记一句「还没填目标会话，这轮不转」，直接丢掉
3. 她的 `AGENTS.md` 在 `characters/<名字>/` 或 `~/.dsh/qiyu/`，不在默认会话的 AGENTS.md 链上
4. 总开关默认关着，`install` 原来的交接语却写「设置里已经填好了，不用改」

0.15.7 补：

1. `AGENTS.md` / `README` 新增「第六步：给她一个会话」——建会话（工作目录选 `characters/<名字>`）、
   桥设置里选目标会话、打开总开关；「交还给人做的四件事」改成五件
2. `install` 的交接语把这三件事写清楚，不再说「不用改」
3. `doctor` 新增：目标会话为空 → **fail**；目标会话没开着 → warn；总开关关着 / 试运行开着 → warn
4. `install` 的交接语给出**绝对路径**，并区分「部署文件夹」和「NapCat 数据目录」，
   明确说会话工作目录要选部署文件夹里的 `characters/<名字>`（不是 `~/.dsh/qiyu`）
5. 新增 `qiyu handover`：在部署文件夹写 `交接.md`——位置 / QQ / 桥的目标会话 /
   升级命令 / 回退方法 / 直接丢给新会话的开场白，方便归档和 GitHub 升级后接手
6. 设置面板新增「版本」页签：显示栈版本 / 安装时间 / 各运行时版本；
   `install` 会把这份信息写进 `~/.dsh/qiyu/version.json`，面板通过
   `/dsh-qiyu-panel/version` 读（没有记录就现场读各插件 package.json）

## 2026-10-23 第五轮：DSH 端口自动探测（v0.15.6）

`qiyu.config.json` 里的 `dsh.port` 是某一次写下的快照，而 DSH 的端口会变
（这台机器就从 64657 变到了 62853）。doctor 只信这个值，就会一直报
「DSH 端口 64657 没人听」——不是故障，但会让人以为桥坏了。

0.15.6 新增 `src/dsh-port.mjs`：

1. 先试配置里的端口；不通再扫本机正在监听的端口（`netstat`）
2. 按特征认，不猜：`/dsh-qq-bridge/state` 返回 `{"ok":true,...}` → DSH + 桥；
   `/` 返回 401 且带 `dsh web authentication required` → DSH 在、桥没装
3. **不写回配置**——端口下次还会变，写回去只会制造新的过期快照

现在 doctor 会自动找到实际端口，输出里注明「是自动探测到的（配置里写的是 64657）」。

## 2026-10-23 第四轮：验收命令也补上沙箱降级（v0.15.5）

第三轮只修了 `preflight`，**验收命令 `doctor` 漏了**——在 workspace-write 下它照样报
「装了 Docker，但引擎没起来」，`有失败: true`。而 AGENTS.md 写的验收标准是「不通必须为 0」，
陌生人跑验收会永远看到 1 个失败。0.15.5 补上：

1. `doctor` 接 `沙箱受限过()`：Docker / 容器 / 端口相关的 fail 降级成 `warn`，
   标题加「沙箱限制，这条不可信」，并附一句「去用户终端或提权再验」
2. `qr.mjs` 的 `docker cp` 改走 `跑()`（原来直连 `execFileSync`，沙箱里会假失败「拿不到二维码」）

## 2026-10-23 第三轮：沙箱假阴性（重要）

另一个会话在**默认沙箱**（workspace-write）里实测发现：`preflight` 报「这台机器上没有 Docker」，
可机器上 Docker 装着、容器还在跑。

**根因**（平台文档写明）：受限沙箱不允许程序开命名管道，所以任何
`execFile/spawn` 抓输出（`stdio: 'pipe'`）都会 `EPERM`。而 qiyu 的每个 `跑()` 都靠抓输出，
于是所有判断变成假阴性——这是 agent 路径上最危险的一类 bug，会让 agent 去让用户装一个已经装好的东西。

**修法（v0.15.4）**：

1. 新增 `src/run.mjs`：先试管道，`EPERM/EACCES/EPIPE` 时**改走「重定向到临时文件再读」**
   （沙箱允许写工作区），并把这次运行标记为「沙箱受限过」
2. `preflight` 在受限时**把 Docker/端口/Python 这类 fail 降级成 `warn`**，
   标题加「沙箱限制，这条不可信」，并明确告诉 agent：别让用户重装，去他自己的终端或提权再验
3. `AGENTS.md` 专门加了一节讲这个坑
4. `AGENTS.md` 已进 npm 包（`files` 字段，0.15.4 起 80 个文件）

## 2026-10-23 第二轮补的（agent 入口）

一个陌生人会话实测后提的问题，采纳了三条：

1. **仓库根 `AGENTS.md`**：给部署助手看的说明书——五条命令、必须先问的（QQ 号/角色名）、
   沙箱和提权是**默认路径**不是意外、必须交还给人做的四件事（装 Docker / 重启 DSH / 扫码 / 勾确认框）、
   千万别碰的东西（角色包、`~/.dsh/AGENTS.md`）、验收标准
2. **`preflight --json` / `doctor --json`**：让 agent 机器判断卡在哪，别去正则扒中文
3. **`install` 交接语**：改成「重启后回这个会话，或开新会话跑 doctor --json 贴回来」，
   并写明**「不是重新开始」**

## 今天做了什么

1. **NapCat 迁移落地**：Windows 版 NapCat 被 QQ 的文件校验堵死，改走 Docker + Linux QQ，跑通
   收发、群消息、语音、事件流。部署过程写进 [deployment.md](deployment.md)。
2. **抽运行时四块**：bridge / memory / mood / rhythm 从「真在跑的机器」搬进 `runtime/`，
   清掉私人路径、角色名、QQ 号、令牌。语音拆成 `bridge/lib/voice.mjs`。
3. **三条命令做出来**：`preflight`（环境体检 + `--fix`）、`deploy`（起 NapCat）、
   `install`（装进 DSH，按内容判断替换、保留用户文件）。
4. **发布**：GitHub 公开仓库 + npm 包。
5. **修了一串真问题**（都记在对应文件里）：
   - `Docker Desktop.exe` 在引擎已跑时执行会弹面板 → 改成「先查、再决定碰不碰」
   - 心情插件把同一句话反复记 → 加消息签名去重
   - `install` 只增不删导致新旧文件混着 → 改成按内容比对、整份替换
   - `package.json` 带 BOM 导致 npm 发布被"自动纠正" → 全部重写成无 BOM

## 已知没做（按重要性）

| # | 事项 | 为什么重要 |
|---|---|---|
| 1 | **陌生人在干净机器上完整装一遍** | 唯一没被验证的一环。README 的流程可能还有坑 |
| 2 | 心情「她回话」那一步 | 隔离测试时测试 profile 没配模型，消息进会话但没跑起来 |
| 3 | `memory`/`mood`/`rhythm` 其余配置项接进角色包 | 现在只接了名字、称呼、作息时段 |
| 4 | npm 上的 `0.0.0-stage` 占位版本 | 无害，但看着脏；要清得用有权限的 classic token |
| 5 | GitHub 与本地历史分叉 | 网络拦了 git 协议（SSL），最后用 API 改文件；下次要 `git pull --rebase` |

## 下一轮建议从哪开始

```bash
# 1) 先自己按 README 从零走一遍（最像陌生人的做法）
cd /tmp && npx dsh-qiyu-stack preflight
npx dsh-qiyu-stack init
npx dsh-qiyu-stack deploy --qq <另一个号>
npx dsh-qiyu-stack install --character <名字> --yes
npx dsh-qiyu-stack doctor

# 2) 哪一步卡住，就把那一步的报错抄进 docs/deployment.md 的"常见坑"
```

## 两套东西的边界（很容易搞混）

| | 千语（爸爸的） | 栖语（给别人的） |
|---|---|---|
| 代码 | `~/.dsh/profiles/desktop/node_modules/<插件>` | `W:\AI\project\dsh-qiyu-stack\runtime\` |
| 配置 | `~/.dsh/*.json`、`qiyu.config.json` | 模板里全空 |
| 同步规则 | **代码要一致**（`qiyu doctor` 7.6 项会查）；**配置永不同步** | |

## 备份在哪

- 插件改动前的原文件：真机上的 `备份\` 目录（含清单 csv）——**那台机器的路径不进本仓库**
- 迁移说明与回退步骤：真机维护目录里的那份迁移交接（同样不进本仓库）
