"""小鲸 MCP 核心包（共享逻辑）
MCP server（mcp_xiaojing.py）和 AstrBot 插件（消息强制路由）都调用本模块，保证行为一致。

工具包：
- 日程：schedule_add / schedule_remove / schedule_list / schedule_find
- 记忆：memory_index / memory_search / memory_read_day
- 提醒：reminder_state
- 同步：sync_now
- 消息路由：route_message(text) → (handled, reply)
"""
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import os

# 基础目录（环境变量 XIAOJING_BASE 指定，默认 D:\KiraraBot）
XJ_BASE = Path(os.environ.get("XIAOJING_BASE", r"D:\KiraraBot"))
EVENT_FILE = XJ_BASE / "data" / "event_memory.json"
REMINDED_FILE = XJ_BASE / "data" / "reminded.json"
MEM_DIR = XJ_BASE / "data" / "memory"
ARCHIVE = MEM_DIR / "archive"
INDEX = MEM_DIR / "index.md"
OWNER_QQ = os.environ.get("XIAOJING_OWNER_QQ", "2742891450")
CST = timezone(timedelta(hours=8))

CN_NUM = {"一": 1, "两": 2, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
          "十一": 11, "十二": 12, "零": 0}

CATEGORIES = {
    "课程": ["课", "上课", "老师", "教室", "作业", "考试", "高数", "化学", "制图", "体育", "学业", "复习"],
    "作息": ["睡", "起床", "醒", "熬夜", "困"],
    "饮食": ["吃", "饭", "外卖", "食堂", "奶茶", "饿", "面包", "塔斯汀", "火锅"],
    "心情": ["累", "难受", "烦", "开心", "高兴", "难过", "心情", "emo", "压力", "焦虑", "委屈"],
    "日程": ["开会", "约", "提醒", "记一下", "帮我记", "日程", "安排", "明天", "后天", "周末"],
    "工作": ["项目", "代码", "插件", "DSH", "机器人", "bug", "开发", "部署"],
    "日常": [],
}


# ---------- 基础 ----------

def load_events() -> list:
    if not EVENT_FILE.exists():
        return []
    try:
        data = json.load(open(EVENT_FILE, encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_events(events: list) -> bool:
    try:
        json.dump(events, open(EVENT_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def _to_min(hhmm: str) -> int:
    try:
        h, m = hhmm.strip().split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return -1


def conflicts(events: list, d: str, t: str) -> list:
    """冲突：同时间 或 落在事件时间区间内（如课表 14:00-15:25）"""
    new_t = _to_min(t)
    out = []
    for e in events:
        if e.get("date") != d:
            continue
        m = re.search(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})", e.get("event", ""))
        if m:
            s, end = _to_min(m.group(1)), _to_min(m.group(2))
            if s >= 0 and end >= 0 and s <= new_t < end:
                out.append(e)
        elif e.get("time") == t:
            out.append(e)
    return out


def resolve_date(s: str) -> str:
    s = (s or "").strip().lower()
    if s == "today":
        return date.today().isoformat()
    if s == "tomorrow":
        return (date.today() + timedelta(days=1)).isoformat()
    if s in ("dayafter", "day_after_tomorrow", "dayaftertomorrow"):
        return (date.today() + timedelta(days=2)).isoformat()
    return s


def _cn2num(s: str) -> int:
    if s.isdigit():
        return int(s)
    if s in CN_NUM:
        return CN_NUM[s]
    if "十" in s:
        a, b = s.split("十", 1)
        return CN_NUM.get(a, 0) * 10 + CN_NUM.get(b, 0)
    return -1


def classify(text: str) -> str:
    for c, kws in CATEGORIES.items():
        if c == "日常":
            continue
        if any(k in text for k in kws):
            return c
    return "日常"


# ---------- 解析 ----------

def parse_schedule(text: str):
    """「明天下午三点开会」→ (date, time, event) 或 None"""
    today = date.today()
    d = None
    if "今天" in text or "今晚" in text:
        d = today
    elif "明天" in text:
        d = today + timedelta(days=1)
    elif "后天" in text:
        d = today + timedelta(days=2)
    elif "大后天" in text:
        d = today + timedelta(days=3)
    else:
        m = re.search(r"(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]", text)
        if m:
            try:
                d = date(today.year, int(m.group(1)), int(m.group(2)))
                if d < today:
                    d = date(today.year + 1, int(m.group(1)), int(m.group(2)))
            except Exception:
                d = None
        else:
            m = re.search(r"周([一二三四五六日天])", text)
            if m:
                wd = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}[m.group(1)]
                delta = (wd - today.weekday()) % 7
                if delta == 0:
                    delta = 7
                d = today + timedelta(days=delta)
    if d is None:
        return None
    tm = re.search(r"(上午|下午|晚上|中午|早上|凌晨)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[点:：]\s*(\d{1,2}|半)?", text)
    if not tm:
        return None
    period, hh, mm = tm.group(1) or "", tm.group(2), tm.group(3)
    hour = _cn2num(hh)
    if hour < 0 or hour > 24:
        return None
    minute = _cn2num(mm) if mm else 0
    if minute < 0:
        minute = 0
    if period in ("下午", "晚上") and hour < 12:
        hour += 12
    if period == "中午" and hour < 11:
        hour += 12
    if period == "凌晨" and hour == 12:
        hour = 0
    if hour >= 24:
        hour -= 24
    t = f"{hour:02d}:{minute:02d}"
    ev = extract_event(text)
    return d.isoformat(), t, ev


def parse_date_only(text: str):
    today = date.today()
    if "今天" in text or "今晚" in text:
        return today.isoformat()
    if "明天" in text:
        return (today + timedelta(days=1)).isoformat()
    if "后天" in text:
        return (today + timedelta(days=2)).isoformat()
    if "大后天" in text:
        return (today + timedelta(days=3)).isoformat()
    m = re.search(r"(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]", text)
    if m:
        try:
            d = date(today.year, int(m.group(1)), int(m.group(2)))
            if d < today:
                d = date(today.year + 1, int(m.group(1)), int(m.group(2)))
            return d.isoformat()
        except Exception:
            return None
    return None


def extract_event(text: str) -> str:
    ev = text
    for pat in [
        r"记一下|帮我记|帮我记一下|记下来|提醒我|设个提醒|设提醒|提醒一下|提醒|记着",
        r"取消|删掉|删了|不去了|不用了",
        r"帮我|小鲸|一下|这个|那个",
        r"(今天|明天|后天|大后天|今晚)?",
        r"(上午|下午|晚上|中午|早上|凌晨)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[点:：]\s*(\d{1,2}|半)?",
        r"(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]",
        r"周[一二三四五六日天]",
        r"[，,。！!～~]+|的",
    ]:
        ev = re.sub(pat, "", ev)
    ev = re.sub(r"\s+", "", ev).strip()
    return ev[:30] if ev else text[:30]


# ---------- 日程包 ----------

def schedule_add(sched_date: str, sched_time: str, event_name: str, lead: int = 20) -> str:
    d = resolve_date(sched_date)
    events = load_events()
    cs = conflicts(events, d, sched_time)
    if cs:
        names = "、".join(e.get("event", "") for e in cs[:3])
        return f"冲突：{d} {sched_time} 跟「{names}」时间重叠，要改时间还是合并？"
    if any(e.get("date") == d and e.get("event") == event_name for e in events):
        return f"已存在：{d} 已经有「{event_name}」，不用重复记"
    events.append({"date": d, "time": sched_time, "event": event_name, "lead": int(lead)})
    if not save_events(events):
        return "写入失败"
    return f"已记好：{d} {sched_time} · {event_name}（提前 {lead} 分钟提醒）"


def schedule_remove(sched_date: str, keyword: str) -> str:
    d = resolve_date(sched_date)
    events = load_events()
    keep = [e for e in events if not (e.get("date") == d and (keyword in e.get("event", "") or e.get("event", "") in keyword))]
    removed = len(events) - len(keep)
    if removed == 0:
        return f"没找到：{d} 没有包含「{keyword}」的日程"
    save_events(keep)
    return f"已删除：{d} 的「{keyword}」{removed} 条"


def schedule_list(sched_date: str) -> str:
    d = resolve_date(sched_date)
    items = [e for e in load_events() if e.get("date") == d]
    items.sort(key=lambda e: e.get("time", ""))
    if not items:
        return f"{d} 没有日程"
    lines = [f"{e.get('time', '')} {e.get('event', '')}（提前{e.get('lead', 20)}分钟）" for e in items]
    return f"{d} 日程：\n" + "\n".join(lines)


def schedule_find(keyword: str) -> str:
    items = [e for e in load_events() if keyword in e.get("event", "")]
    items.sort(key=lambda e: (e.get("date", ""), e.get("time", "")))
    if not items:
        return f"没找到包含「{keyword}」的日程"
    return "\n".join(f"{e.get('date')} {e.get('time')} {e.get('event')}" for e in items)


# ---------- 记忆包 ----------

def memory_index() -> str:
    if INDEX.exists():
        return INDEX.read_text(encoding="utf-8")[:6000]
    return "记忆库索引还没生成（等同步脚本跑一次）"


def memory_search(keyword: str, category: str = "") -> str:
    results = []
    for f in sorted(ARCHIVE.glob("*.json"), reverse=True)[:7]:
        try:
            arr = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        for e in arr:
            if keyword in e.get("text", ""):
                if category and classify(e.get("text", "")) != category:
                    continue
                results.append(f"{f.stem} {e.get('time')} {e.get('sender')}：{e.get('text', '')[:100]}")
                if len(results) >= 20:
                    break
        if len(results) >= 20:
            break
    if not results:
        return f"没搜到「{keyword}」"
    return "\n".join(results)


def memory_read_day(day: str) -> str:
    f = ARCHIVE / f"{day}.json"
    if not f.exists():
        return f"{day} 没有归档"
    try:
        arr = json.load(open(f, encoding="utf-8"))
    except Exception:
        return f"{day} 归档读取失败"
    lines = [f"{e.get('time')} {e.get('sender')}：{e.get('text', '')[:120]}" for e in arr[-40:]]
    return "\n".join(lines)


# ---------- 提醒包 ----------

def reminder_state() -> str:
    state = []
    if REMINDED_FILE.exists():
        try:
            state = json.load(open(REMINDED_FILE, encoding="utf-8"))
        except Exception:
            state = []
    today = date.today().isoformat()
    todays = [x for x in state if str(x).startswith(today)]
    sched = [e for e in load_events() if e.get("date") == today]
    sched.sort(key=lambda e: e.get("time", ""))
    lines = [f"今天日程 {len(sched)} 条："]
    lines += [f"- {e.get('time')} {e.get('event')}" for e in sched]
    lines.append(f"已触发提醒：{len(todays)} 条")
    return "\n".join(lines)


# ---------- 同步包 ----------

def sync_now() -> str:
    import importlib.util

    spec = importlib.util.spec_from_file_location("memory_sync", str(XJ_BASE / "memory_sync.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    st = mod.load_state()
    n = mod.export_new(st)
    mod.rebuild_index()
    mod.build_daily_candidates()
    return f"同步完成：新导出 {n} 条，索引已重建"


# ---------- 消息强制路由 ----------

ROUTES = [
    ("schedule_remove", ("取消", "删掉", "删了", "不去了", "不用了")),
    ("schedule_add", ("记一下", "帮我记", "提醒我", "设个提醒", "记下来", "提醒一下", "记着")),
    ("schedule_list", ("今天有什么", "明天有什么", "后天有什么", "查日程", "课表", "有什么课", "什么安排", "日程安排", "明天几节课")),
    ("memory_search", ("查历史", "翻记录", "翻翻", "昨天聊", "之前聊", "上次聊", "找一下", "搜一下", "之前说过")),
    ("memory_index", ("记忆索引", "查索引", "记忆库")),
    ("reminder_state", ("提醒了吗", "提醒了没", "提醒状态")),
]


def route_message(text: str):
    """按消息强制路由到对应包。返回 (handled, reply)；handled=False 表示交给 AI 聊天。"""
    text = (text or "").strip()
    if not text:
        return False, ""
    for tool, kws in ROUTES:
        if not any(k in text for k in kws):
            continue
        try:
            if tool == "schedule_remove":
                d = parse_date_only(text)
                if not d:
                    # 没日期 → 交给 AI 处理
                    return False, ""
                return True, schedule_remove(d, extract_event(text))
            if tool == "schedule_add":
                parsed = parse_schedule(text)
                if not parsed:
                    return False, ""  # 没解析出时间 → 交给 AI 问
                d, t, ev = parsed
                return True, schedule_add(d, t, ev, 20)
            if tool == "schedule_list":
                if "今天" in text or "有什么" not in text:
                    d = parse_date_only(text) or date.today().isoformat()
                else:
                    d = parse_date_only(text) or date.today().isoformat()
                return True, schedule_list(d)
            if tool == "memory_search":
                kw = _search_keyword(text)
                return True, memory_search(kw)
            if tool == "memory_index":
                return True, memory_index()
            if tool == "reminder_state":
                return True, reminder_state()
        except Exception as e:
            return True, f"处理出错: {e}"
    return False, ""


def _search_keyword(text: str) -> str:
    """从查询句里提取搜索关键词"""
    t = text
    for pat in [
        r"查一下|查查|查历史|翻记录|翻翻|找一下|搜一下|之前说过|昨天聊|上次聊|之前聊|的|话|记录|一下|吗|呢",
    ]:
        t = re.sub(pat, "", t)
    t = re.sub(r"[，,。！!？?～~]+", " ", t).strip()
    parts = [p for p in t.split() if p]
    return parts[0][:12] if parts else text[:12]
