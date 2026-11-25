// Minimal static file server for local smoke tests.
// usage: node serve.mjs <root> <port>
//
// 本地 gzip：GitHub Pages 线上会对文本资源自动 gzip；本地服务器默认不发压缩，
// 会让 perf-budget 把「未压缩体积」当成线上体积。这里对 html/css/js/json/svg/txt
// 做与线上一致的 gzip（进程内缓存），仅当请求头 accept-encoding 含 gzip 时生效。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

// 统一成绝对路径：否则 `node serve.mjs . 8099` 时 root="."，下面 startsWith 判断
// 会把所有正常请求都判成越界（403），而 `..\..\x` 反而能绕过。这是修复，不是行为变更。
const root = resolve(process.argv[2] || process.cwd());
const port = Number(process.argv[3] || 8099);
const GZIP_TYPES = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt']);
// path -> { mtimeMs, size, gz }：文件不变就复用压缩结果
const gzipCache = new Map();
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = resolve(root, '.' + p);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end('forbidden'); return; }
    const st = await stat(file);
    if (st.isDirectory()) { res.writeHead(302, { location: p + '/' }).end(); return; }
    const body = await readFile(file);
    const ext = extname(file).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    // Range 支持：GitHub Pages 支持 206，视频 preload="metadata" 只取头部；
    // 本地若整包返回 1.3MB，perf-budget 会把「按需加载」误算成首屏体积。
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? parseInt(range[1], 10) : body.length - parseInt(range[2], 10);
      let end = range[1] && range[2] ? parseInt(range[2], 10) : body.length - 1;
      start = Math.max(0, start);
      end = Math.min(end, body.length - 1);
      if (start > end) { res.writeHead(416, { 'content-range': `bytes */${body.length}` }).end(); return; }
      const chunk = body.subarray(start, end + 1);
      res.writeHead(206, {
        'content-type': type,
        'content-length': chunk.length,
        'content-range': `bytes ${start}-${end}/${body.length}`,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      }).end(chunk);
      return;
    }
    const wantsGzip = /\bgzip\b/i.test(req.headers['accept-encoding'] || '');
    if (wantsGzip && GZIP_TYPES.has(ext)) {
      let hit = gzipCache.get(file);
      if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== body.length) {
        hit = { mtimeMs: st.mtimeMs, size: body.length, gz: gzipSync(body, { level: 9 }) };
        gzipCache.set(file, hit);
      }
      // 压不小就退回原文，避免反效果
      if (hit.gz.length < body.length) {
        res.writeHead(200, {
          'content-type': type,
          'content-length': hit.gz.length,
          'content-encoding': 'gzip',
          'vary': 'Accept-Encoding',
          'cache-control': 'no-store',
        }).end(hit.gz);
        return;
      }
    }
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
