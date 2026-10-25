// qiyu doctor —— 一条命令把「她能不能说话」这件事查清楚。
//
// 每项都给三样东西：结论（✅/⚠️/❌）、依据、怎么修。
// 这里的检查项，全是踩过的坑：Docker / 容器 / 端口 / OneBot / 事件流 / 桥，
// 外加一条「模板里不许有别人的私人值」——这条是 dsh-bili-subagent 的 ownerName 教的。
import { execFileSync } from 'node:child_process'
import net from 'node:net'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 读配置 } from './config.mjs'
import { 跑, 沙箱受限过 } from './run.mjs'
import { 探测DSH } from './dsh-port.mjs'
import { 扫 } from './localization.mjs'
import { 模型齐了吗 } from './stt.mjs'

const 包根 = join(dirname(fileURLToPath(import.meta.url)), '..')

const 绿 = (s) => `\x1b[32m${s}\x1b[0m`
const 黄 = (s) => `\x1b[33m${s}\x1b[0m`
const 红 = (s) => `\x1b[31m${s}\x1b[0m`
const 灰 = (s) => `\x1b[90m${s}\x1b[0m`

function 端口通(主机, 端口, 超时 = 1500) {
  return new Promise((解决) => {
    const s = net.connect({ host: 主机, port: 端口 })
    const 收尾 = (r) => {
      s.destroy()
      解决(r)
    }
    s.setTimeout(超时, () => 收尾(false))
    s.on('connect', () => 收尾(true))
    s.on('error', () => 收尾(false))
  })
}

async function 请求(url, 选项 = {}) {
  const r = await fetch(url, { ...选项, signal: AbortSignal.timeout(选项.超时 || 6000) })
  const 文本 = await r.text()
  let json = null
  try {
    json = JSON.parse(文本)
  } catch {}
  return { 状态: r.status, json, 文本 }
}

export async function doctor({ 只输出JSON = false, 跳过WebSocket = false } = {}) {
  const 配置 = 读配置()
  const 结果 = []
  const 记 = (级别, 标题, 依据 = '', 怎么修 = '') => 结果.push({ 级别, 标题, 依据, 怎么修 })

  // ---------- 1. 运行环境 ----------
  const 版本 = process.versions.node
  if (Number(版本.split('.')[0]) >= 20) 记('ok', `Node ${版本}`)
  else 记('fail', `Node ${版本} 太旧`, '需要 20 以上', '装个新版本的 Node（20 或 22 都行）')

  if (process.platform === 'win32') {
    记(
      'warn',
      '这台是 Windows —— 别装 Windows 版 NapCat',
      'QQ 9.9.36 启动时会校验 package.json，改几个字节就报「文件已损坏」（实测）',
      '走 Docker 里的 Linux QQ：docker run -d --name ' + 配置.napcat.container + ' ...（见 docs/deployment.md）'
    )
  } else {
    记('ok', `系统 ${process.platform}`)
  }

  // ---------- 2. Docker（分清：没装 / 装了没开） ----------
  const dockerCli = 跑('docker', ['--version'], 10000)
  let dockerOk = false
  if (!dockerCli.ok) {
    记(
      'fail',
      '这台机器上没有 Docker',
      'NapCat 只能跑在 Docker 里的 Linux QQ 上（Windows 版会被 QQ 的文件校验拦下）',
      '装 Docker Desktop：https://www.docker.com/products/docker-desktop/（安装勾 WSL2，装完重启电脑；或 winget install -e --id Docker.DockerDesktop）'
    )
  } else {
    const docker = 跑('docker', ['version', '--format', '{{.Server.Version}}'])
    if (docker.ok) {
      dockerOk = true
      记('ok', `Docker 引擎 ${docker.出}`)
    } else {
      记('fail', '装了 Docker，但引擎没起来', docker.错.slice(0, 160), '打开 Docker Desktop，等左下角显示引擎已启动；权限问题就用管理员身份启动一次')
    }
  }

  // ---------- 3. 容器 ----------
  if (dockerOk) {
    const 名 = 配置.napcat.container
    const 状态 = 跑('docker', ['inspect', 名, '--format', '{{.State.Status}}'])
    if (状态.ok) {
      if (状态.出 === 'running') 记('ok', `容器 ${名} 在跑`)
      else 记('fail', `容器 ${名} 状态是 ${状态.出}`, '', `docker start ${名}`)
    } else {
      记(
        'fail',
        `没有容器 ${名}`,
        '',
        `按 docs/deployment.md 里的 docker run 起一个；或者改 qiyu.config.json 的 napcat.container`
      )
    }
  }

  // ---------- 4. 端口 ----------
  const 端口们 = [
    ['OneBot HTTP', 3000],
    ['OneBot WS', 3001],
    ['NapCat WebUI', 6099],
  ]
  for (const [叫法, 端口] of 端口们) {
    const 通 = await 端口通('127.0.0.1', 端口)
    if (通) 记('ok', `${叫法} 端口 ${端口} 在听`)
    else
      记(
        'fail',
        `${叫法} 端口 ${端口} 没人听`,
        '容器没起、或者容器里 OneBot 没启用这个端口',
        '看 docker logs --tail 80 ' + 配置.napcat.container
      )
  }

  // ---------- 5. OneBot ----------
  let 登录信息 = null
  if (await 端口通('127.0.0.1', 3000)) {
    try {
      const 头 = { 'content-type': 'application/json' }
      if (配置.napcat.token) 头.authorization = 'Bearer ' + 配置.napcat.token
      const r = await 请求(配置.napcat.http + '/get_login_info', { method: 'POST', headers: 头, body: '{}' })
      if (r.json && r.json.status === 'ok' && r.json.data && r.json.data.user_id) {
        登录信息 = r.json.data
        记('ok', `OneBot 通了：${r.json.data.nickname}（${r.json.data.user_id}）`)
      } else if (r.状态 === 401 || (r.json && r.json.retcode === 401)) {
        记('fail', 'OneBot 拒绝：令牌不对', JSON.stringify(r.json || r.文本).slice(0, 120), '把令牌配进 qiyu.config.json 的 napcat.token，或设环境变量 QIYU_ONEBOT_TOKEN')
      } else if (r.json && r.json.status === 'failed') {
        记('warn', 'OneBot 在，但还没登录 QQ', JSON.stringify(r.json).slice(0, 160), '用 WebUI 扫码：' + 配置.napcat.webui)
      } else {
        记('warn', 'OneBot 回应看不懂', JSON.stringify(r.json || r.文本).slice(0, 160), '')
      }
    } catch (错) {
      记('fail', 'OneBot HTTP 调不通', String(错.message || 错), '看容器日志；端口通了但接口没起来通常是 OneBot 配置没启用')
    }
  }

  // ---------- 6. 事件流（WS） ----------
  if (!跳过WebSocket && typeof WebSocket === 'function' && 登录信息) {
    const 地址 = 配置.napcat.wsToken
      ? 配置.napcat.ws + (配置.napcat.ws.includes('?') ? '&' : '?') + 'access_token=' + 配置.napcat.wsToken
      : 配置.napcat.ws
    const 结果2 = await new Promise((解决) => {
      let 已解决 = false
      const 收 = (r) => {
        if (已解决) return
        已解决 = true
        解决(r)
      }
      try {
        const ws = new WebSocket(地址)
        const 超时 = setTimeout(() => {
          try {
            ws.close()
          } catch {}
          收({ ok: false, 说: '5 秒没连上' })
        }, 5000)
        ws.addEventListener('open', () => {
          clearTimeout(超时)
          try {
            ws.close()
          } catch {}
          收({ ok: true })
        })
        ws.addEventListener('error', () => {
          clearTimeout(超时)
          收({ ok: false, 说: '握手失败（多半是令牌不对）' })
        })
      } catch (错) {
        收({ ok: false, 说: String(错.message || 错) })
      }
    })
    if (结果2.ok) 记('ok', '事件流（正向 WS）能连上')
    else 记('fail', '事件流连不上', 结果2.说, '检查 napcat.ws / napcat.wsToken；端口 3001 要是正向 WS 服务端')
  }

  // ---------- 7. DSH 桥 ----------
  //
  // DSH 的端口每次启动可能变，不能只信 qiyu.config.json 里的快照。
  // 先试配置端口，再扫本机监听端口，按特征认（见 src/dsh-port.mjs）。
  const 探测 = await 探测DSH({ 已知端口: 配置.dsh.port })
  if (!探测) {
    if (配置.dsh.port) {
      记(
        'warn',
        `DSH 端口 ${配置.dsh.port} 没人听，也没自动找到`,
        'DSH 可能没开，或者端口变了',
        '先把 DSH 开起来再跑一次；开了还找不到，设环境变量 QIYU_DSH_PORT'
      )
    } else {
      记('skip', '跳过 DSH 桥检查（没找到运行中的 DSH）', 'DSH 的端口每台机器都不一样，所以默认不猜', '把 DSH 开起来再跑一次；或者设 QIYU_DSH_PORT')
    }
  } else if (!探测.有桥) {
    记('warn', `DSH 在 ${探测.端口}，但没看到 dsh-qq-bridge`, '', '确认 DSH 里装了 dsh-qq-bridge 插件')
  } else {
    try {
      const r = await 请求(`http://127.0.0.1:${探测.端口}/dsh-qq-bridge/state`)
      const j = r.json
      if (j && j.配置) {
        const 状 = j.NapCat状态
        const 注 = 探测.来源 === '自动探测' ? `DSH 端口 ${探测.端口} 是自动探测到的（配置里写的是 ${配置.dsh.port || '空'}）` : ''
        if (状 && 状.用户) 记('ok', `DSH 桥认到：${状.昵称}（${状.用户}）`, 注)
        else if (状) 记('warn', 'DSH 桥连不上 NapCat', JSON.stringify(状).slice(0, 160), '桥的 NapCat 地址/令牌和 qiyu.config.json 要一致')
        else 记('warn', 'DSH 桥没有 NapCat 状态', '', '桥的 NapCat 地址/令牌和 qiyu.config.json 要一致')

        // ⭐ 桥连上 NapCat ≠ 能把消息送进会话。
        //    目标会话为空时，桥收到 QQ 消息只会记一句「还没填目标会话，这轮不转」，直接丢掉。
        if (!j.配置.目标会话) {
          记(
            'fail',
            '桥还没选「目标会话」',
            '收到 QQ 消息也不知道该送进哪个会话，会直接丢掉',
            '设置 → 通到 QQ → 目标会话：选她的会话（工作目录是 characters/<名字> 的那个）'
          )
        } else if (!Array.isArray(j.目标情况) || !j.目标情况.length) {
          记(
            'warn',
            '「目标会话」配了，但现在没开着',
            `桥报 目标情况=[]（配置里是 ${String(j.配置.目标会话).slice(0, 20)}…）：会话没打开 / 归档了 / DSH 刚重启还没恢复`,
            '在 DSH 里打开那个会话（左栏点一下）；归档了就取消归档。打开后重跑一次 doctor，这条应当变 ok'
          )
        } else {
          记('ok', `目标会话：${j.目标情况[0].标题 || j.配置.目标会话}`)
        }

        if (j.配置.总开关 !== true) 记('warn', '总开关关着：她收不到也发不出', '消息进不了、也出不去', '设置 → 通到 QQ → 打开「总开关」')
        if (j.配置.试运行 === true) 记('warn', '试运行开着：不会真的发到 QQ', '', '确认没问题后，在设置里把「试运行」关掉')

        // ⭐ 护栏（dsh-qq-guard）：装了就说清它在哪一档 —— dry 只记账，enforce 才真拦
        try {
          const 护栏路径 = join(process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'), 'qq-guard-config.json')
          if (existsSync(护栏路径)) {
            const 栏 = JSON.parse(readFileSync(护栏路径, 'utf8').replace(/^\uFEFF/, '')) || {}
            if (栏.开关 === false) {
              记('warn', '护栏关着（qq-guard 的开关是 false）', '群里的「跑一下命令 / 改设定」不会有人拦', '把 ~/.dsh/qq-guard-config.json 的「开关」改回 true（热生效，不用重启）')
            } else if (String(栏.模式) !== 'enforce') {
              记('warn', '护栏在干跑（dry）：只记账，不拦', '群里的话现在拦不住，只会写进 ~/.dsh/qq-guard.log', '先看一天日志、确认「本该拒绝」的清单对；没问题就把「模式」改成 enforce（热生效）')
            } else {
              记('ok', '护栏：群轮次真拦（enforce）')
            }
          }
        } catch (error) {}

        // ⭐ 2026-10-25：心情 / 作息 的「目标会话」跟桥对得上吗？
        //   实测：桥和会话都对，心情却还挂在上一轮部署的旧会话上 —— doctor 0 fail，
        //   但心情永远不涨。所以单独比一次（两边都认 `session-` 前缀带不带）。
        try {
          const 短 = (x) => String(x || '').replace(/^session-/, '')
          const 桥目标 = 短(j.配置.目标会话)
          const 家目录 = process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh')
          const 各管 = [
            ['心情', join(家目录, 'feiyu-mood', 'config.json')],
            ['主动搭话', join(家目录, 'speak-up-config.json')],
          ]
          for (const [名, 路径] of 各管) {
            if (!existsSync(路径)) continue
            let c = {}
            try {
              c = JSON.parse(readFileSync(路径, 'utf8').replace(/^\uFEFF/, '')) || {}
            } catch (error) {
              continue
            }
            const 它 = 短(c.targetSession || c.目标会话)
            if (!它) {
              记('warn', `${名}没选「目标会话」`, `${路径} 里 targetSession 是空的，它不会挂到任何会话`, `在设置里给「${名}」选一个会话（选跟桥同一个）`)
            } else if (桥目标 && 它 !== 桥目标) {
              记('warn', `${名}挂到了别的会话`, `它指向 ${它.slice(0, 12)}…，桥的「目标会话」是 ${桥目标.slice(0, 12)}…（常见于重装后没清旧配置）`, `把「${名}」的目标会话改成跟桥一致，或删掉 ${路径} 让它重建`)
            } else {
              记('ok', `${名}：跟桥同一个会话`)
            }
          }
        } catch (error) {}

        // ⭐ 语音转写：可选功能，但没装的话收到语音只会回「没听清（模型缺失）」
        try {
          const 家目录 = process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh')
          const 转写脚本 = join(家目录, 'qiyu', '语音转写.py')
          if (existsSync(转写脚本) && !模型齐了吗()) {
            记(
              'warn',
              '语音转写没装（可选）',
              '模型不在 ' + join(家目录, 'qiyu', 'models') + '，收到语音只会回「没听清（模型缺失）」。文字收发不受影响',
              '要用就装一次：npx dsh-qiyu-stack stt（约 226MB 模型 + Python 依赖）',
            )
          }
        } catch (error) {}

        // ⭐ 身份：桥只认「好友备注以身份表前缀开头」的人；对不上的消息会被静默丢掉。
        const 身份表 = Array.isArray(j.配置.身份表) ? j.配置.身份表.filter((r) => r && r.备注前缀) : []
        const 好友表 = Array.isArray(j.好友表) ? j.好友表 : []
        if (!身份表.length) {
          记(
            'warn',
            '还没设「她该怎么称呼你」',
            '身份表是空的：QQ 里谁来都不认，消息会被直接丢掉',
            '在角色包的 character.json 里填 称呼.主人；或在设置里给身份表加一条'
          )
        } else if (!好友表.length) {
          记(
            'warn',
            '身份表在，但一个好友都认不出',
            `她的好友备注里没有以「${身份表[0].备注前缀}」开头的（备注不匹配的人，消息会被静默丢掉）`,
            状 && 状.用户
              ? `去她的 QQ 里把你自己备注成「${身份表[0].备注前缀}」开头，刷新好友列表后再跑一次`
              : '桥连上 NapCat 后会重新拉好友列表；先去她的 QQ 里把备注改好'
          )
        } else {
          记('ok', `身份认得：${好友表.map((f) => f.标签 || f.uid).join('、')}`)
        }
      } else {
        记('warn', `DSH 在 ${探测.端口}，但没看到 dsh-qq-bridge`, '', '确认 DSH 里装了 dsh-qq-bridge 插件')
      }
    } catch (错) {
      记('warn', 'DSH 桥查不到', String(错.message || 错), '')
    }
  }

  // 给 JSON 输出用：探测到的端口优先，没探测到就退回配置里的值
  const 桥端口 = 探测 ? 探测.端口 : Number(配置.dsh.port) || 0

  // ---------- 7.5 部署路径体检 ----------
  if (配置.napcat && 配置.napcat.dataDir) {
    const 目录 = String(配置.napcat.dataDir)
    if (/[^\x20-\x7E]/.test(目录)) {
      记('warn', '部署路径里有非英文字符', 目录, 'Docker 挂载中文路径在部分环境会失败；建议换纯英文目录：qiyu deploy --dir <路径>')
    } else {
      记('ok', `数据目录：${目录}`)
    }
  }

  // ---------- 7.6 栖语的代码 vs 正在跑的那份，是不是同一份 ----------
  //
  // 2026-10-23 踩过：拆语音时 runtime 里 host.js 加了 import './voice.mjs'，
  // 但同步到已装副本时只拷了 host.js —— 插件 import 失败、整个桥没挂上，
  // 表现却是「QQ 突然不说话了」，很难查。
  try {
    const 模块们 = [
      ['bridge', 'dsh-qq-bridge'],
      ['guard', 'dsh-qq-guard'],
      ['memory', 'dsh-fish-memory'],
      ['mood', 'dsh-feiyu-mood'],
      ['rhythm', 'dsh-speak-up'],
      ['bili', 'dsh-bili-subagent'],
      ['forget', 'dsh-forget'],
      ['panel', 'dsh-qiyu-panel'],
    ]
    const 问题 = []
    for (const [目录名, 包名] of 模块们) {
      const 源 = join(包根, 'runtime', 目录名, 'lib')
      const 目标 = join(配置.dsh && 配置.dsh.profileDir ? 配置.dsh.profileDir : join(process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'), 'profiles', 'desktop'), 'node_modules', 包名, 'lib')
      if (!existsSync(源) || !existsSync(目标)) continue
      for (const f of readdirSync(源)) {
        if (!f.endsWith('.js') && !f.endsWith('.mjs')) continue
        const t = join(目标, f)
        if (!existsSync(t)) {
          问题.push(`${目录名}/${f}（已装副本里没有）`)
          continue
        }
        const 甲 = readFileSync(join(源, f))
        const 乙 = readFileSync(t)
        if (Buffer.compare(甲, 乙) !== 0) 问题.push(`${目录名}/${f}（内容不同）`)
      }
    }
    if (!问题.length) 记('ok', '栖语的运行时代码和正在跑的那份一致')
    else 记('warn', '运行时代码两边不一样', 问题.slice(0, 4).join('、') + (问题.length > 4 ? ` 等 ${问题.length} 处` : ''), '先看方向：仓库比真机新 → 跑 `qiyu install` 同步（会先备份）；真机比仓库新 → 先把改动回灌进仓库，别用 --force 把新补丁盖成旧的；只差注释/文案可以忽略')
  } catch (错) {
    记('skip', '没能比对运行时代码', String(错.message || 错))
  }

  // ---------- 8. 本地化体检：作者机器上的东西不许进 runtime / 模板 ----------
  //
  // ⚠ 以前只扫 templates/ —— 而真正漏出去的是 runtime/ 里的代码
  //   （0.15.8 发到 npm 上的「有人加千语的好友」就是这么漏的）。
  //   规则和 `tools/扫本地化.mjs` 共用 src/localization.mjs 一份。
  try {
    const 扫的 = ['templates', 'runtime', 'examples'].map((d) => resolve(包根, d)).filter((p) => existsSync(p))
    const { 命中, 文件数 } = 扫(扫的)
    if (命中.length) {
      const 例 = 命中.slice(0, 4).map((h) => `${h.文件}:${h.行}（${h.规则}）`)
      记(
        'warn',
        '代码/模板里有本地化内容',
        例.join('；') + (命中.length > 4 ? ` 等 ${命中.length} 处` : ''),
        '作者机器上的路径 / 角色名 / 号码 / 会话 id / 凭证不许进仓库：把默认值留空，或改成读 character.json。跑 `node tools/扫本地化.mjs` 看全部',
      )
    } else {
      记('ok', `本地化体检通过：${文件数} 个文件里没有别人的私人值`)
    }
  } catch (错) {
    记('skip', '跳过本地化体检', String(错.message || 错))
  }

  // ---------- 沙箱兜底：读不到子进程输出时，别把「没装/没起」当成事实 ----------
  //
  // 受限沙箱不允许程序开管道，所有"跑条命令看输出"的判断都可能拿到空结果。
  // 这时把 Docker / 容器 / 端口相关的 fail 降级成 warn——否则 agent 会把
  // 「验收标准：不通必须为 0」理解成"装失败了"，去修一台根本没坏的机器。
  if (沙箱受限过()) {
    let 降级了 = 0
    for (const x of 结果) {
      if (x.级别 !== 'fail') continue
      if (!/Docker|引擎|容器|端口/.test(x.标题)) continue
      x.级别 = 'warn'
      x.标题 = '沙箱限制，这条不可信：' + x.标题
      x.怎么修 = '在用户自己的终端里跑 qiyu doctor 再确认一次；或者把这次会话提到 danger-full-access'
      降级了++
    }
    if (降级了) {
      结果.push({
        级别: 'warn',
        标题: '当前沙箱读不到子进程输出',
        依据:
          '受限沙箱不允许程序开管道（stdio: pipe 会 EPERM）。qiyu 已改用"重定向到文件再读"兜底，' +
          '但个别命令仍可能失败，上面 ' + 降级了 + ' 条结论已降级。',
        怎么修: '这类结论不能当真：让用户在自己终端跑一遍，或把会话权限提到 danger-full-access',
      })
    }
  }

  // ---------- 输出 ----------
  const 有失败 = 结果.some((x) => x.级别 === 'fail')

  if (只输出JSON) {
    console.log(JSON.stringify({ 配置: { http: 配置.napcat.http, container: 配置.napcat.container, dsh: 桥端口 }, 结果, 有失败 }, null, 2))
    return 有失败 ? 1 : 0
  }

  console.log('')
  console.log('栖语栈自检')
  console.log('─'.repeat(52))
  for (const x of 结果) {
    const 图标 = x.级别 === 'ok' ? 绿('✅') : x.级别 === 'warn' ? 黄('⚠️ ') : x.级别 === 'skip' ? 灰('– ') : 红('❌')
    console.log(`${图标} ${x.标题}`)
    if (x.依据) console.log('   ' + 灰(x.依据))
    if (x.怎么修) console.log('   ' + 灰('→ ' + x.怎么修))
  }
  console.log('─'.repeat(52))

  const 好 = 结果.filter((x) => x.级别 === 'ok').length
  const 疑 = 结果.filter((x) => x.级别 === 'warn').length
  const 坏 = 结果.filter((x) => x.级别 === 'fail').length
  console.log(`${绿(好 + ' 好')}　${黄(疑 + ' 待看')}　${红(坏 + ' 不通')}`)
  if (坏 === 0) console.log(绿('她应该能说话了。'))
  else console.log(红('先把上面 ❌ 的修掉；每一条后面都写了怎么修。'))
  console.log('')

  return 有失败 ? 1 : 0
}
