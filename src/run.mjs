// 跑外部命令，并且**在受限沙箱里也能活**。
//
// 为什么需要这个文件（2026-10-23 实测）：
//   DSH 默认沙箱（workspace-write / read-only）不允许程序开命名管道，
//   所以 `execFileSync(cmd, args, { stdio: ['ignore','pipe','pipe'] })` 会直接 EPERM。
//   而 qiyu 里几乎所有判断都靠"跑条命令看输出"——一旦 EPERM，
//   就会变成「没装 Docker」「端口查不出来」「容器不存在」这类**假阴性**，
//   把用户和 agent 一起带沟里。
//
// 兜底办法：抓不到管道，就把输出重定向到临时文件再读（沙箱允许写工作区）。
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let 遇到过沙箱限制 = false

/** 这次运行里，有没有因为沙箱读不到命令输出（结果可能不准） */
export function 沙箱受限过() {
  return 遇到过沙箱限制
}

function 引号(s) {
  const t = String(s)
  return /[\s"&|<>^]/.test(t) ? '"' + t.replace(/"/g, '\\"') + '"' : t
}

/** 把命令的输出重定向到文件，再读回来（不依赖管道）。 */
function 落盘跑(命令, 参数, 超时) {
  let 目录 = ''
  try {
    目录 = mkdtempSync(join(tmpdir(), 'qiyu-cmd-'))
    const 输出文件 = join(目录, 'out.txt')
    const 整行 = [命令, ...参数].map(引号).join(' ') + ' > ' + 引号(输出文件) + ' 2>&1'
    if (process.platform === 'win32') {
      execFileSync('cmd.exe', ['/c', 整行], { timeout: 超时, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
    } else {
      execFileSync('sh', ['-c', 整行], { timeout: 超时, stdio: ['ignore', 'ignore', 'ignore'] })
    }
    const 出 = existsSync(输出文件) ? readFileSync(输出文件, 'utf8').trim() : ''
    return { ok: true, 出, 错: '' }
  } catch (错) {
    // 命令本身失败（退出码非 0）时，输出仍可能在文件里——尽量把它带回去
    let 出 = ''
    try {
      const 文件 = join(目录, 'out.txt')
      if (目录 && existsSync(文件)) 出 = readFileSync(文件, 'utf8').trim()
    } catch {}
    return { ok: false, 出, 错: 出 || String((错 && (错.stderr || 错.message)) || 错).trim() }
  } finally {
    try {
      if (目录) rmSync(目录, { recursive: true, force: true })
    } catch {}
  }
}

/**
 * 跑一条命令。
 * @returns {{ok:boolean, 出:string, 错:string, 沙箱?:boolean}}
 */
export function 跑(命令, 参数 = [], 超时 = 8000) {
  try {
    const 出 = execFileSync(命令, 参数, {
      timeout: 超时,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, 出: String(出).trim(), 错: '' }
  } catch (错) {
    const 码 = String((错 && 错.code) || '')
    const 文 = String((错 && (错.stderr || 错.message)) || 错)
    // 被沙箱拦了：换一条不靠管道的路
    if (码 === 'EPERM' || 码 === 'EACCES' || 码 === 'EPIPE' || /EPERM|EACCES|spawn .*pipe/i.test(文)) {
      遇到过沙箱限制 = true
      const 结果 = 落盘跑(命令, 参数, 超时)
      return { ...结果, 沙箱: true }
    }
    return { ok: false, 出: String((错 && 错.stdout) || '').trim(), 错: 文.trim() }
  }
}
