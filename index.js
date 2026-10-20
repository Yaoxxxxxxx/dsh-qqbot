/**
 * dsh-qqbot — QQBOT 管理插件（宿主半 · v0.2 通用化版）
 *
 * 设计目标：开源给任何人用——本文件里**不硬编码任何本机专属路径/账号**。
 * 所有环境相关的值来自 Config（可配置），留空时自动探测：
 *   - napcatDir    NapCat 安装目录（含 config/webui.json）
 *   - astrbotDir   AstrBot 安装目录（含 data/data_v4.db）
 *   - kiraraDir    小鲸扩展脚本目录（reminder.py 等，没有就只用 AstrBot）
 *   - pythonPath   管理脚本用的 pythonw/python
 *   - astrbotPython AstrBot 自带的 python（留空用系统 python）
 *   - qqNumber     登录的 QQ 号（留空从 NapCat 配置 autoLoginAccount 读）
 *   - personaId    AstrBot persona id（默认 default）
 *   - 端口：napcatWebPort/napcatWsPort/astrbotWsPort/astrbotWebPort
 *   - backupDir    备份目录（留空 <astrbotDir>/backups）
 *
 * 配置持久化：<DSH home>/qqbot/config.json（DSH home 默认 %USERPROFILE%/.dsh）
 * 安全：所有服务端口强制绑定 127.0.0.1，不外泄。
 */
import { spawn } from "node:child_process";
import net from "node:net";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { defineTool } from "@deepseek-ai/dsh-tools";

const name = "qqbot";
const inject = ["tools", "webServer"];

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
const CONFIG_PATH = join(DSH_HOME, "qqbot", "config.json");
const LOOPBACK = "127.0.0.1";

// ───────────────────────── 默认配置（全部通用） ─────────────────────────
const DEFAULT_CONFIG = {
  napcatDir: "",
  astrbotDir: "",
  kiraraDir: "",
  pythonPath: "",
  astrbotPython: "",
  qqNumber: "",
  personaId: "default",
  napcatWebPort: 6099,
  napcatWsPort: 5700,
  astrbotWsPort: 6199,
  astrbotWebPort: 6185,
  backupDir: "",
  astrbotLauncher: "start-astrbot.vbs",
  components: {
    bridge: "bridge_astrbot.py",
    reminder: "reminder.py",
    bubble: "bubble.py",
    memorySync: "memory_sync.py",
    memoryDigest: "memory_digest.py",
    watchdog: "astrbot_watchdog.py",
  },
  logs: {
    bridge: "bridge_astrbot.log",
    watchdog: "watchdog.log",
    memorySync: "memory_sync.log",
    reminder: "reminder.log",
  },
};

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) out[k] = deepMerge(base[k] || {}, v);
    else if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

function loadConfig() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return deepMerge(DEFAULT_CONFIG, raw);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── 自动探测（通用） ─────────────────────────

/** 找含指定标记文件的目录：从候选目录出发，递归最多 maxDepth 层子目录。 */
function findDirWith(marker, candidates, maxDepth = 3) {
  const walk = (base, depth) => {
    try {
      if (existsSync(join(base, marker))) return base;
    } catch {}
    if (depth <= 0) return "";
    try {
      for (const sub of readdirSync(base, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        const hit = walk(join(base, sub.name), depth - 1);
        if (hit) return hit;
      }
    } catch {}
    return "";
  };
  for (const base of candidates) {
    if (!base) continue;
    const hit = walk(base, maxDepth);
    if (hit) return hit;
  }
  return "";
}

function detectConfig(cfg) {
  const cwd = process.cwd();
  const home = homedir();
  const out = { ...cfg };

  // NapCat：标记 config/webui.json（深度 4：能覆盖 <工作区>/QQ机器人/NapCat 这种）
  if (!out.napcatDir) {
    out.napcatDir = findDirWith(join("config", "webui.json"), [
      cwd,
      join(cwd, "QQ机器人", "NapCat"),
      join(cwd, "NapCat"),
      DSH_HOME,
      join(home, "NapCat"),
      join(home, "Desktop"),
      join(home, "Documents"),
      "C:\\NapCat",
      "D:\\NapCat",
      "D:\\",
      "C:\\",
      "E:\\",
    ], 4);
  }

  // AstrBot：标记 data/data_v4.db
  if (!out.astrbotDir) {
    out.astrbotDir = findDirWith(join("data", "data_v4.db"), [
      "D:\\AstrBot",
      join(home, "AstrBot"),
      join(cwd, "AstrBot"),
      cwd,
    ]);
  }

  // 小鲸扩展脚本：标记 memory_sync.py 或 reminder.py
  if (!out.kiraraDir) {
    out.kiraraDir = findDirWith("memory_sync.py", ["D:\\KiraraBot", join(home, "KiraraBot"), join(cwd, "KiraraBot")]);
    if (!out.kiraraDir) out.kiraraDir = findDirWith("reminder.py", ["D:\\KiraraBot", join(home, "KiraraBot"), join(cwd, "KiraraBot")]);
  }

  // AstrBot 自己的 python：常见 uv 安装位置
  if (!out.astrbotPython) {
    const cands = [
      join(home, "AppData", "Roaming", "uv", "tools", "astrbot", "Scripts", "python.exe"),
      join(home, ".local", "bin", "python"),
      "python",
    ];
    out.astrbotPython = cands.find((p) => p === "python" || existsSync(p)) || "python";
  }

  // 管理 python（pythonw 优先）
  if (!out.pythonPath) {
    const cands = [
      out.kiraraDir ? join(out.kiraraDir, ".venv", "Scripts", "pythonw.exe") : "",
      out.kiraraDir ? join(out.kiraraDir, ".venv", "Scripts", "python.exe") : "",
      "pythonw",
      "python",
    ].filter(Boolean);
    out.pythonPath = cands.find((p) => p === "pythonw" || p === "python" || existsSync(p)) || "python";
  }

  // 备份目录
  if (!out.backupDir) out.backupDir = out.astrbotDir ? join(out.astrbotDir, "backups") : join(DSH_HOME, "qqbot", "backups");

  // QQ 号：从 NapCat webui.json 的 autoLoginAccount 读
  if (!out.qqNumber && out.napcatDir) {
    try {
      const w = JSON.parse(readFileSync(join(out.napcatDir, "config", "webui.json"), "utf-8"));
      out.qqNumber = String(w.autoLoginAccount || "");
    } catch {}
  }

  return out;
}

let CFG = null;
function cfg() {
  if (!CFG) CFG = detectConfig(loadConfig());
  return CFG;
}

// ───────────────────────── 路径派生（全部来自 cfg） ─────────────────────────

function napcatToken() {
  const c = cfg();
  try {
    const w = JSON.parse(readFileSync(join(c.napcatDir, "config", "webui.json"), "utf-8"));
    return w.token || "";
  } catch {
    return "";
  }
}

function napcatWebPort() {
  const c = cfg();
  try {
    const w = JSON.parse(readFileSync(join(c.napcatDir, "config", "webui.json"), "utf-8"));
    return w.port || c.napcatWebPort;
  } catch {
    return c.napcatWebPort;
  }
}

function astrbotDb() {
  return join(cfg().astrbotDir, "data", "data_v4.db");
}

function astrbotLauncherPath() {
  return join(cfg().astrbotDir, cfg().astrbotLauncher);
}

/** 组件脚本的绝对路径（bridge/watchdog 在 astrbotDir，其余在 kiraraDir） */
function scriptPath(key) {
  const c = cfg();
  const rel = c.components?.[key];
  if (!rel) return "";
  const base = key === "bridge" || key === "watchdog" ? c.astrbotDir : c.kiraraDir;
  return join(base, rel);
}

/** 组件工作目录 */
function scriptCwd(key) {
  const c = cfg();
  return key === "bridge" || key === "watchdog" ? c.astrbotDir : c.kiraraDir;
}

function logPath(key) {
  const c = cfg();
  const rel = c.logs?.[key];
  if (!rel) return "";
  const base = key === "bridge" || key === "watchdog" ? c.astrbotDir : c.kiraraDir;
  return join(base, rel);
}

// ───────────────────────── 基础工具 ─────────────────────────

function portOpen(port) {
  return new Promise((res) => {
    const s = net.connect({ host: LOOPBACK, port }, () => {
      s.destroy();
      res(true);
    });
    s.on("error", () => res(false));
    s.setTimeout(1500, () => {
      s.destroy();
      res(false);
    });
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve2) => {
    try {
      const p = spawn(cmd, args, { windowsHide: true, ...opts });
      let out = "";
      let err = "";
      p.stdout?.on("data", (d) => (out += String(d)));
      p.stderr?.on("data", (d) => (err += String(d)));
      p.on("close", (code) => resolve2({ code, out, err }));
      p.on("error", (e) => resolve2({ code: -1, out, err: String(e) }));
    } catch (e) {
      resolve2({ code: -1, out: "", err: String(e) });
    }
  });
}

/** 把 python.exe 换成同目录的 pythonw.exe（无控制台窗口），找不到返回原值。 */
function pythonwOf(py) {
  if (!py) return py;
  if (py.toLowerCase().endsWith("pythonw.exe") || py === "pythonw") return py;
  if (!py.toLowerCase().includes("python")) return py;
  try {
    const cand = join(dirname(py), "pythonw.exe");
    if (existsSync(cand)) return cand;
  } catch {}
  return py;
}

function readTail(path, lines = 40) {
  try {
    return readFileSync(path, "utf-8").split(/\r?\n/).filter(Boolean).slice(-lines).join("\n");
  } catch {
    return `（日志不存在或读取失败：${path}）`;
  }
}

async function listComponents() {
  const r = await run("powershell", [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'python' } | Select-Object -ExpandProperty CommandLine",
  ]);
  return r.out || "";
}

function compRunning(cmdlines, scriptAbs) {
  if (!scriptAbs) return false;
  return cmdlines.includes(scriptAbs.replace(/\\/g, "\\"));
}

// ───────────────────────── NapCat API（含登录） ─────────────────────────

// NapCat WebUI 的 Credential 缓存（避免每次调 API 都登录 → 触发 login rate limit）
let _napcatCred = "";
let _napcatCredAt = 0;
const NAPCAT_CRED_TTL = 5 * 60 * 1000; // 5 分钟

async function napcatApi(path, body = null, method = "POST", forceFresh = false) {
  const c = cfg();
  const port = napcatWebPort();
  const token = napcatToken();
  if (!token) return { code: -1, message: "缺少 NapCat token（检查 NapCat 配置 config/webui.json）" };
  const py = c.astrbotPython || "python";
  // 先复用缓存（有效期内不再登录）；forceFresh 时强制重新登录
  let cred = !forceFresh && _napcatCred && Date.now() - _napcatCredAt < NAPCAT_CRED_TTL ? _napcatCred : "";
  if (!cred) {
    const pyScript = `import sys,hashlib,json,urllib.request
sys.stdout.reconfigure(encoding="utf-8")
h=hashlib.sha256((r"${token}"+".napcat").encode()).hexdigest()
b=json.dumps({"hash":h,"totpCode":""}).encode()
r=urllib.request.Request("http://127.0.0.1:${port}/api/auth/login",data=b,headers={"Content-Type":"application/json"},method="POST")
try:
  print(urllib.request.urlopen(r,timeout=8).read().decode())
except Exception as e:
  print("ERR:"+str(e))`;
    const login = await run(py, ["-c", pyScript]);
    try {
      cred = JSON.parse(login.out)?.data?.Credential || "";
    } catch {}
    if (!cred) return { code: -1, message: "NapCat 登录失败: " + (login.out || login.err) };
    _napcatCred = cred;
    _napcatCredAt = Date.now();
  }
  const payload = body ? JSON.stringify(body) : "{}";
  const py2 = `import sys,json,urllib.request
sys.stdout.reconfigure(encoding="utf-8")
cred=r"${cred}"
b=${JSON.stringify(payload)}.encode()
r=urllib.request.Request("http://127.0.0.1:${port}/api${path}",data=b,headers={"Content-Type":"application/json","Authorization":"Bearer "+cred},method="${method}")
try:
  print(urllib.request.urlopen(r,timeout=10).read().decode())
except Exception as e:
  print("ERR:"+str(e))`;
  const r = await run(py, ["-c", py2]);
  let result;
  try {
    result = JSON.parse(r.out);
  } catch {
    result = { code: -1, message: r.out || r.err };
  }
  // 凭据失效（Unauthorized）→ 清缓存、强制重新登录、重试一次
  if (!forceFresh && result && result.message === "Unauthorized") {
    _napcatCred = "";
    _napcatCredAt = 0;
    return napcatApi(path, body, method, true);
  }
  return result;
}

// ───────────────────────── 功能实现 ─────────────────────────

async function status() {
  const c = cfg();
  const cmdlines = await listComponents().catch(() => "");
  const comp = (key) => {
    const abs = scriptPath(key);
    return abs && compRunning(cmdlines, abs) ? "running" : "stopped";
  };
  const ports = {
    napcat: await portOpen(c.napcatWsPort),
    napcatWeb: await portOpen(napcatWebPort()),
    astrbot: await portOpen(c.astrbotWsPort),
    astrbotWeb: await portOpen(c.astrbotWebPort),
  };
  return {
    detected: {
      napcatDir: c.napcatDir,
      astrbotDir: c.astrbotDir,
      kiraraDir: c.kiraraDir,
      pythonPath: c.pythonPath,
      astrbotPython: c.astrbotPython,
      qqNumber: c.qqNumber,
      backupDir: c.backupDir,
    },
    ports,
    napcatToken: napcatToken() ? "已配置" : "缺失",
    components: {
      bridge: comp("bridge"),
      reminder: comp("reminder"),
      bubble: comp("bubble"),
      memorySync: comp("memorySync"),
      memoryDigest: comp("memoryDigest"),
      watchdog: comp("watchdog"),
    },
    qqOnline: ports.napcat,
  };
}

/**
 * 确保 NapCat 计划任务存在（NapCat 的 launcher.bat 需要管理员权限；
 * 计划任务用「最高权限」跑，之后启动无需 UAC）。
 * 已有 NapCatBot（用户自己的）就直接用；没有就创建一个 QQBOT-NapCat。
 * 创建计划任务需要管理员 → 首次会弹一次 UAC，用户点确认后永久有效。
 * @returns {Promise<string>} 可用的任务名，失败返回 ""
 */
async function ensureNapcatTask() {
  const c = cfg();
  // 1. 已有任务直接用
  for (const tn of ["NapCatBot", "QQBOT-NapCat"]) {
    try {
      const q = await run("schtasks", ["/query", "/tn", tn]);
      if (q.code === 0) return tn;
    } catch {}
  }
  // 2. 没有 → 创建（最高权限，需一次 UAC）
  const launcher = join(c.napcatDir, "launcher.bat");
  if (!existsSync(launcher)) return "";
  const create = `schtasks /create /tn QQBOT-NapCat /tr "\\"${launcher}\\"" /sc once /st 00:00 /rl highest /f`;
  try {
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Start-Process cmd.exe -Verb RunAs -ArgumentList '/c','${create.replace(/'/g, "''")}' -Wait`,
    ]);
  } catch {}
  // 3. 验证
  try {
    const q = await run("schtasks", ["/query", "/tn", "QQBOT-NapCat"]);
    if (q.code === 0) return "QQBOT-NapCat";
  } catch {}
  return "";
}

/** 列出当前所有 QQ 进程 PID（用于启动前后对比，识别 BOT 新起的 QQ）。 */
async function listQqPids() {
  const r = await run("powershell", [
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'QQ.exe' } | Select-Object -ExpandProperty ProcessId",
  ]);
  return (r.out || "")
    .split(/\s+/)
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0);
}

async function startAll() {
  const c = cfg();
  const r = {};
  // 启动前记录现有 QQ PID（用户日常 QQ 可能有多个），用于识别「BOT 新起的 QQ」
  let beforeQq = [];
  try {
    beforeQq = await listQqPids();
  } catch {}
  // NapCat：若未运行，用其 launcher（launcher.bat / start-napcat.vbs 都能探测）
  if (!(await portOpen(c.napcatWsPort))) {
    // 先检测 NapCat 启动器残留（只认 NapCatWinBootMain；QQ.exe 可能是用户日常 QQ，不能当僵尸）
    let zombies = 0;
    try {
      const z = await run("powershell", [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'NapCatWinBootMain.exe' } | Measure-Object | Select-Object -ExpandProperty Count",
      ]);
      zombies = Number((z.out || "0").trim()) || 0;
    } catch {}
    if (zombies > 0) {
      r.napcat =
        "检测到 " + zombies + " 个 NapCat 启动器残留（可能未完全退出）→ 请稍等或手动结束 NapCatWinBootMain.exe 再试";
    } else {
      // 优先用计划任务（最高权限，无需 UAC）——launcher.bat 需要管理员
      let started = false;
      let taskName = "";
      try {
        taskName = await ensureNapcatTask();
      } catch {}
      if (taskName) {
        try {
          const t = await run("schtasks", ["/run", "/tn", taskName]);
          if (t.code === 0) {
            r.napcat = "started via scheduled task: " + taskName;
            started = true;
          }
        } catch {}
      }
      if (!started) {
        const launchers = [join(c.napcatDir, "launcher.bat"), join(c.napcatDir, "start-napcat.vbs")].filter(
          (p) => p && existsSync(p),
        );
        if (launchers.length) {
          const l = launchers[0];
          // launcher.bat 需要管理员权限（会弹 UAC）；vbs 用 wscript //B
          if (l.toLowerCase().endsWith(".vbs")) {
            spawn("wscript.exe", ["//B", l], { cwd: c.napcatDir, windowsHide: true, detached: true, stdio: "ignore" }).unref();
            r.napcat = "started:" + l + "（若未启动请以管理员运行 launcher.bat）";
          } else {
            // 以管理员身份启动 launcher（UAC 弹窗需确认）
            try {
              spawn("powershell.exe", ["-NoProfile", "-Command", `Start-Process -FilePath 'cmd.exe' -Verb RunAs -ArgumentList '/c','"${l}"'`], {
                windowsHide: true,
                detached: true,
                stdio: "ignore",
              }).unref();
              r.napcat = "started:" + l + "（需要 UAC 确认）";
            } catch (e) {
              r.napcat = "启动失败（需要管理员权限）: " + String(e).slice(0, 120);
            }
          }
        } else {
          r.napcat = "未找到 NapCat 启动器（检查 napcatDir）";
        }
      }
    }
  } else {
    r.napcat = "already-running";
  }
  // AstrBot：用 launcher（vbs）
  if (!(await portOpen(c.astrbotWsPort))) {
    const l = astrbotLauncherPath();
    if (existsSync(l)) {
      spawn("wscript.exe", ["//B", l], { cwd: c.astrbotDir, windowsHide: true, detached: true, stdio: "ignore" }).unref();
      r.astrbot = "started";
    } else {
      r.astrbot = "未找到 AstrBot 启动器（检查 astrbotDir/astrbotLauncher）";
    }
  } else {
    r.astrbot = "already-running";
  }
  // 组件脚本（静默：python 用 pythonw，python.exe 也隐藏窗口 + 忽略 stdio）
  const cmdlines = await listComponents().catch(() => "");
  for (const key of Object.keys(c.components || {})) {
    const abs = scriptPath(key);
    if (!abs) {
      r[key] = "未配置";
      continue;
    }
    if (!existsSync(abs)) {
      r[key] = "脚本不存在: " + abs;
      continue;
    }
    if (compRunning(cmdlines, abs)) {
      r[key] = "already-running";
      continue;
    }
    // 一律用 pythonw（无控制台窗口）；找不到才退回 python
    const py0 = key === "bridge" || key === "watchdog" ? c.astrbotPython || "python" : c.pythonPath || "python";
    const py = pythonwOf(py0);
    spawn(py, [abs], { cwd: scriptCwd(key), windowsHide: true, detached: true, stdio: "ignore" }).unref();
    r[key] = "started";
  }
  // 识别「BOT 的 QQ」（启动前后对比新增的 QQ 进程）→ 记录 PID，停止时只杀它
  const napcatTried = r.napcat && !String(r.napcat).startsWith("检测") && !String(r.napcat).startsWith("未找到");
  if (napcatTried) {
    try {
      await new Promise((res) => setTimeout(res, 12000));
      const after = await listQqPids();
      const newPids = after.filter((p) => !beforeQq.includes(p)).sort((a, b) => a - b);
      if (newPids.length) {
        CFG = cfg();
        CFG.botQqPid = newPids[0]; // 最早创建的（主进程）
        saveConfig(CFG);
        r.botQqPid = CFG.botQqPid;
      } else {
        r.botQqPid = "未识别（QQ 可能还没起来，稍后重试启动或手动记）";
      }
    } catch (e) {
      r.botQqPid = "识别失败: " + String(e).slice(0, 100);
    }
  }
  return r;
}

async function stopAll() {
  const c = cfg();
  const r = {};
  // 1. 停后台组件（pythonw 脚本）
  const names = Object.keys(c.components || {});
  if (names.length) {
    const keywords = names.map((k) => (c.components[k] || "").replace(/\.py$/i, "")).filter(Boolean);
    const pattern = keywords.join("|");
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'python' -and $_.CommandLine -match '${pattern}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ]);
    r.components = "已停止";
  }
  // 2. 停 AstrBot（python.exe，且命令行含 astrbot、不含 bridge/watchdog）
  await run("powershell", [
    "-NoProfile",
    "-Command",
    `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'python' -and $_.CommandLine -match 'astrbot' -and $_.CommandLine -notmatch 'bridge_astrbot|astrbot_watchdog|NapCat' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ]);
  r.astrbot = "已停止";
  // 3. 停 NapCat + BOT 的 QQ（需要管理员 → 弹 UAC）
  // ⚠️ 只杀 BOT 的 QQ，绝不碰用户日常 QQ（可以有多个日常 QQ）。
  //    ① 先扫记录的 botQqPid 是否还活着：活着才按 PID 杀整树；已被杀则跳过，直接清理其他
  //    ② 兜底：父进程是 NapCatWinBootMain 或父进程已退出（孤儿）
  const psPath = join(tmpdir(), "qqbot_stop_qq.ps1");
  const botPid = Number(cfg().botQqPid) || 0;
  const psContent = [
    botPid ? `$botPid = ${botPid}` : "$botPid = 0",
    botPid ? `if ($botPid -gt 0 -and (Get-Process -Id $botPid -ErrorAction SilentlyContinue)) { taskkill /T /F /PID $botPid 2>$null | Out-Null }` : "",
    "$nap = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'NapCatWinBootMain.exe' }",
    "$nap | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    "$qqs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'QQ.exe' }",
    "foreach ($q in $qqs) {",
    "  $p = $null",
    "  try { $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $q.ParentProcessId) -ErrorAction SilentlyContinue } catch {}",
    "  if (-not $p) { Stop-Process -Id $q.ProcessId -Force -ErrorAction SilentlyContinue }",
    "  elseif ($p.Name -eq 'NapCatWinBootMain.exe') { Stop-Process -Id $q.ProcessId -Force -ErrorAction SilentlyContinue }",
    "}",
  ]
    .filter(Boolean)
    .join("\r\n");
  try {
    writeFileSync(psPath, psContent, "utf-8");
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${psPath}' -Wait`,
    ]);
    r.napcatAndBotQQ = "已向管理员申请清理（若弹 UAC 请点「是」）";
  } catch (e) {
    r.napcatAndBotQQ = "清理失败（需要管理员权限）: " + String(e).slice(0, 120);
  } finally {
    try {
      unlinkSync(psPath);
    } catch {}
  }
  return { ok: true, message: "已停止：后台组件 + AstrBot + NapCat/BOT 的 QQ（会弹一次 UAC，只杀 BOT 的 QQ，不动你日常 QQ）", detail: r };
}

function backup() {
  const c = cfg();
  const dir = c.backupDir;
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const done = [];
  const targets = [
    [join(c.kiraraDir, "data", "event_memory.json"), "event_memory.json"],
    [join(c.kiraraDir, "data", "memory", "index.md"), "memory_index.md"],
    [join(c.astrbotDir, "data", "cmd_config.json"), "astrbot_cmd_config.json"],
  ];
  for (const [src, base] of targets) {
    try {
      if (src && existsSync(src)) {
        copyFileSync(src, join(dir, `${stamp}-${base}`));
        done.push(`${stamp}-${base}`);
      }
    } catch {}
  }
  try {
    const arch = join(c.kiraraDir, "data", "memory", "archive");
    if (existsSync(arch)) {
      const dst = join(dir, `${stamp}-archive`);
      mkdirSync(dst, { recursive: true });
      for (const f of readdirSync(arch)) {
        if (f.endsWith(".json")) copyFileSync(join(arch, f), join(dst, f));
      }
      done.push(`${stamp}-archive/`);
    }
  } catch {}
  return { backupDir: dir, files: done };
}

function personaGet() {
  const c = cfg();
  const db = astrbotDb();
  if (!existsSync(db)) return Promise.resolve({ persona_id: c.personaId, system_prompt: "", error: "找不到 AstrBot 数据库: " + db });
  const py = c.astrbotPython || "python";
  return run(py, [
    "-c",
    `import sys,sqlite3
sys.stdout.reconfigure(encoding="utf-8")
con=sqlite3.connect(r"${db}")
row=con.execute("SELECT persona_id,system_prompt FROM personas WHERE persona_id=?", (${JSON.stringify(c.personaId)},)).fetchone()
print(row[1] if row else "")`,
  ]).then((r) => ({ persona_id: c.personaId, system_prompt: r.out || "" }));
}

function personaSave(systemPrompt) {
  const c = cfg();
  const db = astrbotDb();
  if (!existsSync(db)) return Promise.resolve({ ok: false, message: "找不到 AstrBot 数据库: " + db });
  const py = c.astrbotPython || "python";
  return run(py, [
    "-c",
    `import sqlite3,shutil,datetime
p=r"${db}"
shutil.copy2(p, p+".bak-"+datetime.datetime.now().strftime("%Y%m%d%H%M%S"))
con=sqlite3.connect(p)
con.execute("UPDATE personas SET system_prompt=? WHERE persona_id=?", (${JSON.stringify(systemPrompt)}, ${JSON.stringify(c.personaId)}))
con.commit()
print("saved")`,
  ]).then((r) => {
    if (!r.out.includes("saved")) return { ok: false, message: r.err || r.out };
    const l = astrbotLauncherPath();
    if (existsSync(l)) spawn("wscript.exe", ["//B", l], { cwd: c.astrbotDir, windowsHide: true, detached: true, stdio: "ignore" }).unref();
    return { ok: true, message: "已保存并重启 AstrBot（下一轮生效）" };
  });
}

async function loginQr() {
  const c = cfg();
  const qqUp = await portOpen(c.napcatWsPort);
  if (qqUp) return { ok: true, message: "QQ 已在线，无需扫码" };
  // NapCat 4.18：POST /QQLogin/GetQQLoginQrcode → data.qrcode（二维码 URL）
  const r = await napcatApi("/QQLogin/GetQQLoginQrcode");
  const data = r?.data ?? r;
  const text = data?.qrcode || "";
  if (!text) {
    return { ok: false, message: "获取二维码失败: " + JSON.stringify(r).slice(0, 250) };
  }
  const png = await qrPngBase64(text);
  if (!png) return { ok: false, message: "二维码图片生成失败", qrText: text };
  return { ok: true, qrPng: png, qrText: text, message: "请用手机 QQ 扫码登录" };
}

/** 把二维码文本内容渲染成 PNG base64（用 NapCat 所在环境的 qrcode 库）。 */
async function qrPngBase64(text) {
  const c = cfg();
  const py = pythonwOf(c.astrbotPython || "python");
  const b64 = await run(py, [
    "-c",
    `import base64,io,qrcode
qr=qrcode.QRCode(box_size=8,border=2)
qr.add_data(${JSON.stringify(text)})
qr.make(fit=True)
img=qr.make_image()
buf=io.BytesIO()
img.save(buf,"PNG")
print(base64.b64encode(buf.getvalue()).decode())`,
  ]);
  const png = (b64.out || "").trim();
  return png ? "data:image/png;base64," + png : "";
}

/** 内置登录：账号密码 → NapCat PasswordLogin；需新设备验证时自动取二维码。 */
async function qqPasswordLogin(qq, password) {
  if (!qq || !password) return { ok: false, message: "请填写 QQ 号和密码" };
  const { createHash } = await import("node:crypto");
  const md5 = createHash("md5").update(String(password)).digest("hex");
  const r = await napcatApi("/QQLogin/PasswordLogin", { uin: String(qq), passwordMd5: md5 });
  const data = r?.data ?? r;
  if (data?.needCaptcha) {
    return {
      ok: false,
      needCaptcha: true,
      message: "需要安全验证（验证码），请打开 NapCat WebUI(" + "http://127.0.0.1:" + napcatWebPort() + ") 完成登录",
      proofWaterUrl: data.proofWaterUrl || "",
    };
  }
  if (data?.needNewDevice && data?.jumpUrl) {
    const qr = await napcatApi("/QQLogin/GetNewDeviceQRCode", { uin: String(qq), jumpUrl: data.jumpUrl });
    const text = qr?.data?.str_url || qr?.str_url || "";
    if (text) {
      const png = await qrPngBase64(text);
      if (png) return { ok: true, needScan: true, qrPng: png, jumpUrl: data.jumpUrl, message: "新设备验证：请用手机 QQ 扫码确认" };
    }
    return { ok: false, message: "需要扫码验证，但取二维码失败: " + JSON.stringify(qr).slice(0, 200) };
  }
  if (data?.code === 0 || data?.retcode === 0 || r?.code === 0) {
    return { ok: true, message: "登录请求已发送，请等待几秒看状态" };
  }
  // QQ 已经登录（重复登录）→ 友好提示，不当失败
  const rawMsg = String(r?.message ?? data?.message ?? "");
  if (/QQ Is Logined/i.test(rawMsg) || rawMsg.includes("已登录")) {
    return { ok: true, message: "QQ 已在线，无需再次点击登录" };
  }
  // 需要手机验证 → 进入「等待授权」流程（不报错）
  if (rawMsg.includes("手Q") || rawMsg.includes("手机验证") || rawMsg.includes("验证")) {
    return {
      ok: true,
      needHandVerify: true,
      message: "请于45s内使用QQ进行授权（授权完成后请点击「账号密码登录」完成登录）",
    };
  }
  return { ok: false, message: "登录失败: " + JSON.stringify(r).slice(0, 300) };
}

/** 登录状态：CheckLoginStatus（返回等待授权/已授权等阶段）。 */
async function qqLoginState() {
  const c = cfg();
  const r = await napcatApi("/QQLogin/CheckLoginStatus", null, "POST");
  const data = r?.data ?? r;
  if (data && typeof data === "object" && (data.isLogin !== undefined || data.uin !== undefined || data.loginPhase !== undefined)) {
    return {
      ok: true,
      isLogin: Boolean(data.isLogin),
      uin: data.uin || c.qqNumber || "",
      loginPhase: data.loginPhase || "",
      qrLoginAccepted: Boolean(data.qrLoginAccepted),
      coreReady: Boolean(data.coreReady),
      loginError: data.loginError || "",
    };
  }
  // 兜底：5700 通 = 已登录
  const up = await portOpen(c.napcatWsPort);
  return { ok: true, isLogin: up, uin: c.qqNumber || "", loginPhase: up ? "online" : "", qrLoginAccepted: false, coreReady: up };
}

/** 快速登录列表（NapCat 保存过的账号） */
async function qqQuickLoginList() {
  const r = await napcatApi("/QQLogin/GetQuickLoginList", null, "POST");
  return { ok: true, list: r?.data ?? r ?? [] };
}

async function qqQuickLogin(qq) {
  const r = await napcatApi("/QQLogin/SetQuickLogin", { uin: String(qq) });
  return { ok: r?.code === 0 || r?.retcode === 0, raw: r };
}

// ───────────────────────── 工具注册 ─────────────────────────

function registerTools(tools) {
  tools.register(
    defineTool({
      name: "qqbot_status",
      description: "查看 QQBOT 状态：探测到的路径/端口/各组件运行情况",
      parameters: {},
      output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
      async execute() {
        return JSON.stringify(await status(), null, 2);
      },
    }),
  );
  tools.register(
    defineTool({
      name: "qqbot_start",
      description: "启动 QQBOT 全部后台服务（NapCat/AstrBot/各组件；脚本缺失会报告）",
      parameters: {},
      output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
      async execute() {
        return JSON.stringify(await startAll(), null, 2);
      },
    }),
  );
  tools.register(
    defineTool({
      name: "qqbot_stop",
      description: "停止 QQBOT 全部后台组件（NapCat/QQ 保留）",
      parameters: {},
      output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
      async execute() {
        return JSON.stringify(await stopAll(), null, 2);
      },
    }),
  );
  tools.register(
    defineTool({
      name: "qqbot_backup",
      description: "备份 QQBOT 数据（日程库/记忆索引/记忆归档/AstrBot 配置）",
      parameters: {},
      output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
      async execute() {
        return JSON.stringify(backup(), null, 2);
      },
    }),
  );
  tools.register(
    defineTool({
      name: "qqbot_persona_get",
      description: "读取 QQBOT 当前人设（AstrBot persona）",
      parameters: {},
      output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
      async execute() {
        const r = await personaGet();
        return r.system_prompt || "（读取失败）";
      },
    }),
  );
  tools.register(
    defineTool({
      name: "qqbot_persona_save",
      description: "保存 QQBOT 人设（写入 AstrBot persona 并重启使其生效）",
      parameters: { system_prompt: { type: "string", required: true, description: "完整人设文本" } },
      output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
      async execute(args) {
        return JSON.stringify(await personaSave(String(args?.system_prompt ?? "")));
      },
    }),
  );
  tools.register(
    defineTool({
      name: "qqbot_login_qr",
      description: "获取 QQ 登录二维码（QQ 掉线时用）",
      parameters: {},
      output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
      async execute() {
        return JSON.stringify(await loginQr(), null, 2);
      },
    }),
  );
  tools.register(
    defineTool({
      name: "qqbot_logs",
      description: "查看 QQBOT 组件最近日志（bridge/watchdog/memorySync/reminder）",
      parameters: { component: { type: "string", description: "bridge/watchdog/memorySync/reminder" } },
      output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
      async execute(args) {
        return readTail(logPath(String(args?.component ?? "bridge")), 40);
      },
    }),
  );
  tools.register(
    defineTool({
      name: "qqbot_config",
      description: "读取/保存 QQBOT 配置（路径、QQ 号、端口、personaId 等）；不传 config 则返回当前配置与探测结果",
      parameters: {
        config: { type: "string", description: "JSON 字符串：要合并保存的配置（可省略）" },
        reDetect: { type: "string", description: "传 '1' 重新自动探测并保存" },
      },
      output: { schema: { type: "string" }, render: (_a, v) => [{ type: "text", text: v }] },
      async execute(args) {
        const c = cfg();
        if (String(args?.reDetect) === "1") {
          CFG = detectConfig(loadConfig());
          saveConfig(CFG);
          return JSON.stringify({ ok: true, detected: CFG }, null, 2);
        }
        if (args?.config) {
          try {
            const patch = JSON.parse(String(args.config));
            CFG = deepMerge(CFG, patch);
            saveConfig(CFG);
            return JSON.stringify({ ok: true, config: CFG }, null, 2);
          } catch (e) {
            return JSON.stringify({ ok: false, message: String(e) });
          }
        }
        return JSON.stringify({ configPath: CONFIG_PATH, config: c }, null, 2);
      },
    }),
  );
}

// ───────────────────────── 应用入口 ─────────────────────────

function apply(ctx) {
  const log = (m) => {
    try {
      ctx?.logger?.info?.(`[qqbot] ${m}`);
    } catch {}
  };

  // 工具
  const tools = ctx?.tools ?? (typeof ctx?.get === "function" ? ctx.get("tools") : null);
  if (tools && typeof tools.register === "function") {
    try {
      registerTools(tools);
      log("tools registered: qqbot_status/start/stop/backup/persona_get/persona_save/login_qr/logs/config");
    } catch (e) {
      ctx?.logger?.warn?.(`[qqbot] tools register failed: ${String(e)}`);
    }
  }

  // 首次运行：自动探测并落盘配置
  try {
    const c0 = loadConfig();
    const detected = detectConfig(c0);
    saveConfig(detected);
    CFG = detected;
    log("config ready: " + CONFIG_PATH);
  } catch (e) {
    ctx?.logger?.warn?.(`[qqbot] config init failed: ${String(e)}`);
  }

  // HTTP 路由
  const web = ctx?.webServer ?? (typeof ctx?.get === "function" ? ctx.get("webServer") : null);
  const sendJson = (res, code, obj) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
  };
  if (web && typeof web.register === "function") {
    try {
      web.register({
        kind: "prefix",
        path: "/qqbot",
        handler: async (req, res) => {
          let url;
          try {
            url = new URL(req.url, "http://127.0.0.1");
          } catch {
            sendJson(res, 400, { ok: false, message: "bad url" });
            return;
          }
          const p = url.pathname;
          const m = (req.method || "GET").toUpperCase();
          try {
            if (p === "/qqbot/status" && m === "GET") return sendJson(res, 200, await status());
            if (p === "/qqbot/faq" && m === "GET") {
              try {
                return sendJson(res, 200, { ok: true, text: readFileSync(join(PLUGIN_ROOT, "FAQ.md"), "utf-8") });
              } catch (e) {
                return sendJson(res, 200, { ok: false, text: "FAQ.md 读取失败: " + String(e) });
              }
            }
            if (p === "/qqbot/config" && m === "GET") return sendJson(res, 200, { configPath: CONFIG_PATH, config: cfg() });
            if (p === "/qqbot/config" && m === "POST") {
              let body = "";
              req.on("data", (d) => (body += d));
              req.on("end", () => {
                try {
                  CFG = deepMerge(cfg(), JSON.parse(body || "{}"));
                  saveConfig(CFG);
                  sendJson(res, 200, { ok: true, config: CFG });
                } catch (e) {
                  sendJson(res, 400, { ok: false, message: String(e) });
                }
              });
              return;
            }
            if (p === "/qqbot/detect" && m === "POST") {
              CFG = detectConfig(loadConfig());
              saveConfig(CFG);
              return sendJson(res, 200, { ok: true, detected: CFG });
            }
            if (p === "/qqbot/start" && m === "POST") return sendJson(res, 200, await startAll());
            if (p === "/qqbot/stop" && m === "POST") return sendJson(res, 200, await stopAll());
            if (p === "/qqbot/backup" && m === "POST") return sendJson(res, 200, backup());
            if (p === "/qqbot/login/qr" && m === "POST") return sendJson(res, 200, await loginQr());
            if (p === "/qqbot/login/state" && m === "GET") return sendJson(res, 200, await qqLoginState());
            if (p === "/qqbot/login/quick-list" && m === "GET") return sendJson(res, 200, await qqQuickLoginList());
            if (p === "/qqbot/login/quick" && m === "POST") {
              let body = "";
              req.on("data", (d) => (body += d));
              req.on("end", async () => {
                try {
                  const { qq } = JSON.parse(body || "{}");
                  sendJson(res, 200, await qqQuickLogin(String(qq ?? "")));
                } catch (e) {
                  sendJson(res, 400, { ok: false, message: String(e) });
                }
              });
              return;
            }
            if (p === "/qqbot/login/password" && m === "POST") {
              let body = "";
              req.on("data", (d) => (body += d));
              req.on("end", async () => {
                try {
                  const { qq, password } = JSON.parse(body || "{}");
                  sendJson(res, 200, await qqPasswordLogin(String(qq ?? ""), String(password ?? "")));
                } catch (e) {
                  sendJson(res, 400, { ok: false, message: String(e) });
                }
              });
              return;
            }
            if (p === "/qqbot/persona" && m === "GET") return sendJson(res, 200, await personaGet());
            if (p === "/qqbot/persona" && m === "POST") {
              let body = "";
              req.on("data", (d) => (body += d));
              req.on("end", async () => {
                try {
                  const { system_prompt } = JSON.parse(body || "{}");
                  sendJson(res, 200, await personaSave(String(system_prompt ?? "")));
                } catch (e) {
                  sendJson(res, 400, { ok: false, message: String(e) });
                }
              });
              return;
            }
            sendJson(res, 404, { ok: false, message: "no route " + p });
          } catch (e) {
            sendJson(res, 500, { ok: false, message: String(e) });
          }
        },
      });
      log("routes registered: /qqbot/* (prefix)");
    } catch (e) {
      ctx?.logger?.warn?.(`[qqbot] routes register failed: ${String(e)}`);
    }
  } else {
    ctx?.logger?.warn?.("[qqbot] webServer 不可用，跳过路由注册");
  }
}

export { apply, inject, name };
export default { apply, inject, name };
