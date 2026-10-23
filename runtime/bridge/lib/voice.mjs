// 生音 · 说（TTS）和听（ASR）
//
// 抽出来的目的：让「语音」变成一块独立的东西，bridge 只负责
// 「从 QQ 拿一条语音 / 把一条语音发到 QQ」，不关心怎么合成、怎么转写。
//
// 依赖都是本机能力，不碰网络（edge-tts 除外，它要联网）：
//   说：edge-tts（自然）/ Windows 自带 SAPI（离线但机械）
//   听：一个本地转写脚本（SenseVoice 之类），收 wav 路径、往 stdout 打文字
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const 执行 = promisify(execFile)

/** 找一个能用的 python：环境变量 > DSH 自带运行时 > PATH 里的 python。 */
export function 找Python() {
  const 候选 = [
    process.env.DSH_PYTHON || '',
    process.env.QIYU_PYTHON || '',
    join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
  ].filter(Boolean)
  for (const p of 候选) {
    try {
      if (existsSync(p)) return p
    } catch (error) {}
  }
  return 'python'
}

/**
 * 合成一条语音。
 * @param {string} 文字
 * @param {object} 选项 { 引擎, 音色, 语速, 音调, 输出目录, python }
 * @returns {Promise<{ok:boolean, 路径?:string, 说?:string}>}
 */
export async function 合成语音(文字, 选项 = {}) {
  const 目录 = 选项.输出目录 || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'qiyu', '语音')
  const 引擎 = 选项.引擎 || 'edge'
  try {
    mkdirSync(目录, { recursive: true })
    const 名 = 'voice-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)

    if (引擎 === 'windows') {
      const 路径 = join(目录, 名 + '.wav')
      const 脚本 =
        'Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;' +
        'try{$s.SelectVoice("' + (选项.音色 || 'Microsoft Huihui') + '")}catch{};' +
        '$s.SetOutputToWaveFile("' + 路径.replace(/"/g, '') + '");$s.Speak(' + JSON.stringify(文字) + ');$s.Dispose()'
      await 执行('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 脚本], { timeout: 60000 })
      return existsSync(路径) ? { ok: true, 路径 } : { ok: false, 说: 'windows 语音没生成文件' }
    }

    const 路径 = join(目录, 名 + '.mp3')
    // ⚠ 语速/音调带负号时必须用 --xxx=值 的形式，否则 argparse 会把它当成选项
    await 执行(
      选项.python || 找Python(),
      [
        '-m', 'edge_tts',
        '--voice=' + (选项.音色 || 'zh-CN-XiaoxiaoNeural'),
        '--rate=' + (选项.语速 || '+0%'),
        '--pitch=' + (选项.音调 || '+0Hz'),
        '--text', 文字,
        '--write-media', 路径,
      ],
      { timeout: 90000 }
    )
    return existsSync(路径) ? { ok: true, 路径 } : { ok: false, 说: 'edge-tts 没生成文件（可能没装）' }
  } catch (error) {
    return { ok: false, 说: String((error && (error.stderr || error.message)) || error).slice(0, 200) }
  }
}

/**
 * 把一个 wav 文件转成文字。
 * @param {string} 路径 本地 wav
 * @param {object} 选项 { 脚本, 依赖路径, python }
 * @returns {Promise<{ok:boolean, 文字?:string, 说?:string}>}
 */
export async function 转写音频(路径, 选项 = {}) {
  const 脚本 = 选项.脚本 || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'qiyu', '语音转写.py')
  try {
    if (!existsSync(脚本)) return { ok: false, 说: '找不到转写脚本：' + 脚本 }
    if (!existsSync(路径)) return { ok: false, 说: '找不到音频文件：' + 路径 }
    const 环境 = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    if (选项.依赖路径) 环境.PYTHONPATH = 选项.依赖路径
    const { stdout } = await 执行(选项.python || 找Python(), [脚本, 路径], { timeout: 120000, env: 环境 })
    const 文字 = String(stdout || '').trim()
    return 文字 ? { ok: true, 文字 } : { ok: false, 说: '转写结果是空的' }
  } catch (error) {
    return { ok: false, 说: String((error && (error.stderr || error.message)) || error).slice(0, 160) }
  }
}

/** 把一段 base64 的 wav 落到磁盘（bridge 从 NapCat 拿到的是 base64）。 */
export function 存Wav(base64, 目录) {
  mkdirSync(目录, { recursive: true })
  const 路径 = join(目录, 'voice-' + Date.now() + '.wav')
  writeFileSync(路径, Buffer.from(String(base64 || ''), 'base64'))
  return 路径
}
