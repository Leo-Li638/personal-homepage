// tools/check-ownership.mjs — G3 闸门：检查本次改动是否越权（对照 AGENTS.md §2 所有权表）。
//
//   node tools/check-ownership.mjs                  # 自动从分支名判断 agent
//   node tools/check-ownership.mjs --agent b --base integration
//   node tools/check-ownership.mjs --files a.html,b.css      # 手工指定文件（CI 预演）
//
// 退出码：0 合规，1 越权。
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const glob2re = g => new RegExp('^' + g
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*/g, '\u0000')
  .replace(/\*/g, '[^/]*')
  .replace(/\u0000/g, '.*') + '$');

// 与 AGENTS.md §2 一一对应
const OWNERS = {
  lead: ['**'],
  a: [
    'src/partials/header.html',
    'src/partials/hero.html',
    'src/partials/cities.html',
    'src/partials/why.html',
    'src/partials/articles.html',
    'src/partials/about.html',
    'src/partials/footer.html',
    'src/partials/noscript.html',
    'src/partials/dance-modal.html',
    'assets/css/layout.css',
    'assets/css/components.css',
    'assets/css/mascot.css',
    'assets/js/npc.js',
    'tests/shots/**',
  ],
  b: [
    'assets/site-data.js',
    'assets/js/cities.js',
    'assets/js/map.js',
    'assets/city-map.js',
    'assets/leaflet/**',
    'assets/css/map.css',
  ],
  c: [
    'assets/js/perf.js',
    'assets/**/*.avif',
    'assets/**/*.jpg',
    'assets/**/*.jpeg',
    'assets/**/*.png',
    'assets/**/*.webp',
    'assets/**/*.mp4',
    'assets/**/*.woff2',
    'assets/*.avif',
    'assets/*.jpg',
    'assets/*.jpeg',
    'assets/*.png',
    'assets/*.webp',
    'assets/*.mp4',
    'assets/*.woff2',
    'tools/optimize-assets.mjs',
    'tools/perf-budget.mjs',
    'tools/serve.mjs',
    '_bak_*/**',
    '_shot*',
    '_npc_*',
  ],
};

// 任何非 lead 都不许碰（产物 / 发布红线 / 构建设施）。
// 例外：若某文件同时出现在该 agent 的 OWNERS 白名单里（如 C 被授权的 tools/serve.mjs），则以白名单为准。
const FORBIDDEN_NON_LEAD = [
  'index.html', 'tech.html', 'leisure.html', 'CNAME', 'robots.txt', 'sitemap.xml', 'llms.txt',
  '404.html', '_headers', 'src/pages/*', 'assets/js/main.js', 'assets/css/base.css',
  'AGENTS.md', 'package.json',
];

function sh(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function changedFiles(base) {
  const files = new Set();
  const add = s => s.split('\n').map(x => x.trim()).filter(Boolean).forEach(x => files.add(x.replace(/\\/g, '/')));
  try { add(sh(['diff', '--name-only', base])); } catch { /* base 不存在时忽略 */ }
  try { add(sh(['status', '--porcelain']).split('\n').map(l => l.slice(3)).join('\n')); } catch { /* 无 git */ }
  return [...files].filter(f => !f.startsWith('.coordination/') && !f.startsWith('tests/shots/'));
}

function agentFromBranch() {
  try {
    const b = sh(['rev-parse', '--abbrev-ref', 'HEAD']);
    const m = /^task\/([a-z])-/.exec(b);
    return m ? m[1] : 'lead';
  } catch { return 'lead'; }
}

const agent = opt('agent', agentFromBranch());
const base = opt('base', 'integration');
const manual = (opt('files', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const files = manual.length ? manual : changedFiles(base);

if (!OWNERS[agent]) {
  console.error(`✗ 未知 agent：${agent}（可选 ${Object.keys(OWNERS).join('/')}）`);
  process.exit(1);
}

const allowed = OWNERS[agent].map(glob2re);
const forbidden = agent === 'lead' ? [] : FORBIDDEN_NON_LEAD.map(glob2re);

console.log(`G3 所有权检查 · agent=${agent} base=${base} · ${files.length} 个改动文件`);
const violations = [];
const warnings = [];

for (const f of files) {
  const ok = allowed.some(re => re.test(f));
  if (!ok && forbidden.some(re => re.test(f))) {
    violations.push(`${f} — 禁止非 lead 修改（产物/发布红线/构建设施）`);
    continue;
  }
  if (!ok) {
    violations.push(`${f} — 不在 ${agent} 的 Owner 范围内`);
  }
}

// 改了 site-data 的城市就必须同步 llms.txt（由 G2 兜底，这里只提醒）
if (files.includes('assets/site-data.js')) {
  warnings.push('改了 assets/site-data.js：记得同步 llms.txt / sitemap.xml，并跑 node tools/check-city-consistency.mjs');
}
if (files.some(f => f.startsWith('src/partials/') || f.startsWith('src/pages/'))) {
  warnings.push('改了 src/：提交前必须 node tools/build.mjs --check 通过；index.html 由 lead 在合并后统一重新生成，分支里不要提交产物（git restore index.html）');
}

if (violations.length) {
  console.error(`\n✗ 越权改动 ${violations.length} 处：`);
  violations.forEach(v => console.error('   - ' + v));
  console.error('\n修正方式：撤回这些改动，或让对应 Owner 提交（见 AGENTS.md §6.2 共享文件清单）。');
  process.exit(1);
}

if (warnings.length) {
  console.log('');
  warnings.forEach(w => console.log('  ⚠ ' + w));
}
console.log(`\n✓ G3 通过：${files.length} 个文件全部在 ${agent} 的权责范围内`);
