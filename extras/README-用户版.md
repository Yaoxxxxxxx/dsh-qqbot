# MCP 扩展 · 用户版说明

## 这是什么
这个文件夹里是「**日程/记忆/提醒**」的 MCP 工具（9 个）。装上之后，你的 QQ 机器人才能：
- 听你说「记一下明天下午三点开会」→ 真的记进日程、到点提醒
- 回答「之前聊过什么」→ 翻本地记忆
- 查「今天有什么课」→ 读日程库

**不装也能用**：插件本体（启停/登录/人设/备份）不依赖它，只是 BOT 会「只会聊天，不会记事」。

## 需要准备
1. 一个 **AstrBot**（已经在用插件的就有）
2. 数据目录（存放日程/记忆文件），比如 `D:\KiraraBot`（里面要有 `data\event_memory.json` 这个文件，没有就先建一个空的 `[]`）
3. AstrBot 的 Python 环境里有 `mcp` 库（AstrBot 自带，一般不用装）

## 安装（3 步）
1. 把本目录的 `mcp_xiaojing.py` 和 `mcp_core.py` 两个文件，**复制到 AstrBot 安装目录**（比如 `D:\AstrBot\`）
2. 打开 AstrBot 的 `data\mcp_server.json`，加上这段（路径改成你自己的）：
```json
{
  "mcpServers": {
    "xiaojing": {
      "command": "你的AstrBot-python路径\python.exe",
      "args": ["你的AstrBot目录\mcp_xiaojing.py"],
      "env": { "XIAOJING_BASE": "D:\\KiraraBot" }
    }
  }
}
```
3. 重启 AstrBot（关掉再开）

## 怎么确认装好了
打开 AstrBot 的日志，看到这行就成功：
```
Connected to MCP server xiaojing, Tools: ['schedule_add', 'schedule_remove', ...]
```
然后让 BOT 记一件小事试试（「记一下明天下午三点开会」），看它是不是回复「记好啦」。

## 配置项（环境变量）
| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `XIAOJING_BASE` | `D:\KiraraBot` | 数据目录（含 data/ 子目录） |
| `XIAOJING_OWNER_QQ` | `2742891450` | 主人的 QQ 号（提醒/识别用，改成你自己的） |

## 常见问题
- **BOT 说「记好啦」但没记上**：检查 AstrBot 日志有没有 MCP 连接成功；检查数据目录里 `data\event_memory.json` 是否有写入权限
- **BOT 完全不记**：确认 `mcp_server.json` 的路径写对了（Windows 路径里反斜杠要写成 `\\`）
- **重启后 MCP 没了**：AstrBot 每次启动会自动连，若日志没显示连接，看 python 路径是否对
