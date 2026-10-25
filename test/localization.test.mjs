/**
 * 单测：仓库里不许有本地化内容（作者机器上的路径 / 角色名 / 号码 / 会话 id / 凭证）。
 *
 * 这条比别的测试更"拦人"：它会在 `npm test` 里跑，谁把 her 的名字写回代码就会红。
 *
 * 跑法（在本仓库根目录）：
 *   node test\localization.test.mjs
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 扫, 规则 } from '../src/localization.mjs'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 包根 = resolve(这里, '..')

let 过 = 0
let 败 = 0
const 断言 = (名, 条件, 实际) => {
  if (条件) { 过++; return }
  败++
  console.log('✗ ' + 名 + (实际 === undefined ? '' : '（' + JSON.stringify(实际) + '）'))
}

const 目标 = ['runtime', 'templates', 'examples'].map((d) => resolve(包根, d))
const { 命中, 文件数 } = 扫(目标)

console.log(`扫了 ${文件数} 个文件，${规则.length} 条规则`)
if (命中.length) {
  for (const h of 命中) console.log(`  ✗ ${h.文件}:${h.行}  [${h.规则}]  ${h.片段}`)
}

断言('扫到了文件（不是空跑）', 文件数 > 20, 文件数)
断言('没有本地化内容', 命中.length === 0, 命中.length)
断言('规则表和 scanner 都从同一份来', Array.isArray(规则) && 规则.length >= 5, 规则.length)

console.log('')
console.log(败 === 0 ? `全部通过：${过}/${过}` : `失败 ${败} / 共 ${过 + 败}`)
process.exit(败 === 0 ? 0 : 1)
