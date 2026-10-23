# 把插件设置合并成一个页面 + 页签

装了几个插件之后，DSH 设置左侧栏会变成这样：

```
账号与余额
通用设置
模型
内置插件
Agent 预设
刷 B 站        ← 每个插件各占一项
鱼的心情
鱼的记忆
主动搭话
通到 QQ
```

想要的是：**只有「内置插件」一项，点进去是页签**：

```
内置插件
 ├─ 全部
 ├─ 刷 B 站
 ├─ 鱼的心情
 ├─ 鱼的记忆
 ├─ 主动搭话
 └─ 通到 QQ
```

## 结论：DSH 本来就有这个槽位，不用自己造

在 DSH 的插件契约里（`dsh-cordis-client-runner`，slot 定义 `settings.plugins.tab`）：

> One page inside the Plugins settings section.
> The section owner renders localized entry labels as tabs
> and mounts each contribution inside its corresponding tab panel.
> Options: `id`（页签 key）、`order`（顺序）、`label`（显示名）。

所以插件只要把注册目标从 `settings.section` 换成 `settings.plugins.tab`，
就会从左侧栏消失、变成插件页里的一个页签。**不改组件、不改样式、不写新面板。**

## 改法

一个插件只需要动两处字符串（都在它自己的 `client.js` 里）：

```js
// 改前
slots.inject('settings.section', () =>
  slots.register(
    { name: 'settings.section', id: 'qq-bridge', order: 54, label: () => '通到 QQ' },
    Section,
  ),
)

// 改后
slots.inject('settings.plugins.tab', () =>
  slots.register(
    { name: 'settings.plugins.tab', id: 'qq-bridge', order: 54, label: () => '通到 QQ' },
    Section,
  ),
)
```

`order` 决定页签顺序（小的在前）。

## 用脚本批量做

栖语栈里带了一个脚本：

```bash
# 先看看有哪些插件会被改
node tools/merge-settings-tabs.mjs --dry-run

# 真改（每个文件自动备份成 client.js.bak-tab-<时间戳>）
node tools/merge-settings-tabs.mjs

# 想还原
node tools/merge-settings-tabs.mjs --restore
```

默认目录是 `~/.dsh/profiles/desktop/node_modules`，换 profile 用 `--dir`。

## 生效方式

**刷新页面就行（Ctrl+R）**，不用重启 DSH。

原因：DSH 给客户端 bundle 的 URL 带了 `rev`，而 `rev` 是按**文件 mtime** 算的
（见 `dsh-client-modules` 的 `String(baseline.mtimeMs)`），所以文件一改、版本号就变，
页面刷新会拉到新包。

如果刷新没变化，再试 `Ctrl+Shift+R` 硬刷新；仍然不行才需要重启 DSH。

## 踩过的坑

1. **注释里也有 `settings.section`** —— 批量替换会把注释一起换掉，无害，但看到别奇怪。
2. **跨行写法** —— 有的插件是
   ```js
   {
     name: 'settings.section',
     id: 'memory',
     ...
   }
   ```
   所以别按「整行」去替换，要替换**引号里的字面量**。脚本就是这么做的。
3. **改完先 `node --check`** —— 这些 client.js 是打包好的字符串，替换坏了会整个设置页白屏。
4. **每个插件都要备份** —— 出问题能一条命令还原（脚本的 `--restore`）。

## 适用边界

- 这些插件得是**独立的 client bundle**（有自己的 `client.js`）。宿主内置的 section
  （账号、通用、模型）不该动。
- 如果你是插件作者，新插件**一开始就注册到 `settings.plugins.tab`**，别占左侧栏。
- 想做「一个『栖语』页 + 自己的页签容器」也可以，但要新写一个 section 插件当容器，
  再把各组件的注册目标指过去 —— 工作量大得多，收益只是名字和位置更整齐。
