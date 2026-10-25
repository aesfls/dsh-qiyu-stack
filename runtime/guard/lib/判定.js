// 纯判定：不碰文件、不碰 ctx，方便离线单测。
//
// 一句话：**这一轮如果是从 QQ 群（或外头）进来的话，就把它手上的危险能力掐掉。**
// 判定只回答"该不该拒"，怎么拒（干跑 / 真拒）由调用方决定。

/** 会话 id 规整：有的地方带 `session-` 前缀，有的不带，比较时统一去掉。 */
export function 规整会话(id) {
  const s = String(id == null ? '' : id).trim()
  return s.startsWith('session-') ? s.slice('session-'.length) : s
}

/** 白名单转成 Set（配置里可能是数组、逗号串，或者根本没写）。 */
export function 白名单集(配置) {
  const 原 = 配置 && 配置.白名单
  const 名单 = Array.isArray(原)
    ? 原
    : String(原 == null ? '' : 原).split(/[,，\s]+/).filter(Boolean)
  return new Set(名单.map((x) => String(x).trim()).filter(Boolean))
}

/**
 * 判定一次工具调用。
 *
 * @param {object} 参数
 * @param {object} 参数.配置      读出来的配置对象
 * @param {string} 参数.会话id    这次调用属于哪个会话
 * @param {string} 参数.工具名    模型要调的工具名
 * @param {boolean} 参数.是否外部轮 这一轮是不是从 QQ 群/外头来的
 * @returns {null | {拒: true, 工具名: string, 说: string}} null = 放行
 */
export function 判定({ 配置, 会话id, 工具名, 是否外部轮 }) {
  if (!配置 || 配置.开关 !== true) return null

  // 目标会话留空 = 管所有会话；填了就只管那一个（别的会话，比如维护用的，一律不碰）
  const 目标 = 规整会话(配置.目标会话)
  if (目标 !== '' && 规整会话(会话id) !== 目标) return null

  if (!是否外部轮) return null

  const 名 = String(工具名 == null ? '' : 工具名)
  if (名 === '') return null
  if (白名单集(配置).has(名)) return null

  // ⭐ 2026-10-24 19:40：**拒绝的时候顺手告诉他该走哪条路**。
  //   起因：她在群里想"缩图再发"，一次次去调 pwsh（被拒）、write（被拒），
  //   明明 qq_sticker 已经支持「宽」、qq_draw 已经能直接发 —— 她不知道。
  //   与其让她盯着"这轮做不了"放弃，不如每次拒绝都把正确做法写在她脸上。
  const 提示 = (() => {
    if (/^(pwsh|bash|terminal|run_code)$/i.test(名)) {
      return '要发图不用跑命令：qq_sticker 填「发哪张」+「群」+「宽 400」，它自己等比缩；'
        + '要画新的：qq_draw 填「群」，画完直接发。'
    }
    if (/^(write|edit|str_replace_editor)$/i.test(名)) {
      return '写文件不是发图的必经之路：qq_sticker（可带「宽」）或 qq_draw（带「群」）就够，不用落盘。'
    }
    if (/^remember$/i.test(名)) {
      return '这一轮不写长期记忆（防止别人塞进来的话被记住）。'
    }
    if (/^present$/i.test(名)) {
      return '面板展示也先不收；要给人看就 qq_sticker 发出去。'
    }
    return ''
  })()

  return {
    拒: true,
    工具名: 名,
    说:
      '这条是 QQ 群里（或外头）进来的话，不是主人直接跟你说的。这一轮只给你回话、看图、画图、发图，别的先不收。'
      + (提示 ? '💡 ' + 提示 : '')
      + '⚠ 你这一轮确实没跑成——别把之前的结果当成这次跑出来的，直接说这轮做不了就行。',
  }
}
