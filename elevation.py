"""Elevation from the National Land Survey of Finland (MML) 2 m elevation model, for planned routes in Finland.

Standard library only; serve.py calls this after openrouteservice has routed a segment.
- WGS84 lat/lon → ETRS-TM35FIN (EPSG:3067): transverse Mercator on GRS80, central meridian 27°E,
  scale 0.9996, false easting 500 000 m (Krüger series; ETRS89 and WGS84 differ by under a metre here).
- The model comes from MML's WCS service (GetCoverage, ASCII Grid, 2 m cells) in 1 km × 1 km tiles
  around the route. Tiles are cached gzipped in data/elevation/, so later routes nearby download nothing.
- Each point's height is interpolated bilinearly from the four surrounding cells.
Outside Finland, or where the model has no data, the caller keeps openrouteservice's elevation.
"""

import gzip
import math
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
CACHE_DIR = ROOT / "data" / "elevation"
WCS_URL = "https://avoin-karttakuva.maanmittauslaitos.fi/ortokuvat-ja-korkeusmallit/wcs/v2"
TILE_M = 1000
TIMEOUT_S = 30
# Rough box around Finland; points outside it never cause a request
FINLAND = {"lat": (59.3, 70.2), "lon": (19.0, 31.8)}

# ---------- WGS84 → ETRS-TM35FIN ----------
_A, _F = 6378137.0, 1 / 298.257222101           # GRS80
_K0, _LON0, _E0 = 0.9996, math.radians(27.0), 500000.0
_N = _F / (2 - _F)
_AA = _A / (1 + _N) * (1 + _N ** 2 / 4 + _N ** 4 / 64)
_ALPHA = [
    _N / 2 - 2 * _N ** 2 / 3 + 5 * _N ** 3 / 16 + 41 * _N ** 4 / 180,
    13 * _N ** 2 / 48 - 3 * _N ** 3 / 5 + 557 * _N ** 4 / 1440,
    61 * _N ** 3 / 240 - 103 * _N ** 4 / 140,
    49561 * _N ** 4 / 161280,
]
_E2 = _F * (2 - _F)
_E = math.sqrt(_E2)


def to_tm35fin(lat: float, lon: float) -> tuple[float, float]:
    """(easting, northing) in metres, EPSG:3067"""
    phi, lam = math.radians(lat), math.radians(lon) - _LON0
    t = math.sinh(math.atanh(math.sin(phi)) - _E * math.atanh(_E * math.sin(phi)))
    xi = math.atan2(t, math.cos(lam))
    eta = math.atanh(math.sin(lam) / math.sqrt(1 + t * t))
    x = xi + sum(a * math.sin(2 * (j + 1) * xi) * math.cosh(2 * (j + 1) * eta) for j, a in enumerate(_ALPHA))
    y = eta + sum(a * math.cos(2 * (j + 1) * xi) * math.sinh(2 * (j + 1) * eta) for j, a in enumerate(_ALPHA))
    return _E0 + _K0 * _AA * y, _K0 * _AA * x


def in_finland(lat: float, lon: float) -> bool:
    return FINLAND["lat"][0] <= lat <= FINLAND["lat"][1] and FINLAND["lon"][0] <= lon <= FINLAND["lon"][1]


class ElevationError(Exception):
    def __init__(self, message: str, code: str = "elevation"):
        super().__init__(message)
        self.code = code


# ---------- Tiles ----------
def parse_ascii_grid(text: str) -> dict:
    """ESRI ASCII Grid → {ncols, nrows, x0, y0 (lower-left corner), cell, nodata, rows (top row first)}"""
    lines = text.splitlines()
    head, i = {}, 0
    while i < len(lines) and lines[i].split() and lines[i].split()[0].lower() in (
            "ncols", "nrows", "xllcorner", "yllcorner", "xllcenter", "yllcenter", "cellsize", "nodata_value", "dx", "dy"):
        k, v = lines[i].split()[:2]
        head[k.lower()] = float(v)
        i += 1
    cell = head.get("cellsize") or head.get("dx")
    x0 = head["xllcorner"] if "xllcorner" in head else head["xllcenter"] - cell / 2
    y0 = head["yllcorner"] if "yllcorner" in head else head["yllcenter"] - cell / 2
    rows = [[float(v) for v in ln.split()] for ln in lines[i:] if ln.strip()]
    return {"ncols": int(head["ncols"]), "nrows": int(head["nrows"]), "x0": x0, "y0": y0, "cell": cell,
            "nodata": head.get("nodata_value", -9999.0), "rows": rows}


def sample(grid: dict, e: float, n: float):
    """Bilinear height at (e, n) from the cell centres; None outside the grid or next to missing data"""
    c = grid["cell"]
    top = grid["y0"] + grid["nrows"] * c
    fx = (e - grid["x0"]) / c - 0.5                  # column position, cell centres at .0
    fy = (top - n) / c - 0.5                         # row position from the top
    c0, r0 = math.floor(fx), math.floor(fy)
    if c0 < 0 or r0 < 0 or c0 + 1 >= grid["ncols"] or r0 + 1 >= grid["nrows"]:
        return None
    dx, dy = fx - c0, fy - r0
    v = [grid["rows"][r0][c0], grid["rows"][r0][c0 + 1], grid["rows"][r0 + 1][c0], grid["rows"][r0 + 1][c0 + 1]]
    if any(x == grid["nodata"] for x in v):
        return None
    return (v[0] * (1 - dx) + v[1] * dx) * (1 - dy) + (v[2] * (1 - dx) + v[3] * dx) * dy


def tile_of(e: float, n: float) -> tuple[int, int]:
    return int(e // TILE_M) * TILE_M, int(n // TILE_M) * TILE_M


def fetch_tile(key: str, e0: int, n0: int, opener=urllib.request.urlopen) -> str:
    """One 1 km tile (plus one cell of margin, so points on the edge can be interpolated) as ASCII Grid text"""
    params = [("service", "WCS"), ("version", "2.0.1"), ("request", "GetCoverage"), ("CoverageID", "korkeusmalli_2m"),
              ("SUBSET", f"E({e0 - 2},{e0 + TILE_M + 2})"), ("SUBSET", f"N({n0 - 2},{n0 + TILE_M + 2})"),
              ("format", "text/plain"), ("api-key", key)]
    url = WCS_URL + "?" + urllib.parse.urlencode(params)
    try:
        with opener(urllib.request.Request(url), timeout=TIMEOUT_S) as res:
            return res.read().decode("ascii", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise ElevationError("MML refused the API key. Check it in Settings → Routing.", "bad_key") from None
        raise ElevationError(f"MML could not send the elevation model (HTTP {e.code}).") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ElevationError("Could not reach MML's elevation service.", "network") from None


def load_tile(key: str, e0: int, n0: int, folder: Path | None = None, opener=urllib.request.urlopen) -> dict:
    folder = folder or CACHE_DIR
    path = folder / f"{e0}_{n0}.asc.gz"
    if path.is_file():
        return parse_ascii_grid(gzip.decompress(path.read_bytes()).decode("ascii"))
    text = fetch_tile(key, e0, n0, opener)
    grid = parse_ascii_grid(text)                    # parse first: a bad answer is never cached
    folder.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(gzip.compress(text.encode("ascii")))
    tmp.replace(path)
    return grid


def add_mml_elevation(points: list[list], key: str, folder: Path | None = None, opener=urllib.request.urlopen) -> tuple[list, int]:
    """Replace the elevation of every point in Finland with the MML 2 m model. points: [[lat, lon, ele]].
    Returns (points, how many got an MML height); the others keep their elevation."""
    grids, done, out = {}, 0, []
    for lat, lon, ele in points:
        h = None
        if in_finland(lat, lon):
            e, n = to_tm35fin(lat, lon)
            t = tile_of(e, n)
            if t not in grids:
                grids[t] = load_tile(key, *t, folder=folder, opener=opener)
            h = sample(grids[t], e, n)
        if h is not None:
            done += 1
        out.append([lat, lon, round(h, 1) if h is not None else ele])
    return out, done
