// DSH「通到 QQ」· 宿主半边
//
// 这一半只做一件事（先只做 DSH → QQ）：
//   伙伴在「目标会话」里说完一句话（一整轮的最后一句），就自动把它发到 QQ（私聊 / 群）。
//   发 QQ 走 NapCat 的 OneBot HTTP 接口（127.0.0.1:3000），走标准的 OneBot 11 HTTP。
//
// 反过来（QQ → DSH）是下一半，放到另一个插件/进程里做，不在这里混。
//
// ⚠ 安全默认：总开关 = false、试运行 = true —— 不手动打开，一句都不会真的发到 QQ。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const 执行 = promisify(execFile)
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
const 语音目录 = join(角色目录, '语音')
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
  const 出 = {
    总开关: 布(混.总开关, 默认配置.总开关),
    试运行: 布(混.试运行, 默认配置.试运行),
    目标会话: 字(混.目标会话),
    私聊QQ: 字(混.私聊QQ),
    群号: 字(混.群号),
    群号们: 字(混.群号).split(/[,，\s]+/).filter(Boolean),
    群黑名单们: 字(混.群黑名单).split(/[,，\s]+/).filter(Boolean),
    转私聊: 布(混.转私聊, 默认配置.转私聊),
    转群: 布(混.转群, 默认配置.转群),
    自己QQ: Number(混.自己QQ) || 0,
    主人: 字(混.主人),
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
  const 已转消息 = new Set() // 已经转发进 DSH 的 QQ 消息 id（防重复转）
  let 上次私聊时间 = Math.floor(Date.now() / 1000) // 从这一刻起只认新消息，不补旧的
  let 上次群时间 = Math.floor(Date.now() / 1000)
  // ⭐ 这一轮是谁从 QQ 挑起的：{ uid, 标签 }（私聊）或 { 群号, 群名, 称呼 }（群聊）。
  //    为空 = 不是 QQ 引起的（爸爸在界面说的），不回发
  let 待回 = null
  // ⭐ 入群邀请 / 申请：待处理的，等爸爸点头
  let 待批入群 = [] // [{ id, 群号, 群名, 邀请人, 邀请人号, 类型 }]
  const 已处理申请 = new Set()
  let 上次查申请 = 0

  // ⭐⭐ 作息时段（2026-10-22 晚加的）：她累不累，决定消息要不要现在给她
  //   用户定的节律：0-9 休息（关机）/ 9-20 惰性 / 20-24 活跃
  //   四象限（用户选方案乙）：
  //              | 群闲聊 | 群里@她      | 私聊(爸妈)
  //     休息     | 攒着   | 攒着         | 攒着
  //     惰性     | 攒着   | 立刻给+劝退  | 立刻给
  //     活跃     | 立刻给 | 立刻给       | 立刻给
  //   ⭐ 时段（用户 22:32 定的，按**分钟**，支持半点）：
  //      休息 00:00–08:30 / 惰性 08:30–19:30 / 活跃 19:30–24:00
  //   ⚠ 必须和 speak-up 里的 判作息() 一致，改一边就改另一边。
  const 作息边界 = {
    休息止: 8 * 60 + 30, // 08:30
    惰性止: 19 * 60 + 30, // 19:30
  }
  const 作息 = () => {
    const d = new Date()
    const 分 = d.getHours() * 60 + d.getMinutes()
    if (分 < 作息边界.休息止) return '休息'
    if (分 < 作息边界.惰性止) return '惰性'
    return '活跃'
  }

  // 攒着的消息（等她进入下一个时段、有第一条消息进来时一起给她）
  // 每条：{ 时间, 行, 是私聊, 有人at我 }   —— 「行」就是已经排好的那一行文字
  let 攒消息 = []
  let 攒的是哪个时段的 = '' // 记着这批是哪个时段攒的，用来生成"你睡着的时候"这种话
  const 攒上限 = 60 // 条数上限，防止惰性 11 小时 + 群聊人多把上下文撑爆

  /** 把一条消息塞进攒的队伍里（满了就丢最老的，保留最近的） */
  const 攒起来 = (条) => {
    if (攒的是哪个时段的 === '') 攒的是哪个时段的 = 作息()
    if (攒消息.length >= 攒上限) 攒消息.shift()
    攒消息.push(条)
  }

  /** 把攒的消息打包成一段话（没有就返回 ''）；调用后清空 */
  const 打包攒消息 = () => {
    if (!攒消息.length) return ''
    const 条数 = 攒消息.length
    const 哪个 = 攒的是哪个时段的 === '休息' ? '你睡着的时候' : '那会儿你不太想说话的时候'
    // 每条前面标个序号，方便她"挑着回"时指得到是第几条
    const 正文 = 攒消息.map((x, i) => `${i + 1}. ${x.行}`).join('\n')
    const 有私聊 = 攒消息.some((x) => x.是私聊)
    const 有人at = 攒消息.some((x) => x.有人at我)
    攒消息 = []
    攒的是哪个时段的 = ''
    const h = new Date().getHours()
    // ⭐⭐ 让她**自己**判断：哪些要回、哪些不用回、回了的话连发的就并成一句。
    //   不要写"请逐条回复"——她会变成客服。要像一个人翻手机：这几条都得回，那几条算了。
    const 问一句 =
      '哪些要回、哪些不用回，你自己看。' +
      (有私聊 ? '\n有人是专门找你说的，那种通常得回一下。' : '') +
      (有人at ? '\n有人在群里 @ 你，回不回也由你——真不想理就放着。' : '') +
      '\n同一件事被好几个人提过，回一句就够了，别一条一条回。'
    return (
      `（${哪个}，这些人说过话，现在一起给你（共 ${条数} 条）：\n\n${正文}\n\n` +
      `现在 ${h} 点多了。${问一句}）`
    )
  }

  // ⭐ 每个群各自的水位（两个群不能共用一个「上次看到哪」）
  const 群水位 = new Map()

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

  // ⭐ 没聊过的人：NapCat 查历史会报「消息不存在」，别每 4 秒去撞一次
  const 空历史 = new Map() // uid → 上次确认“查不到”的时间
  const 空历史跳过 = (uid) => {
    const t = 空历史.get(uid) || 0
    return Date.now() - t < 10 * 60 * 1000
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

  async function 发一个(base, action, 体) {
    try {
      const r = await fetch(`${base}/${action}`, {
        method: 'POST',
        headers: 头(),
        body: JSON.stringify(体),
      })
      const j = await r.json()
      return { action, ok: !!(j && j.status === 'ok' && j.retcode === 0), 数据: j }
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

  /** 手搓一条 user 消息（跟 speak-up 一样：role=user，source.kind 标成 qq，不冒充她亲手打的）。 */
  const 手搓用户消息 = (文案) => ({
    id: 新id(),
    role: 'user',
    content: [{ type: 'text', text: String(文案) }],
    source: { kind: 'qq' },
  })

  /**
   * ⭐ 拉好友列表，建「QQ号 → 称呼」表。
   * 只用 remark（她给好友起的备注），**没有备注的一律不认**——别人的昵称、群名片改成「爸爸」都没用。
   * 备注以「爸爸」开头 → 爸爸；以「妈妈」开头 → 妈妈（含「妈妈的小号」，归同一个人）。
   */
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
      记账(`拉好友列表失败：${String((error && error.message) || error)}`)
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
    return { ok: true, 版本, 配置, 配置文件, NapCat状态, 好友表: [...好友表].map(([uid, 标签]) => ({ uid, 标签 })), 今日额度, 活着的会话: 清单, 目标情况: 配置.目标会话 && 清单.length ? 清单.filter((x) => x.id === 配置.目标会话) : [], 日志 }
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

  路线(`${路由前缀}/state`, async (req, res) => {
    await 读体(req)
    回(res, await 概况())
  })

  路线(`${路由前缀}/save`, async (req, res) => {
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
    await 读体(req)
    写额度({})
    记账('今日主动发消息的额度已清零')
    回(res, { ok: true, 说: '今天主动发消息的次数已清零', 今日额度: {} })
  })

  // 收到 QQ 里你发来的话 → 喂进目标会话，让它照常开一轮。
  // ⚠ 这是「QQ → DSH」那半的**入口函数**：一句正文 → agent.followup 走 DSH 自己的回合。
  async function 转入文字(文字, 标签, uid, 群信息) {
    const 配置 = 读配置()
    if (!配置.目标会话) return { ok: false, 说: '还没选「目标会话」' }
    if (!配置.总开关) return { ok: false, 说: '总开关关着，先打开' }

    // ⭐⭐ 作息分流（见上面的四象限表）。在这里拦，是因为只有这一步同时知道
    //   「现在几点」「是私聊还是群聊」「有没有人 @ 她」。
    const 现在时段 = 作息()
    const 是私聊 = !!uid
    const 有人at我 = /（这条在 @你）/.test(String(文字 || ''))
    const 这一行 = 是私聊 ? `[${标签 || '有人'}] ${文字}` : 文字

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
    if (!agent) return { ok: false, 说: `目标会话现在没活着（${短id(配置.目标会话)}），先把它打开` }
    // 带名字进去：她才知道这句是爸爸说的还是妈妈说的
    let 全文 = 标签 ? `[${标签}] ${文字}` : 文字
    // ⭐ 如果还攒着上一个时段的消息，把打包的那段**放在最前面**——
    //   让她先知道"睡着/偷懒的时候发生了什么"，再看眼前这条。
    const 打包 = 打包攒消息()
    if (打包) {
      全文 = 打包 + '\n\n' + 全文
      记账(`把攒着的消息一起给她了（${打包.slice(0, 40)}…）`)
    }
    try {
      // ⚠⚠ 必须 await：followup 返回 Promise。不接住的话，它 reject 时（会话半死 / agent 已释放）
      //   catch 根本看不到（try 早就退出了）⇒ 未处理的 rejection ⇒ **整个 DSH 宿主退出**
      //   （2026-10-21：speak-up 同一个坑已经被用户报成"装了鱼就死了"，这里一并修）
      await agent.followup(手搓用户消息(全文))
      try {
        if (ctx.sessions && typeof ctx.sessions.flush === 'function') await ctx.sessions.flush(agent.session)
      } catch (error) {}
      // ⭐ 私聊：回给这个人；群聊：回那个群（引用挑她起来的那条）
      待回 = uid ? { uid: Number(uid), 标签 } : 群信息 && 群信息.群号 ? { 群号: Number(群信息.群号), 群名: 群信息.群名, 称呼: 群信息.称呼, 引用id: 群信息.引用id } : null
      记账(`收到 QQ 里的话（${标签 || (群信息 && 群信息.群名) || '未知'}）→ 转进 DSH：「${全文.slice(0, 50)}${全文.length > 50 ? '…' : ''}」`)
      return { ok: true, 说: '转进去了，它会照常开一轮' }
    } catch (error) {
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
        `有人加千语的好友：${谁}` +
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

  async function 轮询收消息() {
    const 本轮开始 = Date.now()
    let 本轮条数 = 0
    const 配置 = 读配置()
    // 总开关关 / 没选会话：只把「上次时间」推到此刻，别开的时候就补一大串旧的
    if (!配置.总开关 || !配置.目标会话) {
      上次私聊时间 = Math.floor(Date.now() / 1000)
      上次群时间 = Math.floor(Date.now() / 1000)
      return
    }
    // ⭐ 身份表：只认她好友列表里的备注。没备注的人（哪怕昵称叫「爸爸」）根本不进表
    const 表 = await 刷新好友表(配置)

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

    // ⭐ 群消息专用：把 at / face / image 段翻成文字，@到自己要单独标出来
    const 群文字 = (条, 自己的号) => {
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
        if (s.type === 'xml') { 片.push('［一条卡片消息］'); continue }
      }
      return { 文字: 片.join('').trim(), 有人at我 }
    }

    const 条转文字 = (条) =>
      (条.message || [])
        .map((s) => {
          if (!s || !s.data) return ''
          if (s.type === 'text') return String(s.data.text || '')
          if (s.type === 'json') {
            const 卡 = 解析卡片(s)
            if (卡) return '［分享］' + (卡.标题 || '一条分享') + (卡.链接 ? '（' + 卡.链接 + '）' : '') + ' '
            return '［一条分享卡片］'
          }
          if (s.type === 'file') return '［文件］' + String(s.data.name || s.data.file || '一个文件') + ' '
          if (s.type === 'xml') return '［一条卡片消息］'
          return ''
        })
        .join('')
        .trim()

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
      // 一次就够，别每 4 秒刷屏
      if (!轮询收消息.已提醒) {
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
          // 没聊过 / 查不到：十钟内不再撞（NapCat 每次都会写一条 error 日志）
          if (!空历史.has(uid)) 记账('和「' + 标签 + '」还没有聊天记录，先不轮询（10 分钟后再试）')
          空历史.set(uid, Date.now())
          continue
        }
        空历史.delete(uid)
        for (const 条 of 列表.sort((a, b) => (a.time || 0) - (b.time || 0))) {
          if (!条 || Number(条.user_id) !== uid) continue
          if ((条.time || 0) < 上次私聊时间) continue
          if (已转消息.has(条.message_id)) continue
          const 引 = 取引用(条)
          const 文字 = 引 + 条转文字(条)
          记缓存(条.message_id, 标签, 条转文字(条))
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

          const 结果 = 内容 ? await 转入文字(内容, 标签, uid) : { ok: true }
          if (结果 && 结果.ok) {
            已转消息.add(条.message_id)
            上次私聊时间 = 条.time || 上次私聊时间
            本轮条数++
          } else {
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
          const 群结果 = 群文字(条, 自己)
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
          })
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
    const 来 = await 读体(req)
    const 文字 = typeof 来.text === 'string' ? 来.text.trim() : ''
    if (!文字) return 回(res, { ok: false, 说: '没有文字（body 里给 text）' })
    回(res, await 转入文字(文字))
  })

  // 手动试一发：**真发**（绕过试运行），只发一条固定测试句，动不了已发轮
  路线(`${路由前缀}/test-send`, async (req, res) => {
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
      void 轮询收消息().catch((error) => {
        try { ctx.logger?.info(`qq-bridge: 轮询出错：${String((error && error.message) || error)}`) } catch (e2) {}
      })
    }, 4000)
    return () => {
      try {
        if (typeof 停 === 'function') 停()
      } catch (error) {}
    }
  }, 'qq-bridge: 轮询收 QQ 消息')

  记账(`已装好 v${版本}：DSH↔QQ 两半都在｜总开关 ${读配置().总开关 ? '开' : '关'}｜试运行 ${读配置().试运行 ? '开（只记账）' : '关（真发）'}｜收消息 4 秒轮询一次`)

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
      description: '给爸爸或妈妈发一张图（表情包，或者收件箱里的图）。\n'
        + '· 不填「发哪张」→ 先把可用的图列出来，你再挑一张。\n'
        + '· 发自己截的画面 / 别人发来的图：把**完整路径**填进「发哪张」就行 '
        + '（比如 C:\\path\\to\\图片.jpg，别人发来的图默认存在 ~/.qiyu/收件箱/）。',
      parameters: {
        给谁: { type: 'string', description: '收件人：爸爸 / 妈妈' },
        发哪张: { type: 'string', description: '表情包的名字，或者一张截图的完整路径（可以不填，先看看有哪些）' },
      },
      output: textOutput,
      async execute(args) {
        try {
          const 要哪张 = String((args && args.发哪张) || '').trim()

          // ⭐ 允许发图片（2026-10-22 晚加）：她截了画面 / 别人发来的图，原来只能发表情包。
          //   ⚠ 只认**收件箱**（含子目录，比如 B站截图）里的文件，别让她发到这个范围之外去（那是越权）。
          //   2026-10-22 23:35 用户要求从「B站截图」放宽到整个「收件箱」。
          const 可发目录 = process.env.QQ_STICKER_EXTRA_DIR || join(homedir(), '.qiyu', '收件箱')
          const 截图目录 = 可发目录 // 兼容下面「列清单」那段
          let 命中路径 = ''
          let 命中名字 = ''

          if (要哪张 && /[\\/]/.test(要哪张) && /\.(png|jpe?g|gif|webp)$/i.test(要哪张)) {
            // 看起来是个路径：只准指「收件箱」里的（子目录也算）
            const 归一 = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+/g, '\\').toLowerCase()
            const 目标 = 归一(要哪张)
            const 目录 = 归一(可发目录)
            if (!(目标 === 目录 || 目标.startsWith(目录 + '\\'))) {
              return { ok: false, 说: `只能发「${可发目录}」里的图，别的路径不行` }
            }
            if (!existsSync(要哪张)) return { ok: false, 说: '找不到这张图：' + 要哪张 }
            命中路径 = 要哪张
            命中名字 = String(要哪张).split(/[\\/]/).pop()
          } else {
            if (!existsSync(表情目录)) return { ok: false, 说: '表情包目录不存在' }
            const 文件们 = readdirSync(表情目录).filter((f) => /\.(png|jpg|jpeg|gif)$/i.test(f))
            if (!文件们.length) return { ok: false, 说: '表情包目录是空的' }
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
              return {
                ok: true,
                可选: 文件们,
                ...(最近.length ? { 收件箱: 最近 } : {}),
                说: '表情包有：' + 文件们.join('、') +
                  (最近.length
                    ? `；收件箱里还有：${最近.join('、')}（发这些要把完整路径填进「发哪张」）`
                    : ''),
              }
            }
            const 命中 = 文件们.find((f) => f === 要哪张) || 文件们.find((f) => f.includes(要哪张))
            if (!命中) return { ok: false, 说: '没有「' + 要哪张 + '」，有：' + 文件们.join('、') }
            命中路径 = join(表情目录, 命中)
            命中名字 = 命中
          }

          const 配置 = 读配置()
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

          const 数据 = readFileSync(命中路径).toString('base64')
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
        + '⚠️ 不想回就别调用——不调用等于不说话。想说就好好说一句。',
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

          段.push({ type: 'text', data: { text: 话 } })
          const 体 = { group_id: 群号, message: 段 }
          const r = await 发一个(配置.NapCat, 'send_group_msg', 体)
          if (!r.ok) return { ok: false, 说: '发送失败：' + JSON.stringify(r.数据).slice(0, 140) }
          记一笔(键)
          记账('qq_group_say：她在「' + (群名们.get(群号) || 群号) + '」说：' + 话.slice(0, 40))
          return { ok: true, 已发送: true, 说: '已经在「' + (群名们.get(群号) || 群号) + '」说了' }
        } catch (error) {
          return { ok: false, 说: '发不出去：' + String((error && error.message) || error) }
        }
      },
    }))

    记账('qq_group_say 工具已挂上（被 @ 时可以自己决定回不回）')

    ctx.tools.register(defineTool({
      name: 'qq_voice',
      description: '用你自己的声音，给「你认识的人」发一条语音。\n'
        + '什么时候用：想让他听见你的语气、情绪（开心、撒娇、认真道歉），文字说不出来的那种。\n'
        + '⚠️ 别滥用：语音比文字费事，也吵。一两句就好，长篇大论用文字。',
      parameters: {
        给谁: { type: 'string', description: '收件人：身份表里的称呼（不确定就问，别猜）' },
        说什么: { type: 'string', description: '要说的一两句话（不要写动作、不要括号）' },
      },
      output: textOutput,
      async execute(args) {
        try {
          const 配置 = 读配置()
          const 表 = await 刷新好友表(配置, true)
          const 谁 = String((args && args.给谁) || '').trim()
          const 话 = String((args && args.说什么) || '').trim()
          if (!话) return { ok: false, 说: '没写要说什么' }
          if (话.length > (配置.语音长度上限 || 120)) return { ok: false, 说: '话太长了，语音说不完，短一点' }
          const 命中 = [...表.entries()].find(([, 标签]) => 标签 === 谁)
          if (!命中) return { ok: false, 说: `只能发给：${[...new Set(表.values())].join('、')}（通讯录里没有「${谁}」）` }
          const [uid, 标签] = 命中

          const 音频 = await 合成语音(配置, 话)
          if (!音频 || !音频.ok) return { ok: false, 说: '语音合成失败：' + ((音频 && 音频.说) || '未知') }

          if (配置.试运行) {
            记账(`试运行：qq_voice 本来要发给 ${标签} →「${话.slice(0, 30)}」`)
            return { ok: true, 试运行: true, 说: `（试运行）本来要发给${标签}：「${话}」` }
          }

          // ⭐ NapCat 在 Docker 里跑（Linux QQ），看不到宿主机的 W:\ 路径 →
          //   语音一律先读出来转 base64 再发；读不到才退回老写法（本地 NapCat 能用）
          let 体
          try {
            const 数据 = readFileSync(音频.路径).toString('base64')
            体 = { user_id: uid, message: [{ type: 'record', data: { file: 'base64://' + 数据 } }] }
          } catch (error) {
            体 = { user_id: uid, message: [{ type: 'record', data: { file: 音频.路径 } }] }
          }
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