"""Routes: thinning, privacy zones removed when saving, and zones added later applied to saved routes."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import routes as rt  # noqa: E402

KEYS = ["directSpeed", "sumDistance", "directHeartRate", "directElevation", "directTimestamp",
        "directLatitude", "directLongitude", "directPower"]
HOME = {"name": "Home", "lat": 60.0, "lon": 25.0, "radius_m": 400}


def details(points):
    """Garmin detail data in its own shape: descriptors + metric rows. points: (t_s, lat, lon, dist, hr)"""
    desc = [{"key": k, "metricsIndex": i} for i, k in enumerate(KEYS)]
    rows = [{"metrics": [3.0, dist, hr, 12.5, 1_700_000_000_000 + t * 1000, lat, lon, 250]} for t, lat, lon, dist, hr in points]
    return {"metricDescriptors": desc, "activityDetailMetrics": rows}


def line(n, lat0=60.0, step=0.00005):
    """A run heading north from lat0, one point per second"""
    return [(t, lat0 + t * step, 25.0, t * 3.0, 140 + t % 5) for t in range(n)]


def test_thinned_to_one_point_per_5_seconds_keeping_the_last():
    r = rt.route_from_details(1, details(line(23)), zones=[])
    assert [p[0] for p in r["points"]] == [0, 5, 10, 15, 20, 22]
    assert r["fields"] == ["t", "lat", "lon", "dist", "speed", "hr", "ele"]
    assert r["points"][1] == [5, 60.00025, 25.0, 15.0, 3.0, 140, 12.5]
    assert r["gps"] is True and r["hidden"] == 0


def test_positions_inside_a_zone_are_removed_but_the_rest_stays():
    # Starts at home (inside 400 m) and runs out of the zone
    r = rt.route_from_details(1, details(line(200, step=0.0001)), zones=[HOME])
    inside = [p for p in r["points"] if p[1] is None]
    assert inside and r["hidden"] == len(inside)
    assert all(p[2] is None for p in inside), "latitude and longitude both go"
    assert all(p[3] is not None and p[5] is not None for p in inside), "distance and heart rate stay"
    outside = [p for p in r["points"] if p[1] is not None]
    assert all(rt.distance_m(p[1], p[2], 60.0, 25.0) > 400 for p in outside)


def test_a_run_without_gps():
    r = rt.route_from_details(1, details([(t, None, None, t * 3.0, 140) for t in range(20)]), zones=[HOME])
    assert r["gps"] is False and r["hidden"] == 0
    assert [p[0] for p in r["points"]] == [0, 5, 10, 15, 19], "time, distance and HR are kept without GPS"


def test_zone_added_later_is_applied_to_saved_routes(tmp_path):
    rt.save_route(rt.route_from_details(7, details(line(200, step=0.0001)), zones=[]), tmp_path)
    assert rt.saved_ids(tmp_path) == {7}
    assert rt.hide_zones_in_saved([HOME], tmp_path) == 1
    saved = json.loads((tmp_path / "7.json").read_text(encoding="utf-8"))
    assert saved["hidden"] > 0
    assert rt.hide_zones_in_saved([HOME], tmp_path) == 0, "nothing new to hide the second time"


def test_outdoor_runs_only():
    assert rt.is_outdoor_run({"type": "running", "distance_m": 5000})
    assert rt.is_outdoor_run({"type": "trail_running", "distance_m": 5000})
    assert not rt.is_outdoor_run({"type": "treadmill_running", "distance_m": 5000})
    assert not rt.is_outdoor_run({"type": "indoor_running", "distance_m": 5000})
    assert not rt.is_outdoor_run({"type": "cycling", "distance_m": 20000})


def test_distance():
    assert abs(rt.distance_m(60.0, 25.0, 60.001, 25.0) - 111.2) < 0.5
