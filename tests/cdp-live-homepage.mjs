// 线上核验：xn--4gq.chat 首页第 5 张卡 + turbocore 详情页
import { writeFile } from 'node:fs/promises';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const OUT = 'E:/developer-file/dev/DeepseekHarness/work/homepage/tests/shots/';

async function connect() {
  const v = await (await fetch('http://127.0.0.1:9333/json/version')).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = []; const bad = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) bad.push(m.params.response.status + ' ' + m.params.response.url.split('/').pop());
  };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}, sessionId) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const t = await send('Target.createTarget', { url: 'about:blank' });
  const targetId = t.result.targetId;
  const at = await send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = at.result.sessionId;
  const S = (m, p) => send(m, p, sessionId);
  const evl = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  return { S, evl, errors, bad, targetId, ws };
}

const c = await connect();
await c.S('Page.navigate', { url: 'https://xn--4gq.chat/' });
await sleep(4500);
await c.evl('(function(){var b=document.querySelector("#sp-enter"); if(b) b.click(); return !!b;})()');
await sleep(2500);
const cardExpr = 'JSON.stringify(Array.prototype.map.call(document.querySelectorAll("#ssec3 .proj"), function(a){var c=a.querySelector(".proj-cover"); return { name: c ? c.textContent.trim().slice(0,40) : null, href: a.getAttribute("href") };}))';
console.log('LIVE home cards:', await c.evl(cardExpr));
await c.evl('document.querySelector("#ssec3").scrollIntoView()');
await sleep(1200);
const shot1 = await c.S('Page.captureScreenshot', { format: 'png' });
await writeFile(OUT + 'live_home_cards.png', Buffer.from(shot1.result.data, 'base64'));
const nav = await c.evl('(function(){var a=document.querySelectorAll("#ssec3 .proj")[4]; if(!a) return "no-card"; a.click(); return "clicked";})()');
console.log('click card5:', nav);
await sleep(4500);
console.log('URL:', await c.evl('location.href'), '| title:', await c.evl('document.title'));
console.log('images:', await c.evl('JSON.stringify(Array.prototype.map.call(document.images, function(i){return { src: i.currentSrc.split("/").pop(), w: i.naturalWidth };}))'));
console.log('pager:', await c.evl('JSON.stringify(Array.prototype.map.call(document.querySelectorAll(".pager a"), function(a){return { href: a.getAttribute("href"), t: a.textContent.trim().slice(0,40) };}))'));
console.log('hero buttons:', await c.evl('JSON.stringify(Array.prototype.map.call(document.querySelectorAll(".hero-actions a"), function(a){return { href: a.getAttribute("href"), t: a.textContent.trim() };}))'));
const shot2 = await c.S('Page.captureScreenshot', { format: 'png' });
await writeFile(OUT + 'live_turbocore_page.png', Buffer.from(shot2.result.data, 'base64'));
await c.evl('document.querySelector("#shots").scrollIntoView()');
await sleep(1500);
const shot3 = await c.S('Page.captureScreenshot', { format: 'png' });
await writeFile(OUT + 'live_turbocore_shots.png', Buffer.from(shot3.result.data, 'base64'));
console.log('consoleErrors:', JSON.stringify(c.errors.slice(0, 5)));
console.log('badResponses:', JSON.stringify(c.bad.slice(0, 5)));
await c.S('Target.closeTarget', { targetId: c.targetId });
c.ws.close();