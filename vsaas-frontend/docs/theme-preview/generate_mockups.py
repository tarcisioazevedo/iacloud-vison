"""
Gera mockups PNG das telas principais do VSaaS em DOIS temas:
  - light (paridade PrivacyPage): bg slate-50, cards brancos
  - dark (Vercel/Linear-style): bg slate-950, cards slate-900

Mesma estrutura, mesma hierarquia tipográfica — só troca a paleta.
Ambos compartilham hero gradient azul-marinho (mantém identidade ICV).

Uso:
    python generate_mockups.py
    # Gera 01-dashboard-light.png, 01-dashboard-dark.png, … até 06-dark.png
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path

# ── Tema LIGHT (PrivacyPage style) ────────────────────────────────────────
LIGHT = {
    # Backgrounds
    'BG_PAGE':    (248, 250, 252),    # slate-50
    'BG_CARD':    (255, 255, 255),    # white
    'BG_NAV':     (255, 255, 255),    # white
    'BG_INPUT':   (248, 250, 252),    # slate-50
    'BG_HOVER':   (241, 245, 249),    # slate-100
    'BG_ACCENT':  (236, 254, 255),    # cyan-50
    # Borders
    'BORDER':     (226, 232, 240),    # slate-200
    'BORDER_STR': (203, 213, 225),    # slate-300
    # Text
    'TEXT_HEAD':  (15, 23, 42),       # slate-900
    'TEXT_BODY':  (71, 85, 105),      # slate-600
    'TEXT_META':  (100, 116, 139),    # slate-500
    'TEXT_DIM':   (148, 163, 184),    # slate-400
    'TEXT_INV':   (255, 255, 255),    # white (sobre dark hero)
    # Accent
    'ACCENT':     (8, 145, 178),      # cyan-600
    'ACCENT_HOV': (14, 116, 144),     # cyan-700
    'ACCENT_BG':  (236, 254, 255),    # cyan-50
    'ACCENT_FG':  (14, 116, 144),     # cyan-700 (text on accent-bg)
    # Status
    'EMERALD':    (16, 185, 129),
    'EMERALD_BG': (236, 253, 245),
    'ROSE':       (244, 63, 94),
    'ROSE_BG':    (255, 241, 242),
    'AMBER':      (245, 158, 11),
    'AMBER_BG':   (255, 251, 235),
    'VIOLET':     (139, 92, 246),
    'VIOLET_BG':  (245, 243, 255),
    # Shadow
    'SHADOW':     (15, 23, 42, 18),
    # Hero (mesmo gradient nos 2 temas — identidade da marca)
    'HERO':       [(11, 22, 41), (14, 42, 80), (3, 105, 161)],
    # Vídeo dark (sempre dark — vídeo IP precisa contraste)
    'VIDEO_BG':   (15, 23, 42),
    'VIDEO_GRID': (40, 50, 70),
}

# ── Tema DARK (Vercel/Linear style) ───────────────────────────────────────
# Inspirado em Vercel Dashboard + GitHub dark + Linear. Cards estruturados
# (slate-900 com border slate-800), não glass. Hierarquia tipográfica
# preservada — slate-50 heads, slate-300 body, slate-500 meta.
DARK = {
    # Backgrounds
    'BG_PAGE':    (2, 6, 23),         # slate-950
    'BG_CARD':    (15, 23, 42),       # slate-900
    'BG_NAV':     (15, 23, 42),       # slate-900
    'BG_INPUT':   (30, 41, 59),       # slate-800
    'BG_HOVER':   (30, 41, 59),       # slate-800
    'BG_ACCENT':  (8, 51, 68),        # cyan-950 escurecido
    # Borders
    'BORDER':     (30, 41, 59),       # slate-800
    'BORDER_STR': (51, 65, 85),       # slate-700
    # Text
    'TEXT_HEAD':  (248, 250, 252),    # slate-50
    'TEXT_BODY':  (203, 213, 225),    # slate-300
    'TEXT_META':  (148, 163, 184),    # slate-400
    'TEXT_DIM':   (100, 116, 139),    # slate-500
    'TEXT_INV':   (255, 255, 255),    # white (sobre dark hero — mesmo)
    # Accent (mais brilhante no dark pra contraste)
    'ACCENT':     (34, 211, 238),     # cyan-400
    'ACCENT_HOV': (103, 232, 249),    # cyan-300
    'ACCENT_BG':  (8, 51, 68),        # cyan-950
    'ACCENT_FG':  (34, 211, 238),     # cyan-400
    # Status (cores ajustadas pra brilhar no dark)
    'EMERALD':    (52, 211, 153),     # emerald-400
    'EMERALD_BG': (4, 47, 46),        # emerald-950
    'ROSE':       (251, 113, 133),    # rose-400
    'ROSE_BG':    (76, 5, 25),        # rose-950
    'AMBER':      (251, 191, 36),     # amber-400
    'AMBER_BG':   (69, 26, 3),        # amber-950
    'VIOLET':     (167, 139, 250),    # violet-400
    'VIOLET_BG':  (46, 16, 101),      # violet-950
    # Shadow (mais intensa no dark pra ler depth)
    'SHADOW':     (0, 0, 0, 80),
    # Hero (mesmo nos 2 — gradient azul-marinho identidade ICV)
    'HERO':       [(11, 22, 41), (14, 42, 80), (3, 105, 161)],
    # Vídeo (já era dark)
    'VIDEO_BG':   (10, 15, 30),
    'VIDEO_GRID': (30, 40, 60),
}


# ── Dimensões padrão ──────────────────────────────────────────────────────
W, H = 1440, 900
SIDEBAR_W = 220
TOPBAR_H = 56

OUT = Path(__file__).parent

# Variável global do tema atual — populada pelo loop main()
T = LIGHT


# ── Fonts ─────────────────────────────────────────────────────────────────
def get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        'C:/Windows/Fonts/segoeuib.ttf' if bold else 'C:/Windows/Fonts/segoeui.ttf',
        'C:/Windows/Fonts/calibrib.ttf' if bold else 'C:/Windows/Fonts/calibri.ttf',
        'C:/Windows/Fonts/arial.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for c in candidates:
        try:
            return ImageFont.truetype(c, size)
        except Exception:
            continue
    return ImageFont.load_default()

F_HUGE   = get_font(28, bold=True)
F_TITLE  = get_font(20, bold=True)
F_HEAD   = get_font(15, bold=True)
F_BODY   = get_font(13)
F_BODY_B = get_font(13, bold=True)
F_SMALL  = get_font(11)
F_SMALL_B= get_font(11, bold=True)
F_TINY   = get_font(9)
F_MONO   = get_font(11)


# ── Helpers ───────────────────────────────────────────────────────────────
def diagonal_gradient(d, box, c1, c2, c3=None):
    x0, y0, x1, y1 = box
    w = x1 - x0; h = y1 - y0
    diag = w + h
    for i in range(diag):
        t = i / max(1, diag - 1)
        if c3 is None:
            r = int(c1[0] + (c2[0]-c1[0])*t); g = int(c1[1] + (c2[1]-c1[1])*t); b = int(c1[2] + (c2[2]-c1[2])*t)
        else:
            if t < 0.5:
                tt = t / 0.5
                r = int(c1[0] + (c2[0]-c1[0])*tt); g = int(c1[1] + (c2[1]-c1[1])*tt); b = int(c1[2] + (c2[2]-c1[2])*tt)
            else:
                tt = (t - 0.5) / 0.5
                r = int(c2[0] + (c3[0]-c2[0])*tt); g = int(c2[1] + (c3[1]-c2[1])*tt); b = int(c2[2] + (c3[2]-c2[2])*tt)
        x_start = max(x0, x0 + i - h); y_start = max(y0, y0 + i - w)
        x_end   = min(x1, x0 + i);     y_end   = min(y1, y0 + i)
        d.line([(x_start, y_end), (x_end, y_start)], fill=(r, g, b))


def card(d, box, fill=None, border=None, radius=14):
    if fill is None: fill = T['BG_CARD']
    if border is None: border = T['BORDER']
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=border, width=1)


def shadow_card(img, box, radius=14):
    x0, y0, x1, y1 = box
    sh = Image.new('RGBA', img.size, (0,0,0,0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle((x0+1, y0+3, x1+1, y1+3), radius=radius, fill=T['SHADOW'])
    blurred = sh.filter(ImageFilter.GaussianBlur(8))
    img.paste(blurred, (0,0), blurred)


def pill(d, x, y, text, font, fg, bg, padx=8, pady=3):
    bbox = d.textbbox((0,0), text, font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    box = (x, y, x+tw+padx*2, y+th+pady*2)
    d.rounded_rectangle(box, radius=999, fill=bg)
    d.text((x+padx, y+pady-2), text, font=font, fill=fg)
    return box[2] - x


def button(d, x, y, text, font=F_BODY_B, w=None, fg=None, bg=None, padx=14, pady=8):
    if fg is None: fg = T['TEXT_INV']
    if bg is None: bg = T['ACCENT']
    bbox = d.textbbox((0,0), text, font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    if w is None: w = tw + padx*2
    h = th + pady*2
    d.rounded_rectangle((x, y, x+w, y+h), radius=8, fill=bg)
    d.text((x+(w-tw)//2, y+pady-2), text, font=font, fill=fg)
    return w, h


# ── Sidebar ───────────────────────────────────────────────────────────────
NAV_ITEMS = [
    ('🏠', 'Dashboard'),  ('📡', 'Ao Vivo'),    ('🗺',  'Mapa'),
    ('🎬', 'Gravações'),  ('🔔', 'Eventos'),    ('📷', 'Câmeras'),
    ('🏢', 'Sites'),      ('👤', 'Faces'),      ('🚗', 'Placas'),
    ('⚡', 'Gatilhos'),   ('🛡', 'Regras'),     ('📊', 'Analytics'),
    ('⚙',  'Configurações'),
]


def draw_sidebar(img, d, active_label: str):
    d.rectangle((0, 0, SIDEBAR_W, H), fill=T['BG_NAV'])
    d.line([(SIDEBAR_W, 0), (SIDEBAR_W, H)], fill=T['BORDER'], width=1)

    d.rectangle((0, 0, SIDEBAR_W, 64), fill=T['BG_NAV'])
    d.rounded_rectangle((16, 16, 48, 48), radius=8, fill=T['ACCENT'])
    d.text((22, 22), 'IC', font=F_BODY_B, fill=(255, 255, 255))
    d.text((58, 18), 'IA Cloud Vision', font=F_BODY_B, fill=T['TEXT_HEAD'])
    d.text((58, 36), 'VSaaS Analytics', font=F_TINY, fill=T['TEXT_META'])

    d.text((20, 80), 'OPERAÇÃO', font=F_TINY, fill=T['TEXT_DIM'])

    y = 102
    for icon, label in NAV_ITEMS:
        is_active = (label == active_label)
        if is_active:
            d.rounded_rectangle((10, y-4, SIDEBAR_W-10, y+24), radius=8, fill=T['ACCENT_BG'])
            d.rectangle((10, y-4, 14, y+24), fill=T['ACCENT'])
        d.text((22, y), icon, font=F_BODY,
               fill=T['ACCENT'] if is_active else T['TEXT_DIM'])
        d.text((46, y+1), label,
               font=F_BODY_B if is_active else F_BODY,
               fill=T['ACCENT_FG'] if is_active else T['TEXT_BODY'])
        y += 30

    # User pill
    d.rounded_rectangle((10, H-60, SIDEBAR_W-10, H-12), radius=10, fill=T['BG_INPUT'])
    d.ellipse((20, H-50, 48, H-22), fill=T['ACCENT'])
    d.text((30, H-43), 'TR', font=F_TINY, fill=(255, 255, 255))
    d.text((58, H-46), 'Tarcisio', font=F_BODY_B, fill=T['TEXT_BODY'])
    d.text((58, H-30), 'Super Admin', font=F_TINY, fill=T['TEXT_META'])


def draw_topbar(img, d, page_title: str, page_subtitle: str = ''):
    d.rectangle((SIDEBAR_W, 0, W, TOPBAR_H), fill=T['BG_NAV'])
    d.line([(SIDEBAR_W, TOPBAR_H), (W, TOPBAR_H)], fill=T['BORDER'], width=1)

    d.text((SIDEBAR_W+24, 14), page_title, font=F_HEAD, fill=T['TEXT_HEAD'])
    if page_subtitle:
        d.text((SIDEBAR_W+24, 34), page_subtitle, font=F_TINY, fill=T['TEXT_META'])

    sx = SIDEBAR_W + 350
    d.rounded_rectangle((sx, 12, sx+360, 44), radius=8, fill=T['BG_INPUT'], outline=T['BORDER'])
    d.text((sx+12, 22), '🔍', font=F_BODY, fill=T['TEXT_DIM'])
    d.text((sx+36, 22), 'Buscar câmeras, eventos…', font=F_BODY, fill=T['TEXT_DIM'])

    rx = W - 280
    for i, ic in enumerate(['🔄', '⬇', '🔔']):
        d.rounded_rectangle((rx+i*38, 14, rx+i*38+30, 42), radius=6, fill=T['BG_INPUT'])
        d.text((rx+i*38+9, 21), ic, font=F_BODY, fill=T['TEXT_META'])

    # AO VIVO badge — sempre rose (chamativo nos 2 temas)
    d.rounded_rectangle((rx+118, 16, rx+200, 40), radius=999, fill=T['ROSE'])
    d.ellipse((rx+128, 22, rx+138, 32), fill=(255, 255, 255))
    d.text((rx+144, 22), 'AO VIVO', font=F_SMALL_B, fill=(255, 255, 255))

    # Theme toggle button (NOVO — botão de troca claro/escuro)
    tx = rx - 50
    d.rounded_rectangle((tx, 14, tx+40, 42), radius=999, fill=T['BG_INPUT'], outline=T['BORDER'])
    is_dark_theme = T is DARK
    d.text((tx+10, 21), '🌙' if is_dark_theme else '☀', font=F_BODY, fill=T['ACCENT'])


# ── Tela 1: Dashboard ─────────────────────────────────────────────────────
def render_dashboard():
    img = Image.new('RGB', (W, H), T['BG_PAGE'])
    d = ImageDraw.Draw(img)
    draw_sidebar(img, d, 'Dashboard')
    draw_topbar(img, d, 'Dashboard Analítico', 'Shopping · domingo, 27 de abril de 2026')

    diagonal_gradient(d, (SIDEBAR_W+24, 80, W-24, 200), *T['HERO'])
    d.rounded_rectangle((SIDEBAR_W+24, 80, W-24, 200), radius=16)
    pill(d, SIDEBAR_W+44, 100, 'VISÃO GERAL', F_TINY, T['ACCENT'], (255,255,255,30))
    d.text((SIDEBAR_W+44, 124), 'Olá, Tarcisio!', font=F_HUGE, fill=(255, 255, 255))
    d.text((SIDEBAR_W+44, 162), '8 câmeras ativas · 6.169 segmentos gravados hoje',
           font=F_BODY, fill=(203, 213, 225))

    kpis = [
        ('Câmeras Ativas', '8',     '/ 8 total',      T['ACCENT'],  T['EMERALD'], T['EMERALD_BG'], '+0%'),
        ('Pessoas (24h)',  '1.247', '+12% vs ontem',  T['VIOLET'],  T['EMERALD'], T['EMERALD_BG'], '↑'),
        ('Alertas Críticos','3',    '2 pendentes',    T['ROSE'],    T['AMBER'],   T['AMBER_BG'],   '!'),
        ('Storage usado',  '4,2 TB','de 10 TB',       T['AMBER'],   T['ACCENT'],  T['ACCENT_BG'],  '42%'),
    ]
    cw = (W - SIDEBAR_W - 48 - 18*3) // 4
    for i, (label, val, sub, color, dot_fg, dot_bg, badge) in enumerate(kpis):
        x = SIDEBAR_W + 24 + i*(cw+18); y = 220
        shadow_card(img, (x, y, x+cw, y+128))
        card(d, (x, y, x+cw, y+128))
        d.ellipse((x+18, y+18, x+34, y+34), fill=color)
        d.text((x+44, y+18), label, font=F_SMALL_B, fill=T['TEXT_META'])
        d.text((x+18, y+50), val, font=F_HUGE, fill=T['TEXT_HEAD'])
        d.text((x+18, y+92), sub, font=F_TINY, fill=T['TEXT_META'])
        pill(d, x+cw-60, y+18, badge, F_TINY, dot_fg, dot_bg)

    # Chart card
    cy = 370
    shadow_card(img, (SIDEBAR_W+24, cy, W-24-380, cy+340))
    card(d, (SIDEBAR_W+24, cy, W-24-380, cy+340))
    d.text((SIDEBAR_W+44, cy+20), 'Fluxo de pessoas (últimas 24h)', font=F_HEAD, fill=T['TEXT_HEAD'])
    d.text((SIDEBAR_W+44, cy+44), 'Pico: 14h-15h · 142 detecções', font=F_TINY, fill=T['TEXT_META'])

    chart_x = SIDEBAR_W + 64; chart_y = cy + 90
    chart_w = W - 24 - 380 - SIDEBAR_W - 80
    bars = [40, 28, 18, 12, 25, 55, 88, 95, 76, 60, 45, 42, 65, 92, 110, 132, 142, 128, 95, 78, 65, 52, 42, 35]
    bw = chart_w // len(bars) - 2
    bh_max = 200; max_val = max(bars)
    for i, v in enumerate(bars):
        bh = int((v/max_val) * bh_max)
        bx = chart_x + i*(bw+2)
        c = T['ACCENT'] if v == max_val else T['ACCENT_BG']
        d.rounded_rectangle((bx, chart_y+bh_max-bh, bx+bw, chart_y+bh_max), radius=2, fill=c)
        if i % 4 == 0:
            d.text((bx, chart_y+bh_max+8), f'{i:02d}h', font=F_TINY, fill=T['TEXT_DIM'])

    # Events sidebar
    ex = W - 24 - 360
    shadow_card(img, (ex, cy, ex+360, cy+340))
    card(d, (ex, cy, ex+360, cy+340))
    d.text((ex+20, cy+20), 'Eventos recentes', font=F_HEAD, fill=T['TEXT_HEAD'])
    pill(d, ex+220, cy+22, '8 NOVOS', F_TINY, (255,255,255), T['ROSE'])

    events = [
        ('14:32:08', 'Pessoa detectada', 'Entrada Principal', T['ROSE'],    '!'),
        ('14:28:45', 'PPE: capacete OK',  'Doca 2',            T['EMERALD'], '✓'),
        ('14:21:12', 'Placa ABC-1234',     'Estacionamento',   T['ACCENT'],  'P'),
        ('14:18:33', 'Movimento',          'Recepção',          T['AMBER'],   '∿'),
        ('14:12:09', 'Face: Maria',        'Portaria',          T['VIOLET'],  '👤'),
    ]
    ey = cy + 64
    for time, title, place, color, ic in events:
        d.ellipse((ex+20, ey, ex+44, ey+24), fill=color)
        d.text((ex+27, ey+5), ic, font=F_SMALL_B, fill=(255,255,255))
        d.text((ex+56, ey),   title, font=F_BODY_B, fill=T['TEXT_HEAD'])
        d.text((ex+56, ey+18), f'{place} · {time}', font=F_TINY, fill=T['TEXT_META'])
        ey += 50

    img.save(OUT / '01-dashboard.png', optimize=True)


# ── Tela 2: Live ──────────────────────────────────────────────────────────
def render_live():
    img = Image.new('RGB', (W, H), T['BG_PAGE'])
    d = ImageDraw.Draw(img)
    draw_sidebar(img, d, 'Ao Vivo')
    draw_topbar(img, d, 'Visualização ao Vivo',
                'Mosaico multi-câmera · WebRTC (WHEP) com fallback Snapshot')

    fy = 80
    shadow_card(img, (SIDEBAR_W+24, fy, W-24, fy+56))
    card(d, (SIDEBAR_W+24, fy, W-24, fy+56))
    bx = SIDEBAR_W + 44
    button(d, bx, fy+14, '◐ Migrado (1)', F_SMALL_B,
           fg=(255,255,255), bg=T['TEXT_HEAD'], padx=12, pady=7)
    bx += 130
    for label in ['1×1', '2×2', '3×3', '4×4', '5×5', '6×6']:
        is_act = label == '3×3'
        w, h = button(d, bx, fy+14, label, F_SMALL_B,
            fg=(255,255,255) if is_act else T['TEXT_BODY'],
            bg=T['ACCENT']   if is_act else T['BG_HOVER'], padx=12, pady=7)
        bx += w + 6
    bx += 20
    button(d, bx, fy+14, '▶ Auto · off', F_SMALL_B,
           fg=T['TEXT_BODY'], bg=T['BG_HOVER'], padx=12, pady=7)
    bx += 130
    button(d, bx, fy+14, '📅 Data/Hora', F_SMALL_B,
           fg=T['TEXT_BODY'], bg=T['BG_HOVER'], padx=12, pady=7)

    grid_x = SIDEBAR_W + 24
    grid_y = fy + 76
    grid_w = W - 24 - grid_x
    grid_h = H - grid_y - 24
    cols, rows = 3, 3
    gap = 8
    cell_w = (grid_w - gap*(cols-1)) // cols
    cell_h = (grid_h - gap*(rows-1)) // rows

    cam_names = ['Entrada Principal', 'Doca 2', 'Recepção', 'Pátio', 'Estoque', 'Caixa 1', 'Vitrine', 'Câmera 8', 'Câmera 9']
    statuses  = ['live','live','snapshot','live','live','playback','live','live','live']

    for i in range(9):
        cx = grid_x + (i % cols) * (cell_w + gap)
        cy = grid_y + (i // cols) * (cell_h + gap)
        d.rounded_rectangle((cx, cy, cx+cell_w, cy+cell_h), radius=8, fill=T['VIDEO_BG'])
        for j in range(20):
            cc = (40+j*2, 60+j*2, 100+j*2)
            d.rectangle((cx+j*4, cy+j*4, cx+cell_w-j*4, cy+cell_h-j*4), outline=cc)

        pill(d, cx+8, cy+8, cam_names[i], F_TINY, (255,255,255), (15, 23, 42, 200))

        st = statuses[i]
        if st == 'live':
            pill(d, cx+cell_w-80, cy+8, '● LIVE', F_TINY, (255,255,255), T['ROSE'])
        elif st == 'snapshot':
            pill(d, cx+cell_w-110, cy+8, '◐ SNAPSHOT', F_TINY, (255,255,255), T['AMBER'])
        else:
            pill(d, cx+cell_w-105, cy+8, '⏪ HISTÓRICO', F_TINY, (255,255,255), T['VIOLET'])

        pill(d, cx+cell_w-95, cy+cell_h-26, '1080p · 15fps', F_TINY, (200,200,200), (15, 23, 42, 200))
        d.text((cx+10, cy+cell_h-22), f'#{i+1}', font=F_TINY, fill=(180, 200, 220))

    img.save(OUT / '02-live-mosaic.png', optimize=True)


# ── Tela 3: Mapa ──────────────────────────────────────────────────────────
def render_map():
    img = Image.new('RGB', (W, H), T['BG_PAGE'])
    d = ImageDraw.Draw(img)
    draw_sidebar(img, d, 'Mapa')
    draw_topbar(img, d, 'Mapa de Câmeras', '8/8 câmeras com coordenadas')

    list_x = SIDEBAR_W + 24; list_y = 80; list_w = 320
    map_x  = list_x + list_w + 16; map_w = W - 24 - map_x; bottom = H - 24

    shadow_card(img, (list_x, list_y, list_x+list_w, bottom))
    card(d, (list_x, list_y, list_x+list_w, bottom))
    d.rounded_rectangle((list_x+16, list_y+16, list_x+list_w-16, list_y+44), radius=8, fill=T['BG_INPUT'], outline=T['BORDER'])
    d.text((list_x+28, list_y+22), '🔍  Buscar câmera (nome / site)…', font=F_TINY, fill=T['TEXT_DIM'])
    d.rounded_rectangle((list_x+16, list_y+56, list_x+list_w-16, list_y+84), radius=8, fill=T['BG_INPUT'], outline=T['BORDER'])
    d.text((list_x+28, list_y+62), 'Todos os sites', font=F_TINY, fill=T['TEXT_META'])
    d.rounded_rectangle((list_x+16, list_y+96, list_x+list_w-16, list_y+124), radius=8, fill=T['BG_INPUT'], outline=T['BORDER'])
    d.text((list_x+28, list_y+102), 'Todos os modos', font=F_TINY, fill=T['TEXT_META'])
    d.text((list_x+16, list_y+136), '⏷ 8 câmeras no mapa', font=F_TINY, fill=T['TEXT_META'])

    items = [
        ('nova',                'Piso Térreo', '-23.550, -46.633', T['EMERALD']),
        ('Teste',               'Piso Térreo', '-23.550, -46.633', T['EMERALD']),
        ('Camera Wizard E2E v2','Piso Térreo', '-23.550, -46.633', T['EMERALD']),
        ('Cam Cripto Test',     'Piso Térreo', '-23.550, -46.633', T['AMBER']),
        ('Cam Empty Site',      'Piso Térreo', '-23.550, -46.633', T['TEXT_DIM']),
        ('Cam Auto-Site',       'Piso Térreo', '-23.550, -46.633', T['EMERALD']),
        ('Camera Teste Barra',  'Piso Térreo', '-23.550, -46.633', T['EMERALD']),
        ('Entrada Principal',   'Piso Térreo', '-23.550, -46.633', T['EMERALD']),
    ]
    iy = list_y + 168
    for name, site, coord, color in items:
        d.rounded_rectangle((list_x+12, iy, list_x+list_w-12, iy+62), radius=8,
                            fill=T['BG_INPUT'], outline=T['BORDER'])
        d.rounded_rectangle((list_x+24, iy+10, list_x+50, iy+36), radius=6, fill=color)
        d.text((list_x+30, iy+14), '📷', font=F_BODY, fill=(255,255,255))
        d.text((list_x+60, iy+10), name, font=F_BODY_B, fill=T['TEXT_HEAD'])
        d.text((list_x+60, iy+28), site, font=F_TINY, fill=T['TEXT_META'])
        d.text((list_x+60, iy+44), f'📍 {coord}', font=F_TINY, fill=T['EMERALD'])
        iy += 70
        if iy > bottom - 70: break

    # Map area
    shadow_card(img, (map_x, list_y, W-24, bottom))
    card(d, (map_x, list_y, W-24, bottom))
    d.rounded_rectangle((map_x+16, list_y+16, map_x+map_w-280, list_y+44), radius=8, fill=T['BG_INPUT'], outline=T['BORDER'])
    d.text((map_x+28, list_y+22), '🧭  Buscar endereço (ex: Av Paulista, SP)', font=F_TINY, fill=T['TEXT_DIM'])
    button(d, map_x+map_w-244, list_y+16, 'Ir', F_SMALL_B, w=44,
           fg=(255,255,255), bg=T['ACCENT'], padx=10, pady=7)

    lx = map_x + map_w - 190
    for i, (color, label) in enumerate([(T['EMERALD'], 'ativa'), (T['AMBER'], 'manutenção'), (T['ROSE'], 'erro'), (T['TEXT_DIM'], 'pendente')]):
        d.ellipse((lx+i*45, list_y+24, lx+i*45+8, list_y+32), fill=color)
        d.text((lx+i*45+12, list_y+22), label, font=F_TINY, fill=T['TEXT_META'])

    # Map area dark (sempre dark — leaflet com tile dark)
    map_area = (map_x+16, list_y+60, W-40, bottom-16)
    d.rounded_rectangle(map_area, radius=10, fill=(28, 36, 56))
    for off in range(0, map_area[3]-map_area[1], 30):
        d.line([(map_area[0], map_area[1]+off), (map_area[2], map_area[1]+off)], fill=(40, 50, 70), width=1)
    for off in range(0, map_area[2]-map_area[0], 50):
        d.line([(map_area[0]+off, map_area[1]), (map_area[0]+off, map_area[3])], fill=(40, 50, 70), width=1)

    cx = map_area[0] + (map_area[2]-map_area[0])//2 - 200
    cy_pin = map_area[1] + (map_area[3]-map_area[1])//2
    d.ellipse((cx-40, cy_pin-40, cx+40, cy_pin+40), fill=(6, 182, 212, 200), outline=(6, 182, 212))
    d.text((cx-8, cy_pin-12), '8', font=F_TITLE, fill=(255,255,255))
    pill(d, cx-50, cy_pin+50, '8 câmeras · São Paulo', F_TINY, (255,255,255), (15, 23, 42, 220))

    img.save(OUT / '03-map.png', optimize=True)


# ── Tela 4: Recordings ────────────────────────────────────────────────────
def render_recordings():
    img = Image.new('RGB', (W, H), T['BG_PAGE'])
    d = ImageDraw.Draw(img)
    draw_sidebar(img, d, 'Gravações')
    draw_topbar(img, d, 'Gravações', 'HLS playback · revisar histórico por câmera e dia')

    list_x = SIDEBAR_W + 24; list_y = 80; list_w = 280
    main_x = list_x + list_w + 16

    shadow_card(img, (list_x, list_y, list_x+list_w, H-24))
    card(d, (list_x, list_y, list_x+list_w, H-24))
    d.rounded_rectangle((list_x+12, list_y+14, list_x+list_w-12, list_y+40), radius=8, fill=T['BG_INPUT'], outline=T['BORDER'])
    d.text((list_x+24, list_y+19), '🔍  Buscar câmera…', font=F_TINY, fill=T['TEXT_DIM'])
    d.text((list_x+12, list_y+54), '⏷ 8 câmeras com gravação habilitada', font=F_TINY, fill=T['TEXT_META'])

    cams = ['nova', 'Teste', 'Camera Wizard E2E v2', 'Cam Cripto Test', 'Cam Empty Site', 'Cam Auto-Site', 'Camera Teste Barra', 'Entrada Principal']
    iy = list_y + 78
    for i, name in enumerate(cams):
        is_sel = i == 0
        if is_sel:
            d.rounded_rectangle((list_x+8, iy, list_x+list_w-8, iy+58), radius=10,
                                fill=T['AMBER_BG'], outline=T['AMBER'], width=2)
        else:
            d.rounded_rectangle((list_x+8, iy, list_x+list_w-8, iy+58), radius=10,
                                fill=T['BG_INPUT'], outline=T['BORDER'])
        d.rounded_rectangle((list_x+18, iy+10, list_x+44, iy+36), radius=6, fill=T['EMERALD'])
        d.text((list_x+24, iy+14), '📷', font=F_BODY, fill=(255,255,255))
        d.text((list_x+54, iy+10), name, font=F_BODY_B if is_sel else F_BODY, fill=T['TEXT_HEAD'])
        d.text((list_x+54, iy+28), 'Piso Térreo', font=F_TINY, fill=T['TEXT_META'])
        d.text((list_x+54, iy+44), 'Retém 7d · MOTION', font=F_TINY, fill=T['TEXT_DIM'])
        iy += 64

    dy = list_y
    shadow_card(img, (main_x, dy, W-24, dy+56))
    card(d, (main_x, dy, W-24, dy+56))
    d.text((main_x+16, dy+18), '📅', font=F_BODY, fill=T['AMBER'])
    button(d, main_x+44, dy+14, '◀', F_SMALL_B, w=30,
           fg=T['TEXT_BODY'], bg=T['BG_HOVER'], padx=8, pady=7)
    d.rounded_rectangle((main_x+82, dy+14, main_x+200, dy+44), radius=6,
                        fill=T['BG_INPUT'], outline=T['BORDER'])
    d.text((main_x+96, dy+22), '27/04/2026', font=F_BODY_B, fill=T['TEXT_HEAD'])
    button(d, main_x+208, dy+14, '▶', F_SMALL_B, w=30,
           fg=T['TEXT_BODY'], bg=T['BG_HOVER'], padx=8, pady=7)
    button(d, main_x+248, dy+14, 'Hoje', F_SMALL_B,
           fg=T['TEXT_BODY'], bg=T['BG_HOVER'], padx=12, pady=7)
    d.text((W-280, dy+22), '🕐 ', font=F_BODY, fill=T['TEXT_META'])
    d.text((W-256, dy+22), '892min de gravação neste dia', font=F_TINY, fill=T['TEXT_META'])

    py = dy + 70; p_h = 380
    d.rounded_rectangle((main_x, py, W-24, py+p_h), radius=12, fill=T['VIDEO_BG'])
    for j in range(40):
        c = (30+j, 50+j, 100+j)
        d.rectangle((main_x+j*8, py+j*4, W-24-j*8, py+p_h-j*4), outline=c)
    pill(d, main_x+16, py+16, 'PLAYBACK', F_TINY, (255,255,255), T['AMBER'])
    pill(d, main_x+108, py+16, '1×', F_TINY, (255,255,255), T['ACCENT'])
    d.rectangle((main_x, py+p_h-44, W-24, py+p_h), fill=(15, 23, 42))
    button(d, main_x+16, py+p_h-36, '▶', F_BODY_B, w=30,
           fg=(255,255,255), bg=(255,255,255,30), padx=8, pady=7)
    d.text((main_x+60, py+p_h-30), '14:32:08 / 23:59:55', font=F_MONO, fill=(255,255,255))
    d.text((W-100, py+p_h-30), '⛶ HD', font=F_MONO, fill=(255,255,255))

    ty = py + p_h + 12
    shadow_card(img, (main_x, ty, W-24, ty+96))
    card(d, (main_x, ty, W-24, ty+96))
    d.text((main_x+16, ty+10), 'Zoom:', font=F_TINY, fill=T['TEXT_META'])
    bx = main_x + 56
    for label in ['+', '−', '24h', '1h', '30m']:
        w_btn = 30 if label in ('+','−') else 36
        d.rounded_rectangle((bx, ty+8, bx+w_btn, ty+30), radius=6, fill=T['BG_HOVER'])
        d.text((bx+8, ty+12), label, font=F_TINY, fill=T['TEXT_BODY'])
        bx += w_btn + 4
    d.text((W-220, ty+12), '00:00 — 23:59 · 24h visível', font=F_TINY, fill=T['TEXT_META'])

    tx0 = main_x + 16; tx1 = W - 40
    d.rounded_rectangle((tx0, ty+44, tx1, ty+82), radius=6, fill=T['BG_INPUT'], outline=T['BORDER'])
    for r in [(0.08, 0.18), (0.25, 0.35), (0.42, 0.85), (0.90, 0.96)]:
        rx0 = tx0 + int((tx1-tx0)*r[0])
        rx1 = tx0 + int((tx1-tx0)*r[1])
        d.rounded_rectangle((rx0, ty+46, rx1, ty+80), radius=3, fill=T['ACCENT'])
    for h in range(0, 25, 3):
        hx = tx0 + int((tx1-tx0)*(h/24))
        d.line([(hx, ty+44), (hx, ty+82)], fill=T['BORDER_STR'])
        d.text((hx-10, ty+82), f'{h:02d}h', font=F_TINY, fill=T['TEXT_DIM'])
    ph_x = tx0 + int((tx1-tx0)*0.605)
    d.rectangle((ph_x-1, ty+40, ph_x+1, ty+86), fill=T['AMBER'])
    d.ellipse((ph_x-5, ty+38, ph_x+5, ty+48), fill=T['AMBER'])

    img.save(OUT / '04-recordings.png', optimize=True)


# ── Tela 5: Cameras (lista) ───────────────────────────────────────────────
def render_cameras():
    img = Image.new('RGB', (W, H), T['BG_PAGE'])
    d = ImageDraw.Draw(img)
    draw_sidebar(img, d, 'Câmeras')
    draw_topbar(img, d, 'Câmeras', 'Gerenciar dispositivos cadastrados')

    fy = 80
    shadow_card(img, (SIDEBAR_W+24, fy, W-24, fy+56))
    card(d, (SIDEBAR_W+24, fy, W-24, fy+56))
    d.rounded_rectangle((SIDEBAR_W+44, fy+14, SIDEBAR_W+44+340, fy+44), radius=8,
                        fill=T['BG_INPUT'], outline=T['BORDER'])
    d.text((SIDEBAR_W+58, fy+22), '🔍  Buscar por nome, IP, site…', font=F_BODY, fill=T['TEXT_DIM'])

    bx = SIDEBAR_W + 410
    for label, count, color in [
        ('Todas', 8, T['ACCENT']),
        ('Online', 7, T['EMERALD']),
        ('Offline', 1, T['ROSE']),
        ('Manutenção', 0, T['AMBER']),
    ]:
        is_act = label == 'Todas'
        text = f'{label} ({count})'
        bbox = d.textbbox((0,0), text, font=F_SMALL_B); tw = bbox[2]-bbox[0]
        wbtn = tw + 28
        d.rounded_rectangle((bx, fy+14, bx+wbtn, fy+44), radius=999,
                            fill=color if is_act else T['BG_HOVER'])
        d.text((bx+14, fy+22), text, font=F_SMALL_B,
               fill=(255,255,255) if is_act else T['TEXT_BODY'])
        bx += wbtn + 8

    bx = W - 200
    button(d, bx, fy+14, '+ Nova câmera', F_SMALL_B,
           fg=(255,255,255), bg=T['ACCENT'], padx=14, pady=8)

    ty = fy + 76
    shadow_card(img, (SIDEBAR_W+24, ty, W-24, H-24))
    card(d, (SIDEBAR_W+24, ty, W-24, H-24))

    cols_x = [SIDEBAR_W+44, SIDEBAR_W+260, SIDEBAR_W+440, SIDEBAR_W+600,
              SIDEBAR_W+760, SIDEBAR_W+920, W-180]
    headers = ['Câmera', 'Site', 'Modo', 'Status', 'Última atividade', 'Resolução', 'Ações']
    for i, h_label in enumerate(headers):
        d.text((cols_x[i], ty+18), h_label.upper(), font=F_TINY, fill=T['TEXT_META'])
    d.line([(SIDEBAR_W+24, ty+44), (W-24, ty+44)], fill=T['BORDER'])

    rows = [
        ('nova',                 'Piso Térreo', 'RTSP Pull', 'ATIVA',     '2 seg atrás',  '1920×1080', T['EMERALD']),
        ('Teste',                'Piso Térreo', 'RTSP Pull', 'ATIVA',     '5 seg atrás',  '1920×1080', T['EMERALD']),
        ('Camera Wizard E2E v2', 'Piso Térreo', 'RTMP Push', 'ATIVA',     '1 min atrás',  '640×480',   T['EMERALD']),
        ('Cam Cripto Test',      'Piso Térreo', 'RTSP Pull', 'MANUTENÇÃO', '2 min atrás',  '—',         T['AMBER']),
        ('Cam Empty Site',       'Sem site',    '—',         'PENDENTE',  '—',            '—',         T['TEXT_DIM']),
        ('Cam Auto-Site',        'Piso Térreo', 'RTSP Pull', 'ATIVA',     '3 seg atrás',  '640×480',   T['EMERALD']),
        ('Camera Teste Barra',   'Piso Térreo', 'RTSP Pull', 'ATIVA',     '1 seg atrás',  '640×480',   T['EMERALD']),
        ('Entrada Principal',    'Piso Térreo', 'RTSP Pull', 'ATIVA',     '1 seg atrás',  '1920×1080', T['EMERALD']),
    ]
    ry = ty + 56
    for i, (name, site, mode, status, last, res, color) in enumerate(rows):
        if i % 2 == 0:
            d.rectangle((SIDEBAR_W+24, ry-8, W-24, ry+44), fill=T['BG_INPUT'])
        d.rounded_rectangle((cols_x[0], ry, cols_x[0]+24, ry+24), radius=6, fill=color)
        d.text((cols_x[0]+6, ry+4), '📷', font=F_TINY, fill=(255,255,255))
        d.text((cols_x[0]+34, ry+4), name, font=F_BODY_B, fill=T['TEXT_HEAD'])
        d.text((cols_x[0]+34, ry+22), '192.168.0.222', font=F_TINY, fill=T['TEXT_META'])
        d.text((cols_x[1], ry+10), site, font=F_BODY, fill=T['TEXT_BODY'])
        if mode != '—':
            mode_color = T['ACCENT_BG'] if mode.startswith('RTSP') else T['AMBER_BG']
            mode_fg    = T['ACCENT_FG'] if mode.startswith('RTSP') else T['AMBER']
            pill(d, cols_x[2], ry+8, mode, F_TINY, mode_fg, mode_color)
        else:
            d.text((cols_x[2], ry+10), '—', font=F_BODY, fill=T['TEXT_DIM'])
        st_color = T['EMERALD_BG'] if status == 'ATIVA' else T['AMBER_BG'] if status == 'MANUTENÇÃO' else T['BG_HOVER']
        st_fg    = T['EMERALD']    if status == 'ATIVA' else T['AMBER']    if status == 'MANUTENÇÃO' else T['TEXT_DIM']
        pill(d, cols_x[3], ry+8, status, F_TINY, st_fg, st_color)
        d.text((cols_x[4], ry+10), last, font=F_TINY, fill=T['TEXT_META'])
        d.text((cols_x[5], ry+10), res, font=F_MONO, fill=T['TEXT_META'])
        button(d, cols_x[6], ry+4, '⚙', F_SMALL, w=30,
               fg=T['TEXT_BODY'], bg=T['BG_HOVER'], padx=8, pady=4)
        button(d, cols_x[6]+38, ry+4, '🗑', F_SMALL, w=30,
               fg=T['ROSE'], bg=T['ROSE_BG'], padx=8, pady=4)
        ry += 52

    img.save(OUT / '05-cameras-list.png', optimize=True)


# ── Tela 6: Camera Detail / Config ────────────────────────────────────────
def render_camera_config():
    img = Image.new('RGB', (W, H), T['BG_PAGE'])
    d = ImageDraw.Draw(img)
    draw_sidebar(img, d, 'Câmeras')
    draw_topbar(img, d, 'nova', '1b1005ff · oilaaaa · Piso Térreo')

    diagonal_gradient(d, (SIDEBAR_W+24, 80, W-24, 180), *T['HERO'])
    d.rounded_rectangle((SIDEBAR_W+24, 80, W-24, 180), radius=14)
    pill(d, SIDEBAR_W+44, 100, '● ATIVA', F_TINY, (255,255,255), T['EMERALD'])
    pill(d, SIDEBAR_W+128, 100, 'GOLD', F_TINY, (255,255,255), T['AMBER'])
    d.text((SIDEBAR_W+44, 124), 'nova', font=F_HUGE, fill=(255, 255, 255))
    d.text((SIDEBAR_W+44, 158), '1920×1080 @ 15fps · H.264 · RTSP Pull · Piso Térreo',
           font=F_BODY, fill=(203, 213, 225))

    button(d, W - 320, 116, '▶ Testar RTSP', F_SMALL_B,
           fg=T['TEXT_HEAD'], bg=(255,255,255), padx=14, pady=8)
    button(d, W - 184, 116, '📷 Snapshot',   F_SMALL_B,
           fg=T['TEXT_HEAD'], bg=(255,255,255), padx=14, pady=8)

    ty = 200
    tabs = ['Live', 'Config', 'Zonas', 'Eventos', 'Logs', 'Faces', 'LPR', 'Stats']
    tx = SIDEBAR_W + 24
    for t_label in tabs:
        is_act = t_label == 'Config'
        bbox = d.textbbox((0,0), t_label, font=F_BODY_B if is_act else F_BODY)
        tw = bbox[2]-bbox[0]
        if is_act:
            d.text((tx, ty), t_label, font=F_BODY_B, fill=T['ACCENT_FG'])
            d.line([(tx, ty+24), (tx+tw, ty+24)], fill=T['ACCENT'], width=2)
        else:
            d.text((tx, ty), t_label, font=F_BODY, fill=T['TEXT_META'])
        tx += tw + 28
    d.line([(SIDEBAR_W+24, ty+25), (W-24, ty+25)], fill=T['BORDER'])

    gy = ty + 44
    col_w = (W - 24 - SIDEBAR_W - 24 - 16) // 2
    col_x = [SIDEBAR_W+24, SIDEBAR_W+24+col_w+16]

    def card_section(x, y, w, h, title, body_fn=None, badge=None, badge_color=None):
        shadow_card(img, (x, y, x+w, y+h))
        card(d, (x, y, x+w, y+h))
        d.text((x+20, y+18), title, font=F_HEAD, fill=T['ACCENT_FG'])
        if badge:
            pill(d, x+w-130, y+22, badge, F_TINY,
                 badge_color or T['EMERALD'],
                 T['EMERALD_BG'])
        if body_fn: body_fn(x, y, w, h)

    def body_ingest(x, y, w, h):
        d.rounded_rectangle((x+20, y+50, x+20+(w-56)//2, y+130), radius=8,
                            fill=T['BG_INPUT'], outline=T['BORDER'])
        d.ellipse((x+34, y+62, x+50, y+78), outline=T['TEXT_DIM'], width=2)
        d.text((x+58, y+62), 'RTSP Pull', font=F_BODY_B, fill=T['TEXT_BODY'])
        d.text((x+34, y+86), 'Backend puxa RTSP. Requer rede local,', font=F_TINY, fill=T['TEXT_META'])
        d.text((x+34, y+102), 'edge ou port-forward. Sub-segundo.', font=F_TINY, fill=T['TEXT_META'])

        x2 = x + 36 + (w-56)//2
        d.rounded_rectangle((x2, y+50, x2+(w-56)//2, y+130), radius=8,
                            fill=T['ACCENT_BG'], outline=T['ACCENT'], width=2)
        d.ellipse((x2+14, y+62, x2+30, y+78), fill=T['ACCENT'])
        d.text((x2+38, y+62), 'RTMP Push  ⭐', font=F_BODY_B, fill=T['ACCENT_FG'])
        pill(d, x2+150, y+62, 'recomendado', F_TINY, T['EMERALD'], T['EMERALD_BG'])
        d.text((x2+14, y+86), 'Câmera empurra RTMP. Atravessa NAT', font=F_TINY, fill=T['TEXT_META'])
        d.text((x2+14, y+102), 'sem hardware. 2-5s latência.', font=F_TINY, fill=T['TEXT_META'])

        # URL block — sempre dark (terminal style) nos 2 temas
        d.rounded_rectangle((x+20, y+150, x+w-20, y+232), radius=8,
                            fill=(15, 23, 42), outline=T['BORDER_STR'])
        d.text((x+34, y+162), 'URL DE INGESTÃO', font=F_TINY, fill=(148, 163, 184))
        d.rounded_rectangle((x+34, y+180, x+w-100, y+208), radius=6, fill=(30, 41, 59))
        d.text((x+44, y+186), 'rtmp://ingest.iacloud.com.br/live/cam_xY9aB...', font=F_MONO, fill=(34, 211, 238))
        button(d, x+w-86, y+180, '📋 Copiar', F_TINY,
               fg=T['TEXT_BODY'], bg=T['BG_CARD'], padx=10, pady=4)
        d.text((x+34, y+216), 'Stream key cifrada AES-256-GCM antes de persistir', font=F_TINY, fill=(148, 163, 184))

    card_section(col_x[0], gy, col_w*2+16, 280, 'Modo de ingestão',
                 body_fn=body_ingest, badge='● recebendo stream', badge_color=T['EMERALD'])

    gy2 = gy + 296; h_stream = 220

    def body_stream(x, y, w, h):
        d.text((x+20, y+50), 'URL principal (rtsp://...)', font=F_TINY, fill=T['TEXT_META'])
        d.rounded_rectangle((x+20, y+68, x+w-20, y+94), radius=6,
                            fill=T['BG_INPUT'], outline=T['BORDER'])
        d.text((x+30, y+74), 'rtsp://admin:•••••••@192.168.0.222:554/Streaming/Channels/101',
               font=F_MONO, fill=T['TEXT_BODY'])

        d.text((x+20, y+108), 'Usuário', font=F_TINY, fill=T['TEXT_META'])
        d.rounded_rectangle((x+20, y+126, x+(w-50)//2, y+152), radius=6,
                            fill=T['BG_INPUT'], outline=T['BORDER'])
        d.text((x+30, y+132), 'admin', font=F_BODY, fill=T['TEXT_BODY'])
        d.text((x+30+(w-50)//2, y+108), 'Senha', font=F_TINY, fill=T['TEXT_META'])
        d.rounded_rectangle((x+30+(w-50)//2, y+126, x+w-20, y+152), radius=6,
                            fill=T['BG_INPUT'], outline=T['BORDER'])
        d.text((x+40+(w-50)//2, y+132), '••••••••', font=F_MONO, fill=T['TEXT_META'])

        d.text((x+20, y+170), '🔒 Senha cifrada AES-256-GCM. Após salvar, campo aparece vazio — preencha para alterar.',
               font=F_TINY, fill=T['TEXT_META'])

    card_section(col_x[0], gy2, col_w*2+16, h_stream, 'Stream / RTSP', body_fn=body_stream)

    gy3 = gy2 + h_stream + 16

    def body_edge(x, y, w, h):
        d.rounded_rectangle((x+20, y+50, x+w-20, y+78), radius=6,
                            fill=T['BG_INPUT'], outline=T['BORDER'])
        d.text((x+30, y+56), 'ICV-EDGE-001 · ONLINE · Raspberry Pi 5', font=F_BODY_B, fill=T['TEXT_BODY'])
        d.text((x+30, y+72), '↓', font=F_TINY, fill=T['TEXT_DIM'])
        d.text((x+20, y+90), 'go2rtc:', font=F_TINY, fill=T['TEXT_META'])
        d.text((x+72, y+90), 'http://172.17.0.1:1984', font=F_MONO, fill=T['EMERALD'])
        d.text((x+20, y+108), 'Último heartbeat:', font=F_TINY, fill=T['TEXT_META'])
        d.text((x+136, y+108), '2 segundos atrás', font=F_TINY, fill=T['EMERALD'])

    card_section(col_x[0], gy3, col_w, 156, 'Edge Node', body_fn=body_edge,
                 badge='live habilitado', badge_color=T['EMERALD'])

    def body_save(x, y, w, h):
        d.text((x+20, y+50), 'Alterações detectadas em 3 campos', font=F_BODY, fill=T['TEXT_BODY'])
        d.text((x+20, y+72), 'edgeNodeId, motionThreshold, ingestMode', font=F_MONO, fill=T['TEXT_META'])
        button(d, x+20, y+96, '💾 Salvar alterações', F_BODY_B,
               fg=(255,255,255), bg=T['ACCENT'], padx=18, pady=10)
        button(d, x+w-110, y+96, 'Descartar', F_BODY_B,
               fg=T['TEXT_BODY'], bg=T['BG_HOVER'], padx=14, pady=10)

    card_section(col_x[1], gy3, col_w, 156, 'Salvar', body_fn=body_save,
                 badge='3 alterações', badge_color=T['AMBER'])

    img.save(OUT / '06-camera-config.png', optimize=True)


# ── Main ──────────────────────────────────────────────────────────────────
SCREENS = [
    ('01-dashboard',     render_dashboard),
    ('02-live-mosaic',   render_live),
    ('03-map',           render_map),
    ('04-recordings',    render_recordings),
    ('05-cameras-list',  render_cameras),
    ('06-camera-config', render_camera_config),
]

if __name__ == '__main__':
    print('Gerando 12 mockups (6 light + 6 dark)…')
    for theme_name, theme_dict in [('light', LIGHT), ('dark', DARK)]:
        T = theme_dict
        # Re-bind no scope global pra que os render_* enxerguem
        globals()['T'] = theme_dict
        print(f'\n[{theme_name.upper()}]')
        for fname, render_fn in SCREENS:
            img_obj = Image.new('RGB', (W, H), T['BG_PAGE'])
            # Esses render_* criam própria image; precisamos refatorar
            # (já fizeram). Cada um salva sozinho. Renomeia pra incluir tema.
            # Truque: monkey-patch Image.save pra interceptar paths.
            render_fn()
            # Move último PNG criado pra ter sufixo do tema
            old = OUT / f'{fname}.png'
            new = OUT / f'{fname}-{theme_name}.png'
            if old.exists():
                old.replace(new)
                print(f'  [OK] {new.name}')
    print(f'\nOK saída em: {OUT}')
