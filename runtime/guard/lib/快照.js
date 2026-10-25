// 快照：给她"家底"和关键配置拍哈希照，用来发现"悄悄被改了"。
//
// 纯逻辑放这里（算/比），读写文件由 host.js 负责 —— 这样能离线单测。
import { createHash } from 'node:crypto'

/** 算一个文件的短哈希；读不到返回 null（文件不存在 / 没权限）。 */
export function 文件哈希(读文件, 路径) {
  try {
    const buf = 读文件(路径)
    if (!buf) return null
    return createHash('sha256').update(buf).digest('hex').slice(0, 16)
  } catch (error) {
    return null
  }
}

/** 对一批路径算快照：{ 路径: 哈希|null } */
export function 算快照(读文件, 路径们) {
  const 结果 = {}
  for (const p of 路径们) 结果[p] = 文件哈希(读文件, p)
  return 结果
}

/**
 * 比两次快照。
 * @returns {{ 新增: string[], 变了: string[], 没了: string[] }}
 *   新增 = 上次没有、这次有；变了 = 两边都有但哈希不同；没了 = 上次有、这次没有
 */
export function 比快照(旧, 新) {
  const 新增 = []
  const 变了 = []
  const 没了 = []
  const 旧键 = Object.keys(旧 || {})
  const 新键 = Object.keys(新 || {})
  for (const p of 新键) {
    const 旧值 = 旧 ? 旧[p] : undefined
    const 新值 = 新[p]
    if (旧值 === undefined && 新值 !== null) { 新增.push(p); continue }
    if (旧值 === null && 新值 !== null) { 新增.push(p); continue }
    if (旧值 !== null && 新值 === null) { 没了.push(p); continue }
    if (旧值 !== undefined && 新值 !== null && 旧值 !== 新值) 变了.push(p)
  }
  for (const p of 旧键) {
    if (!(p in (新 || {}))) 没了.push(p)
  }
  return { 新增, 变了, 没了 }
}

/** 有没有值得报告的变化 */
export function 有变化(对比) {
  return !!(对比 && (对比.新增.length || 对比.变了.length || 对比.没了.length))
}
