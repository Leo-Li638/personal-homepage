// tools/lock.mjs — 文件级写锁，避免两个 Agent 同时改同一文件。
//
//   node tools/lock.mjs claim assets/js/main.js --agent b --branch task/b-map --ttl 45
//   node tools/lock.mjs list
//   node tools/lock.mjs release assets/js/main.js --agent b
//   node tools/lock.mjs check assets/css/base.css        # 退出码 0=可写 2=被别人占着
//
// 锁目录 .coordination/locks/（不入库）。TTL 到期自动失效，避免 Agent 崩溃留下死锁。
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.coordination', 'locks');
const SHARED = [
  'tools/', 'src/pages/', 'assets/js/main.js', 'assets/css/base.css', 'AGENTS.md',
  '.gitignore', 'CNAME', 'robots.txt', 'sitemap.xml', 'llms.txt', '404.html', '_headers',
];

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const target = (argv[1] && !argv[1].startsWith('--')) ? argv[1].replace(/\\/g, '/') : null;
const agent = opt('agent', process.env.DSH_AGENT_NAME || 'lead');
const branch = opt('branch', '');
const ttl = Number(opt('ttl', '60'));

const slug = p => p.replace(/[/\\.]/g, '-');
const now = () => Date.now();

function readLock(p) {
  const f = join(DIR, slug(p) + '.json');
  if (!existsSync(f)) return null;
  try { return { file: f, data: JSON.parse(readFileSync(f, 'utf8')) }; } catch { return null; }
}
function alive(l) { return l && now() < l.data.ts + l.data.ttlMin * 60000; }
function isShared(p) { return SHARED.some(s => (s.endsWith('/') ? p.startsWith(s) : p === s)); }

function claim(p) {
  if (!p) bad('claim 需要文件路径，例如 node tools/lock.mjs claim assets/js/main.js --agent b');
  mkdirSync(DIR, { recursive: true });
  const cur = readLock(p);
  if (alive(cur) && cur.data.agent !== agent) {
    const left = Math.ceil((cur.data.ts + cur.data.ttlMin * 60000 - now()) / 60000);
    console.error(`✗ ${p} 被 ${cur.data.agent}（${cur.data.branch || '?'}）占用，剩余 ${left} 分钟。`);
    console.error('  先协调或等 TTL 过期；不许强抢。');
    process.exit(2);
  }
  const shared = isShared(p);
  const data = { path: p, agent, branch, ts: now(), ttlMin: ttl, shared };
  writeFileSync(join(DIR, slug(p) + '.json'), JSON.stringify(data, null, 1), 'utf8');
  console.log(`✓ 已获取锁：${p}  holder=${agent} ttl=${ttl}min${shared ? '  ⚠ 共享文件，需 lead 放行' : ''}`);
}

function release(p) {
  const l = readLock(p);
  if (!l) return console.log(`= ${p} 没有锁`);
  if (l.data.agent !== agent) {
    console.error(`✗ ${p} 的锁属于 ${l.data.agent}，${agent} 不能释放`);
    process.exit(2);
  }
  rmSync(l.file, { force: true });
  console.log(`✓ 已释放：${p}`);
}

function list() {
  if (!existsSync(DIR)) return console.log('（无锁）');
  const files = readdirSync(DIR).filter(f => f.endsWith('.json'));
  if (!files.length) return console.log('（无锁）');
  const rows = files.map(f => {
    const d = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    const alive_ = now() < d.ts + d.ttlMin * 60000;
    const left = Math.ceil((d.ts + d.ttlMin * 60000 - now()) / 60000);
    return { path: d.path, agent: d.agent, branch: d.branch || '-', state: alive_ ? `持有 ${left}min` : '已过期', shared: d.shared ? 'yes' : '' };
  });
  console.table(rows);
  const expired = rows.filter(r => r.state === '已过期').length;
  if (expired) console.log(`提示：${expired} 个锁已过期，可被直接 claim 覆盖。`);
}

function check(p) {
  const l = readLock(p);
  if (alive(l) && l.data.agent !== agent) {
    console.error(`✗ ${p} 被 ${l.data.agent} 占用`);
    process.exit(2);
  }
  console.log(`✓ ${p} 可写（${agent}）`);
}

function bad(m) { console.error(m); process.exit(1); }

if (cmd === 'claim') claim(target);
else if (cmd === 'release') release(target);
else if (cmd === 'list') list();
else if (cmd === 'check') check(target);
else console.log('用法: node tools/lock.mjs <claim|release|list|check> [path] [--agent a] [--branch x] [--ttl 45]');
