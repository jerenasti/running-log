"""MML 2 m elevation: coordinate conversion, ASCII Grid, bilinear heights, tile cache (MML never contacted)."""

import gzip
import sys
import urllib.parse
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
import elevation as el  # noqa: E402


def test_tm35fin_matches_pyproj_reference():
    # Reference values from pyproj (EPSG:4326 → EPSG:3067); the formula matched it to the millimetre
    e, n = el.to_tm35fin(60.17, 24.94)
    assert abs(e - 385700.4) < 0.1 and abs(n - 6672126.7) < 0.1
    e, n = el.to_tm35fin(64.0, 27.0)
    assert abs(e - 500000.0) < 1e-6, "the central meridian 27°E is at 500 000 m"


def grid_text(e0, n0, cell=2.0, size=6, height=lambda col, row: 10 + col):
    """A small grid whose height rises 1 m per column (west to east), rows listed from the top"""
    rows = [" ".join(f"{height(c, r):.1f}" for c in range(size)) for r in range(size)]
    return "\n".join([f"ncols {size}", f"nrows {size}", f"xllcorner {e0}", f"yllcorner {n0}", f"cellsize {cell}",
                      "NODATA_value -9999", *rows]) + "\n"


def test_ascii_grid_and_bilinear_height():
    g = el.parse_ascii_grid(grid_text(1000, 2000))
    assert (g["ncols"], g["nrows"], g["x0"], g["y0"], g["cell"]) == (6, 6, 1000, 2000, 2.0)
    # Cell centres of column c are at x0 + (c + 0.5) × cell: column 1 centre = 1003 → 11 m, column 2 → 12 m
    assert el.sample(g, 1003.0, 2005.0) == pytest.approx(11.0)
    assert el.sample(g, 1004.0, 2005.0) == pytest.approx(11.5), "halfway between two cell centres"
    assert el.sample(g, 990.0, 2005.0) is None, "outside the grid"
    nodata = el.parse_ascii_grid(grid_text(1000, 2000, height=lambda c, r: -9999 if c == 2 else 10))
    assert el.sample(nodata, 1004.0, 2005.0) is None, "next to missing data"


def test_heights_replaced_in_finland_with_cached_tiles(tmp_path):
    lat, lon = 60.17, 24.94
    e, n = el.to_tm35fin(lat, lon)
    t_e, t_n = el.tile_of(e, n)
    urls = []

    def opener(req, timeout):
        urls.append(req.full_url)

        class R:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return grid_text(t_e - 2, t_n - 2, cell=2.0, size=503, height=lambda c, r: 42.0).encode()
        return R()

    pts = [[lat, lon, 5.0], [lat + 0.0001, lon, 6.0], [59.33, 18.07, 30.0]]     # the last one is in Stockholm
    out, done = el.add_mml_elevation(pts, "KEY", folder=tmp_path, opener=opener)
    assert done == 2
    assert [p[2] for p in out] == [42.0, 42.0, 30.0], "Stockholm keeps its openrouteservice height"
    assert len(urls) == 1, "one tile for both Helsinki points; nothing for Stockholm"
    q = urllib.parse.parse_qs(urllib.parse.urlparse(urls[0]).query)
    assert q["CoverageID"] == ["korkeusmalli_2m"] and q["format"] == ["text/plain"] and q["api-key"] == ["KEY"]
    assert (tmp_path / f"{t_e}_{t_n}.asc.gz").is_file()
    assert gzip.decompress((tmp_path / f"{t_e}_{t_n}.asc.gz").read_bytes()).startswith(b"ncols")
    el.add_mml_elevation(pts, "KEY", folder=tmp_path, opener=opener)
    assert len(urls) == 1, "the cached tile is used the second time"


def test_refused_key_is_explained(tmp_path):
    import io
    import urllib.error

    def opener(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 403, "Forbidden", {}, io.BytesIO(b""))
    with pytest.raises(el.ElevationError) as e:
        el.add_mml_elevation([[60.17, 24.94, 5.0]], "BAD", folder=tmp_path, opener=opener)
    assert e.value.code == "bad_key"
    assert not list(tmp_path.glob("*.gz")), "nothing is cached from a failed request"
