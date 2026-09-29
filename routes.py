"""GPS routes of outdoor runs: thin Garmin's detail data, hide privacy zones, save to data/routes/.

Standard library only. fetch_garmin.py fetches the raw details (one request per new run) and calls
route_from_details(); every fetch also runs hide_zones_in_saved(), so a privacy zone added later in
Settings removes the coordinates from routes that were saved before it.

A saved route (data/routes/<activity id>.json):
  {id, gps, hidden, fields, points: [[t, lat, lon, dist, speed, hr, ele], ...]}
  t      seconds from the start          dist   metres from the start
  lat/lon degrees, null inside a privacy zone (or without GPS)
  speed  m/s     hr  bpm     ele  metres (null when the watch had none)
  gps    the run had GPS at all (false: treadmill or GPS off)
  hidden number of points whose position is hidden by a privacy zone
"""

import json
import math
from pathlib import Path

ROOT = Path(__file__).parent
ROUTES_DIR = ROOT / "data" / "routes"
FIELDS = ["t", "lat", "lon", "dist", "speed", "hr", "ele"]
EVERY_S = 5                 # keep a point at most every 5 seconds
EARTH_M = 6_371_000

# Garmin detail metric keys for each saved field
GARMIN_KEYS = {"time": "directTimestamp", "lat": "directLatitude", "lon": "directLongitude",
               "dist": "sumDistance", "speed": "directSpeed", "hr": "directHeartRate", "ele": "directElevation"}


def is_outdoor_run(activity: dict) -> bool:
    """A run that may have a GPS route: running but not on a treadmill, indoors or virtual"""
    t = (activity.get("type") or "").lower()
    return "run" in t and not any(w in t for w in ("treadmill", "indoor", "virtual")) and (activity.get("distance_m") or 0) > 0


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres (haversine)"""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_M * math.asin(math.sqrt(a))


def in_zone(lat, lon, zones: list[dict]) -> bool:
    if lat is None or lon is None:
        return False
    return any(distance_m(lat, lon, z["lat"], z["lon"]) <= z.get("radius_m", 400) for z in zones)


def _round(v, digits):
    return None if v is None else round(v, digits)


def route_from_details(activity_id: int, details: dict, zones: list[dict], every_s: int = EVERY_S) -> dict:
    """Garmin's get_activity_details() → a thinned route with positions inside privacy zones removed.
    Only the positions go: time, distance, pace, heart rate and elevation stay, so the curves and
    kilometre splits remain whole."""
    index = {m["key"]: m["metricsIndex"] for m in details.get("metricDescriptors") or []}
    rows = [p.get("metrics") or [] for p in details.get("activityDetailMetrics") or []]

    def get(row, name):
        i = index.get(GARMIN_KEYS[name])
        return row[i] if i is not None and i < len(row) else None

    points, last_t, start = [], None, None
    for n, row in enumerate(rows):
        ts = get(row, "time")
        if ts is None:
            continue
        start = ts if start is None else start
        t = (ts - start) / 1000
        if last_t is not None and t - last_t < every_s and n != len(rows) - 1:
            continue                                  # thin: one point per `every_s` seconds (and always the last)
        last_t = t
        points.append([round(t), _round(get(row, "lat"), 6), _round(get(row, "lon"), 6), _round(get(row, "dist"), 1),
                       _round(get(row, "speed"), 3), None if get(row, "hr") is None else round(get(row, "hr")),
                       _round(get(row, "ele"), 1)])
    gps = any(p[1] is not None for p in points)
    route = {"id": activity_id, "gps": gps, "hidden": 0, "fields": FIELDS, "points": points}
    return hide_zones(route, zones)


def hide_zones(route: dict, zones: list[dict]) -> dict:
    """Remove the position of every point inside a privacy zone (in place); count them in `hidden`"""
    for p in route["points"]:
        if in_zone(p[1], p[2], zones):
            p[1] = p[2] = None
            route["hidden"] += 1
    return route


def save_route(route: dict, folder: Path | None = None) -> Path:
    folder = folder or ROUTES_DIR
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{route['id']}.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(route, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)
    return path


def saved_ids(folder: Path | None = None) -> set[int]:
    folder = folder or ROUTES_DIR
    return {int(p.stem) for p in folder.glob("*.json") if p.stem.isdigit()} if folder.is_dir() else set()


def hide_zones_in_saved(zones: list[dict], folder: Path | None = None) -> int:
    """Apply the current privacy zones to every saved route (no Garmin request). Returns how many changed."""
    folder = folder or ROUTES_DIR
    if not zones or not folder.is_dir():
        return 0
    changed = 0
    for path in folder.glob("*.json"):
        try:
            route = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        before = route.get("hidden", 0)
        hide_zones(route, zones)
        if route["hidden"] != before:
            save_route(route, folder)
            changed += 1
    return changed
