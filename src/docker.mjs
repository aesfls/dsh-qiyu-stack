// 后台服务（Docker）—— 用得着的时候才拉，拉的时候别让人看见。
//
// 两条铁律（都是实测踩出来的）：
//   1. 引擎**已经在跑**的时候，绝对不要再执行 Docker Desktop.exe
//      —— 它会 signaling show-dashboard，也就是用户莫名其妙看到一个窗口。
//   2. 启动要"静默"：Docker Desktop 的设置里 OpenUIOnStartupDisabled=true 才不弹面板；
//      我们在 ensure 之前顺手把它写进配置（写失败了也不影响启动）。
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { 跑 } from './run.mjs'

const 绿 = (s) => `\x1b[32m${s}\x1b[0m`
const 黄 = (s) => `\x1b[33m${s}\x1b[0m`
const 灰 = (s) => `\x1b[90m${s}\x1b[0m`


export async function 引擎版本() {
  const r = await 跑('docker', ['version', '--format', '{{.Server.Version}}'], 10000)
  return r.ok && r.出 ? r.出 : ''
}

export async function 命令行在吗() {
  const r = await 跑('docker', ['--version'], 10000)
  return r.ok
}

const DockerDesktop候选 = [
  'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
  join(process.env.LOCALAPPDATA || '', 'Docker', 'Docker Desktop.exe'),
]

/** 把「启动时不弹面板」写进 Docker Desktop 的设置（失败就算了，不影响启动）。 */
function 静默化设置() {
  try {
    const p = join(process.env.APPDATA || '', 'Docker', 'settings-store.json')
    if (!existsSync(p)) return
    const j = JSON.parse(readFileSync(p, 'utf8'))
    if (j.OpenUIOnStartupDisabled === true) return
    j.OpenUIOnStartupDisabled = true
    writeFileSync(p, JSON.stringify(j, null, 2), 'utf8')
  } catch {
    /* 设置写不进去也能跑，只是可能会弹面板 */
  }
}

/**
 * 确保引擎在线。在线就立刻返回 true（**绝不碰 Docker Desktop.exe**）；
 * 不在线才静默拉起，最多等 等秒 秒。
 */
export async function 确保引擎({ 等秒 = 120, 说 = () => {} } = {}) {
  if (await 引擎版本()) return true
  const exe = DockerDesktop候选.find((p) => {
    try {
      return existsSync(p)
    } catch {
      return false
    }
  })
  if (!exe) return false

  静默化设置()
  说('正在启动后台服务（第一次要十几秒，不会弹窗）…')
  try {
    spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    return false
  }
  for (let i = 0; i < Math.ceil(等秒 / 3); i++) {
    await new Promise((r) => setTimeout(r, 3000))
    if (await 引擎版本()) return true
  }
  return false
}

/** 容器在跑吗；不在就跑起来（镜像会自己回来，但显式更稳）。 */
export async function 确保容器(名) {
  const st = await 跑('docker', ['inspect', 名, '--format', '{{.State.Status}}'], 15000)
  if (st.ok && st.出 === 'running') return true
  if (!st.ok) return false
  const r = await 跑('docker', ['start', 名], 60000)
  return r.ok
}

/** 给用户看的一句话：别让小白听见 "Docker" 就慌。 */
export const 后台服务说法 = {
  没装: '这台机器还缺一个"后台服务"（Docker），它是让 QQ 能在电脑上跑起来的底座。',
  起不来: '后台服务没起来。可以再试一次，或者手动开一次 Docker Desktop（在开始菜单里，开了就不用管它）。',
}
