// qiyu preflight —— 装之前先看这台机器行不行。
//
// 跟 doctor 的分工：
//   preflight：环境本身（Node / Windows / WSL / 路径 / 空间 / 网络 / 杀软 / DSH / 模型 / Python）
//   doctor   ：装完之后跑起来没有（Docker / 容器 / 端口 / OneBot / 事件流 / 桥）
//
// 所以 preflight 在"只装了 DSH 的崭新电脑"上也能跑，不假设 Docker 存在。
import { execFileSync, spawn } from 'node:child_process'
import net from 'node:net'
import { existsSync, statfsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, release } from 'node:os'
import { createInterface } from 'node:readline'
import { 跑, 沙箱受限过 } from './run.mjs'

const 绿 = (s) => `\x1b[32m${s}\x1b[0m`
const 黄 = (s) => `\x1b[33m${s}\x1b[0m`
const 红 = (s) => `\x1b[31m${s}\x1b[0m`
const 灰 = (s) => `\x1b[90m${s}\x1b[0m`

function 端口通(端口, 超时 = 1500) {
  return new Promise((解决) => {
    const s = net.connect({ host: '127.0.0.1', port: 端口 })
    const 收 = (r) => {
      s.destroy()
      解决(r)
    }
    s.setTimeout(超时, () => 收(false))
    s.on('connect', () => 收(true))
    s.on('error', () => 收(false))
  })
}

function 能连(主机, 端口, 超时 = 2500) {
  return new Promise((解决) => {
    const s = net.connect({ host: 主机, port: 端口 })
    const 收 = (r) => {
      s.destroy()
      解决(r)
    }
    s.setTimeout(超时, () => 收(false))
    s.on('connect', () => 收(true))
    s.on('error', () => 收(false))
  })
}

/** 真发一个 HTTP 请求：registry 对裸 TCP 探测不友好，TCP 通不代表能拉镜像。 */
async function 能访问(url, 超时 = 5000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(超时) })
    return r.status < 500
  } catch {
    return false
  }
}

function 剩余GB(路径) {
  try {
    const s = statfsSync(路径)
    return Math.round((Number(s.bavail) * Number(s.bsize)) / 1024 / 1024 / 1024)
  } catch {
    return null
  }
}

// ---------------- 征得同意后能修的那几样 ----------------

function 问(题, 兜底 = 'n') {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((解决) => {
    rl.question(`${题} ${灰('[' + 兜底 + ']')} `, (答) => {
      rl.close()
      解决(String(答 || '').trim() || 兜底)
    })
  })
}

const 是同意 = (s) => /^(y|yes|是|好|行|要)/i.test(String(s).trim())

/** 谁占着这个端口：先问 docker，再问系统。 */
function 查占用(端口) {
  const 容器 = 跑('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}'], 8000)
  if (容器.ok) {
    for (const 行 of 容器.出.split(/\r?\n/)) {
      if (!行.includes('\t')) continue
      const [名, 端口串] = 行.split('\t')
      // 端口可能是范围（127.0.0.1:3000-3001->3000-3001/tcp），要展开
      const 命中 = []
      const re = /(?:\d{1,3}(?:\.\d{1,3}){3}|\[::\]):(\d+)(?:-(\d+))?->/g
      let m
      while ((m = re.exec(端口串 || ''))) {
        const a = Number(m[1])
        const b = m[2] ? Number(m[2]) : a
        for (let p = a; p <= b; p++) 命中.push(p)
      }
      if (命中.includes(端口)) return { 类型: '容器', 名, 说: `Docker 容器 ${名}` }
    }
  }
  const pid = 跑('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Get-NetTCPConnection -LocalPort ${端口} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess`,
  ], 12000)
  if (pid.ok && /^\d+/.test(pid.出)) {
    const p = pid.出.trim().split(/\s+/)[0]
    const 名 = 跑('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${p} -ErrorAction SilentlyContinue).ProcessName`], 12000)
    const 进程名 = 名.ok ? 名.出 : '?'
    // Docker 的端口代理进程：说明是容器占的，但没对上映射
    if (/docker/i.test(进程名)) {
      return { 类型: '未知', 名: '', 说: `Docker 端口代理（${进程名}，PID ${p}）——多半是某个容器，用 docker ps 看看` }
    }
    return { 类型: '进程', 名: p, 说: `进程 ${进程名}（PID ${p}）` }
  }
  return { 类型: '未知', 名: '', 说: '查不出来是谁（可能是系统服务）' }
}

async function 修端口(端口, 占用) {
  if (占用.类型 === '容器') {
    const 答 = await 问(`  要停掉容器 ${占用.名} 吗？（会中断它正在做的事）`)
    if (!是同意(答)) return false
    const r = 跑('docker', ['stop', 占用.名], 60000)
    console.log(r.ok ? 绿(`  ✓ 容器 ${占用.名} 已停`) : 红('  ✗ 停失败：' + r.错.slice(0, 120)))
    return r.ok
  }
  if (占用.类型 === '进程') {
    console.log(黄('  这是个普通进程，停它可能丢东西，我不替你按。'))
    console.log(灰(`  自己在任务管理器里结束 PID ${占用.名}，或者：Stop-Process -Id ${占用.名}`))
    return false
  }
  console.log(灰('  查不出来，先跳过。'))
  return false
}

const DockerDesktop候选 = [
  'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
  join(process.env.LOCALAPPDATA || '', 'Docker', 'Docker Desktop.exe'),
]

async function 修引擎() {
  const 答 = await 问('  要我帮你启动 Docker Desktop 吗？（会等引擎起来，最多两分钟）')
  if (!是同意(答)) return false
  const exe = DockerDesktop候选.find((p) => p && existsSync(p))
  if (!exe) {
    console.log(灰('  找不到 Docker Desktop.exe，你自己从开始菜单打开吧'))
    return false
  }
  console.log(灰('  正在启动…'))
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const v = 跑('docker', ['version', '--format', '{{.Server.Version}}'], 8000)
    if (v.ok) {
      console.log(绿(`  ✓ 引擎起来了：${v.出}`))
      return true
    }
    process.stdout.write(灰('.'))
  }
  console.log('')
  console.log(黄('  两分钟还没起来，去 Docker Desktop 界面看看是不是要登录/更新'))
  return false
}

async function 修Edge(py) {
  const 答 = await 问(`  要我装 edge-tts 吗？（${py} -m pip install edge-tts，只是她"说语音"要用）`)
  if (!是同意(答)) return false
  const r = 跑(py, ['-m', 'pip', 'install', 'edge-tts'], 180000)
  console.log(r.ok ? 绿('  ✓ edge-tts 装好了') : 红('  ✗ 装失败：' + (r.错 || '').slice(0, 160)))
  return r.ok
}

export async function preflight(选项 = {}) {
  const 修复 = Boolean(选项.修复) && Boolean(process.stdin.isTTY)
  const 结果 = []
  const 记 = (级别, 标题, 依据 = '', 怎么修 = '') => 结果.push({ 级别, 标题, 依据, 怎么修 })

  const 是Win = process.platform === 'win32'
  // 待修清单：每一项都先问再动
  const 待修 = []

  // ---------- 1. Node ----------
  const 版本 = process.versions.node
  const 大版本 = Number(版本.split('.')[0])
  if (大版本 >= 20) 记('ok', `Node ${版本}`)
  else 记('fail', `Node ${版本} 太旧`, '要 20 以上', '装 Node LTS：https://nodejs.org/（或 winget install OpenJS.NodeJS.LTS）')

  // ---------- 1.5 Docker（没装 / 没开） ----------
  const cli = 跑('docker', ['--version'], 12000)
  if (!cli.ok) {
    记(
      'fail',
      '这台机器上没有 Docker',
      'NapCat 只能跑在 Docker 里的 Linux QQ 上',
      '装 Docker Desktop：https://www.docker.com/products/docker-desktop/（勾 WSL2，装完重启电脑）／winget install -e --id Docker.DockerDesktop'
    )
  } else {
    const 引擎 = 跑('docker', ['version', '--format', '{{.Server.Version}}'], 15000)
    if (引擎.ok) {
      记('ok', `Docker 引擎 ${引擎.出}`)
    } else {
      记('fail', '装了 Docker，但引擎没起来', 引擎.错.slice(0, 120), '打开 Docker Desktop 等它启动（或让 preflight --fix 帮你起）')
      待修.push({ 名: '启动 Docker Desktop', 做: 修引擎 })
    }
  }

  // ---------- 2. Windows / WSL / 虚拟化 ----------
  if (是Win) {
    const 版本串 = release() // 10.0.26200
    const 段 = 版本串.split('.').map(Number)
    const build = 段[2] || 0
    if (build >= 19044) 记('ok', `Windows 版本 ${版本串}`)
    else 记('fail', `Windows 版本太旧（build ${build}）`, 'Docker Desktop 要求 Win10 2004+（build 19044+）或 Win11', '先升级系统')

    const wsl = 跑('wsl', ['--status'], 10000)
    if (wsl.ok) 记('ok', 'WSL 可用')
    else {
      const 列表 = 跑('wsl', ['-l', '-v'], 10000)
      if (列表.ok) 记('ok', 'WSL 可用')
      else 记('warn', '没检测到 WSL', 'Docker Desktop 默认用 WSL2 后端', '管理员 PowerShell 跑：wsl --install，然后重启电脑')
    }

    const 虚拟化 = 跑('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_ComputerSystem).HypervisorPresent'], 12000)
    if (虚拟化.ok && /True/i.test(虚拟化.出)) 记('ok', '虚拟化已启用')
    else 记('warn', '没确认到虚拟化/Hypervisor', 虚拟化.ok ? 虚拟化.出 : '', 'BIOS 里开 VT-x/AMD-V；或管理员跑：dism /online /enable-feature /featurename:VirtualMachinePlatform /all')
  } else {
    记('ok', `系统 ${process.platform}（Linux/macOS 直接装 Docker 即可）`)
  }

  // ---------- 3. 路径里有没有中文 ----------
  const 家 = homedir()
  if (/[^\x20-\x7E]/.test(家)) {
    记('warn', '用户目录里有非英文字符', 家, 'Docker 挂载中文路径在部分环境会失败；部署时用 --dir 指到纯英文路径（比如 D:\\qiyu\\napcat）')
  } else {
    记('ok', `用户目录：${家}`)
  }

  // ---------- 4. 磁盘 ----------
  const 盘们 = 是Win ? ['C:', 'D:', 'E:', 'F:'] : ['/']
  const 可用盘 = []
  for (const 盘 of 盘们) {
    const 根 = 是Win ? 盘 + '\\' : 盘
    if (!existsSync(根)) continue
    const g = 剩余GB(根)
    if (g === null) continue
    可用盘.push(`${盘} ${g}GB`)
  }
  const 系统盘 = 是Win ? 'C:\\' : '/'
  const 系统盘剩 = 剩余GB(系统盘)
  if (系统盘剩 !== null && 系统盘剩 < 10) {
    记('fail', `系统盘只剩 ${系统盘剩} GB`, 可用盘.join(' / '), 'Docker 镜像 + 数据要 5GB 起；先清点空间，或把 Docker 磁盘镜像挪到别的盘')
  } else {
    记('ok', `磁盘：${可用盘.join('  /  ')}`)
  }

  // ---------- 5. 端口 ----------
  const 占 = []
  const 占用们 = []
  for (const [叫法, 端口] of [['OneBot HTTP', 3000], ['OneBot WS', 3001], ['WebUI', 6099]]) {
    if (await 端口通(端口)) {
      占.push(`${端口}(${叫法})`)
      const o = 查占用(端口)
      占用们.push({ 端口, o })
    }
  }
  if (占.length) {
    记('warn', `这几个端口已经被占：${占.join('、')}`, 占用们.map((x) => `${x.端口} ← ${x.o.说}`).join('；'), '先停掉；容器可以让 --fix 帮你停')
    // 同一个容器占多个端口 → 只列一次
    const 已列 = new Map()
    for (const x of 占用们) {
      if (x.o.类型 === '容器') {
        if (!已列.has(x.o.名)) {
          已列.set(x.o.名, [])
          待修.push({ 名: `停掉容器 ${x.o.名}（占着这些端口）`, 做: () => 修端口(x.端口, x.o) })
        }
        已列.get(x.o.名).push(x.端口)
      } else {
        待修.push({ 名: `处理占着 ${x.端口} 的：${x.o.说}`, 做: () => 修端口(x.端口, x.o) })
      }
    }
    for (const [名, 端口们] of 已列) {
      const i = 待修.findIndex((t) => t.名.includes(名))
      if (i >= 0) 待修[i].名 = `停掉容器 ${名}（占着 ${端口们.join('、')}）`
    }
  } else {
    记('ok', '3000 / 3001 / 6099 都空着')
  }

  // ---------- 6. 网络（拉镜像要用） ----------
  const dockerHub = await 能访问('https://registry-1.docker.io/v2/')
  const github = await 能访问('https://github.com/')
  if (dockerHub && github) 记('ok', 'Docker Hub / GitHub 都能连')
  else if (!dockerHub)
    记(
      'warn',
      '宿主上连不上 Docker Hub',
      'Docker 内部走的是它自己的网络，可能仍然能拉；拉失败了再处理',
      '拉不动就配镜像加速：Docker Desktop → Settings → Docker Engine 里加 registry-mirrors'
    )
  else 记('warn', 'GitHub 连不上', '', '只影响下载 NapCat 发布包；用镜像站或代理')

  // ---------- 7. 杀软 ----------
  if (是Win) {
    const 杀软 = 跑('tasklist', ['/FO', 'CSV', '/NH'], 12000)
    if (杀软.ok) {
      const 命中 = ['HipsDaemon.exe', 'HipsTray.exe', '360Tray.exe', 'ZhuDongFangYu.exe', 'QQPCTray.exe'].filter((n) => 杀软.出.toLowerCase().includes(n.toLowerCase()))
      if (命中.length) 记('warn', `检测到安全软件：${命中.join('、')}`, '', '它可能拦 Docker 的本地端口或注入；出怪问题时先试着加白名单')
      else 记('ok', '没检测到常见的安全软件')
    }
  }

  // ---------- 8. DSH 本身 ----------
  const dsh家 = process.env.DSH_HOME || join(homedir(), '.dsh')
  if (existsSync(dsh家)) {
    const profile = join(dsh家, 'profiles', 'desktop')
    if (existsSync(join(profile, 'package.json'))) 记('ok', `DSH profile 在：${profile}`)
    else 记('warn', '没找到 desktop profile', profile, '先把 DSH 开起来一次，它会自己初始化 profile')
  } else {
    记('fail', '没找到 DSH 的家目录', dsh家, '这台机器上 DSH 装好了吗？至少先启动一次')
  }

  // ---------- 9. 模型凭证（不然她收得到消息、回不出来） ----------
  const 凭证 = join(dsh家, '.credentials.yaml')
  if (existsSync(凭证)) {
    const 文 = readFileSync(凭证, 'utf8')
    if (/deepseek/i.test(文)) 记('ok', '模型凭证在（deepseek）')
    else 记('warn', '凭证文件里没看到 deepseek', '', '去 DSH 设置里登录/填 key；否则她收得到消息也回不出来')
  } else {
    记('warn', '没找到模型凭证', 凭证, '先在 DSH 设置 → 账号与余额 里登录；否则消息进了会话也跑不动')
  }

  // ---------- 10. Python（语音） ----------
  const py候选 = [
    process.env.QIYU_PYTHON || '',
    join(dsh家, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
  ].filter(Boolean)
  let py = ''
  for (const p of py候选) if (p && existsSync(p)) { py = p; break }
  if (!py) {
    const 试 = 跑('python', ['--version'], 6000)
    if (试.ok) py = 'python'
  }
  if (!py) {
    记('warn', '没找到 Python', '', '只影响语音（说/听）；纯文字能跑。要语音就装 Python 3.10+')
  } else {
    const edge = 跑(py, ['-c', 'import edge_tts;print("ok")'], 15000)
    if (edge.ok) 记('ok', `Python 可用（${py}），edge-tts 已装`)
    else {
      记('warn', 'Python 有，但没装 edge-tts', '', `装：${py} -m pip install edge-tts（只用"说"才需要）`)
      待修.push({ 名: '装 edge-tts', 做: () => 修Edge(py) })
    }
  }

  // ---------- 沙箱兜底：读不到命令输出时，别把「没装」当成事实 ----------
  //
  // 受限沙箱不允许程序开管道，所有"跑条命令看输出"的判断都可能拿到空结果。
  // 这时把相关 fail 降级成 warn 并说清楚——否则 agent 会去让用户装一个已经装好的 Docker。
  if (沙箱受限过()) {
    let 降级了 = 0
    for (const x of 结果) {
      if (x.级别 !== 'fail') continue
      if (!/Docker|容器|端口|Python|WSL|虚拟化/.test(x.标题)) continue
      x.级别 = 'warn'
      x.标题 = '沙箱限制，这条不可信：' + x.标题
      x.怎么修 = '在用户自己的终端里跑 qiyu preflight 再确认一次；或者把这次会话提到 danger-full-access'
      降级了++
    }
    结果.push({
      级别: 'warn',
      标题: '当前沙箱读不到子进程输出',
      依据:
        '受限沙箱不允许程序开管道（stdio: pipe 会 EPERM）。qiyu 已改用"重定向到文件再读"兜底，' +
        '但个别命令仍可能失败，' + (降级了 ? `上面 ${降级了} 条结论已降级` : '') + '。',
      怎么修: '这类结论不能当真：让用户在自己终端跑一遍，或把会话权限提到 danger-full-access',
    })
  }

  // ---------- 输出 ----------
  const 坏 = 结果.filter((x) => x.级别 === 'fail').length
  const 疑 = 结果.filter((x) => x.级别 === 'warn').length
  let 坏数 = 坏

  // 给 agent 用的机器可读输出：别让模型去正则扒中文
  if (选项.只输出JSON) {
    const 输出 = {
      ok: 坏 === 0,
      统计: {
        好: 结果.filter((x) => x.级别 === 'ok').length,
        待看: 疑,
        不通: 坏,
      },
      结果: 结果.map((x) => ({ 级别: x.级别, 标题: x.标题, 依据: x.依据 || '', 怎么修: x.怎么修 || '' })),
      下一步: 坏 === 0 ? '可以往下走：init → deploy → install' : '先解决 fail 的项，再往下走',
    }
    console.log(JSON.stringify(输出, null, 2))
    return 坏 ? 1 : 0
  }

  console.log('')
  console.log('栖语栈 · 装之前先看这台机器')
  console.log('─'.repeat(52))
  for (const x of 结果) {
    const 图标 = x.级别 === 'ok' ? 绿('✅') : x.级别 === 'warn' ? 黄('⚠️ ') : 红('❌')
    console.log(`${图标} ${x.标题}`)
    if (x.依据) console.log('   ' + 灰(x.依据))
    if (x.怎么修) console.log('   ' + 灰('→ ' + x.怎么修))
  }
  console.log('─'.repeat(52))
  console.log(`${绿(结果.filter((x) => x.级别 === 'ok').length + ' 好')}　${黄(疑 + ' 待看')}　${红(坏 + ' 不通')}`)

  // ---------- 修：每一项都先问，说明动的是什么 ----------
  if (待修.length) {
    console.log('')
    if (!选项.修复) {
      console.log(灰('这些我能帮你处理（跑 qiyu preflight --fix，每一步会先问你）：'))
      for (const t of 待修) console.log(灰('  · ' + t.名))
    } else if (!process.stdin.isTTY) {
      console.log(黄('--fix 需要有人在场确认，非交互环境我不动手。下面是该做的：'))
      for (const t of 待修) console.log(灰('  · ' + t.名))
    } else {
      console.log(黄('下面这些可以我帮你做，每一样都会先问：'))
      let 已修 = 0
      for (const t of 待修) {
        console.log('')
        console.log(黄('· ' + t.名))
        try {
          if (await t.做()) 已修++
        } catch (错) {
          console.log(红('  失败：' + String(错.message || 错).slice(0, 160)))
        }
      }
      if (已修) {
        console.log('')
        console.log(绿(`修好了 ${已修} 项。重新跑一次 qiyu preflight 看结果。`))
        坏数 = 0 // 让下面别再说"先把❌解决掉"
      }
    }
  }

  console.log('')
  if (坏数 === 0) console.log(绿('可以往下走了：qiyu init → qiyu deploy'))
  else console.log(红('先把 ❌ 的解决掉，再往下走。'))
  console.log('')

  return 坏数 ? 1 : 0
}
