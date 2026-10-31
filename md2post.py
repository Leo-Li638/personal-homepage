# -*- coding: utf-8 -*-
"""把博客 Markdown 转成与个人网站风格一致的 HTML 页面。
用法: python md2post.py <src.md> <out.html> <slug> [tags...]
"""
import io, re, sys, markdown, html as _html

SITE = "https://xn--4gq.chat"
AUTHOR = "李玉涛（Leo）"

CSS = """
:root{--bg:#f6f8fb;--card:#fff;--ink:#1f2937;--sub:#6b7280;--line:#e5e7eb;
  --brand:#2563eb;--brand2:#0ea5e9;--tag:#eef2ff;--code:#f3f4f6;}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:var(--bg);color:var(--ink);line-height:1.85;-webkit-font-smoothing:antialiased;}
.wrap{max-width:820px;margin:0 auto;padding:24px 20px 70px;}
.back{display:inline-block;color:var(--brand);text-decoration:none;font-size:14px;margin-bottom:16px;}
.back:hover{text-decoration:underline;}
header.hero{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;border-radius:18px;
  padding:32px 28px;box-shadow:0 8px 24px rgba(37,99,235,.18);}
header.hero h1{font-size:26px;line-height:1.45;letter-spacing:.5px;}
header.hero .sub{margin-top:10px;opacity:.95;font-size:15px;}
header.hero .meta{margin-top:16px;font-size:13px;opacity:.9;display:flex;flex-wrap:wrap;gap:6px 14px;}
.paper{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:30px 32px;
  margin-top:22px;box-shadow:0 2px 8px rgba(0,0,0,.03);}
  .paper h1{font-size:22px;margin:38px 0 14px;padding:14px 0 0;border-top:3px solid var(--brand);
  color:#111827;letter-spacing:.3px;}
  .paper h1:first-of-type{border-top:0;margin-top:0;padding-top:0;font-size:24px;}
  .paper h2{font-size:19px;margin:30px 0 10px;padding-left:11px;border-left:4px solid var(--brand);}
.paper h3{font-size:16px;margin:22px 0 8px;color:#374151;}
.paper p{margin:12px 0;font-size:15.5px;}
.paper ul,.paper ol{margin:12px 0 12px 26px;font-size:15.5px;}
.paper li{margin:6px 0;}
.paper blockquote{margin:16px 0;padding:14px 18px;background:#f8fafc;border-left:4px solid var(--brand2);
  border-radius:0 10px 10px 0;color:#475569;font-size:15px;}
.paper blockquote p{margin:6px 0;}
.paper a{color:var(--brand);text-decoration:none;border-bottom:1px solid #bfdbfe;}
.paper a:hover{border-bottom-color:var(--brand);}
.paper code{background:var(--code);padding:2px 6px;border-radius:5px;font-size:13.5px;
  font-family:"SFMono-Regular",Consolas,monospace;color:#b91c1c;}
.paper pre{background:#0f172a;color:#e2e8f0;padding:16px 18px;border-radius:11px;overflow-x:auto;
  margin:16px 0;font-size:13.5px;line-height:1.7;}
.paper pre code{background:none;color:inherit;padding:0;font-size:13.5px;}
.paper table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14.5px;}
.paper th,.paper td{border:1px solid var(--line);padding:9px 12px;text-align:left;vertical-align:top;}
.paper th{background:#f8fafc;font-weight:600;}
.paper hr{border:0;border-top:1px solid var(--line);margin:30px 0;}
.paper img{max-width:100%;border-radius:10px;}
.toc{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 22px;margin-top:20px;}
.toc summary{cursor:pointer;font-weight:600;font-size:15px;color:var(--brand);}
.toc ol{margin:12px 0 0 22px;font-size:14.5px;}
.toc li{margin:5px 0;}
.toc a{color:#374151;text-decoration:none;}
.toc a:hover{color:var(--brand);}
footer{margin-top:34px;text-align:center;color:var(--sub);font-size:13px;line-height:2;}
footer a{color:var(--brand);text-decoration:none;}
@media(max-width:640px){.paper{padding:22px 18px;}.paper h1{font-size:20px;}.paper h2{font-size:17px;}
  header.hero h1{font-size:21px;}.paper table{font-size:13.5px;}.paper th,.paper td{padding:7px 9px;}}
"""


def parse_fm(text):
    """解析 YAML front-matter，返回 (meta, body)"""
    meta = {}
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, flags=re.S)
    if m:
        raw = m.group(1)
        for line in raw.split("\n"):
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
        text = text[m.end():]
    return meta, text


def build_toc(md):
    heads = re.findall(r"^(#{1,3})\s+(.+)$", md, flags=re.M)
    if len(heads) < 3:
        return ""
    items = []
    for lvl, t in heads:
        if lvl == "#":
            continue
        slug = "s-" + re.sub(r"[^\w\u4e00-\u9fff]+", "-", t.strip().lower()).strip("-")
        items.append((lvl, t.strip(), slug))
    li = "".join(
        f'<li style="margin-left:{(len(l)-2)*16}px"><a href="#{s}">{t}</a></li>' for l, t, s in items
    )
    return f'<details class="toc" open><summary>目录</summary><ol>{li}</ol></details>'


def add_ids(md):
    def rep(m):
        lvl, t = m.group(1), m.group(2).strip()
        if lvl == "#":
            return m.group(0)
        slug = "s-" + re.sub(r"[^\w\u4e00-\u9fff]+", "-", t.lower()).strip("-")
        return f'<h{lvl} id="{slug}">{t}</h{lvl}>'
    # 先把 md 标题转成带 id 的 HTML（后续 markdown 不再处理这些行）
    return re.sub(r"^(#{1,3})\s+(.+)$", rep, md, flags=re.M)


def main():
    src, out, slug = sys.argv[1], sys.argv[2], sys.argv[3]
    tags = sys.argv[4:]
    raw = io.open(src, encoding="utf-8").read()
    meta, body = parse_fm(raw)

    title = meta.get("title", "").strip()
    subtitle = meta.get("subtitle", "").strip()
    date = meta.get("date", "").strip()
    site = meta.get("site", SITE).strip()

    toc = build_toc(body)
    body_with_ids = add_ids(body)
    # 保护带 id 的 h2/h3，避免 markdown 再处理
    parts = re.split(r"(<h[23] id=\"[^\"]+\">.*?</h[23]>)", body_with_ids, flags=re.S)
    rendered = []
    for seg in parts:
        if re.match(r"^<h[23] id=", seg):
            rendered.append(seg)
        else:
            rendered.append(markdown.markdown(seg, extensions=["tables", "fenced_code"]))
    content = "\n".join(rendered)

    # 还原中文引号
    for a, b in [("&#8220;", "\u201c"), ("&#8221;", "\u201d"), ("&#8216;", "\u2018"), ("&#8217;", "\u2019")]:
        content = content.replace(a, b)

    tag_html = "".join(f'<span>{_html.escape(t)}</span>' for t in tags)
    page = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{_html.escape(title)} · 李玉涛的个人主页</title>
<meta name="description" content="{_html.escape(subtitle or title)}">
<link rel="canonical" href="{SITE}/posts/{slug}.html">
<meta property="og:title" content="{_html.escape(title)}">
<meta property="og:description" content="{_html.escape(subtitle or title)}">
<meta property="og:type" content="article">
<meta property="og:url" content="{SITE}/posts/{slug}.html">
<meta name="author" content="{AUTHOR}">
<script type="application/ld+json">
{{"@context":"https://schema.org","@type":"BlogPosting",
"headline":"{_html.escape(title)}","description":"{_html.escape(subtitle or title)}",
"author":{{"@type":"Person","name":"{AUTHOR}","url":"{SITE}"}},
"datePublished":"{date}","dateModified":"{date}",
"mainEntityOfPage":{{"@type":"WebPage","@id":"{SITE}/posts/{slug}.html"}},
"publisher":{{"@type":"Person","name":"{AUTHOR}","url":"{SITE}"}}}}
</script>
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="../index.html">&larr; 返回主页</a>
  <header class="hero">
    <h1>{_html.escape(title)}</h1>
    {f'<div class="sub">{_html.escape(subtitle)}</div>' if subtitle else ''}
    <div class="meta">
      <span>作者：{AUTHOR}</span>
      <span>发布：{date}</span>
      <span>{_html.escape(site.split("·")[-1].strip())}</span>
    </div>
  </header>
  {toc}
  <article class="paper">
{content}
  </article>
  <footer>
    © 2026 李玉涛 · <a href="{SITE}">一.chat</a> · 本文采用 CC BY-NC-SA 4.0 协议，转载请注明出处
  </footer>
</div>
</body>
</html>
"""
    io.open(out, "w", encoding="utf-8").write(page)
    txt = re.sub(r"<[^>]+>", "", content)
    print("OK %s  plain=%d  tags=%s" % (out, len(txt.strip()), ",".join(tags)))


main()
