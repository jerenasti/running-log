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
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

# Default token location. Can be overridden with the GARMINTOKENS environment variable.
DEFAULT_TOKENSTORE = Path.home() / "AppData" / "Local" / "garminconnect"
OUTPUT = Path(__file__).parent / "data" / "activities.json"


def connect(tokenstore: Path) -> Garmin:
    """Connect using the saved tokens. Never uses a password."""
    if not (tokenstore / "garmin_tokens.json").is_file():
        sys.exit(
            f"No saved tokens found in {tokenstore}.\n"
            "Create them with the garmin-mcp-auth tool. This script never logs in with a password."
        )

    # Garmin() without email and password: if loading the tokens fails,
    # the library raises an error instead of trying to log in.
    garmin = Garmin()
    try:
        garmin.login(str(tokenstore))
    except GarminConnectTooManyRequestsError:
        sys.exit("Garmin returned 429 (too many requests). Wait and try again later.")
    except (GarminConnectAuthenticationError, GarminConnectConnectionError) as e:
        sys.exit(
            f"The saved tokens are not valid ({e}).\n"
            "Renew them with the garmin-mcp-auth tool and run this script again."
        )
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


def optional(label: str, fetch, default):
    """Run an extra request. A failure only prints a warning, so the activities are still saved.
    429 (too many requests) still stops the script, as everywhere else."""
    try:
        return fetch()
    except GarminConnectTooManyRequestsError:
        sys.exit("Garmin returned 429 (too many requests). Wait and try again later.")
    except Exception as e:
        print(f"Warning: could not fetch {label} ({e}). Continuing without it.")
        return default


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--days", type=int, default=365, help="how many days back to fetch (default 365)")
    args = parser.parse_args()

    tokenstore = Path(os.getenv("GARMINTOKENS") or DEFAULT_TOKENSTORE).expanduser()
    garmin = connect(tokenstore)

    start = date.today() - timedelta(days=args.days)
    print(f"Fetching activities {start} - {date.today()} ...")
    try:
        raw = garmin.get_activities_by_date(start.isoformat(), date.today().isoformat())
    except GarminConnectTooManyRequestsError:
        sys.exit("Garmin returned 429 (too many requests). Wait and try again later.")

    activities = sorted((simplify(a) for a in raw), key=lambda a: a["start_time"] or "", reverse=True)
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
    }

    # Write to a temporary file first and swap it in only at the end,
    # so an interrupted run never leaves a broken JSON file.
    OUTPUT.parent.mkdir(exist_ok=True)
    tmp = OUTPUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(OUTPUT)

    print(f"Saved {len(activities)} activities, {len(resting_hr)} resting HR days"
          f"{', HR zones' if hr_settings else ''}, {len(recovery['hrv'])} HRV / {len(recovery['sleep'])} sleep /"
          f" {len(recovery['body_battery'])} Body Battery days to {OUTPUT}")


if __name__ == "__main__":
    main()
