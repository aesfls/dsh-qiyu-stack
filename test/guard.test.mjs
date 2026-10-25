/**
 * 单测：护栏（runtime/guard/lib/判定.js、快照.js）
 *
 * 只测纯函数，不碰文件、不连 QQ、不起桥。
 *
 * 跑法（在本仓库根目录）：
 *   node test\guard.test.mjs
 */
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 判定模块 = pathToFileURL(resolve(这里, '..', 'runtime', 'guard', 'lib', '判定.js')).href
const 快照模块 = pathToFileURL(resolve(这里, '..', 'runtime', 'guard', 'lib', '快照.js')).href
const { 判定, 规整会话, 白名单集 } = await import(判定模块)
const { 算快照, 比快照, 有变化 } = await import(快照模块)

let 过 = 0
let 败 = 0
const 断言 = (名, 条件, 实际) => {
  if (条件) { 过++; return }
  败++
  console.log('✗ ' + 名 + (实际 === undefined ? '' : '（实际 ' + JSON.stringify(实际) + '）'))
}

const 基础配置 = {
  开关: true,
  模式: 'enforce',
  目标会话: '',
  外部种类: ['qq-group'],
  白名单: ['read', 'glob', 'grep', 'qq_group_say', 'qq_sticker'],
}

console.log('== 1. 会话 id 规整 ==')
断言('带前缀能去掉', 规整会话('session-abc') === 'abc', 规整会话('session-abc'))
断言('不带原样', 规整会话('abc') === 'abc')
断言('空值是空串', 规整会话(null) === '')

console.log('== 2. 白名单的三种写法 ==')
断言('数组', [...白名单集({ 白名单: ['a', 'b'] })].join() === 'a,b')
断言('逗号串', [...白名单集({ 白名单: 'a，b c' })].join() === 'a,b,c', [...白名单集({ 白名单: 'a，b c' })])
断言('没写就是空', 白名单集({}).size === 0)

console.log('== 3. 群轮次：白名单放行，其余拒 ==')
for (const 名 of ['read', 'glob', 'grep', 'qq_group_say', 'qq_sticker']) {
  断言('放行 ' + 名, 判定({ 配置: 基础配置, 会话id: 'session-abc', 工具名: 名, 是否外部轮: true }) === null)
}
for (const 名 of ['pwsh', 'write', 'edit', 'remember', 'subagent', 'bili_triple']) {
  const 判 = 判定({ 配置: 基础配置, 会话id: 'session-abc', 工具名: 名, 是否外部轮: true })
  断言('拒 ' + 名, 判 && 判.拒 === true && 判.工具名 === 名, 判)
}

console.log('== 4. 私聊轮次：一律放行 ==')
断言('私聊里 pwsh 放行', 判定({ 配置: 基础配置, 会话id: 'session-abc', 工具名: 'pwsh', 是否外部轮: false }) === null)

console.log('== 5. 开关 / 目标会话 ==')
断言('开关 false 全放行', 判定({ 配置: { ...基础配置, 开关: false }, 会话id: 'session-abc', 工具名: 'pwsh', 是否外部轮: true }) === null)
断言('目标会话留空 = 管所有会话', 判定({ 配置: 基础配置, 会话id: 'session-随便', 工具名: 'pwsh', 是否外部轮: true }).拒 === true)
断言(
  '指定了目标会话 → 别的会话不碰',
  判定({ 配置: { ...基础配置, 目标会话: 'session-abc' }, 会话id: 'session-other', 工具名: 'pwsh', 是否外部轮: true }) === null,
)
断言(
  '指定了就管那一个（前缀有无都认）',
  判定({ 配置: { ...基础配置, 目标会话: 'abc' }, 会话id: 'session-abc', 工具名: 'pwsh', 是否外部轮: true }).拒 === true,
)

console.log('== 6. 拒绝时带路标，而且只指白名单里真有的工具 ==')
const 拒命令 = 判定({ 配置: 基础配置, 会话id: 's', 工具名: 'pwsh', 是否外部轮: true })
断言('跑命令 → 指路 qq_sticker', 拒命令.说.includes('qq_sticker'), 拒命令.说)
断言('白名单里没有 qq_draw → 就不提画画', !拒命令.说.includes('qq_draw'), 拒命令.说)

// 白名单宽一点：路标和"这一轮你能干什么"都要跟着变
const 宽配置 = { ...基础配置, 白名单: [...基础配置.白名单, 'qq_draw', 'read_image', 'qq_voice'] }
const 拒命令宽 = 判定({ 配置: 宽配置, 会话id: 's', 工具名: 'pwsh', 是否外部轮: true })
断言('白名单有 qq_draw → 提画画', 拒命令宽.说.includes('qq_draw'), 拒命令宽.说)
const 拒宽 = 判定({ 配置: 宽配置, 会话id: 's', 工具名: 'remember', 是否外部轮: true })
断言(
  '拒绝话术列出真实能力（画画 / 看图 / 语音）',
  拒宽.说.includes('画画') && 拒宽.说.includes('看图') && 拒宽.说.includes('发语音'),
  拒宽.说,
)
const 拒窄 = 判定({ 配置: { ...基础配置, 白名单: ['qq_group_say'] }, 会话id: 's', 工具名: 'pwsh', 是否外部轮: true })
断言('白名单只剩回话 → 只承诺回话，不乱许愿', 拒窄.说.includes('只给你回话') && !拒窄.说.includes('画'), 拒窄.说)
const 拒记忆 = 判定({ 配置: 基础配置, 会话id: 's', 工具名: 'remember', 是否外部轮: true })
断言('写记忆 → 说明不写', 拒记忆.说.includes('记忆'), 拒记忆.说)

console.log('== 7. 快照：算 / 比 ==')
const 假文件们 = { 'a.md': 'x', 'b.json': 'y' }
const 读 = (p) => {
  if (!(p in 假文件们)) throw new Error('没有')
  return Buffer.from(假文件们[p])
}
const 甲 = 算快照(读, ['a.md', 'b.json'])
断言('两个文件都有哈希', Object.keys(甲).length === 2 && !!甲['a.md'] && !!甲['b.json'])
断言('读不到的是 null', 算快照(读, ['没有.md'])['没有.md'] === null)
断言('没变化', 有变化(比快照(甲, 算快照(读, ['a.md', 'b.json']))) === false)

假文件们['a.md'] = 'x2'
const 乙 = 算快照(读, ['a.md', 'b.json'])
const 比1 = 比快照(甲, 乙)
断言('改了一个', 比1.变了.length === 1 && 比1.变了[0] === 'a.md', 比1)

delete 假文件们['b.json']
const 丙 = 算快照(读, ['a.md', 'b.json'])
const 比2 = 比快照(乙, 丙)
断言('少了一个', 比2.没了.length === 1 && 比2.没了[0] === 'b.json', 比2)

假文件们['c.md'] = 'z'
const 丁 = 算快照(读, ['a.md', 'c.md'])
const 比3 = 比快照(丙, 丁)
断言('多了一个', 比3.新增.length === 1 && 比3.新增[0] === 'c.md', 比3)
断言('有变化', 有变化(比3) === true)

console.log('')
console.log(败 === 0 ? `全部通过：${过}/${过}` : `失败 ${败} / 共 ${过 + 败}`)
process.exit(败 === 0 ? 0 : 1)
