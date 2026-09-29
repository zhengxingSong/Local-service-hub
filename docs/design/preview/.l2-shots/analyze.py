import sys
from collections import Counter
from PIL import Image

path = sys.argv[1]
im = Image.open(path).convert('RGB')
w, h = im.size
px = im.load()
c = Counter(im.getdata())
total = w * h
named = {
    '#ffffff canvas': (255,255,255),
    '#f4f4f4 surface-1': (244,244,244),
    '#e0e0e0 surface-2/hairline': (224,224,224),
    '#161616 ink': (22,22,22),
    '#525252 ink-muted': (82,82,82),
    '#8c8c8c ink-subtle': (140,140,140),
    '#0f62fe primary': (15,98,254),
    '#0043ce blue-60': (0,67,206),
    '#002d9c blue-80': (0,45,156),
    '#0050e6 blue-hover': (0,80,230),
    '#24a148 success': (36,161,72),
    '#f1c21b warning': (241,194,27),
    '#da1e28 error': (218,30,40),
    '#defbe6 success-bg': (222,251,230),
    '#fdf6dd warning-bg': (253,246,221),
    '#fff1f1 error-bg': (255,241,241),
    '#edf5ff info-bg': (237,245,255),
    '#e8e8e8 shell-canvas': (232,232,232),
    '#8a3ffc purple-60': (138,63,252),
    '#007d79 teal-60': (0,125,121),
    '#198038 green-60': (25,128,56),
    '#8d8d8d gray-50': (141,141,141),
}
print('size', w, h, 'unique colors', len(c))
for name, rgb in named.items():
    n = c.get(rgb, 0)
    print('%-28s %8d px  %6.3f%%  %s' % (name, n, 100.0*n/total, 'PRESENT' if n else '-'))
print('--- top 12 colors ---')
for rgb, n in c.most_common(12):
    print('  #%02x%02x%02x %8d px %6.3f%%' % (rgb[0], rgb[1], rgb[2], n, 100.0*n/total))
# 窗口左上角外沿：验证 0px 圆角（直角处应是窗口内的白，而不是外壳灰）
print('--- corners of the app window region (search for 1px black border) ---')
blacks = [(x,y) for y in range(h) for x in range(w) if px[x,y] == (22,22,22)]
if blacks:
    xs = [p[0] for p in blacks]; ys = [p[1] for p in blacks]
    print('ink pixels bbox x[%d..%d] y[%d..%d] count=%d' % (min(xs),max(xs),min(ys),max(ys),len(blacks)))
