# dsh-qqbot

> QQBOT 管理插件（DSH 桌面端）——把 AstrBot + NapCat 的安装、登录、启停、人设编辑、备份、排障全部收进 DSH 设置页的一个「QQBOT」栏。

## 功能

- **服务状态面板**：QQ/NapCat/AstrBot/桥/提醒/记忆同步/看门狗 一屏可见
- **一键启动/停止**：插件管理所有后台组件（NapCat/QQ 保留）
- **登录二维码**：QQ 掉线时从 NapCat WebUI 取二维码，扫完自动拉起后台
- **人设编辑**：设置页里直接改 AstrBot persona，保存后自动重启生效
- **路径配置 + 自动探测**：换机器/换目录只改配置；留空自动探测常见安装位置
- **自动备份**：日程库/记忆索引/记忆归档/AstrBot 配置，一键备份
- **日志查看**：组件最近日志直接看
- **内置 FAQ**：24 条排障清单（设置页里可查）
- **安全**：所有服务端口强制 `127.0.0.1`（仅本机），不外泄

## 安装（手工铺装）

```powershell
# 1. 把插件目录放到本地插件目录
#    <DSH_HOME>\local-plugins\dsh-qqbot

# 2. 在 profile 的 package.json 里登记（dependencies 与 dsh.profile.bundles 两处）
#    "dsh-qqbot": "link:C:\\Users\\<你>\\.dsh\\local-plugins\\dsh-qqbot"
#    bundles 数组里加 "dsh-qqbot"

# 3. 在 profile 的 cordis.patch.yml 末尾加挂载行
#    - insert:
#        - id: qqbot
#          name: dsh-qqbot

# 4. 在 profile 目录装依赖
cd C:\Users\<你>\.dsh\profiles\desktop
pnpm install

# 5. 正常重启 DSH（不是 Ctrl+R 刷新）
```

> 需要 `cordis.patch.yml` 的 insert 行，否则设置页不会出现「QQBOT」栏。

## 配置

首次启动自动探测并写入 `<DSH_HOME>/qqbot/config.json`。

| 字段 | 说明 |
| --- | --- |
| `napcatDir` | NapCat 安装目录（含 `config/webui.json`） |
| `astrbotDir` | AstrBot 安装目录（含 `data/data_v4.db`） |
| `kiraraDir` | 扩展脚本目录（reminder.py 等，可空） |
| `pythonPath` | 管理脚本用 pythonw/python |
| `astrbotPython` | AstrBot 自带 python（留空用系统 python） |
| `qqNumber` | 登录 QQ 号（留空从 NapCat `autoLoginAccount` 读） |
| `personaId` | AstrBot persona id（默认 default） |
| `napcatWebPort` / `napcatWsPort` | NapCat 端口（默认 6099 / 5700） |
| `astrbotWsPort` / `astrbotWebPort` | AstrBot 端口（默认 6199 / 6185） |
| `backupDir` | 备份目录（留空 = `<astrbotDir>/backups`） |
| `components` | 组件脚本名（bridge/reminder/bubble/memorySync/memoryDigest/watchdog） |

设置页「路径配置」区可直接编辑并保存；也可以点「重新自动探测」。

## 前置依赖（必须自己装好，插件不负责安装）

> ⚠️ 插件只做「检测 + 复用 + 启动」，**不会自动下载安装**。装插件前请先装好：

- **DSH 桌面端**（插件宿主）
- **AstrBot**（聊天引擎，含 Python 3.12 环境）
- **NapCat**（QQ 协议模块，需注入 QQNT）
- **QQ 客户端**（本体）

插件启动时**自动环境自检**：缺哪个会在面板「环境自检」区标红，并明确告诉你缺什么、去哪里填。

## 安全说明

- 所有 HTTP 路由与后端服务端口只绑 `127.0.0.1`
- NapCat WebUI token 从本地配置读取，不落盘到插件配置里
- 人设保存前自动备份 AstrBot 数据库

## 排障

见 `FAQ.md`（设置页「常见问题」区也会加载它）。

## 许可

MIT

## 首次启动与权限（重要）

NapCat 的启动器（`launcher.bat`）需要管理员权限。插件启动时：

1. 先检查是否已有计划任务（你的 `NapCatBot`，或插件自己创建的 `QQBOT-NapCat`）——有就直接用，**无需 UAC**
2. 没有则**自动创建 `QQBOT-NapCat`**（最高权限）——**首次会弹一次 UAC，点「是」即可**
3. 之后启动全部走计划任务，**不再弹窗**

所以新用户第一次点「启动全部服务」会看到一次 UAC 提示，属正常流程。
拒绝 UAC 的话 NapCat 起不来（6099 连不上，登录会报 10061）。
### 「停止全部服务」也会请求一次管理员权限

停止按钮会：停后台组件 → 停 AstrBot → **清理 NapCat 和 BOT 的 QQ 进程**（这一步需要管理员，会弹一次 UAC，点「是」即可）。

**安全说明**：只杀「父进程是 NapCatWinBootMain」的 QQ.exe（BOT 专用那个），**不会碰你日常用的 QQ**（父进程是 explorer）。
### 登录时的两种特殊情况

| 提示 | 原因 | 处理 |
| --- | --- | --- |
| 需要安全验证（验证码） | 腾讯风控 | 浏览器打开 `http://127.0.0.1:6099`，在 NapCat WebUI 完成验证码登录 |
| `login rate limit` | NapCat 登录频率限制 | 等 1 分钟；插件已加凭据缓存，正常不会触发 || 登录系统连接异常，正在重新连接 | QQ 内核初始化/网络重连中 | 等 10 到 20 秒重试；持续则停止再启动服务 |
---

## 🤖 给 AI Agent 的安装指令（复制这段发给你的 AI 助手）

如果你不想自己一步步装，把下面这段**整段复制**发给你的 AI 助手（Claude/ChatGPT/Cursor 等）：

> 请帮我安装 DSH 插件 dsh-qqbot（一个 QQBOT 管理插件）：
> 1. 把插件目录放到 `<DSH_HOME>\local-plugins\dsh-qqbot`（DSH_HOME 默认 `%USERPROFILE%\.dsh`）
> 2. 编辑 `<DSH_HOME>\profiles\<profile>\package.json`：`dependencies` 里加 `"dsh-qqbot": "link:<插件绝对路径>"`，`dsh.profile.bundles` 里加 `"dsh-qqbot"`
> 3. 编辑 `<DSH_HOME>\profiles\<profile>\cordis.patch.yml`：末尾加
>    ```
>    - insert:
>        - id: qqbot
>          name: dsh-qqbot
>    ```
> 4. 在 profile 目录执行 `pnpm install`
> 5. 正常重启 DSH（关闭再打开）
> 6. 打开 DSH 设置 → QQBOT，先看「环境自检」；缺 AstrBot/NapCat/python 时点「安装提示词」，把生成的提示词复制回来给我继续装

**提示词按钮（插件内保底）**：
- 「**安装提示词**」：环境不完整时生成安装指导（AstrBot/NapCat/QQ/python 装哪、装完怎么填路径）
- 「**更新提示词**」：插件有新版本时生成更新步骤（备份、覆盖、pnpm install、重启）

两个按钮生成的文本都可以**直接复制**给 AI Agent 执行。

## 🔄 更新插件

1. 从 GitHub 拉最新代码（或下载 zip 解压覆盖）
2. 备份原插件目录（复制一份 .bak-日期）
3. 覆盖文件（配置 `~/.dsh/qqbot/config.json` 不受影响）
4. 如果 `package.json` 依赖变了：profile 目录 `pnpm install`
5. 重启 DSH
6. 打开 设置 → QQBOT 确认版本和自检
---

## 🧩 可选：MCP 扩展（日程 / 记忆 / 提醒）

如果你想让 BOT 能「记日程、查记忆、到点提醒」，需要装 `extras/` 里的 MCP 扩展（9 个工具）。

- **用户版说明**：`extras/README-用户版.md`（大白话，3 步装好）
- **AI Agent 版说明**：`extras/README-Agent版.md`（整段复制给 AI 助手，它会帮你装）

**不装**：插件管理功能 + 聊天都正常，只是 BOT 不会记事。
**装了**：BOT 能记日程、查历史、按时提醒。

MCP 文件：`extras/mcp_xiaojing.py`（薄包装）+ `extras/mcp_core.py`（核心逻辑，已做路径通用化，用环境变量 `XIAOJING_BASE` 指定数据目录）。

---

## 🧠 BOT 模型配置（AstrBot 的 provider）

BOT 用哪个大模型，**不在本插件里配**，在 AstrBot 里配。本插件只负责管理 AstrBot/NapCat 的启停和登录。

### 配在哪
- **配置文件**：`<AstrBot目录>/data/cmd_config.json`
- **AstrBot 面板**：浏览器打开 `http://127.0.0.1:6185` → 模型设置（更直观）

### 关键字段
```json
{
  "provider_sources": [
    {
      "id": "my_source",
      "type": "openai_chat_completion",
      "key": ["你的API_KEY"],
      "api_base": "https://api.deepseek.com/v1",
      "timeout": 120
    }
  ],
  "provider": [
    {
      "id": "my_model",
      "enable": true,
      "provider_source_id": "my_source",
      "model": "deepseek-chat"
    }
  ]
}
```
- `api_base` + `key`：你的模型服务（DeepSeek / OpenAI / 通义 / 本地 vLLM 都行，只要是 OpenAI 兼容接口）
- `model`：模型名
- **改完重启 AstrBot** 生效

### 常见选择
- DeepSeek：`api_base: https://api.deepseek.com/v1`，`model: deepseek-chat`
- OpenAI：`api_base: https://api.openai.com/v1`，`model: gpt-4o-mini`
- 本地（Ollama/vLLM）：`api_base: http://127.0.0.1:11434/v1`，`model: 你的模型名`
- 学校/自建网关：填对应 `api_base` 和 `key`

### 注意
- 插件不碰模型配置——换模型不会影响插件的管理功能
- 如果 BOT 回复慢，先看模型 API 是否慢（`request_max_retries` 默认 5 次重试会放大延迟）
