#!/usr/bin/env node
// 把「每个插件在设置左侧栏各占一项」合并成「一个插件页 + 多个页签」。
//
// DSH 本身就有这个槽位：settings.plugins.tab
//   "One page inside the Plugins settings section. The section owner renders
//    localized entry labels as tabs and mounts each contribution inside its
//    corresponding tab panel."
//
// 做法：把插件 client.js 里的 'settings.section' 字面量换成 'settings.plugins.tab'。
// 改完刷新页面即可（DSH 的 client bundle 按文件 mtime 算版本号，不用重启 DSH）。
//
// 用法：
//   node tools/merge-settings-tabs.mjs --dry-run      只看看哪些插件会被改
//   node tools/merge-settings-tabs.mjs                真改（自动备份）
//   node tools/merge-settings-tabs.mjs --restore      从备份还原
//   node tools/merge-settings-tabs.mjs --dir <目录>   指定 node_modules

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const 参数 = process.argv.slice(2)
const 干跑 = 参数.includes('--dry-run')
const 还原 = 参数.includes('--restore')
const dirIdx = 参数.indexOf('--dir')
const 目录 =
  dirIdx !== -1 && 参数[dirIdx + 1]
    ? 参数[dirIdx + 1]
    : path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'node_modules')

const 旧 = 'settings.section'
const 新 = 'settings.plugins.tab'

function 候选文件() {
  if (!fs.existsSync(目录)) return []
  const 出 = []
  for (const ent of fs.readdirSync(目录, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    for (const rel of ['client.js', path.join('lib', 'client.js')]) {
      const p = path.join(目录, ent.name, rel)
      if (fs.existsSync(p)) 出.push({ 插件: ent.name, 文件: p })
    }
  }
  return 出
}

function 备份名(file) {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${file}.bak-tab-${ts}`
}

if (还原) {
  let n = 0
  for (const { 文件 } of 候选文件()) {
    const 目录2 = path.dirname(文件)
    for (const f of fs.readdirSync(目录2)) {
      if (!f.startsWith(path.basename(文件) + '.bak-tab-')) continue
      fs.copyFileSync(path.join(目录2, f), 文件)
      console.log(`↩ 还原 ${文件}  ←  ${f}`)
      n++
      break
    }
  }
  console.log(n ? `还原了 ${n} 个文件，刷新页面即可。` : '没有找到备份。')
  process.exit(0)
}

const 目标 = 候选文件().filter(({ 文件 }) => {
  const 内容 = fs.readFileSync(文件, 'utf8')
  // 只认真正的注册写法（name: 'settings.section'），避免把注释里的字样也算进来
  return 内容.includes(`name: '${旧}'`) || 内容.includes(`name: "${旧}"`)
})
const 只注释里出现 = 候选文件().filter(({ 文件 }) => {
  const 内容 = fs.readFileSync(文件, 'utf8')
  const 有注册 = 内容.includes(`name: '${旧}'`) || 内容.includes(`name: "${旧}"`)
  return !有注册 && 内容.includes(旧)
})

if (!目标.length) {
  console.log(`在 ${目录} 里没找到还注册着 ${旧} 的插件。`)
  for (const { 插件 } of 只注释里出现) console.log(`  （${插件} 只在注释里提到 ${旧}，不算）`)
  process.exit(0)
}

console.log(`目录：${目录}`)
console.log(`发现 ${目标.length} 个还在用 ${旧} 的插件：`)
for (const { 插件, 文件 } of 目标) console.log(`  · ${插件}  (${path.relative(目录, 文件)})`)

if (干跑) {
  console.log('\n--dry-run：什么都没改。去掉这个参数就会真改（自动备份）。')
  process.exit(0)
}

for (const { 文件 } of 目标) {
  const 原文 = fs.readFileSync(文件, 'utf8')
  fs.writeFileSync(备份名(文件), 原文, 'utf8')
  let 新文 = 原文.split(`'${旧}'`).join(`'${新}'`)
  新文 = 新文.split(`"${旧}"`).join(`"${新}"`)
  fs.writeFileSync(文件, 新文, 'utf8')
  console.log(`✔ ${path.basename(path.dirname(文件))}/${path.basename(文件)}`)
}

console.log('\n改完了。刷新 DSH 页面（Ctrl+R）就能看到：左侧栏那几项没了，插件页里多了对应页签。')
console.log('想还原：node tools/merge-settings-tabs.mjs --restore')
