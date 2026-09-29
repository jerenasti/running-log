"""Route planning through openrouteservice (ORS): the path between two points along roads and paths,
with elevation. Standard library only; serve.py calls this, so the API key never reaches the browser.

ORS free plan (2026): 2 000 directions requests a day, 40 a minute. Every segment between two planned
points is one request; serve.py caches segments, so undo, redo and reopening a route cost nothing.
"""

import json
import urllib.error
import urllib.request
from collections import OrderedDict

ORS_URL = "https://api.openrouteservice.org/v2/directions/{profile}/geojson"
PROFILES = ("foot-walking", "foot-hiking")
TIMEOUT_S = 15


class RoutingError(Exception):
    """A plain-words reason, plus the HTTP status serve.py should answer with"""

    def __init__(self, message: str, status: int = 502, code: str = "routing"):
        super().__init__(message)
        self.status = status
        self.code = code


def _explain(status: int, body: str) -> RoutingError:
    try:
        err = json.loads(body).get("error") or {}
        code = err.get("code") if isinstance(err, dict) else None
    except ValueError:
        code = None
    if status in (401, 403):
        return RoutingError("openrouteservice refused the API key. Check it in Settings → Routing.", 400, "bad_key")
    if status == 429:
        return RoutingError("The daily or per-minute openrouteservice quota is used up. Try again later.", 429, "quota")
    if code in (2010, 2004) or status == 404:
        return RoutingError("No road or path found near this point. Put it closer to a road or path.", 422, "no_path")
    return RoutingError(f"openrouteservice could not plan this part (HTTP {status}).", 502, "routing")


def segment(key: str, a: list[float], b: list[float], profile: str = "foot-walking", opener=urllib.request.urlopen) -> dict:
    """The path from a = [lat, lon] to b along roads and paths:
    {points: [[lat, lon, ele], ...], distance (m), ascent (m), descent (m)}"""
    if not key:
        raise RoutingError("Add your openrouteservice API key in Settings → Routing.", 400, "no_key")
    if profile not in PROFILES:
        raise RoutingError("Unknown route profile.", 400, "profile")
    body = {"coordinates": [[a[1], a[0]], [b[1], b[0]]], "elevation": True, "instructions": False}
    req = urllib.request.Request(ORS_URL.format(profile=profile), data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Authorization": key, "Content-Type": "application/json",
                                          "Accept": "application/geo+json"})
    try:
        with opener(req, timeout=TIMEOUT_S) as res:
            data = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise _explain(e.code, e.read().decode("utf-8", "replace")) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise RoutingError("Could not reach openrouteservice. Check the internet connection.", 503, "network") from None
    try:
        feature = data["features"][0]
        coords = feature["geometry"]["coordinates"]
        props = feature.get("properties") or {}
    except (KeyError, IndexError, TypeError):
        raise RoutingError("openrouteservice sent an unexpected answer.", 502, "routing") from None
    points = [[round(c[1], 6), round(c[0], 6), round(c[2], 1) if len(c) > 2 and c[2] is not None else None] for c in coords]
    return {
        "points": points,
        "distance": round((props.get("summary") or {}).get("distance", 0.0), 1),
        "ascent": props.get("ascent"),
        "descent": props.get("descent"),
    }


class SegmentCache:
    """The last `size` segments, keyed by their end points (6 decimals ≈ 0.1 m) and profile"""

    def __init__(self, size: int = 500):
        self.size, self.items = size, OrderedDict()

    @staticmethod
    def key(a, b, profile):
        return (round(a[0], 6), round(a[1], 6), round(b[0], 6), round(b[1], 6), profile)

    def get(self, a, b, profile):
        k = self.key(a, b, profile)
        if k in self.items:
            self.items.move_to_end(k)
            return self.items[k]
        return None

    def put(self, a, b, profile, value):
        self.items[self.key(a, b, profile)] = value
        if len(self.items) > self.size:
            self.items.popitem(last=False)
