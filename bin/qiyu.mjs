#!/usr/bin/env node
// 栖语栈 CLI —— 只有一个入口，命令都在这里分发。
//
//   qiyu init <名字> [--preset blank]   生成一个角色包
//   qiyu deploy                         一条命令起 NapCat：建目录、写配置、跑容器、出码
//   qiyu doctor                         自检：Docker / 容器 / 端口 / OneBot / 桥
//   qiyu qr                             取登录二维码并直接打开
//   qiyu config                         看一眼当前配置从哪来
//   qiyu help

import { init } from '../src/init.mjs'
import { doctor } from '../src/doctor.mjs'
import { qr } from '../src/qr.mjs'
import { deploy } from '../src/deploy.mjs'
import { install } from '../src/install.mjs'
import { preflight } from '../src/preflight.mjs'
import { handover } from '../src/handover.mjs'
import { stt } from '../src/stt.mjs'
import { 读配置, 配置文件路径 } from '../src/config.mjs'

const 参数 = process.argv.slice(2)
const 命令 = 参数[0] || 'help'

function 取值(名, 兜底 = null) {
  const i = 参数.indexOf(名)
  if (i === -1) return 兜底
  const 下一个 = 参数[i + 1]
  if (!下一个 || 下一个.startsWith('--')) return 兜底
  return 下一个
}

function 有开关(名) {
  return 参数.includes(名)
}

const 帮助 = `
栖语栈 qiyu —— 让一个智能体住进 QQ

用法：
  qiyu init                     进向导：问名字、QQ、称呼、作息、性格、能不能自己改
       qiyu init <名字>          跳过向导，全部用默认值直接建
       --preset <模板>          blank（以后再加）
       --qq / --as / --rhythm / --personality / --self-edit   非交互时直接给值
       --force                  目录已存在时覆盖

  qiyu preflight                装之前先查这台机器：Node / Docker / Windows / WSL / 路径 /
                                空间 / 网络 / 杀软 / DSH / 模型凭证 / Python
                                （不假设 Docker 已经装了）
       --fix                    能修的帮你修：启动 Docker 引擎、停掉占端口的容器、装 edge-tts
                                （每一项都会先问一句，非交互环境不动手）
       --json                   只输出 JSON（给 agent / 脚本判断用）

  qiyu deploy                   一条命令起 NapCat：建目录、写 OneBot 配置、跑容器、出码
       --dir <目录>             数据放哪（默认挑非系统盘里空间最大的；会检查空间和中文路径）
       --move                   换目录时，把旧目录的数据整体搬过去
       --qq <号>                她的 QQ 号（给了就开快速登录，重启容器免扫码）
       --name <容器名>          默认 napcat-qq
       --token/--ws-token/--webui-token   自己指定令牌（不给就随机生成）
       --dry-run                只把 docker 命令打出来，不动手

  qiyu doctor                   自检：Docker / 容器 / 端口 / OneBot / 桥
       --json                   只输出 JSON（给脚本用）
       --skip-ws                跳过 WebSocket 检查

  qiyu qr                       把登录二维码取出来并**直接打开**给你扫
                                （不会只给一个路径让你自己找文件）

  qiyu install                  把运行时（桥/记忆/心情/作息 + 设置面板）装进 DSH profile
       --profile <目录>         默认 ~/.dsh/profiles/desktop
       --character <名字>       顺便把这个角色设为「活动角色」（拷到 ~/.dsh/qiyu/）
       --only bridge,memory     只装其中几块
       --dry-run                只列清单，不动手
       --yes                    真装（不加就只提示）
       --force                  已存在也覆盖（覆盖前自动备份）

  qiyu stt                     装语音转写（可选）：SenseVoice 模型（约 226MB）+ Python 依赖
       --check                 只看装没装
       --dir <目录>            模型放哪（默认 <DSH_HOME>/qiyu/models）
       --url <tar.bz2>         自己指定模型包地址（GitHub 拉不动时用）
       --skip-model / --skip-deps   只装其中一半

  qiyu config                   显示配置来源（文件 / 环境变量 / 默认值）

  qiyu handover                 在部署文件夹写「交接.md」：位置 / QQ / 桥的目标会话 /
                                升级命令 / 回退方法 / 给新会话的开场白
       --character <名字>       不指定时自动认（配置里记的，或 characters/ 下唯一的那个）
       --out <文件名>           默认 交接.md

配置文件：qiyu.config.json（当前目录），也可以用环境变量覆盖：
  QIYU_ONEBOT_TOKEN   OneBot HTTP 令牌
  QIYU_WS_TOKEN       OneBot WS 令牌
  QIYU_DSH_PORT       DSH 的端口（不配就跳过 DSH 桥检查）
`

async function 主() {
  if (命令 === 'help' || 命令 === '--help' || 命令 === '-h') {
    console.log(帮助)
    return 0
  }

  if (命令 === 'init') {
    const 名字 = 参数[1]
    // 不带名字 = 进向导（问名字、作息、性格…）；带名字 = 老样子，用默认值直接建
    if (!名字 || 名字.startsWith('--')) {
      if (有开关('--yes')) {
        console.error('--yes 需要一个名字：qiyu init 小明 --yes')
        return 1
      }
      const { wizard } = await import('../src/wizard.mjs')
      return await wizard()
    }
    return await init(名字, {
      模板: 取值('--preset', 'blank'),
      覆盖: 有开关('--force'),
      答案: {
        qq: 取值('--qq', ''),
        称呼: 取值('--as', '你'),
        作息: 取值('--rhythm', 'regular'),
        性格: 取值('--personality', 'blank'),
        自改: 取值('--self-edit', 'ask'),
      },
    })
  }

  if (命令 === 'doctor' || 命令 === 'status') {
    return await doctor({ 只输出JSON: 有开关('--json'), 跳过WebSocket: 有开关('--skip-ws') })
  }

  if (命令 === 'preflight' || 命令 === 'check') {
    return await preflight({ 修复: 有开关('--fix'), 只输出JSON: 有开关('--json') })
  }

  if (命令 === 'qr' || 命令 === 'login') {
    return await qr()
  }

  if (命令 === 'deploy') {
    return await deploy({
      名字: 取值('--name'),
      镜像: 取值('--image'),
      目录: 取值('--dir'),
      qq: 取值('--qq'),
      token: 取值('--token'),
      ws令牌: 取值('--ws-token'),
      webui令牌: 取值('--webui-token'),
      搬: 有开关('--move'),
      干跑: 有开关('--dry-run'),
    })
  }

  if (命令 === 'install') {
    return await install({
      profile: 取值('--profile'),
      只: 取值('--only'),
      角色: 取值('--character'),
      干跑: 有开关('--dry-run'),
      确认: 有开关('--yes'),
      覆盖: 有开关('--force'),
    })
  }

  if (命令 === 'stt') {
    return await stt({
      查: 有开关('--check'),
      dir: 取值('--dir'),
      url: 取值('--url'),
      跳模型: 有开关('--skip-model'),
      跳依赖: 有开关('--skip-deps'),
    })
  }

  if (命令 === 'config') {
    const 配置 = 读配置()
    console.log('配置文件：' + 配置文件路径())
    console.log(JSON.stringify(配置, null, 2))
    return 0
  }

  if (命令 === 'handover' || 命令 === '交接') {
    return await handover({ 角色: 取值('--character'), 输出: 取值('--out', '交接.md') })
  }

  console.error('不认识的命令：' + 命令)
  console.log(帮助)
  return 1
}

主()
  .then((码) => process.exit(码 || 0))
  .catch((错) => {
    console.error('出错了：' + ((错 && 错.message) || 错))
    process.exit(1)
  })
