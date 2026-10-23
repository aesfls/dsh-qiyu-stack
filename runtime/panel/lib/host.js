// 栖语面板 · 宿主半边
//
// 面板本身没有业务，只多做一件事：给「版本」页签提供一个只读接口
//   GET /dsh-qiyu-panel/version
// 数据来自 qiyu install 写的 $DSH_HOME/qiyu/version.json（没有就退回现场读各插件 package.json）。
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const 包根 = join(dirname(fileURLToPath(import.meta.url)), '..')

function 读JSON(路径) {
  try {
    if (!existsSync(路径)) return null
    return JSON.parse(readFileSync(路径, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

/** 现场读已装插件的版本（version.json 缺字段时兜底） */
function 现场模块版本(profile的node_modules) {
  const 出 = {}
  for (const 名 of ['dsh-qq-bridge', 'dsh-fish-memory', 'dsh-feiyu-mood', 'dsh-speak-up']) {
    const j = 读JSON(join(profile的node_modules, 名, 'package.json'))
    if (j && j.version) 出[名] = j.version
  }
  return 出
}

function 版本信息() {
  const 家 = process.env.DSH_HOME || join(homedir(), '.dsh')
  const 记录 = 读JSON(join(家, 'qiyu', 'version.json')) || {}
  const 自己 = 读JSON(join(包根, 'package.json')) || {}
  const profile = process.env.DSH_PROFILE_DIR || join(家, 'profiles', 'desktop')

  let 模块 = 记录.模块 || {}
  if (!Object.keys(模块).length) {
    try {
      模块 = 现场模块版本(join(profile, 'node_modules'))
    } catch {
      模块 = {}
    }
  }

  return {
    ok: true,
    栈: 记录.版本 || '',
    安装时间: 记录.安装时间 || '',
    更新内容: 记录.更新内容 || '',
    面板: 自己.version || '',
    模块,
    提示: 记录.版本 ? '' : '还没有安装记录 —— 跑一次 npx dsh-qiyu-stack install 就会写上。',
  }
}

export const inject = ['webServer']

export function apply(ctx) {
  const 注册 = () =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-qiyu-panel/version',
      handler: async (req, res) => {
        const 体 = JSON.stringify(版本信息())
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(体)
      },
    })

  try {
    if (typeof ctx.effect === 'function') ctx.effect(注册)
    else 注册()
  } catch {
    // 拿不到 webServer 就只是没有版本接口；不影响设置页其他功能
  }
}
