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
    return {
        "id": activity.get("activityId"),
        "start_time": activity.get("startTimeLocal"),          # "2026-09-25 18:05:16"
        "type": (activity.get("activityType") or {}).get("typeKey"),  # "running"
        "name": activity.get("activityName"),
        "distance_m": round(activity.get("distance") or 0),
        "duration_s": round(activity.get("duration") or 0),
        "avg_hr": round(activity["averageHR"]) if activity.get("averageHR") else None,
    }


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
    payload = {
        "fetchedAt": datetime.now().isoformat(timespec="seconds"),
        "activities": activities,
    }

    # Write to a temporary file first and swap it in only at the end,
    # so an interrupted run never leaves a broken JSON file.
    OUTPUT.parent.mkdir(exist_ok=True)
    tmp = OUTPUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(OUTPUT)

    print(f"Saved {len(activities)} activities to {OUTPUT}")


if __name__ == "__main__":
    main()
