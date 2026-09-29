"""Saved route plans (the Routes tab): data/plans/<id>.json. Standard library only; serve.py calls this.

A plan: {id, name, points: [[lat, lon], ...] (the waypoints), segments: [{points: [[lat, lon, ele], ...]}, ...]
(the routed line between each pair of waypoints, so opening a plan needs no routing requests),
distance (m), climb (m), created, updated}. Plans are locations, so they live in data/ (not in git).
"""

import json
import re
import secrets
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent
PLANS_DIR = ROOT / "data" / "plans"
ID = re.compile(r"^[0-9a-f]{12}$")         # only ids made here: no path can be smuggled in
MAX_POINTS = 200
MAX_LINE_POINTS = 50_000


class PlanError(Exception):
    pass


def _folder(folder):
    return folder or PLANS_DIR


def _latlon(p, n):
    return (isinstance(p, list) and len(p) >= 2 and len(p) <= n
            and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in p[:2])
            and -90 <= p[0] <= 90 and -180 <= p[1] <= 180)


def validate(plan: dict) -> dict:
    """{field: message} for a plan sent by the page; empty when it is fine"""
    errors = {}
    name = plan.get("name")
    if not isinstance(name, str) or not name.strip():
        errors["name"] = "Give the route a name."
    elif len(name) > 80:
        errors["name"] = "Keep the name under 80 characters."
    pts, segs = plan.get("points"), plan.get("segments")
    if not isinstance(pts, list) or len(pts) < 2 or len(pts) > MAX_POINTS or not all(_latlon(p, 2) for p in pts):
        errors["points"] = f"A route needs 2 to {MAX_POINTS} points."
    elif not isinstance(segs, list) or len(segs) != len(pts) - 1:
        errors["segments"] = "The route is not complete yet."
    else:
        total = 0
        for s in segs:
            line = s.get("points") if isinstance(s, dict) else None
            if not isinstance(line, list) or not all(_latlon(p, 3) for p in line):
                errors["segments"] = "The route is not complete yet."
                break
            total += len(line)
        if total > MAX_LINE_POINTS:
            errors["segments"] = "The route is too long to save."
    for key in ("distance", "climb"):
        v = plan.get(key, 0)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0:
            errors[key] = "Invalid number."
    return errors


def save(plan: dict, folder: Path | None = None) -> dict:
    """Save a new plan (no id) or replace an existing one; returns the saved plan"""
    folder = _folder(folder)
    folder.mkdir(parents=True, exist_ok=True)
    now = datetime.now().isoformat(timespec="seconds")
    pid = plan.get("id")
    if pid is None:
        pid, created = secrets.token_hex(6), now
    else:
        old = load(pid, folder)                      # raises PlanError if it doesn't exist
        created = old.get("created", now)
    saved = {"id": pid, "name": plan["name"].strip(), "points": plan["points"],
             "segments": [{"points": s["points"]} for s in plan["segments"]],
             "distance": round(float(plan.get("distance", 0)), 1), "climb": round(float(plan.get("climb", 0)), 1),
             "created": created, "updated": now}
    path = folder / f"{pid}.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(saved, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)
    return saved


def load(pid, folder: Path | None = None) -> dict:
    if not isinstance(pid, str) or not ID.match(pid):
        raise PlanError("Unknown route.")
    path = _folder(folder) / f"{pid}.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise PlanError("Unknown route.") from None


def summaries(folder: Path | None = None) -> list[dict]:
    """[{id, name, distance, climb, updated}], newest first"""
    folder = _folder(folder)
    out = []
    for path in folder.glob("*.json") if folder.is_dir() else []:
        if not ID.match(path.stem):
            continue
        try:
            p = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        out.append({k: p.get(k) for k in ("id", "name", "distance", "climb", "updated")})
    return sorted(out, key=lambda p: p.get("updated") or "", reverse=True)


def delete(pid, folder: Path | None = None) -> None:
    load(pid, folder)                                # checks the id and that it exists
    (_folder(folder) / f"{pid}.json").unlink()
