// tools/smoke.mjs — 站点浏览器冒烟 + 截图基线（G4/G5 闸门）
//
// 用法：先起静态服务和带调试口的 Chrome，再运行：
//   node tools/serve.mjs . 8099
//   chrome --headless=new --remote-debugging-port=9333 about:blank
//   node tools/smoke.mjs
//
// 门禁：--strict 时任何 console error / 未捕获异常 / 页面级 4xx 都算失败（退出码 1）。
// 第三方瓦片（autonavi 等）的失败只记录为 warning，不算失败。
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const BASE = arg('base', 'http://127.0.0.1:8099').replace(/\/$/, '');
const CDP = arg('cdp', 'http://127.0.0.1:9333').replace(/\/$/, '');
const OUT = arg('out', 'tests/shots');
const STRICT = argv.includes('--strict');
const ONLY = (arg('pages', '') || '').split(',').map(s => s.trim()).filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));
// 第三方资源：失败只警告
const THIRD_PARTY = /(autonavi|amap|gstatic|googleapis|jsdelivr|unpkg|githubusercontent|bilibili|zhimg|aliyun)/i;

const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 900, dsf: 1, mobile: false },
  { name: 'mobile', width: 390, height: 844, dsf: 2, mobile: true },
];

const PAGES = [
  { path: '/index.html', name: 'index', wait: 2600 },
  { path: '/tech.html', name: 'tech', wait: 1800 },
  { path: '/leisure.html', name: 'leisure', wait: 1800 },
];

async function newTarget() {
  const r = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' });
  const t = await r.json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('ws open failed')); });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, 30000);
  });
  return { targetId: t.id, ws, send, events };
}

async function run() {
  await mkdir(OUT, { recursive: true });
  const pages = ONLY.length ? PAGES.filter(p => ONLY.includes(p.name)) : PAGES;
  const report = { base: BASE, shots: [], failures: [], warnings: [], checks: [] };

  const { targetId, ws, send, events } = await newTarget();
  const consoleErrors = [];
  const exceptions = [];
  const badResponses = [];
  const netFailures = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 300));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push((d.exception?.description || d.text || '').split('\n')[0].slice(0, 300));
    } else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
      const u = m.params.response.url;
      badResponses.push(`${m.params.response.status} ${u.slice(0, 160)}`);
    } else if (m.method === 'Network.loadingFailed' && !m.params.errorText.includes('ERR_ABORTED')) {
      netFailures.push(`${m.params.errorText} ${(m.params.requestId || '').slice(0, 8)}`);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Log.enable');

  const evl = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]);
    return r.result.value;
  };
  const poll = async (expr, timeout = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await evl(expr)) return true; } catch { /* keep polling */ }
      await sleep(200);
    }
    return false;
  };
  const shot = async (name, full = true) => {
    let clip;
    if (full) {
      const m = await send('Page.getLayoutMetrics');
      const c = m.cssContentSize;
      const vp = await evl('({h: innerHeight})');
      clip = { x: 0, y: 0, width: c.width, height: Math.min(c.height, Math.max(vp.h, 6000)), scale: 1 };
    }
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full, ...(clip ? { clip } : {}) });
    const file = join(OUT, name + '.png');
    await writeFile(file, Buffer.from(data, 'base64'));
    report.shots.push(file);
  };
  // 单元素截图（自动滚动到元素再截，坐标用页面绝对位置）
  const shotEl = async (name, sel) => {
    const r = await evl(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const b = el.getBoundingClientRect();
      return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; })()`);
    if (!r || !r.width) return null;
    const { data } = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: Math.min(r.width + 12, 1366), height: r.height + 12, scale: 1 },
    });
    const file = join(OUT, name + '.png');
    await writeFile(file, Buffer.from(data, 'base64'));
    report.shots.push(file);
    return r;
  };
  const dismissPreloader = async () => {
    const has = await poll("!!document.getElementById('sp-enter')", 4000);
    if (has) {
      await evl("(() => { const b=document.getElementById('sp-enter'); if(b) b.click(); return true; })()");
      await sleep(900);
    }
    return has;
  };

  for (const pg of pages) {
    for (const vp of VIEWPORTS) {
      consoleErrors.length = 0; exceptions.length = 0; badResponses.length = 0; netFailures.length = 0;
      await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dsf, mobile: vp.mobile });
      await send('Page.navigate', { url: BASE + pg.path });
      await sleep(pg.wait);
      await dismissPreloader();
      await sleep(1200);
      await evl('window.scrollTo(0,0)');
      const tag = `${pg.name}-${vp.name}`;
      const info = await evl(`(() => ({
        title: document.title,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: innerWidth,
        siteData: !!window.SITE_DATA,
        leaflet: !!window.L,
        cities: document.querySelectorAll('#cityList .city').length,
        chips: document.querySelectorAll('#cityMapChips .cm-chip').length,
        mapPins: document.querySelectorAll('[data-city-map] .cm-pin').length,
        mapReady: !!document.querySelector('[data-city-map].leaflet-container'),
        expectCities: (window.SITE_DATA ? window.SITE_DATA.cities.length : 0),
        hasCampus: !!(window.SITE_DATA && window.SITE_DATA.campusCard),
        hasSoon: !!(window.SITE_DATA && window.SITE_DATA.futureCity),
        cityNote: (document.getElementById('cityNote') || {}).textContent || '',
        h1: (document.querySelector('h1') || {}).textContent || ''
      }))()`);
      await shot(`${pg.name}-${vp.name}-full`);
      if (pg.name === 'index') {
        await shotEl(`${pg.name}-${vp.name}-citymap`, '#cityMapBlock').catch(() => {});
        await shotEl(`${pg.name}-${vp.name}-cities`, '#cities').catch(() => {});
      }
      const errs = consoleErrors.slice();
      const localFail = badResponses.filter(u => !THIRD_PARTY.test(u));
      const thirdFail = badResponses.filter(u => THIRD_PARTY.test(u));
      report.checks.push({ tag, ...info, consoleErrors: errs, exceptions: exceptions.slice(), badLocal: localFail, badThirdParty: thirdFail.length, netFailures: netFailures.slice(0, 6) });
      if (errs.length) report.failures.push(`${tag}: console error → ${errs[0]}`);
      if (exceptions.length) report.failures.push(`${tag}: exception → ${exceptions[0]}`);
      if (localFail.length) report.failures.push(`${tag}: 本地资源 ${localFail[0]}`);
      if (info.scrollWidth > info.innerWidth + 1) report.failures.push(`${tag}: 横向溢出 ${info.scrollWidth}>${info.innerWidth}`);
      if (thirdFail.length) report.warnings.push(`${tag}: 第三方失败 ${thirdFail.length} 个（已忽略）`);
      if (pg.name === 'index') {
        // 数量按站点数据推导，加城市时不用改测试
        const expCards = info.expectCities + (info.hasSoon ? 1 : 0) + (info.hasCampus ? 1 : 0);
        const expPins = info.expectCities + (info.hasCampus ? 1 : 0);
        if (!info.siteData) report.failures.push(`${tag}: SITE_DATA 未加载`);
        if (info.cities !== expCards) report.failures.push(`${tag}: 城市卡 ${info.cities} ≠ 期望 ${expCards}`);
        if (info.chips !== expPins) report.failures.push(`${tag}: chips ${info.chips} ≠ 期望 ${expPins}`);
        if (!info.mapReady) report.failures.push(`${tag}: 地图未初始化（[data-city-map] 缺 .leaflet-container）`);
        else if (info.mapPins !== expPins) report.failures.push(`${tag}: 地图标记 ${info.mapPins} ≠ 期望 ${expPins}`);
        if (!info.cityNote.trim()) report.failures.push(`${tag}: #cityNote 为空`);
      }
    }
  }

  // 语言切换冒烟（仅在 index 时做一次，桌面尺寸）
  if (!ONLY.length || ONLY.includes('index')) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + '/index.html' });
    await sleep(2200);
    await dismissPreloader();
    await sleep(800);
    const before = await evl("(document.querySelector('#cityList .city b')||{}).textContent || ''");
    const hasBtn = await evl("!!document.getElementById('langBtn')");
    if (hasBtn) {
      await evl("(() => { localStorage.setItem('lang','en'); return true; })()");
      await send('Page.navigate', { url: BASE + '/index.html' });
      await sleep(2200);
      await dismissPreloader();
      await sleep(1400);
      const after = await evl("(document.querySelector('#cityList .city b')||{}).textContent || ''");
      const chipsEn = await evl("document.querySelectorAll('#cityMapChips .cm-chip').length");
      const pinsEn = await evl("document.querySelectorAll('[data-city-map] .cm-pin').length");
      await shot('index-desktop-en-full');
      report.lang = { before, after, chipsEn, pinsEn };
      if (before === after) report.failures.push(`lang: 切换英文后城市名未变化（${before}）`);
      if (chipsEn < 7 || pinsEn < 7) report.failures.push(`lang: 英文态地图 chips=${chipsEn} pins=${pinsEn} < 7`);
      await evl("(() => { localStorage.setItem('lang','zh'); return true; })()");
    }
  }

  await send('Target.closeTarget', { targetId }).catch(() => {});
  ws.close();

  report.ok = report.failures.length === 0;
  console.log(JSON.stringify(report, null, 1));
  console.log(report.ok ? `\nSMOKE PASS（${report.shots.length} 张截图 → ${OUT}）` : `\nSMOKE FAIL（${report.failures.length} 项）`);
  process.exit(STRICT && !report.ok ? 1 : 0);
}

run().catch(e => { console.error('SMOKE ERROR', e.stack || e.message); process.exit(2); });
