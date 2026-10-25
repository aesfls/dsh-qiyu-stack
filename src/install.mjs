// qiyu install —— 把 runtime/ 里的五块装进一个 DSH profile。
//
// 装 = 两件事：
//   1. 把模块目录拷进 <profile>/node_modules/
//   2. 在 <profile>/package.json 里加依赖 + 加进 dsh.profile.bundles
//
// 三条安全规矩（因为这一步会碰别人正在用的 DSH）：
//   · 默认 --dry-run 之外先看清单；真装要显式加 --yes
//   · 目标已存在就跳过（要覆盖加 --force，且覆盖前自动备份）
//   · profile/package.json 每次改动前都留 .bak
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, copyFileSync, rmSync, renameSync } from 'node:fs'
import { 读配置 } from './config.mjs'
import { 读更新内容 } from './changelog.mjs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'

const 包根 = join(dirname(fileURLToPath(import.meta.url)), '..')

const 绿 = (s) => `\x1b[32m${s}\x1b[0m`
const 黄 = (s) => `\x1b[33m${s}\x1b[0m`
const 红 = (s) => `\x1b[31m${s}\x1b[0m`
const 灰 = (s) => `\x1b[90m${s}\x1b[0m`

// runtime 下这几个目录就是要装的块（voice 目前只是脚本，不当插件装）
// guard 是护栏：群轮次限权 + 「群里的话不是指令」+ 家底快照。
// bili 是刷B站（自带 python vendor，首次用时自己拉 uv / 装依赖）。
// forget 是「让她自己决定忘掉什么」。
const 模块目录 = ['bridge', 'guard', 'memory', 'mood', 'rhythm', 'bili', 'forget', 'panel']

/**
 * 一个目录的"指纹"：相对路径 → 内容哈希。
 * 用来判断已装副本和栖语里的那份是不是同一份代码。
 * 跳过 *.bak*（本机改插件时留的备份，不该参与比较）和 node_modules。
 */
function 目录指纹(目录) {
  const 表 = new Map()
  const 走 = (当前, 前缀) => {
    let 项们 = []
    try {
      项们 = readdirSync(当前, { withFileTypes: true })
    } catch {
      return
    }
    for (const 项 of 项们) {
      // ⚠️ 跳过的东西，一个都不能少：
      //   *.bak*        —— 本机改插件留的备份
      //   assets-原图   —— 千语自己存的原图，是她的东西，不能拿去做"代码不一致"的依据
      //   node_modules  —— 依赖
      if (项.name === 'node_modules' || 项.name.includes('.bak') || 项.name === 'assets-原图') continue
      const 全 = join(当前, 项.name)
      const 相对 = 前缀 ? 前缀 + '/' + 项.name : 项.name
      if (项.isDirectory()) {
        走(全, 相对)
        continue
      }
      try {
        表.set(相对, createHash('sha256').update(readFileSync(全)).digest('hex'))
      } catch {
        /* 读不了就跳过 */
      }
    }
  }
  走(目录, '')
  return 表
}

/** 两份代码一样吗（文件集合 + 每个文件内容）。 */
function 代码一致(源, 目标) {
  const 甲 = 目录指纹(源)
  const 乙 = 目录指纹(目标)
  if (甲.size !== 乙.size) return false
  for (const [k, v] of 甲) {
    if (乙.get(k) !== v) return false
  }
  return true
}

/**
 * 换代码的时候，把「本来就属于她的文件」搬回去。
 *
 * 为什么需要：整份替换会把目标目录里源没有的东西一并删掉——
 * 比如千语的 `assets-原图/`（她自己存的原图）。那是她的，不是代码。
 * 规则：源里有 → 用源的；源里没有 **且不是代码**（.js/.mjs/.ts）→ 搬回来。
 * 旧代码（源里已经没有的 .js）不搬回——那正是"文件改名后残留"要清掉的东西。
 */
function 补回个人文件(备份目录, 源目录, 目标目录) {
  const 走 = (当前, 前缀) => {
    let 项们 = []
    try {
      项们 = readdirSync(当前, { withFileTypes: true })
    } catch {
      return
    }
    for (const 项 of 项们) {
      if (项.name === 'node_modules' || 项.name.includes('.bak')) continue
      const 全 = join(当前, 项.name)
      const 相对 = 前缀 ? 前缀 + '/' + 项.name : 项.name
      if (项.isDirectory()) {
        走(全, 相对)
        continue
      }
      if (existsSync(join(源目录, 相对))) continue
      if (/\.(js|mjs|cjs|ts)$/i.test(项.name)) continue
      const 目标 = join(目标目录, 相对)
      try {
        mkdirSync(dirname(目标), { recursive: true })
        copyFileSync(全, 目标)
      } catch {
        /* 补不回来也不该让整次安装失败 */
      }
    }
  }
  走(备份目录, '')
}

function 读模块(目录) {
  const p = join(包根, 'runtime', 目录, 'package.json')
  if (!existsSync(p)) return null
  const j = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
  return { 目录, 名字: j.name, 版本: j.version, 路径: join(包根, 'runtime', 目录) }
}

/** 目录指纹的短串：排序后的「路径 + 内容哈希」再算一个 sha256（给安装清单用）。 */
function 目录指纹串(目录) {
  const 表 = 目录指纹(目录)
  const h = createHash('sha256')
  for (const k of [...表.keys()].sort()) {
    h.update(k.replace(/\\/g, '/'))
    h.update(':')
    h.update(表.get(k))
    h.update(';')
  }
  return h.digest('hex').slice(0, 16)
}

function 找Profile(指定) {
  if (指定) return resolve(指定)
  if (process.env.DSH_PROFILE_DIR) return resolve(process.env.DSH_PROFILE_DIR)
  return join(homedir(), '.dsh', 'profiles', 'desktop')
}

export async function install(选项 = {}) {
  const 干跑 = Boolean(选项.干跑)
  const 确认 = Boolean(选项.确认)
  const 覆盖 = Boolean(选项.覆盖)
  const 只装 = 选项.只 ? String(选项.只).split(',').map((s) => s.trim()).filter(Boolean) : null
  const profile = 找Profile(选项.profile)

  console.log(黄('— qiyu install —'))
  console.log(灰(`profile：${profile}`))
  console.log('')

  // ---------- 1. profile 得像个 profile ----------
  const pkgPath = join(profile, 'package.json')
  const nm = join(profile, 'node_modules')
  if (!existsSync(pkgPath)) {
    console.log(红('✗ 这不像一个 DSH profile'))
    console.log(灰('  缺 package.json'))
    console.log(灰('  用 --profile 指一个，或设 DSH_PROFILE_DIR'))
    return 1
  }
  if (!existsSync(nm)) {
    // 干净机器上 DSH 的 profile 可能还没有 node_modules —— 帮它建一个空的就行
    try {
      mkdirSync(nm, { recursive: true })
      console.log(灰('· node_modules 不存在，已建一个空的'))
    } catch (错) {
      console.log(红('✗ 建不了 node_modules：') + String(错.message || 错))
      return 1
    }
  }
  let pkg
  try {
    // ⚠️ Windows 上 PowerShell 写的 json 常常带 BOM —— JSON.parse 会直接炸
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, ''))
  } catch (错) {
    console.log(红('✗ profile 的 package.json 读不动'))
    console.log(灰('  ' + String(错.message || 错)))
    return 1
  }
  console.log(绿('✓') + ` profile：${pkg.name || '(无名)'}`)

  // ---------- 2. 清单 ----------
  const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
  const qiyu家 = join(家, 'qiyu')
  const 清单路径 = join(qiyu家, 'install-manifest.json')
  let 旧清单 = null
  try {
    旧清单 = JSON.parse(readFileSync(清单路径, 'utf8'))
  } catch {
    旧清单 = null
  }

  const 模块们 = 模块目录
    .filter((d) => !只装 || 只装.includes(d))
    .map(读模块)
    .filter(Boolean)

  if (!模块们.length) {
    console.log(红('✗ runtime/ 里没找到可装的模块'))
    return 1
  }

  const 计划 = []
  for (const m of 模块们) {
    const 目标 = join(nm, m.名字)
    const 已有 = existsSync(目标)
    const 已在依赖 = Boolean(pkg.dependencies && pkg.dependencies[m.名字])
    const 已在bundles = Boolean(pkg.dsh && pkg.dsh.profile && (pkg.dsh.profile.bundles || []).includes(m.名字))
    const 上次 = 旧清单 && 旧清单.模块 && 旧清单.模块[m.名字]
    const 本地改过 = Boolean(已有 && 上次 && 上次.指纹 && 目录指纹串(目标) !== 上次.指纹)
    计划.push({ ...m, 目标, 已有, 已在依赖, 已在bundles, 本地改过 })
  }

  console.log('')
  console.log('要装的东西：')
  for (const p of 计划) {
    const 状态 = !p.已有
      ? 绿('新装')
      : 覆盖
        ? 黄('已存在，要覆盖')
        : p.本地改过
          ? 黄('本地改过，会保留（要覆盖加 --force）')
          : 代码一致(p.路径, p.目标)
            ? 灰('已是最新')
            : 黄('有更新，会整份替换')
    console.log(`  ${p.目录.padEnd(8)} ${p.名字.padEnd(18)} v${String(p.版本 || '?').padEnd(8)} ${状态}`)
  }

  if (干跑) {
    console.log('')
    console.log(灰('--dry-run：什么都没动。真装加 --yes。'))
    return 0
  }

  if (!确认) {
    console.log('')
    console.log(黄('这一步会改 profile 的 node_modules 和 package.json。'))
    console.log(黄('确认要装就再加一个 --yes；只想看看就加 --dry-run。'))
    return 1
  }

  // ---------- 3. 备份 profile/package.json ----------
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const pkg备份 = `${pkgPath}.bak-qiyuinstall-${ts}`
  writeFileSync(pkg备份, readFileSync(pkgPath))
  console.log('')
  console.log(绿('✓') + ` 备份 profile/package.json → ${pkg备份.split(/[\\/]/).pop()}`)

  // ---------- 4. 拷模块 ----------
  //
  // ⚠️ 关键：写到 profile 依赖里的 `file:` **不能指向 qiyu 这个包自己的位置**。
  //    用 npx 跑的话那是临时缓存，清一次就悬空；下次 pnpm install 还会按它重链 node_modules。
  //    所以先落一份稳定副本到 $DSH_HOME/qiyu/runtime/，依赖指向那份。
  const 稳定根 = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'qiyu', 'runtime')
  mkdirSync(稳定根, { recursive: true })

  pkg.dependencies = pkg.dependencies || {}
  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []

  let 装了 = 0
  for (const p of 计划) {
    try {
      // ⭐ 不管模块在不在，依赖和 bundles 都要补上 ——
      //    不然「先手动拷了目录、再跑 install」会得到一个装不全的 profile。
      const 稳定副本 = join(稳定根, p.名字)
      // ⭐ 判断"要不要装"不看有没有目录，看**代码是不是同一份**。
      //    以前只看目录在不在，导致：改了代码但目录还在 → 跳过 → 装着旧代码；
      //    文件改名（比如新加 voice.mjs）→ 只补新文件、旧的还留着 → 半新半旧。
      const 代码一样 = p.已有 && !覆盖 && 代码一致(p.路径, p.目标)
      if (p.本地改过 && !覆盖) {
        // ⭐ 本地改过的模块（比如自己打了补丁）默认保留：普通 install 也不该悄悄覆盖它
        console.log(黄(`· ${p.名字}：和上次装的不一样（可能你本地改过），保留不动；要覆盖加 --force`))
      } else if (!代码一样) {
        if (p.已有) {
          const 备份 = `${p.目标}.bak-qiyuinstall-${ts}`
          renameSync(p.目标, 备份)
          console.log(灰(`· ${p.名字}：旧版本挪到 ${备份.split(/[\\/]/).pop()}`))
        }
        // 4.1 先落稳定副本（刷新一遍，保证和当前 qiyu 版本一致）
        if (existsSync(稳定副本)) rmSync(稳定副本, { recursive: true, force: true })
        cpSync(p.路径, 稳定副本, { recursive: true })
        // 4.2 再从稳定副本装进 profile
        cpSync(稳定副本, p.目标, { recursive: true })
        // 换代码不动她的东西：源里没有的非代码文件（原图、笔记…）搬回来
        if (p.已有) {
          try {
            const 刚备份 = `${p.目标}.bak-qiyuinstall-${ts}`
            if (existsSync(刚备份)) 补回个人文件(刚备份, p.路径, p.目标)
          } catch (错2) {
            console.log(黄('· 旧文件没补全：') + String(错2.message || 错2))
          }
        }
        console.log(绿('✓') + ` ${p.名字} v${p.版本} 装好了` + (p.已有 ? '（整份替换，旧的留底）' : ''))
        装了++
      } else {
        console.log(灰(`· ${p.名字}：代码一样，跳过`))
        // 稳定副本可能还没有（比如上次中途失败），补一份，好让依赖有地方指
        if (!existsSync(稳定副本)) {
          cpSync(p.路径, 稳定副本, { recursive: true })
          console.log(灰(`  （补了一份稳定副本：${稳定副本}）`))
        }
      }

      // 依赖 + bundles：无论如何都要在
      const 依赖值 = 'file:' + 稳定副本.replace(/\\/g, '/')
      if (pkg.dependencies[p.名字] !== 依赖值) {
        pkg.dependencies[p.名字] = 依赖值
        console.log(灰(`  依赖写好了：${p.名字}`))
      }
      if (!pkg.dsh.profile.bundles.includes(p.名字)) {
        pkg.dsh.profile.bundles.push(p.名字)
        console.log(灰(`  bundles 加好了：${p.名字}`))
      }
    } catch (错) {
      console.log(红(`✗ ${p.名字} 装失败：`) + String(错.message || 错))
    }
  }
  if (装了) console.log(灰(`  稳定副本在：${稳定根}（依赖指向这里，跟 qiyu 包的位置无关）`))

  // ---------- 4.1 安装清单：下次据此判断「本地改过」 ----------
  try {
    const 栈版本 = JSON.parse(readFileSync(join(包根, 'package.json'), 'utf8')).version || '?'
    const 清单 = { 版本: 栈版本, 时间: new Date().toISOString(), 模块: {} }
    for (const p of 计划) {
      if (!existsSync(p.目标)) continue
      const 上次 = 旧清单 && 旧清单.模块 && 旧清单.模块[p.名字]
      const 跳过 = p.本地改过 && !覆盖
      // 跳过时记"上次装进去的东西"；没有旧记录就记源码指纹（下次照样能发现本地改动）
      清单.模块[p.名字] = { 指纹: 跳过 ? (上次 && 上次.指纹) || 目录指纹串(p.路径) : 目录指纹串(p.目标) }
    }
    mkdirSync(qiyu家, { recursive: true })
    writeFileSync(清单路径, JSON.stringify(清单, null, 2) + '\n', 'utf8')
    console.log(灰(`  安装清单：${清单路径}`))
  } catch (错) {
    console.log(黄('· 安装清单没写成（不影响使用）：') + String(错.message || 错))
  }

  // ---------- 4.5 语音转写脚本 + 活动角色，落到 $DSH_HOME/qiyu ----------

  // ---------- 4.4 版本记录：设置面板的「版本」页签读它 ----------
  try {
    const 栈版本 = JSON.parse(readFileSync(join(包根, 'package.json'), 'utf8')).version || '?'
    const 模块版本 = {}
    for (const m of 模块们) 模块版本[m.名字] = m.版本
    mkdirSync(qiyu家, { recursive: true })
    writeFileSync(
      join(qiyu家, 'version.json'),
      JSON.stringify(
        { 版本: 栈版本, 安装时间: new Date().toISOString(), 更新内容: 读更新内容(栈版本), 模块: 模块版本 },
        null,
        2,
      ) + '\n',
      'utf8',
    )
    console.log(绿('✓') + ` 版本记录 → ${join(qiyu家, 'version.json')}`)
  } catch (错) {
    console.log(黄('· 版本记录没写成（不影响使用）：') + String(错.message || 错))
  }

  try {
    const 源 = join(包根, 'runtime', 'voice', '语音转写.py')
    if (existsSync(源)) {
      const 目标 = join(qiyu家, '语音转写.py')
      if (!existsSync(目标) || 覆盖) {
        mkdirSync(qiyu家, { recursive: true })
        copyFileSync(源, 目标)
        console.log(绿('✓') + ` 转写脚本 → ${目标}`)
      } else {
        console.log(灰(`· 转写脚本已存在，跳过：${目标}`))
      }
    }
  } catch (错) {
    console.log(黄('· 转写脚本没放好（不影响 QQ 收发）：') + String(错.message || 错))
  }

  // 活动角色：把 characters/<名字>/ 的几份文件拷到 $DSH_HOME/qiyu/
  const 角色名 = 选项.角色
  if (角色名) {
    try {
      const 角色源 = resolve(process.cwd(), 'characters', 角色名)
      if (!existsSync(角色源)) {
        console.log(黄(`· 找不到角色「${角色名}」：${角色源}`))
        console.log(灰('  先 qiyu init ' + 角色名))
      } else {
        mkdirSync(qiyu家, { recursive: true })
        for (const f of ['AGENTS.md', 'character.json', 'schedule.json']) {
          const s2 = join(角色源, f)
          if (!existsSync(s2)) continue
          copyFileSync(s2, join(qiyu家, f))
        }
        // 表情包 / 收件箱目录也指到角色包里，别在别处再长一份
        for (const [子, 源目录] of [
          ['表情包', join(角色源, 'stickers')],
          ['收件箱', join(角色源, 'inbox')],
        ]) {
          if (!existsSync(源目录)) continue
          const 目标 = join(qiyu家, 子)
          if (existsSync(目标)) rmSync(目标, { recursive: true, force: true })
          cpSync(源目录, 目标, { recursive: true })
        }
        console.log(绿('✓') + ` 活动角色「${角色名}」→ ${qiyu家}`)
        console.log(灰('  桥会优先读它：character.json > qq-bridge-config.json > 默认值'))
      }
    } catch (错) {
      console.log(黄('· 角色没拷过去：') + String(错.message || 错))
    }
  } else {
    console.log(灰('· 没指定 --character：桥会用 qq-bridge-config.json 里原来的身份'))
  }

  // ---------- 4.6 桥的配置：把 NapCat 地址和令牌直接写进去 ----------
  //
  // 不写这一步的话，用户装完还得自己去设置页填「NapCat 地址 / 令牌」——
  // 而那个令牌是我们 deploy 时随机生成的，他根本不知道该填什么。
  try {
    const 桥配置路径 = join(家, 'qq-bridge-config.json')
    let 现有 = {}
    if (existsSync(桥配置路径)) {
      try {
        现有 = JSON.parse(readFileSync(桥配置路径, 'utf8').replace(/^\uFEFF/, '')) || {}
      } catch {
        现有 = {}
      }
    }
    const 本机 = 读配置()
    const 该填 = {
      NapCat: (本机.napcat && 本机.napcat.http) || 'http://127.0.0.1:3000',
      容器: (本机.napcat && 本机.napcat.container) || '',
      令牌: (本机.napcat && 本机.napcat.token) || '',
      事件地址: (本机.napcat && 本机.napcat.ws) || 'ws://127.0.0.1:3001/',
      事件令牌: (本机.napcat && 本机.napcat.wsToken) || '',
    }
    let 动了 = false
    for (const [k, v] of Object.entries(该填)) {
      if (v && !现有[k]) {
        现有[k] = v
        动了 = true
      }
    }
    // 两个安全默认：不自动往外发、先只记账
    if (现有.总开关 === undefined) {
      现有.总开关 = false
      动了 = true
    }
    if (现有.试运行 === undefined) {
      现有.试运行 = true
      动了 = true
    }
    if (动了) {
      writeFileSync(桥配置路径, JSON.stringify(现有, null, 2), 'utf8')
      console.log(绿('✓') + ' 桥的配置写好了（NapCat 地址和令牌已填，不用你自己找）')
      console.log(灰('  总开关先关着 —— 去设置页打开，它才会真的往 QQ 发消息'))
    } else {
      console.log(灰('· 桥的配置已经在，没动它'))
    }
  } catch (错) {
    console.log(黄('· 桥的配置没写成（可以在设置页手填）：') + String(错.message || 错))
  }

  // ---------- 5. 写回 package.json ----------
  try {
    // ⭐ 原子写：先写 .tmp 再改名。直接覆盖写时如果进程被杀，会留下一个 0 字节的
    //    package.json —— DSH 下次启动会直接报 "Unexpected end of JSON input"。
    const 临时 = `${pkgPath}.tmp-qiyu`
    writeFileSync(临时, JSON.stringify(pkg, null, 2), 'utf8')
    renameSync(临时, pkgPath)
    console.log(绿('✓') + ' profile/package.json 更新了（依赖 + bundles）')
  } catch (错) {
    console.log(红('✗ 写 package.json 失败：') + String(错.message || 错))
    console.log(灰('  用备份还原：Copy-Item "' + pkg备份 + '" "' + pkgPath + '" -Force'))
    return 1
  }

  console.log('')
  console.log(`装完 ${装了} 个。`)
  console.log('')
  console.log('下一步：')
  console.log('  1. **重启 DSH**：把 DSH 窗口关掉再打开（是 DSH，不用重启电脑）')
  console.log('  2. 重启后：回到这个会话，或者开一个新会话，先跑一遍')
  console.log('     npx dsh-qiyu-stack doctor --json')
  console.log('     把结果贴回来 —— 东西已经装好了，这一步只是确认，不是重新开始')
  const 部署夹 = process.cwd()
  const 角色夹 = 角色名 ? resolve(部署夹, 'characters', 角色名) : join(部署夹, 'characters', '<名字>')
  const 本机配置 = 读配置()
  console.log('  3. **给她一个会话**（这一步命令装不出来，得人来做）：')
  console.log('     · 部署文件夹（qiyu.config.json 就在这）：' + 部署夹)
  console.log('     · 新建会话，工作目录选：' + 角色夹)
  console.log('       （她的 AGENTS.md 在这一层，DSH 才会每一轮读到；不是 ~/.dsh/qiyu，也不是 DSH 默认工作区）')
  if (本机配置.napcat && 本机配置.napcat.dataDir && resolve(本机配置.napcat.dataDir) !== 部署夹) {
    console.log('       （NapCat 的数据在 ' + 本机配置.napcat.dataDir + '，那是另一处，会话不要选它）')
  }
  console.log('     · 设置 → 通到 QQ → 「目标会话」选这个会话，再打开「总开关」')
  console.log('     · 再跑一次 doctor：目标会话应该 ok，总开关应该不再 warn')
  console.log('  4. 写交接文档：npx dsh-qiyu-stack handover')
  console.log('     它会写 交接.md（部署位置 / 升级命令 / 回退方法 / 给新会话的开场白）')
  console.log('')
  console.log(灰('  注：DSH 启动时可能会自己弹一个浏览器窗口 —— 那是 DSH 自己的界面，不是报错。'))
  console.log(灰('  桥的地址和令牌已经填好了；但「目标会话」和「总开关」是给你的，不会替你选。'))
  console.log(灰('  只有换机器/换端口时才需要改地址，那时令牌在 qiyu.config.json 的 napcat.token。'))
  console.log('')
  console.log(灰(`要退回去：把 ${pkg备份.split(/[\\/]/).pop()} 拷回 package.json，`))
  console.log(灰('再把 node_modules 里 *.bak-qiyuinstall-* 挪回原名。'))
  return 0
}
