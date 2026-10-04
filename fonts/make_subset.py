#!/usr/bin/env python3
"""为故纸舟大厅页生成文楷(LXGW WenKai)字体子集，只含页面用到的字符。

用法:  python3 make_subset.py <index.html路径> <输出目录>
输出:  lxgw-subset-regular.woff2 / lxgw-subset-bold.woff2

原理: 从 jsDelivr npm 的文楷分片文件里挑出覆盖页面字符的那些分片，
各自裁到需要的字符后合并、再整体裁剪导出 woff2。
新增剧本后若大厅出现新汉字，重跑本脚本即可（jsDelivr npm 域名允许使用）。
"""
import os
import re
import subprocess
import sys
import urllib.request

BASE = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.1.0/'
PYFTSUBSET = '/opt/anaconda3/bin/pyftsubset'
FONTTOOLS = '/opt/anaconda3/bin/fonttools'
WEIGHTS = [('regular', 'lxgwwenkai-regular.css'), ('bold', 'lxgwwenkai-bold.css')]


UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'


def download(url, path):
    # 用 curl 下载：jsDelivr 会拒绝 urllib 的 TLS 指纹（400），
    # 连续快速下载还会触发限流（SSL 中断），所以带重试和间隔
    import time
    for attempt in range(5):
        r = subprocess.run(['curl', '-s', '-A', UA, '-o', path, url])
        if r.returncode == 0 and os.path.getsize(path) > 0:
            time.sleep(0.3)
            return
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'下载失败: {url}')


def page_chars(path):
    html = open(path, encoding='utf-8').read()
    text = re.sub(r'<[^>]+>', '', html)
    text = re.sub(r'&[a-zA-Z]+;', '', text)
    return sorted(set(text))


def parse_css(css):
    out = []
    for b in re.findall(r'@font-face\s*\{([^}]*)\}', css):
        mr = re.search(r'unicode-range:\s*([^;}]*)', b)
        ms = re.search(r"url\('([^']+)'\)", b)
        if mr and ms:
            out.append((mr.group(1).strip(), ms.group(1)))
    return out


def covers(spec, cp):
    for part in spec.split(','):
        part = part.strip()
        m = re.fullmatch(r'U\+([0-9a-fA-F?]+)-?([0-9a-fA-F]*)', part)
        if not m:
            continue
        h = m.group(1)
        if '?' in h:
            n = h.count('?')
            base = int(h.replace('?', '0'), 16)
            if base <= cp < base + (16 ** n):
                return True
            continue
        lo = int(h, 16)
        hi = int(m.group(2), 16) if m.group(2) else lo
        if lo <= cp <= hi:
            return True
    return False


def covered_chars(ttf_path):
    from fontTools.ttLib import TTFont
    f = TTFont(ttf_path)
    covered = set()
    for table in f['cmap'].tables:
        covered.update(table.cmap.keys())
    return covered


def build_weight(name, css_file, chars, workdir, out_path):
    css_path = os.path.join(workdir, f'{name}.css')
    download(BASE + css_file, css_path)
    with open(css_path, encoding='utf-8') as f:
        css = f.read()
    needed = {}
    for spec, url in parse_css(css):
        hits = [c for c in chars if covers(spec, ord(c))]
        if hits:
            needed.setdefault(url, []).extend(hits)
    print(f'[{name}] 需要 {len(needed)} 个分片文件')

    parts = []
    for i, (url, hits) in enumerate(sorted(needed.items())):
        woff2 = os.path.join(workdir, f'part_{i}.woff2')
        ttf = os.path.join(workdir, f'part_{i}.ttf')
        download(BASE + url, woff2)
        unicodes = ','.join(f'U+{ord(c):X}' for c in sorted(set(hits)))
        subprocess.run([PYFTSUBSET, woff2, f'--unicodes={unicodes}',
                        f'--output-file={ttf}'], check=True)
        parts.append(ttf)

    merged = os.path.join(workdir, f'{name}-merged.ttf')
    subprocess.run([FONTTOOLS, 'merge', *parts,
                    f'--output-file={merged}'], check=True)

    ok = [c for c in chars if ord(c) in covered_chars(merged)]
    missing = [c for c in chars if ord(c) not in covered_chars(merged)]
    if missing:
        print(f'[{name}] 字体里没有的字（将回退系统字体）: {"".join(missing)!r}')

    chars_file = os.path.join(workdir, 'chars.txt')
    with open(chars_file, 'w', encoding='utf-8') as f:
        f.write(''.join(ok))
    subprocess.run([PYFTSUBSET, merged, f'--text-file={chars_file}',
                    '--flavor=woff2', f'--output-file={out_path}'], check=True)
    size = os.path.getsize(out_path)
    print(f'[{name}] -> {out_path} ({size} bytes, {len(ok)} 字符)')


def main():
    if len(sys.argv) != 3:
        sys.exit('用法: python3 make_subset.py <index.html> <输出目录>')
    html_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    chars = page_chars(html_path)
    print(f'页面共 {len(chars)} 个不同字符')
    for name, css_file in WEIGHTS:
        out = os.path.join(out_dir, f'lxgw-subset-{name}.woff2')
        build_weight(name, css_file, chars, out_dir, out)


if __name__ == '__main__':
    main()
