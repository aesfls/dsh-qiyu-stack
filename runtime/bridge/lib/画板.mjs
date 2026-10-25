// 画板渲染：把一段 SVG 文本渲成 PNG（Edge 无头截图）。
//
// 为什么要单独一个模块：
//   · 群聊里 `pwsh` 是被护栏拒掉的（那是任意代码执行），但"画一张"这件事应该允许，
//     所以把渲染能力做成**只做这一件事**的工具函数：收 SVG 文本，出 PNG，别的都不碰。
//   · 渲染前必须**净化 SVG**：群里任何人能影响她写的内容 —— SVG 里可以塞 <script>、
//     on* 事件、外链图片（能往外发请求）。这里一律剥掉，并且浏览器侧关掉 JS。

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const 像素上限 = 2400 * 2400

const 浏览器候选 = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]

export function 找浏览器() {
  for (const p of 浏览器候选) if (existsSync(p)) return p
  return ''
}

/**
 * 净化 SVG：剥掉一切能执行或能往外发请求的东西。
 * 宁可画坏一点，也不让"群里某句话"变成一次外发。
 */
export function 净化svg(原文) {
  let s = String(原文 == null ? '' : 原文)
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '')
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
  s = s.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
  s = s.replace(/javascript:/gi, '')
  s = s.replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, '')
  return s
}

/** 从 SVG 里读它自己声明的尺寸（没有就返回 null） */
export function 读声明尺寸(文本) {
  const m = /<svg\b[^>]*?\bwidth="([\d.]+)(?:px)?"[^>]*?\bheight="([\d.]+)(?:px)?"/i.exec(文本)
  if (m) return [Math.round(Number(m[1])), Math.round(Number(m[2]))]
  const v = /<svg\b[^>]*?\bviewBox="[-\d.]+[,\s]+[-\d.]+[,\s]+([\d.]+)[,\s]+([\d.]+)"/i.exec(文本)
  if (v) return [Math.round(Number(v[1])), Math.round(Number(v[2]))]
  return null
}

/** 粗估"看一眼"要多少 token（跟像素面积走） */
export function 估token(w, h) {
  const n = Math.max(1, Math.round((w * h) / 400))
  return n < 1000 ? `${n} token` : `${(n / 1000).toFixed(1)}k token`
}

/**
 * 读图片的像素尺寸（PNG / JPEG / GIF / WebP），读不到返回 null。
 *
 * 为什么要自己读：群里她"想缩图"时不能调 pwsh（那是任意代码执行），
 * 只能靠这里算出原图比例，再按比例渲成目标尺寸，才不会被拉歪。
 */
export function 读图片尺寸(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
      // PNG: IHDR 在 8..24
      return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
    }
    if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') {
      return [buf.readUInt16LE(6), buf.readUInt16LE(8)]
    }
    if (buf.length > 30 && buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45) {
      // WebP: VP8X / VP8 / VP8L
      const 类型 = buf.toString('ascii', 12, 16)
      if (类型 === 'VP8X') return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1]
      if (类型 === 'VP8L') {
        const b = buf.readUInt32LE(21)
        return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]
      }
      if (类型 === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff]
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      // JPEG: 扫 SOFn 段
      let i = 2
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i += 1; continue }
        const 标记 = buf[i + 1]
        const 段长 = buf.readUInt16BE(i + 2)
        if (标记 >= 0xc0 && 标记 <= 0xcf && 标记 !== 0xc4 && 标记 !== 0xc8 && 标记 !== 0xcc) {
          return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]
        }
        i += 2 + 段长
      }
    }
  } catch (error) {}
  return null
}

/**
 * 按目标宽（等比）缩放一张图，用 Edge 渲出来 —— 不碰 pwsh、不需要图片库。
 * @returns {{ ok: boolean, 说?: string, 宽?: number, 高?: number, 路径?: string }}
 */
export function 缩放({ 源图, 宽, 输出 }) {
  const 浏览器 = 找浏览器()
  if (!浏览器) return { ok: false, 说: '找不到 Edge/Chrome，缩不了图' }
  if (!existsSync(源图)) return { ok: false, 说: '找不到这张图：' + 源图 }
  const 目标宽 = Math.round(Number(宽) || 0)
  if (!(目标宽 >= 16 && 目标宽 <= 2400)) return { ok: false, 说: `目标宽度要在 16–2400 之间（你给的是 ${宽}）` }

  let 原尺寸 = null
  try { 原尺寸 = 读图片尺寸(readFileSync(源图)) } catch (error) {}
  const 比 = 原尺寸 && 原尺寸[0] > 0 ? 原尺寸[1] / 原尺寸[0] : 1
  const 目标高 = Math.max(16, Math.round(目标宽 * 比))
  if (目标宽 * 目标高 > 像素上限) return { ok: false, 说: '缩完还是太大（超过 2400x2400）' }

  // 缩放页只放一张 <img>，没有用户内容，所以这里不需要脚本。
  // ⚠ CSP 必须放行 inline 样式（style-src 'unsafe-inline'）：
  //   踩过的坑 —— 只写 default-src 'none' 会把 <style> 也拦掉，图片于是按**原始尺寸**渲染，
  //   而截图窗口只有缩小后的尺寸 → 结果是把原图左上角**裁一块**，不是缩放（她发出去的就是这块）。
  const 地址 = 'file:///' + 源图.replace(/\\/g, '/')
  const html =
    '<!doctype html><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src file: data:">`
    + '<style>html,body{margin:0;padding:0;background:transparent}'
    + `img{display:block;width:${目标宽}px;height:${目标高}px}</style>`
    + `<img src="${地址}">`

  mkdirSync(join(输出, '..'), { recursive: true })
  const 临时 = join(tmpdir(), `dsh-scale-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  try {
    writeFileSync(临时, html, 'utf8')
    execFileSync(浏览器, [
      '--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-extensions',
      '--default-background-color=00000000',
      `--window-size=${目标宽},${目标高}`,
      `--screenshot=${输出}`,
      'file:///' + 临时.replace(/\\/g, '/'),
    ], { timeout: 60000, stdio: 'ignore' })
    if (!existsSync(输出) || statSync(输出).size === 0) return { ok: false, 说: '缩放失败（没出图）' }
    return { ok: true, 宽: 目标宽, 高: 目标高, 路径: 输出 }
  } catch (error) {
    return { ok: false, 说: '缩放出错：' + String((error && error.message) || error) }
  } finally {
    try { unlinkSync(临时) } catch (error) {}
  }
}

/**
 * 把 SVG 文本渲成 PNG。
 * @returns {{ ok: boolean, 说?: string, 宽?: number, 高?: number, 路径?: string }}
 */
export function 渲({ svg文本, 宽, 高, 输出目录, 文件名, 透明 = false, 超时毫秒 = 60000 }) {
  const 浏览器 = 找浏览器()
  if (!浏览器) return { ok: false, 说: '这台机器上找不到 Edge/Chrome，画不出来' }

  const 原文 = String(svg文本 || '')
  if (!/<svg[\s>]/i.test(原文)) return { ok: false, 说: '这不是一段 SVG（要 <svg …>…</svg>）' }

  const 文本 = 净化svg(原文)
  const 声明 = 读声明尺寸(文本)
  let w = Math.round(Number(宽) || 0) || (声明 ? 声明[0] : 400)
  let h = Math.round(Number(高) || 0) || (声明 ? 声明[1] : 300)
  if (!(w >= 64 && h >= 64)) return { ok: false, 说: `画布太小了（${w}x${h}），至少 64x64` }
  if (w * h > 像素上限) return { ok: false, 说: `画布太大了（${w}x${h}），上限 2400x2400` }

  // 让 SVG 铺满视口：去掉它自己的 width/height，用 CSS 接管
  let 页 = 文本
    .replace(/(<svg\b[^>]*?)\swidth="[^"]*"/i, '$1')
    .replace(/(<svg\b[^>]*?)\sheight="[^"]*"/i, '$1')
    .replace(/(<svg\b)/i, '$1 style="display:block;width:100vw;height:100vh"')
  const 底 = 透明 ? 'transparent' : '#ffffff'
  // 第二道防线：CSP 关掉一切外发与脚本。
  // ⚠ 别用 `--blink-settings=scriptEnabled=false`——实测 Edge 会直接不出图（退出码 0 但没文件）。
  //   CSP 是文档级的，不影响渲染。
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:"
  const html =
    '<!doctype html><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<style>html,body{margin:0;padding:0;background:${底}}svg{display:block}</style>`
    + 页

  mkdirSync(输出目录, { recursive: true })
  const 临时 = join(tmpdir(), `dsh-canvas-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  const 输出 = join(输出目录, 文件名 || `draw-${Date.now()}.png`)
  try {
    writeFileSync(临时, html, 'utf8')
    const 参数 = [
      浏览器,
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--disable-extensions',
      `--window-size=${w},${h}`,
      `--screenshot=${输出}`,
      'file:///' + 临时.replace(/\\/g, '/'),
    ]
    if (透明) 参数.splice(1, 0, '--default-background-color=00000000')
    execFileSync(浏览器, 参数.slice(1), { timeout: 超时毫秒, stdio: 'ignore' })
    if (!existsSync(输出) || statSync(输出).size === 0) {
      return { ok: false, 说: '浏览器没吐出图来（渲染失败）' }
    }
    return { ok: true, 宽: w, 高: h, 路径: 输出, 大小: statSync(输出).size }
  } catch (error) {
    return { ok: false, 说: '渲染出错：' + String((error && error.message) || error) }
  } finally {
    try { unlinkSync(临时) } catch (error) {}
  }
}
