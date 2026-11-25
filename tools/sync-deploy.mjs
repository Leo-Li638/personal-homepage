// tools/sync-deploy.mjs — 唯一发布通道：把 work 仓库的 master 同步到只读镜像 deploy 目录。
//
//   node tools/sync-deploy.mjs --dry     # 预演：只检查与比较，不联网、不改任何东西
//   node tools/sync-deploy.mjs           # 发布：校验 → push master → deploy pull --ff-only → 断言
//
// 不复制文件：deploy 是同一远端的 git clone，同步 = 让 deploy 快进到 master。
// 这样 CNAME / robots.txt / 产物哈希全部由 git 保证一致，不存在「漏拷一个文件」。
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY = process.env.HOMEPAGE_DEPLOY_DIR || 'E:\\developer-file\\dev\\GEO\\_homepage_deploy';
const DRY = process.argv.includes('--dry');
const EXPECT_CNAME = 'xn--4gq.chat';
// 发布红线：改了必须人工复核（sha256 记录在 .coordination/publish-baseline.json）
const RED_LINE = ['CNAME', 'robots.txt', 'sitemap.xml', 'llms.txt', '404.html', '_headers'];
const FORBIDDEN_TRACKED = [/^_bak_/, /^%SystemDrive%/, /\.log$/];

const run = (cwd, args, dryRun = false) => {
  const cmd = 'git ' + args.join(' ');
  if (dryRun) { console.log(`   [dry] ${cmd}`); return ''; }
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
};
const sha = f => existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null;
const step = t => console.log(`\n== ${t} ==`);
const die = m => { console.error('\n✗ ' + m); process.exit(1); };

step(`发布${DRY ? '预演' : ''}：${ROOT} → ${DEPLOY}`);

// 1) 工作区必须干净
const wStatus = run(ROOT, ['status', '--porcelain']);
if (wStatus) die(`work 工作区不干净，先提交或还原：\n${wStatus}`);
console.log('  ✓ work 工作区干净');

// 2) 必须在 master 上（integration 先并进来）
const branch = run(ROOT, ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'master') die(`当前分支是 ${branch}，发布只能在 master 上做（先把 integration 合并进来）`);
console.log('  ✓ 当前分支 master');

// 3) 产物必须与源码一致
try {
  execFileSync(process.execPath, [join(ROOT, 'tools', 'build.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  console.log('  ✓ G1 产物与 src/ 一致');
} catch (e) {
  die('产物过期，先运行 node tools/build.mjs\n' + (e.stdout || ''));
}

// 4) 红线文件：与上次发布基线比对
const baselineFile = join(ROOT, '.coordination', 'publish-baseline.json');
const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : null;
const redNow = Object.fromEntries(RED_LINE.map(f => [f, sha(join(ROOT, f))]));
if (baseline) {
  const changed = RED_LINE.filter(f => baseline[f] && baseline[f] !== redNow[f]);
  if (changed.length) {
    console.log(`  ⚠ 红线文件有变化：${changed.join(', ')}`);
    if (!process.argv.includes('--accept-red')) die('发布红线被改动。人工确认后加 --accept-red 重跑（或撤回改动）。');
    console.log('  ⚠ 已按 --accept-red 接受红线变化');
  } else {
    console.log('  ✓ G6 红线文件未变（CNAME/robots/sitemap/llms/404/_headers）');
  }
} else {
  console.log('  · 无发布基线，首次发布将写入 .coordination/publish-baseline.json');
}

// 5) 不许把垃圾提交进版本库
const tracked = run(ROOT, ['ls-files']).split('\n');
const junk = tracked.filter(f => FORBIDDEN_TRACKED.some(re => re.test(f)));
if (junk.length) die(`版本库里有不该发布的文件（先 git rm --cached）：\n  ${junk.slice(0, 10).join('\n  ')}`);
console.log('  ✓ 无 _bak_* / %SystemDrive% / *.log 被跟踪');

// 6) CNAME 断言
const cname = existsSync(join(ROOT, 'CNAME')) ? readFileSync(join(ROOT, 'CNAME'), 'utf8').trim() : '';
if (cname !== EXPECT_CNAME) die(`CNAME 内容异常：${JSON.stringify(cname)}（应为 ${EXPECT_CNAME}）`);
console.log(`  ✓ CNAME = ${cname}`);

// 7) 推 master
const localHead = run(ROOT, ['rev-parse', 'HEAD']);
const remoteHead = run(ROOT, ['rev-parse', 'origin/master']);
if (localHead !== remoteHead) {
  console.log(`  · master 领先远端 ${run(ROOT, ['rev-list', '--count', 'origin/master..HEAD'])} 个提交`);
  run(ROOT, ['push', 'origin', 'master'], DRY);
} else {
  console.log('  ✓ origin/master 已是最新');
}

// 8) deploy 目录快进
if (!existsSync(join(DEPLOY, '.git'))) die(`deploy 目录不是 git 仓库：${DEPLOY}`);
const dStatus = run(DEPLOY, ['status', '--porcelain']);
if (dStatus) die(`deploy 目录有未提交改动（只读镜像禁止手改！先备份后还原）：\n${dStatus}`);
console.log('  ✓ deploy 工作区干净');
run(DEPLOY, ['pull', '--ff-only'], DRY);

if (!DRY) {
  const dHead = run(DEPLOY, ['rev-parse', 'HEAD']);
  const wHead = run(ROOT, ['rev-parse', 'HEAD']);
  if (dHead !== wHead) die(`deploy HEAD=${dHead} 与 work HEAD=${wHead} 不一致`);
  const dCname = readFileSync(join(DEPLOY, 'CNAME'), 'utf8').trim();
  if (dCname !== EXPECT_CNAME) die(`deploy 的 CNAME 异常：${dCname}`);
  const diffs = ['index.html', 'tech.html', 'leisure.html', 'assets/site-data.js', 'assets/city-map.js']
    .filter(f => sha(join(ROOT, f)) !== sha(join(DEPLOY, f)));
  if (diffs.length) die(`以下文件两侧哈希不一致：${diffs.join(', ')}`);
  console.log(`\n✓ 已发布：deploy 与 master 完全一致（HEAD ${wHead.slice(0, 7)}），CNAME=${dCname}`);
  if (!baseline || RED_LINE.some(f => baseline[f] !== redNow[f])) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(ROOT, '.coordination'), { recursive: true });
    writeFileSync(baselineFile, JSON.stringify(redNow, null, 1), 'utf8');
    console.log('  · 已更新发布基线 .coordination/publish-baseline.json');
  }
} else {
  console.log('\n（预演结束：加 --dry 以外的参数即为真正发布）');
}
