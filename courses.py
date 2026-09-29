"""Send a saved route plan to Garmin Connect as a course (then it syncs to the watch).

Standard library only; send_course.py passes in the Garmin client (saved tokens only, never a password).
Two requests per send, never retried:
  1. POST /course-service/course/import   the GPX; Garmin parses it and answers with its geoPoints (nothing saved)
  2. POST /course-service/course          the course itself: name, running, private, distance, climb and the
                                          points. This is the only request that writes to the Garmin account.
Removing: DELETE /course-service/course/<id>.
The whole route is sent (the course is private and navigation should start where the run starts);
privacy zones apply to shared GPX files and the Share view, not to your own watch (user's choice).
"""

import io
import math

RUNNING = 1           # Garmin activityTypePk for running
PRIVATE = 2           # Garmin rulePK: only you can see the course
EARTH_M = 6_371_000.0


class CourseError(Exception):
    def __init__(self, message: str, code: str = "course"):
        super().__init__(message)
        self.code = code


def plan_line(plan: dict) -> list[list[float]]:
    """The planned line [[lat, lon, ele], ...] from a saved plan's segments (joints not doubled)"""
    line = []
    for i, seg in enumerate(plan.get("segments") or []):
        pts = seg.get("points") or []
        line.extend(pts if i == 0 else pts[1:])
    return line


def gpx(line: list[list[float]], name: str) -> bytes:
    esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")  # noqa: E731
    pts = "\n".join(f'      <trkpt lat="{p[0]:.6f}" lon="{p[1]:.6f}">' + (f"<ele>{p[2]:.1f}</ele>" if len(p) > 2 and p[2] is not None else "")
                    + "</trkpt>" for p in line)
    return (f'<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Running Log" xmlns="http://www.topografix.com/GPX/1/1">\n'
            f"  <trk>\n    <name>{esc(name)}</name>\n    <trkseg>\n{pts}\n    </trkseg>\n  </trk>\n</gpx>\n").encode("utf-8")


def _distance(a: dict, b: dict) -> float:
    p1, p2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    dp, dl = p2 - p1, math.radians(b["longitude"] - a["longitude"])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_M * math.asin(math.sqrt(h))


def _bearing(a: dict, b: dict) -> float:
    p1, p2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    dl = math.radians(b["longitude"] - a["longitude"])
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def course_payload(geo_points: list[dict], name: str, climb: float, descent: float) -> dict:
    """The body of POST /course-service/course, from the geoPoints Garmin returned for our GPX"""
    if len(geo_points) < 2:
        raise CourseError("Garmin could not read the route.")
    for p in geo_points:
        if p.get("elevation") is None:
            p["elevation"] = 0.0
    lats = [p["latitude"] for p in geo_points]
    lons = [p["longitude"] for p in geo_points]
    first = geo_points[0]
    return {
        "courseName": name, "description": "Planned in Running Log", "openStreetMap": False, "matchedToSegments": False,
        "userProfilePk": None, "userGroupPk": None, "rulePK": PRIVATE, "geoRoutePk": None, "sourceTypeId": 3, "sourcePk": None,
        "distanceMeter": sum(_distance(a, b) for a, b in zip(geo_points, geo_points[1:])),
        "elevationGainMeter": round(climb, 1), "elevationLossMeter": round(descent, 1),
        "startPoint": {"latitude": first["latitude"], "longitude": first["longitude"], "elevation": first["elevation"],
                       "distance": None, "timestamp": None},
        "coursePoints": [],
        "boundingBox": {"center": {"latitude": (min(lats) + max(lats)) / 2, "longitude": (min(lons) + max(lons)) / 2},
                        "lowerLeft": {"latitude": min(lats), "longitude": min(lons)},
                        "upperRight": {"latitude": max(lats), "longitude": max(lons)},
                        "lowerLeftLatIsSet": True, "lowerLeftLongIsSet": True, "upperRightLatIsSet": True, "upperRightLongIsSet": True},
        "hasShareableEvent": False, "hasTurnDetectionDisabled": False, "activityTypePk": RUNNING, "virtualPartnerId": None,
        "includeLaps": False, "elapsedSeconds": None, "startBearing": _bearing(first, geo_points[-1]), "endBearing": None,
        "geoPoints": geo_points,
    }


def descent_of(line: list[list[float]]) -> float:
    """Metres down, with the same 50 m averaging the Routes tab uses for climb (roughly: 5-point average)"""
    ele = [p[2] for p in line if len(p) > 2 and p[2] is not None]
    if len(ele) < 2:
        return 0.0
    sm = [sum(ele[max(0, i - 2):i + 3]) / len(ele[max(0, i - 2):i + 3]) for i in range(len(ele))]
    return sum(max(0.0, a - b) for a, b in zip(sm, sm[1:]))


def send(client, plan: dict) -> dict:
    """Upload a saved plan as a private running course. client = Garmin().client (post/delete).
    Returns {course_id, name, distance_m}."""
    line = plan_line(plan)
    if len(line) < 2:
        raise CourseError("The route has no points to send.")
    name = plan["name"]
    parsed = client.post("connectapi", "/course-service/course/import",
                         files={"file": (f"{name}.gpx", io.BytesIO(gpx(line, name)), "application/gpx+xml")}, api=True)
    payload = course_payload((parsed or {}).get("geoPoints") or [], name, plan.get("climb") or 0.0, descent_of(line))
    saved = client.post("connectapi", "/course-service/course", json=payload, api=True) or {}
    if not saved.get("courseId"):
        raise CourseError("Garmin did not confirm the course.")
    return {"course_id": saved["courseId"], "name": saved.get("courseName", name), "distance_m": saved.get("distanceMeter")}


def remove(client, course_id: int) -> None:
    client.delete("connectapi", f"/course-service/course/{int(course_id)}", api=True)
