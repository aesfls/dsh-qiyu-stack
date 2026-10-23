// 从 CHANGELOG.md 里取某个版本的「这段写了什么」。
//
// 用途：qiyu install 写进 ~/.dsh/qiyu/version.json，设置面板的「版本」页签显示；
// qiyu handover 也顺手把它写进交接文档。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const 包根 = join(dirname(fileURLToPath(import.meta.url)), '..')

export function 读更新内容(版本) {
  try {
    const 文 = readFileSync(join(包根, 'CHANGELOG.md'), 'utf8')
    const 行们 = 文.split(/\r?\n/)
    const 头 = new RegExp('^##\\s*' + String(版本).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\d.])')
    let 开始 = -1
    for (let i = 0; i < 行们.length; i++) {
      if (头.test(行们[i])) {
        开始 = i + 1
        break
      }
    }
    if (开始 < 0) return ''
    const 出 = []
    for (let i = 开始; i < 行们.length; i++) {
      if (/^##\s/.test(行们[i])) break
      出.push(行们[i])
    }
    return 出.join('\n').trim()
  } catch {
    return ''
  }
}
