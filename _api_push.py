#!/usr/bin/env python3
"""通过 GitHub Contents API 更新 index.html（绕开 git push 上传流被代理卡死的问题）。"""
import base64, json, subprocess, sys

REPO = "Leo-Li638/personal-homepage"
PATH = "index.html"
BRANCH = "master"
LOCAL = r"E:/developer-file/dev/GEO/_homepage_deploy/index.html"

# 1. 从 git credential 取凭证（不打印）
fill = subprocess.run(
    ["git", "credential", "fill"],
    input="protocol=https\nhost=github.com\n\n",
    capture_output=True, text=True,
)
creds = {}
for line in fill.stdout.splitlines():
    if "=" in line:
        k, _, v = line.partition("=")
        creds[k.strip()] = v.strip()
user, token = creds.get("username", ""), creds.get("password", "")
assert token, "no credential found"
auth = base64.b64encode(f"{user}:{token}".encode()).decode()

def api(method, url, payload=None):
    cmd = ["curl", "-s", "-x", "socks5h://127.0.0.1:10808", "--max-time", "40",
           "-X", method, "-H", f"Authorization: Basic {auth}",
           "-H", "Accept: application/vnd.github+json",
           "-H", "Content-Type: application/json"]
    if payload is not None:
        cmd += ["-d", json.dumps(payload)]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout) if r.stdout.strip() else {}

# 2. 取远端文件 sha
meta = api("GET", f"https://api.github.com/repos/{REPO}/contents/{PATH}?ref={BRANCH}")
sha = meta.get("sha")
assert sha, f"cannot get remote sha: {json.dumps(meta)[:200]}"
print("remote sha:", sha[:10])

# 3. PUT 新内容
content = base64.b64encode(open(LOCAL, "rb").read()).decode()
res = api("PUT", f"https://api.github.com/repos/{REPO}/contents/{PATH}", {
    "message": "Use Organization schema type (GeoLook authority whitelist)",
    "content": content, "sha": sha, "branch": BRANCH,
})
if "commit" in res:
    print("COMMIT OK:", res["commit"]["sha"][:10])
else:
    print("FAILED:", json.dumps(res, ensure_ascii=False)[:300])
    sys.exit(1)
