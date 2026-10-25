/**
 * dsh-forget —— 让她自己决定忘掉什么
 * ============================================================================
 * 起因：她的会话会一直变长。一堆没意义的群消息占着位置，每轮都要重读一遍。
 *
 * 设计（踩过一个坑才定成这样）：
 *   DSH 自带的压缩，摘要模板是「给编程助手用的英文工程总结」
 *   （Primary Request and Intent / Files and Code / Errors and Fixes……），
 *   套在一个 12 岁孩子身上完全不搭。所以这里的「记得什么」**不依赖系统摘要**：
 *   她自己先用 remember 把要紧的事记下，然后 forget 只负责把前面那一大段从心上腾走。
 *
 *   ⚠️ 顺序很重要：先 remember，再 forget。忘掉的该是「真不重要的」，
 *      不是「刚才忙活但还没记下的」。
 *
 * ⚠️ 底层用 DSH 官方压缩（ctx.compaction.compactNow），跟打 `/compact` 同一条路：
 *    · 被压缩的那段原文只是**不再进上下文**，会话日志里还在，不是真删；
 *    · 压缩后留一个系统摘要 checkpoint，她下一轮会看到它（英文工程格式，别指望像日记）。
 * ⚠️ 一次只能压缩**一段较早的连续历史**，不能挑着删中间某几句——DSH 的约束。
 * ⚠️ compactNow 要求 agent 空闲（它内部走 runMaintenance 排队）。她在工具里调的时候
 *    自己正忙着，所以这个调用会排到「这一轮结束之后」再落地——这是对的，
 *    别在工具里等它返回结果再回复她。
 * ============================================================================
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 模块级探针：能走到这儿说明「模块被 import 了」 */
try {
  const 目录 = join(homedir(), '.dsh', 'forget')
  mkdirSync(目录, { recursive: true })
  appendFileSync(join(目录, 'diag.log'), `${new Date().toISOString()}  [模块已加载] dsh-forget/lib/host.js 被 import\n`, 'utf8')
} catch (error) {}

// ⚠ 照 fish-memory / bili 的写法：导出名用「短名」，跟 cordis.patch.yml 里的 id 保持一致。
//   （19:xx 那次用 'dsh-forget' 一直加载不上，短名跟别的插件一致更稳）
export const name = 'forget'

export const inject = ['compaction', 'tools', 'agents']

const 文 = (内容) => ({ content: [{ type: 'text', text: String(内容) }] })

export function apply(ctx) {
  // 一进来就写一条，用来确认宿主到底有没有加载这个插件
  try {
    const 目录0 = join(homedir(), '.dsh', 'forget')
    mkdirSync(目录0, { recursive: true })
    appendFileSync(join(目录0, 'diag.log'), `${new Date().toISOString()}  [apply 被调用] 宿主执行到了 apply()\n`, 'utf8')
  } catch (error) {}
  const 记账 = (t) => {
    const 行 = `${new Date().toISOString()}  ${t}`
    try {
      ctx.logger?.info?.(`[dsh-forget] ${t}`)
    } catch (error) {}
    // 也写一份文件：宿主日志翻起来麻烦，排障直接看这个
    try {
      const 目录 = join(homedir(), '.dsh', 'forget')
      mkdirSync(目录, { recursive: true })
      appendFileSync(join(目录, 'diag.log'), 行 + '\n', 'utf8')
    } catch (error) {}
  }

  /** 当前跟我说话的这个会话的 agent（拿不到就不猜） */
  const 当前agent = () => {
    try {
      return ctx.agents?.currentInitiator?.() || null
    } catch (error) {
      return null
    }
  }

  ctx.tools.register({
    name: 'forget',
    description: [
      '把聊过的一大段「从心上腾走」，腾出地方继续聊。像人一样：不重要的事过一阵就淡了。',
      '',
      '⚠️ 用之前先想清楚：这段里有没有想留的？想留就先 remember 记下，再来 forget。',
      '   forget 之后那段就不在你眼前了，只剩一个很简略的系统提要。',
      '',
      '什么时候用：',
      '- 前面一大段都是没营养的闲聊、刷屏、跟你没关系的话',
      '- 已经过去的小事，不值得一直挂着',
      '',
      '什么时候别用：',
      '- 刚聊过的重要内容还没记下来（先 remember）',
      '- 还接着话头正聊着（会打断）',
    ].join('\n'),
    parameters: {
      原因: {
        type: 'string',
        description: '一句话说说为什么想放下这段（写给你自己看，也方便爸爸回看）。',
      },
    },
    async execute(args) {
      const agent = 当前agent()
      if (!agent) return 文('现在没法整理——不知道是在哪个会话里。等你在对话里跟我说话时再说。')

      const 原因 = String((args && args.原因) || '').trim()
      const 标签 = 原因 || '（没写原因）'

      try {
        const 结果 = await ctx.compaction.compactNow(agent, new AbortController().signal)

        if (结果 === null) {
          return 文('这会儿没什么可整理的——前面的东西还挺短，或者刚整理过。先接着聊吧。')
        }

        const 条数 = Array.isArray(结果.shadowedSeqs) ? 结果.shadowedSeqs.length : 0
        const 腾出 = Number(结果.shadowedTokenCount) || 0
        记账(`她自己整理了 ${条数} 条、约 ${腾出} tokens｜原因：${标签}`)

        return 文(
          `整理好了。前面那一大段（${条数} 条，约 ${腾出} 个字）从心上腾走了。` +
            `\n剩下的只有一个很简略的提要，说不细。` +
            `\n\n要是刚才那段里还有没记下的要紧事，趁现在还记得，用 remember 补一下。`,
        )
      } catch (error) {
        const code = error && error.code
        if (code === 'busy') return 文('现在正忙（可能刚整理过，或者我还在回上一条）。等这一轮说完再试。')
        if (code === 'cancelled') return 文('这次整理被中断了，什么都没改。')
        if (code === 'changed') return 文('我刚才整理的时候，聊的内容又变了。再说一次就行。')
        if (code === 'summary') return 文('没能整理出个像样的提要，所以什么都没动。要不换个时候再试？')
        记账(`整理失败 code=${code} err=${String((error && error.message) || error)}`)
        return 文('整理没成功：' + String((error && error.message) || error))
      }
    },
  })

  记账('forget 工具已挂上（她自己决定忘什么）')
}
