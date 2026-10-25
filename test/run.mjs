/**
 * 跑 test/ 下所有 *.test.mjs。
 *
 * 为什么自己写一个，不用测试框架：
 *   · 这些测试要验的是"桥里那段真代码"，不是纯函数 API —— 各自会从 host.js 里切函数、造时序，
 *     框架帮不上忙；
 *   · 零依赖：仓库里不装 node_modules，`npx` 一个框架就得联网、还得写进 package.json；
 *   · 沙箱里没有管道：父子进程用 stdio: 'inherit'（抓输出会被 EPERM），退出码就够了。
 *
 * 用法：
 *   npm test                # 全跑
 *   node test/run.mjs 限速    # 只跑文件名里带「限速」的
 */
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 过滤 = process.argv.slice(2).filter((x) => !x.startsWith('-'))

const 文件们 = readdirSync(这里)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !过滤.length || 过滤.some((k) => f.includes(k)))
  .sort()

if (!文件们.length) {
  console.log('没有匹配的测试文件')
  process.exit(1)
}

let 过 = 0
const 败 = []
for (const f of 文件们) {
  console.log(`\n──── ${f} ────`)
  // stdio: 'inherit' —— 沙箱不让抓子进程输出（pipe 会 EPERM），继承就好
  const r = spawnSync(process.execPath, [join(这里, f)], { stdio: 'inherit' })
  if (r.status === 0) 过++
  else 败.push(f + `（exit ${r.status === null ? '被信号打断' : r.status}）`)
}

console.log(`\n════════════════════`)
console.log(`测试文件：${文件们.length} 个｜通过 ${过}｜失败 ${败.length}`)
if (败.length) {
  for (const b of 败) console.log('  ✗ ' + b)
  process.exit(1)
}
