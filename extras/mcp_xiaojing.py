"""小鲸 MCP Server（stdio，薄包装）—— 所有逻辑在 mcp_core.py
启动：由 AstrBot 的 mcp_server.json 拉起（python mcp_xiaojing.py）
"""
import asyncio

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

import mcp_core as core

server = Server("xiaojing")


def _tool(name, desc, props, required):
    return Tool(name=name, description=desc, inputSchema={"type": "object", "properties": props, "required": required})


TOOLS = [
    _tool("schedule_add", "记录日程（自动查重+时间区间冲突检测）。sched_date 传 today/tomorrow/dayafter 或 YYYY-MM-DD，不要自己换算。",
          {"sched_date": {"type": "string", "description": "日期"}, "sched_time": {"type": "string", "description": "时间 HH:MM"},
           "event_name": {"type": "string", "description": "事件简述"}, "lead": {"type": "integer", "description": "提前分钟数，默认20"}},
          ["sched_date", "sched_time", "event_name"]),
    _tool("schedule_remove", "删除某天日程（按关键词）",
          {"sched_date": {"type": "string", "description": "日期"}, "keyword": {"type": "string", "description": "关键词"}},
          ["sched_date", "keyword"]),
    _tool("schedule_list", "查某天日程（today/tomorrow 或 YYYY-MM-DD）",
          {"sched_date": {"type": "string", "description": "日期"}}, ["sched_date"]),
    _tool("schedule_find", "按关键词搜索所有日程",
          {"keyword": {"type": "string", "description": "关键词"}}, ["keyword"]),
    _tool("memory_index", "读本地记忆库分类索引", {}, []),
    _tool("memory_search", "在聊天归档里按关键词搜索",
          {"keyword": {"type": "string", "description": "关键词"}, "category": {"type": "string", "description": "可选类别"}},
          ["keyword"]),
    _tool("memory_read_day", "读某天完整聊天归档（YYYY-MM-DD）",
          {"day": {"type": "string", "description": "YYYY-MM-DD"}}, ["day"]),
    _tool("reminder_state", "查提醒状态（今天日程 + 已触发提醒）", {}, []),
    _tool("sync_now", "立即同步记忆库", {}, []),
]


@server.list_tools()
async def list_tools():
    return TOOLS


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    a = arguments or {}
    try:
        if name == "schedule_add":
            text = core.schedule_add(a["sched_date"], a["sched_time"], a["event_name"], int(a.get("lead", 20)))
        elif name == "schedule_remove":
            text = core.schedule_remove(a["sched_date"], a["keyword"])
        elif name == "schedule_list":
            text = core.schedule_list(a["sched_date"])
        elif name == "schedule_find":
            text = core.schedule_find(a["keyword"])
        elif name == "memory_index":
            text = core.memory_index()
        elif name == "memory_search":
            text = core.memory_search(a["keyword"], a.get("category", ""))
        elif name == "memory_read_day":
            text = core.memory_read_day(a["day"])
        elif name == "reminder_state":
            text = core.reminder_state()
        elif name == "sync_now":
            text = core.sync_now()
        else:
            text = f"未知工具: {name}"
        return [TextContent(type="text", text=text)]
    except Exception as e:
        return [TextContent(type="text", text=f"工具执行失败: {e}")]


async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
