#!/usr/bin/env python3
"""把主题目录打包成 dist/<主题名>.zip。

约定：
  - 仓库根下每个含 theme.json 的目录就是一个主题；
  - 目录名 = 主题名 = zip 文件名；
  - zip 根目录**就是** theme.json（不套一层同名目录）——后台上传安装器
    要求如此（它会剥掉多余的唯一顶层目录，但根目录最直接）。

用法：
  python3 scripts/build-themes.py                  # 打包全部主题
  python3 scripts/build-themes.py --only aurora-glass
  python3 scripts/build-themes.py --list           # 只列出识别到的主题
"""
import argparse
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

# 这些目录不是主题（仓库级目录 / 打包产物 / 隐藏目录）。
SKIP_DIRS = {"dist", "scripts", ".github", "node_modules", ".git"}
SKIP_FILES = {".DS_Store", "Thumbs.db", ".gitignore", ".gitattributes"}

REQUIRED = ("theme.json",)


def theme_dirs():
    """返回 [(name, dir, meta)]，按目录名排序。"""
    out = []
    for name in sorted(os.listdir(ROOT)):
        d = os.path.join(ROOT, name)
        if not os.path.isdir(d) or name in SKIP_DIRS or name.startswith("."):
            continue
        if not os.path.isfile(os.path.join(d, "theme.json")):
            continue
        meta = load_meta(d)
        out.append((name, d, meta))
    return out


def load_meta(d):
    path = os.path.join(d, "theme.json")
    with open(path, encoding="utf-8") as f:
        meta = json.load(f)
    for key in ("name", "version", "api_version", "entry"):
        if not meta.get(key):
            raise SystemExit("%s 缺少必需字段 %s" % (path, key))
    return meta


def build(name, d, meta):
    entry = meta.get("entry", "index.html")
    if not os.path.isfile(os.path.join(d, entry)):
        raise SystemExit("%s 的 entry 指向的文件不存在：%s" % (name, entry))

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, name + ".zip")
    # 先写临时文件再替换：打包失败时不会留下半个 zip。
    tmp = out + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for root, dirs, files in os.walk(d):
            dirs[:] = sorted(x for x in dirs
                             if x not in SKIP_DIRS and not x.startswith("."))
            for f in sorted(files):
                if f in SKIP_FILES or f.endswith(".zip"):
                    continue
                p = os.path.join(root, f)
                rel = os.path.relpath(p, d).replace(os.sep, "/")
                z.write(p, rel)
    os.replace(tmp, out)
    return out


def main():
    ap = argparse.ArgumentParser(description="打包 XBProbe 主题为 zip")
    ap.add_argument("--only", help="只打包指定主题（目录名）")
    ap.add_argument("--list", action="store_true", help="只列出主题，不打包")
    args = ap.parse_args()

    themes = theme_dirs()
    if args.only:
        themes = [t for t in themes if t[0] == args.only]
        if not themes:
            raise SystemExit("找不到主题目录：%s" % args.only)
    if not themes:
        raise SystemExit("没有识别到任何主题（含 theme.json 的目录）")

    if args.list:
        for name, _, meta in themes:
            print("%-16s v%-8s %s" % (name, meta.get("version"), meta.get("name")))
        return

    for name, d, meta in themes:
        out = build(name, d, meta)
        size = os.path.getsize(out)
        print("✓ %-16s v%-8s → %s (%d 字节)" %
              (name, meta.get("version"), os.path.relpath(out, ROOT), size))


if __name__ == "__main__":
    sys.exit(main())
