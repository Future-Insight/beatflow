"""根据 index.html 的 .brand-mark 样式渲染 favicon.ico（多尺寸）。"""
from PIL import Image, ImageDraw

OUT = "favicon.ico"
SIZES = [16, 32, 48, 64, 128, 256]

ACCENT = (0xff, 0x3b, 0x4e)   # --accent
END    = (0xff, 0x7a, 0x3c)   # gradient end
BAR    = (0x0b, 0x0b, 0x0f)   # dark bar color
BASE = 34                       # CSS 原始尺寸

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def render(size: int) -> Image.Image:
    SS = 4                      # 超采样倍率，最后缩放消除锯齿
    s = size * SS
    scale = s / BASE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # 圆角矩形 mask（border-radius: 10px，按比例换算）
    radius = int(10 * scale)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s, s), radius=radius, fill=255)

    # 135deg 线性渐变：从左上到右下（沿对角线投影）
    grad = Image.new("RGBA", (s, s))
    px = grad.load()
    for y in range(s):
        for x in range(s):
            t = (x + y) / (2 * (s - 1))
            px[x, y] = lerp(ACCENT, END, t) + (255,)
    img.paste(grad, (0, 0), mask)

    # 两根深色竖条（圆角 2px）
    bars = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bars)
    r2 = max(1, int(2 * scale))
    def bar(x, y, w, h):
        x0, y0 = int(x * scale), int(y * scale)
        x1, y1 = int((x + w) * scale), int((y + h) * scale)
        bd.rounded_rectangle((x0, y0, x1, y1), radius=r2, fill=BAR + (255,))
    bar(9, 9, 3, 16)
    bar(16, 6, 3, 22)
    img.alpha_composite(bars)

    return img.resize((size, size), Image.LANCZOS)

frames = [render(n) for n in SIZES]
# Pillow 的 ICO 编码：以最大尺寸为基准，sizes 列出所有要嵌入的尺寸（会复用对应 frame）
base = frames[-1]
base.save(OUT, format="ICO", sizes=[(n, n) for n in SIZES], append_images=frames[:-1])
# 同时导出一张 PNG 备用（OG / 高分辨率引用）
render(512).save("favicon-512.png")
print(f"OK -> {OUT} ({SIZES}) + favicon-512.png")
