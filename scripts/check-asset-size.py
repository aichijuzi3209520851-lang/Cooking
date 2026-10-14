# -*- coding: utf-8 -*-
"""品牌素材体检：检查图片/音频资源体积是否满足小程序要求。

⚠️ 本脚本【只读，不修改任何文件】。

历史上这里有个「从 AI 原图重新生成 brand-mark.png / paper-texture.jpg」
的转换脚本，但它与线上已定稿的素材并不同源（跑一次就把平底锅图标
换成了红色汤锅图标）。线上素材此后都应视为**手工定稿产物**，不要用脚本覆写。

素材源图放在 design/brand-source/（已压缩为 JPEG，避免触发「代码质量」
里「图片和音频资源不应超过 200K」的检查）。未压缩的原始 PNG 已移出项目
目录，归档在 D:/we-chat/design-archive/miniprogram-11/brand-source/
（放在项目外，代码质量扫描不会扫到）。design/ 已在 project.config.json
的 packOptions.ignore 中排除，不会打进小程序包。

如果确实需要从原图重新产出素材：
  1. 先把产物写到临时路径，人工比对视觉是否与线上一致；
  2. 确认无误后再手工覆盖 miniprogram/images/brand/ 下的对应文件。

用法：python scripts/check-asset-size.py
退出码 0 = 全部合规；1 = 存在超标资源。
"""
import os
import sys

ROOT = r"D:\we-chat\project\miniprogram-11"
# 小程序「代码质量」检查的阈值：单个图片/音频资源不超过 200 KB
LIMIT = 200 * 1024
# 留 10% 余量，避免贴着红线反复告警
WARN = int(LIMIT * 0.9)

EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
        ".mp3", ".wav", ".aac", ".m4a", ".mp4", ".mov"}
# 真正会参与小程序运行/打包的目录（design/docs/tests 等素材与文档目录不参与）
SCAN_DIRS = [os.path.join(ROOT, "miniprogram")]


def human(n):
    return "%.1f KB" % (n / 1024.0)


def scan():
    hits = []
    for base in SCAN_DIRS:
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames
                           if d not in ("node_modules", ".git", "_original")]
            for fn in filenames:
                if os.path.splitext(fn)[1].lower() not in EXTS:
                    continue
                p = os.path.join(dirpath, fn)
                hits.append((os.path.getsize(p), os.path.relpath(p, ROOT)))
    return sorted(hits, reverse=True)


def main():
    hits = scan()
    if not hits:
        print("未扫描到任何图片/音频资源。")
        return 0

    total = sum(s for s, _ in hits)
    over = [(s, p) for s, p in hits if s > LIMIT]
    warn = [(s, p) for s, p in hits if WARN < s <= LIMIT]

    print("扫描目录: %s" % ", ".join(os.path.relpath(d, ROOT) for d in SCAN_DIRS))
    print("资源数量: %d | 合计: %s" % (len(hits), human(total)))
    print("-" * 52)

    if warn:
        print("[临界] 超过 %s，建议进一步压缩：" % human(WARN))
        for s, p in warn:
            print("  %s  %s" % (human(s), p))

    if over:
        print("[超标] 超过 %s，会触发代码质量检查不通过：" % human(LIMIT))
        for s, p in over:
            print("  %s  %s" % (human(s), p))
        return 1

    print("最大的 5 个资源：")
    for s, p in hits[:5]:
        print("  %s  %s" % (human(s), p))
    print("\n✅ 全部资源均不超过 %s。" % human(LIMIT))
    return 0


if __name__ == "__main__":
    sys.exit(main())