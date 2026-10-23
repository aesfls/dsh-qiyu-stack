# 部署：把 QQ 这条路一次修对

这份文档只讲一件事：**怎么让一个智能体稳定地收发 QQ 消息**。
读完能省掉我们今天踩过的三个坑。

---

## 结论先说

**用 Docker 里的 Linux QQ + NapCat，不要用 Windows 版 NapCat。**

Windows 上装 NapCat（OneKey / Shell / 注入 / LiteLoader）全部会失败，原因见下一节。
Linux QQ 没有那个限制。

---

## 一、为什么 Windows 版一定失败

**QQ 新版启动时会校验 `package.json`。**

实测（Windows QQ 9.9.36）：只往 `resources\app\package.json` 末尾加一个换行（4 字节，内容语义完全不变），QQ 一启动就弹：

```
退出
文件已损坏, 请重新安装QQ。
```

还原原版，QQ 又能正常启动。

而 NapCat 在 Windows 上的所有形态，本质都是「让 QQ 的入口指向 NapCat」：

| 形态 | 做法 | 结果 |
|---|---|---|
| Shell（OneKey / 手动） | 改 `package.json` 的 `main` | QQ 报「文件已损坏」，崩在 `QQNT.dll`（`0x80000003`） |
| Shell（注入） | 运行时改内存 | 盘上文件没动也秒退（校验发生在加载后） |
| Framework（LiteLoader） | 同样要改入口 | 按机制推断同样被拦 |

> NapCat 补丁包里写的 `9.9.22-40990` 不是随便写的 —— 那是这道校验还没出现的 QQ 版本。

**Linux QQ 没有这道校验。**

---

## 一·五、前提：Docker（没装就卡在这）

NapCat 必须跑在 **Docker 里的 Linux QQ** 上。这不是偏好，是唯一可行的路——Windows 版那条被上面的校验堵死了。

**没装 Docker 的话：**

1. 下载 <https://www.docker.com/products/docker-desktop/>
2. 安装时勾上 **WSL2** 组件（Windows 需要 WSL2；没有就管理员开 PowerShell 跑 `wsl --install`）
3. 装完**重启这台电脑**（不是重启 DSH、也不是重启 Docker）
4. 打开 Docker Desktop，等左下角显示引擎已启动
5. 回来跑 `qiyu deploy`

命令行装法：`winget install -e --id Docker.DockerDesktop`

**占用**：Docker 本体 + 镜像大概 3–5 GB，之后数据慢慢长。
这些默认都在 **C 盘的 Docker 磁盘镜像**里（`Settings → Resources → Disk image location` 可以挪）。
`qiyu deploy --dir` 管的是宿主机上的配置/登录态/插件，**管不到 Docker 那份**——两处都要留意。

> `qiyu deploy` 会先分辨「没装」和「装了没开」，两种情况的提示不一样。

---

## 二、起一个容器（三分钟）

### 最省事：一条命令

```bash
npx dsh-qiyu-stack deploy --qq 你的QQ号
```

它会依次做：查 Docker → 查 3000/3001/6099 有没有被占 → 建 `./napcat/{config,qq,plugins}`
→ 写 OneBot + WebUI 配置（令牌随机生成）→ 拉镜像 → 跑容器 → 等 WebUI → **直接把二维码弹到你屏幕上**。
跑完令牌和容器名会写进 `qiyu.config.json`，接着 `qiyu doctor` 就能用了。

加 `--dry-run` 只打印它准备执行的 docker 命令，什么都不动。

### 手动版（想自己控制参数时）

```powershell
docker pull mlikiowa/napcat-docker:latest

docker run -d --name napcat-qq --restart unless-stopped `
  -p 127.0.0.1:3000:3000 -p 127.0.0.1:3001:3001 -p 127.0.0.1:6099:6099 `
  -e MODE=ws -e ACCOUNT=<你的QQ号> -e WEBUI_TOKEN=<自己定一个> -e TZ=Asia/Shanghai `
  -v "D:\qiyu\napcat\config:/app/napcat/config" `
  -v "D:\qiyu\napcat\qq:/app/.config/QQ" `
  -v "D:\qiyu\napcat\plugins:/app/napcat/plugins" `
  mlikiowa/napcat-docker:latest
```

**三个挂载点必须挂**，否则重启就丢：

| 容器里 | 放什么 |
|---|---|
| `/app/napcat/config` | OneBot 配置（`onebot11_<QQ号>.json`）、WebUI 配置 |
| `/app/.config/QQ` | QQ 登录态、消息数据库 |
| `/app/napcat/plugins` | 插件（不用可空）

### OneBot 配置

写进 `napcat/config/onebot11_<QQ号>.json`（或模板 `onebot11.json`）：

```json
{
  "network": {
    "httpServers": [
      { "name": "http-default", "enable": true, "host": "0.0.0.0", "port": 3000,
        "enableCors": true, "messagePostFormat": "array", "token": "你的HTTP令牌" }
    ],
    "websocketServers": [
      { "name": "ws-default", "enable": true, "host": "0.0.0.0", "port": 3001,
        "messagePostFormat": "array", "token": "你的WS令牌", "heartInterval": 30000 }
    ],
    "httpClients": [], "websocketClients": [], "httpSseServers": [], "plugins": []
  },
  "musicSignUrl": "",
  "enableLocalFile2Url": false,
  "parseMultMsg": false
}
```

> 同时提供 **HTTP 服务端**（谁来调都行）和 **正向 WS 服务端**（事件流），
> 上层框架按 OneBot 11 接就行，接口跟 SnowLuma 那种实现是通用的。

---

## 三、登录：二维码，以及一个必须勾的框

1. 跑 `qiyu qr` —— 二维码会**直接在你屏幕上打开**（同时终端里会说它几秒前生成的、大概什么时候失效）
   - 已经登录了它会直接告诉你「不用扫」，不会拿一张过期的码糊弄你
   - 也可以手动开 `http://127.0.0.1:6099/webui?token=<你定的 WEBUI_TOKEN>`，页面里是实时码
2. 用**目标账号**的手机 QQ 扫
3. ⚠️ **手机上确认时，勾「下次登录无需确认」**

第 3 步是关键。不勾的话每次容器重启都会要求「手Q验证」，等于每次都要人工点一下；
勾了之后 `docker restart` 能自动快速登录，免扫码：

```
09:24:11  正在快速登录 <你的QQ号>
09:24:42  ✅ 已上线（coreReady=true）
```

**别用 `docker rm -f` 再 `docker run`** —— 换容器等于换设备，登录态失效，要重扫。
要重启**容器**用 `docker restart <容器名>`（不用重启电脑）。

---

## 四、要它自己起来，但别让用户看见

2026-10-23 改过一次：**不再开机自启，改成「用的时候才起来，起来也不弹窗」**。

### 为什么不要开机自启

用户根本不知道 Docker 是什么。开机时冒出一个窗口、任务栏多一个图标，只会让人困惑。
而且开机自启会把 Docker 常驻在后台，白占内存。

### 现在的做法

| 时机 | 谁来做 |
|---|---|
| 打开 DSH / qiyu | **QQ 桥在启动 5 秒后检查**：引擎不在就静默拉起（无窗口、无任务栏按钮），容器靠 `--restart unless-stopped` 自己回来 |
| `qiyu deploy` | 同样先查再拉，已经在跑就立刻跳过 |
| 电脑开机 | **什么都不做**（启动文件夹里的 `启动-NapCat.vbs` 已停用，Docker 的 `AutoStart` 也关着） |

### 关键的一条（这是弹窗的真正原因）

> **`Docker Desktop.exe` 在引擎已经在跑的时候再执行一次，会 `signaling show-dashboard`**
> —— 也就是用户看到一个莫名其妙弹出来的窗口。实测日志：`backend already running, signaling show-dashboard`。

所以代码里**必须先查引擎，再决定要不要碰那个 exe**。这一步已经写进：
- `runtime/bridge/lib/host.js` 的 `后台服务在线()` / `拉起后台服务()`
- `src/docker.mjs` 的 `确保引擎()`

### 剩下的唯一痕迹

Docker Desktop 启动后会在**右下角托盘**留一个小鲸鱼图标。这是它的固有行为，**没有关闭选项**。
但它不占任务栏、不弹窗口——用户平时看不见它。

想让启动更安静，设置里这两项要这样：

```json
// %APPDATA%\Docker\settings-store.json
"AutoStart": false,              // 不开机自启
"OpenUIOnStartupDisabled": true  // 启动时不弹面板
```

`qiyu` 每次拉起引擎前会顺手把 `OpenUIOnStartupDisabled` 写一遍（写不进也不影响启动）。

> 容器起来的那 20~30 秒里，QQ 是收不到消息的；桥会在引擎好后自动重连，不用手动做任何事。

---

## 五、端口和冲突

| 端口 | 用途 |
|---|---|
| 3000 | OneBot HTTP |
| 3001 | OneBot 正向 WS |
| 6099 | NapCat WebUI |

**同一个号只能在一个地方登录**。如果机器上还有别的 QQ 机器人（比如 SnowLuma），先停掉，
否则两边抢 3000/3001，或者互相把对方挤下线。

---

## 六、自查

```powershell
qiyu doctor
```

会逐项检查：Docker、容器、三个端口、OneBot 身份、事件流、DSH 桥，
每项失败都带一句「怎么修」。
