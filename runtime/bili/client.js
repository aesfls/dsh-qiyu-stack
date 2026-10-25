/**
 * dsh-bili-scroll —— 浏览器半端（**设置在「设置」里的一页**）
 * ============================================================================
 * ⭐ **client bundle 不是 ESM，是自注册脚本**（2026-10-14 从官方包里挖到的约定）：
 *
 *     window.__ModuleLoader__.load({
 *       id: '<包名>',                       // 必须等于 package.json 的 name
 *       factory: (require) => { ... return { inject: [...], apply(ctx) {...} } },
 *     })
 *
 * ⭐ **怎么进「设置」**（抄第三方插件 `dsh-meme/client.js`，2026-10-14 使用者指出位置不对后才查到）：
 *
 *     const slots = ctx.get('slots')
 *     slots.inject('settings.section', () => slots.register(
 *       { name: 'settings.section', id: 'bili-scroll', order: 30, label: '刷B站' },   // label = 左侧导航那一项
 *       () => h(Panel),
 *     ))
 *
 *   ⇒ **别自己糊一个标题栏按钮 + 全屏 overlay** ✗（第一版就是这么干的，使用者一眼看出"跟别的插件不一样"）。
 *
 * 这一页要满足使用者 2026-10-14 说的形状：
 *   · **总开关 → 打开之后下面才展开子开关**（峰谷自动刷 → 中午 / 晚上）
 *   · **数字项要能自己填**（定量刷：每天几条）
 *   · **账号绑定必须在设置页里**（扫码登录 + 二维码直接显示在页里）
 *   · 会发东西出去的（自动评论）、要下大模型的（本地转写）**默认关**
 * ============================================================================
 */
window.__ModuleLoader__.load({
  // ⚠️ 这一行必须等于 package.json 的 name（加载器按包名找工厂，对不上就报
  //    "web boot: 1 entry did not activate … loaded without registering <包名>"）。
  //    fork 改名时最容易漏的就是它 —— selfcheck.mjs / _preflight.js 都会断言这一条。
  id: 'dsh-bili-subagent',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/bili-duty'
    /* ⚠️ 原来 jget/jpost 直接 .json()、从不看 res.ok ⇒ HTTP 500 的 {ok:false,error}
     *    会被调用方当成「已保存 / 成功」，绿色提示把故障盖掉。（2026-10-16 审查修） */
    const asJson = async (res) => {
      if (res.ok) return res.json()
      const why = res.status === 401 ? '（未登录 / 没权限）' : res.status === 403 ? '（被宿主拦了）' : ''
      throw new Error('HTTP ' + res.status + why)
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const CSS = `
[data-bd-page]{display:flex;flex-direction:column;gap:18px;padding:2px 2px 8px;max-width:640px;}
[data-bd-sec]{display:flex;flex-direction:column;gap:8px;}
[data-bd-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-row]{display:flex;align-items:center;gap:10px;}
[data-bd-grow]{flex:1;min-width:0;}
[data-bd-label]{font-size:13px;}
[data-bd-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-code]{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;line-height:1.65;white-space:pre-wrap;word-break:break-all;padding:8px 10px;border-radius:7px;background:rgba(127,127,127,.10);}
[data-bd-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-bd-sw][data-on]{background:#3b82f6;}
[data-bd-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;
  transition:left .15s;display:block;}
[data-bd-sw][data-on] i{left:19px;}
[data-bd-sw][disabled]{opacity:.45;cursor:default;}
[data-bd-sub]{margin-left:14px;padding-left:12px;border-left:2px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));
  display:flex;flex-direction:column;gap:10px;}
[data-bd-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:inherit;font-family:inherit;}
[data-bd-input]:focus{outline:none;border-color:#3b82f6;}
[data-bd-num]{width:88px;text-align:center;}
[data-bd-btn]{padding:7px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));color:inherit;}
[data-bd-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
[data-bd-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-bd-btn][disabled]{opacity:.5;cursor:default;}
[data-bd-msg]{font-size:11px;line-height:16px;padding:7px 9px;border-radius:8px;word-break:break-all;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bd-msg][data-warn]{color:#f59e0b;}
[data-bd-msg][data-good]{color:#22c55e;}
[data-bd-qr]{display:flex;gap:14px;align-items:flex-start;}
[data-bd-qr] img{width:150px;height:150px;border-radius:8px;background:#fff;padding:6px;}
[data-bd-pre]{margin:6px 0 0;padding:8px 9px;border-radius:8px;max-height:170px;overflow:auto;font-size:11px;
  line-height:15px;white-space:pre-wrap;word-break:break-all;
  background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.25));color:var(--dsw-alias-label-secondary,#c9ccd1);}
[data-bd-kv]{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a6);word-break:break-all;}
[data-bd-badge]{font-size:11px;padding:2px 7px;border-radius:6px;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));color:var(--dsw-alias-label-secondary,#c9ccd1);}

/* ── 栖语面板里修：flex 行里的控件不再抢满一行（否则左边的字会被挤成一列一个）── */
[data-bd-row]>select[data-bd-input]{flex:0 0 auto;width:auto;min-width:140px;max-width:70%;}
[data-bd-row]>[data-bd-grow]{flex:1;min-width:10em;}
`

    // ⚠️ 与 lib/state.mjs 的 WINDOWS 保持一致
    // 2026-10-22 改成跟她的活跃时段（19:30–24:00）绑，中午段停用
    const DEFAULT_WINDOWS = {
      active: { label: '她活跃的时候', start: '19:30', end: '24:00' },
      noon: { label: '中午（已停用）', start: '12:00', end: '12:00' },
    }

    /* ────────────── 小组件 ────────────── */

    function Switch({ on, onChange, disabled }) {
      return h('button', {
        'data-bd-sw': '',
        'data-on': on ? '' : undefined,
        disabled: Boolean(disabled),
        title: on ? '已开' : '已关',
        onClick: () => { if (!disabled) onChange(!on) },
      }, h('i'))
    }

    function ToggleRow({ label, note, on, onChange, disabled }) {
      return h('div', { 'data-bd-row': '' },
        h('div', { 'data-bd-grow': '' },
          h('div', { 'data-bd-label': '' }, label),
          note ? h('div', { 'data-bd-note': '' }, note) : null),
        h(Switch, { on, onChange, disabled }))
    }

    function useStatus(intervalMs) {
      const [st, setSt] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const d = await jget('/status')
            if (alive && d?.ok) setSt(d)
          } catch { /* 网络抖动就下次再问 */ }
        }
        tick()
        const t = setInterval(tick, intervalMs || 5000)
        return () => { alive = false; clearInterval(t) }
      }, [intervalMs])
      return [st, setSt]
    }

    /* ────────────── 设置页正文 ────────────── */

    function Panel() {
      const [st, setSt] = useStatus(5000)
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [msgTone, setMsgTone] = React.useState('')
      const [rl, setRl] = React.useState(null)
      // ⚠️ 输入框必须绑"本地草稿"：页面每 5 秒轮询 /status，服务端那份会把 config 盖掉
      //    ⇒ 直接绑 cfg 的话，用户打字打到一半就被冲没了 ✗（2026-10-14 陌生人验收时抓到）
      const [perDay, setPerDay] = React.useState(null)
      const [gapHours, setGapHours] = React.useState(null)
      const [perScan, setPerScan] = React.useState(null)
      const [dmUid, setDmUid] = React.useState(null)        // 私信收件人 UID（本地草稿）
      const [dmMode, setDmMode] = React.useState(null)      // 投递方式：off / only / both
      const [subProvider, setSubProvider] = React.useState(null)   // 派子代理用的 provider
      const [subModel, setSubModel] = React.useState(null)         // 派子代理用的 model
      const [ownerName, setOwnerName] = React.useState(null)       // 称呼
      const [scanPrompt, setScanPrompt] = React.useState(null)     // 子代理提示词
      const [hintPrompt, setHintPrompt] = React.useState(null)     // 投递提示（发给伙伴看的那段）
      const [triggerPrompt, setTriggerPrompt] = React.useState(null) // 自动刷触发语
      const [cfgDefaults, setCfgDefaults] = React.useState(null)      // 服务端给的默认文案（「恢复默认」用）
      const [targetSession, setTargetSession] = React.useState(null) // 自动刷在哪个会话触发
      const [minViews, setMinViews] = React.useState(null)           // 门槛：最低播放量（0 = 不过滤）
      const [minAgeDays, setMinAgeDays] = React.useState(null)       // 门槛：至少发布几天（0 = 不过滤）
      const [sessions, setSessions] = React.useState(null)          // 会话列表（下拉用）
      const [models, setModels] = React.useState(null)             // 可选 providers/models 列表（下拉用）
      const [mention, setMention] = React.useState(null)
      const [login, setLogin] = React.useState(null)
      const [runNote, setRunNote] = React.useState(null)
      const [up, setUp] = React.useState(null)          // 这个插件自己的版本信息
      const [inboxUids, setInboxUids] = React.useState(null)        // 还要理谁（本地草稿）
      const [inboxMaxRemind, setInboxMaxRemind] = React.useState(null)  // 没回提醒几次（本地草稿）
      const [inboxPerDay, setInboxPerDay] = React.useState(null)        // 一天最多回别人几条（本地草稿）
      const [upBusy, setUpBusy] = React.useState(false)
      const [report, setReport] = React.useState(null)        // 非 null = 报告已展开   // 顶部那行状态（跑一轮/装依赖的反馈原来在最底下，看不见）
      const [loginState, setLoginState] = React.useState('')
      const [loginTone, setLoginTone] = React.useState('')
      /* ⚠️ 扫码轮询的 timer 必须能停：切走设置页后还在跑的话会在已卸载的组件上 setState，
       *    重复点「扫码登录」还会叠出第二个 timer。（2026-10-16 审查修） */
      const loginTimer = React.useRef(null)
      const alive = React.useRef(true)
      React.useEffect(() => () => {
        alive.current = false
        if (loginTimer.current) { clearInterval(loginTimer.current); loginTimer.current = null }
      }, [])

      const cfg = st?.config
      if (st && st.defaults && cfgDefaults === null) setCfgDefaults(st.defaults)
      React.useEffect(() => {
        if (cfg && rl === null) setRl(cfg.reportLevel || 'full')
        if (cfg && perDay === null) setPerDay(String(cfg.perDay ?? 5))
        if (cfg && gapHours === null) setGapHours(String(cfg.gapHours ?? 3))
        if (cfg && perScan === null) setPerScan(String(cfg.perScan ?? 1))
        if (cfg && mention === null) setMention(cfg.mentionName || '')
        if (cfg && dmUid === null) setDmUid(cfg.dmUid ? String(cfg.dmUid) : '')
        if (cfg && dmMode === null) setDmMode(cfg.dmMode || 'off')
        if (cfg && subProvider === null) setSubProvider(cfg.subProvider || 'apii')
        if (cfg && subModel === null) setSubModel(cfg.subModel || 'deepseek-v4-pro')
        if (cfg && ownerName === null) setOwnerName(cfg.ownerName || '')
        if (cfg && inboxUids === null) setInboxUids(String(cfg.inboxUids || ''))
        if (cfg && inboxMaxRemind === null) setInboxMaxRemind(String(cfg.inboxMaxRemind ?? 2))
        if (cfg && inboxPerDay === null) setInboxPerDay(String(cfg.inboxPerDay ?? 5))
        if (cfg && scanPrompt === null) setScanPrompt(cfg.scanPrompt || '')
        if (cfg && hintPrompt === null) setHintPrompt(cfg.hintPrompt || '')
        if (cfg && triggerPrompt === null) setTriggerPrompt(cfg.triggerPrompt || '')
        if (cfg && targetSession === null) setTargetSession(cfg.targetSession || '')
        if (cfg && minViews === null) setMinViews(String(cfg.minViews ?? 0))
        if (cfg && minAgeDays === null) setMinAgeDays(String(cfg.minAgeDays ?? 0))
      }, [cfg])
      React.useEffect(() => { jget('/update').then((r) => setUp(r)).catch(() => {}) }, [])

      React.useEffect(() => {
        let aliveM = true
        jget('/models').then((d) => { if (aliveM && d?.providers) setModels(d.providers) }).catch(() => {})
        return () => { aliveM = false }
      }, [])

      React.useEffect(() => {
        let aliveS = true
        jget('/sessions').then((d) => { if (aliveS && d?.sessions) setSessions(d.sessions) }).catch(() => {})
        return () => { aliveS = false }
      }, [])

      const win = { ...DEFAULT_WINDOWS, ...(st?.windows || {}) }

      const say = (text, tone) => {
        setMsg(text); setMsgTone(tone || '')
        setRunNote(text ? { t: text, tone: tone || '' } : null)   // ⭐ 同时镜像到顶部，免得提示掉到页面最底下看不见
      }

      const patch = async (p, what) => {
        setBusy(JSON.stringify(p))
        try {
          const r = await jpost('/config', p)
          if (r?.config) setSt((old) => ({ ...old, config: r.config }))
          // ⭐ DSH 原生设置页里显式设过的键由宿主说了算 ⇒ 我们这份也得写进去；写失败要说出来，别假装"已保存"
          if (r?.host && r.host.ok === false) say(`${what || '设置'}：插件自己那份存了，但 DSH 设置页那份没写进去（${r.host.error}）`, 'warn')
          else say(what ? `${what}：已保存` : '已保存', 'good')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onShowReport = async () => {
        if (report !== null) { setReport(null); return }       // 再点一次收起
        setBusy('report')
        try {
          const r = await jget('/report')
          setReport(r && r.exists ? (r.text || '（报告是空的）') : '今天还没有报告 —— 跑一轮之后就有了')
        } catch (e) { setReport('读不到报告：' + String(e?.message ?? e)) } finally { setBusy('') }
      }

      // ⭐ 复核评论：接口回"发送成功"≠ 公开可见（新号/风控会进审核，那时候连 @ 都不会推）
      //    所以让宿主真去拉一次评论列表 / 楼中楼，确认那条到底在不在。
      const onVerify = async () => {
        setBusy('verify')
        try {
          const r = await jpost('/verify', {})
          if (!r || !r.ok) { say('复核没跑成：' + ((r && r.error) || '未知原因'), 'warn'); return }
          const n = (r.checked || []).length
          const vis = (r.checked || []).filter((c) => c.visible === true).length
          if (!n) say(r.text || '没有需要复核的记录', 'good')
          else say(`复核完 ${n} 条：公开可见 ${vis} 条，其余「没查到」（可能还在审核 —— 看不到不等于没发出去）。结果也追加到今天的报告末尾了。`, vis ? 'good' : 'warn')
          if (r.report) setReport(null)
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const copyText = async (text) => {
        const v = String(text || '')
        try {
          await navigator.clipboard.writeText(v)
          say('已复制：' + v, 'good')
        } catch {
          say('复制失败 —— 路径是：' + v)       // 兜底：至少把路径显示出来，手动选中也能复制
        }
      }

      const onOpenFolder = async (what) => {
        try {
          const r = await jpost('/open', { what })
          if (r && r.ok) say('已请系统打开：' + (r.opened || '') + '（要是没看到窗口，用旁边的「复制报告路径」——那个一定成）', 'good')
          else say('打不开（' + ((r && r.error) || '未知原因') + '）—— 你可以手动打开这个路径：' + ((r && r.dir) || ''))
        } catch (e) { say(String(e?.message ?? e), 'warn') }
      }

      const onUpgrade = async () => {
        setBusy('upgrade')
        try {
          const r = await jpost('/upgrade', {})
          // 原来这两句分两次 say，第二句把服务端的 hint 冲掉了 —— 合成一句。（2026-10-16 审查修）
          say(((r && r.hint) || '正在升级') + ' —— 升级过程写在下面的「主依赖的日志」里；完了记得重启一次 dsh（不重启还是旧版）', 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onCheck = async () => {
        setBusy('check')
        say('')
        try {
          const r = await jpost('/check', {})
          if (r && r.ok) say('能用！' + (r.steps || []).join('、'))
          else say('还不能用：' + (r && r.error ? r.error : '没拿到结果'))
        } catch (e) { say(String(e?.message ?? e), 'warn') } finally { setBusy('') }
      }

      const onInstall = async () => {
        setBusy('install')
        say('')
        try {
          const r = await jpost('/install', {})
          say(r?.hint || '已经在后台开始装了', '')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onRun = async () => {
        setBusy('run')
        say('去那个会话里叫它刷了，稍等…', '')
        try {
          const r = await jpost('/run', {})
          if (r?.ok && r.started) say('已经在选定的会话里叫它去刷了 —— 切过去看它的回复就好', 'good')
          else say(r?.error || '没起来，看 duty.log', 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onLoginStart = async () => {
        setBusy('login')
        setLoginTone('')
        setLoginState('正在出码…')
        try {
          const r = await jpost('/login/start', {})
          if (!r?.ok) { setLoginTone('warn'); setLoginState(r?.error || '出码失败'); return }
          setLogin({ key: r.key, qr: r.qr })
          if (!r.qr) { setLoginTone('warn'); setLoginState('没画出二维码 —— 先点上面的「重装依赖」（venv 里要有 qrcode）') }
          else setLoginState('用手机 B站 扫这张码')
          if (loginTimer.current) { clearInterval(loginTimer.current); loginTimer.current = null }   // 重复点：先把上一轮停掉
          let n = 0
          const stop = () => { clearInterval(timer); if (loginTimer.current === timer) loginTimer.current = null }
          const timer = setInterval(async () => {
            if (!alive.current) { stop(); return }        // 已经切走设置页了：别再问、别再 setState
            n += 1
            try {
              const p = await jpost('/login/poll', { key: r.key })
              if (p?.state === 'ok') {
                stop(); setLogin(null)
                setLoginTone('good'); setLoginState('登录成功')
                setSt((old) => ({ ...old, loggedIn: true }))
              } else if (p?.state === 'scanned') { setLoginTone(''); setLoginState('扫到了，请在手机上确认') }
              else if (p?.state === 'expired') { stop(); setLogin(null); setLoginTone('warn'); setLoginState('二维码过期了，再点一次「扫码登录」') }
              // ⚠️ 扫码成功但响应里没有 SESSDATA 时服务端回 state='unknown'：原来没这个分支
              //    ⇒ 界面一直显示「等扫码…」，用户白等 3 分钟才超时。（2026-10-16 审查修）
              else if (p?.state === 'unknown') {
                stop(); setLogin(null); setLoginTone('warn')
                setLoginState('没登上：' + (p?.message || '响应里没有 SESSDATA —— 再点一次「扫码登录」'))
              }
              else { setLoginTone(''); setLoginState('等扫码…') }
            } catch { /* 抖动就下次再问 */ }
            if (n > 90) { stop(); setLogin(null); setLoginTone('warn'); setLoginState('超时了，再点一次「扫码登录」') }
          }, 2000)
          loginTimer.current = timer
        } catch (e) { setLoginTone('warn'); setLoginState(String(e?.message ?? e)) }
        finally { setBusy('') }
      }

      if (!cfg) {
        return h('div', { 'data-bd-page': '' }, h('div', { 'data-bd-note': '' }, '读设置中…'))
      }

      const 更新命令 = ['dsh plugin --profile web remove dsh-bili-subagent', 'dsh plugin --profile web add dsh-bili-subagent'].join(String.fromCharCode(10))
      const checkUpdate = async () => {
        setUpBusy(true)
        try {
          const r = await jget('/update?refresh=1')
          if (r) setUp(r)
          setMsg(!r ? '查不到（网络）' : r.hasUpdate ? '有新版本 v' + r.latest : r.ok ? '已经是最新版' : '查不到：' + (r.error || '网络'))
        } catch (e) { setMsg('查不到：' + (e && e.message)) }
        setUpBusy(false)
      }

      // 手动看一眼 @ 和回复
      const onInbox = async () => {
        setBusy('inbox')
        try {
          const r = await jpost('/inbox', {})
          setMsg((r && (r.hint || ('拿到 ' + (r.count || 0) + ' 条'))) || '看完了')
        } catch (e) {
          setMsg('看一眼失败：' + (e && e.message))
        }
        setBusy('')
      }

      const sw = (k) => Boolean(cfg[k])

      return h('div', { 'data-bd-page': '' },

        /* ── 今天 ── */
        h('div', { 'data-bd-row': '' },
          h('span', { 'data-bd-badge': '' }, `今天已自动刷 ${st.autoRoundsToday ?? 0} / ${cfg.perDay} 轮`),
          h('span', { 'data-bd-badge': '' }, '环境' + (st.venvReady ? '已就绪' : (st.installing ? '正在装' : '未装'))),
          h('span', { 'data-bd-badge': '' }, st.loggedIn ? 'B站已登录' : 'B站未登录'),
            h('span', { 'data-bd-badge': '' }, 'v' + (st.version || '?')),
          h('div', { 'data-bd-grow': '' }),
          h('button', { 'data-bd-btn': '', disabled: busy === 'run', onClick: onRun }, '现在跑一轮')),
          runNote ? h('div', { 'data-bd-msg': '', 'data-good': runNote.tone === 'good' ? '' : undefined,
            'data-warn': runNote.tone === 'warn' ? '' : undefined }, runNote.t) : null,

        /* ── 版本 / 检查更新 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '版本'),
          h('div', { 'data-bd-row': '' },
            h('span', { 'data-bd-note': '' },
              !up ? '正在看有没有新版…'
                : up.hasUpdate ? '仓库里已经有 v' + up.latest + ' 了'
                  : up.ok ? '已经是最新版' : '暂时查不到（' + (up.error || '网络') + '）—— 这不代表没有问题'),
            h('div', { 'data-bd-grow': '' }),
            h('button', { 'data-bd-btn': '', disabled: upBusy, onClick: checkUpdate },
              upBusy ? '查…' : '检查更新')),
          (up && up.hasUpdate) ? h('div', { 'data-bd-note': '' }, '更新方法：先卸旧版再装新版（直接装可能拿到缓存里的旧副本）。') : null,
          (up && up.hasUpdate) ? h('div', { 'data-bd-code': '' }, 更新命令) : null,
          (up && up.hasUpdate)
            ? h('div', { 'data-bd-row': '' },
              h('button', {
                'data-bd-btn': '',
                onClick: () => navigator.clipboard.writeText(更新命令).then(() => setMsg('命令已复制')).catch(() => setMsg('复制不了，手动选中吧')),
              }, '复制命令'),
              (up.repoUrl ? h('a', { 'data-bd-note': '', href: up.repoUrl, target: '_blank', rel: 'noreferrer' }, '去 GitHub 看看') : null))
            : null),

        /* ── 定时 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '什么时候自己跑'),
          h(ToggleRow, {
            label: '到点自动刷',
            note: '默认跟她活跃的时候绑：19:30–24:00（她精神好、API 也是半价）。关了就只能手动跑',
            on: sw('peakValley'),
            onChange: (v) => patch({ peakValley: v }, '到点自动刷'),
          }),
          sw('peakValley') ? h('div', { 'data-bd-sub': '' },
            ...['active', 'noon'].map((k) => h(ToggleRow, {
              key: k,
              label: win[k].label,
              note: `${win[k].start} – ${win[k].end}`,
              on: sw(k),
              onChange: (v) => patch({ [k]: v }, win[k].label),
            })),
            h('div', { 'data-bd-row': '' },
              h('div', { 'data-bd-grow': '' },
                h('div', { 'data-bd-label': '' }, '两轮之间至少隔几小时'),
                h('div', { 'data-bd-note': '' }, '窗口里按这个节奏一轮一轮来，跑到「每天最多自动刷几轮」用完为止；手动跑不受限制')),
              h('input', {
                'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 12,
                value: gapHours ?? '',
                onChange: (e) => setGapHours(e.target.value),
                onBlur: () => { const n = Math.max(1, Math.min(Number(gapHours) || 3, 12)); setGapHours(String(n)); patch({ gapHours: n }, '轮间隔') },
              }))) : null),

        /* ── 派子代理刷的模型 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '派子代理刷的模型'),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, 'provider（模型厂商）'),
              h('select', {
                'data-bd-input': '', value: subProvider ?? '',
                onChange: (e) => {
                  const v = e.target.value
                  setSubProvider(v)
                  const first = ((models || []).find((p) => p.id === v)?.models || [])[0]?.id || ''
                  setSubModel(first)
                  patch({ subProvider: v, subModel: first }, '子代理 provider')
                },
              },
                ...((models || []).map((p) => h('option', { value: p.id }, (p.name || p.id) + '（' + p.id + '）')))))),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, 'model（模型名）'),
              h('select', {
                'data-bd-input': '', value: subModel ?? '',
                onChange: (e) => { const v = e.target.value; setSubModel(v); patch({ subModel: v }, '子代理 model') },
              },
                ...((((models || []).find((p) => p.id === subProvider) || {}).models || []).map((m) => h('option', { value: m.id }, (m.name || m.id) + '（' + m.id + '）')))))),
        ),

        /* ── 自动刷在哪个会话 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '自动刷在哪个会话'),
          h('div', { 'data-bd-note': '' }, '谷时自动刷的时候，去哪个会话里叫她。选你跟她平时聊天的那个就好。'),
          h('select', {
            'data-bd-input': '', value: targetSession ?? '',
            onChange: (e) => { const v = e.target.value; setTargetSession(v); patch({ targetSession: v }, '自动刷会话') },
          },
            h('option', { value: '' }, '（不选 = 自动挑最近聊过的）'),
            ...((sessions || []).map((s) => h('option', { value: s.id }, s.title + '（' + s.id.slice(0, 14) + '…）'))))),

        /* ── 它刷过的视频（卡片墙） ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '它刷过的视频'),
          h('div', { 'data-bd-note': '' }, '每条视频一份笔记（`reports/<BV>-<日期>.md`）。点「刷新」读出来看，以后能查「这条看过没、当时怎么说的」。'),
          h('div', { 'data-bd-row': '' },
            h('button', {
              'data-bd-btn': '',
              onClick: async () => {
                const box = document.getElementById('bd-cards')
                const 换行 = String.fromCharCode(10)
                if (box) box.innerText = '读取中…'
                try {
                  const r = await jget('/cards')
                  const cards = (r && r.cards) || []
                  if (!cards.length) { if (box) box.innerText = '还没有笔记 —— 跑一轮之后就有了'; return }
                  const 行们 = []
                  for (const c of cards) {
                    行们.push('· ' + (c.date || '') + '　' + c.bvid + (c['档'] ? '　【' + c['档'] + '】' : ''))
                    if (c.title) 行们.push('   ' + c.title)
                    if (c.why) 行们.push('   ' + c.why)
                  }
                  if (box) box.innerText = 行们.join(换行)
                } catch (e) {
                  if (box) box.innerText = '读不出来：' + ((e && e.message) || e)
                }
              },
            }, '刷新')),
          h('div', { id: 'bd-cards', 'data-bd-note': '', style: { whiteSpace: 'pre-wrap', lineHeight: '1.8', marginTop: '8px' } })),

        /* ── 三连 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '要不要给视频点个赞'),
          h('div', { 'data-bd-note': '' }, '刷完一轮，对**这一轮最值得的那条**做个动作。默认关着 —— 别人装了不该莫名给视频点赞，更不该花人家的硬币。'),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '三连模式'),
              h('div', { 'data-bd-note': '' }, '一键三连 = 点赞 + 投币 + 收藏；点过 / 收过的会自动跳过，不重复')),
            h('select', {
              'data-bd-input': '', value: String(cfg.tripleMode || 'off'),
              onChange: (e) => patch({ tripleMode: e.target.value }, '三连模式'),
            },
              h('option', { value: 'off' }, '不动（默认）'),
              h('option', { value: 'like' }, '只点赞'),
              h('option', { value: 'coin' }, '只投币'),
              h('option', { value: 'fav' }, '只收藏'),
              h('option', { value: 'like_fav' }, '点赞 + 收藏'),
              h('option', { value: 'triple' }, '一键三连（赞+币+收藏）'))),
          h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-label': '' }, '投币枚数'),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 2,
              defaultValue: String(cfg.tripleCoin ?? 1),
              onBlur: (e) => patch({ tripleCoin: Math.max(1, Math.min(Number(e.target.value) || 1, 2)) }, '投币枚数'),
            }),
            h('div', { 'data-bd-note': '' }, '1 或 2 枚。⚠️ 投币会**花账号里的硬币**，每天有上限。')),
          h(ToggleRow, {
            label: '每条视频写一份笔记',
            note: '存在 reports/<BV>-<日期>.md，以后能查「这条看过没、当时怎么说的」',
            on: cfg.notesOn !== false,
            onChange: (v) => patch({ notesOn: v }, '每视频笔记'),
          })),

        /* ── 收到的 @ 和回复 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '收到的 @ 和回复'),
          h('div', { 'data-bd-note': '' }, '每轮刷之前顺手看一眼：有人 @ 了你、或者回了你的评论，就把内容**递到伙伴手上，让她自己看、自己决定回不回** —— 插件不替她说话，也不打分。默认谁都理（想只看某几个人，就填下面的「还要理谁」）。'),
          h(ToggleRow, {
            label: '每轮顺手看一眼 @ 和回复',
            note: '关掉就完全不看（别人的乱 @ 从来不看）',
            on: Boolean(cfg.inboxOn),
            onChange: (v) => patch({ inboxOn: v }, '看 @ 和回复'),
          }),
          // ⚠️ 别把 width:100% 的输入框当 flex 行的兄弟 —— 会把整块挤成竖条（2026-10-21 修）
          h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-label': '' }, '还要理谁（可选）'),
            h('input', {
              'data-bd-input': '', value: inboxUids ?? '',
              placeholder: '比如：12345678,87654321',
              onChange: (e) => setInboxUids(e.target.value),
              onBlur: () => patch({ inboxUids: String(inboxUids || '').trim() }, '还要理谁'),
            }),
            h('div', { 'data-bd-note': '' }, '逗号分隔的 UID。**留空 = 谁都理**（谁 @ 你、谁回你都告诉你）；填了 = 只理这些人。')),
          h(ToggleRow, {
            label: '同一条只提醒一次',
            note: '开着 = 每条 @ / 回复最多提一次（等于别人最多回 1 条）；关掉 = 没回就再提，直到用完下面的次数',
            on: Boolean(cfg.inboxOnceOnly),
            onChange: (v) => patch({ inboxOnceOnly: v }, '同一条只提醒一次'),
          }),
          h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-label': '' }, '没回最多提醒几次'),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 10,
              value: inboxMaxRemind ?? '2',
              onChange: (e) => setInboxMaxRemind(e.target.value),
              onBlur: () => {
                const n = Math.max(1, Math.min(10, Number(inboxMaxRemind) || 2))
                setInboxMaxRemind(String(n))
                patch({ inboxMaxRemind: n }, '提醒次数')
              },
            }),
            h('div', { 'data-bd-note': '' }, '她一直没回的话，最多再提几次就停（默认 2）。开着「同一条只提醒一次」时，这个数用不上。')),
          h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-label': '' }, '一天最多回别人几条'),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0, max: 30,
              value: inboxPerDay ?? '5',
              onChange: (e) => setInboxPerDay(e.target.value),
              onBlur: () => {
                const n = Math.max(0, Math.min(30, Number(inboxPerDay) || 0))
                setInboxPerDay(String(n))
                patch({ inboxPerDay: n }, '一天最多回别人几条')
              },
            }),
            h('div', { 'data-bd-note': '' }, '「别人」的 @ 和回复一天最多递几条给她；到了上限就不再递（明天重新算）。**你自己 @ 她不算额度**。填 0 = 别人的一律不递。')),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'inbox', onClick: onInbox },
              busy === 'inbox' ? '看…' : '现在就去看一眼'))),

        /* ── 提示词（可改） ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '提示词（可改）'),
          h('div', { 'data-bd-note': '' }, '称呼 + 两段提示词。改了「称呼」，提示词和投递提示里的名字都跟着变。'),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '称呼'),
              h('input', {
                'data-bd-input': '', value: ownerName ?? '',
                placeholder: '比如：小鱼',
                onChange: (e) => setOwnerName(e.target.value),
                onBlur: () => patch({ ownerName: String(ownerName || '').trim() }, '称呼'),
              }))),
          h('div', { 'data-bd-label': '' }, '子代理提示词（占位符 {owner}=称呼、{direction}=方向、{n}=条数）'),
          h('textarea', {
            'data-bd-input': '', rows: 8,
            value: scanPrompt ?? '',
            onChange: (e) => setScanPrompt(e.target.value),
            onBlur: () => patch({ scanPrompt: String(scanPrompt || '') }, '子代理提示词'),
          }),
          h('div', { 'data-bd-label': '' }, '投递提示（发给伙伴看的那段：告诉它拿到报告后该怎么发评论/私信）'),
          h('div', { 'data-bd-note': '' },
            '框里就是现在的文案（默认那份已经填好了，直接改就行）。可用占位符：' +
            '{owner}=称呼、{mention}=要@谁、{commentQuota}=每轮评论条数、{uid}=私信UID、' +
            '{commentBlock}/{dmBlock}/{bothBlock}/{noneBlock}=按设置自动填那几段（不该出现就留空）。'),
          h('div', { 'data-bd-row': '' },
            h('button', {
              'data-bd-btn': '',
              onClick: () => {
                const d = cfgDefaults && cfgDefaults.hintPrompt
                if (!d) return
                setHintPrompt(d)
                patch({ hintPrompt: d }, '投递提示')
              },
            }, '恢复默认'),
            h('span', { 'data-bd-note': '' }, '改坏了点这个，就回到出厂那份')),
          h('textarea', {
            'data-bd-input': '', rows: 6,
            value: hintPrompt ?? '',
            placeholder: '（这里应该已经填好默认文案；空的话点「恢复默认」）',
            onChange: (e) => setHintPrompt(e.target.value),
            onBlur: () => patch({ hintPrompt: String(hintPrompt || '') }, '投递提示'),
          }),
          h('div', { 'data-bd-label': '' }, '自动刷触发语（到点时往会话里塞给伙伴的那一句）'),
          h('div', { 'data-bd-note': '' }, '框里就是现在这句（默认已经填好）。可用占位符：{owner}=称呼。'),
          h('textarea', {
            'data-bd-input': '', rows: 3,
            value: triggerPrompt ?? '',
            onChange: (e) => setTriggerPrompt(e.target.value),
            onBlur: () => patch({ triggerPrompt: String(triggerPrompt || '') }, '自动刷触发语'),
          }),
          h('div', { 'data-bd-row': '' },
            h('button', {
              'data-bd-btn': '',
              onClick: () => {
                const d = cfgDefaults && cfgDefaults.triggerPrompt
                if (!d) return
                setTriggerPrompt(d)
                patch({ triggerPrompt: d }, '自动刷触发语')
              },
            }, '恢复默认'))),
        /* ── 一轮挑几条 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '一轮挑几条'),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '每天最多自动刷几轮'),
              h('div', { 'data-bd-note': '' }, '填 0 = 不自动刷（手动跑不占额度）')),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0, max: 50,
              value: perDay ?? '',
              onChange: (e) => setPerDay(e.target.value),
              onBlur: () => { const n = Math.max(0, Math.min(Number(perDay) || 0, 50)); setPerDay(String(n)); patch({ perDay: n }, '每天挑几条') },
            })),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '每次最多挑几条'),
              h('div', { 'data-bd-note': '' }, '派一次（手动说"帮我刷"也按这个）最多挑几条；默认 1 条最精')),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 1, max: 10,
              value: perScan ?? '',
              onChange: (e) => setPerScan(e.target.value),
              onBlur: () => { const n = Math.max(1, Math.min(Number(perScan) || 1, 10)); setPerScan(String(n)); patch({ perScan: n }, '每次挑几条') },
            })),
          st.lastRunAt ? h('div', { 'data-bd-note': '' }, `上次跑：${new Date(st.lastRunAt).toLocaleString('zh-CN')}`) : null),

        /* ── 挑什么样的（硬门槛） ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '挑什么样的'),
          h('div', { 'data-bd-note': '' }, '这两道是硬门槛：不达标的视频，子代理根本看不到 —— 在搜索那一步就滤掉了，不是靠它自觉。留 0 = 不过滤。'),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '最低播放量'),
              h('div', { 'data-bd-note': '' }, '比如填 10000：播放没过万的直接不返回给子代理')),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0, step: 1000,
              value: minViews ?? '',
              onChange: (e) => setMinViews(e.target.value),
              onBlur: () => { const n = Math.max(0, Math.min(Number(minViews) || 0, 100000000)); setMinViews(String(n)); patch({ minViews: n }, '最低播放量') },
            })),
          h('div', { 'data-bd-row': '' },
            h('div', { 'data-bd-grow': '' },
              h('div', { 'data-bd-label': '' }, '至少发布几天'),
              h('div', { 'data-bd-note': '' }, '比如填 2：两天内刚发的先不推（刚上传、还没被验证的不急着当宝）')),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0, max: 365,
              value: minAgeDays ?? '',
              onChange: (e) => setMinAgeDays(e.target.value),
              onBlur: () => { const n = Math.max(0, Math.min(Number(minAgeDays) || 0, 365)); setMinAgeDays(String(n)); patch({ minAgeDays: n }, '至少发布几天') },
            }))),

        /* ── 发言与转写 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '它会不会替你说话'),
          h(ToggleRow, {
            label: '自动评论并 @ 你',
            note: '默认关；开了之后它会在挑中的视频下面留评论，并 @ 你填的那个人',
            on: sw('autoComment'),
            onChange: (v) => patch({ autoComment: v }, '自动评论'),
          }),
          sw('autoComment') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-label': '' }, '要 @ 谁（B站 昵称）'),
            h('input', {
              'data-bd-input': '', value: mention ?? '',
              placeholder: '填你要 @ 的那个人的 B站 昵称；留空 = 只写报告、不发评论',
              onChange: (e) => setMention(e.target.value),
              onBlur: () => { const v = String(mention || '').trim(); setMention(v); patch({ mentionName: v }, '要 @ 谁') },
            }),
            h('div', { 'data-bd-note': '' }, '留空的话它就不发评论了 —— 因为评论存在的意义就是 @ 那一下')) : null,
          h('div', { 'data-bd-label': '' }, '投递方式（评论 还是 私信）'),
          h('select', {
            'data-bd-input': '', value: dmMode ?? 'off',
            onChange: (e) => { setDmMode(e.target.value); patch({ dmMode: e.target.value }, '投递方式') },
          },
            h('option', { value: 'off' }, '只发评论 —— 在视频下面 @ 你（默认）'),
            h('option', { value: 'only' }, '只私信 —— 一条公开评论都不发，最不打扰别人'),
            h('option', { value: 'both' }, '评论 + 私信 —— 两边都发')),
          (dmMode && dmMode !== 'off') ? h('div', { 'data-bd-sub': '' },
            h('div', { 'data-bd-label': '' }, '私信发给谁（B站 UID，数字）'),
            h('input', {
              'data-bd-input': '', 'data-bd-num': '', type: 'number', min: 0, value: dmUid ?? '',
              placeholder: '对方的数字 UID；比如你自己的另一个号',
              onChange: (e) => setDmUid(e.target.value),
              onBlur: () => { const n = Math.max(0, Number(dmUid) || 0); setDmUid(n ? String(n) : ''); patch({ dmUid: n }, '私信收件人') },
            }),
            h('div', { 'data-bd-note': '' }, '私信内容 = 本轮每条的「标题 + 链接 + 一句话」，一轮合并成一条发（不受 150 字限制）'),
            h('div', { 'data-bd-note': '' }, '⚠️ 建议先让这个号和收件人互关：B站 对「陌生人私信」会限流，还可能不弹提醒')) : null),

        /* ── 日报写多细 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '日报写多细'),
          h('select', {
            'data-bd-input': '', value: rl ?? 'full',
            onChange: (e) => { setRl(e.target.value); patch({ reportLevel: e.target.value }, '日报形态') },
          },
            h('option', { value: 'full' }, '完整 —— 每条：标题 / UP / 为什么值得（默认）'),
            h('option', { value: 'brief' }, '薄 —— 每条一两行，只留值不值得 + 链接'),
            h('option', { value: 'off' }, '不写 —— 只发评论，不生成日报文件'))),

        /* ── 环境与账号 ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '环境与账号'),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'install', onClick: onInstall },
              st.venvReady ? '重装主依赖' : '装主依赖（建 venv）'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'check', onClick: onCheck }, '测一下'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'login', onClick: onLoginStart }, '扫码登录'),
            h('div', { 'data-bd-note': '' },
              !st.venvReady ? (st.installFailed ? '上次没装成 → 看下面日志' : '还没装 → 先点「装主依赖」')
                : (st.loggedIn ? '装好了 → 下一步「扫码登录」' : '环境好了 → 点「扫码登录」'))),
          loginState ? h('div', { 'data-bd-msg': '', 'data-good': loginTone === 'good' ? '' : undefined, 'data-warn': loginTone === 'warn' ? '' : undefined }, loginState) : null,
          st.installTail ? h('div', null,
            h('div', { 'data-bd-note': '' }, st.installing ? '正在装主依赖（进度）：' : '主依赖的日志（B站 搜索 / 字幕 / 评论 用得到，末尾）：'),
            h('pre', { 'data-bd-pre': '' }, st.installTail)) : null,
          login?.qr ? h('div', { 'data-bd-qr': '' },
            h('img', { src: login.qr, alt: 'B站登录二维码' }),
            h('div', { 'data-bd-note': '' },
              '手机 B站 → 我的 → 扫一扫。',
              h('br'),
              '确认时选「记住我 / 长期」那张 —— 选 24 小时的话，明天就得重扫。')) : null),

        /* ── 它是怎么干活的（给他看的） ── */
        h('div', { 'data-bd-sec': '' },
          h('div', { 'data-bd-h': '' }, '它的地盘'),
          h('div', { 'data-bd-kv': '' },
            `家目录：${st.home}`,
            h('br'),
            `今天的报告：${st.report}`),
          h('div', { 'data-bd-row': '' },
            h('button', { 'data-bd-btn': '', disabled: busy === 'report', onClick: onShowReport },
              report !== null ? '收起报告' : '看今天的报告'),
            h('button', { 'data-bd-btn': '', onClick: () => onOpenFolder('out') }, '打开报告文件夹'),
            h('button', { 'data-bd-btn': '', onClick: () => onOpenFolder('home') }, '打开家目录'),
            h('button', { 'data-bd-btn': '', disabled: busy === 'verify', onClick: onVerify },
              '复核评论'),
            h('button', { 'data-bd-btn': '', onClick: () => copyText(st.report) }, '复制报告路径')),
          report !== null ? h('pre', { 'data-bd-pre': '' }, report) : null),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-bili-scroll')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-bili-scroll: 设置页样式')

        // ⭐ 进「设置」：label 就是左侧导航里那一项（抄 dsh-meme 的写法）
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'bili-scroll', order: 30, label: '刷B站' },
          () => h(Panel),
        ))
      },
    }
  },
})
