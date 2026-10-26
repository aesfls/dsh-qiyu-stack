// qiyu stt —— 语音转写（可选）：装模型 + Python 依赖。
//
// 为什么不放进 install：
//   模型 226 MB + 依赖 142 MB。不是每个人都想让机器人听语音；
//   而且干净机器上这一下要下载好几分钟，装完才发现用不上很浪费。
//   所以做成"要用就跑一次"，doctor 会提示"语音转写未装"。
//
// ⭐ 2026-10-26：下载前**先测速**。国内直连 GitHub / PyPI 经常只有几十 KB/s，
//   镜像站可能几 MB/s。所以：候选表 → 并行测速 → 用最快的 → 失败再退回下一个。
//   不想测速就加 --no-speed（内网/代理环境）。
import { createWriteStream, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { 跑 } from './run.mjs'
import { 选最快源, 打印测速, 说速度 } from './speed.mjs'
import { GitHub候选, PyPI源 } from './mirrors.mjs'

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

/** 下载一个文件到 目标；成功返回 true */
async function 下载一个(url, 目标) {
  console.log(`  ↓ ${url}`)
  const 开始 = Date.now()
  try {
    const r = await fetch(url, { redirect: 'follow' })
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status)
    await pipeline(Readable.fromWeb(r.body), createWriteStream(目标))
    const 字节 = statSync(目标).size
    const 秒 = Math.max(1, (Date.now() - 开始) / 1000)
    console.log(`  ✓ ${(字节 / 1024 / 1024).toFixed(1)} MB，平均 ${说速度(字节 / 1024 / 秒)}`)
    return true
  } catch (错) {
    console.log('  ✗ ' + String((错 && 错.message) || 错))
    try {
      rmSync(目标, { force: true })
    } catch (error) {}
    return false
  }
}

export async function stt(选项 = {}) {
  const 目录 = 模型目录(选项.dir)
  const 只查 = Boolean(选项.查)
  const 跳模型 = Boolean(选项.跳模型)
  const 跳依赖 = Boolean(选项.跳依赖)
  const 跳过测速 = Boolean(选项.跳过测速)

  const 齐 = 模型齐了吗(目录)
  const py = 找Python()

  console.log('— qiyu stt（语音转写，可选）—')
  console.log(`模型目录：${目录}`)
  console.log(`模型：${齐 ? '已就位' : '缺（model.int8.onnx / tokens.txt）'}`)
  console.log(`Python：${py.python ? py.python + '（' + py.版本 + '）' : '没找到'}`)

  if (只查) {
    if (!齐) console.log('· 要装：qiyu stt')
    return 0
  }

  let 失败 = 0

  // ---- 1. 模型 ----
  if (!齐 && !跳模型) {
    const 原地址 = 选项.url || 默认模型
    const 候选 = GitHub候选(原地址)
    let 顺序 = 候选

    if (!跳过测速 && 候选.length > 1) {
      console.log('\n· 先测速（每个源最多 8 秒，只取前 512KB）…')
      const { 能用, 全部 } = await 选最快源(候选, { 超时: 8000, 样本: 512 * 1024 })
      打印测速(全部, '模型源')
      if (能用.length) {
        顺序 = 能用.map((r) => ({ 名: r.名, url: r.url }))
      } else {
        console.log('  都测不通（可能被墙 / 需要代理）。先按原地址试一次，不行就用 --url。')
      }
    }

    const 临时 = join(tmpdir(), 'qiyu-stt-' + Date.now())
    mkdirSync(临时, { recursive: true })
    const 包 = join(临时, 'model.tar.bz2')

    console.log(`\n· 下载模型（约 226 MB）…`)
    let 下好了 = false
    for (const c of 顺序) {
      if (await 下载一个(c.url, 包)) {
        下好了 = true
        break
      }
      console.log(`  ${c.名} 不行，换下一个…`)
    }
    if (!下好了) {
      console.log('✗ 所有源都没下成。可以自己下好之后：qiyu stt --url <tar.bz2 地址>')
      console.log('  或手动把 model.int8.onnx / tokens.txt 放进：' + 目录)
      失败++
    }

    if (下好了 && existsSync(包) && statSync(包).size > 1024 * 1024) {
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
      let 索引 = 选项.pipIndex || ''
      if (!索引 && !跳过测速) {
        console.log('\n· 测速 pip 源…')
        const 探针 = PyPI源.map((p) => ({ 名: p.名, url: p.url.replace(/\/$/, '') + '/sherpa-onnx/' }))
        const { 全部, 能用 } = await 选最快源(探针, { 超时: 6000, 样本: 128 * 1024 })
        打印测速(全部, 'pip 源')
        if (能用.length) {
          const 最快 = 能用[0]
          const 对应 = PyPI源.find((p) => 最快.url.startsWith(p.url.replace(/\/$/, '')))
          // 最快的是官方就不加 -i（省得绕一圈）；否则用镜像
          if (对应 && 对应.url !== PyPI源[0].url) {
            索引 = 对应.url
            console.log(`  用：${对应.名}`)
          }
        }
      }

      console.log(`\n· 装 Python 依赖（${依赖.join(' ')}）…`)
      const 参数 = ['-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check']
      if (索引) 参数.push('-i', 索引)
      参数.push(...依赖)
      const r = 跑(py.python, 参数, 900000)
      if (r.ok) console.log('✓ 依赖装好了')
      else {
        console.log('✗ 装依赖失败：' + String(r.错 || '').slice(0, 300))
        console.log('  可以自己跑：' + py.python + ' -m pip install ' + (索引 ? '-i ' + 索引 + ' ' : '') + 依赖.join(' '))
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
