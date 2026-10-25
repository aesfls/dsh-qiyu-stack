/**
 * 单测：p31 的两件事
 *   ① 群里剔本机路径（清群里的路径）—— 用它真正跑的去验，不是凭印象
 *   ② 发送限速（见 限速.test.mjs，这里只做一个联动冒烟）
 *
 * 跑法（在本仓库根目录）：
 *   node test\p31-路径.test.mjs
 */
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const hostPath = resolve(这里, '..', 'runtime', 'bridge', 'lib', 'host.js')

let 过 = 0, 败 = 0
function 断言(名, 条件, 细节) {
  if (条件) { 过++; return }
  败++
  console.log('  ✗ ' + 名 + (细节 ? '  → ' + 细节 : ''))
}

/*
 * 清群里的路径 是 host.js 内部的函数（没 export），这里**不复制粘贴一份**——
 * 复制一份测的是副本，不是真代码（和 p30「测出来的尺寸对，不代表画面对」同一个坑）。
 * 做法：从 host.js 文本里把函数体切出来，在新 Function 里跑。
 * 只要函数体自身不引用外部变量（它是纯函数），这样测到的就是真实现。
 */
import { readFileSync } from 'node:fs'
const 源码 = readFileSync(hostPath, 'utf8')
const 开始 = 源码.indexOf('function 清群里的路径(')
if (开始 < 0) { console.log('找不到 清群里的路径 —— host.js 被改过了？'); process.exit(2) }
// 从函数起点往后找到配对的右花括号（简单计数；函数体里没有字符串里带 { } 的坑，注释里的 {} 也要算）
let 深 = 0, 尾 = -1, 见过左 = false
for (let i = 开始; i < 源码.length; i++) {
  const c = 源码[i]
  if (c === '{') { 深++; 见过左 = true }
  else if (c === '}') { 深--; if (见过左 && 深 === 0) { 尾 = i; break } }
}
const 函数体 = 源码.slice(开始, 尾 + 1)
const 清群里的路径 = new Function(函数体 + '\n return 清群里的路径')()
断言('切出来的函数可用', typeof 清群里的路径 === 'function')

console.log('== 1. 真实案例回放：10-24 19:20 她贴的那条 ==')
{
  const 话 = 'C:\\示例\\画板\\作品\\draw-2026-10-24T11-15-17.png'
  const 结果 = 清群里的路径(话)
  断言('整句路径 → 全删了', 结果.全删了 === true, JSON.stringify(结果))
  断言('没有盘符残留', !/[A-Za-z]:/.test(结果.话))
}

console.log('== 2. 路径 + 人话：只剔路径，保留人话 ==')
{
  const 话 = '缩不了，图在 C:\\示例\\画板\\作品\\x.png 我这边帮不上'
  const 结果 = 清群里的路径(话)
  断言('不全删', 结果.全删了 === false, JSON.stringify(结果))
  断言('盘符没了', !/C:/.test(结果.话), 结果.话)
  断言('人话还在', 结果.话.includes('缩不了') && 结果.话.includes('帮不上'), 结果.话)
  console.log('   → 「' + 结果.话 + '」')
}

console.log('== 3. 前向/后向斜杠、小写盘符、中文目录 ==')
{
  for (const 话 of [
    'D:/data/图/a.jpg',
    'c:\\temp\\x.png',
    '看这个 \\character\\画板\\作品\\猫.png 好看吧',
  ]) {
    const 结果 = 清群里的路径(话)
    断言('无盘符残留「' + 话 + '」', !/[A-Za-z]:[\\/]/.test(结果.话), 结果.话)
    断言('无 .png 残留「' + 话 + '」', !/\.png\b/i.test(结果.话), 结果.话)
  }
}

console.log('== 4. 安全：正常聊天一个字都不能动 ==')
{
  const 正常 = [
    '雪里吃面，凳子上落了一层雪',
    '十二块还能无限加面，这价钱实在',
    '我画你：深色外套、眉毛浓、手里提着电脑',
    'C 语言和 a 不等于 b 这种写法要说清楚',
    '比分 3:2，罚球 5/6',
  ]
  for (const 话 of 正常) {
    const 结果 = 清群里的路径(话)
    断言('没被动过「' + 话 + '」', 结果.话 === 话 && !结果.全删了, '变成「' + 结果.话 + '」')
  }
}

console.log('== 5. 边界：空串、纯标点、路径夹在标点里 ==')
{
  断言('空串不算全删', 清群里的路径('').全删了 === false)
  断言('纯空白不算全删', 清群里的路径('   ').全删了 === false)
  const 夹 = 清群里的路径('（C:\\示例\\x.png）')
  断言('空括号被收掉', 夹.话 === '' && 夹.全删了 === true, '「' + 夹.话 + '」 全删=' + 夹.全删了)
  const 后 = 清群里的路径('C:\\示例\\x.png，帮我看一下')
  断言('路径后接中文逗号能保住后半句', 后.话.includes('帮我看一下'), 后.话)
}

console.log('')
console.log(败 === 0 ? `全部通过：${过}/${过}` : `失败 ${败} / 共 ${过 + 败}`)
process.exit(败 === 0 ? 0 : 1)
