// tools/perf-budget.mjs — CDP 采集 index/tech/leisure 的真实传输量、请求数与 DCL/load/LCP，按预算判定。
// 用法：node tools/serve.mjs . 8102；node tools/perf-budget.mjs --base http://127.0.0.1:8102 [--strict] [--pages index]
// 口径：responseReceived 归类 + encodedDataLength 实收字节；本地 serve.mjs 也 gzip，与线上一致。
import { writeFile, mkdir } from 'node:fs/promises';

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
const VIEWPORT = { width: 1366, height: 900, dsf: 1 };
const PAGES = [
  { path: '/index.html', name: 'index', settle: 800, quiet: 6000 },
  { path: '/tech.html', name: 'tech', settle: 600, quiet: 4000 },
  { path: '/leisure.html', name: 'leisure', settle: 600, quiet: 4000 },
  // 两个图片密集的项目页：用于验证本轮图片压缩的实际收益（不参与首页预算）
  { path: '/turbocore.html', name: 'turbocore', settle: 600, quiet: 4000 },
  { path: '/deep-space.html', name: 'deep-space', settle: 600, quiet: 4000 },
];
// 首页预算（--strict 生效）
const BUDGET = { jsCssKB: 400, imageKB: 1228.8, requests: 45, lcpMs: 2500 };
const TYPES = ['document', 'css', 'js', 'image', 'font', 'other', 'media'];
// Chrome 157 的 responseReceived 不再带 type，按 mimeType 归类更稳。
function kindOf(r) {
  const t = String(r.type || '').toLowerCase();
  if (t === 'document' || t === 'stylesheet' || t === 'script' || t === 'image' || t === 'font') {
    return { document: 'document', stylesheet: 'css', script: 'js', image: 'image', font: 'font' }[t];
  }
  const m = String(r.mimeType || '').toLowerCase();
  if (m.includes('text/html')) return 'document';
  if (m.includes('text/css')) return 'css';
  if (/javascript|ecmascript/.test(m)) return 'js';
  if (m.startsWith('image/')) return 'image';
  if (/^font\/|woff/.test(m)) return 'font';
  if (/^(video|audio)\//.test(m)) return 'media';
  return 'other';
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const kb = n => Math.round(n / 102.4) / 10;

async function pageTarget() {
  const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws open failed')); });
  let id = 0;
  const pending = new Map();
  const handlers = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) handlers.forEach(h => h(msg));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, 30000);
  });
  return { targetId: t.id, ws, send, on: h => handlers.push(h) };
}
async function measure(pg) {
  const { targetId, ws, send, on } = await pageTarget();
  const baseOrigin = new URL(BASE).origin;
  const responses = new Map();  // requestId -> { kind, local }
  const inflight = new Set();
  const bytes = {};
  let failed = 0;
  on(m => {
    if (m.method === 'Network.requestWillBeSent') inflight.add(m.params.requestId);
    else if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      let local = false;
      try { local = new URL(r.url).origin === baseOrigin; } catch { /* data: 等 */ }
      responses.set(m.params.requestId, { kind: kindOf(r), local, url: r.url });
    } else if (m.method === 'Network.loadingFinished') {
      inflight.delete(m.params.requestId);
      if (responses.has(m.params.requestId)) bytes[m.params.requestId] = m.params.encodedDataLength || 0;
    } else if (m.method === 'Network.loadingFailed') {
      inflight.delete(m.params.requestId);
      failed++;
    }
  });
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });  // 冷缓存口径，避免第二次跑偏小
  await send('Runtime.enable');
  const evl = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result ? r.result.value : undefined;
  };
  // LCP：必须在导航前注入，buffered 才能拿到首屏那次
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__perfBudget={lcp:0};try{new PerformanceObserver(function(l){
      l.getEntries().forEach(function(e){window.__perfBudget.lcp=e.startTime;});
    }).observe({type:'largest-contentful-paint',buffered:true});}catch(e){}`,
  });
  await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: VIEWPORT.dsf, mobile: false });
  await send('Page.navigate', { url: BASE + pg.path });
  for (let i = 0; i < 75; i++) {  // 等 load 事件
    if (await evl("document.readyState === 'complete'").catch(() => false)) break;
    await sleep(200);
  }
  await sleep(pg.settle);
  // 等网络安静（SPA/地图瓦片可能在 load 后才请求），避免统计截断
  const t0 = Date.now();
  let quietSince = 0;
  while (Date.now() - t0 < pg.quiet) {
    if (inflight.size === 0) { if (!quietSince) quietSince = Date.now(); if (Date.now() - quietSince > 700) break; }
    else quietSince = 0;
    await sleep(150);
  }
  const timings = await evl(`(() => {
    var n=(performance.getEntriesByType('navigation')||[])[0]||{};
    var f=(performance.getEntriesByName('first-contentful-paint')||[])[0]||{};
    return {dcl:Math.round(n.domContentLoadedEventEnd||0), load:Math.round(n.loadEventEnd||0),
      fcp:Math.round(f.startTime||0), lcp:Math.round((window.__perfBudget||{}).lcp||0)};
  })()`);
  await send('Target.closeTarget', { targetId }).catch(() => {});
  ws.close();

  const stats = {};
  TYPES.forEach(t => { stats[t] = { bytes: 0, requests: 0 }; });
  const local = { byType: {}, bytes: 0, requests: 0 };
  TYPES.forEach(t => { local.byType[t] = { bytes: 0, requests: 0 }; });
  for (const [rid, r] of responses) {
    if (!bytes[rid]) continue;
    stats[r.kind].bytes += bytes[rid];
    stats[r.kind].requests += 1;
    if (r.local) {
      local.byType[r.kind].bytes += bytes[rid];
      local.byType[r.kind].requests += 1;
      local.bytes += bytes[rid];
      local.requests += 1;
    }
  }
  const totals = { bytes: 0, requests: 0 };
  TYPES.forEach(t => { totals.bytes += stats[t].bytes; totals.requests += stats[t].requests; });
  const topRequests = [...responses].filter(([rid]) => bytes[rid])
    .map(([rid, r]) => ({ url: r.url, kind: r.kind, local: r.local, bytes: bytes[rid] }))
    .sort((a, b) => b.bytes - a.bytes).slice(0, 15);
  return { path: pg.path, stats, local, totals, timings, failed, topRequests,
    unmeasured: [...responses.keys()].filter(k => !bytes[k]).length };
}
function evaluateBudget(name, m) {
  if (name !== 'index') return null;
  const lc = m.local.byType;
  const jsCss = lc.css.bytes + lc.js.bytes, checks = [
    { key: 'jsCss', label: 'CSS+JS（本地）', actual: jsCss, limit: BUDGET.jsCssKB * 1024, unit: 'KB', pass: jsCss <= BUDGET.jsCssKB * 1024 },
    { key: 'image', label: '图片（本地）', actual: lc.image.bytes, limit: BUDGET.imageKB * 1024, unit: 'KB', pass: lc.image.bytes <= BUDGET.imageKB * 1024 },
    { key: 'requests', label: '请求数（本地）', actual: m.local.requests, limit: BUDGET.requests, unit: '', pass: m.local.requests <= BUDGET.requests },
    { key: 'lcp', label: 'LCP', actual: m.timings.lcp, limit: BUDGET.lcpMs, unit: 'ms', pass: m.timings.lcp > 0 && m.timings.lcp <= BUDGET.lcpMs },
  ];
  checks.forEach(c => { c.text = `${c.label} ${c.unit === 'KB' ? kb(c.actual) + 'KB ≤ ' + kb(c.limit) + 'KB' : c.actual + c.unit + ' ≤ ' + c.limit + c.unit}`; });
  return { pass: checks.every(c => c.pass), checks };
}
async function run() {
  await mkdir(OUT, { recursive: true });
  const pages = ONLY.length ? PAGES.filter(p => ONLY.includes(p.name)) : PAGES;
  const report = {
    base: BASE, capturedAt: new Date().toISOString(), viewport: VIEWPORT, budget: BUDGET,
    note: '本地 serve.mjs 与 GitHub Pages 同为 gzip 文本口径；预算只看本地资源，第三方瓦片/CDN 计入 3rd 列。',
    pages: {}, failures: [],
  };
  const pad = (s, n) => String(s).padEnd(n), num = (s, n) => String(s).padStart(n);
  const W = [8, 7, 7, 7, 7, 6, 8, 8, 8, 8, 9, 6, 6, 6];
  const line = cells => cells.map((c, i) => (i ? num(c, W[i]) : pad(c, W[i]))).join('');
  console.log('\n' + line(['page', 'doc', 'css', 'js', 'img', 'font', 'other', 'media', 'local', '3rd', 'req l/a', 'DCL', 'load', 'LCP']));
  console.log('单位 KB / ms；doc..media=各类传输量（含第三方），local=本地合计（含 media），3rd=第三方合计');
  for (const pg of pages) {
    const m = await measure(pg);
    m.budget = evaluateBudget(pg.name, m);
    report.pages[pg.name] = m;
    const s = m.stats, third = m.totals.bytes - m.local.bytes;
    console.log(line([pg.name, kb(s.document.bytes), kb(s.css.bytes), kb(s.js.bytes), kb(s.image.bytes),
      kb(s.font.bytes), kb(s.other.bytes), kb(s.media.bytes), kb(m.local.bytes), kb(third),
      `${m.local.requests}/${m.totals.requests}`, m.timings.dcl, m.timings.load, m.timings.lcp]));
    if (m.budget && !m.budget.pass) {
      m.budget.checks.filter(c => !c.pass).forEach(c => report.failures.push(`index: ${c.text}`));
    }
  }
  if (report.pages.index && report.pages.index.budget) {
    console.log('\n首页预算（--strict 判定）：');
    report.pages.index.budget.checks.forEach(c => console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.text}`));
  }
  const file = `${OUT.replace(/[\\/]$/, '')}/perf-report.json`;
  await writeFile(file, JSON.stringify(report, null, 1));
  console.log(`\n报告 → ${file}`);
  console.log(report.failures.length ? `PERF BUDGET FAIL（${report.failures.length} 项超预算）` : 'PERF BUDGET PASS');
  process.exit(STRICT && report.failures.length ? 1 : 0);
}
run().catch(e => { console.error('PERF ERROR', e.stack || e.message); process.exit(2); });
