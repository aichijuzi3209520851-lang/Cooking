# -*- coding: utf-8 -*-
"""把 AI 生成的原图处理成小程序可直接用的资源。

做三件事：
1. 裁掉右下角水印（纹理图）
2. 压到小程序包体友好的尺寸与体积
3. 输出最终文件并打印体积对比
"""
import os
from PIL import Image

BASE = r"D:\we-chat\project\miniprogram-11\miniprogram\images\brand"

SRC_TEXTURE = os.path.join(
    BASE, "Seamless_tileable_paper_textur_2026-10-05T15-29-10.png")
SRC_MARK = os.path.join(
    BASE, "Minimal_letterpress_logo_mark__2026-10-05T15-29-11.png")

OUT_TEXTURE = os.path.join(BASE, "paper-texture.jpg")
OUT_MARK = os.path.join(BASE, "brand-mark.png")


def human(n):
    return "%.1f KB" % (n / 1024.0)


# ---------- 1. 纸张纹理 ----------
# 水印在右下角，裁掉底部 8% 即可（纹理本身近似无缝，裁切不影响观感）
im = Image.open(SRC_TEXTURE).convert("RGB")
w, h = im.size
im = im.crop((0, 0, w, int(h * 0.90)))
# 压到 360px：作为 repeat 背景足够，且包体友好
im = im.resize((360, int(360 * im.size[1] / im.size[0])), Image.LANCZOS)
# JPEG 质量 72：肉眼看不出，但体积能降一个量级
im.save(OUT_TEXTURE, "JPEG", quality=72, optimize=True)

# ---------- 2. 品牌标记 ----------
# 保留透明通道，裁掉透明边后再缩放，避免图标四周留白导致视觉偏小
mk = Image.open(SRC_MARK).convert("RGBA")
bbox = mk.getbbox()
if bbox:
    mk = mk.crop(bbox)
mk.thumbnail((256, 256), Image.LANCZOS)
mk.save(OUT_MARK, "PNG", optimize=True)

for label, src, out in (
    ("纸张纹理", SRC_TEXTURE, OUT_TEXTURE),
    ("品牌标记", SRC_MARK, OUT_MARK),
):
    s = os.path.getsize(src)
    o = os.path.getsize(out)
    print("%s: %s -> %s  (%s -> %s)" % (
        label, os.path.basename(src), os.path.basename(out),
        human(s), human(o)))

print("\n纹理尺寸:", Image.open(OUT_TEXTURE).size)
print("标记尺寸:", Image.open(OUT_MARK).size)