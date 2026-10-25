// 本地化内容扫描：**作者机器上的东西不许进栖语**。
//
// 为什么要有这个：这套代码是从一台真在跑着的机器上抽出来的。抽的时候人手洗过一遍，
// 但洗完还会继续改 —— 改的时候很容易把「她的名字」「她的盘符」「她的会话 id」
// 又写回去（实测漏过一次：0.15.8 里有一条「有人加千语的好友」发到 npm 上了）。
//
// 所以规则写在一处，doctor 和 tools/扫本地化.mjs 共用这一份。
// 规则只抓**高信号**的东西，不追求覆盖一切：
//   · 误报会让人把检查关掉，那比不检查更糟
//   · 真正的判据还是那句「换一个陌生人来装，这个值还对吗？」
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative as 相对 } from 'node:path'

/** 抓什么、为什么 */
export const 规则 = [
  {
    名: '作者机器路径',
    正则: /[A-Za-z]:[\\/](?:AI|Users|档案|Tools)[\\/]/i,
    说明: '别人机器上不存在的盘符/目录（默认值里不许有）',
  },
  {
    名: '作者角色名',
    正则: /千语|小鱿鱼|大肥鱼/,
    说明: '作者自己角色的名字，不是通用值',
  },
  {
    名: '写死的会话 id',
    正则: /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    说明: '会话 id 每台机器都不一样，必须留空让人选',
  },
  {
    名: '写死的 QQ 号 / 群号',
    正则: /(?:自己QQ|私聊QQ|群号|群黑名单|白名单|黑名单)["']?\s*[:=]\s*["']?\d{6,}/,
    说明: '号码要读配置，不能当默认值',
  },
  {
    名: '凭证',
    正则: /(?:SESSDATA|bili_jct|access_token)["']?\s*[:=]\s*["'][^"'+$\s]{12,}["']/,
    说明: '令牌 / Cookie 绝不能进仓库',
  },
  {
    名: '写死的称呼',
    正则: /(?:selfName|ownerName)["']?\s*[:=]\s*["'][^"']{1,16}["']/,
    说明: '称呼默认留空，用角色包里的 character.json',
  },
]

/**
 * 允许的例外：**只能放"明显假的示例"或中性词**，并且每一条都要写清为什么。
 * 加之前先问自己：这条会不会让下一个作者以为「写死也行」？
 */
export const 允许 = [
  {
    正则: /session-0f1e2d3c-4b5a-6978-8c9d-0a1b2c3d4e5f/,
    说明: '文档/单测里的假 id（一眼能看出是示例）',
  },
  {
    正则: /(?:selfName|ownerName)["']?\s*[:=]\s*["']用户["']/,
    说明: '「用户」是对陌生人也成立的中性词，不是某个人的称呼',
  },
]

const 文本后缀 = /\.(js|mjs|json|md|tpl|yml|yaml|py|txt)$/i

function 数行(文, 下标) {
  let n = 1
  for (let i = 0; i < 下标 && i < 文.length; i++) if (文.charCodeAt(i) === 10) n++
  return n
}

function 走(路径, 出的) {
  let st
  try {
    st = statSync(路径)
  } catch (error) {
    return
  }
  if (st.isDirectory()) {
    let 名们 = []
    try {
      名们 = readdirSync(路径)
    } catch (error) {
      return
    }
    for (const 名 of 名们) {
      if (名 === 'node_modules' || 名 === '__pycache__' || 名.startsWith('.git')) continue
      走(join(路径, 名), 出的)
    }
    return
  }
  if (!文本后缀.test(路径)) return
  let 文 = ''
  try {
    文 = readFileSync(路径, 'utf8').replace(/^\uFEFF/, '')
  } catch (error) {
    return
  }
  出的.文件数++
  for (const r of 规则) {
    const 全局 = new RegExp(r.正则.source, r.正则.flags.includes('g') ? r.正则.flags : r.正则.flags + 'g')
    let m
    while ((m = 全局.exec(文))) {
      const 片段 = m[0]
      if (允许.some((a) => a.正则.test(片段))) continue
      出的.命中.push({
        文件: 相对(process.cwd(), 路径),
        行: 数行(文, m.index),
        规则: r.名,
        说明: r.说明,
        片段: 片段.length > 60 ? 片段.slice(0, 60) + '…' : 片段,
      })
      if (m.index === 全局.lastIndex) 全局.lastIndex++
    }
  }
}

/**
 * 扫一批目录（或单个文件）。
 * @returns {{命中: Array, 文件数: number}}
 */
export function 扫(路径们) {
  const 出 = { 命中: [], 文件数: 0 }
  for (const p of 路径们) 走(p, 出)
  return 出
}
