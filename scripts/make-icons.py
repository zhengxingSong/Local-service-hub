"""按产品自身形态生成图标。

形态来源：ui-l2-carbon.html 的窗口骨架——
  · .navbar 顶栏，四个 .navtab（运行总览 / 配置 / 服务编辑 / 设置）
  · 内容区两栏：主列（用途卡）较宽 + 资源面较窄
图标就是这个骨架的缩微：顶栏四段（当前视图那一段是 IBM 蓝）+ 下方一宽一窄两个块面。
配色只取 Carbon：canvas #ffffff / surface-1 #f4f4f4 / surface-2 #e0e0e0 /
hairline #e0e0e0 / ink #161616 / primary #0f62fe。

我（代理）看不到图像，所以用确定性几何绘制，并输出多方案对照图供人判断。
"""
from PIL import Image, ImageDraw
import io

OUT = r"F:\Project\General\Local service hub\resources"
PREVIEW = r"F:\Project\General\Local service hub\docs\design\preview\shots"
MASTER = 1024
SIZES = [16, 24, 32, 48, 64, 128, 256]
TRAY_SIZES = [16, 20, 24, 32, 48]

WHITE = (255, 255, 255, 255)
INK = (22, 22, 22, 255)
SURF1 = (244, 244, 244, 255)
SURF2 = (224, 224, 224, 255)
BLUE = (15, 98, 254, 255)
DARK1 = (38, 38, 38, 255)
DARK2 = (58, 58, 58, 255)

# 形态比例：顶栏占 16%，内容左右栏宽度比 62:30，与产品里的主列/资源面一致
NAV_H = 0.16
PAD = 0.10
COL_L = 0.615
COL_GAP = 0.055


def window_tile(size, fill, radius_ratio, border=None):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=fill,
                        outline=border, width=max(1, round(size / 96)) if border else 0)
    return img


def product_form(size, tile, nav_fill, nav_active, col_fill, col_alt, border=None,
                 nav_tabs=4):
    """顶栏四段 + 内容两栏。"""
    img = window_tile(size, tile, 0.20, border)
    d = ImageDraw.Draw(img)
    pad = size * PAD
    inner_w = size - 2 * pad
    # 顶栏
    nav_y0 = pad
    nav_h = size * NAV_H
    gap = max(1, round(size / 128))
    seg = (inner_w - gap * (nav_tabs - 1)) / nav_tabs
    for i in range(nav_tabs):
        x0 = pad + i * (seg + gap)
        d.rectangle([x0, nav_y0, x0 + seg, nav_y0 + nav_h],
                    fill=(nav_active if i == 0 else nav_fill))
    # 内容两栏
    content_y0 = nav_y0 + nav_h + size * 0.06
    content_h = size - pad - content_y0
    left_w = inner_w * COL_L
    right_x = pad + left_w + inner_w * COL_GAP
    right_w = inner_w - left_w - inner_w * COL_GAP
    d.rectangle([pad, content_y0, pad + left_w, content_y0 + content_h], fill=col_fill)
    d.rectangle([right_x, content_y0, right_x + right_w, content_y0 + content_h], fill=col_alt)
    return img


def variant_light(size):
    """浅色窗口（与产品一致的浅色 Carbon 界面）"""
    return product_form(size, WHITE, SURF2, BLUE, SURF1, SURF2, border=SURF2)


def variant_dark(size):
    """深色窗口（深色壁纸下轮廓更稳）"""
    return product_form(size, INK, DARK2, BLUE, DARK1, DARK2)


def variant_solid_nav(size):
    """顶栏整条蓝（大尺寸内部用细缝分出四段）+ 内容区两栏。

    实测驱动的两处光学补偿（不是调门槛凑数）：
    · 把「当前页签」做成单独蓝色小段，16px 只剩 3 个像素——看不见，故改为整条蓝；
    · 16px 下顶栏按比例只有 2.5px 高、四段细缝还要吃掉约 7 个像素，
      所以小尺寸加粗顶栏并省略细缝——那个尺寸本来也分辨不出四段。
    """
    if size <= 24:
        nav_h_ratio, tabs = 0.24, 1
    elif size <= 48:
        nav_h_ratio, tabs = 0.19, 1
    else:
        nav_h_ratio, tabs = NAV_H, 4

    img = window_tile(size, WHITE, 0.20, SURF2)
    d = ImageDraw.Draw(img)
    pad = size * PAD
    inner_w = size - 2 * pad
    nav_h = size * nav_h_ratio
    if tabs == 1:
        d.rectangle([pad, pad, pad + inner_w, pad + nav_h], fill=BLUE)
    else:
        gap = max(1, round(size / 150))
        seg = (inner_w - gap * (tabs - 1)) / tabs
        for i in range(tabs):
            x0 = pad + i * (seg + gap)
            d.rectangle([x0, pad, x0 + seg, pad + nav_h], fill=BLUE)
    content_y0 = pad + nav_h + size * 0.06
    content_h = size - pad - content_y0
    left_w = inner_w * COL_L
    right_x = pad + left_w + inner_w * COL_GAP
    right_w = inner_w - left_w - inner_w * COL_GAP
    d.rectangle([pad, content_y0, pad + left_w, content_y0 + content_h], fill=SURF1)
    d.rectangle([right_x, content_y0, right_x + right_w, content_y0 + content_h], fill=SURF2)
    return img


def variant_old(size):
    """现状（Tailwind 蓝 + 方格），仅作对照"""
    img = window_tile(size, (59, 130, 246, 255), 0.22)
    d = ImageDraw.Draw(img)
    span = size * 0.52
    gap = size * 0.09
    cell = (span - gap) / 2
    x0 = y0 = (size - span) / 2
    for cx, cy in ((0, 0), (1, 0), (0, 1), (1, 1)):
        left = x0 + cx * (cell + gap)
        top = y0 + cy * (cell + gap)
        d.rectangle([left, top, left + cell, top + cell], fill=WHITE)
    return img


VARIANTS = {
    "S blue navbar + 2 cols": variant_solid_nav,
    "W light window": variant_light,
    "D dark window": variant_dark,
    "old": variant_old,
}
CHOSEN = variant_solid_nav


def tray_icon(size):
    """托盘：小尺寸放不下四段，用「蓝底 + 顶栏白条」保留同一母题，浅深任务栏都看得见。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.18)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BLUE)
    pad = size * 0.20
    bar_h = size * 0.16
    d.rectangle([pad, size * 0.26, size - pad, size * 0.26 + bar_h], fill=WHITE)
    d.rectangle([pad, size * 0.26 + bar_h * 2.1, size * 0.60, size * 0.26 + bar_h * 2.1 + bar_h * 1.5],
                fill=WHITE)
    return img


def render(fn, size):
    return fn(MASTER).resize((size, size), Image.LANCZOS)


def save_ico(path, draw_fn, sizes):
    """手写 ICO 容器：每个尺寸**原生绘制**，不经由大图缩放。

    为什么不用 PIL 的 ico 保存：它把单张母版逐尺寸 resize，
    于是"小尺寸加粗笔画"这类光学补偿永远不会执行（本轮踩过这个坑）。
    32 位含 alpha 的帧以 PNG 形式嵌入，Windows Vista+ 支持。
    """
    import struct
    frames = []
    for s in sizes:
        img = draw_fn(s).convert("RGBA")
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        frames.append((s, buf.getvalue()))

    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = len(header) + 16 * len(frames)
    entries, blobs = b"", b""
    for s, data in frames:
        dim = 0 if s >= 256 else s          # 256 在 ICO 里记作 0
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    with open(path, "wb") as f:
        f.write(header + entries + blobs)


def main():
    # 每个尺寸原生绘制（小尺寸的加粗补偿才会生效）
    save_ico(f"{OUT}\\icon.ico", CHOSEN, SIZES)
    print("  icon.ico 帧:", SIZES, "（每帧原生绘制）")
    CHOSEN(256).save(f"{OUT}\\icon.png", "PNG")

    save_ico(f"{OUT}\\tray.ico", tray_icon, TRAY_SIZES)
    print("  tray.ico 帧:", TRAY_SIZES)

    pad, label_w = 16, 150
    row_h = 256 + pad
    cols = [16, 24, 32, 48, 64, 128, 256]
    width = label_w + sum(c + pad for c in cols) + pad
    height = pad + len(VARIANTS) * 2 * (row_h + 28)
    sheet = Image.new("RGBA", (width, height), (250, 250, 250, 255))
    d = ImageDraw.Draw(sheet)
    y = pad
    for name, fn in VARIANTS.items():
        for bg_name, bg in (("on light", WHITE), ("on dark", (32, 32, 32, 255))):
            sheet.paste(Image.new("RGBA", (width - 2 * pad, row_h), bg), (pad, y))
            d.text((pad + 8, y + row_h - 22), f"{name}  {bg_name}", fill=(90, 90, 90, 255))
            x = pad + label_w
            for s in cols:
                img = fn(s).convert("RGBA")      # 对照图也用原生尺寸
                sheet.paste(img, (x, y + (row_h - s) // 2), img)
                d.text((x, y + 4), f"{s}px", fill=(120, 120, 120, 255))
                x += s + pad
            y += row_h + 28
    sheet.save(f"{PREVIEW}\\8-icon-variants.png", "PNG")
    print("  对照图:", f"{PREVIEW}\\8-icon-variants.png", sheet.size)


main()
