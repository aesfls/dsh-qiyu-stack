// 栖语面板 · 网页半边
//
// 在 DSH 设置的左侧栏加一项「栖语」，里面是一个页签容器：
// 别家插件把设置页注册到 qiyu.tab，就变成这里的一个页签。
//
// 关键点（都是 DSH 的插槽契约里写死的）：
//   1. renderSlot(key) 只允许渲染「自己 children 里声明过的槽位」，
//      所以这里用 children 声明 qiyu.tab，而不是去借用别家的槽位。
//   2. 页签列表通过 inject 提供的 hooks.tabs 拿到（跟内置「内置插件」页一个写法），
//      组件那边就拿到一个 useTabs(props)。
//   3. 改完这个文件不用重启 DSH，刷新页面即可 —— 客户端 bundle 的版本号按文件 mtime 算。

window.__ModuleLoader__.load({
  id: 'dsh-qiyu-panel',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']
    const h = React.createElement

    const 槽位 = 'qiyu.tab'

    const S = {
      wrap: { padding: '4px 2px 24px', fontSize: 13, lineHeight: 1.7 },
      head: { fontSize: 15, fontWeight: 600, margin: '0 0 2px' },
      intro: { opacity: 0.6, fontSize: 12, margin: '0 0 14px' },
      tabs: {
        display: 'flex',
        gap: 4,
        flexWrap: 'wrap',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10))',
        marginBottom: 14,
        // ⭐ 钉在顶部：某个页签里的配置很长时，往下滚页签条不会跟着跑掉
        position: 'sticky',
        top: 0,
        zIndex: 5,
        paddingTop: 6,
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.94))',
        backdropFilter: 'saturate(1.1) blur(6px)',
        WebkitBackdropFilter: 'saturate(1.1) blur(6px)',
      },
      tab: {
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        opacity: 0.6,
        fontSize: 12.5,
        padding: '7px 12px',
        cursor: 'pointer',
        borderBottom: '2px solid transparent',
        marginBottom: -1,
      },
      tabOn: {
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        padding: '7px 12px',
        cursor: 'pointer',
        fontWeight: 600,
        borderBottom: '2px solid var(--dsw-alias-state-business-primary, #4d6bfe)',
        marginBottom: -1,
      },
      panel: { minHeight: 60 },
      empty: { opacity: 0.6, fontSize: 12.5, padding: '18px 4px' },
      badge: {
        fontSize: 11,
        opacity: 0.55,
        marginLeft: 6,
      },
      row: {
        display: 'flex',
        gap: 12,
        padding: '6px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))',
      },
      rowKey: { opacity: 0.6, minWidth: 96, flex: '0 0 auto' },
      rowVal: { wordBreak: 'break-all' },
    }

    function 取标签(原) {
      try {
        const v = typeof 原 === 'function' ? 原() : 原
        return v == null ? '' : String(v)
      } catch (e) {
        return ''
      }
    }

    function Panel(props) {
      const renderSlot = props && props.renderSlot
      const useTabs = props && props.useTabs
      const rows = typeof useTabs === 'function' ? useTabs((v) => v) : []
      const [active, setActive] = React.useState()

      const 选中 = rows.find((r) => r.id === active) ? active : rows[0] && rows[0].id

      return h(
        'div',
        { style: S.wrap },
        h('div', { style: S.head }, '栖语'),
        h('div', { style: S.intro }, '住在这里的几件事：QQ、心情、记忆、主动搭话。'),

        rows.length === 0
          ? h('div', { style: S.empty }, '还没有插件注册页签到 qiyu.tab。')
          : h(
              React.Fragment,
              null,
              h(
                'div',
                { style: S.tabs, role: 'tablist' },
                rows.map((r) =>
                  h(
                    'button',
                    {
                      key: r.id,
                      type: 'button',
                      role: 'tab',
                      style: r.id === 选中 ? S.tabOn : S.tab,
                      'aria-selected': r.id === 选中,
                      onClick: () => setActive(r.id),
                    },
                    r.label || r.id,
                  ),
                ),
              ),
              h(
                'div',
                { style: S.panel, role: 'tabpanel' },
                typeof renderSlot === 'function' && 选中
                  ? renderSlot(槽位, {}, { only: 选中 })
                  : h('div', { style: S.empty }, '这个页签还是空的。'),
              ),
            ),
      )
    }

    function VersionTab() {
      const [数据, set数据] = React.useState(null)
      const [错, set错] = React.useState('')

      React.useEffect(() => {
        let 活 = true
        fetch('/dsh-qiyu-panel/version', { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => {
            if (活) set数据(j)
          })
          .catch((e) => {
            if (活) set错(String((e && e.message) || e))
          })
        return () => {
          活 = false
        }
      }, [])

      if (错) return h('div', { style: S.empty }, '读不到版本：' + 错)
      if (!数据) return h('div', { style: S.empty }, '正在读版本…')

      const 行 = (标签, 值) =>
        h(
          'div',
          { key: 标签, style: S.row },
          h('span', { style: S.rowKey }, 标签),
          h('span', { style: S.rowVal }, 值 || '—'),
        )

      const 模块 = 数据.模块 || {}
      const 更新 = String(数据.更新内容 || '')
        .split('\n')
        .map((s) => s.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean)

      return h(
        'div',
        { style: S.wrap },
        h('div', { style: S.head }, '当前版本'),
        h('div', { style: S.intro }, '这一套装了什么、哪一版，以及这次更新改了什么。'),
        行('栖语栈', 数据.栈),
        行('安装时间', 数据.安装时间),
        行('设置面板', 数据.面板),
        更新.length
          ? h(
              'div',
              { style: { marginTop: 14 } },
              h('div', { style: { fontWeight: 600, marginBottom: 4 } }, '这次更新做了什么'),
              更新.map((s, i) =>
                h(
                  'div',
                  { key: i, style: { display: 'flex', gap: 8, padding: '3px 0' } },
                  h('span', { style: { opacity: 0.45 } }, '•'),
                  h('span', { style: S.rowVal }, s),
                ),
              ),
            )
          : null,
        Object.keys(模块).length
          ? h(
              'div',
              { style: { marginTop: 14 } },
              h('div', { style: { fontWeight: 600, marginBottom: 4 } }, '运行时'),
              Object.keys(模块)
                .sort()
                .map((k) => 行(k, 模块[k])),
            )
          : null,
        数据.提示 ? h('div', { style: { ...S.empty, padding: '10px 0 0' } }, 数据.提示) : null,
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (!slots) return

      // 页签列表：跟内置「内置插件」页同一套写法，靠 version 判断要不要重算
      let 上次版本 = -1
      let 缓存 = []
      const 快照 = () => {
        const 版本 = slots.getVersion(槽位)
        if (版本 !== 上次版本) {
          上次版本 = 版本
          缓存 = slots.entries(槽位)
            .map((entry) => ({
              id: (entry.options && entry.options.id) || '',
              order: (entry.options && entry.options.order) || 0,
              label: 取标签(entry.options && entry.options.label),
            }))
            .sort((a, b) => a.order - b.order)
        }
        return 缓存
      }

      const 注入 = () => ({
        hooks: {
          tabs: {
            getSnapshot: 快照,
            subscribe: (listener) => slots.subscribe(槽位, listener),
          },
        },
      })

      slots.inject('settings.section', () =>
        slots.register(
          {
            name: 'settings.section',
            id: 'qiyu',
            order: 48,
            label: () => '栖语',
            inject: 注入,
            // ⭐ 自己声明页签槽位 —— renderSlot 只认这个
            children: { [槽位]: { kind: 'list', scope: 'root' } },
          },
          Panel,
        ),
      )

      // ⭐ 版本页签：面板自己注册进自己的 qiyu.tab，永远排在最后
      slots.inject('qiyu.tab', () =>
        slots.register(
          { name: 'qiyu.tab', id: 'version', order: 99, label: () => '版本' },
          VersionTab,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
