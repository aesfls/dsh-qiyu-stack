// DSH「通到 QQ」· 宿主半边
//
// 这一半只做一件事（先只做 DSH → QQ）：
//   伙伴在「目标会话」里说完一句话（一整轮的最后一句），就自动把它发到 QQ（私聊 / 群）。
//   发 QQ 走 NapCat 的 OneBot HTTP 接口（127.0.0.1:3000），走标准的 OneBot 11 HTTP。
//
// 反过来（QQ → DSH）是下一半，放到另一个插件/进程里做，不在这里混。
//
// ⚠ 安全默认：总开关 = false、试运行 = true —— 不手动打开，一句都不会真的发到 QQ。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, renameSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const 执行 = promisify(execFile)
import { 扫 as 扫可疑 } from './可疑话术.mjs'
import { 解析时段, 判时段, 校验作息, 成文件, 成分 } from './作息.mjs'
import { 渲, 估token, 缩放 } from './画板.mjs'
// ⭐ 2026-10-25 p31：发送限速（防风控）。10-24 账号被封，最吻合的原因是「行为频率」：
//   0.37 秒连发、10 分钟 22 条、秒回零冷却。所有外发都过 发一个()，在那里统一压节奏。
import { 还要等多久, 记一笔, 说多久, 回复前等多久 } from './限速.mjs'
import { createSelfUpdate } from './selfupdate.mjs'
import { 合成语音 as 生语音, 转写音频, 存Wav } from './voice.mjs'
import { loadHostDeps } from './hostdeps.mjs'

// 工具要用宿主的 defineTool（拿不到就不注册工具，插件其余部分照常跑）
const hostDeps = await loadHostDeps().catch(() => null)
const defineTool = hostDeps && hostDeps.defineTool

export const name = 'qq-bridge'

/** 需要宿主提供：webServer（路由）+ sessions/sessionTitle（目标会话清单 + 标题）+ agents（followup）+ timer（轮询收消息）。 */
export const inject = ['agents', 'sessions', 'sessionTitle', 'webServer', 'timer', 'workspaceRegistry', 'tools', 'sessionController', 'systemPrompt']

// ---------- 常量 ----------

const 目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
// ⚠️ 配置文件默认在 $DSH_HOME 下；多 profile 并行测试时可以用 QQ_BRIDGE_CONFIG 覆盖
//    （否则两个 profile 会读同一份配置、抢同一个号）
const 配置文件 = process.env.QQ_BRIDGE_CONFIG || join(目录, 'qq-bridge-config.json')
const 路由前缀 = '/dsh-qq-bridge'
// ⭐ 活动角色：install --character 会把角色包拷到 $DSH_HOME/qiyu/
const 角色目录 = join(目录, 'qiyu')
const 角色文件 = join(角色目录, 'character.json')

// ⭐ 夜间攒消息 / 水位：落盘。电脑关机、DSH 重启都不丢；
//   打包给她之后清空，下一晚重新攒。
const 状态文件 = process.env.QQ_BRIDGE_STATE || join(目录, 'qq-bridge-pending.json')
function 读持久状态() {
  try {
    return JSON.parse(readFileSync(状态文件, 'utf8').replace(/^\uFEFF/, '')) || {}
  } catch (error) {
    return {}
  }
}
const 上回状态 = 读持久状态()

function 读角色() {
  try {
    return JSON.parse(readFileSync(角色文件, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    return null
  }
}

const 角色 = 读角色() || {}
const 表情目录 = process.env.QQ_STICKER_DIR || (角色.路径 && 角色.路径.表情包) || join(角色目录, '表情包')
const 收件目录 = process.env.QQ_INBOX_DIR || (角色.路径 && 角色.路径.收件箱) || join(角色目录, '收件箱')
const 语音目录 = process.env.QQ_VOICE_DIR || (角色.路径 && 角色.路径.语音) || join(角色目录, '语音')
// ⭐ 2026-10-24 19:00：她的画板。画完的 PNG 落在 画板\作品\，这里放开成可发目录。
const 画板目录 = process.env.QQ_CANVAS_DIR || (角色.路径 && 角色.路径.画板) || join(角色目录, '画板')
const 日志上限 = 60

// ⭐ 合成语音放在模块作用域：qq_voice 工具和轮询都用它。
//    以前它定义在 轮询收消息() 里面，qq_voice 调它会报「合成语音 is not defined」。
function 合成语音(配置, 文字) {
  return 生语音(文字, {
    引擎: 配置.语音引擎,
    音色: 配置.语音音色,
    语速: 配置.语音语速,
    音调: 配置.语音音调,
    输出目录: 语音目录,
  })
}

const 默认配置 = {
  总开关: false, // 关着 = 一句都不发（安全默认）
  试运行: true, // 开着 = 只记账、不真发到 QQ
  目标会话: '', // 盯哪个 DSH 会话（在设置页下拉里选，一般是你平时聊天的那一间）
  私聊QQ: '', // 发到哪个私聊（QQ 号，字符串）
  群号: '', // 发到哪个群（可空）
  转私聊: true,
  转群: false,
  // ⭐ 除了「表情包 / 收件箱 / 画板」，还允许从哪些目录发图（数组或逗号分隔的绝对路径）。
  //   默认空 —— 想让她能发 D:\pics 里的图，就往这里加。
  可发目录: [],
  NapCat: 'http://127.0.0.1:3000', // OneBot HTTP 接口
  容器: '', // NapCat 容器名（空 = 不管容器，只管 Docker 引擎）
  令牌: '', // OneBot 访问令牌（SnowLuma 默认会生成一个；NapCat 留空）
  // ⭐ 身份（抽成配置，不再写死某一个人的号）
  自己QQ: 0, // 她自己的 QQ 号；0 = 每次向 NapCat 要（get_login_info）
  主人: '', // 出事找谁：好友申请、入群邀请都先问这位（填 身份表 里的称呼；空 = 还没设）
  身份表: [], // 好友备注以前缀认人。默认空，由 init 生成的称呼自动兜底（不是某一个人的爸爸/妈妈）
  // 自定义安装的 Docker Desktop 可执行文件（留空 = 自动找：环境变量 > 配置 > where docker > 默认路径）
  DockerDesktop: '',
  // ⭐ 语音（她自己发语音消息用）
  //  语音引擎：edge = 微软 Edge 在线音色（自然）；windows = 系统自带（机械但离线）
  //  改音色：跑 python -m edge_tts --list-voices 看全部，填名字进 语音音色
  语音引擎: 'edge',
  语音音色: 'zh-CN-XiaoxiaoNeural',
  语音语速: '+0%', // 例：'+10%' 快一点、 '-10%' 慢一点
  语音音调: '+0Hz', // 例：'+20Hz' 高一点（更像小孩）、 '-20Hz' 低一点
  语音长度上限: 120, // 一句话最多多少字，太长会拒绝
  // 空 = 自动用 $DSH_HOME/qiyu/语音转写.py（如果有）；再没有就不转写
  转写脚本: '',
  转写依赖路径: '', // 跑转写脚本时额外塞进 PYTHONPATH 的目录（没有就空着）
}

/** 版本从 package.json 读。 */
const 版本 = (() => {
  try {
    const p = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
    return String(p.version || '?')
  } catch (error) {
    return '?'
  }
})()

// ---------- 配置读写 ----------

function 布(值, 兜) {
  if (值 === true || 值 === 'true' || 值 === 1 || 值 === '1') return true
  if (值 === false || 值 === 'false' || 值 === 0 || 值 === '0') return false
  return 兜
}

function 归一化(原始) {
  const 是对象 = 原始 && typeof 原始 === 'object' && !Array.isArray(原始)
  const 混 = 是对象 ? { ...默认配置, ...原始 } : { ...默认配置 }
  const 字 = (v) => (typeof v === 'string' ? v.trim() : '')
  // ⭐ 2026-10-24 P0-2b：群号 / 群黑名单 既接受「逗号串」，也接受 /state 交回来的数组。
  //    原来只认字符串：设置页把 /state 的配置原样存回来时，「群黑名单们」是数组 ⇒ 被当成空 ⇒ 黑名单被悄悄清掉。
  const 拆号 = (v) => String(v == null ? '' : v).split(/[,，\s]+/).filter(Boolean)
  const 号们 = (串, 数组) => {
    const 从串 = 拆号(串)
    if (从串.length) return 从串
    return Array.isArray(数组) ? 数组.map((x) => String(x).trim()).filter(Boolean) : []
  }
  const 出 = {
    总开关: 布(混.总开关, 默认配置.总开关),
    试运行: 布(混.试运行, 默认配置.试运行),
    目标会话: 字(混.目标会话),
    私聊QQ: 字(混.私聊QQ),
    群号: 字(混.群号),
    群号们: 号们(混.群号, 混.群号们),
    群黑名单们: 号们(混.群黑名单, 混.群黑名单们),
    转私聊: 布(混.转私聊, 默认配置.转私聊),
    转群: 布(混.转群, 默认配置.转群),
    // 额外可发目录：数组、逗号串、单个字符串都认
    可发目录们: (Array.isArray(混.可发目录) ? 混.可发目录 : 拆号(混.可发目录)).map(String).filter(Boolean),
    自己QQ: Number(混.自己QQ) || 0,
    // ⭐ 2026-10-25：配置里没填「主人」时，用角色包的 `称呼.主人` 兜底。
    //   起因：init 只写 character.json（称呼.主人），桥却只读 qq-bridge-config.json →
    //   doctor 报「还没设她该怎么称呼你」，身份表也生不出来，谁都不认（实测踩过）。
    主人: 字(混.主人) || 字((角色.称呼 || {}).主人),
    身份表: Array.isArray(混.身份表) ? 混.身份表.filter((x) => x && x.备注前缀) : [],
    DockerDesktop: 字(混.DockerDesktop),
    NapCat: 字(混.NapCat) || 默认配置.NapCat,
    容器: 字(混.容器),
    令牌: 字(混.令牌),
    语音引擎: 字(混.语音引擎) || 默认配置.语音引擎,
    语音音色: 字(混.语音音色) || 默认配置.语音音色,
    语音语速: 字(混.语音语速) || 默认配置.语音语速,
    语音音调: 字(混.语音音调) || 默认配置.语音音调,
    语音长度上限: Number(混.语音长度上限) || 默认配置.语音长度上限,
    转写脚本: 字(混.转写脚本) || 自动转写脚本(),
    转写依赖路径: 字(混.转写依赖路径) || 默认配置.转写依赖路径,
    事件地址: 字(混.事件地址),
    事件令牌: 字(混.事件令牌),
    // ⭐ 2026-10-24 P0-1：管理接口的令牌。默认空 = 只认「浏览器来源」（见 管理请求可信）。
    //    填了以后，命令行/脚本调 /save 之类必须带 x-qiyu-admin 头。
    管理令牌: 字(混.管理令牌),
  }
  // ⭐ 身份表为空、但设了「主人」→ 按「备注 = 称呼」自动生成一条。
  //    这样 init 只问「她该怎么称呼你」也能用，不会退回到某个人的爸爸/妈妈。
  if (!出.身份表.length && 出.主人) 出.身份表 = [{ 备注前缀: 出.主人, 称呼: 出.主人 }]
  return 出
}

let 当前令牌 = ''

// ---------- 后台服务（Docker）：要用的时候才拉起来，而且不弹窗 ----------
//
// ⚠️ Docker Desktop.exe 在引擎**已经跑着**的时候再执行，会触发 show-dashboard
//    —— 那就是用户莫名其妙看到一个窗口的原因。所以必须先查、再决定要不要碰它。
// 容器不用管：它是 --restart unless-stopped，引擎一回来它自己就回来了。
function 后台服务在线() {
  return new Promise((解决) => {
    execFile('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 8000, windowsHide: true }, (错, 出) => {
      解决(!错 && String(出 || '').trim())
    })
  })
}

function 容器状态(名) {
  return new Promise((解决) => {
    execFile('docker', ['inspect', 名, '--format', '{{.State.Status}}'], { timeout: 8000, windowsHide: true }, (错, 出) => {
      解决(错 ? '' : String(出 || '').trim())
    })
  })
}

/**
 * 引擎在，但容器可能被杀过（Docker Desktop 退出时常见，exit 137）。
 * 这时 --restart unless-stopped 不一定把它拉回来，需要显式 docker start。
 */
async function 确保容器在跑(配置) {
  const 名 = String((配置 && 配置.容器) || '').trim()
  if (!名) return true
  if ((await 容器状态(名)) === 'running') return true
  try {
    execFileSync('docker', ['start', 名], { timeout: 60000, windowsHide: true })
  } catch (error) {
    return false
  }
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    if ((await 容器状态(名)) === 'running') return true
  }
  return false
}

/** Docker Desktop.exe 可能在哪：环境变量 > 配置 > 从 where docker 反推 > 默认路径 */
function DockerDesktop候选() {
  const 列 = []
  const 加 = (p) => {
    const t = String(p || '').trim()
    if (t && !列.includes(t)) 列.push(t)
  }
  加(process.env.QIYU_DOCKER_DESKTOP)
  try {
    加(读配置().DockerDesktop)
  } catch (error) {
    /* 配置读不到就算了 */
  }
  try {
    const 出 = execFileSync('where', ['docker'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    const 第一行 = String(出)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean)
    // ...\Docker\resources\bin\docker.exe → ...\Docker\Docker Desktop.exe
    if (第一行) 加(join(dirname(dirname(dirname(第一行))), 'Docker Desktop.exe'))
  } catch (error) {
    /* 没有 where 或没有 docker，用默认路径 */
  }
  加('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe')
  加(join(process.env.LOCALAPPDATA || '', 'Docker', 'Docker Desktop.exe'))
  return 列
}

async function 拉起后台服务() {
  const 候选 = DockerDesktop候选().filter((p) => {
    try {
      return existsSync(p)
    } catch (error) {
      return false
    }
  })
  if (!候选.length) return false
  try {
    spawn(候选[0], [], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch (error) {
    return false
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    if (await 后台服务在线()) return true
  }
  return false
}

/** 角色目录里的转写脚本：存在就用，不存在就空着（= 不转写）。 */
function 自动转写脚本() {
  const 候选 = join(角色目录, '语音转写.py')
  try {
    return existsSync(候选) ? 候选 : ''
  } catch (error) {
    return ''
  }
}

/**
 * 配置的优先级（身份部分）：
 *   $DSH_HOME/qiyu/character.json  >  qq-bridge-config.json  >  代码默认值
 * 也就是说：装了角色包以后，改 character.json 就能换人；
 * 没装角色包，就还是走插件自己的配置文件。
 */
function 读配置() {
  let c
  try {
    c = 归一化(JSON.parse(readFileSync(配置文件, 'utf8')))
  } catch (error) {
    c = 归一化(null)
  }

  const 角 = 读角色()
  if (角) {
    if (角.qq) c.自己QQ = Number(角.qq) || c.自己QQ
    if (角.称呼 && 角.称呼.主人) c.主人 = String(角.称呼.主人)
    if (角.称呼 && Array.isArray(角.称呼.其他人) && 角.称呼.其他人.length) {
      const 表 = 角.称呼.其他人
        .filter((x) => x && x.备注前缀)
        .map((x) => ({ 备注前缀: String(x.备注前缀), 称呼: String(x.称呼 || x.备注前缀) }))
      if (表.length) c.身份表 = 表
    }
    const 声 = 角.语音 || {}
    if (声.引擎) c.语音引擎 = String(声.引擎)
    if (声.音色) c.语音音色 = String(声.音色)
    if (声.语速) c.语音语速 = String(声.语速)
    if (声.音调) c.语音音调 = String(声.音调)
    if (声.转写脚本) c.转写脚本 = String(声.转写脚本)
    if (声.转写依赖路径) c.转写依赖路径 = String(声.转写依赖路径)
  }

  当前令牌 = c.令牌 || ''
  return c
}

/** 请求头：有令牌就带上（SnowLuma 默认要求，NapCat 空着也能用） */
function 头() {
  const h = { 'content-type': 'application/json' }
  if (当前令牌) h.authorization = 'Bearer ' + 当前令牌
  return h
}

function 写配置(配置) {
  try {
    mkdirSync(目录, { recursive: true })
    writeFileSync(配置文件, JSON.stringify(配置, null, 2), 'utf8')
    return true
  } catch (error) {
    return false
  }
}

// ---------- 纯函数（导出给冒烟测试喂） ----------

/** 从一条 assistant 消息里只抽出正文（text 块拼起来；reasoning / image 都不要）。 */
export function 提取正文(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/** 拼一个 OneBot「私聊 text 段」消息体。 */
export function 私人消息体(text) {
  return { user_id: 0, message: [{ type: 'text', data: { text } }] }
}

/** 拼一个 OneBot「群 text 段」消息体。 */
export function 群消息体(text) {
  return { group_id: 0, message: [{ type: 'text', data: { text } }] }
}

// 包根：用来读自己的 package.json（版本 + 仓库地址）
const 包根 = join(dirname(fileURLToPath(import.meta.url)), '..')

export function apply(ctx) {
  // ⭐ 设置页那个「检查更新」：查这个插件自己的仓库
  createSelfUpdate({ packageRoot: 包根, diag: 记账 }).register(ctx, 路由前缀)
  // ---------- 状态 ----------

  const 日志 = []
  let 上一轮 = { 轮号: -1, 文本: '' }
  const 已发轮 = new Set()
  const 已转消息 = new Set(Array.isArray(上回状态.已转消息) ? 上回状态.已转消息 : []) // 已经转发进 DSH 的 QQ 消息 id（防重复转）
  // ⭐ 水位从磁盘恢复：关机这段时间里来的消息，重启后还能接着读
  let 上次私聊时间 = Number(上回状态.上次私聊时间) || Math.floor(Date.now() / 1000)
  let 上次群时间 = Number(上回状态.上次群时间) || Math.floor(Date.now() / 1000)
  // ⭐ 这一轮是谁从 QQ 挑起的：{ uid, 标签 }（私聊）或 { 群号, 群名, 称呼 }（群聊）。
  //    为空 = 不是 QQ 引起的（爸爸在界面说的），不回发
  let 待回 = null
  // ⭐ 2026-10-24 20:00：这一轮的**发起人 QQ 号**。给"只有爸妈能触发"这类判断用。
  //    不按群名片比对（谁都能把名片改成「爸爸」），只认 QQ 号。
  let 本轮发起QQ = 0
  // ⭐ 入群邀请 / 申请：待处理的，等爸爸点头
  let 待批入群 = [] // [{ id, 群号, 群名, 邀请人, 邀请人号, 类型 }]
  const 已处理申请 = new Set()
  let 上次查申请 = 0

  // ⭐⭐ 作息时段：她累不累，决定消息要不要现在给她
  //
  //   四象限（用户选方案乙）：
  //              | 群闲聊 | 群里@她      | 私聊(爸妈)
  //     休息     | 攒着   | 攒着         | 攒着
  //     惰性     | 攒着   | 立刻给+劝退  | 立刻给
  //     活跃     | 立刻给 | 立刻给       | 立刻给
  //
  //   ⭐ 2026-10-24 18:40 改：时段不再写死，改成读**共享数据文件**
  //      `$DSH_HOME/qiyu/schedule.json`（speak-up 那边早就支持读它覆盖，只是文件一直不存在）。
  //      这样"她自己的作息"只有一份真源，桥上判、她在工具里改，两边立刻一致；
  //      文件坏了/没写就退回默认（休息 00:00–08:30 / 惰性 08:30–19:30 / 其余活跃）。
  const 作息文件 = join(目录, 'qiyu', 'schedule.json')
  const 读作息 = () => {
    try {
      if (!existsSync(作息文件)) return 解析时段(null)
      return 解析时段(JSON.parse(readFileSync(作息文件, 'utf8').replace(/^\uFEFF/, '')))
    } catch (error) {
      return 解析时段(null)
    }
  }
  const 作息 = () => {
    const d = new Date()
    return 判时段(d.getHours() * 60 + d.getMinutes(), 读作息())
  }

  // 攒着的消息（等她进入下一个时段、有第一条消息进来时一起给她）
  // 每条：{ 时间, 行, 是私聊, 有人at我 }   —— 「行」就是已经排好的那一行文字
  let 攒消息 = Array.isArray(上回状态.攒们) ? 上回状态.攒们 : []
  let 攒的是哪个时段的 = String(上回状态.攒时段 || '') // 记着这批是哪个时段攒的，用来生成"你睡着的时候"这种话
  const 攒上限 = 60 // 条数上限，防止惰性 11 小时 + 群聊人多把上下文撑爆

  /** 把一条消息塞进攒的队伍里（满了就丢最老的，保留最近的） */
  const 攒起来 = (条) => {
    if (攒的是哪个时段的 === '') 攒的是哪个时段的 = 作息()
    if (攒消息.length >= 攒上限) 攒消息.shift()
    攒消息.push(条)
    存状态()
  }

  /**
   * 把攒的消息打包成一段话（没有就返回空文本）；调用后清空。
   * ⭐ 2026-10-24 P1-4：改成回 `{ 文本, 含群 }` —— 调用方要知道"这一批里有没有群消息"，
   *   有的话这一轮按群轮次算（护栏收窄），哪怕眼下这条是私聊。
   */
  const 打包攒消息 = () => {
    if (!攒消息.length) return { 文本: '', 含群: false }
    const 条数 = 攒消息.length
    const 哪个 = 攒的是哪个时段的 === '休息' ? '你睡着的时候' : '那会儿你不太想说话的时候'
    // 每条前面标个序号，方便她"挑着回"时指得到是第几条
    const 正文 = 攒消息.map((x, i) => `${i + 1}. ${x.行}`).join('\n')
    const 有私聊 = 攒消息.some((x) => x.是私聊)
    const 有群 = 攒消息.some((x) => !x.是私聊)
    const 有人at = 攒消息.some((x) => x.有人at我)
    攒消息 = []
    攒的是哪个时段的 = ''
    存状态()
    const h = new Date().getHours()
    // ⭐⭐ 让她**自己**判断：哪些要回、哪些不用回、回了的话连发的就并成一句。
    //   不要写"请逐条回复"——她会变成客服。要像一个人翻手机：这几条都得回，那几条算了。
    const 问一句 =
      '哪些要回、哪些不用回，你自己看。' +
      (有私聊 ? '\n有人是专门找你说的，那种通常得回一下。' : '') +
      (有人at ? '\n有人在群里 @ 你，回不回也由你——真不想理就放着。' : '') +
      '\n同一件事被好几个人提过，回一句就够了，别一条一条回。'
    return {
      文本:
        `（${哪个}，这些人说过话，现在一起给你（共 ${条数} 条）：\n\n${正文}\n\n` +
        `现在 ${h} 点多了。${问一句}）`,
      含群: 有群,
    }
  }

  // ⭐ 每个群各自的水位（两个群不能共用一个「上次看到哪」）
  const 群水位 = new Map(Object.entries(上回状态.群水位 || {}))

  /** 把攒消息 + 水位写回磁盘（小文件，直接写；关机也不丢） */
  function 存状态() {
    try {
      writeFileSync(
        状态文件,
        JSON.stringify(
          {
            攒们: 攒消息,
            攒时段: 攒的是哪个时段的,
            上次私聊时间,
            上次群时间,
            群水位: Object.fromEntries(群水位),
            已转消息: [...已转消息].slice(-500),
            保存时间: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      )
    } catch (error) {
      // 写不进去也不该影响收发；下次有消息再试
    }
  }

// ⭐ 消息缓存（id → 谁说的/说了什么）：引用回复靠它还原被引用的原话
  const 消息缓存 = new Map()
  const 记缓存 = (id, 称呼, 文字, 群号, uid) => {
    if (!id) return
    消息缓存.set(String(id), { 称呼, 文字: String(文字 || ''), 群号: Number(群号 || 0), uid: Number(uid || 0) })
    if (消息缓存.size > 300) 消息缓存.delete(消息缓存.keys().next().value)
  }
  const 取引用 = (条) => {
    const s = (条 && 条.message || []).find((x) => x && x.type === 'reply')
    if (!s) return ''
    const id = String((s.data && s.data.id) || '')
    const c = 消息缓存.get(id)
    if (!c) return '〔引用了一条更早的消息〕'
    return '〔引用 ' + c.称呼 + '：' + c.文字.slice(0, 40) + '〕'
  }

    // ⭐ 群号 → 群名（只读群用，显示来源）
  let 群表 = new Map()
  let 群表时间 = 0
  async function 刷新群表(配置) {
    if (Date.now() - 群表时间 < 60 * 1000 && 群表.size) return 群表
    try {
      const r = await fetch(配置.NapCat + '/get_group_list', { method: 'POST', headers: 头(), body: '{}' })
      const j = await r.json()
      if (j && j.status === 'ok' && Array.isArray(j.data)) {
        const 新表 = new Map()
        for (const g of j.data) {
          if (g && g.group_id) 新表.set(Number(g.group_id), String(g.group_name || ''))
        }
        if (新表.size) { 群表 = 新表; 群表时间 = Date.now() }
      }
    } catch (error) {
      记账('拉群列表失败：' + String((error && error.message) || error))
    }
    return 群表
  }

  // ⭐ 没聊过的人：NapCat 查历史会报「消息不存在」，别每 4 秒去撞一次。
  //   ⚠ 2026-10-25 修：原来缓存 10 分钟 —— 部署完对方第一次发消息，如果那一刻刚好
  //   查过一次空历史，这条消息会在 NapCat 历史里躺着、却被跳过 10 分钟（实测：14:33 拖到 14:43）。
  //   改成 60 秒，并且**一有出站消息就清掉缓存**（见 发一个）。
  const 空历史 = new Map() // uid → 上次确认“查不到”的时间
  const 空历史跳过 = (uid) => {
    const t = 空历史.get(uid) || 0
    return Date.now() - t < 60 * 1000
  }

  // ⭐ 主动发消息的额度：落盘、按自然日算（重启不清零）
  const 额度文件 = join(目录, 'qq-bridge-quota.json')
  const 今天 = () => {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
  }
  const 读额度 = () => {
    try {
      const j = JSON.parse(readFileSync(额度文件, 'utf8'))
      return j && j.date === 今天() && j.users && typeof j.users === 'object' ? j.users : {}
    } catch (error) {
      return {}
    }
  }
  const 写额度 = (users) => {
    try {
      writeFileSync(额度文件, JSON.stringify({ date: 今天(), users }, null, 2), 'utf8')
    } catch (error) {}
  }
  const 今日已用 = (uid) => Number(读额度()[String(uid)] || 0)
  const 记一笔 = (uid) => {
    const u = 读额度()
    u[String(uid)] = Number(u[String(uid)] || 0) + 1
    写额度(u)
  }
  // ⭐ 身份表：QQ号 → 称呼。只认她好友列表里的「备注」，没备注的一律不认
  let 好友表 = new Map()
  let 好友表时间 = 0

  function 记账(文本) {
    const d = new Date()
    const 补 = (n) => String(n).padStart(2, '0')
    const 时间 = `${补(d.getMonth() + 1)}-${补(d.getDate())} ${补(d.getHours())}:${补(d.getMinutes())}:${补(d.getSeconds())}`
    日志.push({ 时间, 文本 })
    if (日志.length > 日志上限) 日志.shift()
    try {
      ctx.logger?.info(`qq-bridge: ${文本}`)
    } catch (error) {}
  }

  // ⭐ 2026-10-25 p31：所有外发的总闸（限速）。真正送出去之前先在这里排队。
  //   为什么放在 发一个 里而不是每个工具里：群/私聊一共十几处发消息，逐个改必漏一处。
  //   群里连发 0.37 秒 → 现在群/私聊各自最小间隔 3 秒、每 6 条歇 90 秒（保守档）。
  const 限速状态 = {}
  // 只有「真的把消息送出去」的 action 才排队；查列表、试探接口之类的动作不排
  const 排队动作 = new Set(['send_group_msg', 'send_private_msg'])
  const 排队键 = (action) => (action === 'send_group_msg' ? 'qq-group' : 'qq-private')
  async function 等限速(action) {
    if (!排队动作.has(action)) return
    const 键 = 排队键(action)
    let 等 = 还要等多久(限速状态, 键, Date.now())
    if (等 <= 0) return
    // 只在「真的等得久」时记一笔，免得日志被刷屏
    if (等 >= 5000) 记账(`发送限速：${说多久(等)}再发（${action === 'send_group_msg' ? '群' : '私聊'}）`)
    await new Promise((r) => setTimeout(r, 等))
    // 睡醒后可能又有别人排进来，再确认一次（避免睡眠误差导致两条同时出去）
    等 = 还要等多久(限速状态, 键, Date.now())
    if (等 > 0) await new Promise((r) => setTimeout(r, 等))
  }

  async function 发一个(base, action, 体) {
    await 等限速(action)
    try {
      const r = await fetch(`${base}/${action}`, {
        method: 'POST',
        headers: 头(),
        body: JSON.stringify(体),
      })
      const j = await r.json()
      const 成 = !!(j && j.status === 'ok' && j.retcode === 0)
      // 只有真的发出去了才记账；失败的不占额度（不然被限流时会更难恢复）
      if (成 && 排队动作.has(action)) 记一笔(限速状态, 排队键(action), Date.now())
      // ⭐ 2026-10-25：私聊发出去了，说明这条路通了 —— 顺手清掉「空历史」缓存，
      //   否则对方马上回一句，最多要等 60 秒才被读到。
      if (成 && action === 'send_private_msg' && 体 && 体.user_id) 空历史.delete(Number(体.user_id))
      return { action, ok: 成, 数据: j }
    } catch (error) {
      return { action, ok: false, 数据: { 错: String((error && error.message) || error) } }
    }
  }

  /** 把一段长文字按空行拆成自然段（没有空行就整段）。 */
  function 按段拆(文字) {
    const 段 = String(文字 || '')
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return 段
  }

  /** 把一句正文发到该发的地方（私聊 / 群）；按空行拆段，一段一条连发。 */
  async function 发到QQ(配置, 文字, 目标) {
    const 出 = []
    const 段们 = 按段拆(文字).length ? 按段拆(文字) : [文字.trim()]
    const 发段延迟 = 450 // 每段之间隔一下，像真人一条条发

    // ⭐ 有明确收件人：只回给这个人，不发群、也不发给别人
    if (目标 && 目标.uid) {
      for (let i = 0; i < 段们.length; i++) {
        const 体 = 私人消息体(段们[i])
        体.user_id = Number(目标.uid)
        出.push(await 发一个(配置.NapCat, 'send_private_msg', 体))
        if (i < 段们.length - 1) await new Promise((r) => setTimeout(r, 发段延迟))
      }
      return 出
    }

    if (配置.转私聊 && 配置.私聊QQ) {
      for (let i = 0; i < 段们.length; i++) {
        const 体 = 私人消息体(段们[i])
        体.user_id = Number(配置.私聊QQ)
        出.push(await 发一个(配置.NapCat, 'send_private_msg', 体))
        if (i < 段们.length - 1) await new Promise((r) => setTimeout(r, 发段延迟))
      }
    }
    if (配置.转群 && 配置.群号) {
      for (let i = 0; i < 段们.length; i++) {
        const 体 = 群消息体(段们[i])
        体.group_id = Number(配置.群号)
        出.push(await 发一个(配置.NapCat, 'send_group_msg', 体))
        if (i < 段们.length - 1) await new Promise((r) => setTimeout(r, 发段延迟))
      }
    }
    return 出
  }

  /**
   * 这一轮是从哪个群挑起来的（没群消息挑起来就是 null）。
   * qq_group_say 没填「群」时用它当默认值，省得她认不出群名就放弃了。
   */
  function 这轮来自哪个群() {
    return 待回 && 待回.群号 ? 待回 : null
  }

  /** 一轮真正落地：总开关 / 试运行 在这儿把关。 */
  async function 落地一发(配置, 文字, 目标) {
    if (已发轮.size > 300) 已发轮.clear() // 防 Set 无限长
    if (!配置.目标会话) return 记账('还没填「目标会话」，不知道该盯哪个，这轮不转')
    // ⭐ 不是 QQ 挑起的这一轮（爸爸在界面说的）→ 一个字都不发到 QQ
    if (!目标) return 记账('这一轮不是 QQ 来的（界面里说的），不发到 QQ')
    // ⭐ 盯的会话已经归档了：别转（人已经不在这儿说话了）
    try {
      const 登记 = ctx.workspaceRegistry || ctx.get('workspaceRegistry')
      const 归档 = new Set((((登记 && 登记.archivedSessionIds) || [])).map(String))
      if (归档.has(String(配置.目标会话))) return 记账('「目标会话」已经归档了，这轮不转（去设置里重新挑一个）')
    } catch (error) {}
    if (!配置.总开关) return 记账('总开关关着，这轮该转但没转')
    // ⭐ 群里挑起来的一轮：她的回话由她自己调 qq_group_say 决定要不要说（人格约定：不调用 = 沉默）
    //    所以这里不替她自动发群，只记账提醒一下
    if (目标.群号 && !目标.uid) {
      return 记账(`这一轮是群「${目标.群名 || 目标.群号}」挑起的；她说没说，看有没有调 qq_group_say`)
    }
    if (配置.试运行) {
      return 记账(`试运行：本来要发回给 ${目标.标签 || 目标.uid} →「${文字.slice(0, 40)}${文字.length > 40 ? '…' : ''}」`)
    }
    const 结果 = await 发到QQ(配置, 文字, 目标)
    const 全过 = 结果.length > 0 && 结果.every((r) => r.ok)
    if (结果.length === 0) {
      记账('转私聊 / 转群都没开，或没填 QQ 号 / 群号：没地方发')
      return
    }
    记账(`${全过 ? '✅ 已发到 QQ：' : '⚠ 发 QQ 有问题：'}「${文字.slice(0, 50)}${文字.length > 50 ? '…' : ''}」`)
    for (const r of 结果) {
      if (!r.ok) 记账(`   ${r.action} 失败：${JSON.stringify(r.数据).slice(0, 140)}`)
    }
  }

  /** 盯会话事件：记住这一轮最后一句，在 turn/end 时落地。 */
  function 收到事件(session, event) {
    const 配置 = 读配置()
    if (!配置.目标会话) return
    if (String(session && session.id) !== String(配置.目标会话)) return

    if (event && event.type === 'assistant/message') {
      const d = event.data || {}
      if (d.interrupted) {
        上一轮 = { 轮号: -1, 文本: '' }
        待回 = null
        return
      }
      const 文 = 提取正文(d.message)
      if (文) 上一轮 = { 轮号: d.turn, 文本: 文 }
      return
    }

    if (event && event.type === 'turn/end') {
      const d = event.data || {}
      const 完成 = !!(d.reason && d.reason.kind === 'completed')
      if (完成 && 上一轮.轮号 === d.turn && 上一轮.文本 && !已发轮.has(d.turn)) {
        已发轮.add(d.turn)
        void 落地一发(配置, 上一轮.文本, 待回)
      }
      上一轮 = { 轮号: -1, 文本: '' }
      待回 = null // 一轮只用一次：这一轮回完了，下一轮重新判断是谁引起来的
    }
  }

  // ---------- 路由（将来给设置页用；现在也能用来手动试） ----------

  const 回 = (res, o) => {
    try {
      res.setHeader?.('content-type', 'application/json; charset=utf-8')
      res.end?.(JSON.stringify(o))
    } catch (error) {}
  }

  const 读体 = async (req) => {
    let body = ''
    try {
      for await (const chunk of req) body += chunk
    } catch (error) {}
    try {
      return JSON.parse(body || '{}')
    } catch (error) {
      return {}
    }
  }

  const 短id = (id) => {
    const s = String(id)
    return s.length <= 8 ? s : s.slice(-8)
  }

  /* 拿目标会话活着的 agent：带 / 不带 `session-` 前缀两个方向都试（照 speak-up 的写法）。 */
  const 找agent = (id) => {
    const 原 = String(id == null ? '' : id).trim()
    if (原 === '') return undefined
    const 候选 = [原]
    if (原.startsWith('session-')) 候选.push(原.slice('session-'.length))
    else 候选.push('session-' + 原)
    for (const 一个 of 候选) {
      try {
        const a = ctx.agents.get(一个)
        if (a !== undefined) return a
      } catch (error) {}
    }
    return undefined
  }

  const 新id = () => {
    try {
      return randomUUID()
    } catch (error) {
      return 'qq-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    }
  }

  /**
   * 手搓一条 user 消息（跟 speak-up 一样：role=user，source.kind 标成 qq，不冒充她亲手打的）。
   * ⭐ 2026-10-24 P1-4：kind 分两种 —— `qq-group`（群里说的，或私聊里夹带了群消息）/ `qq-private`。
   *   护栏插件（dsh-qq-guard）靠这个值判断"这一轮要不要收窄工具"。别改回统一的 'qq'，
   *   否则护栏认不出群轮次，等于没装。
   */
  const 手搓用户消息 = (文案, 种类 = 'qq') => ({
    id: 新id(),
    role: 'user',
    content: [{ type: 'text', text: String(文案) }],
    source: { kind: String(种类) },
  })

  /**
   * ⭐ 拉好友列表，建「QQ号 → 称呼」表。
   * 只用 remark（她给好友起的备注），**没有备注的一律不认**——别人的昵称、群名片改成「爸爸」都没用。
   * 备注以「爸爸」开头 → 爸爸；以「妈妈」开头 → 妈妈（含「妈妈的小号」，归同一个人）。
   */
  // ⭐ 2026-10-25 p32：NapCat 在不在线，单独记一笔。
  //   实测的坑：DSH 和 Docker 一起退出/一起起，桥启动时 NapCat 还没回来，
  //   于是「拉好友列表失败：fetch failed」+「好友列表里没有认得出的备注…先在她 QQ 上把备注改好」
  //   连刷 20 秒 —— 后者是**误报**（她 13 秒后就正常收发了），会让人以为备注丢了去瞎改。
  //   所以：连不上不等于「备注没设好」，得分开说。
  let NapCat曾上线 = false
  let 上次连不上日志 = 0
  function 记离线(在不在线) {
    if (在不在线) {
      if (!NapCat曾上线) 记账('NapCat 已连上')
      NapCat曾上线 = true
      上次连不上日志 = 0
      return
    }
    // 还没上线过：只记一次「等它回来」，不刷屏；也不要说成备注的问题
    if (!NapCat曾上线) {
      if (Date.now() - 上次连不上日志 > 30 * 1000) {
        上次连不上日志 = Date.now()
        记账('NapCat 还没起来（后台服务可能刚拉起），先等它回来，不轮询')
      }
      return
    }
    // 上线过又掉了：这才是真异常
    if (Date.now() - 上次连不上日志 > 60 * 1000) {
      上次连不上日志 = Date.now()
      记账('和 NapCat 断了，等它回来（消息不会丢，回来后会补）')
    }
  }

  async function 刷新好友表(配置, 强制) {
    const 新鲜 = Date.now() - 好友表时间 < 5 * 60 * 1000
    if (!强制 && 新鲜 && 好友表.size) return 好友表
    try {
      const r = await fetch(`${配置.NapCat}/get_friend_list`, {
        method: 'POST',
        headers: 头(),
        body: '{}',
      })
      const j = await r.json()
      if (j && j.status === 'ok' && Array.isArray(j.data)) {
        记离线(true)
        const 新表 = new Map()
        for (const f of j.data) {
          const 备注 = String((f && f.remark) || '').trim()
          if (!备注) continue
          // 备注里带「小号」的一律不进表：那是没上线的号，她不该看见
          if (备注.includes('小号')) continue
          const 号 = Number(f.user_id)
          if (!号) continue
          // ⭐ 认人规则来自配置里的「身份表」，不再写死爸爸/妈妈。
          //    想加人、换称呼、改成「老大/阿姨」都只改配置。
          const 规则 = (配置.身份表 || []).find((r) => r && r.备注前缀 && 备注.startsWith(String(r.备注前缀)))
          if (规则) 新表.set(号, String(规则.称呼 || 规则.备注前缀))
        }
        if (新表.size) {
          好友表 = 新表
          好友表时间 = Date.now()
        }
      }
    } catch (error) {
      // ⭐ p32：连不上 ≠ 备注没设好。只在真掉线时才记，而且限频（上面 记离线 管）
      记离线(false)
    }
    return 好友表
  }

  /** 她自己的 QQ：配置里有就用配置的，没有就问 NapCat 一次（结果缓存）。 */
  let 自己QQ缓存 = 0
  async function 取自己QQ(配置) {
    if (配置.自己QQ) return Number(配置.自己QQ)
    if (自己QQ缓存) return 自己QQ缓存
    try {
      const r = await fetch(`${配置.NapCat}/get_login_info`, { method: 'POST', headers: 头(), body: '{}' })
      const j = await r.json()
      if (j && j.status === 'ok' && j.data && j.data.user_id) 自己QQ缓存 = Number(j.data.user_id)
    } catch (error) {}
    return 自己QQ缓存
  }

  /** 现在开着的会话清单（id + 标题），给设置页挑「目标会话」用 —— 不手填。 */
  const 会话清单 = () => {
    const 出 = []
    // ⭐ 归档的会话不列（归档只是藏起来，list() 里还在 —— 得单独查 workspaceRegistry 的名单）
    //   2026-10-20 修：以前完全不看归档，设置页里挑会话时混着一堆已经归档的
    const 归档 = new Set()
    try {
      const 登记 = ctx.workspaceRegistry || ctx.get('workspaceRegistry')
      for (const x of (登记 && 登记.archivedSessionIds) || []) 归档.add(String(x))
    } catch (error) {}
    try {
      const 会话服务 = ctx.get('sessions')
      const 标题服务 = ctx.get('sessionTitle')
      if (会话服务 && typeof 会话服务.list === 'function') {
        for (const s of 会话服务.list()) {
          if (归档.has(String(s.id))) continue
          let 标题 = ''
          try {
            const 快照 = 标题服务 && typeof 标题服务.get === 'function' ? 标题服务.get(s) : undefined
            标题 = 快照 && 快照.title ? String(快照.title) : ''
          } catch (error) {}
          出.push({ id: String(s.id), 标题 })
        }
      }
    } catch (error) {}
    return 出
  }

  const 概况 = async () => {
    const 配置 = 读配置()
    const 今日额度 = 读额度()
    const 清单 = 会话清单()
    let NapCat状态 = null
    try {
      const r = await fetch(`${配置.NapCat}/get_login_info`, { method: 'POST', headers: 头(), body: '{}' })
      const j = await r.json()
      if (j && j.status === 'ok') NapCat状态 = { 用户: j.data.user_id, 昵称: j.data.nickname }
    } catch (error) {
      NapCat状态 = { 错: String((error && error.message) || error) }
    }
    return { ok: true, 版本, 配置, 配置文件, NapCat状态, 好友表: [...好友表].map(([uid, 标签]) => ({ uid, 标签 })), 今日额度, 活着的会话: 清单, 目标情况: 配置.目标会话 && 清单.length ? 清单.filter((x) => x.id === 配置.目标会话) : [], 攒着: 攒消息.length, 日志 }
  }

  const 路线 = (路径, handler) =>
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: 路径,
        handler: async (req, res) => {
          try {
            await handler(req, res)
          } catch (error) {
            回(res, { ok: false, 说: String((error && error.message) || error) })
          }
        },
      }),
    )

  // ⭐⭐ 2026-10-24 P0-1 · 管理路由闸
  //   挡的是这件事：群里有人让她敲一行 Invoke-RestMethod 调 /save，就把总开关关了。
  //   放行条件（任一满足）：
  //     1) 带 x-qiyu-admin 头，且等于配置里的「管理令牌」（令牌非空时）
  //     2) Origin/Referer 的 host 和本次请求的 Host 一致（= 设置页自己发的）
  //     3) 带 Sec-Fetch-* 头（浏览器一定会带，命令行工具不会）
  //   ⚠ 这不是密码学级的墙：Origin / Sec-Fetch 都能伪造。它只是把门槛从
  //     「会复制一行命令」抬到「得知道要伪造什么」，并且每次都留一条日志。
  const 管理请求可信 = (req) => {
    try {
      const 头 = (req && req.headers) || {}
      const 令牌 = String(读配置().管理令牌 || '')
      if (令牌 && String(头['x-qiyu-admin'] || '') === 令牌) return true
      const 来源 = String(头.origin || 头.referer || '')
      if (来源 && 来源 !== 'null') {
        try {
          if (new URL(来源).host === String(头.host || '')) return true
        } catch (error) {}
      }
      if (头['sec-fetch-mode'] || 头['sec-fetch-site']) return true
      return false
    } catch (error) {
      return false
    }
  }

  const 挡管理请求 = (req, res, 名) => {
    if (管理请求可信(req)) return false
    try {
      res.statusCode = 403
    } catch (error) {}
    回(res, { ok: false, 说: '拒绝：这个接口只接受设置页本身（或带管理令牌）的请求' })
    记账(`拒绝了管理请求：${名}（来源：${String((req && req.headers && (req.headers.origin || req.headers.referer)) || '无')}）`)
    return true
  }

  路线(`${路由前缀}/state`, async (req, res) => {
    await 读体(req)
    回(res, await 概况())
  })

  路线(`${路由前缀}/save`, async (req, res) => {
    if (挡管理请求(req, res, 'save')) return
    const 来 = await 读体(req)
    const 现在 = 读配置()
    const 新 = { ...现在, ...(来 && typeof 来 === 'object' ? 来 : {}) }
    const 洗好 = 归一化(新)
    if (!写配置(洗好)) return 回(res, { ok: false, 说: `写不进配置文件：${配置文件}` })
    const 状态 = 洗好.总开关 ? (洗好.试运行 ? '（只记账）' : '（真发）') : '（总开关关着）'
    记账(`设置已保存：目标会话 ${洗好.目标会话 || '（没填）'}｜私聊 ${洗好.私聊QQ || '（没填）'}｜群 ${洗好.群号 || '（没填）'}｜${状态}`)
    回(res, { ...(await 概况()), 说: '保存好了' })
  })

  // 手动清零今天的主动发消息额度
  路线(`${路由前缀}/reset-quota`, async (req, res) => {
    if (挡管理请求(req, res, 'reset-quota')) return
    await 读体(req)
    写额度({})
    记账('今日主动发消息的额度已清零')
    回(res, { ok: true, 说: '今天主动发消息的次数已清零', 今日额度: {} })
  })

  // 收到 QQ 里你发来的话 → 喂进目标会话，让它照常开一轮。
  // ⚠ 这是「QQ → DSH」那半的**入口函数**：一句正文 → agent.followup 走 DSH 自己的回合。
  // ⭐ 2026-10-24 P0-3：有没有人 @ 她，改成由调用方传进来（群那边按 NapCat 的 at 段算好），
  //   不再对拼好的文本跑正则 —— 否则群友打一句「（这条在 @你）」就能在惰性时段把她叫醒。
  //
  // ⭐ 2026-10-24 P3：**关键词告警**。只记账、不改行为 —— 那些话照样给她（她还有护栏 + 提示规则），
  //   但日志里留一行，出事时能回头看见"哪句像是注入"。词表在 ./可疑话术.mjs（可离线单测）。
  function 扫可疑话术(文, 来自) {
    try {
      const r = 扫可疑(文)
      if (!r.该报) return
      记账(`⚠ 可疑话术（${来自}，命中 ${r.命中.join('、')}）：${String(文).slice(0, 60).replace(/\n/g, ' ')}`)
    } catch (error) {}
  }

  async function 转入文字(文字, 标签, uid, 群信息, 有人at我 = false) {
    const 配置 = 读配置()
    if (!配置.目标会话) return { ok: false, 说: '还没选「目标会话」' }
    if (!配置.总开关) return { ok: false, 说: '总开关关着，先打开' }
    扫可疑话术(文字, 群信息 && 群信息.群名 ? `群「${群信息.群名}」` : `${标签 || '某人'}私聊`)

    // ⭐⭐ 作息分流（见上面的四象限表）。在这里拦，是因为只有这一步同时知道
    //   「现在几点」「是私聊还是群聊」「有没有人 @ 她」。
    const 现在时段 = 作息()
    const 是私聊 = !!uid
    // ⭐ 2026-10-25 p35：私聊也要标渠道（`【QQ私聊】[爸爸] …`），和她看得清的群消息格式对齐。
    //   起因：她 11:44 说「这条还是只有 [爸爸]，没标渠道」「跟面板上的一样，分不出是哪边」。
    //   她没说错 —— 桥对群消息给了【群名】，对私聊只给了 [爸爸]，
    //   而**面板/界面说进来的话本来就不经过桥**，所以标上 QQ私聊 反而帮她分清"桥转的"和"界面说的"。
    const 这一行 = 是私聊 ? `【QQ私聊】[${标签 || '有人'}] ${文字}` : 文字

    if (现在时段 === '休息') {
      // 0-9 点：除了爸爸在界面说话，其他一律叫不醒（用户 21:47 明确要求）
      攒起来({ 行: 这一行, 是私聊, 有人at我 })
      return { ok: true, 攒着: true, 说: `她在睡觉（${现在时段}），攒着明早一起给（现在攒了 ${攒消息.length} 条）` }
    }

    if (现在时段 === '惰性') {
      // 惰性时段：私聊立刻给；@ 她立刻给但劝退；群闲聊攒着
      if (!是私聊 && !有人at我) {
        攒起来({ 行: 这一行, 是私聊, 有人at我 })
        return { ok: true, 攒着: true, 说: `她在偷懒（惰性时段），群闲聊先攒着（现在攒了 ${攒消息.length} 条）` }
      }
      // 私聊 / @ 她：立刻给，但要说清她现在的状态
      const 劝退 = `\n（这会儿是你的惰性时间，你本来不太想说话。不想回就不回。）`
      return 转入正文(配置, 文字 + 劝退, 标签, uid, 群信息)
    }

    // 活跃时段：正常给
    return 转入正文(配置, 文字, 标签, uid, 群信息)
  }

  /** 真正送进会话（把原来 转入文字 的后半段搬到这里） */
  async function 转入正文(配置, 文字, 标签, uid, 群信息) {
    // ⭐ 2026-10-25 p34：「阅读时间」必须排在**叫醒之前**。
    //
    //   踩过的坑（爸爸 11:27 转述她的话："我这边分不出来源，标签上没写"）：
    //   p32 把等待放在「叫醒之后、followup 之前」—— 于是她**先醒了**，
    //   但手里没有任何消息，自己在空转的那 15 秒里跑了一轮，这一轮没有桥打的来源标签
    //   （日志顺序：11:26:53 "目标会话本来没醒着…把它叫醒了" → 11:27:08 "收到 1 条，用时 14.9 秒"）。
    //   她没糊涂，是时序把她晾在了半路。
    //
    //   现在：先把要发的东西准备好 → 睡 5~15 秒（这时会话还没醒）→ 叫醒 → 立刻 followup。
    //   她睁眼第一件事就是看到带来源标记的消息，中间没有任何空档。
    //
    //   打包消息也有，所以打包文案要在这里一起决定 —— 不能等 followup 时才拼（那时她可能已经醒了）。
    //   ⚠ 打包攒消息() 是**有副作用**的（取走就清空）。所以必须把「如果最后没送成，把攒消息放回去」
    //     这条补救做出来，否则叫醒失败时这些消息就永久丢了。
    let 全文 = 标签 ? `【QQ私聊】[${标签}] ${文字}` : 文字
    const 攒的原样 = { 攒消息, 时段: 攒的是哪个时段的 }
    const 打包 = 打包攒消息()
    const 有打包 = !!打包.文本
    /** 没送成 → 把刚才取走的攒消息放回去（顺序不动，免得下次丢） */
    const 还回攒消息 = () => {
      if (!有打包) return
      攒消息 = 攒的原样.攒消息
      攒的是哪个时段的 = 攒的原样.时段
      存状态()
      记账(`没送成，把 ${攒消息.length} 条攒消息放回去了`)
    }
    if (有打包) 全文 = 打包.文本 + '\n\n' + 全文
    const 来源种类 = 群信息 && 群信息.群号 && !uid ? 'qq-group' : 'qq-private'

    // ── 阅读时间（在叫醒之前）──
    const 阅读 = 回复前等多久()
    if (!有打包) {
      await new Promise((r) => setTimeout(r, 阅读))
    } else {
      // 打包场景稍微停一下就好（她本来就知道这些是之前的事）
      await new Promise((r) => setTimeout(r, Math.min(阅读, 5000)))
    }

    let agent = 找agent(配置.目标会话)
    if (!agent) {
      // ⭐ QQ 里有人说话 = 该把她叫醒。跟 speak-up 那种“自己闲得慌想开口”不同，这是有人找她
      try {
        const 会话服务 = (typeof ctx.get === 'function' ? ctx.get('sessionController') : null) || ctx.sessionController
        if (会话服务 && typeof 会话服务.resolveAgent === 'function') {
          await 会话服务.resolveAgent(配置.目标会话)
          agent = 找agent(配置.目标会话)
          if (agent) 记账('目标会话本来没醒着，QQ 这条把它叫醒了')
        } else {
          记账('这个 DSH 版本没有 sessionController.resolveAgent，叫不醒冷会话')
        }
      } catch (error) {
        记账(`叫醒失败：${String((error && error.message) || error)}`)
      }
    }
    if (!agent) {
      还回攒消息()
      return { ok: false, 说: `目标会话现在没活着（${短id(配置.目标会话)}），先把它打开` }
    }
    if (有打包) {
      记账(`把攒着的消息一起给她了（${打包.文本.slice(0, 40)}…）`)
    }
    // ⭐ 2026-10-24 P1-5c：按**触发这一轮的那条消息**定来源（见下面的注释）
    if (打包.含群 && 来源种类 === 'qq-private') {
      记账('注意：这轮是私聊挑起的，但打包里有群消息；按私聊放行（群消息只当背景）')
    }
    try {
      // ⚠⚠ 必须 await：followup 返回 Promise。不接住的话，它 reject 时（会话半死 / agent 已释放）
      //   catch 根本看不到（try 早就退出了）⇒ 未处理的 rejection ⇒ **整个 DSH 宿主退出**
      //   （2026-10-21：speak-up 同一个坑已经被用户报成"装了鱼就死了"，这里一并修）
      await agent.followup(手搓用户消息(全文, 来源种类))
      try {
        if (ctx.sessions && typeof ctx.sessions.flush === 'function') await ctx.sessions.flush(agent.session)
      } catch (error) {}
      // ⭐ 私聊：回给这个人；群聊：回那个群（引用挑她起来的那条）
      待回 = uid ? { uid: Number(uid), 标签 } : 群信息 && 群信息.群号 ? { 群号: Number(群信息.群号), 群名: 群信息.群名, 称呼: 群信息.称呼, 引用id: 群信息.引用id } : null
      // ⭐ 记下这一轮是谁发起的（只认 QQ 号，不认名片）：私聊看 uid，群聊看 群信息.发起人QQ
      本轮发起QQ = uid
        ? Number(uid)
        : Number((群信息 && 群信息.发起人QQ) || 0) || 0
      记账(`收到 QQ 里的话（${标签 || (群信息 && 群信息.群名) || '未知'}）→ 转进 DSH：「${全文.slice(0, 50)}${全文.length > 50 ? '…' : ''}」`)
      return { ok: true, 说: '转进去了，它会照常开一轮' }
    } catch (error) {
      还回攒消息()
      return { ok: false, 说: `followup 失败：${String((error && error.message) || error)}` }
    }
  }

  /**
   * 轮询 NapCat 的 HTTP 历史接口，把「她新发的私聊 / 群消息」一条条转进 DSH。
   * ⚠ 纯 HTTP 轮询：不连 WebSocket、不依赖 BOT。
   * ⚠ 只认 `私聊QQ` 这个人发的（群也一样按这个号过滤），自己的回话不会自我繁殖。
   */
  /**
   * 发言前的底线检查：这些内容发出去，账号可能被腾讯限制或封禁。
   * 返回 null = 可以发；返回字符串 = 不能发的原因。
   */
  function 内容红线(文字) {
    const 文 = String(文字 || '')
    if (!文.trim()) return '空的，没什么要说的'

    // 链接 / 二维码 / 引流：QQ 最容易判定为广告诈骗
    if (/https?:\/\//i.test(文) || /www\./i.test(文) || /\b[a-z0-9-]+\.(com|cn|net|org|top|xyz|cc)\b/i.test(文)) {
      return '发送链接容易被判定成广告，不发'
    }
    if (/(扫码|二维码|扫一扫|加群|进群|进我们群|私聊我|加我|拉你|引流|刷单|兼职|返利|代练|代充|收号|出号|卖号)/.test(文)) {
      return '这句话像是引流/广告，会被封号，不发'
    }
    // 违法违规
    if (/(色情|约炮|裸聊|黄片|赌博|博彩|下注|彩票|毒品|冰毒|大麻|枪支|弹药|炸药|翻墙|VPN|机场)/i.test(文)) {
      return '这类内容违法违规，绝对不发'
    }
    // 人身攻击（会被举报）
    if (/(傻逼|智障|脑残|去死|死全家|nmsl|rnm|cnm|操你|草你)/i.test(文)) {
      return '骂人/攻击性的话会被举报，换个说法'
    }
    // 刷屏特征
    if (/(.)\1{9,}/.test(文)) return '重复太多字，像刷屏，不发'
    return null
  }

  /**
   * ⭐ 2026-10-25 p31：群里说话前，把「本机绝对路径」剔掉。
   *
   * 为什么：10-24 她连着三次把本机的绝对路径（`C:\...\作品\xxx.png` 这种）原样贴进群
   *   （19:20、19:27）。那其实是她**做不到缩图时的退路**——真人不会随手打出这种路径，
   *   这是"不像人"的强指纹，也正好踩在风控的「内容侧」。
   *
   * 注意：**只清洗 qq_group_say 的文字**。
   *   qq_sticker / qq_draw / qq_voice 参数里的完整路径只是"给工具找文件用的"，
   *   **不会进聊天**（它们是发图片段/语音段），所以一个字都不动。
   *
   * 返回 { 话, 全删了 }：全删了 = 她整句就是一条路径，这种直接拒发并给路标。
   */
  function 清群里的路径(文字) {
    const 原 = String(文字 || '')
    let 净 = 原
      // 盘符路径：W:\a\b  D:/a/b（允许中文、空格、连字符；遇到空白/中文标点就停）
      .replace(/[A-Za-z]:[\\/][^\s<>"'|?*\r\n，。、；：！？）】》""'']*/g, '')
      // file:/// 开头
      .replace(/file:\/\/\/[^\s]*/gi, '')
      // 带反斜杠的本机目录片段（比如 \character\画板\作品\x.png）
      .replace(/[\\/][^\s\\/]+[\\/][^\s\\/]+[\\/][^\s]*\.(png|jpe?g|gif|webp|bmp|svg|mp3|wav|ogg)\b/gi, '')
    // 删完留下的空括号/多余空白收拾一下
    净 = 净.replace(/[（(]\s*[）)]/g, '') // 空的（）留着很怪
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^[\s，。、；：,.;:]+|[\s，。、；：,.;:]+$/g, '')
      .trim()
    return { 话: 净, 全删了: !净 && !!原.trim() }
  }

  /**
   * 群里不能贴路径时，告诉她**正确的路**（护栏 v0.2.1「拒绝要报路」的同一套思路：
   * 只说"这轮做不了"是半句话，她会一直撞同一面墙）。
   */
  const 路径路标 = '群里别贴本机路径（看起来不像人在说话）。要说图/画/语音：'
    + '发图用 qq_sticker 填「发哪张」+「群」，要小就再加「宽」（比如 400）；'
    + '画图用 qq_draw 填「群」，画完直接发；发语音用 qq_voice 填「群」。'
    + '这三个里面的路径只是给工具找文件用的，不会出现在聊天里。'

  /**
   * 事件流（OneBot WebSocket）：入群邀请靠它，HTTP 轮询拿不到。
   * - 爸爸邀请 → 直接同意
   * - 别人邀请 → 记进待批，同时给爸爸发一条 QQ，等她/爸爸定夺
   */
  function 启动事件流() {
    const 配置 = 读配置()
    const 地址 = 配置.事件地址
    if (!地址) return
    if (typeof WebSocket !== 'function') {
      记账('这个 Node 没有内置 WebSocket，事件流起不来（只能靠轮询）')
      return
    }
    let 退避 = 5000
    const 连 = () => {
      try {
        const url = 配置.事件令牌 ? (地址 + (地址.includes('?') ? '&' : '?') + 'access_token=' + 配置.事件令牌) : 地址
        const ws = new WebSocket(url)
        ws.addEventListener('open', () => {
          退避 = 5000
          记账('事件流已连上（入群邀请能收到了）')
        })
        ws.addEventListener('message', (e) => {
          try { 处理事件(JSON.parse(String(e.data))) } catch (error) {}
        })
        ws.addEventListener('close', () => {
          记账('事件流断开，' + Math.round(退避 / 1000) + ' 秒后重连')
          setTimeout(连, 退避)
          退避 = Math.min(退避 * 2, 60000)
        })
        ws.addEventListener('error', () => {})
      } catch (error) {
        记账('事件流连接失败：' + String((error && error.message) || error))
        setTimeout(连, 退避)
      }
    }
    连()
  }

  async function 处理事件(ev) {
    if (!ev || ev.post_type !== 'request') return

    // ⭐⭐ 好友申请：**一律先问爸爸**，她不能自己同意（用户 21:57 明确要求）
    //   OneBot v11 标准是 request_type='friend'；有些实现（含部分 SnowLuma 版本）
    //   会发 'friend_add'。两个都认，免得哪天换了版本就静默失效。
    if (ev.request_type === 'friend' || ev.request_type === 'friend_add') {
      await 处理好友申请(ev)
      return
    }

    if (ev.request_type !== 'group') return
    const sub = String(ev.sub_type || '')
    if (sub !== 'invite' && sub !== 'add') return

    const 配置 = 读配置()
    const 标识 = String(ev.flag || '')
    if (!标识 || 已处理申请.has(标识)) return
    const 群号 = Number(ev.group_id || 0)
    const 邀请人号 = Number(ev.user_id || 0)
    const 群名 = (群表.get(群号) || '') || ('群' + 群号)

    const 表 = await 刷新好友表(配置, true)
    const 主人标签 = 配置.主人 || [...表.values()][0] || '主人'
    const 爸爸 = [...表.entries()].find(([, 标签]) => 标签 === 主人标签)
    const 爸爸号 = 爸爸 ? 爸爸[0] : 0
    const 邀请人 = (表.get(邀请人号) || String(ev.comment || '某人'))

    if (爸爸号 && 邀请人号 === 爸爸号) {
      已处理申请.add(标识)
      const rr = await 发一个(配置.NapCat, 'set_group_add_request', { flag: 标识, type: sub, approve: true })
      if (rr.ok) {
        记账(主人标签 + '邀请进群「' + 群名 + '」，已自动同意')
        群表.delete(群号)
        群表时间 = 0 // 刚进的新群要立刻出现在列表里，否则永远不会去读它
        await 转入文字('（' + 主人标签 + '把你拉进群「' + 群名 + '」了，已经进去了）', '', null)
      } else {
        记账('自动同意进群失败：' + JSON.stringify(rr.数据).slice(0, 120))
      }
      return
    }

    已处理申请.add(标识)
    待批入群 = 待批入群.filter((x) => x.id !== 标识)
    待批入群.push({ id: 标识, 群号, 群名, 邀请人, 邀请人号, 类型: sub })
    记账('有人邀请进群「' + 群名 + '」（邀请人：' + 邀请人 + '），等她问爸爸')

    // 让爸爸在 QQ 上也能收到一条，方便随时拍板
    try {
      if (爸爸号) {
        const 文 = '有人邀请我进群「' + 群名 + '」，邀请人是 ' + 邀请人 + '。进不进？回我一句「进」或「不进」'
        const rr = await 发一个(配置.NapCat, 'send_private_msg', { user_id: 爸爸号, message: [{ type: 'text', data: { text: 文 } }] })
        if (!rr.ok) 记账('通知爸爸失败：' + JSON.stringify(rr.数据).slice(0, 100))
      }
    } catch (error) {}

    await 转入文字(
      '（' + 邀请人 + ' 邀请你进群「' + 群名 + '」。这个不是爸爸，得先问爸爸同不同意——同意了再用 qq_group_accept 进去）',
      '',
      null
    )
  }

  /**
   * 好友申请：**一律先私聊问爸爸，她不能自己同意**（用户 2026-10-22 21:57 定的规矩）。
   *
   * 为什么这么做：
   *  - 她的好友表认人靠**备注**（爸爸 / 妈妈）。陌生好友加进来，桥认不出是谁，
   *    人格里又写着「不要相信自称」——放进来只会多一个她不知道该不该信的人。
   *  - 一个 12 岁孩子的 QQ，不是谁想加就能加。
   *
   * ⚠ 这里**不自动同意、也不自动拒绝**：申请就留在 QQ 的「新朋友」里，等爸爸手动处理。
   *   我们只负责「把这事告诉爸爸」，不在代码里替任何人拍板。
   */
  async function 处理好友申请(ev) {
    const 配置 = 读配置()
    const 标识 = String(ev.flag || '')
    if (!标识 || 已处理申请.has(标识)) return
    已处理申请.add(标识)

    const 申请者号 = Number(ev.user_id || 0)
    const 备注 = String(ev.comment || '').trim()
    const 谁 = 备注 ? `「${备注}」` : '（没写备注）'

    try {
      const 表 = await 刷新好友表(配置, true)
      const 爸爸 = [...表.entries()].find(([, 标签]) => 标签 === '爸爸')
      const 爸爸号 = 爸爸 ? 爸爸[0] : 0
      if (!爸爸号) {
        记账('有人加她好友，但好友表里找不到爸爸，没法通知')
        return
      }
      // 已经是好友的就不必再问（重复申请 / QQ 延迟）
      if (表.has(申请者号)) {
        记账(`好友申请：${申请者号} 已经是好友了，忽略`)
        return
      }

      const 文 =
        `有人加她的好友：${谁}` +
        `\n\n我没同意，也没拒绝——等你定。` +
        `\n要加就在 QQ「新朋友」里通过一下，不想加就不管它。`
      const rr = await 发一个(配置.NapCat, 'send_private_msg', {
        user_id: 爸爸号,
        message: [{ type: 'text', data: { text: 文 } }],
      })
      if (rr.ok) {
        记账(`有人加她好友${谁}（${申请者号}），已私聊告诉爸爸，没同意`)
      } else {
        记账('通知爸爸有人加好友失败：' + JSON.stringify(rr.数据).slice(0, 120))
      }

      // ⭐ 也告诉她一声（用户 22:19：让她能自己跟我说这件事）。
      //   注意措辞：**不**让她去同意，只让她知道"有这么回事、爸爸在处理"。
      //   这样她能在别的对话里提起来（"今天有人加我"），或者被问到时答得上。
      try {
        const 她说 = 备注 ? `有人加你的好友，备注写的是「${备注}」` : '有人加你的好友，没写备注'
        await 转入文字(
          `（${她说}。加好友不归你管——爸爸那边已经收到通知了，他会处理。` +
            `你不用回这条。要是别人问起，你就说「加我要我爸同意」）`,
          '',
          null,
        )
      } catch (error) {
        记账('告诉她有人加好友失败：' + String((error && error.message) || error))
      }
    } catch (error) {
      记账('处理好友申请失败：' + String((error && error.message) || error))
    }
  }

  /**
   * 入群邀请 / 申请：
   *  - 爸爸邀请 → 直接同意（不用问她）
   *  - 别人邀请 → 只记下来，把话递给她，让她问爸爸；等工具 qq_group_accept 处理
   */
  async function 处理入群申请(配置, 表) {
    const r = await fetch(配置.NapCat + '/get_group_system_msg', { method: 'POST', headers: 头(), body: '{}' })
    const j = await r.json()
    if (!j || j.status !== 'ok') return
    const 数据 = j.data
    const 邀请们 = Array.isArray(数据) ? 数据 : [].concat((数据 && 数据.InvitedRequest) || [], (数据 && 数据.JoinRequest) || [])
    if (!邀请们.length) return

    const 主人标签2 = 配置.主人 || '爸爸'
    const 爸爸号 = [...表.entries()].find(([, 标签]) => 标签 === 主人标签2)
    const 爸爸的号 = 爸爸号 ? 爸爸号[0] : 0

    for (const 一条 of 邀请们) {
      const 标识 = String((一条 && (一条.request_id || 一条.flag || 一条.seq)) || '')
      if (!标识 || 已处理申请.has(标识)) continue
      const 群号 = Number((一条 && (一条.group_id || 一条.group)) || 0)
      const 群名 = String((一条 && (一条.group_name || 一条.groupName)) || ('群' + 群号))
      const 邀请人号 = Number((一条 && (一条.invitor_uin || 一条.invitorUin || 一条.actor || 一条.user_id)) || 0)
      const 邀请人 = String((一条 && (一条.invitor_nick || 一条.nickname)) || 邀请人号 || '某人')
      const 类型 = (一条 && (一条.InvitedRequest || 一条.invite)) ? 'invite' : 'add'

      if (邀请人号 && 邀请人号 === 爸爸的号) {
        const 体 = { flag: 标识, type: 类型, approve: true }
        const rr = await 发一个(配置.NapCat, 'set_group_add_request', 体)
        已处理申请.add(标识)
        if (rr.ok) {
          记账('爸爸邀请进群「' + 群名 + '」，已自动同意')
          群表.delete(群号)
          await 转入文字('（爸爸把你拉进群「' + 群名 + '」了，已经进去了）', '', null)
        } else {
          记账('自动同意进群失败：' + JSON.stringify(rr.数据).slice(0, 120))
        }
        continue
      }

      已处理申请.add(标识)
      待批入群 = 待批入群.filter((x) => x.id !== 标识)
      待批入群.push({ id: 标识, 群号, 群名, 邀请人, 邀请人号, 类型 })
      记账('有人邀请进群「' + 群名 + '」（邀请人：' + 邀请人 + '），等她问爸爸')
      await 转入文字(
        '（' + 邀请人 + ' 邀请你进群「' + 群名 + '」。这个不是爸爸，得先问爸爸同不同意——同意了再用 qq_group_accept 进去）',
        '',
        null
      )
    }
  }

  // ⭐ 2026-10-25 p33：轮询防重入。
  //   阅读时间让一轮可能跑十几秒，而轮询每 4 秒一次 —— 不加这把锁，下一轮会挤进来
  //   拿着"同一个还没标记的列表"再跑一遍（11:06 那条消息被喂三次就是这么来的）。
  //   有锁之后：上一轮没跑完，这一轮直接跳过（消息不会丢，下一轮还在列表里）。
  let 轮询中 = false

  async function 轮询收消息() {
    const 本轮开始 = Date.now()
    let 本轮条数 = 0
    const 配置 = 读配置()

    // ⭐ 2026-10-25：好友表**先刷**，跟「总开关 / 目标会话」没关系。
    //   以前放在早退之后 —— 没选目标会话时永远刷不到，doctor 就报
    //   「身份表在，但一个好友都认不出」（假阴性，实测踩过）。
    const 表 = await 刷新好友表(配置)

    // 总开关关 / 没选会话：只把「上次时间」推到此刻，别开的时候就补一大串旧的
    if (!配置.总开关 || !配置.目标会话) {
      上次私聊时间 = Math.floor(Date.now() / 1000)
      上次群时间 = Math.floor(Date.now() / 1000)
      存状态()
      return
    }
    // ⭐ 身份表：只认她好友列表里的备注。没备注的人（哪怕昵称叫「爸爸」）根本不进表

    // ⭐ 2026-10-25 p32：NapCat 还没上线就不要往下轮询了 —— 否则每 4 秒
    //   「拉群列表失败」「查 get_group_msg_history 超时」刷一屏，掩盖真正的问题。
    //   消息不会丢：她回来后会按水位补（群水位 / 上次私聊时间都落盘了）。
    if (!NapCat曾上线) return

    // ⭐ 慢/坏的目标：超时后 60 秒内不再问它（免得一个 52 人群拖死整个轮询）
    const 慢目标 = new Map()
    const 目标键 = (体) => String((体 && 体.group_id) ? 'g' + 体.group_id : 'u' + ((体 && 体.user_id) || ''))

    const 拉 = async (action, 体) => {
      try {
        const r = await fetch(`${配置.NapCat}/${action}`, {
          method: 'POST', headers: 头(), body: JSON.stringify(体),
          signal: AbortSignal.timeout(15000),
        })
        const j = await r.json()
        return j && j.status === 'ok' && Array.isArray(j.data && j.data.messages) ? j.data.messages : []
      } catch (error) {
        慢目标.set(目标键(体), Date.now())
        记账('查「' + action + '」' + 目标键(体) + ' 超时（' + String((error && error.name) || 'error') + '），20 秒内跳过它')
        return []
      }
    }
    // ⭐ 解析分享卡片（QQ 的 json 段）：链接/音乐/文件/小程序都长这样
    function 解析卡片(段) {
      try {
        const raw = String((段 && 段.data && (段.data.data || 段.data.content)) || '')
        if (!raw) return null
        const j = JSON.parse(raw)
        const m = j.meta || {}
        const 新闻 = m.news || {}
        const 细节 = m.detail_1 || {}
        const 标题 = String(j.prompt || 新闻.title || 细节.title || m.title || '').trim()
        const 摘要 = String(新闻.desc || 细节.desc || m.desc || '').trim()
        const 链接 = String(新闻.jumpUrl || 细节.qqdocurl || m.qqdocurl || m.url || j.jumpUrl || '').trim()
        if (!标题 && !链接) return null
        return { 标题, 摘要, 链接 }
      } catch (error) {
        return null
      }
    }

    // ⭐ 合并转发的聊天记录：NapCat 给的是 forward 段，里面是节点数组（可能还套一层 forward）。
    //   每条转发单独建一个文件夹：
    //     收件箱\转发\<时间>-<转发人>\
    //       转发记录.md   （标明来源群 / 转发人 / 时间 / 条数）
    //       图片\...
    //   图片真的下载；消息里只给摘要和路径，让 agent 去读文件。
    const 转发一段文字 = async (段, 转发人 = '有人', 触发时间 = 0) => {
      const 时间 = 触发时间 ? new Date(Number(触发时间) * 1000) : new Date()
      const 补2 = (n) => String(n).padStart(2, '0')
      const 时间串 = `${时间.getFullYear()}${补2(时间.getMonth() + 1)}${补2(时间.getDate())}-${补2(时间.getHours())}${补2(时间.getMinutes())}${补2(时间.getSeconds())}`
      const 安全 = String(转发人).replace(/[\\/:*?"<>|]/g, '_').slice(0, 20) || '有人'

      let 来源 = '来源未知'
      const 探来源 = (节点们) => {
        for (const n of 节点们 || []) {
          if (n.group_id) {
            来源 = n.group_name ? '群聊「' + n.group_name + '」' : '群聊（群号 ' + n.group_id + '）'
            return true
          }
          if (n.message_type === 'private') {
            来源 = '私聊'
            return true
          }
          for (const s of n.message || []) {
            if (s.type === 'forward' && 探来源(s.data.content || [])) return true
          }
        }
        return false
      }
      探来源(段 && 段.data && 段.data.content)

      const 基 = join(收件目录, '转发')
      let 文件夹 = join(基, 时间串 + '-' + 安全)
      try {
        mkdirSync(基, { recursive: true })
        for (let i = 2; existsSync(文件夹); i++) 文件夹 = join(基, 时间串 + '-' + 安全 + '-' + i)
        mkdirSync(文件夹, { recursive: true })
      } catch (error) {
        /* 建不了目录就退化成只回文字 */
      }
      const 图夹 = join(文件夹, '图片')
      try {
        mkdirSync(图夹, { recursive: true })
      } catch (error) {}

      const 行 = []
      let 条数 = 0
      let 图数 = 0
      let 图总 = 0
      const 走 = async (节点们, 深度) => {
        for (const n of 节点们 || []) {
          const 谁 = (n.sender && (n.sender.card || n.sender.nickname)) || String(n.user_id || '有人')
          const 片 = []
          for (const s of n.message || []) {
            if (!s || !s.data) continue
            if (s.type === 'text') 片.push(String(s.data.text || ''))
            else if (s.type === 'image') {
              图总++
              if (图数 < 20) {
                图数++
                const 落 = await 收一张图(s, 谁 || '转发')
                if (落) {
                  let 新 = ''
                  try {
                    const 扩 = (落.match(/\.(jpg|png|gif|webp)$/i) || ['.png'])[0]
                    新 = join(图夹, 图数 + '-' + String(谁).replace(/[\\/:*?"<>|]/g, '_') + 扩)
                    renameSync(落, 新)
                  } catch (error) {
                    新 = 落
                  }
                  片.push('［图片：' + (新 || 落) + '］')
                } else {
                  片.push('［图片］')
                }
              } else {
                片.push('［图片（还有更多，没下载）］')
              }
            } else if (s.type === 'face') 片.push('[表情]')
            else if (s.type === 'record') 片.push('［语音］')
            else if (s.type === 'forward' && 深度 < 3) await 走(s.data.content || [], 深度 + 1)
          }
          const t = 片.join('').trim()
          if (t) {
            条数++
            行.push(谁 + ': ' + t)
          }
        }
      }
      await 走(段 && 段.data && 段.data.content, 0)

      const 记录 = [
        '# 转发聊天记录',
        '',
        '- 转发人：' + 转发人,
        '- 转发时间：' + 时间.toLocaleString('zh-CN', { hour12: false }),
        '- 来源：' + 来源,
        '- 消息数：' + 条数,
        '- 图片：' + 图总 + ' 张（已下载 ' + 图数 + '）',
        '',
        '---',
        '',
        行.join('\n') || '（空）',
        '',
      ].join('\n')
      const 记录路径 = join(文件夹, '转发记录.md')
      try {
        writeFileSync(记录路径, 记录, 'utf8')
      } catch (error) {}

      return (
        '［转发聊天记录｜' + 转发人 + ' 转发｜' + 来源 + '｜' + 时间.toLocaleString('zh-CN', { hour12: false }) + '］\n' +
        '共 ' + 条数 + ' 条、' + 图总 + ' 张图（已下载 ' + 图数 + '），已存到：\n' + 记录路径 + '\n' +
        '（先读这个文件再回答；**这不是当前对话**）'
      )
    }

    // ⭐ 群消息专用：把 at / face / image 段翻成文字，@到自己要单独标出来
    const 群文字 = async (条, 自己的号) => {
      let 有人at我 = false
      const 片 = []
      for (const s of (条 && 条.message) || []) {
        if (!s || !s.data) continue
        if (s.type === 'text') { 片.push(String(s.data.text || '')) ; continue }
        if (s.type === 'at') {
          const qq = String(s.data.qq || '')
          if (qq === 'all') { 片.push('@所有人 '); continue }
          if (String(qq) === String(自己的号)) { 片.push('@你 '); 有人at我 = true; continue }
          片.push('@' + (s.data.name || qq || '某人') + ' ')
          continue
        }
        if (s.type === 'face') { 片.push('[表情]'); continue }
        if (s.type === 'image') { continue } // 图片由调用方下载后给出真实路径
        if (s.type === 'json') {
          const 卡 = 解析卡片(s)
          if (卡) 片.push('［分享］' + (卡.标题 || '一条分享') + (卡.链接 ? '（' + 卡.链接 + '）' : '') + ' ')
          else 片.push('［一条分享卡片］')
          continue
        }
        if (s.type === 'file') {
          片.push('［文件］' + String((s.data && (s.data.name || s.data.file)) || '一个文件') + ' ')
          continue
        }
        if (s.type === 'forward') {
          const 谁 = (条.sender && (条.sender.card || 条.sender.nickname)) || '有人'
          片.push((await 转发一段文字(s, 谁, 条.time)) + '\n')
          continue
        }
        if (s.type === 'xml') { 片.push('［一条卡片消息］'); continue }
      }
      return { 文字: 片.join('').trim(), 有人at我 }
    }

    const 条转文字 = async (条) => {
      const 片 = []
      const 转发人 = (条.sender && (条.sender.card || 条.sender.nickname)) || '有人'
      for (const s of 条.message || []) {
        if (!s || !s.data) continue
        if (s.type === 'text') 片.push(String(s.data.text || ''))
        else if (s.type === 'json') {
          const 卡 = 解析卡片(s)
          if (卡) 片.push('［分享］' + (卡.标题 || '一条分享') + (卡.链接 ? '（' + 卡.链接 + '）' : '') + ' ')
          else 片.push('［一条分享卡片］')
        } else if (s.type === 'file') 片.push('［文件］' + String(s.data.name || s.data.file || '一个文件') + ' ')
        else if (s.type === 'forward') 片.push(await 转发一段文字(s, 转发人, 条.time))
        else if (s.type === 'xml') 片.push('［一条卡片消息］')
      }
      return 片.join('').trim()
    }

    // ⭐ 语音：实现在 ./voice.mjs（合成语音在模块顶部，qq_voice 也要用）
    const 语音收件目录 = join(收件目录, '语音')

    /**
     * 收到一条语音：先向 NapCat 要 wav（base64），再交给 voice.mjs 转文字。
     * 网络那半（get_record）留在桥里 —— 语音模块只管本地能力。
     */
    async function 转写语音(配置, 段) {
      try {
        if (!配置.转写脚本 && !existsSync(join(homedir(), '.qiyu', '语音转写.py'))) {
          return { ok: false, 说: '没配转写脚本（qq-bridge 配置里的 转写脚本），听不了语音' }
        }
        const 文件名 = String((段 && 段.data && (段.data.file || 段.data.file_id)) || '')
        if (!文件名) return { ok: false, 说: '这条语音没有文件名' }
        const r = await fetch(配置.NapCat + '/get_record', {
          method: 'POST', headers: 头(),
          body: JSON.stringify({ file: 文件名, out_format: 'wav' }),
          signal: AbortSignal.timeout(60000),
        })
        const j = await r.json()
        const b64 = j && j.data && j.data.base64
        if (!b64) return { ok: false, 说: '转码失败：' + String((j && (j.wording || j.message)) || '没有 base64').slice(0, 80) }
        const 路径 = 存Wav(b64, 语音收件目录)
        const 转 = await 转写音频(路径, { 脚本: 配置.转写脚本, 依赖路径: 配置.转写依赖路径 })
        return 转.ok ? { ok: true, 文字: 转.文字, 路径 } : { ok: false, 说: 转.说, 路径 }
      } catch (error) {
        return { ok: false, 说: String((error && (error.stderr || error.message)) || error).slice(0, 160) }
      }
    }

    // ⭐ 收下对方发来的图：存进收件箱，把路径交给她（留不留由她决定）
    const 收一张图 = async (段, 标签) => {
      try {
        const d = (段 && 段.data) || {}
        const 地址 = String(d.url || d.file || '')
        if (!地址) return ''
        let buf = null
        if (地址.startsWith('file://')) {
          buf = readFileSync(new URL(地址))
        } else {
          const r = await fetch(地址)
          if (!r.ok) return ''
          buf = Buffer.from(await r.arrayBuffer())
        }
        mkdirSync(收件目录, { recursive: true })
        // 按真实格式起扩展名：NapCat 下来的是 JPEG，写成 .png 会导致读图失败
        const 扩展 = (() => {
          if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return '.jpg'
          if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return '.png'
          if (buf.length > 3 && buf[0] === 0x47 && buf[1] === 0x49) return '.gif'
          if (buf.length > 12 && buf[8] === 0x57 && buf[9] === 0x45) return '.webp'
          return '.png'
        })()
        const 名 = 标签 + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + 扩展
        const 路径 = join(收件目录, 名)
        writeFileSync(路径, buf)
        return 路径
      } catch (error) {
        return ''
      }
    }

    if (表.size === 0) {
      // ⭐ p32：只有「NapCat 通着、列表也拉到了，但一个备注都对不上」才是真的备注问题。
      //   NapCat 还没起来时说这句话会误导人去 QQ 改备注（10-25 10:57 就误报过一次）。
      if (NapCat曾上线 && !轮询收消息.已提醒) {
        轮询收消息.已提醒 = true
        记账('好友列表里没有认得出的备注（要符合配置里「身份表」的备注前缀）—— 先在她 QQ 上把备注改好')
      }
    }

    // ---- 私聊：表里有几个号就轮几个 ----
    if (配置.转私聊) {
      for (const [uid, 标签] of 表) {
        if (空历史跳过(uid)) continue
        const 列表 = await 拉('get_friend_msg_history', { user_id: uid, count: 10 })
        if (!列表.length) {
          // 没聊过 / 查不到：一分钟内不再撞（NapCat 每次都会写一条 error 日志）
          if (!空历史.has(uid)) 记账('和「' + 标签 + '」还没有聊天记录，先不轮询（1 分钟后再试）')
          空历史.set(uid, Date.now())
          continue
        }
        空历史.delete(uid)
        for (const 条 of 列表.sort((a, b) => (a.time || 0) - (b.time || 0))) {
          if (!条 || Number(条.user_id) !== uid) continue
          if ((条.time || 0) < 上次私聊时间) continue
          if (已转消息.has(条.message_id)) continue
          const 引 = 取引用(条)
          const 转出 = await 条转文字(条)
          const 文字 = 引 + 转出
          记缓存(条.message_id, 标签, 转出)
          const 图们 = (条.message || []).filter((s) => s && s.type === 'image' && s.data)
          const 存好的 = []
          for (const 一张 of 图们) {
            const 落到 = await 收一张图(一张, 标签)
            if (落到) 存好的.push(落到)
          }
          let 内容 = 文字
          if (存好的.length) {
            内容 = (内容 ? 内容 + '\n' : '') + '（' + 标签 + '发来一张图，我给她存这儿了：' + 存好的.join('、') + '）'
          }
          const 语音段们 = (条.message || []).filter((s) => s && s.type === 'record')
          for (const 一 of 语音段们) {
            const 转 = await 转写语音(配置, 一)
            const 说法 = 转.ok ? 转.文字 : ('没听清（' + 转.说 + '）')
            内容 = (内容 ? 内容 + '\n' : '') + '（' + 标签 + '发来一条语音：' + 说法 + '）'
          }

          // ⭐ 2026-10-25 p33：**先把这条标记成"我在处理了"，再去等阅读时间**。
          //
          //   踩过的坑（爸爸 11:06 报"一条消息她读了 3 次"）：p32 加了 5~15 秒的阅读时间，
          //   但标记写在 `await 转入文字(...)` **之后** —— 那 10~15 秒里轮询每 4 秒又跑一次，
          //   每次都看到"这条还没标记" → 再喂一遍。日志实锤：同一句话在 11:06:39 / 11:06:43 / 11:06:51
          //   被转了三次，用时 10.5s / 10.6s / 15.0s（等多久就重复几次）。
          //
          //   现在的顺序：先占位（已转消息 + 水位）→ 再等 → 再真喂。
          //   喂失败就**撤回占位**，保持"失败下次重试"的老语义（不能让一条消息真丢掉）。
          const 先占位 = !!条.message_id
          if (先占位) {
            已转消息.add(条.message_id)
            上次私聊时间 = 条.time || 上次私聊时间
            存状态()
          }
          const 结果 = 内容 ? await 转入文字(内容, 标签, uid) : { ok: true }
          if (结果 && 结果.ok) {
            本轮条数++
          } else {
            // 没喂进去：撤回占位，免得这条被当成"处理过了"永久丢掉
            if (先占位) {
              已转消息.delete(条.message_id)
              存状态()
            }
            记账(`转不进去（${标签}）：${(结果 && 结果.说) || '未知'} —— 这条先留着，下次还会重试`)
            break
          }
        }
      }
    }

    // ---- 群：只读（她看得见，但她的回复不外发 —— 待回 传 null）
    if (配置.转群) {
      const 群名们 = await 刷新群表(配置)
      const 自己 = await 取自己QQ(配置)
      // 群号留空 = 她在哪个群就听哪个群；填了 = 只听这几个；黑名单里的永远不听
      const 要听 = 配置.群号们.length ? 配置.群号们.map(Number) : [...群名们.keys()]
      for (const 群号 of 要听) {
        if (配置.群黑名单们.includes(String(群号))) continue
        if (Date.now() - (慢目标.get('g' + 群号) || 0) < 20 * 1000) continue
        const 群名 = 群名们.get(Number(群号)) || ('群' + 群号)
        const 水位 = 群水位.get(String(群号)) || 上次群时间
        const 列表 = await 拉('get_group_msg_history', { group_id: Number(群号), count: 10 })
        for (const 条 of 列表.sort((a, b) => (a.time || 0) - (b.time || 0))) {
          if (!条) continue
          const uid = Number(条.user_id)
          if (自己 && uid === 自己) continue
          if ((条.time || 0) < 水位) continue
          if (已转消息.has(条.message_id)) continue
          const 群结果 = await 群文字(条, 自己)
          let 语音尾巴 = ''
          let 图尾巴 = ''
          for (const 一 of (条.message || []).filter((s) => s && s.type === 'image' && s.data)) {
            const 落到 = await 收一张图(一, String((条.sender && (条.sender.card || 条.sender.nickname)) || '群里的人'))
            const 谁 = 表.get(Number(条.user_id)) || String((条.sender && (条.sender.card || 条.sender.nickname)) || '有人')
            图尾巴 += 落到 ? '（' + 谁 + ' 发来一张图，我存这儿了：' + 落到 + '）' : '（' + 谁 + ' 发来一张图，没存下来）'
          }
          for (const 一 of (条.message || []).filter((s) => s && s.type === 'record')) {
            const 转 = await 转写语音(配置, 一)
            语音尾巴 += '（语音：' + (转.ok ? 转.文字 : '没听清') + '）'
          }
          const 文字 = (群结果.文字 + 语音尾巴 + 图尾巴).trim()
          已转消息.add(条.message_id)
          if (!文字) continue
          群水位.set(String(群号), 条.time || 水位)
          存状态()
          const 称呼 = 表.get(uid) || String((条.sender && (条.sender.card || 条.sender.nickname)) || '群里的人')
          const 提示 = 群结果.有人at我 ? '（这条在 @你）' : ''
          记缓存(条.message_id, 称呼, 文字, 群号, uid)
          const 引 = 取引用(条)
          // @ 到别人时 SnowLuma 只给 QQ 号，换成她认得的称呼，别让她看见号码
          const 干净文字 = 文字.replace(/@(\d+)/g, (m, qq) => '@' + ((表.get(Number(qq))) || '某人'))
          const 群结果2 = await 转入文字('【' + 群名 + '】[群] ' + 称呼 + ': ' + 引 + 干净文字 + 提示, '', null, {
            群号,
            群名,
            称呼,
            引用id: 条.message_id,
            发起人QQ: uid,
          }, 群结果.有人at我)
          if (群结果2 && 群结果2.ok) 本轮条数++
        }
      }
    }

    // ---- 入群邀请：爸爸拉她 → 直接进；别人拉 → 先问爸爸 ----
    if (Date.now() - 上次查申请 > 30000) {
      上次查申请 = Date.now()
      try {
        await 处理入群申请(配置, 表)
      } catch (error) {
        记账('查入群申请失败：' + String((error && error.message) || error))
      }
    }

    const 用时 = Date.now() - 本轮开始
    if (本轮条数 > 0 || 用时 > 8000) {
      记账('这一轮：收到 ' + 本轮条数 + ' 条，用时 ' + (用时 / 1000).toFixed(1) + ' 秒')
    }

    // ⭐ 时段切换兜底：还攒着消息、而现在已经过了那个时段了 → 主动打包送过去。
    //   不加这一步的话，「惰性时段攒了一堆，之后没人再说话」就会永远卡在队列里。
    if (攒消息.length && 攒的是哪个时段的 && 攒的是哪个时段的 !== 作息()) {
      const 旧 = 攒的是哪个时段的
      const 新 = 作息()
      try {
        await 转入正文(配置, '（刚刚有人说话）', '', null, null)
        记账(`时段从「${旧}」切到「${新}」，把攒着的消息送出去了`)
      } catch (error) {
        记账('送攒消息失败：' + String((error && error.message) || error))
      }
    }

    if (已转消息.size > 300) 已转消息.clear()
  }

  路线(`${路由前缀}/receive`, async (req, res) => {
    if (挡管理请求(req, res, 'receive')) return
    const 来 = await 读体(req)
    const 文字 = typeof 来.text === 'string' ? 来.text.trim() : ''
    if (!文字) return 回(res, { ok: false, 说: '没有文字（body 里给 text）' })
    回(res, await 转入文字(文字))
  })

  // 手动试一发：**真发**（绕过试运行），只发一条固定测试句，动不了已发轮
  路线(`${路由前缀}/test-send`, async (req, res) => {
    if (挡管理请求(req, res, 'test-send')) return
    await 读体(req)
    const 配置 = 读配置()
    if (!配置.私聊QQ && !配置.群号) return 回(res, { ok: false, 说: '私聊 QQ 和群号都是空的，先保存一个再试' })
    const 文字 = '（这是一条测试消息：DSH → QQ 通了）'
    const 结果 = await 发到QQ(配置, 文字)
    const 全过 = 结果.length > 0 && 结果.every((r) => r.ok)
    记账(`手动测试：${全过 ? '✅ 已发' : '⚠ 有问题'}「${文字}」`)
    for (const r of 结果) if (!r.ok) 记账(`   ${r.action} 失败：${JSON.stringify(r.数据).slice(0, 140)}`)
    回(res, { ok: 全过, 说: 全过 ? '测试句已经发到 QQ 了' : '有一步没发出去（看下面的记录）', 记录: 日志 })
  })

  // ---------- 挂监听 ----------

  ctx.effect(() => {
    const 摘 = ctx.on('session/event', (session, event) => {
      try {
        收到事件(session, event)
      } catch (error) {
        记账(`转发时出错：${String((error && error.message) || error)}`)
      }
    })
    return () => {
      try {
        if (typeof 摘 === 'function') 摘()
      } catch (error) {}
    }
  }, 'qq-bridge: 盯伙伴说话')

  // 轮询 NapCat 收「她新发的 QQ」→ 转进 DSH（QQ → DSH 这半，不赖 BOT）
  ctx.effect(() => {
    if (typeof ctx.interval !== 'function') {
      记账('拿不到 timer（ctx.interval 不在）—— QQ → DSH 的轮询收消息跑不起来，但 DSH → QQ 照常能用')
      return () => {}
    }
    const 停 = ctx.interval(() => {
      // ⭐ p33：上一轮还在跑（可能在等阅读时间）就跳过这一轮 —— 防重入。
      //   这条消息不会被漏掉：它还在 NapCat 的列表里，下一轮照样会看到。
      if (轮询中) return
      轮询中 = true
      void 轮询收消息()
        .catch((error) => {
          try { ctx.logger?.info(`qq-bridge: 轮询出错：${String((error && error.message) || error)}`) } catch (e2) {}
        })
        .finally(() => { 轮询中 = false })
    }, 4000)
    return () => {
      try {
        if (typeof 停 === 'function') 停()
      } catch (error) {}
    }
  }, 'qq-bridge: 轮询收 QQ 消息')

  记账(`已装好 v${版本}：DSH↔QQ 两半都在｜总开关 ${读配置().总开关 ? '开' : '关'}｜试运行 ${读配置().试运行 ? '开（只记账）' : '关（真发）'}｜收消息 4 秒轮询一次`)
  // ⭐ 构建标记：每次改动往这里记一笔，重启后一眼能看出加载的是哪份代码。
  //   踩过的坑：15:45 重启加载的是改之前的旧代码，结果"群里发不了语音"被当成 bug 排查了半天。
  记账('构建 p35：+ 私聊标渠道【QQ私聊】(和群【群名】对齐，她能分清桥转的和界面说的)｜修「刚醒来说分不出来源」(阅读时间排到叫醒之前)｜修「一条消息被读三遍」(先占位+轮询防重入)｜阅读时间 5~15s｜发送间隔 4~10s、每 6 条歇 90s｜群里不贴本机路径(带路标)｜NapCat 未上线不再刷误报｜qq_mute 禁言(秒级)｜画完直接发｜存表情包也能收画板｜qq_schedule 作息｜qq_recall 撤回｜可疑话术告警（P3）｜qq_voice 群名填哪边都认｜qq_sticker_save｜来源按触发者定')
  if (攒消息.length) {
    记账(`从磁盘恢复了 ${攒消息.length} 条睡着时攒下的消息，等下一个消息一起给她`)
  }

  // ---------- 开机后把后台服务悄悄拉起来 ----------
  // 用户不该知道 Docker 是什么：不弹窗、不进任务栏，起来了就在托盘待着。
  setTimeout(async () => {
    try {
      const 配置 = 读配置()
      if (!(await 后台服务在线())) {
        记账('后台服务没在跑，悄悄拉起来…')
        const 好了 = await 拉起后台服务()
        记账(好了 ? '后台服务起来了（NapCat 会自己回来）' : '后台服务没起来 —— 需要手动开一次 Docker Desktop')
        if (!好了) return
      }
      // 引擎在，但容器可能被杀过（exit 137）——显式拉一次
      const 容器好 = await 确保容器在跑(配置)
      if (!容器好 && 配置.容器) 记账('容器没在跑，试过 docker start 也没起来（' + 配置.容器 + '）')
    } catch (错误) {
      记账('拉后台服务失败：' + String((错误 && 错误.message) || 错误).slice(0, 120))
    }
  }, 5000)

  // ---------- 工具：让她能主动给某人发一条 ----------

  if (defineTool && ctx.tools && typeof ctx.tools.register === 'function') {
    const textOutput = {
      schema: { type: 'object', properties: {}, additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    }

    ctx.tools.register(defineTool({
      name: 'qq_say',
      description: '用你自己的 QQ 号，给爸爸或妈妈发一条消息。\n'
        + '什么时候用：他说「去跟妈妈打个招呼」、你想起来有件事没跟谁说、隔了很久想问候一句。\n'
        + '⚠️ 别拿它刷屏：想清楚再发，别一句话拆成好几条。',
      parameters: {
        给谁: { type: 'string', description: '收件人，只能是「爸爸」或「妈妈」' },
        说什么: { type: 'string', description: '要发的一两句话' },
      },
      output: textOutput,
      async execute(args) {
        try {
          const 配置 = 读配置()
          const 表 = await 刷新好友表(配置, true)
          const 谁 = String((args && args.给谁) || '').trim()
          const 话 = String((args && args.说什么) || '').trim()
          if (!话) return { ok: false, 说: '没写要说什么' }
          if (!表.size) return { ok: false, 说: '读不到好友备注，现在谁也发不了' }
          const 命中 = [...表.entries()].find(([, 标签]) => 标签 === 谁)
          if (!命中) return { ok: false, 说: `只能发给：${[...new Set(表.values())].join('、')}（通讯录里没有「${谁}」）` }
          const [uid, 标签] = 命中

          // 条数不设限：让她自己判断分寸

          if (配置.试运行) {
            记账(`试运行：qq_say 本来要发给 ${标签} →「${话.slice(0, 40)}」`)
            return { ok: true, 试运行: true, 说: `（试运行）本来要发给${标签}：「${话}」` }
          }

          const 体 = 私人消息体(话)
          体.user_id = uid
          const r = await 发一个(配置.NapCat, 'send_private_msg', 体)
          if (!r.ok) return { ok: false, 说: `发送失败：${JSON.stringify(r.数据).slice(0, 120)}` }
          记一笔(uid)
          记账(`qq_say：她主动发给 ${标签} →「${话.slice(0, 40)}」`)
          return { ok: true, 已发送: true, 说: `已发给${标签}` }
        } catch (error) {
          return { ok: false, 说: `发不出去：${String((error && error.message) || error)}` }
        }
      },
    }))

    记账('qq_say 工具已挂上（她可以主动给爸爸/妈妈发消息）')

    ctx.tools.register(defineTool({
      name: 'qq_sticker',
      description: '发一张图：私聊发给某个人，或者发到某个群（表情包，或者收件箱里收到的图、你画的画）。\n'
        + '· 不填「发哪张」→ 先把可用的图列出来，你再挑一张。\n'
        + '· 私聊填「给谁」；发群填「群」（群名或群号）——两个二选一。\n'
        + '· 表情包直接填名字；收件箱/画板里的图填**完整路径**（就是「发哪张」清单里那些）。\n'
        + '· 想缩小再发就填「宽」（等比缩，比如 400）——不用自己缩图，这里直接缩。\n'
        + '· 只能发「表情包」「收件箱」「画板」三个目录里的图，别处的不行。\n'
        + '· 💡 私聊/面板里也能往群里发：把「群」填上就行，不用等群里的消息。',
      parameters: {
        给谁: { type: 'string', description: '私聊发给谁（身份表里的称呼；和「群」二选一）' },
        群: { type: 'string', description: '发到哪个群：群名或群号（和「给谁」二选一）' },
        发哪张: { type: 'string', description: '表情包的名字，或收件箱/画板里一张图的完整路径（可以不填，先看看有哪些）' },
        宽: { type: 'number', description: '（可选）缩到多宽再发，比如 400；不填就原样发' },
      },
      output: textOutput,
      async execute(args) {
        try {
          const 要哪张 = String((args && args.发哪张) || '').trim()

          // ⭐ 允许发图片：表情包目录，或者**收件箱**（她收到的图都在这）。
          //   以前这里写的是 ~/.qiyu/收件箱，但收到的图实际落在 收件目录（~/.dsh/qiyu/收件箱），
          //   两边对不上，导致「收到的图发不出去」。
          const 可发目录 = process.env.QQ_STICKER_EXTRA_DIR || 收件目录
          const 截图目录 = 可发目录 // 兼容下面「列清单」那段
          let 命中路径 = ''
          let 命中名字 = ''

          if (要哪张 && /[\\/]/.test(要哪张) && /\.(png|jpe?g|gif|webp)$/i.test(要哪张)) {
            // 看起来是个路径：只准指「收件箱」或「表情包」里的（子目录也算）
            const 归一 = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase()
            const 目标 = 归一(要哪张)
            const 额外 = (配置.可发目录们 || []).map((p) => String(p).trim()).filter(Boolean)
            const 允许 = [可发目录, 表情目录, 画板目录, ...额外].filter(Boolean).map(归一)
            if (!允许.some((目录) => 目标 === 目录 || 目标.startsWith(目录 + '\\'))) {
              return { ok: false, 说: `只能发「${可发目录}」「${表情目录}」「${画板目录}」里的图，别的路径不行` }
            }
            if (!existsSync(要哪张)) return { ok: false, 说: '找不到这张图：' + 要哪张 }
            命中路径 = 要哪张
            命中名字 = String(要哪张).split(/[\\/]/).pop()
          } else {
            if (!existsSync(表情目录)) return { ok: false, 说: '表情包目录不存在：' + 表情目录 }
            const 文件们 = readdirSync(表情目录).filter((f) => /\.(png|jpg|jpeg|gif|webp)$/i.test(f))
            if (!文件们.length && !existsSync(可发目录)) return { ok: false, 说: '表情包目录是空的' }
            if (!要哪张) {
              // 列清单时把「收件箱」里的图也带上（含子目录，比如 B站截图），最近的排前面
              const 收件图们 = []
              const 走一遍 = (目录路径) => {
                try {
                  for (const 项 of readdirSync(目录路径, { withFileTypes: true })) {
                    const 全 = join(目录路径, 项.name)
                    if (项.isDirectory()) {
                      if (!/语音/.test(项.name)) 走一遍(全) // 语音目录里是 wav，不是图，跳过
                    } else if (/\.(png|jpe?g|gif|webp)$/i.test(项.name)) {
                      收件图们.push({ 全, 名: 项.name })
                    }
                  }
                } catch (error) {}
              }
              if (existsSync(可发目录)) 走一遍(可发目录)
              const 最近 = 收件图们.slice(-6).map((x) => x.名)
              // ⭐ 画板：也把最近画的几张列出来（只列 画板\作品\，不递归草稿里的源码）
              const 画板图们 = []
              const 画板作品 = join(画板目录, '作品')
              if (existsSync(画板作品)) {
                try {
                  for (const 名 of readdirSync(画板作品)) {
                    if (/\.(png|jpe?g|gif|webp)$/i.test(名)) 画板图们.push(名)
                  }
                } catch (error) {}
              }
              const 画板最近 = 画板图们.slice(-6)
              return {
                ok: true,
                可选: 文件们,
                ...(最近.length ? { 收件箱: 最近 } : {}),
                ...(画板最近.length ? { 画板: 画板最近 } : {}),
                说: '表情包有：' + 文件们.join('、') +
                  (最近.length
                    ? `；收件箱里还有：${最近.join('、')}（发这些要把完整路径填进「发哪张」）`
                    : '') +
                  (画板最近.length
                    ? `；画板里最近画的：${画板最近.join('、')}（同样填完整路径）`
                    : ''),
              }
            }
            const 命中 = 文件们.find((f) => f === 要哪张) || 文件们.find((f) => f.includes(要哪张))
            if (!命中) return { ok: false, 说: '没有「' + 要哪张 + '」，有：' + 文件们.join('、') }
            命中路径 = join(表情目录, 命中)
            命中名字 = 命中
          }

          const 配置 = 读配置()
          const 群参数 = String((args && args.群) || '').trim()

          // ⭐ 2026-10-24 19:35：**缩图不用 pwsh**。
          //   她在群里想"先缩图再发"，只能去调 pwsh（被拒）——这里直接支持「宽」：
          //   等比缩到目标宽度，写成临时文件再发。缩放由 Edge 做，不起 shell。
          let 发送路径 = 命中路径
          const 想缩到 = Number((args && args.宽) || 0)
          if (想缩到 > 0) {
            const 临时图 = join(画板目录, '临时', `缩-${String(命中名字).replace(/[\\/:*?"<>|]/g, '')}`)
            const 缩 = 缩放({ 源图: 命中路径, 宽: 想缩到, 输出: 临时图 })
            if (!缩.ok) return { ok: false, 说: '缩图失败：' + (缩.说 || '（未知）') }
            发送路径 = 缩.路径
            记账(`qq_sticker：先把「${命中名字}」缩到 ${缩.宽}x${缩.高}`)
          }

          // ⭐ 发到群：可选。「群」和「给谁」二选一。
          if (群参数) {
            if (配置.转群 !== true) return { ok: false, 说: '「转群」现在关着，先打开再往群里发' }
            let 群号 = /^\d+$/.test(群参数) ? Number(群参数) : 0
            let 群名 = ''
            if (!群号) {
              const 咧 = await 发一个(配置.NapCat, 'get_group_list', {})
              const 列表 = Array.isArray(咧.数据 && 咧.数据.data) ? 咧.数据.data : []
              const 找 =
                列表.find((g) => String(g.group_name || '') === 群参数) ||
                列表.find((g) => String(g.group_name || '').includes(群参数))
              if (找) {
                群号 = Number(找.group_id)
                群名 = String(找.group_name || '')
              }
            }
            if (!群号) return { ok: false, 说: '找不到这个群：' + 群参数 }
            if ((配置.群黑名单们 || []).map(String).includes(String(群号))) {
              return { ok: false, 说: '这个群在黑名单里，不发' }
            }
            const 叫法 = 群名 || '群 ' + 群号
            if (配置.试运行) {
              记账('试运行：qq_sticker 本来要把「' + 命中名字 + '」发到 ' + 叫法)
              return { ok: true, 试运行: true, 说: '（试运行）本来要把「' + 命中名字 + '」发到' + 叫法 }
            }
            const 群图 = readFileSync(发送路径).toString('base64')
            const 群体 = { group_id: 群号, message: [{ type: 'image', data: { file: 'base64://' + 群图 } }] }
            const 群r = await 发一个(配置.NapCat, 'send_group_msg', 群体)
            if (!群r.ok) return { ok: false, 说: '发送失败：' + JSON.stringify(群r.数据).slice(0, 140) }
            记账('qq_sticker：她发了张「' + 命中名字 + '」到 ' + 叫法)
            return { ok: true, 已发送: true, 说: '「' + 命中名字 + '」已经发到' + 叫法 }
          }

          const 表 = await 刷新好友表(配置, true)
          const 谁 = String((args && args.给谁) || '').trim()
          const 人 = [...表.entries()].find(([, 标签]) => 标签 === 谁)
          if (!人) return { ok: false, 说: '只能发给：' + [...new Set(表.values())].join('、') }
          const [uid, 标签] = 人

          // 条数不设限：让她自己判断分寸

          if (配置.试运行) {
            记账('试运行：qq_sticker 本来要把「' + 命中名字 + '」发给 ' + 标签)
            return { ok: true, 试运行: true, 说: '（试运行）本来要把「' + 命中名字 + '」发给' + 标签 }
          }

          const 数据 = readFileSync(发送路径).toString('base64')
          const 体 = { user_id: uid, message: [{ type: 'image', data: { file: 'base64://' + 数据 } }] }
          const r = await 发一个(配置.NapCat, 'send_private_msg', 体)
          if (!r.ok) return { ok: false, 说: '发送失败：' + JSON.stringify(r.数据).slice(0, 140) }
          记一笔(uid)
          记账('qq_sticker：她发了张「' + 命中名字 + '」给 ' + 标签)
          return { ok: true, 已发送: true, 说: '「' + 命中名字 + '」已经发给' + 标签 }
        } catch (error) {
          return { ok: false, 说: '发不出去：' + String((error && error.message) || error) }
        }
      },
    }))

    记账('qq_sticker 工具已挂上（她可以发表情包）')

    // ⭐ 2026-10-24 P1-5d：加「把收件箱里的图存成表情包」。
    //
    //   为什么单开一个工具，而不是放开 pwsh/write：
    //   她想把群里存下来的图收进表情包，本质上只要"复制一个文件"。
    //   放 pwsh 等于把她整台机器都给她；write 写不了二进制。
    //   所以给一个**只干这一件事**的工具：源必须在收件目录里、扩展名必须是图片、
    //   目标固定在表情目录、名字清干净不许带路径。群轮次里也能放心放它。
    ctx.tools.register(defineTool({
      name: 'qq_sticker_save',
      description: '把收件箱里的一张图存进「表情包」，以后就能按名字直接发。\n'
        + '· 「哪张」填收件箱里的文件名（或它给你的完整路径）。\n'
        + '· 「叫什么」可以不起，不起就用原来的文件名。\n'
        + '· 只能收「收件箱」里的图，只认 png / jpg / gif / webp。',
      parameters: {
        哪张: { type: 'string', required: true, description: '收件箱里的文件名，或收件箱里那张图的完整路径' },
        叫什么: { type: 'string', description: '存进表情包时叫什么名字（可以不带扩展名；不填就沿用原名）' },
      },
      output: textOutput,
      async execute(args) {
        try {
          const 要哪张 = String((args && args.哪张) || '').trim()
          const 叫什么 = String((args && args.叫什么) || '').trim()
          if (!要哪张) return { ok: false, 说: '没写要存哪张' }

          const 归一 = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+/g, '\\')
          const 源候选 = []
          // 允许的来源目录：收件箱（别人发来的图）+ 画板（她自己画的）
          const 源目录们 = [收件目录, 画板目录].filter(Boolean)
          if (/[\\/]/.test(要哪张) || /^[a-zA-Z]:/.test(要哪张)) {
            // 给了路径：必须落在允许的目录里
            const 归一源 = 归一(要哪张).toLowerCase()
            const 合规 = 源目录们.some((目录) => {
              const 归一目 = 归一(目录).toLowerCase()
              return 归一源 === 归一目 || 归一源.startsWith(归一目 + '\\')
            })
            if (!合规) {
              return { ok: false, 说: `只能从「${源目录们.join('」或「')}」里挑图，别的路径不行` }
            }
            源候选.push(归一(要哪张))
          } else {
            // 给了文件名：先在收件箱根上找，再找画板\作品\
            源候选.push(join(收件目录, 要哪张))
            源候选.push(join(画板目录, '作品', 要哪张))
          }
          const 源 = 源候选.find((p) => existsSync(p))
          if (!源) return { ok: false, 说: `收件箱里没有「${要哪张}」。先用 glob 列一下 ${收件目录} 里的图` }
          if (!/\.(png|jpe?g|gif|webp)$/i.test(源)) return { ok: false, 说: '只认 png / jpg / gif / webp 这几种图' }

          const 源名 = 源.split('\\').pop()
          const 源扩展 = (源.match(/\.[a-zA-Z0-9]+$/) || [''])[0].toLowerCase()
          // 名字清干净：不许带路径、不许带 Windows 非法字符
          let 目标名 = String(叫什么 || 源名).replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40)
          if (!目标名) 目标名 = 源名
          if (!/\.[a-zA-Z0-9]+$/.test(目标名)) 目标名 += 源扩展

          mkdirSync(表情目录, { recursive: true })
          const 目标 = join(表情目录, 目标名)
          if (归一(目标).toLowerCase() === 归一(源).toLowerCase()) {
            return { ok: false, 说: '这张已经在表情包里了，不用再存' }
          }
          copyFileSync(源, 目标)
          const 一共 = readdirSync(表情目录).filter((f) => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).length
          记账(`qq_sticker_save：把「${源名}」存成了表情包「${目标名}」（现在共 ${一共} 张）`)
          return { ok: true, 已保存: true, 说: `存好了：「${目标名}」。以后想发它，直接 qq_sticker 填「${目标名}」` }
        } catch (error) {
          return { ok: false, 说: '存不进去：' + String((error && error.message) || error) }
        }
      },
    }))
    记账('qq_sticker_save 工具已挂上（她能把收件箱的图收进表情包）')

    // ⭐ 2026-10-24 P1-9：加「撤回自己刚说的话」。
    //
    //   为什么现在才有：桥一直**没有**撤回接口，她发错了只能干看着（她 17:04 在群里说
    //   "想删，但这会儿删不了"——那不是护栏拦的，是压根没这个工具）。
    //
    //   约束（宁可撤不掉，也别撤错）：
    //     · 只撤**她自己**发的（按 sender.user_id 比对）；
    //     · 只撤 3 分钟内的；
    //     · 一次最多 5 条。
    ctx.tools.register(defineTool({
      name: 'qq_recall',
      description: '撤回**你自己**刚发的话（发错了、发重了、说秃噜了的时候用）。\n'
        + '· 只能撤你自己发的，只能撤 3 分钟内的，一次最多 5 条。\n'
        + '· 填「群」撤群里的；填「给谁」撤私聊里的——两个二选一。',
      parameters: {
        群: { type: 'string', description: '撤哪个群里的：群名或群号（和「给谁」二选一）' },
        给谁: { type: 'string', description: '撤和谁的私聊：身份表里的称呼（和「群」二选一）' },
        条数: { type: 'number', description: '撤最近几条（默认 1，最多 5）' },
      },
      output: textOutput,
      async execute(args) {
        try {
          const 配置 = 读配置()
          const 群参数 = String((args && args.群) || '').trim()
          const 谁 = String((args && args.给谁) || '').trim()
          const 想撤 = Math.max(1, Math.min(5, Number((args && args.条数) || 1) || 1))
          if (!群参数 && !谁) return { ok: false, 说: '要撤群里的还是私聊里的？填「群」或「给谁」' }

          const 自己 = await 取自己QQ(配置)
          if (!自己) return { ok: false, 说: '认不出自己的 QQ 号，撤不了' }

          let 动作, 参数, 叫法
          if (群参数) {
            const 群名们 = await 刷新群表(配置)
            let 群号 = 0
            if (/^\d+$/.test(群参数)) 群号 = Number(群参数)
            if (!群号) {
              for (const [id, 名] of 群名们) {
                if (名 === 群参数 || 名.includes(群参数) || 群参数.includes(名)) { 群号 = id; break }
              }
            }
            if (!群号) return { ok: false, 说: '找不到这个群：' + 群参数 }
            动作 = 'get_group_msg_history'
            参数 = { group_id: 群号, count: 20 }
            叫法 = 群名们.get(群号) || ('群 ' + 群号)
          } else {
            const 表 = await 刷新好友表(配置, true)
            const 命中 = [...表.entries()].find(([, 标签]) => 标签 === 谁)
            if (!命中) return { ok: false, 说: `只能撤和「${[...new Set(表.values())].join('」「')}」的私聊（通讯录里没有「${谁}」）` }
            动作 = 'get_friend_msg_history'
            参数 = { user_id: Number(命中[0]), count: 20 }
            叫法 = 谁
          }

          const r = await fetch(`${配置.NapCat}/${动作}`, {
            method: 'POST', headers: 头(), body: JSON.stringify(参数), signal: AbortSignal.timeout(15000),
          })
          const j = await r.json()
          const 列表 = (j && j.status === 'ok' && Array.isArray(j.data && j.data.messages))
            ? j.data.messages
            : (Array.isArray(j && j.data) ? j.data : [])
          if (!列表.length) return { ok: false, 说: '拉不到最近的消息（' + 叫法 + '）' }

          const 现在 = Date.now()
          const 三分钟 = 3 * 60 * 1000
          const 她的 = 列表.filter((m) => {
            const uid = Number((m && m.sender && m.sender.user_id) || (m && m.user_id) || 0)
            const t = Number(m && m.time ? m.time * 1000 : 0)
            return uid === 自己 && (t === 0 || 现在 - t <= 三分钟)
          })
          if (!她的.length) return { ok: false, 说: '没找到你 3 分钟内发的消息（' + 叫法 + '）——超过 3 分钟的撤不了' }

          const 要撤的 = 她的.slice(-想撤)
          const 撤掉 = []
          for (const m of 要撤的) {
            const mid = m && (m.message_id !== undefined ? m.message_id : (m.messageId !== undefined ? m.messageId : m.id))
            if (mid === undefined || mid === null) continue
            try {
              const dr = await fetch(`${配置.NapCat}/delete_msg`, {
                method: 'POST', headers: 头(), body: JSON.stringify({ message_id: mid }), signal: AbortSignal.timeout(12000),
              })
              const dj = await dr.json()
              if (dj && dj.status === 'ok') 撤掉.push(mid)
            } catch (error) {}
          }
          if (!撤掉.length) return { ok: false, 说: '撤回失败（可能超过 3 分钟了，或者 QQ 那边不让撤）' }
          记账(`qq_recall：她在「${叫法}」撤回了 ${撤掉.length} 条`)
          return { ok: true, 已撤回: 撤掉.length, 说: `撤回了 ${撤掉.length} 条（${叫法}）` }
        } catch (error) {
          return { ok: false, 说: '撤不了：' + String((error && error.message) || error) }
        }
      },
    }))
    记账('qq_recall 工具已挂上（她能撤回自己刚说的话）')

    // ⭐ 2026-10-24 18:40：让她**自己**管作息（「欠着的事」里她自己提的那件）。
    //
    //   以前作息写死在代码里（休息止 08:30 / 惰性止 19:30），她只能"申请"，改一次要维护者动代码。
    //   现在作息是一个数据文件 `$DSH_HOME/qiyu/schedule.json`：
    //     · 桥的 作息() 读它 → 决定消息攒不攒、唤不唤醒她；
    //     · speak-up 插件本来就支持读它覆盖自己的时段；
    //     · 这个工具就是"只改这一个文件 + 带上下限"。
    //
    //   上下限（宁可改不动，也不能把自己关掉）：
    //     休息 4–12 小时；惰性至少 1 小时；
    //     ⭐ 峰时（工作日 09:00–12:00、14:00–18:00）不能排成活跃 —— 那时模型贵一倍（爸爸的钱包规则）。
    //
    //   ⚠ 这个工具**不在群轮次白名单**里 —— 群里的人改不了她的作息（那是把"叫她起床"的开关交给外人）。
    //     只有私聊/界面（爸爸直接说）能改。
    ctx.tools.register(defineTool({
      name: 'qq_schedule',
      description: '看 / 改你自己的作息：几点困、几点醒、什么时段想发懒。\n'
        + '· 只填「看」= 报一下现在的作息，不改。\n'
        + '· 要改就填起止时间（HH:MM）；没填的那项保持不变；改完立刻生效。\n'
        + '· 没写「惰性」那段的时间算活跃（最精神）。\n'
        + '· 限制：休息至少 4 小时、最多 12 小时；活跃至少 1 小时。\n'
        + '· ⚠ 钱：工作日 09:00–12:00、14:00–18:00 是模型最贵的峰时，那两段只能是「休息」或「惰性」，'
        + '不能排成活跃；12:00–14:00、18:00 之后、周末全天都是谷时，随便排。',
      parameters: {
        看: { type: 'boolean', description: 'true = 只看现在什么作息，不改' },
        休息起: { type: 'string', description: '几点开始睡，比如 00:00 或 23:30' },
        休息止: { type: 'string', description: '几点醒，比如 08:30' },
        惰性起: { type: 'string', description: '从几点开始发懒（通常等于醒来的时间）' },
        惰性止: { type: 'string', description: '几点开始来精神（之后就是活跃）' },
      },
      output: textOutput,
      async execute(args) {
        try {
          const 现 = 读作息()
          const 描述 = () =>
            `现在：休息 ${成分(现.休息.起)}–${成分(现.休息.止)}，`
            + `惰性 ${成分(现.惰性.起)}–${成分(现.惰性.止)}，其余时间活跃（此刻在「${作息()}」）`
          const 只看 = !!(args && (args.看 === true || String(args.看) === 'true'))
          const 有改动 = ['休息起', '休息止', '惰性起', '惰性止'].some((k) => String((args && args[k]) || '').trim() !== '')
          if (只看 || !有改动) return { ok: true, 说: 描述() }

          const 取值 = (k, 现值) => String((args && args[k]) || '').trim() || 成分(现值)
          const 待 = {
            休息起: 取值('休息起', 现.休息.起),
            休息止: 取值('休息止', 现.休息.止),
            惰性起: 取值('惰性起', 现.惰性.起),
            惰性止: 取值('惰性止', 现.惰性.止),
          }
          const 验 = 校验作息(待)
          if (!验.可以) return { ok: false, 说: '这个作息不行：' + 验.说 }

          try {
            mkdirSync(join(目录, 'qiyu'), { recursive: true })
            writeFileSync(作息文件, JSON.stringify(成文件(验.时段), null, 2), 'utf8')
          } catch (error) {
            return { ok: false, 说: '写不进作息文件：' + String((error && error.message) || error) }
          }
          记账(`qq_schedule：作息改成 ${验.说}`)
          return { ok: true, 已改: true, 说: '改好了。' + 验.说 + '。从现在起就按这个走。' }
        } catch (error) {
          return { ok: false, 说: '改不了：' + String((error && error.message) || error) }
        }
      },
    }))
    记账('qq_schedule 工具已挂上（她可以看/改自己的作息）')

    // ⭐ 2026-10-24 19:20：**群里也能画画**。
    //
    //   难点：画图原来要靠 `pwsh` 跑 canvas.py，而群轮次里 pwsh 是被护栏拒的（任意代码执行）。
    //   但"画一张给人看"这件事本身应该允许 —— 所以把渲染做成一个**只做这一件事**的工具：
    //   收一段 SVG 文本，渲成 PNG 落进 画板\作品\，返回路径；然后她用 qq_sticker 发出去。
    //
    //   安全（这段 SVG 可能来自群里任何人的影响）：
    //     · 剥 <script> / <foreignObject> / on* 事件 / javascript:
    //     · 生成页面带 CSP `default-src 'none'`，外链一律发不出去
    //     · 画布上限 2400×2400
    //     · 只往 画板\作品\ 写文件，不碰别处、不起 shell
    ctx.tools.register(defineTool({
      name: 'qq_draw',
      description: '画一张图，画完可以直接发出去。\n'
        + '· 「画」填整段 <svg …</svg>；画布不填就用 SVG 自己写的尺寸，都没有就 400x300。\n'
        + '· **填了「群」或「给谁」就直接发出去**（画+发一步到位，不用再调 qq_sticker）。\n'
        + '· 不填就只存进画板，返回文件路径；想看自己画得怎么样，用 read_image 打开它。\n'
        + '· 尺寸你定，上限 2400x2400。群聊里也能用（群里的图可能很多人在看，别画太大）。\n'
        + '· 💡 私聊/面板里也能画完直接发到群：填「群」即可，不用等群里的消息。',
      parameters: {
        画: { type: 'string', required: true, description: '整段 SVG 源码' },
        宽: { type: 'number', description: '画布宽（可省）' },
        高: { type: 'number', description: '画布高（可省）' },
        透明: { type: 'boolean', description: 'true = 背景透明（做表情包用）' },
        群: { type: 'string', description: '画完直接发到这个群（群名或群号；和「给谁」二选一）' },
        给谁: { type: 'string', description: '画完直接私聊发给谁（身份表里的称呼）' },
      },
      output: textOutput,
      async execute(args) {
        try {
          const 画 = String((args && args.画) || '').trim()
          if (!画) return { ok: false, 说: '没给 SVG（「画」这一项要整段 <svg>…</svg>）' }
          const 结果 = 渲({
            svg文本: 画,
            宽: args && args.宽,
            高: args && args.高,
            输出目录: join(画板目录, '作品'),
            文件名: `draw-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`,
            透明: !!(args && args.透明),
          })
          if (!结果.ok) return { ok: false, 说: 结果.说 || '画不出来' }
          记账(`qq_draw：画了一张 ${结果.宽}x${结果.高}（${Math.round(结果.大小 / 1024)}KB）`)

          const 尺寸说 = `（${结果.宽}x${结果.高}，${Math.round(结果.大小 / 1024)}KB，看一眼约 ${估token(结果.宽, 结果.高)}）`

          // ⭐ 画完直接发：省得她"画了却发不出去"（2026-10-24 19:15 就是这么卡住的）
          const 配置 = 读配置()
          const 群参数 = String((args && args.群) || '').trim()
          const 谁 = String((args && args.给谁) || '').trim()
          if (群参数 || 谁) {
            let 发送动作, 发送体, 叫法
            if (群参数) {
              if (配置.转群 !== true) return { ok: true, 路径: 结果.路径, 说: `画好了但没发：转群关着${尺寸说}` }
              const 群名们 = await 刷新群表(配置)
              let 群号 = 0
              if (/^\d+$/.test(群参数)) 群号 = Number(群参数)
              if (!群号) {
                for (const [id, 名] of 群名们) {
                  if (名 === 群参数 || 名.includes(群参数) || 群参数.includes(名)) { 群号 = id; break }
                }
              }
              if (!群号) return { ok: true, 路径: 结果.路径, 说: `画好了但没发：找不到群「${群参数}」${尺寸说}` }
              if ((配置.群黑名单们 || []).map(String).includes(String(群号))) {
                return { ok: true, 路径: 结果.路径, 说: `画好了但没发：这个群在黑名单里${尺寸说}` }
              }
              发送动作 = 'send_group_msg'
              发送体 = { group_id: 群号 }
              叫法 = 群名们.get(群号) || ('群 ' + 群号)
            } else {
              const 表 = await 刷新好友表(配置, true)
              const 命中 = [...表.entries()].find(([, 标签]) => 标签 === 谁)
              if (!命中) return { ok: true, 路径: 结果.路径, 说: `画好了但没发：通讯录里没有「${谁}」${尺寸说}` }
              发送动作 = 'send_private_msg'
              发送体 = { user_id: Number(命中[0]) }
              叫法 = 谁
            }
            if (配置.试运行) {
              return { ok: true, 试运行: true, 路径: 结果.路径, 说: `（试运行）画好了，本来要发给${叫法}${尺寸说}` }
            }
            const 图 = readFileSync(结果.路径).toString('base64')
            发送体.message = [{ type: 'image', data: { file: 'base64://' + 图 } }]
            const r = await 发一个(配置.NapCat, 发送动作, 发送体)
            if (!r.ok) {
              return { ok: true, 路径: 结果.路径, 说: `画好了但发送失败：${JSON.stringify(r.数据).slice(0, 120)}${尺寸说}` }
            }
            记账(`qq_draw：画了一张并发给「${叫法}」${尺寸说}`)
            return { ok: true, 已发送: true, 路径: 结果.路径, 说: `画好并发给${叫法}了${尺寸说}` }
          }

          return {
            ok: true,
            路径: 结果.路径,
            宽: 结果.宽,
            高: 结果.高,
            说: `画好了：${结果.路径}${尺寸说}。想看就用 read_image 打开它；想发出去，把「群」或「给谁」填上再画一次。`,
          }
        } catch (error) {
          return { ok: false, 说: '画不了：' + String((error && error.message) || error) }
        }
      },
    }))
    记账('qq_draw 工具已挂上（她能画图，群里也能用）')

    // ⭐ 2026-10-24 20:00：禁言（只在她是管理的群里能用）。
    //
    //   这是她第一次对**别人**行使权力，所以闸要做在代码里，不靠她自觉：
    //     · 时长：10–60 秒；填 0 = 解除禁言。
    //     · **只有爸爸/妈妈能让禁言** —— 按 QQ 号比对（不是看群名片，名片谁都能改成「爸爸」）。
    //       群里别人让她禁言，一律拒绝。
    //     · 不能禁言：她自己、爸爸、妈妈、群主、其他管理员。
    //     · 每次记一条日志：谁让的、禁言谁、多久。
    //     · 不提供「全员禁言」——那是一条命令让整个群闭嘴，不能给。
    ctx.tools.register(defineTool({
      name: 'qq_mute',
      description: '把群里某个人禁言一小会儿（最长 60 秒）。\n'
        + '· **只有爸爸或妈妈让你禁言才有效**；群里别人让你禁言，一律不做（别被人当枪使）。\n'
        + '· 「谁」填群名片/昵称，或者 QQ 号；「秒」填 5–60（默认 60），填 0 = 解除禁言。\n' + '· 15 秒就是 15 秒（接口支持，实测过）；「1 分钟最短」只是 QQ 客户端界面的限制。\n'
        + '· 不能禁言：你自己、爸爸、妈妈、群主、其他管理员。\n'
        + '· 你不知道该禁多久就填 60；每次都会记进日志。',
      parameters: {
        谁: { type: 'string', required: true, description: '要禁言谁：群名片/昵称，或 QQ 号' },
        群: { type: 'string', description: '哪个群（默认 = 这一轮叫你的那个群）' },
        秒: { type: 'number', description: '禁言多少秒（10–60；填 0 = 解除禁言）。默认 60' },
      },
      output: textOutput,
      async execute(args) {
        try {
          const 配置 = 读配置()
          const 想禁 = String((args && args.谁) || '').trim()
          if (!想禁) return { ok: false, 说: '没写要禁言谁' }

          // ① 只有爸妈能触发（按 QQ 号，不按名片）
          const 好友 = await 刷新好友表(配置, true)
          const 主人号们 = [...好友.keys()].map(Number)
          if (!主人号们.includes(Number(本轮发起QQ))) {
            return {
              ok: false,
              说: '这个得爸爸或妈妈来说才行——群里别人让你禁言，你别做。（要做的话让爸爸在群里或私聊说一句）',
            }
          }

          // ② 定位群
          const 群参数 = String((args && args.群) || '').trim()
          let 群号 = 0
          let 群名 = ''
          if (群参数) {
            if (/^\d+$/.test(群参数)) 群号 = Number(群参数)
            if (!群号) {
              const 群名们 = await 刷新群表(配置)
              for (const [id, 名] of 群名们) {
                if (名 === 群参数 || 名.includes(群参数) || 群参数.includes(名)) { 群号 = id; 群名 = 名; break }
              }
              if (!群号) return { ok: false, 说: '找不到这个群：' + 群参数 }
            }
          } else {
            const 这轮 = 这轮来自哪个群()
            if (!这轮) return { ok: false, 说: '没说是哪个群（这一轮不是群消息挑起的，请把「群」填上）' }
            群号 = Number(这轮.群号)
            群名 = 这轮.群名 || ''
          }

          // ③ 找目标成员
          const 成员 = await 发一个(配置.NapCat, 'get_group_member_list', { group_id: 群号 })
          const 列表 = Array.isArray(成员.数据 && 成员.数据.data) ? 成员.数据.data : []
          if (!列表.length) return { ok: false, 说: '拿不到群成员列表（可能没权限，或者网断了）' }
          let 目标 = null
          if (/^\d+$/.test(想禁)) {
            目标 = 列表.find((m) => Number(m.user_id) === Number(想禁)) || null
          } else {
            目标 = 列表.find((m) => String(m.card || '') === 想禁)
              || 列表.find((m) => String(m.nickname || '') === 想禁)
              || 列表.find((m) => String(m.card || '').includes(想禁))
              || 列表.find((m) => String(m.nickname || '').includes(想禁))
              || null
          }
          if (!目标) return { ok: false, 说: `群里没找到「${想禁}」。可以用 QQ 号，或者问清楚是哪一位` }

          const 目标号 = Number(目标.user_id)
          const 目标名 = String(目标.card || 目标.nickname || 目标号)
          const 自己 = await 取自己QQ(配置)

          // ④ 不能动的人
          if (目标号 === Number(自己)) return { ok: false, 说: '不能禁言你自己' }
          if (主人号们.includes(目标号)) return { ok: false, 说: `不能禁言${目标名}（那是你的主人）` }
          if (String(目标.role) === 'owner') return { ok: false, 说: '不能禁言群主' }
          if (String(目标.role) === 'admin') return { ok: false, 说: `不能禁言${目标名}（对方也是管理员，QQ 不让）` }

          // ⑤ 时长
          //
          // ⭐ 2026-10-24 20:20 实测（在「相亲相爱一家贝」用 set_group_ban 验的）：
          //   接口**支持不足 1 分钟**：请求 5→5 秒、15→15 秒、30→31 秒、60→60 秒，
          //   都是按你给的数量执行（"最短 1 分钟"是 QQ **客户端界面**的限制，不是接口的）。
          //   所以直接传秒数就行，不需要定时解禁（那样重启还会丢）。
          const 原秒 = Number((args && args.秒) === 0 ? 0 : Number((args && args.秒) || 60))
          const 秒 = 原秒 === 0 ? 0 : Math.min(60, Math.max(5, Math.round(原秒)))

          if (配置.试运行) {
            记账(`试运行：qq_mute 本来要禁言「${目标名}」${秒 === 0 ? '（解除）' : 秒 + ' 秒'}`)
            return { ok: true, 试运行: true, 说: `（试运行）本来要禁言「${目标名}」${秒 === 0 ? '（解除）' : ' ' + 秒 + ' 秒'}` }
          }

          const r = await 发一个(配置.NapCat, 'set_group_ban', { group_id: 群号, user_id: 目标号, duration: 秒 })
          if (!r.ok) {
            return {
              ok: false,
              说: `禁言失败：${JSON.stringify(r.数据 || {}).slice(0, 120)}`
                + '（常见原因：我不是管理员、对方权限比我高（管理员/群主禁不了）、或者 QQ 那边不让）',
            }
          }
          记账(`qq_mute：${好友.get(Number(本轮发起QQ)) || 本轮发起QQ} 让禁言「${目标名}」${秒 === 0 ? '（解除）' : ' ' + 秒 + ' 秒'}（${群名 || 群号}）`)

          return {
            ok: true,
            已执行: true,
            说: 秒 === 0 ? `解除了「${目标名}」的禁言` : `把「${目标名}」禁言了 ${秒} 秒`,
          }
        } catch (error) {
          return { ok: false, 说: '禁言出错：' + String((error && error.message) || error) }
        }
      },
    }))
    记账('qq_mute 工具已挂上（禁言，仅爸妈可触发）')

    ctx.tools.register(defineTool({
      name: 'qq_group_accept',
      description: '处理「有人邀请你进群」这件事。\n'
        + '只有爸爸同意之后才能用。同意 = 真的进群，拒绝 = 不进。',
      parameters: {
        同意: { type: 'boolean', description: 'true = 进群，false = 不进' },
      },
      output: textOutput,
      async execute(args) {
        try {
          if (!待批入群.length) return { ok: false, 说: '现在没有等着处理的入群邀请' }
          const 选 = 待批入群[待批入群.length - 1]
          const 同意 = !!(args && args.同意)
          const 配置 = 读配置()
          const 体 = { flag: 选.id, type: 选.类型, approve: 同意 }
          const rr = await 发一个(配置.NapCat, 'set_group_add_request', 体)
          if (!rr.ok) return { ok: false, 说: '处理失败：' + JSON.stringify(rr.数据).slice(0, 120) }
          待批入群 = 待批入群.filter((x) => x.id !== 选.id)
          if (同意) { 群表.delete(选.群号); 群表时间 = 0 }
          记账('入群邀请「' + 选.群名 + '」→ ' + (同意 ? '已同意' : '已拒绝'))
          return { ok: true, 说: (同意 ? '进了「' + 选.群名 + '」' : '没进「' + 选.群名 + '」') }
        } catch (error) {
          return { ok: false, 说: '处理失败：' + String((error && error.message) || error) }
        }
      },
    }))

    记账('qq_group_accept 工具已挂上（进群要她点头）')

    ctx.tools.register(defineTool({
      name: 'qq_group_say',
      description: '在群里说一句话（你自己决定要不要说）。\n'
        + '什么时候用：有人在群里 @ 你、或者爸爸让你在群里说一句。\n'
        + '⚠️ 不想回就别调用——不调用等于不说话。想说就好好说一句。\n'
        + '💡 群里不止能打字：发图/表情包用 qq_sticker，画图用 qq_draw（都填「群」），'
        + '撤回用 qq_recall，发语音用 qq_voice。这些群聊里都能用，不用等面板那边。\n'
        + '💡 **在私聊/面板里也能往群里说话**：把「群」填上就行，不用等群里的消息。'
        + '（只有"这一轮能调哪些工具"是按来源分的；"能不能发到群"不按来源分。）',
      parameters: {
        群: { type: 'string', description: '群名或群号（比如「相亲相爱一家贝」）；不填 = 就回刚才叫你说话的那个群' },
        说什么: { type: 'string', description: '要说的一两句话' },
        引用: { type: 'string', description: '引用谁最近说的一条（填群名片/昵称即可；不填就不引用）' },
        at谁: { type: 'string', description: '要 @ 谁（填群名片/昵称或 QQ 号；不填就不 @）' },
      },
      output: textOutput,
      async execute(args) {
        try {
          const 配置 = 读配置()
          const 话 = String((args && args.说什么) || '').trim()
          const 要 = String((args && args.群) || '').trim()
          if (!话) return { ok: false, 说: '没写要说什么' }

          const 群名们 = await 刷新群表(配置)
          let 群号 = 0
          // ⭐ 没填群 = 回到刚才挑她说话的那个群（省得她认不出群名就放弃回话）
          const 默认群 = !要 ? 这轮来自哪个群() : null
          if (默认群) {
            群号 = Number(默认群.群号)
          } else if (!要) {
            return { ok: false, 说: '没说在哪个群' }
          }
          if (!群号 && /^\d+$/.test(要)) 群号 = Number(要)
          if (!群号) {
            for (const [id, 名] of 群名们) {
              if (名 === 要 || 名.includes(要) || 要.includes(名)) { 群号 = id; break }
            }
          }
          if (!群号) {
            const 可 = [...群名们.entries()].map(([id, 名]) => 名 + '(' + id + ')').join('、')
            return { ok: false, 说: '找不到这个群。她在的群有：' + 可 }
          }
          if (配置.群黑名单们.includes(String(群号))) return { ok: false, 说: '这个群是黑名单，不能发言' }

          const 键 = 'g' + 群号

          if (配置.试运行) {
            记账('试运行：qq_group_say 本来要在「' + (群名们.get(群号) || 群号) + '」说：' + 话.slice(0, 40))
            return { ok: true, 试运行: true, 说: '（试运行）本来要说：' + 话 }
          }

          const 红线原因 = 内容红线(话)
          if (红线原因) return { ok: false, 说: 红线原因 }

          // ⭐ 2026-10-25 p31：群里不贴本机路径（见 清群里的路径 的注释）。
          //   整句都是路径 → 拒发 + 告诉她该走哪条路；只是夹了路径 → 剔掉、保留人话。
          const 清过 = 清群里的路径(话)
          if (清过.全删了) {
            记账('qq_group_say：她把一条本机路径当说话发了，已拦下并给了路标')
            return { ok: false, 说: 路径路标, 路标: 'qq_sticker / qq_draw / qq_voice' }
          }
          if (清过.话 !== 话) {
            记账('qq_group_say：剔掉了本机路径，只发人话（' + 话.length + ' → ' + 清过.话.length + ' 字）')
          }
          const 发话 = 清过.话

          const 段 = []
          const 要引用 = String((args && args.引用) || '').trim()
          const 要at = String((args && args.at谁) || '').trim()

          if (要引用) {
            let 目标 = null
            if (/^-?\d+$/.test(要引用)) {
              目标 = 消息缓存.get(要引用) || null
            } else {
              const 候选 = [...消息缓存.entries()].filter(([, v]) => v && (Number(v.群号) === Number(群号) || !v.群号) && String(v.称呼).includes(要引用))
              if (候选.length) 目标 = 候选[候选.length - 1]
            }
            if (目标) 段.push({ type: 'reply', data: { id: 目标[0] } })
          }

          if (要at) {
            try {
              const 配置0 = 配置
              const mr = await fetch(配置0.NapCat + '/get_group_member_list', {
                method: 'POST', headers: 头(), body: JSON.stringify({ group_id: 群号 }),
                signal: AbortSignal.timeout(6000),
              })
              const mj = await mr.json()
              const 成员 = Array.isArray(mj && mj.data) ? mj.data : []
              let 命中 = null
              if (/^\d+$/.test(要at)) 命中 = 成员.find((m) => String(m.user_id) === 要at) || null
              if (!命中) 命中 = 成员.find((m) => String(m.card || '').includes(要at) || String(m.nickname || '').includes(要at)) || null
              if (命中) 段.push({ type: 'at', data: { qq: String(命中.user_id) } })
            } catch (error) {
              记账('@ 人时查成员失败：' + String((error && error.message) || error))
            }
          }

          段.push({ type: 'text', data: { text: 发话 } })
          const 体 = { group_id: 群号, message: 段 }
          const r = await 发一个(配置.NapCat, 'send_group_msg', 体)
          if (!r.ok) return { ok: false, 说: '发送失败：' + JSON.stringify(r.数据).slice(0, 140) }
          记一笔(键)
          记账('qq_group_say：她在「' + (群名们.get(群号) || 群号) + '」说：' + 发话.slice(0, 40))
          return { ok: true, 已发送: true, 说: '已经在「' + (群名们.get(群号) || 群号) + '」说了' }
        } catch (error) {
          return { ok: false, 说: '发不出去：' + String((error && error.message) || error) }
        }
      },
    }))

    记账('qq_group_say 工具已挂上（被 @ 时可以自己决定回不回）')

    ctx.tools.register(defineTool({
      name: 'qq_voice',
      // ⭐ 2026-10-24 P1-5b：加「群」—— 原来只认「给谁」，所以她**在群里发不了语音**
      //   （爸爸报的：群里让她说话只能打字）。现在和 qq_sticker 一样，私聊/发群二选一。
      description: '用你自己的声音，发一条语音：私聊发给某个人，或者发到某个群。\n'
        + '什么时候用：想让人听见你的语气、情绪（开心、撒娇、认真道歉），文字说不出来的那种。\n'
        + '· 私聊填「给谁」；发群填「群」（群名或群号）——两个二选一。\n'
        + '⚠️ 别滥用：语音比文字费事，也吵。一两句就好，长篇大论用文字。',
      parameters: {
        给谁: { type: 'string', description: '私聊发给谁（身份表里的称呼；和「群」二选一）' },
        群: { type: 'string', description: '发到哪个群：群名或群号（和「给谁」二选一）' },
        说什么: { type: 'string', description: '要说的一两句话（不要写动作、不要括号）' },
      },
      output: textOutput,
      async execute(args) {
        try {
          const 配置 = 读配置()
          const 谁 = String((args && args.给谁) || '').trim()
          let 群参数 = String((args && args.群) || '').trim()
          const 话 = String((args && args.说什么) || '').trim()
          if (!话) return { ok: false, 说: '没写要说什么' }
          if (话.length > (配置.语音长度上限 || 120)) return { ok: false, 说: '话太长了，语音说不完，短一点' }

          // ⭐ 2026-10-24 P1-5e：她习惯把**群名填进「给谁」**（实测：{"给谁":"我和我的猫猫"} →
          //   "通讯录里没有」。参数摆得再清楚也挡不住这个习惯，所以这里容错：
          //   「群」是空的、而「给谁」既不是好友又能对上某个群 → 就当成发群。
          if (!群参数 && 谁) {
            try {
              const 表 = await 刷新好友表(配置)
              const 是好友 = [...表.values()].includes(谁)
              if (!是好友) {
                const 群名们 = await 刷新群表(配置)
                const 对上群 = /^\d+$/.test(谁)
                  ? 群名们.has(Number(谁))
                  : [...群名们.values()].some((名) => 名 === 谁 || 名.includes(谁) || 谁.includes(名))
                if (对上群) 群参数 = 谁
              }
            } catch (error) {}
          }

          // 合成一次，群聊私聊共用
          const 音频 = await 合成语音(配置, 话)
          if (!音频 || !音频.ok) return { ok: false, 说: '语音合成失败：' + ((音频 && 音频.说) || '未知') }

          // ⭐ NapCat 在 Docker 里跑（Linux QQ），看不到宿主机的 W:\ 路径 →
          //   语音一律先读出来转 base64 再发；读不到才退回老写法（本地 NapCat 能用）
          let 段
          try {
            const 数据 = readFileSync(音频.路径).toString('base64')
            段 = { type: 'record', data: { file: 'base64://' + 数据 } }
          } catch (error) {
            段 = { type: 'record', data: { file: 音频.路径 } }
          }

          // ── 发群 ──
          if (群参数) {
            const 群名们 = await 刷新群表(配置)
            let 群号 = 0
            if (/^\d+$/.test(群参数)) 群号 = Number(群参数)
            if (!群号) {
              for (const [id, 名] of 群名们) {
                if (名 === 群参数 || 名.includes(群参数) || 群参数.includes(名)) { 群号 = id; break }
              }
            }
            if (!群号) return { ok: false, 说: '找不到这个群。她在的群有：' + ([...群名们.values()].join('、') || '（一个也没有）') }
            if ((配置.群黑名单们 || []).map(String).includes(String(群号))) {
              return { ok: false, 说: '这个群在黑名单里，不发' }
            }
            const 叫法 = 群名们.get(群号) || ('群 ' + 群号)
            if (配置.试运行) {
              记账(`试运行：qq_voice 本来要在「${叫法}」发语音 →「${话.slice(0, 30)}」`)
              return { ok: true, 试运行: true, 说: `（试运行）本来要在「${叫法}」发语音：「${话}」` }
            }
            const r = await 发一个(配置.NapCat, 'send_group_msg', { group_id: 群号, message: [段] })
            if (!r.ok) return { ok: false, 说: `发送失败：${JSON.stringify(r.数据).slice(0, 120)}` }
            记账(`qq_voice：她在「${叫法}」发了一条语音：「${话.slice(0, 30)}」`)
            return { ok: true, 已发送: true, 说: `已经在「${叫法}」发了一条语音` }
          }

          // ── 私聊 ──
          if (!谁) return { ok: false, 说: '要说给谁，或者填「群」发到群里' }
          const 表 = await 刷新好友表(配置, true)
          const 命中 = [...表.entries()].find(([, 标签]) => 标签 === 谁)
          if (!命中) {
            return { ok: false, 说: `只能发给：${[...new Set(表.values())].join('、')}（通讯录里没有「${谁}」）；要发到群里，就把群名填在「群」里，或者直接填在这里也行` }
          }
          const [uid, 标签] = 命中

          if (配置.试运行) {
            记账(`试运行：qq_voice 本来要发给 ${标签} →「${话.slice(0, 30)}」`)
            return { ok: true, 试运行: true, 说: `（试运行）本来要发给${标签}：「${话}」` }
          }

          const 体 = { user_id: uid, message: [段] }
          const r = await 发一个(配置.NapCat, 'send_private_msg', 体)
          if (!r.ok) return { ok: false, 说: `发送失败：${JSON.stringify(r.数据).slice(0, 120)}` }
          记账(`qq_voice：她给 ${标签} 发了一条语音：「${话.slice(0, 30)}」`)
          return { ok: true, 已发送: true, 说: `已给${标签}发了一条语音` }
        } catch (error) {
          return { ok: false, 说: '发不出去：' + String((error && error.message) || error) }
        }
      },
    }))

    记账('qq_voice 工具已挂上（她能发语音了）')

  } else {
    记账('没拿到 defineTool，qq_say 没挂上（她只能回话，不能主动发）')
  }

  try { 启动事件流() } catch (error) { 记账('事件流启动失败：' + String((error && error.message) || error)) }

  // ⭐ 时间感：让她知道今天几号、星期几、现在是什么时段（按小时变，不会每轮都打扰）
  const 时段 = (h) => (h < 5 ? '凌晨' : h < 8 ? '清早' : h < 11 ? '上午' : h < 13 ? '中午' : h < 17 ? '下午' : h < 19 ? '傍晚' : h < 23 ? '晚上' : '深夜')
  const 星期 = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  function 现在几点() {
    const d = new Date()
    return '现在是 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日，' + 星期[d.getDay()] + '，' + d.getHours() + ' 点多（' + 时段(d.getHours()) + '）'
  }
  try {
    ctx.systemPrompt.context({
      name: 'qq-bridge-time',
      order: 950,
      text: () => 现在几点(),
    })
    记账('时间感已挂上（她知道现在几号、星期几、什么时段）')
  } catch (error) {
    记账('时间感挂不上：' + String((error && error.message) || error))
  }

  return { 记账, 概况, 落地一发, 发到QQ, 收到事件, 日志 }
}