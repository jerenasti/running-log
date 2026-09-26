# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "garminconnect==0.3.2",
# ]
# ///
"""Fetch activities from Garmin Connect and write them to data/activities.json.

Usage:
    uv run fetch_garmin.py              # last 365 days
    uv run fetch_garmin.py --days 730   # last 2 years

Authentication uses ONLY saved tokens. This script never logs in with a password,
because Garmin blocks repeated logins (HTTP 429).
If the tokens have expired, renew them with the garmin-mcp-auth tool.
"""

import argparse
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

SETTINGS = Path(__file__).parent / "settings.json"
DEFAULT_TOKENSTORE = Path.home() / "AppData" / "Local" / "garminconnect"   # used only if settings.json is missing
OUTPUT = Path(__file__).parent / "data" / "activities.json"


def tokens_dir() -> Path:
    """The token folder always comes from settings.json (garmin_tokens_dir). Environment variables are
    ignored on purpose, so nothing outside the settings can point the script at another folder."""
    try:
        value = json.loads(SETTINGS.read_text(encoding="utf-8")).get("garmin_tokens_dir")
    except (OSError, ValueError):
        value = None
    return Path(value).expanduser() if value else DEFAULT_TOKENSTORE


# Why a run stopped, in words for the user. The app and the Windows notification show these;
# the technical message goes under "Show details".
REASONS = {
    "no_tokens": "Garmin sign-in is missing. Sign in once with the garmin-mcp-auth tool.",
    "invalid_tokens": "Garmin sign-in has expired. Renew it with the garmin-mcp-auth tool.",
    "rate_limited": "Garmin is limiting requests right now. Tomorrow morning's fetch usually works.",
    "network": "Could not reach Garmin. Check the internet connection.",
    "unknown": "The Garmin fetch failed unexpectedly.",
}


class Stopped(SystemExit):
    """Stops the script like sys.exit(message), and remembers the reason for data/fetch_status.json."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason

# Time trials (e.g. from a Runna plan) are recognised by their name. Their laps are fetched
# so the app can find the trial itself inside the warm-up and cool-down. Keep this in sync
# with TIME_TRIAL_WORDS in js/forecast.js.
TIME_TRIAL = re.compile(r"time\s*trial|\btt\b|\btest\b|testi|aika-ajo", re.IGNORECASE)


def connect(tokenstore: Path) -> Garmin:
    """Connect using the saved tokens. Never uses a password."""
    if not (tokenstore / "garmin_tokens.json").is_file():
        raise Stopped("no_tokens",
                      f"No saved tokens found in {tokenstore}.\n"
                      "Create them with the garmin-mcp-auth tool. This script never logs in with a password.")

    # Garmin() without email and password: if loading the tokens fails,
    # the library raises an error instead of trying to log in.
    garmin = Garmin()
    try:
        garmin.login(str(tokenstore))
    except GarminConnectTooManyRequestsError:
        raise Stopped("rate_limited", "Garmin returned 429 (too many requests). Wait and try again later.")
    except (GarminConnectAuthenticationError, GarminConnectConnectionError) as e:
        raise Stopped("invalid_tokens",
                      f"The saved tokens are not valid ({e}).\n"
                      "Renew them with the garmin-mcp-auth tool and run this script again.")
    return garmin


def simplify(activity: dict) -> dict:
    """Pick only the fields the app needs from Garmin's large activity data."""
    zones = [activity.get(f"hrTimeInZone_{i}") for i in range(1, 6)]
    return {
        "id": activity.get("activityId"),
        "start_time": activity.get("startTimeLocal"),          # "2026-09-25 18:05:16"
        "type": (activity.get("activityType") or {}).get("typeKey"),  # "running"
        "name": activity.get("activityName"),
        "distance_m": round(activity.get("distance") or 0),
        "duration_s": round(activity.get("duration") or 0),
        "avg_hr": round(activity["averageHR"]) if activity.get("averageHR") else None,
        "max_hr": round(activity["maxHR"]) if activity.get("maxHR") else None,
        "avg_speed_mps": round(activity["averageSpeed"], 3) if activity.get("averageSpeed") else None,
        "te_label": activity.get("trainingEffectLabel"),       # Garmin's classification, e.g. "AEROBIC_BASE"
        "calories": round(activity["calories"]) if activity.get("calories") else None,  # Garmin's estimate
        "workout_id": activity.get("workoutId"),  # set when the run followed a scheduled workout
        # Seconds in heart rate zones 1–5 (null if the activity has no heart rate)
        "hr_zones_s": [round(z or 0) for z in zones] if any(z is not None for z in zones) else None,
    }


def fetch_hr_settings(garmin: Garmin) -> dict | None:
    """Max HR and zone boundaries from the user's Garmin heart rate zone settings."""
    zones = garmin.connectapi("/biometric-service/heartRateZones") or []
    z = next((z for z in zones if z.get("sport") == "DEFAULT"), zones[0] if zones else None)
    if not z:
        return None
    return {
        "max_hr": z.get("maxHeartRateUsed"),
        "zone_floors": [z.get(f"zone{i}Floor") for i in range(1, 6)],  # lower limit of zones 1–5 (bpm)
        "method": z.get("trainingMethod"),
    }


def fetch_resting_hr(garmin: Garmin, start: date, end: date) -> list[dict]:
    """Daily resting heart rate for the whole period in a single request."""
    data = garmin.connectapi(
        f"/userstats-service/wellness/daily/{garmin.display_name}",
        params={"fromDate": start.isoformat(), "untilDate": end.isoformat(), "metricId": 60},
    )
    values = ((data or {}).get("allMetrics") or {}).get("metricsMap", {}).get("WELLNESS_RESTING_HEART_RATE") or []
    return [{"date": v["calendarDate"], "bpm": round(v["value"])} for v in values if v.get("value")]


RECOVERY_DAYS = 28  # HRV, sleep and Body Battery: the last 4 weeks, one request each


def fetch_hrv(garmin: Garmin, start: date, end: date) -> list[dict]:
    """Nightly HRV with Garmin's status and personal baseline (normal range)."""
    data = garmin.connectapi(f"/hrv-service/hrv/daily/{start.isoformat()}/{end.isoformat()}") or {}
    out = []
    for h in data.get("hrvSummaries") or []:
        base = h.get("baseline") or {}
        out.append({
            "date": h.get("calendarDate"),
            "last_night": h.get("lastNightAvg"),          # ms, average of last night
            "weekly_avg": h.get("weeklyAvg"),
            "status": h.get("status"),                    # e.g. "BALANCED", "UNBALANCED", "LOW"
            "baseline_low": base.get("balancedLow"),      # Garmin's personal normal range
            "baseline_high": base.get("balancedUpper"),
        })
    return out


def fetch_sleep(garmin: Garmin, start: date, end: date) -> list[dict]:
    """Nightly sleep: duration, score and stages. The date is the morning you woke up."""
    data = garmin.connectapi(f"/sleep-service/stats/sleep/daily/{start.isoformat()}/{end.isoformat()}") or {}
    out = []
    for s in data.get("individualStats") or []:
        v = s.get("values") or {}
        out.append({
            "date": s.get("calendarDate"),
            "duration_s": v.get("totalSleepTimeInSeconds"),
            "score": v.get("sleepScore"),
            "quality": v.get("sleepScoreQuality"),        # e.g. "FAIR", "GOOD"
            "deep_s": v.get("deepTime"),
            "light_s": v.get("lightTime"),
            "rem_s": v.get("remTime"),
            "awake_s": v.get("awakeTime"),
        })
    return out


def fetch_body_battery(garmin: Garmin, start: date, end: date) -> list[dict]:
    """Daily Body Battery: highest and lowest value of the day, charged and drained."""
    out = []
    for d in garmin.get_body_battery(start.isoformat(), end.isoformat()) or []:
        levels = [v[1] for v in d.get("bodyBatteryValuesArray") or [] if len(v) > 1 and v[1] is not None]
        out.append({
            "date": d.get("date"),
            "high": max(levels) if levels else None,     # usually right after waking up
            "low": min(levels) if levels else None,
            "charged": d.get("charged"),
            "drained": d.get("drained"),
        })
    return out


def fetch_schedule(garmin: Garmin, today: date) -> list[dict]:
    """Workouts in the Garmin calendar this month and next month. Runna keeps only the days around today there."""
    next_month = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    workouts = {}
    for d in (today, next_month):
        for item in (garmin.get_scheduled_workouts(d.year, d.month) or {}).get("calendarItems") or []:
            if item.get("itemType") == "workout" and item.get("date"):
                workouts[item.get("id")] = {"date": item["date"], "title": item.get("title"), "sport": item.get("sportTypeKey"),
                                            "workout_id": item.get("workoutId")}  # the same id is on the activity when it is done
    return sorted(workouts.values(), key=lambda w: w["date"])


def merge_plan(previous: list[dict], fetched: list[dict] | None, today: date) -> list[dict]:
    """Plan history: Garmin's calendar drops past workouts, so the ones seen on earlier runs are kept.
    Past days come from earlier runs (plus anything Garmin still shows); from today on, only Garmin's
    current calendar counts, so a workout moved or removed in Runna disappears from the future.
    fetched is None when the calendar request failed: then the saved plan is kept as it is."""
    if fetched is None:
        return previous
    key = lambda w: (w["date"], w.get("workout_id") or w.get("title"))
    oldest = (today - timedelta(days=365)).isoformat()
    merged = {key(w): w for w in previous if oldest <= w.get("date", "") < today.isoformat()}
    merged.update({key(w): w for w in fetched})
    return sorted(merged.values(), key=lambda w: w["date"])


def add_descriptions(garmin: Garmin, plan: list[dict], previous: list[dict], today: date) -> list[dict]:
    """Runna writes its paces in the workout description ("no faster than 5:40/km"). Each description is
    fetched once (one request per new workout) and reused from the saved plan after that."""
    known = {w["workout_id"]: w["description"] for w in previous if w.get("workout_id") and w.get("description") is not None}
    recent = (today - timedelta(days=7)).isoformat()
    for w in plan:
        wid = w.get("workout_id")
        if not wid or w.get("description") is not None:
            continue
        if wid in known:
            w["description"] = known[wid]
        elif w["date"] >= recent:
            w["description"] = optional(f"description of {w.get('title')}",
                                        lambda i=wid: ((garmin.get_workout_by_id(i) or {}).get("description") or "")[:1000], None)
    return plan


def previous_plan() -> list[dict]:
    """The plan saved by an earlier run."""
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8")).get("schedule") or []
    except (OSError, ValueError):
        return []


def fetch_weight(garmin: Garmin, start: date, end: date) -> dict | None:
    """The latest weigh-in in the period, in kg."""
    data = garmin.get_weigh_ins(start.isoformat(), end.isoformat()) or {}
    found = []
    for day in data.get("dailyWeightSummaries") or []:
        for m in [day.get("latestWeight")] + (day.get("allWeightMetrics") or []):
            if m and m.get("weight"):
                found.append((m.get("calendarDate") or day.get("summaryDate"), m["weight"]))
    if not found:
        return None
    when, grams = max(found, key=lambda x: x[0] or "")
    return {"kg": round(grams / 1000, 1), "date": when}


def fetch_vo2max(garmin: Garmin, start: date, end: date) -> list[dict]:
    """Running VO2max history (Garmin's precise value, one decimal)."""
    out = []
    for d in garmin.connectapi(f"/metrics-service/metrics/maxmet/daily/{start.isoformat()}/{end.isoformat()}") or []:
        g = d.get("generic") or {}
        value = g.get("vo2MaxPreciseValue") or g.get("vo2MaxValue")
        if value:
            out.append({"date": g.get("calendarDate"), "vo2max": value})
    return out


def fetch_race_predictions(garmin: Garmin, start: date, end: date) -> list[dict]:
    """Garmin's daily race time predictions in seconds (days without a prediction are left out)."""
    out = []
    for d in garmin.get_race_predictions(start.isoformat(), end.isoformat(), "daily") or []:
        if d.get("timeMarathon"):
            out.append({"date": d.get("calendarDate"), "marathon_s": d.get("timeMarathon"), "half_s": d.get("timeHalfMarathon"),
                        "k10_s": d.get("time10K"), "k5_s": d.get("time5K")})
    return out


def fetch_laps(garmin: Garmin, activity_id: int) -> list[dict]:
    """Laps of one activity. step = the workout step the lap belongs to (Garmin splits long steps into 1 km laps)."""
    data = garmin.get_activity_splits(activity_id) or {}
    return [{"distance_m": round(lap.get("distance") or 0), "duration_s": round(lap.get("duration") or 0, 1),
             "intensity": lap.get("intensityType"), "step": lap.get("wktStepIndex")}
            for lap in data.get("lapDTOs") or []]


def previous_laps() -> dict:
    """Laps saved by an earlier run, by activity id, so they are not fetched again every day."""
    try:
        old = json.loads(OUTPUT.read_text(encoding="utf-8"))
        return {a["id"]: a["laps"] for a in old.get("activities", []) if a.get("laps")}
    except (OSError, ValueError):
        return {}


STATUS = OUTPUT.parent / "fetch_status.json"
WARNINGS: list[str] = []   # optional requests that failed during this run


def optional(label: str, fetch, default):
    """Run an extra request. A failure only prints a warning, so the activities are still saved.
    429 (too many requests) still stops the script, as everywhere else."""
    try:
        return fetch()
    except GarminConnectTooManyRequestsError:
        raise Stopped("rate_limited", "Garmin returned 429 (too many requests). Wait and try again later.")
    except Exception as e:
        print(f"Warning: could not fetch {label} ({e}). Continuing without it.")
        WARNINGS.append(label)
        return default


def previous_success() -> str | None:
    """Time of the last successful run, from the previous status file."""
    try:
        old = json.loads(STATUS.read_text(encoding="utf-8"))
        return old.get("last_success") or (old.get("at") if old.get("ok") else None)
    except (OSError, ValueError):
        return None


def write_status(ok: bool, reason: str | None = None, error: str | None = None) -> None:
    """data/fetch_status.json: how the last run went. The app and the failure notification read it.
    message = what to tell the user; error = the technical text, shown only under "Show details"."""
    now = datetime.now().isoformat(timespec="seconds")
    STATUS.parent.mkdir(exist_ok=True)
    STATUS.write_text(json.dumps({
        "at": now, "ok": ok, "reason": reason,
        "message": REASONS.get(reason) if reason else None, "error": error,
        "last_success": now if ok else previous_success(),
        "warnings": WARNINGS,
    }, ensure_ascii=False, indent=1), encoding="utf-8")


def looks_like_network_error(e: Exception) -> bool:
    names = " ".join(c.__name__ for c in type(e).__mro__)
    return any(w in names for w in ("ConnectionError", "Timeout", "SSLError"))


def main() -> None:
    """Run the fetch and record the outcome in data/fetch_status.json, also when it stops with an error."""
    try:
        run()
    except SystemExit as e:
        if e.code not in (0, None):
            write_status(False, getattr(e, "reason", "unknown"), str(e.code))
        raise
    except Exception as e:  # e.g. no network: record it, then show the normal traceback
        write_status(False, "network" if looks_like_network_error(e) else "unknown", f"{type(e).__name__}: {e}")
        raise
    write_status(True)


def run() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=365, help="how many days back to fetch (default 365)")
    args = parser.parse_args()

    garmin = connect(tokens_dir())

    start = date.today() - timedelta(days=args.days)
    print(f"Fetching activities {start} - {date.today()} ...")
    try:
        raw = garmin.get_activities_by_date(start.isoformat(), date.today().isoformat())
    except GarminConnectTooManyRequestsError:
        raise Stopped("rate_limited", "Garmin returned 429 (too many requests). Wait and try again later.")

    activities = sorted((simplify(a) for a in raw), key=lambda a: a["start_time"] or "", reverse=True)
    cached = previous_laps()
    saved_plan = previous_plan()
    for a in activities:
        if "run" in (a["type"] or "") and TIME_TRIAL.search(a["name"] or ""):
            a["laps"] = cached.get(a["id"]) or optional(f"laps of {a['name']}", lambda i=a["id"]: fetch_laps(garmin, i), None)
    hr_settings = optional("heart rate zones", lambda: fetch_hr_settings(garmin), None)
    resting_hr = optional("resting heart rate", lambda: fetch_resting_hr(garmin, start, date.today()), [])
    rec_start = date.today() - timedelta(days=RECOVERY_DAYS - 1)
    recovery = {
        "hrv": optional("HRV", lambda: fetch_hrv(garmin, rec_start, date.today()), []),
        "sleep": optional("sleep", lambda: fetch_sleep(garmin, rec_start, date.today()), []),
        "body_battery": optional("Body Battery", lambda: fetch_body_battery(garmin, rec_start, date.today()), []),
    }

    payload = {
        "fetchedAt": datetime.now().isoformat(timespec="seconds"),
        "activities": activities,
        "hr_settings": hr_settings,
        "resting_hr": resting_hr,
        "recovery": recovery,
        # Plan history: saved plan + Garmin's current calendar (if the calendar fails, keep the saved plan)
        "schedule": add_descriptions(
            garmin,
            merge_plan(saved_plan, optional("scheduled workouts", lambda: fetch_schedule(garmin, date.today()), None), date.today()),
            saved_plan, date.today()),
        "weight": optional("weight", lambda: fetch_weight(garmin, start, date.today()), None),
        # Garmin allows at most one year per request for race predictions
        "vo2max": optional("VO2max", lambda: fetch_vo2max(garmin, start, date.today()), []),
        "race_predictions": optional("race predictions",
                                     lambda: fetch_race_predictions(garmin, max(start, date.today() - timedelta(days=365)), date.today()), []),
    }

    # Write to a temporary file first and swap it in only at the end,
    # so an interrupted run never leaves a broken JSON file.
    OUTPUT.parent.mkdir(exist_ok=True)
    tmp = OUTPUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(OUTPUT)

    print(f"Saved {len(activities)} activities, {len(resting_hr)} resting HR days"
          f"{', HR zones' if hr_settings else ''}, {len(recovery['hrv'])} HRV / {len(recovery['sleep'])} sleep /"
          f" {len(recovery['body_battery'])} Body Battery days, {len(payload['schedule'])} scheduled workouts,"
          f" weight {payload['weight']['kg'] if payload['weight'] else 'n/a'}, {len(payload['vo2max'])} VO2max /"
          f" {len(payload['race_predictions'])} race prediction days to {OUTPUT}")


if __name__ == "__main__":
    main()
