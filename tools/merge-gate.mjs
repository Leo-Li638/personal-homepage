// tools/merge-gate.mjs — 合并闸门总线：一次跑完 G1–G4 + G6，打印一张表，全绿才算可合并。
//
//   node tools/merge-gate.mjs                     # 自动起本地服（8098）并跑冒烟
//   node tools/merge-gate.mjs --base http://127.0.0.1:8099   # 已有服时复用
//   node tools/merge-gate.mjs --agent a           # 指定 agent（默认从 task/<x>- 分支名推断）
//   node tools/merge-gate.mjs --skip smoke        # 跳过某一项（可多次，逗号分隔）
//
// 对应 AGENTS.md §7：G1 产物一致 / G2 城市数据 / G3 所有权 / G4 冒烟 / G6 发布红线。
// G5（视觉）需要人眼或 diff 工具比截图，脚本只负责把新截图的路径列出来。
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const skip = new Set((opt('skip', '') || '').split(',').map(s => s.trim()).filter(Boolean));
const PORT = opt('port', '8098');
const BASE = (opt('base', '') || '').replace(/\/$/, '');
const CDP = (opt('cdp', 'http://127.0.0.1:9333')).replace(/\/$/, '');
const AGENT = opt('agent', '');

const REDLINE = ['CNAME', 'robots.txt', 'sitemap.xml', 'llms.txt', '404.html', '_headers'];
const BASELINE = join(ROOT, '.coordination', 'publish-baseline.json');

const results = [];
const run = (name, cmd, args, opts = {}) => {
  const t0 = Date.now();
  let out = '', code = 0;
  try {
    out = execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, ...opts });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    code = e.status ?? 1;
  }
  results.push({ name, code, ms: Date.now() - t0, out });
  return code === 0;
};
const node = (name, script, extra = []) => run(name, process.execPath, [join(ROOT, 'tools', script), ...extra]);

const sha = f => createHash('sha256').update(readFileSync(join(ROOT, f))).digest('hex');

async function main() {
  console.log('G1 产物一致 …');
  if (!skip.has('g1')) node('G1 build --check', 'build.mjs', ['--check']);

  console.log('G2 城市数据 …');
  if (!skip.has('g2')) node('G2 city-consistency', 'check-city-consistency.mjs');

  console.log('G3 所有权 …');
  if (!skip.has('g3')) node('G3 ownership', 'check-ownership.mjs', AGENT ? ['--agent', AGENT, '--base', 'integration'] : ['--base', 'integration']);

  console.log('G4 浏览器冒烟 …');
  let server = null, base = BASE;
  if (!skip.has('g4')) {
    if (!base) {
      base = 'http://127.0.0.1:' + PORT;
      server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs'), ROOT, PORT], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
      await new Promise(r => setTimeout(r, 700));
    }
    node('G4 smoke --strict', 'smoke.mjs', ['--base', base, '--cdp', CDP, '--strict']);
  }
  if (server) server.kill();

  console.log('G6 发布红线 …');
  if (!skip.has('g6')) {
    const problems = [];
    if (existsSync(BASELINE)) {
      const base0 = JSON.parse(readFileSync(BASELINE, 'utf8'));
      for (const f of REDLINE) {
        if (!existsSync(join(ROOT, f))) { problems.push(`${f} 缺失`); continue; }
        const want = base0[f];
        if (!want) { problems.push(`${f} 未进入基线（首次运行请用 --accept-red 或手动补基线）`); continue; }
        const got = sha(f);
        if (got !== want) problems.push(`${f} 内容变了（${got.slice(0, 12)} ≠ ${want.slice(0, 12)}）`);
      }
      const cname = existsSync(join(ROOT, 'CNAME')) ? readFileSync(join(ROOT, 'CNAME'), 'utf8').trim() : '';
      if (cname !== 'xn--4gq.chat') problems.push(`CNAME = "${cname}"（应为 xn--4gq.chat）`);
    } else {
      problems.push('缺少 .coordination/publish-baseline.json（G6 无法比对，先跑 sync-deploy --dry 生成基线）');
    }
    results.push({ name: 'G6 redline', code: problems.length ? 1 : 0, ms: 0, out: problems.join('\n') });
  }

  // 汇总
  console.log('\n================ 合并闸门 ================');
  for (const r of results) {
    const bad = r.code !== 0;
    console.log(`${bad ? '✗' : '✓'} ${r.name.padEnd(18)} ${String(r.ms + 'ms').padStart(7)}`);
    if (bad) console.log(r.out.split('\n').filter(Boolean).slice(-14).map(l => '    ' + l).join('\n'));
  }
  const shots = existsSync(join(ROOT, 'tests', 'shots'))
    ? readdirSync(join(ROOT, 'tests', 'shots')).filter(f => f.endsWith('.png')).sort()
    : [];
  if (shots.length) {
    console.log(`\nG5 视觉证据（人工比对基线 ..\\_baseline_20261125\\）：tests/shots/ 共 ${shots.length} 张`);
    for (const f of shots) console.log(`    tests/shots/${f}  ${(statSync(join(ROOT, 'tests', 'shots', f)).size / 1024).toFixed(0)}KB`);
  }
  const failed = results.filter(r => r.code !== 0);
  console.log(failed.length ? `\nGATE FAIL：${failed.map(f => f.name).join(' / ')}` : '\nGATE PASS（全部闸门通过）');
  process.exit(failed.length ? 1 : 0);
}

main();
