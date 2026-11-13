import { writeFile, mkdir } from 'node:fs/promises';
const SHOTS = 'E:\\developer-file\\dev\\DeepseekHarness\\work\\homepage\\tests\\shots';
const BASE = 'http://127.0.0.1:8099';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  await mkdir(SHOTS, { recursive: true });
  const version = await (await fetch('http://127.0.0.1:9333/json/version')).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const consoleErrors = [], exceptions = [], badResponses = [], netFailures = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) {
      consoleErrors.push(m.params.args.map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 400));
    } else if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push(String(m.params.exceptionDetails.text) + ' ' + String(m.params.exceptionDetails.exception?.description || '').slice(0, 400));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      consoleErrors.push('[log] ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    } else if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.status >= 400) badResponses.push(r.status + ' ' + r.url);
    } else if (m.method === 'Network.loadingFailed') {
      netFailures.push((m.params.errorText || '') + ' ' + (m.params.type || ''));
    }
  };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}, sessionId) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const evl = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  const waitReady = async (ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await evl('document.readyState') === 'complete') return true; await sleep(200); }
    return false;
  };
  const poll = async (expr, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await evl(expr)) return true; } catch (e) {} await sleep(250); }
    return false;
  };
  const shotFull = async (name) => {
    const { result: { data } } = await S('Page.captureScreenshot', { format: 'png' });
    await writeFile(SHOTS + '\\' + name + '.png', Buffer.from(data, 'base64'));
  };
  const shotEl = async (name, sel) => {
    const r = await evl(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; })()`);
    if (!r) throw new Error('element not found: ' + sel);
    const { result: { data } } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } });
    await writeFile(SHOTS + '\\' + name + '.png', Buffer.from(data, 'base64'));
    return r;
  };
  const openIndex = async () => {
    await S('Page.navigate', { url: BASE + '/index.html' });
    await waitReady();
    await evl("(() => { localStorage.setItem('lang','zh'); sessionStorage.clear(); return true; })()");
    await S('Page.navigate', { url: BASE + '/index.html' });
    await waitReady();
    await poll("!!document.getElementById('sp-enter')");
    await evl("(() => { const b = document.getElementById('sp-enter'); if (b) b.click(); return true; })()");
    const ok = await poll("!!document.getElementById('ssec3') && document.querySelectorAll('#ssec3 .proj').length >= 6", 25000);
    await sleep(1500);
    return ok;
  };

  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable'); await S('Log.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  const report = {};

  // ---------- 1) 首页：中文项目区 ----------
  report.indexRendered = await openIndex();
  await evl("document.getElementById('ssec3').scrollIntoView({block:'start'})");
  await sleep(1600);
  report.cardTotal = await evl("document.querySelectorAll('#ssec3 .proj').length");
  report.cardNames = await evl("[...document.querySelectorAll('#ssec3 .proj')].map(a => a.querySelector('.proj-cover').textContent.trim())");
  report.cardHrefs = await evl("[...document.querySelectorAll('#ssec3 .proj')].map(a => a.getAttribute('href'))");
  report.turboCoverBg = await evl("(() => { const el = document.querySelector('#ssec3 .proj-cover.pc-turbo'); return el ? getComputedStyle(el).backgroundImage : null; })()");
  report.indexClip = await shotEl('01-index-projects-zh', '#ssec3');
  await shotFull('02-index-projects-zh-viewport');

  // ---------- 2) 首页：英文模式（走站点自己的 #langBtn 切换） ----------
  await evl("document.getElementById('langBtn').click()");
  const enOk = await poll("(() => { const els = document.querySelectorAll('#ssec3 .proj'); return els.length === 6 && els[4].querySelector('.proj-cover').textContent.indexOf('Turbofan') >= 0; })()", 15000);
  await sleep(1200);
  await evl("document.getElementById('ssec3').scrollIntoView({block:'start'})");
  await sleep(1400);
  report.enRendered = enOk;
  report.langStored = await evl("localStorage.getItem('lang')");
  report.enCards = await evl("[...document.querySelectorAll('#ssec3 .proj')].map(a => a.querySelector('.proj-cover').textContent.trim())");
  report.enSectTitle = await evl("document.querySelector('#ssec3 .sec-title').textContent.trim()");
  report.enClip = await shotEl('03-index-projects-en', '#ssec3');

  // ---------- 3) turbocore.html ----------
  await S('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await S('Page.navigate', { url: BASE + '/turbocore.html' });
  await waitReady();
  await sleep(900);
  report.tcTitle = await evl('document.title');
  await shotFull('04-turbocore-hero');
  await evl("window.scrollTo(0, document.body.scrollHeight)");
  await sleep(1800);
  await evl("window.scrollTo(0, 0)");
  await sleep(800);
  report.tcImages = await evl("[...document.images].map(i => ({ src: i.getAttribute('src'), nw: i.naturalWidth, nh: i.naturalHeight }))");
  report.tcOverflow = await evl("({ scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth })");
  report.tcLinks = await evl("(() => { const hero = document.querySelector('.hero-actions a'); return { heroHref: hero ? hero.getAttribute('href') : null, demo: [...document.querySelectorAll('a[href*=\"leo-li638.github.io\"]')].map(a => a.href), github: [...document.querySelectorAll('a[href*=\"github.com/Leo-Li638\"]')].map(a => a.href) }; })()");
  report.tcPager = await evl("(() => { const p = document.querySelector('.pager'); if (!p) return null; const cs = getComputedStyle(p); return { display: cs.display, links: [...p.querySelectorAll('a')].map(a => (a.getAttribute('href')||'') + ' | ' + a.innerText.replace(/\\s+/g,' ').trim()) }; })()");
  report.tcShotsSection = await shotEl('05-turbocore-shots', '#shots');
  await shotEl('06-turbocore-first-image', '#shots .project-image');
  const fm = await S('Page.getLayoutMetrics');
  const content = fm.result.cssContentSize;
  const { result: { data: fullData } } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: content.width, height: content.height, scale: 1 } });
  await writeFile(SHOTS + '\\07-turbocore-full.png', Buffer.from(fullData, 'base64'));
  report.tcFullSize = { w: content.width, h: content.height };

  // ---------- 4) turbocore.html 移动端 390 ----------
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await S('Page.navigate', { url: BASE + '/turbocore.html' });
  await waitReady();
  await sleep(900);
  report.mobileOverflow = await evl("({ scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth })");
  report.mobilePagerDisplay = await evl("(() => { const p = document.querySelector('.pager'); return p ? getComputedStyle(p).gridTemplateColumns : null; })()");
  await shotFull('08-turbocore-mobile-390');
  await evl("document.getElementById('shots').scrollIntoView({block:'start'})");
  await sleep(900);
  await shotFull('09-turbocore-mobile-shots');

  report.consoleErrors = consoleErrors;
  report.exceptions = exceptions;
  report.badResponses = badResponses;
  report.netFailures = netFailures.slice(0, 12);

  // ---------- 断言汇总 ----------
  const imgsOk = Array.isArray(report.tcImages) && report.tcImages.length === 6 && report.tcImages.every(i => i.nw > 0);
  const fiveCards = report.cardNames && report.cardNames.length === 6 && report.cardNames[4].indexOf('TURBOCORE') >= 0;
  report.assertions = {
    'index 渲染成功': report.indexRendered === true,
    '中文项目区 6 张卡（5 项目 + 更多作品）': fiveCards,
    '第 05 张卡 href=turbocore.html': report.cardHrefs && report.cardHrefs[4] === 'turbocore.html',
    'pc-turbo 主题色已生效': typeof report.turboCoverBg === 'string' && report.turboCoverBg.includes('gradient'),
    '英文模式第 05 张卡 = Turbofan 3D Exploded View': report.enRendered === true && report.langStored === 'en',
    'turbocore 6 张图片全部加载(naturalWidth>0)': !!imgsOk,
    'turbocore 桌面无横向溢出': report.tcOverflow && report.tcOverflow.scrollWidth <= report.tcOverflow.innerWidth,
    'turbocore 移动端 390 无横向溢出': report.mobileOverflow && report.mobileOverflow.scrollWidth <= report.mobileOverflow.innerWidth,
    '前后项目导航(.pager)已生效': report.tcPager && report.tcPager.display === 'grid' && report.tcPager.links.length === 2,
    'hero 在线体验按钮指向演示页': report.tcLinks && report.tcLinks.heroHref === 'https://leo-li638.github.io/turbocore-engine/',
    '侧栏含源码仓库链接': report.tcLinks && report.tcLinks.github.length >= 2,
    'console 无 error': consoleErrors.length === 0,
    '无未捕获异常': exceptions.length === 0,
    '无 4xx/5xx 响应': badResponses.length === 0
  };
  console.log('REPORT ' + JSON.stringify(report, null, 1));
  await send('Target.closeTarget', { targetId });
  ws.close();
}
main().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
