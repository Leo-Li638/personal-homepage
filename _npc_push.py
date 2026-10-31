#!/usr/bin/env python3
"""NPC 上线：经 GitHub Contents API 推送 index.html + NPC 图片资产（走本地代理）。"""
import base64, json, subprocess, sys

REPO = "Leo-Li638/personal-homepage"
BRANCH = "master"
FILES = [
    ("index.html", r"E:/developer-file/dev/GEO/_homepage_deploy/index.html"),
    ("assets/npc_maid.webp", r"E:/developer-file/dev/GEO/_homepage_deploy/assets/npc_maid.webp"),
    ("assets/npc_maid.png", r"E:/developer-file/dev/GEO/_homepage_deploy/assets/npc_maid.png"),
]
MSG = "feat: interactive maid NPC (drag/throw physics, pat reactions, speech bubble)"

fill = subprocess.run(["git", "credential", "fill"],
    input="protocol=https\nhost=github.com\n\n", capture_output=True, text=True)
creds = {}
for line in fill.stdout.splitlines():
    if "=" in line:
        k, _, v = line.partition("=")
        creds[k.strip()] = v.strip()
user, token = creds.get("username", ""), creds.get("password", "")
assert token, "no credential found"
auth = base64.b64encode(f"{user}:{token}".encode()).decode()

def api(method, url, payload=None):
    cmd = ["curl", "-s", "-x", "socks5h://127.0.0.1:10808", "--max-time", "60",
           "-X", method, "-H", f"Authorization: Basic {auth}",
           "-H", "Accept: application/vnd.github+json",
           "-H", "Content-Type: application/json"]
    tmp = None
    if payload is not None:
        # 大文件 base64 会超 Windows 命令行 32K 限制，改走临时文件
        import os, tempfile
        fd, tmp = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        cmd += ["--data-binary", f"@{tmp}"]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if tmp:
        os.remove(tmp)
    return json.loads(r.stdout) if r.stdout.strip() else {}

ok = True
for path, local in FILES:
    meta = api("GET", f"https://api.github.com/repos/{REPO}/contents/{path}?ref={BRANCH}")
    gh = subprocess.run(["git", "hash-object", local], capture_output=True, text=True).stdout.strip()
    if meta.get("sha") and meta["sha"] == gh:
        print(f"SKIP {path} (远端已一致)")
        continue
    body = {"message": MSG, "branch": BRANCH,
            "content": base64.b64encode(open(local, "rb").read()).decode()}
    if meta.get("sha"):
        body["sha"] = meta["sha"]
    res = api("PUT", f"https://api.github.com/repos/{REPO}/contents/{path}", body)
    if "commit" in res:
        print(f"OK {path} -> {res['commit']['sha'][:10]}")
    else:
        ok = False
        print(f"FAIL {path}: {json.dumps(res, ensure_ascii=False)[:200]}")
sys.exit(0 if ok else 1)
