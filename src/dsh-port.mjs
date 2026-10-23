// 找 DSH 正在听的端口。
//
// 为什么需要这个：DSH 的端口不是固定的（每次启动可能换一个），
// 而 qiyu.config.json 里的 dsh.port 是某一次写下来的快照 —— 过一天就旧了。
// 只信配置会让 doctor 一直报「DSH 端口没人听」，人就会以为桥坏了。
//
// 认法（按特征，不猜）：
//   · GET /dsh-qq-bridge/state → 200 且 {"ok":true,...}      → DSH + 桥都在
//   · GET /                     → 401 "dsh web authentication required" → DSH 在，但桥没装
import { 跑 } from './run.mjs'

const 探测超时 = 350

async function 取(端口, 路径) {
  try {
    const r = await fetch(`http://127.0.0.1:${端口}${路径}`, { signal: AbortSignal.timeout(探测超时) })
    return { 状态: r.status, 文本: await r.text() }
  } catch {
    return null
  }
}

/** 这个端口是不是 DSH？返回 { 端口, 有桥 } 或 null */
async function 认一认(端口) {
  const 桥 = await 取(端口, '/dsh-qq-bridge/state')
  if (桥 && 桥.状态 === 200) {
    try {
      const j = JSON.parse(桥.文本)
      if (j && j.ok === true) return { 端口, 有桥: true }
    } catch {
      // 不是 JSON，继续看根路径
    }
  }
  const 根 = await 取(端口, '/')
  if (根 && 根.状态 === 401 && /dsh web authentication required/i.test(根.文本)) {
    return { 端口, 有桥: false }
  }
  return null
}

/** 本机正在听的端口（只听回环/通配地址，跳过系统端口） */
function 听着的端口() {
  const r = 跑('netstat', ['-ano', '-p', 'TCP'], 8000)
  if (!r.ok) return []
  const 端口们 = new Set()
  for (const 行 of r.出.split(/\r?\n/)) {
    const m = 行.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING/i)
    if (!m) continue
    const 地址 = m[1]
    const 端口 = Number(m[2])
    if (!(地址 === '0.0.0.0' || 地址 === '127.0.0.1' || 地址 === '[::]' || 地址 === '[::1]')) continue
    if (端口 < 1024) continue
    端口们.add(端口)
  }
  return [...端口们].sort((a, b) => a - b)
}

/**
 * 找 DSH。先试已知端口（配置里的），再扫本机监听端口。
 * @param {{已知端口?: number, 并发?: number, 上限?: number}} 选项
 * @returns {Promise<{端口:number, 有桥:boolean, 来源:'配置'|'自动探测'}|null>}
 */
export async function 探测DSH({ 已知端口 = 0, 并发 = 16, 上限 = 200 } = {}) {
  const 已知 = Number(已知端口) || 0
  if (已知) {
    const 中 = await 认一认(已知)
    if (中) return { ...中, 来源: '配置' }
  }

  // NapCat 的三个端口不用试；已知端口试过了也不重复
  const 别试 = new Set([3000, 3001, 6099, 已知].filter(Boolean))
  const 候选 = 听着的端口()
    .filter((p) => !别试.has(p))
    .slice(0, 上限)

  for (let i = 0; i < 候选.length; i += 并发) {
    const 批 = 候选.slice(i, i + 并发)
    const 结果 = await Promise.all(批.map((p) => 认一认(p)))
    const 中 = 结果.find(Boolean)
    if (中) return { ...中, 来源: '自动探测' }
  }
  return null
}
