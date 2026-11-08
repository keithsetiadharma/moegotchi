# Generates 32x32 pixel-art mood sprites (happy, neutral, sad, angry) as crisp SVGs.
# Run: python3 tools/make_sprites.py <character> <persona folder>
#   e.g. python3 tools/make_sprites.py cat personas/tsun
# Characters: cat, zippy, sarge, pebble, meh
import sys

N = 32
PAL = {"O": "#2b2135", "E": "#2b2135", "W": "#ffffff", "P": "#ff8fab", "M": "#e0476b", "R": "#e8434f",
       "T": "#6ec6ff", "Y": "#ffd166", "G": "#7cc47f", "g": "#4f9a58", "H": "#7a8a3c", "D": "#4b5320", "Q": "#8f86a3"}
cx = 15.5

def in_ellipse(x, y, ex, ey, rx, ry):
    return ((x + .5 - ex) / rx) ** 2 + ((y + .5 - ey) / ry) ** 2 <= 1

def in_tri(x, y, a, b, c):
    px, py = x + .5, y + .5
    def s(p1, p2): return (px - p2[0]) * (p1[1] - p2[1]) - (p1[0] - p2[0]) * (py - p2[1])
    d1, d2, d3 = s(a, b), s(b, c), s(c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))

mir = lambda p: (32 - p[0], p[1])

def body(shape, fill):
    """shape(x, y) -> bool; fill(x, y) -> palette key for interior pixels. Edges become the ink outline."""
    g = [["." for _ in range(N)] for _ in range(N)]
    for y in range(N):
        for x in range(N):
            if not shape(x, y): continue
            edge = any(not (0 <= x + dx < N and 0 <= y + dy < N) or not shape(x + dx, y + dy)
                       for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            g[y][x] = "O" if edge else fill(x, y)
    return g

def stamp(g, x0, y0, rows):
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch != ".": g[y0 + dy][x0 + dx] = ch

def mirror_rows(rows): return [r[::-1] for r in rows]

def shine(g, pts):
    for x, y in pts: g[y][x] = "W"

EYE = ["WE", "EE", "EE"]
SPARK = [".Y.", "YYY", ".Y."]
ANGER = [".R.R.", "RR.RR", ".....", "RR.RR", ".R.R."]

# ---------- cat (the original) ----------
def cat():
    PAL.update({"B": "#fff1e0", "S": "#f3cdb8", "I": "#ff9fb8"})
    cy = 19.5
    ear, inner = [(6, 3), (4.5, 14), (14, 10.5)], [(7, 6.5), (6.5, 12.5), (11.5, 11)]
    head = lambda x, y: in_ellipse(x, y, cx, cy, 12.5, 10.5)
    shape = lambda x, y: head(x, y) or in_tri(x, y, *ear) or in_tri(x, y, *map(mir, ear))
    def fill(x, y):
        if in_tri(x, y, *inner) or in_tri(x, y, *map(mir, inner)): return "I"
        if head(x, y) and not in_ellipse(x, y, cx - 1.5, cy - 1.5, 12, 10.5): return "S"
        return "B"
    def base():
        g = body(shape, fill); shine(g, ((8, 15), (9, 15), (8, 16))); return g
    faces = {
        "neutral": lambda g: (stamp(g, 10, 18, EYE), stamp(g, 20, 18, mirror_rows(EYE)),
                              stamp(g, 13, 22, ["E.EE.E", ".E..E."]), stamp(g, 7, 22, ["PP"]), stamp(g, 23, 22, ["PP"])),
        "happy": lambda g: (stamp(g, 8, 18, [".EEE.", "E...E"]), stamp(g, 19, 18, [".EEE.", "E...E"]),
                            stamp(g, 13, 21, ["EEEEEE", "EMMMME", ".EEEE."]), stamp(g, 6, 21, ["PPP"]), stamp(g, 23, 21, ["PPP"]),
                            stamp(g, 1, 5, SPARK), stamp(g, 27, 3, SPARK)),
        "sad": lambda g: (stamp(g, 9, 16, ["..EE", "EE.."]), stamp(g, 19, 16, ["EE..", "..EE"]),
                          stamp(g, 10, 18, EYE), stamp(g, 20, 18, mirror_rows(EYE)),
                          stamp(g, 10, 21, ["T", "T"]), stamp(g, 21, 21, ["T", "T"]), stamp(g, 13, 23, ["..EE..", ".E..E."])),
        "angry": lambda g: (stamp(g, 8, 16, ["EE..", "..EE"]), stamp(g, 20, 16, ["..EE", "EE.."]),
                            stamp(g, 10, 18, ["EE", "EE"]), stamp(g, 20, 18, ["EE", "EE"]),
                            stamp(g, 13, 22, ["EEEEEE", "EWWWWE", "EEEEEE"]), stamp(g, 22, 10, ANGER)),
    }
    return base, faces

# ---------- zippy: spiky, electric hype creature ----------
def zippy():
    PAL.update({"B": "#ffe14d", "S": "#f5a623"})
    cy = 20
    spikes = [[(9, 3), (6, 13), (14, 10)], [(15.5, 0.5), (12, 10), (19, 10)], list(map(mir, [(9, 3), (6, 13), (14, 10)]))]
    head = lambda x, y: in_ellipse(x, y, cx, cy, 12, 10)
    shape = lambda x, y: head(x, y) or any(in_tri(x, y, *t) for t in spikes)
    fill = lambda x, y: "S" if head(x, y) and not in_ellipse(x, y, cx - 1.5, cy - 1.5, 11.5, 10) else "B"
    BIG = ["WWE", "WEE", "EEE"]  # big sparkly eyes
    def base():
        g = body(shape, fill); shine(g, ((8, 15), (9, 15), (8, 16))); return g
    faces = {
        "neutral": lambda g: (stamp(g, 9, 17, BIG), stamp(g, 20, 17, mirror_rows(BIG)),
                              stamp(g, 13, 22, ["E....E", ".EEEE."]), stamp(g, 6, 21, ["PP"]), stamp(g, 24, 21, ["PP"])),
        "happy": lambda g: (stamp(g, 8, 18, [".EEE.", "E...E"]), stamp(g, 19, 18, [".EEE.", "E...E"]),
                            stamp(g, 12, 21, ["EEEEEEEE", "EMMMMMME", ".EMMMME.", "..EEEE.."]),
                            stamp(g, 5, 21, ["PPP"]), stamp(g, 24, 21, ["PPP"]),
                            stamp(g, 0, 9, SPARK), stamp(g, 28, 8, SPARK), stamp(g, 3, 1, SPARK)),
        "sad": lambda g: (stamp(g, 9, 17, BIG), stamp(g, 20, 17, mirror_rows(BIG)),
                          stamp(g, 9, 20, ["T", "T", "T"]), stamp(g, 22, 20, ["T", "T", "T"]),
                          stamp(g, 13, 23, ["..EE..", ".E..E."])),
        # "angry" for Zippy = fired-up shouting, not mean
        "angry": lambda g: (stamp(g, 8, 15, ["EEE.", "...E"]), stamp(g, 20, 15, [".EEE", "E..."]),
                            stamp(g, 9, 17, BIG), stamp(g, 20, 17, mirror_rows(BIG)),
                            stamp(g, 13, 21, [".EEEE.", "EMMMME", "EMMMME", ".EEEE."]),
                            stamp(g, 28, 13, ["R", "R", "R", ".", "R"])),
    }
    return base, faces

# ---------- sarge: round recruit-looking head in a campaign hat ----------
def sarge():
    PAL.update({"B": "#f0cfa0", "S": "#d9ad74"})
    cy = 21.5
    head = lambda x, y: in_ellipse(x, y, cx, cy, 11, 9.5)
    brim = lambda x, y: in_ellipse(x, y, cx, 12.5, 14, 2.2)
    crown = lambda x, y: in_ellipse(x, y, cx, 10, 7.5, 6) and y <= 12
    shape = lambda x, y: head(x, y) or brim(x, y) or crown(x, y)
    def fill(x, y):
        if crown(x, y) or brim(x, y):
            return "D" if y == 11 and crown(x, y) else "H"
        if not in_ellipse(x, y, cx - 1.5, cy - 1.5, 10.5, 9.5): return "S"
        return "B"
    def base():
        g = body(shape, fill)
        for x in (15, 16): g[4][x] = "O"  # the hat's pinched peak
        shine(g, ((10, 7), (11, 7)))
        return g
    faces = {
        "neutral": lambda g: (stamp(g, 9, 17, ["EEEE"]), stamp(g, 19, 17, ["EEEE"]),
                              stamp(g, 10, 19, ["EE", "EE"]), stamp(g, 20, 19, ["EE", "EE"]),
                              stamp(g, 13, 24, ["EEEEEE"])),
        "happy": lambda g: (stamp(g, 9, 17, ["EEEE"]), stamp(g, 19, 17, ["EEEE"]),
                            stamp(g, 10, 19, ["EE", "EE"]), stamp(g, 20, 19, ["EE", "EE"]),
                            stamp(g, 13, 23, ["E....E", ".EEEE."]), stamp(g, 7, 22, ["PP"]), stamp(g, 23, 22, ["PP"]),
                            stamp(g, 27, 16, SPARK)),
        "sad": lambda g: (stamp(g, 9, 16, ["..EE", "EE.."]), stamp(g, 19, 16, ["EE..", "..EE"]),
                          stamp(g, 10, 19, ["EE", "EE"]), stamp(g, 20, 19, ["EE", "EE"]),
                          stamp(g, 13, 24, [".EEEE.", "E....E"])),
        "angry": lambda g: (stamp(g, 8, 16, ["EE..", "..EE"]), stamp(g, 20, 16, ["..EE", "EE.."]),
                            stamp(g, 10, 19, ["EE", "EE"]), stamp(g, 20, 19, ["EE", "EE"]),
                            stamp(g, 12, 23, [".EEEEEE.", "EMMMMMME", ".EEEEEE."]), stamp(g, 25, 18, ANGER)),
    }
    return base, faces

# ---------- pebble: a smooth, calm stone with a little sprout ----------
def pebble():
    PAL.update({"B": "#d3dbe4", "S": "#aab7c6"})
    cy = 22
    stone = lambda x, y: in_ellipse(x, y, cx, cy, 13.5, 8.5)
    leafL = lambda x, y: in_ellipse(x, y, 12.5, 10, 3.2, 1.8)
    leafR = lambda x, y: in_ellipse(x, y, 19, 8.5, 3.2, 1.8)
    stem = lambda x, y: x in (15, 16) and 9 <= y <= 14
    shape = lambda x, y: stone(x, y) or leafL(x, y) or leafR(x, y) or stem(x, y)
    def fill(x, y):
        if not stone(x, y): return "g" if stem(x, y) else "G"
        if not in_ellipse(x, y, cx - 1.5, cy - 1.5, 13, 8.5): return "S"
        return "B"
    def base():
        g = body(shape, fill); shine(g, ((6, 18), (7, 17), (8, 17))); return g
    DOT = ["E", "E"]
    faces = {
        "neutral": lambda g: (stamp(g, 11, 20, DOT), stamp(g, 20, 20, DOT), stamp(g, 14, 24, [".EE."]),
                              stamp(g, 7, 23, ["PP"]), stamp(g, 23, 23, ["PP"])),
        "happy": lambda g: (stamp(g, 10, 20, [".E.", "E.E"]), stamp(g, 19, 20, [".E.", "E.E"]),
                            stamp(g, 14, 23, ["E..E", ".EE."]), stamp(g, 6, 23, ["PPP"]), stamp(g, 23, 23, ["PPP"]),
                            stamp(g, 24, 3, [".Y.", "YYY", ".Y."])),
        "sad": lambda g: (stamp(g, 10, 20, ["E..", ".EE"]), stamp(g, 19, 20, ["..E", "EE."]),
                          stamp(g, 11, 22, ["T"]), stamp(g, 14, 25, [".EE.", "E..E"])),
        # Pebble never gets angry; this is "worried": a small 'o' and a sweat drop
        "angry": lambda g: (stamp(g, 10, 18, ["EE."]), stamp(g, 20, 18, [".EE"]),
                            stamp(g, 11, 20, DOT), stamp(g, 20, 20, DOT),
                            stamp(g, 15, 24, ["EE", "EE"]), stamp(g, 25, 16, [".T", "TT", "TT"])),
    }
    return base, faces

# ---------- meh: a droopy, deadpan blob with half-lidded eyes ----------
def meh():
    PAL.update({"B": "#d9d3e8", "S": "#b7aecf"})
    cy = 20.5
    blob = lambda x, y: in_ellipse(x, y, cx, cy, 12.5, 10) or (in_ellipse(x, y, cx, 28, 13.5, 3) and y <= 29)
    shape = blob
    fill = lambda x, y: "S" if not in_ellipse(x, y, cx - 1.5, cy - 1.5, 12, 10) else "B"
    def base():
        g = body(shape, fill); shine(g, ((8, 14), (9, 14), (8, 15))); return g
    LID = ["EEEE", ".EE."]  # half-closed: lid line over the pupil
    faces = {
        "neutral": lambda g: (stamp(g, 9, 19, LID), stamp(g, 19, 19, LID), stamp(g, 13, 24, ["EEEEEE"])),
        "happy": lambda g: (stamp(g, 9, 19, LID), stamp(g, 19, 19, LID), stamp(g, 13, 23, ["E....E", ".EEEE."]),
                            stamp(g, 7, 22, ["PP"]), stamp(g, 23, 22, ["PP"])),
        "sad": lambda g: (stamp(g, 9, 20, LID), stamp(g, 19, 20, LID), stamp(g, 13, 25, ["EEEEEE"]),
                          stamp(g, 25, 9, ["QQ..", ".QQQ", "QQ.."])),  # a little sigh cloud
        "angry": lambda g: (stamp(g, 9, 17, ["EE..", "..EE"]), stamp(g, 19, 17, ["..EE", "EE.."]),
                            stamp(g, 9, 19, LID), stamp(g, 19, 19, LID), stamp(g, 13, 24, ["EEEEEE"]),
                            stamp(g, 24, 10, ANGER)),
    }
    return base, faces

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

if __name__ == "__main__":
    character, out = sys.argv[1], sys.argv[2]
    base, faces = {"cat": cat, "zippy": zippy, "sarge": sarge, "pebble": pebble, "meh": meh}[character]()
    for mood, face in faces.items():
        g = base(); face(g)
        open(f"{out}/{mood}.svg", "w").write(svg(g))
    print(f"{character} -> {out}")
