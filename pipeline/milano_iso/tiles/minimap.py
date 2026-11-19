"""Minimap drawing of the whole tileset (T-5.3a): the content of ``minimap.svg``.

Local frame in metres, north up: SVG x = x (east), SVG y = z = -(N - N0), so north is at the top.
The ``viewBox`` is explicit, in whole metres. Colours and stroke widths come from CSS classes (the
``<style>`` block holds the default day theme, taken from web/src/style/palette.ts; the client can
override the classes for night). The stroke widths are STYLE, not data.

Platform independence (CLAUDE.md lessons, T-4.4): geometry is simplified, then snapped to
integer decimetres, and every later step is integer arithmetic: duplicate points removed, rings
given a fixed orientation and start vertex, paths sorted. Paths are written with relative
integer steps. Exterior rings turn one way and holes the other, so the default non-zero fill
rule draws courtyards as holes and overlapping footprints as their union (no polygon union is
computed: that is the GEOS step that differs across platforms).
"""

import itertools
import math

import shapely

MINIMAP_NAME = "minimap.svg"
TOLERANCE_M = 1.0  # Douglas-Peucker tolerance for every layer (style choice, see the T-5.3a report)
# The light minimap of a large extent (T-6.2): only water, green and the major roads, simplified for
# the size it is drawn at (a few hundred pixels for the whole comune, so tens of metres per pixel).
LITE_TOLERANCE_M = 12.0
LITE_MIN_AREA_M2 = 20_000.0  # green and water pieces below this (a 140 m square) are not drawn
MAJOR_CLASSES = ("motorway", "trunk", "primary", "secondary", "tertiary")
MINOR_CLASSES = ("living_street", "residential", "unclassified")

STYLE = (
    ".mm-ground{fill:#e3ded4}"
    ".mm-green{fill:#a9c58f}"
    ".mm-water{fill:#8cb9cf}"
    ".mm-building{fill:#d6d0c8}"
    ".mm-road-minor,.mm-road-major{fill:none;stroke-linecap:round;stroke-linejoin:round}"
    ".mm-road-minor{stroke:#a9a9a6;stroke-width:4}"
    ".mm-road-major{stroke:#8d8f94;stroke-width:9}"
)


def _fmt(dm: int) -> str:
    """Decimetres as metres, without a float: 123 -> '12.3', -5 -> '-0.5'."""
    sign = "-" if dm < 0 else ""
    q, r = divmod(abs(dm), 10)
    return f"{sign}{q}" if r == 0 else f"{sign}{q}.{r}"


def _snap(coords) -> list[tuple[int, int]]:
    """Local (x, y north) to SVG integer decimetres (x, -y), consecutive duplicates removed."""
    out: list[tuple[int, int]] = []
    for x, y in coords:
        p = (round(float(x) * 10), round(-float(y) * 10))
        if not out or out[-1] != p:
            out.append(p)
    return out


def _area2(pts: list[tuple[int, int]]) -> int:
    """Twice the signed area of a closed ring (integer shoelace)."""
    return sum(
        pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
        for i in range(len(pts))
    )


def _ring(coords, exterior: bool) -> list[tuple[int, int]] | None:
    pts = _snap(coords)
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    if len(pts) < 3:
        return None
    a = _area2(pts)
    if a == 0:
        return None
    if (a > 0) != exterior:
        pts.reverse()
    start = pts.index(min(pts))
    return pts[start:] + pts[:start]


def _path(pts: list[tuple[int, int]], closed: bool) -> str:
    head = f"M{_fmt(pts[0][0])} {_fmt(pts[0][1])}l"
    steps = [f"{_fmt(b[0] - a[0])} {_fmt(b[1] - a[1])}" for a, b in itertools.pairwise(pts)]
    return head + " ".join(steps) + ("z" if closed else "")


def _polygon_paths(polys, tolerance: float, min_area: float = 0.0) -> str:
    """One ``d`` string for all polygons: sorted by exterior, each followed by its sorted holes."""
    items = []
    for poly in polys:
        for p in shapely.get_parts(poly):
            if p.is_empty or p.geom_type != "Polygon" or p.area < min_area:
                continue
            s = shapely.simplify(p, tolerance, preserve_topology=True)
            if s.is_empty or s.geom_type != "Polygon":
                continue
            ext = _ring(s.exterior.coords, True)
            if ext is None:
                continue
            holes = sorted(
                h for h in (_ring(r.coords, False) for r in s.interiors) if h is not None
            )
            items.append((ext, holes))
    items.sort(key=lambda it: (it[0], it[1]))
    return "".join(_path(r, True) for ext, holes in items for r in [ext, *holes])


def _line_paths(lines, tolerance: float) -> str:
    items = []
    for line in lines:
        for ln in shapely.get_parts(line):
            if ln.is_empty or ln.geom_type != "LineString":
                continue
            pts = _snap(shapely.simplify(ln, tolerance, preserve_topology=False).coords)
            if len(pts) < 2:
                continue
            if pts[0] > pts[-1]:
                pts.reverse()
            items.append(pts)
    items.sort()
    return "".join(_path(p, False) for p in items)


def viewbox_of(content_boxes: list[tuple[float, float, float, float]]) -> tuple[int, int, int, int]:
    """Whole-metre viewBox (x, z, width, height) covering [xmin, zmin, xmax, zmax] boxes."""
    x0 = math.floor(min(b[0] for b in content_boxes))
    z0 = math.floor(min(b[1] for b in content_boxes))
    x1 = math.ceil(max(b[2] for b in content_boxes))
    z1 = math.ceil(max(b[3] for b in content_boxes))
    return x0, z0, x1 - x0, z1 - z0


def render(
    viewbox: tuple[int, int, int, int],
    water: list,
    green: list,
    buildings: list,
    roads: list[tuple[str, object]],
    tolerance: float = TOLERANCE_M,
    lite: bool = False,
) -> bytes:
    """The SVG. ``water``, ``green``, ``buildings``: local polygons. ``roads``: (class, local
    centreline) pairs; only MAJOR_CLASSES and MINOR_CLASSES are drawn.

    ``lite`` (T-6.2, whole-city tilesets): no buildings, no minor roads, pieces of green and water
    under LITE_MIN_AREA_M2 dropped, everything simplified at LITE_TOLERANCE_M. Real geometry, drawn
    from the same layers, only less of it.
    """
    x, z, w, h = viewbox
    major = [g for c, g in roads if c in MAJOR_CLASSES]
    minor = [g for c, g in roads if c in MINOR_CLASSES]
    if lite:
        tolerance = LITE_TOLERANCE_M
        layers = [
            ("mm-green", _polygon_paths(green, tolerance, LITE_MIN_AREA_M2)),
            ("mm-water", _polygon_paths(water, tolerance, LITE_MIN_AREA_M2)),
            ("mm-road-major", _line_paths(major, tolerance)),
        ]
    else:
        layers = [
            ("mm-green", _polygon_paths(green, tolerance)),
            ("mm-water", _polygon_paths(water, tolerance)),
            ("mm-road-minor", _line_paths(minor, tolerance)),
            ("mm-road-major", _line_paths(major, tolerance)),
            ("mm-building", _polygon_paths(buildings, tolerance)),
        ]
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {z} {w} {h}">',
        f"<style>{STYLE}</style>",
        f'<rect class="mm-ground" x="{x}" y="{z}" width="{w}" height="{h}"/>',
    ]
    out += [f'<path class="{cls}" d="{d}"/>' for cls, d in layers if d]
    out.append("</svg>")
    return ("\n".join(out) + "\n").encode("utf-8")
