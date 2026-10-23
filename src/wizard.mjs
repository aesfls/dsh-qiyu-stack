// qiyu init 的交互向导 —— 几个问题，每个都有默认值，回车就过。
import { createInterface } from 'node:readline'
import { init, 作息档, 默认答案 } from './init.mjs'

const 绿 = (s) => `\x1b[32m${s}\x1b[0m`
const 黄 = (s) => `\x1b[33m${s}\x1b[0m`
const 灰 = (s) => `\x1b[90m${s}\x1b[0m`

function 开问() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (问, 兜底 = '') =>
    new Promise((解决) => {
      const 提示 = 兜底 ? `${问} ${灰('[' + 兜底 + ']')} ` : `${问} `
      rl.question(提示, (答) => 解决(String(答 || '').trim() || 兜底))
    })
  return { rl, ask }
}

const 选 = async (ask, 标题, 选项, 默认序号) => {
  console.log('')
  console.log(标题)
  选项.forEach((o, i) => console.log(`  ${i + 1}. ${o.名}${o.说明 ? 灰('　—— ' + o.说明) : ''}`))
  const 答 = await ask('选一个：', String(默认序号))
  const n = Number(答)
  return 选项[n - 1] || 选项[默认序号 - 1]
}

export async function wizard() {
  const { rl, ask } = 开问()
  try {
    console.log('')
    console.log(黄('— 栖语 · 建一个角色 —'))
    console.log(灰('  每个问题都有默认值，直接回车就行。'))
    console.log('')

    // ① 名字（必填）
    let 名字 = ''
    while (!名字) 名字 = await ask('ta 叫什么？')
    // 名字定了以后，后面的话就用名字称呼
    const 我 = 名字

    // ② QQ 号
    const qq = await ask(`\n${我} 自己的 QQ 号？（可以留空，登录后自动认）`, '')

    // ③ 称呼
    const 称呼 = await ask(`\n你希望 ${我} 怎么称呼你？`, 默认答案.称呼)

    // ④ 作息
    console.log('')
    console.log(`作息决定「什么时候 ${我} 被叫醒」：`)
    console.log(灰('   · 休息：无论谁找都攒着，到下一时段一起处理'))
    console.log(灰('   · 惰性：只有私聊和 @ 才立刻唤醒，其他消息到下一时段统一处理'))
    console.log(灰('   · 活跃：正常'))
    console.log(灰('  选错不会坏，改 schedule.json 随时能调。'))
    const 作息 = await 选(
      ask,
      `你希望 ${我} 的作息是——`,
      [
        { 名: 作息档.regular.名, 说明: 作息档.regular.说明, 值: 'regular' },
        { 名: 作息档.night.名, 说明: 作息档.night.说明, 值: 'night' },
        { 名: 作息档.always.名, 说明: 作息档.always.说明, 值: 'always' },
      ],
      1
    )

    // ⑤ 性格
    console.log('')
    console.log('性格只影响两件事：说话的语气、主动开口的意愿。')
    console.log(灰('它不影响安全边界（不刷屏、群里不乱接话、不编记忆、不泄露配置）——'))
    console.log(灰('那些是行为层的默认，写在模板里，跟性格无关。'))
    console.log(灰(`现在留白也完全能跑，只是 ${我} 说话会比较平。`))
    console.log('')
    console.log(灰(`性格文件里的内容，${我} 每一轮都会重读，也写得动。所以你写的是起点，不是终点。`))
    const 性格 = await 选(
      ask,
      `要现在给 ${我} 一点性格吗？（以后随时能改）`,
      [
        { 名: '留白', 说明: '什么都不写，说话会比较平，但能跑', 值: 'blank' },
        { 名: '温和陪伴', 说明: '软一点，会等你说完，不急着给结论', 值: 'gentle' },
        { 名: '简洁助手', 说明: '短、直接，先给结论再补半句原因，不寒暄', 值: 'concise' },
      ],
      1
    )

    // ⑥ 能不能自己改性格
    const 自改 = await 选(
      ask,
      `${我} 能自己改性格吗？`,
      [
        { 名: '改之前先问一声', 说明: '推荐：她能改，但会先征求你同意', 值: 'ask' },
        { 名: '可以自己改', 说明: '她可以照着相处下来的感受调整自己', 值: 'free' },
        { 名: '不许改', 说明: '性格只由你定，她只读不写', 值: 'locked' },
      ],
      1
    )

    console.log('')
    console.log(灰('— 记下了，开始建 —'))
    const 码 = await init(名字, {
      答案: {
        qq,
        称呼,
        作息: 作息.值,
        性格: 性格.值,
        自改: 自改.值,
      },
    })
    return 码
  } finally {
    rl.close()
  }
}
