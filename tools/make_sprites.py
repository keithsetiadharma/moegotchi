# Generates the 32x32 pixel-art mood sprites in sprites/. Run: python3 tools/make_sprites.py sprites
import sys
OUT = sys.argv[1]
N = 32
PAL = {"O": "#2b2135", "B": "#fff1e0", "S": "#f3cdb8", "I": "#ff9fb8", "P": "#ff8fab", "E": "#2b2135",
       "W": "#ffffff", "M": "#e0476b", "R": "#e8434f", "T": "#6ec6ff", "Y": "#ffd166"}
cx, cy = 15.5, 19.5

def in_ellipse(x, y, ex, ey, rx, ry):
    return ((x + .5 - ex) / rx) ** 2 + ((y + .5 - ey) / ry) ** 2 <= 1

def in_tri(x, y, a, b, c):
    px, py = x + .5, y + .5
    def s(p1, p2): return (px - p2[0]) * (p1[1] - p2[1]) - (p1[0] - p2[0]) * (py - p2[1])
    d1, d2, d3 = s(a, b), s(b, c), s(c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))

mir = lambda p: (32 - p[0], p[1])
L_EAR = [(6, 3), (4.5, 14), (14, 10.5)]
L_IN = [(7, 6.5), (6.5, 12.5), (11.5, 11)]
def shape(x, y):
    return in_ellipse(x, y, cx, cy, 12.5, 10.5) or in_tri(x, y, *L_EAR) or in_tri(x, y, *map(mir, L_EAR))

def base():
    g = [["." for _ in range(N)] for _ in range(N)]
    for y in range(N):
        for x in range(N):
            if not shape(x, y): continue
            edge = any(not (0 <= x + dx < N and 0 <= y + dy < N) or not shape(x + dx, y + dy)
                       for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if edge: g[y][x] = "O"
            elif in_tri(x, y, *L_IN) or in_tri(x, y, *map(mir, L_IN)): g[y][x] = "I"
            elif in_ellipse(x, y, cx, cy, 12.5, 10.5) and not in_ellipse(x, y, cx - 1.5, cy - 1.5, 12, 10.5): g[y][x] = "S"
            else: g[y][x] = "B"
    for x, y in ((8, 15), (9, 15), (8, 16)): g[y][x] = "W"  # shine
    return g

def stamp(g, x0, y0, rows):
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch != ".": g[y0 + dy][x0 + dx] = ch

def mirror_rows(rows): return [r[::-1] for r in rows]

EYE = ["WE", "EE", "EE"]
FACES = {
    "neutral": lambda g: (stamp(g, 10, 18, EYE), stamp(g, 20, 18, mirror_rows(EYE)),
                          stamp(g, 13, 22, ["E.EE.E", ".E..E."]),
                          stamp(g, 7, 22, ["PP"]), stamp(g, 23, 22, ["PP"])),
    "happy": lambda g: (stamp(g, 8, 18, [".EEE.", "E...E"]), stamp(g, 19, 18, [".EEE.", "E...E"]),
                        stamp(g, 13, 21, ["EEEEEE", "EMMMME", ".EEEE."]),
                        stamp(g, 6, 21, ["PPP"]), stamp(g, 23, 21, ["PPP"]),
                        stamp(g, 1, 5, [".Y.", "YYY", ".Y."]), stamp(g, 27, 3, [".Y.", "YYY", ".Y."])),
    "sad": lambda g: (stamp(g, 9, 16, ["..EE", "EE.."]), stamp(g, 19, 16, ["EE..", "..EE"]),
                      stamp(g, 10, 18, EYE), stamp(g, 20, 18, mirror_rows(EYE)),
                      stamp(g, 10, 21, ["T", "T"]), stamp(g, 21, 21, ["T", "T"]),
                      stamp(g, 13, 23, ["..EE..", ".E..E."])),
    "angry": lambda g: (stamp(g, 8, 16, ["EE..", "..EE"]), stamp(g, 20, 16, ["..EE", "EE.."]),
                        stamp(g, 10, 18, ["EE", "EE"]), stamp(g, 20, 18, ["EE", "EE"]),
                        stamp(g, 13, 22, ["EEEEEE", "EWWWWE", "EEEEEE"]),
                        stamp(g, 22, 10, [".R.R.", "RR.RR", ".....", "RR.RR", ".R.R."])),
}

def svg(g):
    rects = []
    for y, row in enumerate(g):
        x = 0
        while x < N:
            ch = row[x]
            if ch == ".": x += 1; continue
            w = 1
            while x + w < N and row[x + w] == ch: w += 1
            rects.append(f'<rect x="{x}" y="{y}" width="{w}" height="1" fill="{PAL[ch]}"/>')
            x += w
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="96" height="96" shape-rendering="crispEdges">'
            + "".join(rects) + "</svg>\n")

for mood, face in FACES.items():
    g = base(); face(g)
    open(f"{OUT}/{mood}.svg", "w").write(svg(g))
print("ok")
