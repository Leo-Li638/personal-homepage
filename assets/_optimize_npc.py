#!/usr/bin/env python3
"""优化 NPC 立绘：去杂点(只保留最大连通域) -> 裁透明边 -> 限高缩放 -> 压缩输出 PNG+WebP"""
import numpy as np
from scipy import ndimage
from PIL import Image
import os

SRC = r"E:\developer-file\dev\GEO\processed_image_img90513097-5eb27823-f5a0-43e0-a31c-3b6cf3667e5c_1.png"
OUT_DIR = r"E:\developer-file\dev\GEO\_homepage_deploy\assets"

img = Image.open(SRC).convert("RGBA")
a = np.array(img)
alpha = a[..., 3]

# 1) 只保留最大连通域，去掉漂浮杂点
mask = alpha > 8
labels, n = ndimage.label(mask)
if n > 1:
    sizes = ndimage.sum(mask, labels, range(1, n + 1))
    keep = int(np.argmax(sizes)) + 1
    removed = n - 1
    alpha[labels != keep] = 0
    a[..., 3] = alpha
    print(f"removed {removed} small components")
img = Image.fromarray(a)

# 2) 裁掉透明边
bbox = img.getbbox()
img = img.crop(bbox)
print("cropped:", img.size)

# 3) 限高 760px
H = 760
if img.height > H:
    w = round(img.width * H / img.height)
    img = img.resize((w, H), Image.LANCZOS)
print("final size:", img.size)

# 4) 输出
png_path = os.path.join(OUT_DIR, "npc_maid.png")
webp_path = os.path.join(OUT_DIR, "npc_maid.webp")
img.save(png_path, optimize=True)
img.save(webp_path, "WEBP", quality=82, method=6)
for p in (png_path, webp_path):
    print(p, f"{os.path.getsize(p)/1024:.0f} KB")
