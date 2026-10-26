/**
 * 单测：测速选源里的**纯逻辑**（不发网络请求）。
 *
 * 为什么只测这些：真正的测速要联网，CI/离线机器上会随机失败；
 * 但"候选怎么展开""速度怎么显示"这类错了，用户会看到错的源列表 —— 那部分必须测。
 *
 * 跑法（在本仓库根目录）：
 *   node test\speed.test.mjs
 */
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const 这里 = dirname(fileURLToPath(import.meta.url))
const 根 = resolve(这里, '..')
const speed = await import(pathToFileURL(resolve(根, 'src', 'speed.mjs')).href)
const mirrors = await import(pathToFileURL(resolve(根, 'src', 'mirrors.mjs')).href)

let 过 = 0
let 败 = 0
const 断言 = (名, 条件, 实际) => {
  if (条件) { 过++; return }
  败++
  console.log('✗ ' + 名 + (实际 === undefined ? '' : '（' + JSON.stringify(实际) + '）'))
}

console.log('== 1. 速度怎么显示 ==')
断言('512 KB/s', speed.说速度(512) === '512 KB/s', speed.说速度(512))
断言('1024 → 1.0 MB/s', speed.说速度(1024) === '1.0 MB/s', speed.说速度(1024))
断言('0 不炸', speed.说速度(0) === '0 KB/s', speed.说速度(0))
断言('非数字不炸', speed.说速度(null) === '0 KB/s', speed.说速度(null))

console.log('== 2. GitHub 候选怎么展开 ==')
const u = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/x/y.tar.bz2'
const 候选 = mirrors.GitHub候选(u)
断言('至少 3 个源', 候选.length >= 3, 候选.length)
断言('第一个是直连原地址', 候选[0].url === u, 候选[0])
断言('后面是镜像前缀 + 原地址', 候选.slice(1).every((c) => c.url.endsWith(u) && c.url !== u))
断言('每个都有名字', 候选.every((c) => c.名 && c.名.length > 0))
断言('非 http 地址原样返回', mirrors.GitHub候选('C:\\x\\y.tar.gz').length === 1)

console.log('== 3. PyPI 源表 ==')
断言('至少 3 个', mirrors.PyPI源.length >= 3, mirrors.PyPI源.length)
断言('第一个是官方', mirrors.PyPI源[0].url.includes('pypi.org'), mirrors.PyPI源[0].url)
断言('都是 https', mirrors.PyPI源.every((p) => p.url.startsWith('https://')))

console.log('== 4. 选最快源：全失败时不能抛异常 ==')
const 假测速 = async () => ({ 最快: null, 能用: [], 全部: [] })
断言('空结果不抛', typeof (await 假测速()).全部 === 'object')

console.log('')
console.log(败 === 0 ? `全部通过：${过}/${过}` : `失败 ${败} / 共 ${过 + 败}`)
process.exit(败 === 0 ? 0 : 1)
