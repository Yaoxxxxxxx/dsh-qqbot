/**
 * dsh-qqbot — Client half（设置页「QQBOT」栏）
 *
 * 结构：window.__ModuleLoader__.load({ id, factory })
 * factory 返回 { inject: ['slots'], apply(ctx) }，用
 * ctx.slots.inject('settings.section', () => ctx.slots.register(...)) 注册设置页卡片。
 *
 * 数据全部来自宿主半的路由：/qqbot/status、/qqbot/persona、/qqbot/start、
 * /qqbot/stop、/qqbot/backup、/qqbot/login/qr（全部只在本机 127.0.0.1 上）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-qqbot',
  factory: function qqbotFactory(require) {
    const React = require('react');
    const h = React.createElement;

    function QQBOTSection() {
      const [status, setStatus] = React.useState(null);
      const [persona, setPersona] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [faqText, setFaqText] = React.useState('');
      const [config, setConfig] = React.useState(null);
      const [qrImg, setQrImg] = React.useState('');
      const [loginQq, setLoginQq] = React.useState('');
      const [loginPwd, setLoginPwd] = React.useState('');
      const [loginState, setLoginState] = React.useState(null);
      const [quickList, setQuickList] = React.useState([]);

      const fetchJson = async (url, options) => {
        try {
          const r = await fetch(url, options);
          return await r.json();
        } catch (e) {
          return { error: String(e) };
        }
      };

      const refresh = async () => {
        const s = await fetchJson('/qqbot/status');
        setStatus(s);
      };

      const loadConfig = async () => {
        const c = await fetchJson('/qqbot/config');
        if (c && c.config) setConfig(c.config);
      };

      React.useEffect(() => {
        refresh();
        loadConfig();
        fetchJson('/qqbot/persona').then((p) => {
          if (p && typeof p.system_prompt === 'string') setPersona(p.system_prompt);
        });
        loadFaq();
        loadLogin();
      }, []);

      const loadLogin = async () => {
        const s = await fetchJson('/qqbot/login/state');
        setLoginState(s);
        const q = await fetchJson('/qqbot/login/quick-list');
        if (q && Array.isArray(q.list)) setQuickList(q.list);
      };

      const doPasswordLogin = async () => {
        setBusy(true);
        setNotice('登录中…');
        const r = await fetchJson('/qqbot/login/password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qq: loginQq, password: loginPwd }),
        });
        if (r && r.qrPng) {
          setQrImg(r.qrPng);
          setNotice('新设备验证：用手机 QQ 扫码确认，确认后会自动刷新状态');
        } else if (r && r.message) {
          setNotice(r.message);
        } else {
          setNotice('登录失败：' + JSON.stringify(r).slice(0, 200));
        }
        setBusy(false);
        loadLogin();
        // 登录后轮询：扫码/手机授权确认后自动刷新；授权完成 → 自动再登录一次
        if (r && (r.needScan || r.needHandVerify || r.ok)) {
          let n = 0;
          const timer = setInterval(async () => {
            n += 1;
            const s = await fetchJson('/qqbot/login/state');
            if (s && s.isLogin) {
              clearInterval(timer);
              setLoginState(s);
              setQrImg('');
              setNotice('登录成功！QQ 已上线');
              refresh();
              loadLogin();
              return;
            }
            // 检测到授权完成 → 提示用户手动再点一次登录（回退手动版，不做自动登录）
            const authorized = s && (s.qrLoginAccepted || s.coreReady || (s.loginPhase && s.loginPhase !== 'waiting_qrcode'));
            if (r.needHandVerify && authorized) {
              clearInterval(timer);
              setLoginState(s);
              setNotice('已授权！请点击「账号密码登录」完成登录');
              return;
            }
            if (n >= 90) clearInterval(timer);
          }, 500);
        }
      };

      const doQuickLogin = async (qq) => {
        setBusy(true);
        setNotice('快速登录中…');
        const r = await fetchJson('/qqbot/login/quick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qq }),
        });
        setNotice(r && r.ok ? '快速登录请求已发送' : '快速登录失败：' + JSON.stringify(r).slice(0, 200));
        setBusy(false);
      };

      const loadFaq = () => {
        fetchJson('/qqbot/faq').then((f) => {
          if (f && typeof f.text === 'string') setFaqText(f.text);
        });
      };

      const saveConfigFields = async () => {
        setBusy(true);
        setNotice('保存配置中…');
        const r = await fetchJson('/qqbot/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config || {}),
        });
        setNotice(r.ok ? '配置已保存' : '保存失败：' + JSON.stringify(r).slice(0, 200));
        setBusy(false);
      };

      const reDetect = async () => {
        setBusy(true);
        setNotice('自动探测中…');
        const r = await fetchJson('/qqbot/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (r && r.detected) setConfig(r.detected);
        setNotice('探测完成');
        setBusy(false);
      };

      const act = async (url, label) => {
        setBusy(true);
        setNotice(label + '…');
        const r = await fetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (url.includes('/qqbot/stop')) {
          setNotice(r && r.ok ? '已停止全部服务（后台组件 + AstrBot + BOT 的 QQ，UAC 已确认）' : '停止失败：' + JSON.stringify(r).slice(0, 200));
        } else {
          setNotice(label + '完成：' + JSON.stringify(r).slice(0, 200));
        }
        setBusy(false);
        refresh();
        // 服务启动/停止后延迟刷新，等端口真正起来再显示在线
        setTimeout(refresh, 3000);
        setTimeout(refresh, 8000);
      };

      const savePersona = async () => {
        setBusy(true);
        setNotice('保存人设中…');
        const r = await fetchJson('/qqbot/persona', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system_prompt: persona }),
        });
        setNotice(r.ok ? '人设已保存，重启 AstrBot 后下一轮生效' : '保存失败：' + JSON.stringify(r).slice(0, 200));
        setBusy(false);
      };

      const qr = async () => {
        setBusy(true);
        setNotice('检查登录状态…');
        const r = await fetchJson('/qqbot/login/qr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        if (r && r.qrPng) {
          setQrImg(r.qrPng);
          setNotice('二维码已生成，用手机 QQ 扫一扫（约 180 秒有效）');
        } else if (r && r.message) {
          setQrImg('');
          setNotice(r.message);
        } else {
          setQrImg('');
          setNotice('获取失败：' + JSON.stringify(r).slice(0, 300));
        }
        setBusy(false);
      };

      const row = (label, value) =>
        h('div', { style: { display: 'flex', gap: 8, fontSize: 12, lineHeight: '20px' } },
          h('span', { style: { width: 120, opacity: 0.7 } }, label),
          h('span', {}, String(value)));

      const btn = (text, onClick) =>
        h('button', {
          onClick,
          disabled: busy,
          style: { padding: '4px 12px', fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer' },
        }, text);

      const cfgRow = (label, key, placeholder) =>
        h('div', { key: 'cfg-' + key, style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 } }, [
          h('span', { key: 'l', style: { width: 120, opacity: 0.7 } }, label),
          h('input', {
            key: 'i',
            value: (config && config[key]) || '',
            placeholder: placeholder || '',
            onChange: (e) => setConfig({ ...(config || {}), [key]: e.target.value }),
            style: { flex: 1, fontSize: 12, padding: '3px 6px' },
          }),
        ]);

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760 } }, [
        h('h2', { key: 't', style: { margin: 0, fontSize: 18, fontWeight: 600 } }, 'QQBOT'),
        h('p', { key: 'd', style: { margin: 0, fontSize: 12, opacity: 0.7 } },
          '小鲸（QQ BOT）：AstrBot + NapCat 状态管理 · 人设编辑 · 备份 · 登录二维码。所有端口仅监听本机。'),
        status && status.error
          ? h('div', { key: 'err', style: { color: '#e06c75', fontSize: 12 } }, '状态读取失败：' + status.error)
          : null,
        status && status.ports
          ? h('div', { key: 'st', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
              h('div', { key: 'h', style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '服务状态'),
              row('NapCat(5700)', status.ports.napcat ? '在线' : '离线'),
              row('NapCat WebUI', status.ports.napcatWeb ? '在线' : '离线'),
              row('AstrBot(6199)', status.ports.astrbot ? '在线' : '离线'),
              row('AstrBot WebUI', status.ports.astrbotWeb ? '在线' : '离线'),
              row('NapCat Token', status.napcatToken),
              status.components
                ? row('后台组件', Object.entries(status.components).map(([k, v]) => k + ':' + v).join(' · '))
                : null,
            ])
          : null,
        h('div', { key: 'btns', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
          btn('启动全部服务', () => act('/qqbot/start', '启动')),
          h('span', { key: 'stopnote', style: { fontSize: 11, opacity: 0.6 } }, '停止服务需要授权一次管理员权限以停止QQ进程'),
          btn('停止全部服务', () => act('/qqbot/stop', '停止')),
          btn('立即备份', () => act('/qqbot/backup', '备份')),
          btn('刷新登录状态', loadLogin),
        ]),
        status && status.env && status.env.checks
          ? h('div', { key: 'env', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
              h('div', { key: 'eh', style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '环境自检'),
              ...Object.entries(status.env.checks).map(([k, v]) =>
                h('div', { key: 'env-' + k, style: { fontSize: 12, color: v.ok ? '#6fcf97' : '#e06c75' } },
                  (v.ok ? '✓ ' : '✗ ') + k + '：' + v.detail),
              ),
            ])
          : null,
        h('div', { key: 'login', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
          h('div', { key: 'lh', style: { fontSize: 13, fontWeight: 600 } }, 'QQ 登录（内置）'),
          h('div', { key: 'ls', style: { fontSize: 12, opacity: 0.8 } },
            loginState && loginState.isLogin
              ? '状态：已登录' + (loginState.uin ? '（' + loginState.uin + '）' : '')
              : '状态：未登录'),
          quickList && quickList.length
            ? h('div', { key: 'ql', style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }, [
                h('span', { key: 'qt', style: { fontSize: 12, opacity: 0.7 } }, '快速登录：'),
                ...quickList.map((u) => btn(String(u.uin || u.qq || u), () => doQuickLogin(u.uin || u.qq || u))),
              ])
            : null,
          h('div', { key: 'lf', style: { display: 'flex', gap: 8, flexWrap: 'wrap' } }, [
            h('input', {
              key: 'qq',
              value: loginQq,
              placeholder: 'QQ 号',
              onChange: (e) => setLoginQq(e.target.value),
              style: { width: 160, fontSize: 12, padding: '3px 6px' },
            }),
            h('input', {
              key: 'pwd',
              value: loginPwd,
              type: 'password',
              placeholder: 'QQ 密码',
              onChange: (e) => setLoginPwd(e.target.value),
              style: { width: 160, fontSize: 12, padding: '3px 6px' },
            }),
            btn('账号密码登录', doPasswordLogin),
          ]),
          notice
            ? h('div', { key: 'lmsg', style: { fontSize: 12, lineHeight: '18px', padding: '6px 10px', borderRadius: 6, background: 'rgba(90,169,230,0.12)', wordBreak: 'break-all' } }, notice)
            : null,
          h('div', { key: 'lnote', style: { fontSize: 11, opacity: 0.55 } },
            '密码只在本次登录时用（MD5 后发给本机 NapCat），不保存到配置；新设备会要求扫码确认。'),
        ]),
        qrImg
          ? h('div', { key: 'qrbox', style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 } }, [
              h('div', { key: 'qrh', style: { fontSize: 13, fontWeight: 600 } }, '登录二维码（手机 QQ 扫一扫）'),
              h('img', { key: 'qri', src: qrImg, alt: 'QQ 登录二维码', style: { width: 220, height: 220, imageRendering: 'pixelated', background: '#fff', padding: 6, borderRadius: 8 } }),
            ])
          : null,
        h('div', { key: 'paths', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
          h('div', { key: 'pth', style: { fontSize: 13, fontWeight: 600 } }, '路径配置（留空可自动探测；换机器/换目录在这里改）'),
          config
            ? [
                cfgRow('NapCat 目录', 'napcatDir', 'example: C:\\\\NapCat'),
                cfgRow('AstrBot 目录', 'astrbotDir', 'example: C:\\\\AstrBot'),
                cfgRow('扩展脚本目录', 'kiraraDir', 'example: C:\\\\KiraraBot'),
                cfgRow('pythonw 路径', 'pythonPath', 'example: C:\\\\Python\\\\pythonw.exe'),
                cfgRow('AstrBot python', 'astrbotPython', '留空用系统 python'),
                cfgRow('QQ 号', 'qqNumber', '登录的 QQ 号'),
                cfgRow('personaId', 'personaId', '默认 default'),
                cfgRow('备份目录', 'backupDir', '留空 = AstrBot/backups'),
              ]
            : h('div', { key: 'p0', style: { fontSize: 12, opacity: 0.7 } }, '（配置读取中…）'),
          h('div', { key: 'pbtns', style: { display: 'flex', gap: 8 } }, [
            btn('保存配置', saveConfigFields),
            btn('重新自动探测', reDetect),
          ]),
        ]),
        h('div', { key: 'persona', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
          h('div', { key: 'ph', style: { fontSize: 13, fontWeight: 600 } }, '人设（保存后重启 AstrBot 生效）'),
          h('textarea', {
            key: 'ta',
            value: persona,
            onChange: (e) => setPersona(e.target.value),
            spellCheck: false,
            style: { width: '100%', minHeight: 240, fontSize: 12, lineHeight: '18px', fontFamily: 'inherit', padding: 8 },
          }),
          h('div', { key: 'pb', style: { display: 'flex', gap: 8 } }, [
            btn('保存人设', savePersona),
            btn('重新读取', () => fetchJson('/qqbot/persona').then((p) => p && typeof p.system_prompt === 'string' && setPersona(p.system_prompt))),
          ]),
        ]),
        h('div', { key: 'faq', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
          h('div', { key: 'fh', style: { fontSize: 13, fontWeight: 600 } }, '常见问题（FAQ · 排障清单）'),
          faqText
            ? h('pre', {
                key: 'ft',
                style: {
                  margin: 0,
                  maxHeight: 340,
                  overflow: 'auto',
                  fontSize: 12,
                  lineHeight: '18px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: 'rgba(0,0,0,0.25)',
                  padding: 10,
                  borderRadius: 8,
                },
              }, faqText)
            : h('div', { key: 'ft0', style: { fontSize: 12, opacity: 0.7 } }, '（FAQ 未加载，点「刷新 FAQ」）'),
          h('div', { key: 'fb', style: { display: 'flex', gap: 8 } }, [btn('刷新 FAQ', loadFaq)]),
        ]),
      ]);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'qqbot',
                order: 40,
                label: () => 'QQBOT',
                inject: () => ({}),
              },
              QQBOTSection,
            ),
          );
        } catch (e) {
          // 注册失败不影响宿主启动
        }
      },
    };
  },
});
