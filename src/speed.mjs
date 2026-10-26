// 测速：下载大文件之前，先花几秒量一下每个源有多快。
//
// 做法：对每个候选发一个 **Range 请求**（只取前 512KB），量「收够样本 / 超时」用了多久。
//   · 不用 HEAD：很多镜像对 HEAD 直接返回 200 且不带长度，测不出速度
//   · 不整份下：测速只该花几秒，不该把 226MB 先下一遍
//   · 并行测：串行的话 4 个源就要等 4 个超时，用户会以为卡死
//
// ⚠ 这些源都是公网 HTTP 服务，"速度"只代表**此刻**——所以只用来排序，
//   真下载失败了还要能退回下一个（见 选最快源 返回的 全部）。
import { GitHub候选, PyPI源 } from './mirrors.mjs'

const 默认样本 = 512 * 1024
const 默认超时 = 8000

/**
 * 测一个地址。
 * @returns {Promise<{名?:string,url:string,ok:boolean,毫秒:number,字节:number,速度:number,说?:string}>}
 */
export async function 测速(url, { 名 = '', 超时 = 默认超时, 样本 = 默认样本 } = {}) {
  const 开始 = Date.now()
  const ctl = new AbortController()
  const 定时 = setTimeout(() => ctl.abort(), 超时)
  let 收 = 0
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { Range: `bytes=0-${样本 - 1}`, 'User-Agent': 'qiyu-speed/1', Accept: '*/*' },
    })
    if (!r.ok && r.status !== 206) {
      return { 名, url, ok: false, 毫秒: Date.now() - 开始, 字节: 0, 速度: 0, 说: 'HTTP ' + r.status }
    }
    if (r.body) {
      for await (const 块 of r.body) {
        收 += 块.length
        if (收 >= 样本) break
      }
    }
    const 毫秒 = Math.max(1, Date.now() - 开始)
    return { 名, url, ok: 收 > 0, 毫秒, 字节: 收, 速度: 收 / 1024 / (毫秒 / 1000) }
  } catch (错) {
    const 毫秒 = Math.max(1, Date.now() - 开始)
    return {
      名,
      url,
      ok: false,
      毫秒,
      字节: 收,
      速度: 收 / 1024 / (毫秒 / 1000),
      说: 错 && 错.name === 'AbortError' ? '超时' : String((错 && 错.message) || 错),
    }
  } finally {
    clearTimeout(定时)
  }
}

/** 并行测一批，按速度从快到慢排（失败的排最后） */
export async function 测速们(候选们, 选项 = {}) {
  const 结果 = await Promise.all(候选们.map((c) => 测速(c.url, { 名: c.名 || '', ...选项 })))
  return 结果.sort((a, b) => (b.ok ? b.速度 : -1) - (a.ok ? a.速度 : -1))
}

/** 把速度写成「1.2 MB/s」这种 */
export function 说速度(kb) {
  const n = Number(kb) || 0
  if (n >= 1024) return (n / 1024).toFixed(1) + ' MB/s'
  return Math.round(n) + ' KB/s'
}

/** 打印一张小表（给用户看，也给贴 issue 用） */
export function 打印测速(结果们, 标题 = '测速结果') {
  if (!结果们.length) return
  console.log(标题 + '（越靠前越快）：')
  for (const r of 结果们) {
    const 名 = (r.名 || r.url).padEnd(18)
    const 值 = r.ok ? 说速度(r.速度).padStart(10) + '  ' + r.毫秒 + 'ms' : ('✗ ' + (r.说 || '失败')).padStart(10)
    console.log('  ' + 名 + ' ' + 值)
  }
}

/**
 * 选最快的那个；返回 { 最快, 全部 }。
 * 全部保留着，是为了「最快的那个下载中途失败」时还能退回下一个。
 */
export async function 选最快源(候选们, 选项 = {}) {
  const 全部 = await 测速们(候选们, 选项)
  const 能用的 = 全部.filter((r) => r.ok)
  return { 最快: 能用的[0] || null, 全部, 能用: 能用的 }
}

/** `qiyu speed` 用：把「模型源 / PyPI 源」都测一遍，打给人看 */
export async function 测速报告() {
  console.log('— qiyu speed：先测速，再决定从哪下 —')
  console.log('')

  const 模型原 =
    process.env.QIYU_STT_URL ||
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2'
  const 模型候选 = GitHub候选(模型原)
  const 模型结果 = await 测速们(模型候选)
  打印测速(模型结果, '语音模型（GitHub Releases）')
  console.log('')

  // PyPI 的测速探针：拿一个真实包页面，而不是根路径
  const 探针 = PyPI源.map((p) => ({ 名: p.名, url: p.url.replace(/\/$/, '') + '/sherpa-onnx/' }))
  const pypi结果 = await 测速们(探针)
  打印测速(pypi结果, 'pip 源')
  console.log('')
  console.log('装语音转写时会自动用这里最快的源；也可以手动：qiyu stt --url <地址> / --pip-index <地址>')
  return 0
}
