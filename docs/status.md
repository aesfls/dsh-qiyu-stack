# 现状与下一步（2026-10-23 收工时的快照）

> 这份是给「下次打开这个项目的人 / 我」看的。想知道怎么用，看 [README](../README.md)。

## 一句话状态

**能用了，也发出去了，但还没被陌生人验证过。**

- npm：`dsh-qiyu-stack@0.15.1`（`latest`），`npx dsh-qiyu-stack help` 实测可跑
- GitHub：<https://github.com/aesfls/dsh-qiyu-stack>（公开，main）
- 千语（爸爸本人的实例）：正常运行中，桥、NapCat、Docker 都通

## 今天做了什么

1. **NapCat 迁移落地**：Windows 版 NapCat 被 QQ 的文件校验堵死，改走 Docker + Linux QQ，跑通
   收发、群消息、语音、事件流。部署过程写进 [deployment.md](deployment.md)。
2. **抽运行时四块**：bridge / memory / mood / rhythm 从「真在跑的机器」搬进 `runtime/`，
   清掉私人路径、角色名、QQ 号、令牌。语音拆成 `bridge/lib/voice.mjs`。
3. **三条命令做出来**：`preflight`（环境体检 + `--fix`）、`deploy`（起 NapCat）、
   `install`（装进 DSH，按内容判断替换、保留用户文件）。
4. **发布**：GitHub 公开仓库 + npm 包。
5. **修了一串真问题**（都记在对应文件里）：
   - `Docker Desktop.exe` 在引擎已跑时执行会弹面板 → 改成「先查、再决定碰不碰」
   - 心情插件把同一句话反复记 → 加消息签名去重
   - `install` 只增不删导致新旧文件混着 → 改成按内容比对、整份替换
   - `package.json` 带 BOM 导致 npm 发布被"自动纠正" → 全部重写成无 BOM

## 已知没做（按重要性）

| # | 事项 | 为什么重要 |
|---|---|---|
| 1 | **陌生人在干净机器上完整装一遍** | 唯一没被验证的一环。README 的流程可能还有坑 |
| 2 | 心情「她回话」那一步 | 隔离测试时测试 profile 没配模型，消息进会话但没跑起来 |
| 3 | `memory`/`mood`/`rhythm` 其余配置项接进角色包 | 现在只接了名字、称呼、作息时段 |
| 4 | npm 上的 `0.0.0-stage` 占位版本 | 无害，但看着脏；要清得用有权限的 classic token |
| 5 | GitHub 与本地历史分叉 | 网络拦了 git 协议（SSL），最后用 API 改文件；下次要 `git pull --rebase` |

## 下一轮建议从哪开始

```bash
# 1) 先自己按 README 从零走一遍（最像陌生人的做法）
cd /tmp && npx dsh-qiyu-stack preflight
npx dsh-qiyu-stack init
npx dsh-qiyu-stack deploy --qq <另一个号>
npx dsh-qiyu-stack install --character <名字> --yes
npx dsh-qiyu-stack doctor

# 2) 哪一步卡住，就把那一步的报错抄进 docs/deployment.md 的"常见坑"
```

## 两套东西的边界（很容易搞混）

| | 千语（爸爸的） | 栖语（给别人的） |
|---|---|---|
| 代码 | `~/.dsh/profiles/desktop/node_modules/<插件>` | `W:\AI\project\dsh-qiyu-stack\runtime\` |
| 配置 | `~/.dsh/*.json`、`qiyu.config.json` | 模板里全空 |
| 同步规则 | **代码要一致**（`qiyu doctor` 7.6 项会查）；**配置永不同步** | |

## 备份在哪

- 插件改动前的原文件：`W:\AI\yunqianyu\备份\插件改动备份-20261023.zip`（含清单 csv）
- 迁移说明与回退步骤：`W:\AI\project\云千语-NapCat迁移交接.md`
