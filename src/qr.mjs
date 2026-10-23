// qiyu qr —— 把 NapCat 当前的登录二维码取出来、**直接打开**给用户看。
//
// 约定：需要用户扫码时，不能只给一个路径（用户还得自己去找文件）。
// 一律「复制出来 + 用系统默认看图程序打开 + 在终端里说清什么时候过期」。
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { statSync } from 'node:fs'
import { 读配置 } from './config.mjs'
import { 跑 } from './run.mjs'

const 绿 = (s) => `\x1b[32m${s}\x1b[0m`
const 灰 = (s) => `\x1b[90m${s}\x1b[0m`

export function 打开文件(路径) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', 路径], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } else if (process.platform === 'darwin') {
      spawn('open', [路径], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn('xdg-open', [路径], { detached: true, stdio: 'ignore' }).unref()
    }
    return true
  } catch {
    return false
  }
}

export async function qr() {
  const 配置 = 读配置()

  // 先看是不是根本不用扫 —— 已经登录了还弹一张过期的码，最误导人
  try {
    const 头 = { 'content-type': 'application/json' }
    if (配置.napcat.token) 头.authorization = 'Bearer ' + 配置.napcat.token
    const r = await fetch(配置.napcat.http + '/get_login_info', {
      method: 'POST',
      headers: 头,
      body: '{}',
      signal: AbortSignal.timeout(5000),
    })
    const j = await r.json()
    if (j && j.status === 'ok' && j.data && j.data.user_id) {
      console.log(`已经登录了：${j.data.nickname}（${j.data.user_id}），不需要扫码。`)
      console.log('如果要换号，先在 NapCat WebUI 里退出登录，再跑 qiyu qr。')
      return 0
    }
  } catch {
    // 查不到就当没登录，继续走扫码流程
  }

  const 目标 = resolve(process.cwd(), 'napcat-qrcode.png')

  // 走 run.mjs：受限沙箱里 execFileSync 抓管道会 EPERM，
  // 它会自动改成「重定向到临时文件再读」，不然会误报「拿不到二维码」。
  const 复制 = 跑('docker', ['cp', `${配置.napcat.container}:/app/napcat/cache/qrcode.png`, 目标], 15000)
  if (!复制.ok) {
    console.error('拿不到二维码：' + String(复制.错 || 'docker cp 失败').trim().slice(0, 200))
    console.error('')
    console.error('可能的原因：')
    console.error('  · 容器没起 —— 跑 qiyu doctor 看看')
    console.error('  · 已经登录了，根本没有二维码 —— 看 ' + 配置.napcat.http + '/get_login_info')
    console.error('  · 也可以直接在浏览器里看：' + 配置.napcat.webui)
    return 1
  }

  let 年龄秒 = 0
  try {
    年龄秒 = Math.max(0, Math.round((Date.now() - statSync(目标).mtimeMs) / 1000))
  } catch {}

  console.log('')
  console.log('接着会弹出一张二维码图片（图片窗口，不是网页，不用输入任何东西）。')
  {
    const 名 = String((读配置() || {}).角色 || '').trim()
    if (名) {
      console.log(绿(`这是「${名}」要登录的 QQ 码`))
      console.log(灰(`用她自己的那个号扫；扫完以后别人往 ${名} 发消息，才会走到你这边。`))
    } else {
      console.log(灰('这是 QQ 的登录码：用要登的那个号扫，扫完它就登进容器了。'))
    }
    console.log(灰('手机确认时勾上「下次登录无需确认」——勾了以后重启容器也不用再扫。'))
  }
  const 打开了 = 打开文件(目标)

  console.log('')
  console.log(打开了 ? '✅ 二维码已经在你屏幕上打开' : '⚠️ 没能自动打开，请手动看这个文件')
  console.log('   ' + 目标)
  console.log('')
  console.log(`   这张是 ${年龄秒} 秒前生成的，大约 2 分钟失效。`)
  if (年龄秒 > 90) {
    console.log('   ⚠️ 已经过了大半，扫之前最好刷新一下：再跑一次 qiyu qr，或者用 WebUI 刷新')
  }
  console.log('   过期了再跑一次 qiyu qr 就行。')
  console.log('')
  console.log('   用目标账号扫；手机上确认时，记得勾「下次登录无需确认」。')
  console.log('')
  return 0
}
