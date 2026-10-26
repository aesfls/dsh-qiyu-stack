/**
 * 单测：桥里的「导入名」不许被本地同名声明遮蔽。
 *
 * 为什么专门测这个：2026-10-26 干净机器上抓到一个真事故 ——
 *   `限速.mjs` 导出 `记一笔(状态, 键, 现在)`，而 host.js 里又定义了
 *   `const 记一笔 = (uid) => {...}`（记每日额度）。
 *   JS 的作用域规则让**后者遮蔽前者**，于是 `发一个()` 里的限速记账调到了额度函数：
 *   限速队列永远不更新 → 4~10 秒间隔从来没生效（语音和文字 1 秒内连发）。
 *   铁证是额度文件里出现 `"[object Object]": 17`（对象被当成 uid）。
 *
 * 这类 bug 不会抛错、不会进日志，只能靠"扫源码"抓。所以：
 *   · 收集 host.js 从 ./xxx.mjs 里导入的所有绑定名
 *   · 断言这些名字在 host.js 里**没有**被 const/let/var/function/class 重新声明
 *
 * 跑法（在本仓库根目录）：
 *   node test\bridge-names.test.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 桥 = resolve(这里, '..', 'runtime', 'bridge', 'lib')
const 源码 = readFileSync(resolve(桥, 'host.js'), 'utf8')

let 过 = 0
let 败 = 0
const 断言 = (名, 条件, 实际) => {
  if (条件) { 过++; return }
  败++
  console.log('✗ ' + 名 + (实际 === undefined ? '' : '（' + JSON.stringify(实际) + '）'))
}

// ---- 1. 收集从本地模块导入的绑定名 ----
const 导入 = []
for (const m of 源码.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([^']+)'/g)) {
  for (const 片段 of m[1].split(',')) {
    const 原 = 片段.trim().split(/\s+as\s+/)
    if (!原[0]) continue
    // `X as Y` → 本地名是 Y；否则就是 X
    导入.push({ 本地: (原[1] || 原[0]).trim(), 来自: m[2] })
  }
}
断言('确实解析到了本地导入', 导入.length >= 8, 导入.length)

// ---- 2. 这些名字不许被重新声明 ----
const 冲突 = []
for (const { 本地, 来自 } of 导入) {
  const 声明 = new RegExp(`^\\s*(?:const|let|var|function|class)\\s+${本地}\\b`, 'm')
  if (声明.test(源码)) 冲突.push(`${本地}（来自 ${来自}）`)
}
if (冲突.length) console.log('  被本地声明遮蔽的导入：' + 冲突.join('、'))
断言('没有导入名被本地声明遮蔽', 冲突.length === 0, 冲突)

// ---- 3. 限速记账确实指向 限速.mjs（防止有人"改回去"）----
断言('限速记账调用存在', /记一笔\(限速状态,/.test(源码))
const 额度函数 = /const\s+记额度\s*=/.test(源码)
断言('额度函数叫 记额度（不是 记一笔）', 额度函数)
断言('没有 const 记一笔', !/const\s+记一笔\s*=/.test(源码))

// ---- 4. 限速.mjs 仍然导出 记一笔 ----
const 限速 = readFileSync(resolve(桥, '限速.mjs'), 'utf8')
断言('限速.mjs 导出 记一笔', /export function 记一笔\s*\(/.test(限速))

console.log('')
console.log(败 === 0 ? `全部通过：${过}/${过}` : `失败 ${败} / 共 ${过 + 败}`)
process.exit(败 === 0 ? 0 : 1)
