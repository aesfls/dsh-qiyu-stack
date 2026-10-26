// 下载源：直连慢的时候，先测速再挑。
//
// 为什么要这张表：国内直连 GitHub Releases / PyPI 经常只有几十 KB/s，
// 而镜像站可能几 MB/s。写死一个"官方源"等于让每个用户都慢一遍；
// 写死一个"镜像"又会在镜像挂掉时全挂。所以：**候选表 + 现场测速**。
//
// ⚠ 只放公开、无需登录的源；加了新的源要顺手在 tools/ 里验一次能不能真下。

/** GitHub 资源加速前缀（拼在原地址前面）。空串 = 直连。 */
export const GitHub前缀 = [
  { 名: '直连 GitHub', 前缀: '' },
  { 名: 'ghfast', 前缀: 'https://ghfast.top/' },
  { 名: 'gh-proxy', 前缀: 'https://gh-proxy.com/' },
  { 名: 'ghproxy.net', 前缀: 'https://ghproxy.net/' },
]

/** 把一个 GitHub 地址展开成所有候选（直连排第一，测速后再决定） */
export function GitHub候选(url) {
  const 原 = String(url || '')
  if (!/^https?:\/\//i.test(原)) return [{ 名: '原地址', url: 原 }]
  return GitHub前缀.map((p) => ({
    名: p.名,
    url: p.前缀 ? p.前缀 + 原 : 原,
  }))
}

/** pip 的 index-url 候选。测速时拿包页面当探针（比根路径更能反映真实速度）。 */
export const PyPI源 = [
  { 名: '官方 PyPI', url: 'https://pypi.org/simple' },
  { 名: '清华', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
  { 名: '阿里云', url: 'https://mirrors.aliyun.com/pypi/simple' },
  { 名: '中科大', url: 'https://mirrors.ustc.edu.cn/pypi/simple' },
]

/** Docker Hub（镜像拉取）：只用于提示，不改 docker 配置 */
export const Docker镜像站 = [
  { 名: '直连 Docker Hub', 前缀: '' },
  { 名: 'DaoCloud', 前缀: 'docker.m.daocloud.io/' },
  { 名: '1Panel', 前缀: 'docker.1panel.live/' },
  { 名: '南京大学', 前缀: 'docker.nju.edu.cn/' },
]
