// qiyu init —— 生成一个角色包（白纸起步，也可以带着答案来）
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const 包根 = join(dirname(fileURLToPath(import.meta.url)), '..')

// 角色包里先建好、但保持空着的目录：替使用者把"东西该放哪"定下来
const 空目录 = ['letters', 'stickers', 'inbox', 'diary', 'voice', 'memory']

// ---------- 作答的默认值（用户啥都不选时就这些） ----------
export const 默认答案 = {
  qq: '',
  称呼: '你',
  作息: 'regular',
  性格: 'blank',
  自改: 'ask',
}

// ---------- 作息三档 ----------
export const 作息档 = {
  regular: {
    名: '规律作息',
    说明: '00:00–08:30 睡 / 08:30–19:30 惰性 / 19:30–24:00 活跃',
    段: [
      { 名: '休息', 起: '00:00', 止: '08:30' },
      { 名: '惰性', 起: '08:30', 止: '19:30' },
      { 名: '活跃', 起: '19:30', 止: '24:00' },
    ],
  },
  night: {
    名: '夜猫子',
    说明: '04:00–12:00 睡 / 12:00–20:00 惰性 / 20:00–24:00 活跃',
    段: [
      { 名: '休息', 起: '04:00', 止: '12:00' },
      { 名: '惰性', 起: '12:00', 止: '20:00' },
      { 名: '活跃', 起: '20:00', 止: '24:00' },
    ],
  },
  always: {
    名: '全天活跃',
    说明: '不睡，随时都能被叫醒 —— 群里会显得太秒回，慎选',
    段: [
      { 名: '休息', 起: '00:00', 止: '00:00' },
      { 名: '惰性', 起: '00:00', 止: '00:00' },
      { 名: '活跃', 起: '00:00', 止: '24:00' },
    ],
  },
}

// ---------- 性格三档（只填「性格」那六行，不动行为层） ----------
const 性格档 = {
  blank: {
    名: '留白',
    说明: '什么都不写，说话会比较平，但能跑',
    行: null,
  },
  gentle: {
    名: '温和陪伴',
    说明: '软一点，会等你说完，不急着给结论',
    行: [
      '年龄：十几岁',
      '说话习惯：短句，语气软，不急着下结论；偶尔用「呀」「哦」收尾',
      '喜欢：听人说话、晴天、热面包',
      '讨厌：被催、被当成工具',
      '口头禅：「我在的」',
      '一句自我介绍：「我在呢，慢慢说。」',
    ],
  },
  concise: {
    名: '简洁助手',
    说明: '短、直接，先给结论再补半句原因，不寒暄',
    行: [
      '年龄：（不写）',
      '说话习惯：短，直接，先给结论再补半句原因；不寒暄',
      '喜欢：把事做完',
      '讨厌：绕圈子',
      '口头禅：「说重点。」',
      '一句自我介绍：「直接说，我来办。」',
    ],
  },
}

// ---------- 能不能自己改性格 ----------
const 自改档 = {
  ask: { 名: '改之前先问一声', 句: '想改这份文件里的哪一句，**先问一声再改**。' },
  free: { 名: '可以自己改', 句: '这份文件你可以自己改，改完下一轮就生效。' },
  locked: { 名: '不许改', 句: '这份文件你不改；要改什么，说一声，由对方动手。' },
}

function 拷模板(源目录, 目标目录, 替换表) {
  for (const 名 of readdirSync(源目录)) {
    const 源 = join(源目录, 名)
    // 模板里的 .tpl 后缀只是为了让编辑器/智能体别把它当成真文件，拷出去时去掉
    const 目标名 = 名.endsWith('.tpl') ? 名.slice(0, -4) : 名
    const 目标 = join(目标目录, 目标名)
    if (statSync(源).isDirectory()) {
      mkdirSync(目标, { recursive: true })
      拷模板(源, 目标, 替换表)
      continue
    }
    let 内容 = readFileSync(源, 'utf8')
    for (const [k, v] of Object.entries(替换表)) 内容 = 内容.split(k).join(v)
    writeFileSync(目标, 内容, 'utf8')
  }
}

function 写作息(路径, 档) {
  const 对象 = {
    时区: 'Asia/Shanghai',
    时段: 档.段,
    规则: {
      休息: { 私聊: '攒着', '群被@': '攒着', 群闲聊: '攒着' },
      惰性: { 私聊: '立刻', '群被@': '立刻', 群闲聊: '攒着' },
      活跃: { 私聊: '立刻', '群被@': '立刻', 群闲聊: '立刻' },
    },
    说明: [
      '「攒着」= 先不叫醒 ta，等换到下一个时段、或者有人私聊/@ 时一起给。',
      '这三段是创建时选的，按你们家的作息改；改完重跑一次桥就会读到。',
      '别把「休息」改成全天——ta 会半夜冒出来，群里的人会被吓到。',
    ],
  }
  writeFileSync(路径, JSON.stringify(对象, null, 2) + '\n', 'utf8')
}

function 填性格(路径, 档) {
  if (!档.行) return
  const 文 = readFileSync(路径, 'utf8')
  const 新块 = ['## 性格', '', ...档.行.map((l) => '- ' + l), ''].join('\n')
  const 换后 = 文.replace(/## 性格[^\n]*\n\n[\s\S]*?\n---/, 新块 + '\n---')
  if (换后 !== 文) writeFileSync(路径, 换后, 'utf8')
}

function 填角色(路径, 名字, 答案) {
  let j
  try {
    j = JSON.parse(readFileSync(路径, 'utf8'))
  } catch {
    return
  }
  j.名字 = 名字
  if (答案.qq) j.qq = Number(答案.qq) || 0
  if (答案.称呼) {
    j.称呼 = j.称呼 || {}
    j.称呼.主人 = String(答案.称呼)
  }
  writeFileSync(路径, JSON.stringify(j, null, 2) + '\n', 'utf8')
}

export async function init(名字, { 模板 = 'blank', 覆盖 = false, 答案 = {} } = {}) {
  const 干净名 = String(名字).trim().replace(/[\\/:*?"<>|]/g, '')
  if (!干净名) {
    console.error('名字里没有可用字符')
    return 1
  }

  const 模板目录 = resolve(包根, 'templates', 模板)
  if (!existsSync(模板目录)) {
    console.error(`没有「${模板}」这个模板。现在有：` + readdirSync(join(包根, 'templates')).join('、'))
    return 1
  }

  const 目标 = resolve(process.cwd(), 'characters', 干净名)
  if (existsSync(目标) && !覆盖) {
    console.error(`「${干净名}」已经存在了：${目标}\n要覆盖就加 --force`)
    return 1
  }

  const 答 = { ...默认答案, ...(答案 || {}) }
  const 自改 = 自改档[答.自改] || 自改档[默认答案.自改]
  const 作息 = 作息档[答.作息] || 作息档[默认答案.作息]
  const 性格 = 性格档[答.性格] || 性格档[默认答案.性格]

  mkdirSync(目标, { recursive: true })
  for (const d of 空目录) mkdirSync(join(目标, d), { recursive: true })

  拷模板(模板目录, 目标, {
    '{{NAME}}': 干净名,
    '{{SELF_EDIT}}': 自改.句,
  })

  写作息(join(目标, 'schedule.json'), 作息)
  填性格(join(目标, 'AGENTS.md'), 性格)
  填角色(join(目标, 'character.json'), 干净名, 答)

  // 角色自己的 .gitignore：这些都别进版本库
  writeFileSync(
    join(目标, '.gitignore'),
    ['memory/', 'inbox/', 'diary/', 'voice/', '*.log', '.state/'].join('\n') + '\n',
    'utf8'
  )

  // 记下「当前活动角色」：这样 deploy 出码时能说出她的名字，而不是干巴巴一句"扫这个"
  try {
    const 配置路径 = resolve(process.cwd(), 'qiyu.config.json')
    let 旧配置 = {}
    if (existsSync(配置路径)) {
      try {
        旧配置 = JSON.parse(readFileSync(配置路径, 'utf8').replace(/^\uFEFF/, '')) || {}
      } catch {
        旧配置 = {}
      }
    }
    旧配置.角色 = 干净名
    writeFileSync(配置路径, JSON.stringify(旧配置, null, 2) + '\n', 'utf8')
  } catch {
    /* 记不住就算了，deploy 会退回到"她" */
  }

  console.log('')
  console.log(`✅ 角色「${干净名}」建好了：${目标}`)
  console.log('')
  console.log('  她现在是这样：')
  console.log(`   · 名字　　${干净名}`)
  console.log(`   · 称呼你　${答.称呼}`)
  console.log(`   · QQ 号　 ${答.qq || '（没填，登录后自动认）'}`)
  console.log(`   · 作息　　${作息.名}（${作息.说明}）`)
  console.log(`   · 性格　　${性格.名}${性格.说明 ? '（' + 性格.说明 + '）' : ''}`)
  console.log(`   · 改性格　${自改.名}`)
  console.log('')
  console.log('接下来：')
  console.log(`  1. 想调性格/规矩，改 ${join(目标, 'AGENTS.md')}（她每一轮都会重读）`)
  console.log(`  2. 想加表情包，丢进 ${join(目标, 'stickers')}`)
  console.log(`  3. qiyu install --character ${干净名} --yes  —— 装进 DSH 并让她成为活动角色`)
  return 0
}

export { 性格档, 自改档 }
