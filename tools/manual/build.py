#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сборка руководства пользователя в ПДФ.

Части лежат отдельными файлами: так проще править и видеть, что изменилось.
Здесь они склеиваются, размечаются якорями (для номеров страниц в содержании)
и отдаются в WeasyPrint."""
import io, re, os

# Обход несовместимости WeasyPrint и fontTools: DejaVu объявляет бит диапазона
# Unicode с номером 123, а таблица OS/2 допускает только до 122.
from fontTools.ttLib.tables import O_S_2f_2 as _os2
_orig = _os2.table_O_S_2f_2.setUnicodeRanges
_os2.table_O_S_2f_2.setUnicodeRanges = (
    lambda self, bits: _orig(self, {b for b in bits if 0 <= b <= 122}))
from weasyprint import HTML

D = os.path.dirname(os.path.abspath(__file__)) + '/'
PARTS = ['p1.html', 'p2.html', 'p3.html', 'p4.html', 'p5.html']

css = io.open(D + 'style.css', encoding='utf-8').read()
body = []
for f in PARTS:
    src = io.open(D + f, encoding='utf-8').read()
    body.append(re.search(r'<body[^>]*>(.*)</body>', src, re.S).group(1))
html = ('<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">'
        '<title>Руководство пользователя ППО ВОЛС</title>'
        '<style>' + css + '</style></head><body>' + '\n'.join(body) + '</body></html>')

def anchor(m):
    tag, attrs, num, rest = m.groups()
    sid = 's-' + num.rstrip('.').replace('.', '-')
    return '<%s%s id="%s">%s %s</%s>' % (tag, attrs, sid, num, rest, tag)
html = re.sub(r'<(h[12])([^>]*)>(\d+(?:\.\d+)*\.)\s*([^<]+)</\1>', anchor, html)

def toc_link(m):
    txt = m.group(1).strip()
    n = re.match(r'(\d+(?:\.\d+)*)\.', txt)
    if not n:
        return m.group(0)
    return '<li><a href="#s-%s">%s</a>' % (n.group(1).replace('.', '-'), txt)
toc = re.search(r'(<div class="toc sec">.*?</div>)', html, re.S).group(1)
html = html.replace(toc, re.sub(r'<li>([^<]+?)(?=\s*(?:<ul>|</li>))', toc_link, toc), 1)

io.open(D + 'manual.html', 'w', encoding='utf-8').write(html)
out = D + 'Instrukciya_polzovatelya_PPO_VOLS.pdf'
HTML(D + 'manual.html').write_pdf(out)

missing = [a for a in set(re.findall(r'<a href="#(s-[\d-]+)"', html))
           if ('id="%s"' % a) not in html]
print('готово:', out)
print('ссылок в содержании без якоря:', missing or 'нет')
