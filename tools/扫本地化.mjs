#!/usr/bin/env node
// 扫一遍仓库里的「本地化内容」——作者机器上的路径、角色名、号码、会话 id、凭证。
//
// 用法（仓库根目录）：
//   node tools\扫本地化.mjs            # 默认扫 runtime / templates / examples
//   node tools\扫本地化.mjs docs       # 扫别的目录
//   node tools\扫本地化.mjs --json     # 给脚本用
//
// 退出码：0 = 干净；1 = 有命中（可以当提交前的闸）。
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { 扫, 规则 } from '../src/localization.mjs'

const 参数 = process.argv.slice(2)
const 要JSON = 参数.includes('--json')
const 只要目录 = 参数.filter((x) => !x.startsWith('--'))
const 默认 = ['runtime', 'templates', 'examples']
const 目标 = (只要目录.length ? 只要目录 : 默认).map((p) => resolve(process.cwd(), p)).filter((p) => existsSync(p))

if (!目标.length) {
  console.log('没有可扫的目录（在仓库根目录跑，或显式传目录名）')
  process.exit(2)
}

const { 命中, 文件数 } = 扫(目标)

if (要JSON) {
  console.log(JSON.stringify({ 文件数, 命中 }, null, 2))
  process.exit(命中.length ? 1 : 0)
}

console.log(`扫了 ${文件数} 个文件，${规则.length} 条规则`)
if (!命中.length) {
  console.log('✓ 干净：没有作者机器上的东西')
  process.exit(0)
}

console.log(`✗ 命中 ${命中.length} 处：`)
for (const h of 命中) console.log(`  ${h.文件}:${h.行}  [${h.规则}]  ${h.片段}`)
console.log('')
console.log('怎么修：把值留空、改成中性值，或者让它读 character.json / 配置。')
console.log('这些规则在 src/localization.mjs；要加"明显是假的示例"例外，改那里的 允许 并写清理由。')
process.exit(1)
