# MCP 扩展 · 给 AI Agent 的安装指令

> 把下面整段复制给你的 AI 助手，它就能帮你装好。

## 任务
请帮我在 AstrBot 上安装「日程/记忆/提醒」MCP 扩展（xiaojing）。

## 输入
- MCP 文件：本目录的 `mcp_xiaojing.py`、`mcp_core.py`
- AstrBot 目录：`<ASTRBOT_DIR>`（含 `data\mcp_server.json`）
- 数据目录：`<DATA_BASE>`（含 `data\event_memory.json`，没有就创建，内容写 `[]`）
- AstrBot 的 python：`<ASTRBOT_PYTHON>`

## 步骤
1. 把 `mcp_xiaojing.py`、`mcp_core.py` 复制到 `<ASTRBOT_DIR>\`
2. 编辑 `<ASTRBOT_DIR>\data\mcp_server.json`，在 `mcpServers` 里加：
   ```json
   "xiaojing": {
     "command": "<ASTRBOT_PYTHON>",
     "args": ["<ASTRBOT_DIR>\\mcp_xiaojing.py"],
     "env": { "XIAOJING_BASE": "<DATA_BASE>" }
   }
   ```
   （注意 JSON 里 Windows 路径反斜杠要写成 `\\`）
3. 重启 AstrBot（正常关闭再打开，不要用 Ctrl+R）
4. 看 AstrBot 启动日志，确认出现：`Connected to MCP server xiaojing, Tools: [...]`
5. 让 BOT 测试：「记一下明天下午三点开会」，观察是否回复「记好啦」

## 验收
- 日志有 `Connected to MCP server xiaojing` 且工具列表 9 个
- 让 BOT 记一件事后，`<DATA_BASE>\data\event_memory.json` 里出现新条目

## 注意事项
- 不要用 filesystem 手写日程文件，只走 MCP 工具
- 数据目录和主人 QQ 号用环境变量 `XIAOJING_BASE`、`XIAOJING_OWNER_QQ` 配置，不要改代码
- 如果 AstrBot 日志出现 MCP 连接失败，检查 python 路径和 mcp 库是否可用
