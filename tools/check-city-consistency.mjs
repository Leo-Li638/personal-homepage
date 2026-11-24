#!/usr/bin/env node
/**
 * 城市数据一致性校验
 * 单一数据源：assets/site-data.js 的 SITE_DATA.cities
 * 必须与以下三处保持一致：
 *   1) index.html  JSON-LD ProfessionalService.areaServed
 *   2) llms.txt    「服务城市（可约当面）」那一行
 *   3) tech.html / leisure.html 通过 SITE_DATA.cityLine() 渲染（无需硬编码，仅校验引用存在）
 * 用法：node tools/check-city-consistency.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const errors = [];
const ok = [];

// 1) 读 SITE_DATA（在沙箱里执行，window 兜底）
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(read('assets/site-data.js'), ctx);
const SD = ctx.window.SITE_DATA;
if (!SD) errors.push('assets/site-data.js 未定义 window.SITE_DATA');
const cities = (SD?.cities || []).map((c) => c.zh);
if (cities.length === 0) errors.push('SITE_DATA.cities 为空');
if (!SD?.futureCity || SD.futureCity.status !== 'coming-soon') errors.push('SITE_DATA.futureCity.status 必须为 coming-soon');
ok.push('SITE_DATA.cities = ' + cities.join(' / '));

// 2) index.html JSON-LD areaServed
const index = read('index.html');
const blocks = [...index.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let area = null;
for (const b of blocks) {
  let json;
  try { json = JSON.parse(b); } catch (e) { errors.push('index JSON-LD 解析失败：' + e.message); continue; }
  const nodes = json['@graph'] || [json];
  for (const n of nodes) {
    if (n['@type'] === 'ProfessionalService' && Array.isArray(n.areaServed)) {
      area = n.areaServed.map((c) => (typeof c === 'string' ? c : c.name));
    }
  }
}
if (!area) errors.push('index.html 未找到 ProfessionalService.areaServed');
else {
  const diff = [...cities].sort().join(',') !== [...area].sort().join(',');
  if (diff) errors.push('areaServed 与 SITE_DATA 不一致：' + area.join(',') + ' ≠ ' + cities.join(','));
  else ok.push('index.html areaServed = ' + area.join(' / '));
}

// 3) llms.txt 城市行
const llms = read('llms.txt');
const line = (llms.match(/^- 服务城市（可约当面）[:：].*$/m) || [])[0] || '';
if (!line) errors.push('llms.txt 缺少「服务城市（可约当面）」行');
else {
  const missing = cities.filter((c) => !line.includes(c));
  if (missing.length) errors.push('llms.txt 城市行缺少：' + missing.join(','));
  else ok.push('llms.txt 城市行包含全部 ' + cities.length + ' 个城市');
}

// 4) tech/leisure 通过 SITE_DATA 渲染（不得硬编码城市名）
for (const page of ['tech.html', 'leisure.html']) {
  const s = read(page);
  if (!/assets\/site-data\.js/.test(s)) errors.push(page + ' 未引入 assets/site-data.js');
  if (!/cityLine\(/.test(s)) errors.push(page + ' 未调用 SITE_DATA.cityLine()');
}

console.log('\n城市数据一致性校验（源：assets/site-data.js）');
ok.forEach((s) => console.log('  ✓ ' + s));
if (errors.length) {
  errors.forEach((e) => console.log('  ✗ ' + e));
  console.log('\n失败：' + errors.length + ' 项');
  process.exit(1);
}
console.log('\n全部通过。');
