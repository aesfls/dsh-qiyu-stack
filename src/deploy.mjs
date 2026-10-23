// qiyu deploy —— 一条命令把 NapCat 起起来：建目录、写 OneBot 配置、跑容器、出二维码。
//
// 这里的每一个参数，都是从一台真跑着的机器上抄下来的（不是照文档猜的）：
//   · 必须用 Docker 里的 Linux QQ（Windows 版会被 QQ 的 package.json 校验拦下）
//   · 三个挂载点缺一个，重启就丢登录态 / 丢配置
//   · 手机确认登录时要勾「下次登录无需确认」，否则每次重启容器都要人点
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, statfsSync, cpSync, readdirSync, renameSync } from 'node:fs'
import { join, resolve, parse as 解析路径 } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { 读配置, 配置文件路径 } from './config.mjs'
import { 打开文件 } from './qr.mjs'
import { 确保引擎, 引擎版本 } from './docker.mjs'

const 绿 = (s) => `\x1b[32m${s}\x1b[0m`
const 黄 = (s) => `\x1b[33m${s}\x1b[0m`
const 红 = (s) => `\x1b[31m${s}\x1b[0m`
const 灰 = (s) => `\x1b[90m${s}\x1b[0m`

function 跑(命令, 参数, 超时 = 60000) {
  try {
    const 出 = execFileSync(命令, 参数, { timeout: 超时, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, 出: String(出).trim() }
  } catch (错) {
    return { ok: false, 错: String((错 && (错.stderr || 错.message)) || 错).trim() }
  }
}

async function 端口通(端口, 超时 = 1200) {
  const net = await import('node:net')
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

const 新令牌 = (前缀 = '') => 前缀 + randomBytes(20).toString('hex')

// ---------- 部署位置 ----------

function 问(题, 兜底 = '') {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((解决) => {
    const 提示 = 兜底 ? `${题} ${灰('[' + 兜底 + ']')} ` : `${题} `
    rl.question(提示, (答) => {
      rl.close()
      解决(String(答 || '').trim() || 兜底)
    })
  })
}

function 剩余GB(盘) {
  try {
    const s = statfsSync(盘)
    return Math.round((Number(s.bavail) * Number(s.bsize)) / 1024 / 1024 / 1024)
  } catch {
    return null
  }
}

/** 当前角色叫什么：配置里记的 > characters/ 下唯一那个 > 空（退回"她"）。 */
function 找角色名(配置) {
  if (配置 && 配置.角色) return String(配置.角色).trim()
  try {
    const 根 = join(process.cwd(), 'characters')
    if (existsSync(根)) {
      const 目录们 = readdirSync(根, { withFileTypes: true }).filter((d) => d.isDirectory())
      if (目录们.length === 1) return 目录们[0].name
    }
  } catch {}
  return ''
}

/** 挑一个"看起来合适"的默认位置：优先非系统盘里空间最大的，其次用户目录。 */
function 建议默认目录() {
  const 候选 = []
  for (const 字母 of ['D', 'E', 'F']) {
    const 盘 = 字母 + ':\\'
    if (!existsSync(盘)) continue
    const g = 剩余GB(盘)
    if (g !== null && g > 20) 候选.push({ 盘, g })
  }
  候选.sort((a, b) => b.g - a.g)
  if (候选.length) return join(候选[0].盘, 'qiyu', 'napcat')
  return join(homedir(), 'qiyu', 'napcat')
}

/** 路径体检：中文/空格/剩余空间。返回是否继续。 */
async function 检查路径(目录, 交互) {
  let 继续 = true
  if (/[^\x20-\x7E]/.test(目录)) {
    console.log(黄('⚠ 路径里有非英文字符（中文等）'))
    console.log(灰('  Docker 挂载这类路径在部分 Windows 环境会失败（容器起来但看不到配置文件）。'))
    console.log(灰('  建议换成纯英文路径，比如 ' + 建议默认目录()))
    if (交互) 继续 = /^y/i.test(await 问('  还是要用这个路径吗？(y/N)', 'n'))
    else 继续 = false
  }
  if (/\s/.test(目录)) {
    console.log(黄('⚠ 路径里有空格'))
    console.log(灰('  我们传参是数组形式的，一般没事；但换别的方式跑脚本可能会被截断。'))
  }
  const 盘 = 解析路径(resolve(目录)).root
  const g = 剩余GB(盘)
  if (g !== null) {
    console.log(灰(`  ${盘} 剩余 ${g} GB`))
    if (g < 5) {
      console.log(红(`✗ ${盘} 只剩 ${g} GB，不够（镜像约 1 GB + 数据会慢慢长）`))
      继续 = false
    } else if (g < 15) {
      console.log(黄('⚠ 空间偏紧，先留意着'))
    }
  }
  return 继续
}

function 文件数(目录) {
  let n = 0
  const 走 = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) 走(join(d, e.name))
      else n++
    }
  }
  走(目录)
  return n
}

/** 把旧数据目录整个搬到新位置，验完才把旧的改名留底。 */
function 搬数据(旧, 新) {
  console.log(灰(`  正在搬：${旧} → ${新}`))
  mkdirSync(新, { recursive: true })
  cpSync(旧, 新, { recursive: true })
  const 旧数 = 文件数(旧)
  const 新数 = 文件数(新)
  console.log(灰(`  旧 ${旧数} 个文件 / 新 ${新数} 个`))
  if (新数 < 旧数) {
    console.log(红('✗ 拷贝后文件变少了，先别删旧的'))
    return false
  }
  const 留底 = 旧 + '.old-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  renameSync(旧, 留底)
  console.log(绿('✓') + ` 搬完了；旧目录改名为 ${留底.split(/[\\/]/).pop()}（确认没问题可以删）`)
  return true
}

/** 决定数据目录：问、检查、必要时标记"要搬"。真正搬放在端口检查之后。 */
async function 决定目录(选项, 配置, 干跑) {
  const 旧 = 配置.napcat && 配置.napcat.dataDir ? resolve(配置.napcat.dataDir) : ''
  const 交互 = Boolean(process.stdin.isTTY)
  const 建议 = 建议默认目录()

  let 目标 = 选项.目录 ? resolve(选项.目录) : ''
  if (!目标) {
    console.log(灰('数据放哪儿？（配置、登录态、插件都会在这里）'))
    if (交互) {
      目标 = resolve(await 问('  部署目录', 建议))
    } else {
      目标 = 建议
      console.log(灰(`  用默认：${目标}（要改加 --dir <路径>）`))
    }
  }

  console.log('')
  console.log(黄('— 位置 —'))
  console.log(灰(`数据目录：${目标}`))

  // 换了位置，而旧位置有数据 → 必须问清楚，不能两处各存一半
  let 待搬 = ''
  if (旧 && 旧 !== 目标 && existsSync(旧)) {
    console.log('')
    console.log(黄('⚠ 之前的数据在另一个目录：'))
    console.log(灰(`  旧：${旧}`))
    console.log(灰(`  新：${目标}`))
    if (选项.搬) {
      待搬 = 旧
    } else if (交互 && (await 问('  把旧数据搬到新位置吗？(y/N)', 'n')).toLowerCase().startsWith('y')) {
      待搬 = 旧
    } else {
      console.log('')
      console.log(红('✗ 先别继续 —— 两处各存一份会很难查'))
      console.log(灰('  要么接着用旧的：  --dir "' + 旧 + '"'))
      console.log(灰('  要么搬过去：      --move（或加 --dir 到新位置时回答 y）'))
      return null
    }
  }

  const 可以 = await 检查路径(目标, 交互)
  if (!可以) {
    console.log(红('✗ 这个位置先不用'))
    return null
  }

  // C 盘最大的坑其实不是我们这些文件，是 Docker 自己的磁盘镜像
  if (解析路径(目标).root.toLowerCase().startsWith('c:')) {
    console.log(黄('⚠ 数据放在 C 盘'))
    console.log(灰('  另外：Docker 的磁盘镜像（几个 GB，镜像 + 容器数据）默认也在 C 盘，'))
    console.log(灰('  那才是 C 盘真正的大头。要挪它：Docker Desktop → Settings → Resources → Disk image location。'))
  }

  if (!干跑) mkdirSync(目标, { recursive: true })
  return { 目录: 目标, 待搬 }
}

export async function deploy(选项 = {}) {
  const 配置 = 读配置()
  const 容器名 = 选项.名字 || 配置.napcat.container || 'napcat-qq'
  const 镜像 = 选项.镜像 || 'mlikiowa/napcat-docker:latest'
  const QQ号 = String(选项.qq || '').trim()
  const 干跑 = Boolean(选项.干跑)
  const 角色名 = 找角色名(配置)

  console.log(黄('— qiyu deploy —'))
  console.log(灰(`容器：${容器名}　镜像：${镜像}`))
  console.log('')

  // ---------- 1. Docker（分清楚：没装 / 装了没开）—— 先查这个，没装就别问位置了 ----------
  const cli = 跑('docker', ['--version'], 12000)
  if (!cli.ok) {
    console.log(红('✗ 这台机器上没有 Docker'))
    console.log('')
    console.log('  为什么必须要它：')
    console.log(灰('    NapCat 得跑在 Docker 里的 Linux QQ 上。Windows 版 NapCat 会被'))
    console.log(灰('    QQ 自己的文件校验拦下（实测：改几个字节就报「文件已损坏」），那条路走不通。'))
    console.log('')
    console.log('  Windows 上装 Docker Desktop：')
    console.log(灰('    1. 打开 https://www.docker.com/products/docker-desktop/ 下载'))
    console.log(灰('    2. 安装时勾上 WSL2 组件（Windows 需要 WSL2；没有的话先 wsl --install）'))
    console.log(灰('    3. 装完重启这台电脑（是电脑，不是 DSH）'))
    console.log(灰('    4. 打开 Docker Desktop，等左下角状态变成引擎已启动'))
    console.log(灰('    5. 回来重跑 qiyu deploy'))
    console.log('')
    console.log(灰('  也可以用命令行装：winget install -e --id Docker.DockerDesktop'))
    console.log(灰('  空间：Docker + 镜像大约 3–5 GB，别全塞 C 盘（见下一步的位置选择）。'))
    console.log('')
    console.log(灰('  如果你有一台 Linux 服务器：可以在那边装 NapCat，再让这里的桥连过去——'))
    console.log(灰('  但 qiyu deploy 目前只支持本机 Docker。'))
    return 1
  }

  // 引擎没起来就悄悄拉一次（不弹窗）；已经在跑就绝不碰 Docker Desktop.exe
  // （引擎在跑的时候再执行那个 exe 会 show-dashboard —— 用户会看到一个莫名其妙的窗口）
  const 起来 = await 确保引擎({ 说: (s) => console.log(灰('  ' + s)) })
  const docker = { ok: 起来, 出: 起来 ? await 引擎版本() : '' }
  if (!docker.ok) {
    console.log(红('✗ 装了 Docker，但引擎没起来'))
    console.log('')
    console.log(灰('  打开 Docker Desktop（开始菜单里），等左下角显示引擎已启动，再重跑。'))
    console.log(灰('  如果是"权限不足"，把 Docker Desktop 用管理员身份启动一次。'))
    return 1
  }
  console.log(绿('✓') + ` Docker ${docker.出}（${cli.出.replace(/^Docker version\s*/i, '').slice(0, 40)}）`)

  // ---------- 1.5 放哪儿 ----------
  const 位置 = await 决定目录(选项, 配置, 干跑)
  if (!位置) return 1
  const 数据目录 = 位置.目录
  console.log('')

  // ---------- 2. 端口 ----------
  let 端口有冲突 = false
  for (const [叫法, 端口] of [['OneBot HTTP', 3000], ['OneBot WS', 3001], ['WebUI', 6099]]) {
    if (await 端口通(端口)) {
      端口有冲突 = true
      if (干跑) {
        console.log(黄(`· 端口 ${端口}（${叫法}）已被占着 —— 真跑的话这里会停`))
        continue
      }
      console.log(红(`✗ 端口 ${端口}（${叫法}）已经被占着`))
      console.log(灰('  → 可能是上一个 NapCat、或者别的机器人（比如 SnowLuma）。先停掉再用。'))
      return 1
    }
  }
  if (!端口有冲突) console.log(绿('✓') + ' 3000 / 3001 / 6099 都空着')

  // ---------- 2.5 位置确认过、端口也空着，这才动旧数据 ----------
  if (位置.待搬) {
    if (干跑) {
      console.log(灰('（干跑）会先把旧目录的数据搬到新位置：' + 位置.待搬))
    } else if (!搬数据(位置.待搬, 数据目录)) {
      return 1
    }
  }

  // ---------- 3. 目录 + 配置 ----------
  const 子目录 = { config: join(数据目录, 'config'), qq: join(数据目录, 'qq'), plugins: join(数据目录, 'plugins') }
  if (!干跑) for (const p of Object.values(子目录)) mkdirSync(p, { recursive: true })

  const http令牌 = 选项.token || 配置.napcat.token || 新令牌('qiyu-http-')
  const ws令牌 = 选项.ws令牌 || 配置.napcat.wsToken || 新令牌('qiyu-ws-')
  const webui令牌 = 选项.webui令牌 || 'qiyu-webui-' + randomBytes(10).toString('hex')

  const onebot = {
    network: {
      httpServers: [
        {
          name: 'http-default',
          enable: true,
          host: '0.0.0.0',
          port: 3000,
          enableCors: true,
          enableWebsocket: false,
          messagePostFormat: 'array',
          token: http令牌,
          debug: false,
        },
      ],
      websocketServers: [
        {
          name: 'ws-default',
          enable: true,
          host: '0.0.0.0',
          port: 3001,
          messagePostFormat: 'array',
          reportSelfMessage: false,
          token: ws令牌,
          enableForcePushEvent: true,
          debug: false,
          heartInterval: 30000,
        },
      ],
      httpClients: [],
      websocketClients: [],
      httpSseServers: [],
      plugins: [],
    },
    musicSignUrl: '',
    enableLocalFile2Url: false,
    parseMultMsg: false,
  }

  const 写 = (路径, 对象) => {
    if (干跑) return
    writeFileSync(路径, JSON.stringify(对象, null, 2), 'utf8')
  }
  // 有 QQ 号就写「这个号专用」的，同时留一份模板（换号时 NapCat 会用模板）
  写(join(子目录.config, 'onebot11.json'), onebot)
  if (QQ号) 写(join(子目录.config, `onebot11_${QQ号}.json`), onebot)
  写(join(子目录.config, 'webui.json'), {
    // ⭐ 只监听本机：WebUI 是给进阶用的，没必要暴露到局域网
    host: '127.0.0.1',
    port: 6099,
    token: webui令牌,
    loginRate: 3,
  })
  console.log(绿('✓') + ' OneBot / WebUI 配置写好了')

  // ---------- 4. 容器 ----------
  const 已有 = 跑('docker', ['ps', '-a', '--filter', `name=^${容器名}$`, '--format', '{{.State}}'])
  if (已有.ok && 已有.出) {
    console.log(黄('·') + ` 容器已存在（状态 ${已有.出}），直接启动`)
    if (!干跑) {
      if (已有.出 !== 'running') 跑('docker', ['start', 容器名], 60000)
    }
  } else {
    const 参数 = [
      'run', '-d',
      '--name', 容器名,
      '--restart', 'unless-stopped',
      '-p', '127.0.0.1:3000:3000',
      '-p', '127.0.0.1:3001:3001',
      '-p', '127.0.0.1:6099:6099',
      '-e', 'MODE=ws',
      '-e', `WEBUI_TOKEN=${webui令牌}`,
      '-e', 'TZ=Asia/Shanghai',
      '-v', `${子目录.config}:/app/napcat/config`,
      '-v', `${子目录.qq}:/app/.config/QQ`,
      '-v', `${子目录.plugins}:/app/napcat/plugins`,
    ]
    if (QQ号) 参数.push('-e', `ACCOUNT=${QQ号}`)
    参数.push(镜像)

    if (干跑) {
      console.log(灰('（干跑）会执行：'))
      console.log(灰('  docker ' + 参数.join(' ')))
      return 0
    }

    const 有镜像 = 跑('docker', ['image', 'inspect', 镜像, '--format', '{{.Id}}'], 15000)
    if (!有镜像.ok) {
      console.log(黄('·') + ' 本地没有镜像，正在拉（第一次要几分钟）…')
      const 拉 = 跑('docker', ['pull', 镜像], 900000)
      if (!拉.ok) {
        console.log(红('✗ 拉镜像失败'))
        console.log(灰('  ' + 拉.错.slice(0, 200)))
        return 1
      }
    }

    const 起 = 跑('docker', 参数, 120000)
    if (!起.ok) {
      console.log(红('✗ 容器没起来'))
      console.log(灰('  ' + 起.错.slice(0, 300)))
      return 1
    }
    console.log(绿('✓') + ` 容器起来了：${起.出.slice(0, 12)}`)
  }

  // ---------- 5. 把值写回本机配置 ----------
  try {
    const 旧 = existsSync(配置文件路径()) ? JSON.parse(readFileSync(配置文件路径(), 'utf8')) : {}
    const 新 = {
      ...旧,
      napcat: {
        ...(旧.napcat || {}),
        container: 容器名,
        dataDir: 数据目录,
        http: 'http://127.0.0.1:3000',
        ws: 'ws://127.0.0.1:3001/',
        webui: 'http://127.0.0.1:6099',
        token: http令牌,
        wsToken: ws令牌,
        webuiToken: webui令牌,
      },
      dsh: { ...(旧.dsh || {}), port: (旧.dsh && 旧.dsh.port) || 0 },
      character: 旧.character || 'characters',
    }
    writeFileSync(配置文件路径(), JSON.stringify(新, null, 2), 'utf8')
    console.log(绿('✓') + ' 值写进 qiyu.config.json（doctor 会用这些）')
  } catch (错) {
    console.log(黄('·') + ' 写 qiyu.config.json 失败（不影响使用）：' + String(错.message || 错))
  }

  // ---------- 6. 等 WebUI 起来 ----------
  console.log(灰('… 等 NapCat 起来'))
  let 起来了 = false
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    if (await 端口通(6099)) {
      起来了 = true
      break
    }
  }
  if (!起来了) {
    console.log(红('✗ 6099 一直没起来'))
    console.log(灰('  → 看日志：docker logs --tail 80 ' + 容器名))
    return 1
  }
  console.log(绿('✓') + ' WebUI 已就绪')

  // ---------- 7. 已经登录了吗 ----------
  try {
    const r = await fetch('http://127.0.0.1:3000/get_login_info', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + http令牌 },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    })
    const j = await r.json()
    if (j && j.data && j.data.user_id) {
      console.log(绿('✓') + ` 已经登录：${j.data.nickname}（${j.data.user_id}）`)
      console.log('')
      console.log(绿('好了，跑 qiyu doctor 看看整条链路。'))
      return 0
    }
  } catch {}

  // ---------- 8. 出码 ----------
  console.log(灰('… 取登录二维码'))
  const 二维码 = join(process.cwd(), 'napcat-qrcode.png')
  let 拿到 = false
  for (let i = 0; i < 30; i++) {
    const cp = 跑('docker', ['cp', `${容器名}:/app/napcat/cache/qrcode.png`, 二维码], 15000)
    if (cp.ok && existsSync(二维码) && statSync(二维码).size > 500) {
      拿到 = true
      break
    }
    await new Promise((r) => setTimeout(r, 1500))
  }

  console.log('')
  if (!拿到) {
    console.log(黄('· 还没出码。容器可能还在初始化，过 30 秒再跑一次 qiyu qr。'))
  } else {
    const 她 = 角色名 || '她'
    console.log(灰('接着会弹出一张二维码图片（图片窗口，不是网页，不用输入任何东西）。'))
    if (角色名) {
      console.log(绿(`这是「${角色名}」要登录的 QQ 码`))
      console.log(灰('用她自己的那个号，拿手机 QQ 扫它。扫完这个号就登进容器了，别人发消息才会走到你这边。'))
    } else {
      console.log(灰('这是她要登录的 QQ 码：用她自己的那个号，拿手机 QQ 扫它。'))
      console.log(灰('扫完那个号就登进容器了，之后别人发消息才会走到你这边。'))
    }
    console.log('')
    console.log(灰('手机确认时记得勾上「下次登录无需确认」——'))
    console.log(灰('勾了以后重启容器也不用再扫；登录状态会自动存在数据目录里，这次扫完就不用重复扫了。'))
    const 打开了 = 打开文件(二维码)
    console.log('')
    console.log(打开了 ? 绿('✓ 二维码已经在你屏幕上打开') : 黄('· 没能自动打开，看这个文件：'))
    console.log('   ' + 二维码)
  }
  console.log('')
  console.log('接着做三件事：')
  console.log(`  1. 用**目标账号**的手机 QQ 扫这张码${角色名 ? `（是「${角色名}」的号，不是你的）` : ''}`)
  console.log('  2. 手机确认时，勾上「下次登录无需确认」← 不勾的话每次重启容器都要手Q验证')
  console.log('  3. 扫完跑 qiyu doctor')
  console.log('')
  console.log(灰('（登录状态是存在数据目录里的，不是存在这次会话里；只要不删数据目录，就不用重扫。）'))
  console.log('')
  console.log(灰('WebUI 是 NapCat 的后台管理页，日常用不到，也已经只监听本机（127.0.0.1:6099）。'))
  console.log(灰('真要去后台：qiyu.config.json 里 napcat.webuiToken 那串当 token。'))
  return 0
}
