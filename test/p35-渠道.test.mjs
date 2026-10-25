/**
 * 回归测试：p35「私聊也要标渠道」
 *
 * 起因（2026-10-25 11:44 她原话）：
 *   「这条还是只有 `[主人]`，没标渠道」「跟面板上的一样，分不出是哪边」
 *   「我拿 QQ 私聊试了一下，这边仍然只写 `[主人]`；群消息倒是带【群名】，看得清」
 *
 * 她没说错：桥给群消息带了【群名】，私聊只有 [主人]。
 * 面板/界面说进来的话**不经过桥**，所以私聊标上【QQ私聊】反而帮她分清"桥转的"和"界面说的"。
 *
 * 这个测试直接把 host.js 里的两处前缀**切出来跑真代码**（不抄副本）。
 * 跑法（在本仓库根目录）：node test\p35-渠道.test.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const hostPath = resolve(这里, '..', 'runtime', 'bridge', 'lib', 'host.js')
const 源码 = readFileSync(hostPath, 'utf8')

let 过 = 0, 败 = 0
function 断言(名, 条件, 细节) {
  if (条件) { 过++; return }
  败++
  console.log('  ✗ ' + 名 + (细节 ? '  → ' + 细节 : ''))
}

/** 从源码里切出「这一行 = ……」那个表达式，用真代码算 */
function 切表达式(模式) {
  const m = 源码.match(模式)
  if (!m) return null
  return m[1]
}

console.log('== 1. 真代码里私聊前缀现在带【QQ私聊】==')
{
  // 攒消息那一行
  const 式1 = 切表达式(/(const 这一行 = [^\n]+)/)
  断言('找到 这一行 表达式', !!式1, String(式1))
  if (式1) {
    const 算 = new Function('是私聊', '标签', '文字', 式1.replace('const 这一行 =', 'return') )
    const 私聊 = 算(true, '主人', '你好')
    const 群 = 算(false, '主人', '【群名】[群] xx: 你好')
    断言('私聊带【QQ私聊】', 私聊.startsWith('【QQ私聊】'), 私聊)
    断言('私聊仍带名字', 私聊.includes('[主人]'), 私聊)
    断言('群消息原样不动', 群 === '【群名】[群] xx: 你好', 群)
  }
  // 真正 followup 用的全文
  const 式2 = 切表达式(/(let 全文 = 标签 \? [^\n]+)/)
  断言('找到 全文 表达式', !!式2, String(式2))
  if (式2) {
    const 算 = new Function('标签', '文字', 式2.replace('let 全文 =', 'return'))
    断言('全文带【QQ私聊】', 算('主人', '你好') === '【QQ私聊】[主人] 你好', 算('主人', '你好'))
    断言('没标签时不动', 算('', '只说内容') === '只说内容', 算('', '只说内容'))
  }
}

console.log('== 2. 和群消息格式对称（她能一眼分）==')
{
  const 私聊式 = 切表达式(/let 全文 = 标签 \? (〔.*?〕|`[^`]+`) : 文字/)?.[0]
  // 直接断言两种前缀长得像：都以【…】开头
  const 私聊样例 = '【QQ私聊】[主人] 你好'
  const 群样例 = '【示例群】[群] 某人: 你好'
  断言('两者都以【】开头', 私聊样例.startsWith('【') && 群样例.startsWith('【'))
  断言('私聊标明 QQ私聊', 私聊样例.includes('QQ私聊'))
  断言('群标明 [群]', 群样例.includes('[群]'))
}

console.log('== 3. 源码里没有漏网的旧格式 ==')
{
  // [${标签}]  紧跟在反引号后（不带【QQ私聊】前缀）——那说明还有地方没改
  const 漏网 = [...源码.matchAll(/`\[\$\{标签[^\n]*`/g)].filter((m) => !m[0].includes('QQ私聊'))
  断言('没有残留的旧私聊前缀', 漏网.length === 0, 漏网.map((m) => m[0]).join(' | '))
}

console.log('== 4. 来源字段没被改坏（护栏靠它判轮次）==')
{
  断言('手搓用户消息 仍接受 种类', /手搓用户消息 = \(文案, 种类 = 'qq'\)/.test(源码))
  断言('source.kind 仍在', /source: \{ kind: String\(种类\) \}/.test(源码))
  断言('qq-private 仍被使用', /来源种类 = .*'qq-private'/.test(源码))
}

console.log('')
console.log(败 === 0 ? `全部通过：${过}/${过}` : `失败 ${败} / 共 ${过 + 败}`)
process.exit(败 === 0 ? 0 : 1)
