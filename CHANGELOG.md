# 更新记录

> 每次发版都往这里加一段——`qiyu install` 会把当前版本的这段写进
> `~/.dsh/qiyu/version.json`，设置里「栖语 → 版本」页签会显示它。

## 0.15.8（2026-10-23）

干净机器实测（34 项问题）后修的一批：

- `qiyu qr` 崩溃（`绿 is not defined`）——补上颜色函数
- `qq_voice` 报 `合成语音 is not defined`——把 `合成语音` 移到模块作用域
- `语音转写.py` 不再写死作者路径：用 `QIYU_STT_ROOT` 或脚本所在目录
- 默认身份表清空（不再默认「爸爸/妈妈」）；设了 `主人` 就按「备注 = 称呼」自动生成一条
- `qq_voice` 工具说明不再硬编码「爸爸/妈妈」，改成「身份表里的称呼」
- `install` 遇到缺 `node_modules` 自动建，不再拒绝干净 profile
- Docker Desktop 自定义安装路径：`QIYU_DOCKER_DESKTOP` / `napcat.dockerDesktop` / 从 `where docker` 反推（qiyu 和桥两处）
- `run.mjs` 区分「命令真的不存在」和「沙箱读不到」：真没装 Docker 不再被降级成「沙箱限制」
- `doctor` 新增身份检查：身份表为空、或好友备注一个都认不出 → warn（并告诉你怎么改备注）
- 设置面板介绍去掉「刷 B 站」；README 写明刷 B 站不在本栈
- `install` 新增安装清单 `~/.dsh/qiyu/install-manifest.json`：本地改过的模块默认保留，要 `--force` 才覆盖
- 桥在「Docker 引擎在、NapCat 容器被杀过」时会自己 `docker start` 容器（Docker Desktop 退出常见的 exit 137）
- `install` 会往桥配置里写 `容器`，桥才知道该拉哪个容器
- `AGENTS.md` 补干净机器两个必踩点：`npm.cmd` / `npx.cmd`、先设 `npm_config_cache`

## 0.15.7（2026-10-23）

- 设置面板新增「版本」页签：栈版本、安装时间、各运行时版本，以及**这次更新做了什么**
- 新增 `qiyu handover`：在部署文件夹生成 `交接.md`（位置 / QQ / 桥的目标会话 / 升级命令 / 回退方法 / 给新会话的开场白）
- `doctor` 新增验收：桥没选「目标会话」→ **fail**；目标会话没开着 / 总开关关着 / 试运行开着 → warn
- `install` 的交接语补上「第六步」：新建会话（工作目录选绝对路径）、选目标会话、打开总开关
- `install` 不再说「设置里已经填好了，不用改」——地址和令牌填好，但目标会话/总开关要人来选
- 文档：`AGENTS.md` / `README` 补第六步和交接文档说明

## 0.15.6（2026-10-23）

- `doctor` 自动探测 DSH 端口：不再被 `qiyu.config.json` 里的旧端口骗（DSH 每次启动端口可能变）
- 新增 `src/dsh-port.mjs`：先试配置端口，再扫本机监听端口，按特征认（`/dsh-qq-bridge/state` 或根路径 401 的提示语）

## 0.15.5（2026-10-23）

- `doctor` 也接上沙箱降级：Docker / 容器 / 端口相关的 fail 在受限沙箱里降成 warn，不再让 agent 误以为装失败
- `qr.mjs` 的 `docker cp` 改走 `跑()`：沙箱里不再假失败「拿不到二维码」

## 0.15.4（2026-10-23）

- 新增 `src/run.mjs`：管道被拒（EPERM）时改成「重定向到临时文件再读」，受限沙箱里也能跑外部命令
- `preflight` 沙箱降级：读不到命令输出的结论标成「沙箱限制，这条不可信」
- `AGENTS.md` 进 npm 包（从这版起 80 个文件）

## 0.15.3（2026-10-23）

- 仓库根加 `AGENTS.md`：给部署助手看的说明书（五条命令、必须先问的、沙箱、交还给人做的事）
- `preflight --json` / `doctor --json`：给 agent 机器判断用
- `install` 交接语改写：重启后回原会话，或开新会话跑 `doctor --json`

## 0.15.1（2026-10-23）

- 首个发布版：`npx dsh-qiyu-stack` 可跑，含 preflight / deploy / install / doctor / qr
