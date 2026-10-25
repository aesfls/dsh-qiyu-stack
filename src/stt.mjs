// qiyu stt —— 语音转写（可选）：装模型 + Python 依赖。
//
// 为什么不放进 install：
//   模型 226 MB + 依赖 142 MB。不是每个人都想让机器人听语音；
//   而且干净机器上这一下要下载好几分钟，装完才发现用不上很浪费。
//   所以做成"要用就跑一次"，doctor 会提示"语音转写未装"。
//
// 装完之后：`语音转写.py` 从 <DSH_HOME>/qiyu/models 读 model.int8.onnx + tokens.txt；
// 桥的 voice.mjs 会去调它，收到的语音就能转成文字。
import { createWriteStream, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { 跑 } from './run.mjs'

const 默认模型 =
  process.env.QIYU_STT_URL ||
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2'

const 依赖 = ['sherpa-onnx', 'numpy', 'imageio-ffmpeg']

function 家() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 模型该放哪：<DSH_HOME>/qiyu/models（跟 语音转写.py 的默认值一致） */
export function 模型目录(指定) {
  return 指定 ? String(指定) : join(家(), 'qiyu', 'models')
}

export function 模型齐了吗(目录 = 模型目录()) {
  return existsSync(join(目录, 'model.int8.onnx')) && existsSync(join(目录, 'tokens.txt'))
}

/** 找一个能跑 pip 的 python（跟 voice.mjs 同一套顺序） */
function 找Python() {
  const 候选 = [
    process.env.QIYU_PYTHON || '',
    process.env.DSH_PYTHON || '',
    join(家(), 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
    'python',
  ].filter(Boolean)
  for (const p of 候选) {
    const r = 跑(p, ['-c', 'import sys;print(sys.version.split()[0])'], 15000)
    if (r.ok) return { python: p, 版本: String(r.出 || '').trim() }
  }
  return { python: '', 版本: '' }
}

/** 解压 tar.bz2：交给系统 tar（Win10+ 自带 bsdtar，认得 bz2） */
function 解压(包, 到) {
  mkdirSync(到, { recursive: true })
  const r = 跑('tar', ['-xjf', 包, '-C', 到], 600000)
  if (!r.ok) return { ok: false, 说: 'tar 解压失败：' + String(r.错 || '').slice(0, 200) }
  return { ok: true }
}

/** 在解压出来的目录树里找 model*.onnx / tokens.txt（包里通常套一层子目录） */
function 找文件(目录, 名) {
  const 候选 = []
  const 走 = (d) => {
    let 项 = []
    try {
      项 = readdirSync(d, { withFileTypes: true })
    } catch (error) {
      return
    }
    for (const x of 项) {
      const p = join(d, x.name)
      if (x.isDirectory()) 走(p)
      else if (x.name === 名) 候选.push(p)
    }
  }
  走(目录)
  return 候选[0] || ''
}

export async function stt(选项 = {}) {
  const 目录 = 模型目录(选项.dir)
  const 只查 = Boolean(选项.查)
  const 跳模型 = Boolean(选项.跳模型)
  const 跳依赖 = Boolean(选项.跳依赖)

  const 齐 = 模型齐了吗(目录)
  const py = 找Python()

  console.log('— qiyu stt（语音转写，可选）—')
  console.log(`模型目录：${目录}`)
  console.log(`模型：${齐 ? '已就位' : '缺（model.int8.onnx / tokens.txt）'}`)
  console.log(`Python：${py.python ? py.python + '（' + py.版本 + '）' : '没找到'}`)

  if (只查) {
    if (!齐) console.log('· 要装：qiyu stt')
    return 齐 ? 0 : 0
  }

  let 失败 = 0

  // ---- 1. 模型 ----
  if (!齐 && !跳模型) {
    const 临时 = join(tmpdir(), 'qiyu-stt-' + Date.now())
    mkdirSync(临时, { recursive: true })
    const 包 = join(临时, 'model.tar.bz2')
    console.log(`\n· 下载模型（约 226 MB，第一次要几分钟）…`)
    console.log(`  ${选项.url || 默认模型}`)
    try {
      const r = await fetch(选项.url || 默认模型, { redirect: 'follow' })
      if (!r.ok || !r.body) throw new Error('HTTP ' + r.status)
      await pipeline(Readable.fromWeb(r.body), createWriteStream(包))
      const mb = (statSync(包).size / 1024 / 1024).toFixed(1)
      console.log(`  下载完成：${mb} MB`)
    } catch (错) {
      console.log('✗ 模型下载失败：' + String(错.message || 错))
      console.log('  可以自己下好之后用：qiyu stt --url <tar.bz2 的地址>')
      console.log('  或者手动把 model.int8.onnx / tokens.txt 放进：' + 目录)
      失败++
    }
    if (existsSync(包) && statSync(包).size > 1024 * 1024) {
      const 解 = 解压(包, join(临时, 'x'))
      if (!解.ok) {
        console.log('✗ ' + 解.说)
        失败++
      } else {
        const 模型 = 找文件(join(临时, 'x'), 'model.int8.onnx') || 找文件(join(临时, 'x'), 'model.onnx')
        const 词表 = 找文件(join(临时, 'x'), 'tokens.txt')
        if (!模型 || !词表) {
          console.log('✗ 压包里没找到 model*.onnx / tokens.txt（可能下到了别的包）')
          失败++
        } else {
          mkdirSync(目录, { recursive: true })
          copyFileSync(模型, join(目录, 'model.int8.onnx'))
          copyFileSync(词表, join(目录, 'tokens.txt'))
          console.log('✓ 模型装好了：' + 目录)
        }
      }
    }
    try {
      rmSync(临时, { recursive: true, force: true })
    } catch (error) {}
  }

  // ---- 2. Python 依赖 ----
  if (!跳依赖) {
    if (!py.python) {
      console.log('\n✗ 没找到 Python，装不了依赖。先装 Python 3.10+（或用 DSH 自带的运行时）。')
      失败++
    } else {
      console.log(`\n· 装 Python 依赖（${依赖.join(' ')}）…`)
      const r = 跑(py.python, ['-m', 'pip', 'install', '--upgrade', ...依赖], 900000)
      if (r.ok) console.log('✓ 依赖装好了')
      else {
        console.log('✗ 装依赖失败：' + String(r.错 || '').slice(0, 300))
        console.log('  可以自己跑：' + py.python + ' -m pip install ' + 依赖.join(' '))
        失败++
      }
    }
  }

  // ---- 3. 自检 ----
  const 现在齐 = 模型齐了吗(目录)
  console.log('\n结果：模型 ' + (现在齐 ? '✓' : '✗') + '｜依赖 ' + (跳依赖 ? '跳过' : 失败 ? '可能有失败' : '✓'))
  if (!现在齐) {
    console.log('提示：没模型时，桥收到语音会回「没听清（模型缺失）」，不影响文字收发。')
    return 1
  }
  return 失败 ? 1 : 0
}
