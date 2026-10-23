// qiyu handover —— 在部署文件夹里生成「交接.md」。
//
// 为什么要有这个：部署完那一刻，负责装的 agent 最清楚所有路径和状态；
// 过几天用户想升级 / 换会话 / 回退，新会话只能从一份文档开始。
// 这份文档就是那次「交接」。
import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 读配置, 配置文件路径 } from './config.mjs'
import { 探测DSH } from './dsh-port.mjs'

const 包根 = join(dirname(fileURLToPath(import.meta.url)), '..')

function 版本() {
  try {
    return JSON.parse(readFileSync(join(包根, 'package.json'), 'utf8')).version || '?'
  } catch {
    return '?'
  }
}

function 时间() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 角色名：参数 > 配置 > characters/ 里唯一那个 */
function 找角色(配置, 指定) {
  if (指定) return 指定
  if (配置.角色) return 配置.角色
  try {
    const 根 = resolve(process.cwd(), 配置.character || 'characters')
    if (!existsSync(根)) return ''
    const 候选 = readdirSync(根).filter((n) => {
      try {
        return statSync(join(根, n)).isDirectory()
      } catch {
        return false
      }
    })
    return 候选.length === 1 ? 候选[0] : ''
  } catch {
    return ''
  }
}

/** 从角色包里读 QQ（桥没跑的时候兜底） */
function 角色里的QQ(角色目录) {
  try {
    const j = JSON.parse(readFileSync(join(角色目录, 'character.json'), 'utf8').replace(/^\uFEFF/, ''))
    return { qq: String(j.qq || j.QQ || ''), 称呼: j.称呼 || '' }
  } catch {
    return { qq: '', 称呼: '' }
  }
}

async function 桥状态(配置) {
  try {
    const 探测 = await 探测DSH({ 已知端口: 配置.dsh.port })
    if (!探测 || !探测.有桥) return null
    const r = await fetch(`http://127.0.0.1:${探测.端口}/dsh-qq-bridge/state`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return null
    return { 端口: 探测.端口, 状态: await r.json() }
  } catch {
    return null
  }
}

function 开关(v) {
  return v === true ? '开' : v === false ? '关' : '（未知）'
}

export async function handover({ 角色: 指定角色 = '', 输出 = '交接.md' } = {}) {
  const cwd = process.cwd()
  const 配置 = 读配置()
  const 名字 = 找角色(配置, 指定角色)
  if (!名字) {
    console.error('✗ 没找到角色。指定一下：qiyu handover --character <名字>')
    console.error('  （或者在部署文件夹里跑，characters/ 下只有一个角色时也能自动认）')
    return 1
  }

  const 角色目录 = resolve(cwd, 配置.character || 'characters', 名字)
  const 有角色 = existsSync(角色目录)
  const 有AGENTS = existsSync(join(角色目录, 'AGENTS.md'))
  const 角色信息 = 有角色 ? 角色里的QQ(角色目录) : { qq: '', 称呼: '' }
  const 桥 = await 桥状态(配置)
  const 桥配置 = (桥 && 桥.状态 && 桥.状态.配置) || {}
  const NapCat = (桥 && 桥.状态 && 桥.状态.NapCat状态) || null
  const qq = (NapCat && NapCat.用户) || 角色信息.qq || '（还没填）'
  const 昵称 = (NapCat && NapCat.昵称) || 名字
  const 目标会话 = 桥配置.目标会话 || ''
  const 目标标题 =
    (桥 && Array.isArray(桥.状态.目标情况) && 桥.状态.目标情况[0] && 桥.状态.目标情况[0].标题) || ''
  const 数据目录 = (配置.napcat && 配置.napcat.dataDir) || ''
  const 数据目录显示 = 数据目录 ? '`' + 数据目录 + '`' : '（没记录，deploy --dir 时指定的那个）'
  const 容器 = (配置.napcat && 配置.napcat.container) || 'napcat-qq'

  const 路径 = resolve(cwd, 输出)
  if (existsSync(路径)) {
    const 备份 = `${路径}.bak-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`
    try {
      renameSync(路径, 备份)
    } catch {
      // 备份不了就直接覆盖
    }
  }

  const 内容 = `# 栖语部署交接

> 生成时间：${时间()}
> 这份是给「以后接手的人 / 新会话」看的：升级、迁移、回退都从这份开始。
> ⚠️ 里面有 QQ 号和本机路径，**别公开、别提交到公开仓库**。

## 一句话

「${名字}」跑在 \`${cwd}\`，QQ ${qq}（${昵称}）${目标会话 ? `，桥盯的会话是 \`${目标会话}\`` : '，**桥还没选目标会话**'}。

## 部署位置

| 东西 | 路径 |
|---|---|
| 部署文件夹 | \`${cwd}\` |
| 她的角色包 | \`${角色目录}\`${有角色 ? '' : '（**不存在**，先 qiyu init）'} |
| 她的 AGENTS.md | \`${join(角色目录, 'AGENTS.md')}\`${有AGENTS ? '' : '（**不存在**，她会没有性格）'} |
| NapCat 数据 | ${数据目录显示} |
| qiyu 配置 | \`${配置文件路径()}\`（**含令牌，别外传**） |

## 现在怎么跑

- 容器：\`${容器}\`（Docker 里的 Linux QQ + NapCat）
- 端口：3000 OneBot HTTP ／ 3001 WS ／ 6099 WebUI
- 桥：目标会话 ${目标标题 ? `「${目标标题}」` : '（没选）'}${目标会话 ? ` \`${目标会话}\`` : ''}｜总开关：${开关(桥配置.总开关)}｜试运行：${开关(桥配置.试运行)}
- 自检：\`npx dsh-qiyu-stack doctor --json\`

## 她的会话（重建时看这里）

会话的工作目录必须是**她的角色包**：\`${角色目录}\`。

> DSH 只会自动读工作目录根上的 AGENTS.md；选错地方，她会变成没有性格的默认助手。

重建步骤：DSH 新建会话 → 工作目录选上面那个路径 → 设置 → 通到 QQ →
「目标会话」选这个会话 → 打开「总开关」。

## 以后升级到新版本（GitHub / npm）

在部署文件夹里：

\`\`\`bash
npx dsh-qiyu-stack@latest preflight --json
npx dsh-qiyu-stack@latest install --character ${名字} --yes
\`\`\`

然后**重启 DSH**（关掉窗口再开，不用重启电脑），再：

\`\`\`bash
npx dsh-qiyu-stack@latest doctor --json
\`\`\`

\`install\` 会按内容替换运行时代码，**保留她的角色包和个人文件**；
改 \`package.json\` 前会留 \`.bak-qiyuinstall-<时间>\` 备份。

## 回退

- 代码回退：把 profile 里 \`package.json.bak-qiyuinstall-*\` 拷回原名，
  再把 \`node_modules/*.bak-qiyuinstall-*\` 挪回原名，重启 DSH
- NapCat 不用动：容器、登录态、数据目录都在 ${数据目录显示}

## 新会话开场白（直接复制给它）

> 你接手一个已经部署好的栖语实例，部署文件夹是 \`${cwd}\`。
> 先读 \`${join(cwd, '交接.md')}\`，再跑 \`npx dsh-qiyu-stack doctor --json\`，
> 把结果和你要做的事告诉我。要升级就先跑
> \`npx dsh-qiyu-stack@latest install --character ${名字} --yes\`，然后提醒我重启 DSH。

## 用户自己补

- [ ] 这份文档之外，还有没有别的改动（改过端口 / 换过号 / 装过别的插件）？
- [ ] 备份放哪：______________________
- [ ] 有哪些已知问题：______________________

---

由 \`dsh-qiyu-stack@${版本()}\` 生成。
`

  try {
    writeFileSync(路径, 内容, 'utf8')
  } catch (错) {
    console.error('✗ 写不了交接文档：' + String(错.message || 错))
    return 1
  }

  console.log('✅ 交接文档写好了：' + 路径)
  console.log('')
  console.log('  里面有：部署位置、QQ、容器、桥的目标会话、升级命令、回退方法、给新会话的开场白。')
  if (!有AGENTS) console.log('  ⚠️ 注意：她的 AGENTS.md 不存在，先 qiyu init 或把人设补上。')
  if (!目标会话) console.log('  ⚠️ 桥还没选「目标会话」——去 设置 → 通到 QQ 选一个，再跑一次 qiyu handover。')
  console.log('  提醒用户：这份含 QQ 号，别公开。')
  return 0
}
