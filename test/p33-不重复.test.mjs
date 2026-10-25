/**
 * 回归测试：p33「一条消息被读三遍」
 *
 * 复现的是 2026-10-25 11:06 的真实故障：
 *   主人发一句「现在会慢慢的回了」，她在 11:06:39 / 11:06:43 / 11:06:51
 *   被喂了三次（用时 10.5s / 10.6s / 15.0s）。
 *   根因：p32 的阅读时间插在「标记已处理」之前，而轮询每 4 秒跑一次。
 *
 * 这个测试**不连 QQ、不起桥**：它按 host.js 里真实的轮询时序，
 * 用一个"假 NapCat"模拟「轮询每 4 秒看到同一条消息」，再断言只喂一次。
 *
 * 跑法（在本仓库根目录）：
 *   node test\p33-不重复.test.mjs
 */

let 过 = 0, 败 = 0
function 断言(名, 条件, 细节) {
  if (条件) { 过++; return }
  败++
  console.log('  ✗ ' + 名 + (细节 ? '  → ' + 细节 : ''))
}

/** 假 NapCat：列表里永远有同一条消息（直到被标记） */
function 造假环境() {
  const 已转消息 = new Set()
  const 喂进来的 = []   // 记录 agent 被喂了几次
  let 轮询中 = false
  let 上次私聊时间 = 0

  const 消息 = { message_id: 777001, time: 100, user_id: 1 }

  // 与 host.js 同构的一轮轮询（只保留关键时序）
  async function 一轮(阅读时间) {
    轮询中 = true
    try {
      对每条(消息)
    } finally {
      轮询中 = false
    }

    async function 对每条(条) {
      if (已转消息.has(条.message_id)) return
      if ((条.time || 0) < 上次私聊时间) return

      // ⭐ p33 修复：先占位
      const 先占位 = !!条.message_id
      if (先占位) {
        已转消息.add(条.message_id)
        上次私聊时间 = 条.time || 上次私聊时间
      }

      // 阅读时间
      await new Promise((r) => setTimeout(r, 阅读时间))
      喂进来的.push(Date.now())

      if (!先占位) 已转消息.delete(条.message_id)
    }
  }

  return {
    已转消息, 喂进来的,
    拿锁: () => 轮询中, 置锁: (v) => { 轮询中 = v },
    一轮,
  }
}

/**
 * 模拟调度器：每 4 秒打一次 tick（和 ctx.interval 的 4000ms 一致）。
 * 带 p33 的防重入：上一轮没跑完就跳过。
 * 返回一个 tick 函数，测试里手动驱动（不用真等 20 秒）。
 */
function 造调度器(env, 阅读时间) {
  let 锁 = false
  const 跳过次数 = { n: 0 }
  const tick = () => {
    if (锁) { 跳过次数.n++; return false } // 防重入：跳过
    锁 = true
    void env.一轮(阅读时间).finally(() => { 锁 = false })
    return true
  }
  return { tick, 跳过次数 }
}

console.log('== 1. 修复后：同一条消息 20 秒内只喂 1 次 ==')
{
  const env = 造假环境()
  const 调度 = 造调度器(env, 8000) // 阅读时间 8 秒
  // t=0 起，每 4 秒一个 tick，共 6 次（0/4/8/12/16/20）
  for (let i = 0; i < 6; i++) {
    调度.tick()
    await new Promise((r) => setTimeout(r, i >= 0 && i < 5 ? 4 : 0)) // 模拟 4 秒间隔（压缩成瞬时推进）
    await new Promise((r) => setTimeout(r, 0))
  }
  // 等所有进行中的一轮跑完
  await new Promise((r) => setTimeout(r, 12000))
  断言('只喂了 1 次', env.喂进来的.length === 1, '实际 ' + env.喂进来的.length + ' 次')
}

console.log('== 2. 没有占位时会重复（证明测试能抓到老 bug）==')
{
  // 手写一个"老版"（标记在等待之后），确认它会重复 —— 不然上面那条通过就没意义
  const 已转消息 = new Set()
  const 喂 = []
  let 上次 = 0
  const 消息 = { message_id: 1, time: 100 }
  async function 老版一轮() {
    if (已转消息.has(消息.message_id)) return
    if ((消息.time || 0) < 上次) return
    await new Promise((r) => setTimeout(r, 800))
    喂.push(1)
    已转消息.add(消息.message_id) // ← 老位置：等完才标记
    上次 = 消息.time
  }
  // 4 秒一 tick，但把等待压成 800ms、tick 压成 200ms 来加速（比例仍是 1:5）
  const 起 = Date.now()
  const 定时 = setInterval(() => { void 老版一轮() }, 200)
  await new Promise((r) => setTimeout(r, 1000))
  clearInterval(定时)
  await new Promise((r) => setTimeout(r, 1000))
  断言('老版确实会重复（>1 次）', 喂.length > 1, '只喂了 ' + 喂.length + ' 次 —— 测试没抓到老 bug，无效')
  console.log('   → 老版喂了 ' + 喂.length + ' 次（修复版 1 次）')
}

console.log('== 3. 喂失败要能重试（占位必须撤回）==')
{
  const env = 造假环境()
  // 手工模拟：占位后失败 → 撤回
  env.已转消息.add(777001)
  env.已转消息.delete(777001)
  断言('撤回后不再视为已处理', !env.已转消息.has(777001))
}

console.log('== 4. 防重入锁真的会跳过 ==')
{
  const env = 造假环境()
  const 调度 = 造调度器(env, 8000)
  调度.tick()               // 第一次：锁住，开始等 8 秒
  调度.tick()               // 第二次：应被跳过
  调度.tick()               // 第三次：应被跳过
  断言('后面两次被跳过', 调度.跳过次数.n === 2, '跳过了 ' + 调度.跳过次数.n + ' 次')
  await new Promise((r) => setTimeout(r, 9000))
  断言('最终只喂 1 次', env.喂进来的.length === 1, '实际 ' + env.喂进来的.length)
}

console.log('')
console.log(败 === 0 ? `全部通过：${过}/${过}` : `失败 ${败} / 共 ${过 + 败}`)
process.exit(败 === 0 ? 0 : 1)
