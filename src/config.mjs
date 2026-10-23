// 配置：文件优先，环境变量覆盖。令牌只走环境变量也能跑。
//
// ⚠️ 这里**只放中性默认值**。任何「某个人的东西」——真实 QQ 号、真实路径、
//    作者自己的称呼、群号、令牌——都不许写成默认值。那会把作者的设定
//    悄悄变成使用者的配置（dsh-bili-subagent 的 ownerName 就栽在这上面）。
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const 默认配置 = {
  napcat: {
    container: 'napcat-qq', // 中性名字，谁装都行；作者那台的容器名不该成为默认
    http: 'http://127.0.0.1:3000',
    ws: 'ws://127.0.0.1:3001/',
    webui: 'http://127.0.0.1:6099',
    token: '',
    wsToken: '',
    // 自定义安装的 Docker Desktop 路径（空 = 自动找：环境变量 > where docker > 默认路径）
    dockerDesktop: '',
  },
  dsh: {
    port: 0, // 0 = 不知道。端口每台机器都不一样，绝不写死一个数
  },
  // 角色包放在哪（相对项目根目录）
  character: 'characters',
  // 当前"活动角色"的名字：init 时记下，deploy 出码时才知道该说「谁要登录」
  角色: '',
}

export function 配置文件路径() {
  return resolve(process.cwd(), 'qiyu.config.json')
}

function 合并(底, 上) {
  const 出 = { ...底 }
  for (const k of Object.keys(上 || {})) {
    const v = 上[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) 出[k] = 合并(底[k] || {}, v)
    else if (v !== undefined && v !== null && v !== '') 出[k] = v
  }
  return 出
}

export function 读配置() {
  let 文件 = {}
  const 路径 = 配置文件路径()
  if (existsSync(路径)) {
    try {
      // ⚠️ Windows 上用 PowerShell 手写的 json 常常带 BOM，JSON.parse 会直接炸
      文件 = JSON.parse(readFileSync(路径, 'utf8').replace(/^\uFEFF/, ''))
    } catch (错) {
      console.error('⚠️  qiyu.config.json 解析失败，先按默认值跑：' + 错.message)
    }
  }

  const 配置 = 合并(默认配置, 文件)

  // 环境变量优先
  if (process.env.QIYU_ONEBOT_TOKEN) 配置.napcat.token = process.env.QIYU_ONEBOT_TOKEN
  if (process.env.QIYU_WS_TOKEN) 配置.napcat.wsToken = process.env.QIYU_WS_TOKEN
  if (process.env.QIYU_DSH_PORT) 配置.dsh.port = Number(process.env.QIYU_DSH_PORT)

  return 配置
}
