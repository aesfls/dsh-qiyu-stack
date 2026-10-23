# runtime/ —— 运行时五块

这里放「一个角色真正活着需要的代码」：QQ 桥、记忆、心情、语音、作息。

**来源**：全部是从一台真在跑的机器上（`~/.dsh/profiles/desktop/node_modules/`）原样搬过来的，
不是照文档重写的。搬完做了「去个性化」：私人路径、角色名、QQ 号、令牌，一个不留。

| 块 | 来源插件 | 体积 | 状态 |
|---|---|---|---|
| `bridge/` | dsh-qq-bridge 0.2.0 | 155 KB | ✅ 已搬 + 去个性化 |
| `memory/` | dsh-fish-memory | 1.8 MB | ✅ 已搬（含 1 MB 中文词典，分词用） |
| `mood/` | dsh-feiyu-mood | 500 KB | ✅ 已搬（含五张表情图） |
| `rhythm/` | dsh-speak-up 0.2.0 | 119 KB | ✅ 已搬 |
| `voice/` | 语音转写.py + `bridge/lib/voice.mjs` | 3.4 KB + 4 KB | ✅ 说/听都抽出来了 |

---

## 各块现在是什么状态

### bridge/（QQ 双向）

已经做成**全配置驱动**的了（今天改的）：

| 原来写死 | 现在 |
|---|---|
| `uid === 10001` | `配置.自己QQ`（0 = 自己问 NapCat 要） |
| `备注.startsWith('爸爸')` | `配置.身份表`（备注前缀 → 称呼，随便加人换叫法） |
| 出事找 `爸爸` | `配置.主人` |
| `转写脚本: 'W:\...\语音转写.py'` | `配置.转写脚本`（空 = 不转） |
| `PYTHONPATH: 'W:\...\pylibs'` | `配置.转写依赖路径` |
| 表情包/收件箱路径 | `~/.qiyu/表情包`、`~/.qiyu/收件箱`（可用环境变量覆盖） |
| 音色默认 `zh-CN-XiaoyiNeural` | `zh-CN-XiaoxiaoNeural`（中性） |

还留着 `爸爸`/`妈妈` 这两个词的地方，是**默认身份表**和工具说明里的举例
（"给通讯录里的人发消息，比如爸爸、妈妈"）。它们是通用亲属称谓、不是某个人的名字，
而且真认人走的是 `身份表` 配置，改一行就换。

### voice/（说 + 听）

语音原来是贴在 bridge 里的，现在拆成两块：

| 半 | 在哪 | 干什么 |
|---|---|---|
| **说**（TTS） | `bridge/lib/voice.mjs` 的 `合成语音()` | edge-tts（联网、自然）或 Windows SAPI（离线、机械） |
| **听**（ASR） | `bridge/lib/voice.mjs` 的 `转写音频()` + `voice/语音转写.py` | 本地脚本收 wav、往 stdout 打文字（SenseVoice 之类） |
| **网络那半** | 还在 bridge 里 | 向 NapCat 要 `get_record`（base64 wav），再交给上面两个 |

边界是这样切的：**voice 只管本地能力（本机的 python、本机的模型），bridge 只管网络和消息。**
所以 `转写语音()` 现在只剩「取 → 存 → 转」三行调用。

`qiyu install` 会顺手把 `语音转写.py` 放到 `~/.qiyu/语音转写.py`，
那正是 `voice.mjs` 的默认路径 —— 不配也能用。

实测：用抽出来的 `合成语音()` 单独跑一次，成功生成了 21 KB 的 mp3。

### memory/ 和 mood/、rhythm/

搬过来是干净的，也**没改过一行代码**。它们原本就没有私人值。

`memory` 那 1 MB 的 `词典.txt` 是分词用的，别删。

---

## 还没做的

- [x] ~~`qiyu install`~~ —— **做好了**：拷 node_modules + 写 profile package.json + 写 bundles，
      默认只列清单，`--yes` 才动手，冲突跳过，改 package.json 前必留 `.bak`
- [x] ~~依赖路径悬空~~ —— `file:` 不指向 qiyu 包本身，而是先落一份稳定副本到
      `~/.dsh/qiyu/runtime/`；npx 缓存清掉也不影响
- [x] ~~voice 的胶水~~ —— 抽成 `bridge/lib/voice.mjs`（说/听），网络那半留在桥里
- [x] ~~配置收敛~~ —— `install --character` 把角色包拷到 `~/.dsh/qiyu/`，bridge 读身份的顺序是
      `character.json` > `qq-bridge-config.json` > 默认值（memory/mood/rhythm 还没接）
- [x] ~~`memory` / `mood` / `rhythm` 也改读活动角色~~ —— 三块都接上了：
      `rhythm` 读 `schedule.json` 的时段、`mood` 读 `名字`/`称呼.主人`、`memory` 的名字兜底读 `名字`
- [x] ~~端到端~~ —— **在一个全新 profile 上真跑过**（2026-10-23 11:38）：
      空白 profile → `qiyu install` → 起独立 DSH → 桥接上备号 → 事件流连上
      → 往群里发了一条 ✅ → 群里 @ 她，桥把话转进了会话 ✅
      （最后「她回话」那一步没验证：测试 profile 没配默认模型，那一轮跑不起来）

## 为什么先搬到这儿、先不装

因为**装**是有副作用的动作（改 profile、可能撞上已经装着的同名插件）。
先把源码收进来、把私人值洗干净，是这一阶段能确定做完的事；
装的部分单独做 `qiyu install`，带 `--dry-run` 和备份，才有资格碰别人的 profile。
