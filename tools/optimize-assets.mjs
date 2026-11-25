#!/usr/bin/env node
/* tools/optimize-assets.mjs — 可复现的静态资源近无损压缩（ffmpeg，无 sharp/ImageMagick 依赖）
 *
 * 做什么：扫描 assets/ 下 >--min KB 的 jpg / png / webp，按文件名的既定策略重编码，
 *         与原文件比体积（要求 ≤80%）且校验宽高不变，达标才同名替换；替换前自动备份。
 *         对 avif / mp4 / glb 自动跳过（已是压缩格式 / 按需加载的视频 / 三维模型）。
 *
 * 用法：
 *   node tools/optimize-assets.mjs --dry              # 只计算并打印前后体积表，不动 assets
 *   node tools/optimize-assets.mjs                    # 执行：备份 + 替换 + 打印表格
 *   node tools/optimize-assets.mjs --backup D:\bak    # 指定备份目录（默认 ..\_bak_assets_<日期>）
 *   node tools/optimize-assets.mjs --min 100 --dir assets
 *
 * 策略表（与 2026-11-25 的 C 角色压缩结果一一对应，改策略就在这里改）：
 *   jpg  -q:v 4~7 + 原色度采样；og-cover 额外限制 ≤120KB
 *   webp -quality 60（原 305KB → 78%）
 *   png  -8 色调色板 + 无抖动（PNG 唯一可行手段；带 alpha 的会丢透明，见下方 SKIP）
 *
 * 说明：任务要求 >150KB，但 turbocore-0*.jpg / deep-space-*.jpg 也被点名关注，
 *       因此默认阈值取 100KB 一并评估；avif/mp4/glb 永远跳过。
 *       npc_maid.png 是带 alpha 的立绘，ffmpeg 调色板会丢通明通道，故显式跳过。
 */
import { readdirSync, statSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const DRY = argv.includes('--dry');
const ROOT = resolve('.');
const DIR = resolve(flag('dir', 'assets'));
const MIN_KB = Number(flag('min', 100));
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const BACKUP = resolve(flag('backup', join(ROOT, '..', `_bak_assets_${STAMP}`)));

/* 文件名 → 编码策略；未列出的走默认值 */
const JPG_Q = {
  'mondstadt-hero.jpg': 4,
  'npc_raw.jpg': 5,
  'og-cover.jpg': 7,
  'deep-space-chart.jpg': 7,
  'deep-space-meteor.jpg': 4,
};
const JPG_PIX = { 'deep-space-chart.jpg': 'yuvj444p' };
const WEBP_Q = { 'mondstadt-hero.webp': 60 };
// 当前 assets 下无 >100KB 的 PNG；如再出现，默认 256 色调色板 + 无抖动
const PNG_RULE = {};
/* 明确跳过 + 原因（会打印到表格里，报告直接引用） */
const SKIP = {
  'npc_maid.png': 'rgba 立绘，调色板化会丢 alpha（ffmpeg 限制），保持无损',
  'npc_dance_web.mp4': '按需加载的舞蹈视频，任务约定不动',
};
const MAX_RATIO = 0.8; // 至少省 20%
const OG_CAP = 120 * 1024;
/* 小于阈值但被任务点名、确有收益的文件：强制纳入扫描 */
const ALWAYS = new Set(['deep-space-meteor.jpg']);

function ff(args) {
  return execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'buffer' });
}
function probe(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ]).toString().trim();
  const [w, h] = out.split(',').map(Number);
  return { w, h };
}
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
function encode(src, dst, ext) {
  const name = basename(src);
  if (ext === '.jpg' || ext === '.jpeg') {
    ff(['-i', src, '-q:v', String(JPG_Q[name] || 5), '-pix_fmt', JPG_PIX[name] || 'yuvj420p', dst]);
  } else if (ext === '.webp') {
    ff(['-i', src, '-c:v', 'libwebp', '-quality', String(WEBP_Q[name] || 60), '-compression_level', '6', dst]);
  } else if (ext === '.png') {
    const r = PNG_RULE[name] || { colors: 256, dither: 'none' };
    const vf = `split[s0][s1];[s0]palettegen=max_colors=${r.colors}:stats_mode=full[p];[s1][p]paletteuse=dither=${r.dither}`;
    ff(['-i', src, '-vf', vf, '-frames:v', '1', '-update', '1', dst]);
  } else {
    throw new Error('unsupported ' + src);
  }
}

const TMP = join(ROOT, '.optimize-tmp');
mkdirSync(TMP, { recursive: true });
if (!DRY) mkdirSync(BACKUP, { recursive: true });

const rows = [];
for (const file of walk(DIR)) {
  const name = basename(file);
  const ext = extname(file).toLowerCase();
  const size = statSync(file).size;
  if (size < MIN_KB * 1024 && !ALWAYS.has(name)) continue;
  if (['.avif', '.mp4', '.glb'].includes(ext)) {
    rows.push({ name, size, after: null, note: `跳过：${ext} 已是压缩/不压缩格式` });
    continue;
  }
  if (SKIP[name]) {
    rows.push({ name, size, after: null, note: '跳过：' + SKIP[name] });
    continue;
  }
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;

  const out = join(TMP, name);
  try {
    encode(file, out, ext);
  } catch (e) {
    rows.push({ name, size, after: null, note: '失败：' + String(e.message || e).split('\n')[0] });
    continue;
  }
  const after = statSync(out).size;
  const ratio = after / size;
  let verdict;
  if (ratio > MAX_RATIO) verdict = `跳过：仅省 ${((1 - ratio) * 100).toFixed(1)}%（要求 ≥20%）`;
  else if (name === 'og-cover.jpg' && after > OG_CAP) verdict = `跳过：${(after / 1024) | 0}KB > 120KB 上限`;
  else {
    const a = probe(file), b = probe(out);
    verdict = a.w === b.w && a.h === b.h ? '压缩' : `跳过：尺寸变了 ${a.w}x${a.h}→${b.w}x${b.h}`;
  }
  rows.push({ name, size, after, note: verdict });

  if (verdict === '压缩' && !DRY) {
    copyFileSync(file, join(BACKUP, name));
    copyFileSync(out, file);
  }
  rmSync(out, { force: true });
}
rmSync(TMP, { recursive: true, force: true });

/* 打印表格 */
const pad = (s, n) => String(s).padEnd(n);
const num = (n) => n.toLocaleString('en-US').padStart(10);
let before = 0, after = 0, done = 0, skipped = 0;
console.log(`\n${DRY ? '[DRY] ' : ''}assets 扫描：>${MIN_KB}KB 的 jpg/png/webp，备份目录 ${DRY ? '(不写)' : BACKUP}\n`);
console.log(pad('文件', 30) + num('原体积') + '  ' + num('新体积') + '   节省    结论');
console.log('-'.repeat(96));
for (const r of rows) {
  const saved = r.after == null ? '' : ((1 - r.after / r.size) * 100).toFixed(1) + '%';
  console.log(
    pad(r.name, 30) + num(r.size) + '  ' + (r.after == null ? ''.padStart(10) : num(r.after)) +
    '  ' + pad(saved, 7) + '  ' + r.note
  );
  if (r.note === '压缩') { before += r.size; after += r.after; done++; }
  else skipped++;
}
console.log('-'.repeat(96));
if (done) {
  console.log(`${DRY ? '可压缩' : '已压缩'} ${done} 个，跳过 ${skipped} 个；` +
    `${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB（省 ${((1 - after / before) * 100).toFixed(1)}%）`);
} else {
  console.log(`无可压缩文件（${skipped} 个跳过，均已达标或已压缩过）`);
}
if (DRY) console.log('--dry：未改动 assets，也未写备份。');
