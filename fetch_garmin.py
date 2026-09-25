# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "garminconnect==0.3.2",
# ]
# ///
"""Hakee harjoitukset Garmin Connectista ja kirjoittaa ne tiedostoon data/activities.json.

Käyttö:
    uv run fetch_garmin.py              # viimeiset 365 päivää
    uv run fetch_garmin.py --days 730   # viimeiset 2 vuotta

Kirjautuminen tehdään AINOASTAAN tallennetuilla tunnisteilla. Skripti ei koskaan
kirjaudu salasanalla, koska Garmin estää toistuvat kirjautumiset (HTTP 429).
Jos tunnisteet ovat vanhentuneet, uusi ne garmin-mcp-auth-työkalulla.
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

# Tunnisteiden oletussijainti. Voi korvata ympäristömuuttujalla GARMINTOKENS.
DEFAULT_TOKENSTORE = Path.home() / "AppData" / "Local" / "garminconnect"
OUTPUT = Path(__file__).parent / "data" / "activities.json"


def connect(tokenstore: Path) -> Garmin:
    """Avaa yhteyden tallennetuilla tunnisteilla. Ei koskaan käytä salasanaa."""
    if not (tokenstore / "garmin_tokens.json").is_file():
        sys.exit(
            f"Tunnisteita ei löytynyt kansiosta {tokenstore}.\n"
            "Luo ne garmin-mcp-auth-työkalulla. Tämä skripti ei kirjaudu salasanalla."
        )

    # Garmin() ilman sähköpostia ja salasanaa: jos tunnisteiden lataus epäonnistuu,
    # kirjasto nostaa virheen sen sijaan, että yrittäisi kirjautua.
    garmin = Garmin()
    try:
        garmin.login(str(tokenstore))
    except GarminConnectTooManyRequestsError:
        sys.exit("Garmin palautti 429 (liikaa pyyntöjä). Odota ja yritä myöhemmin uudelleen.")
    except (GarminConnectAuthenticationError, GarminConnectConnectionError) as e:
        sys.exit(
            f"Tallennetut tunnisteet eivät kelpaa ({e}).\n"
            "Uusi ne garmin-mcp-auth-työkalulla ja aja skripti uudelleen."
        )
    return garmin


def simplify(activity: dict) -> dict:
    """Poimii Garminin laajasta harjoitusdatasta vain sovelluksen tarvitsemat kentät."""
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
    parser.add_argument("--days", type=int, default=365, help="kuinka monta päivää taaksepäin (oletus 365)")
    args = parser.parse_args()

    tokenstore = Path(os.getenv("GARMINTOKENS") or DEFAULT_TOKENSTORE).expanduser()
    garmin = connect(tokenstore)

    start = date.today() - timedelta(days=args.days)
    print(f"Haetaan harjoitukset {start} - {date.today()} ...")
    try:
        raw = garmin.get_activities_by_date(start.isoformat(), date.today().isoformat())
    except GarminConnectTooManyRequestsError:
        sys.exit("Garmin palautti 429 (liikaa pyyntöjä). Odota ja yritä myöhemmin uudelleen.")

    activities = sorted((simplify(a) for a in raw), key=lambda a: a["start_time"] or "", reverse=True)
    payload = {
        "fetchedAt": datetime.now().isoformat(timespec="seconds"),
        "activities": activities,
    }

    # Kirjoitetaan ensin väliaikaistiedostoon ja vaihdetaan vasta lopuksi,
    # jotta keskeytynyt ajo ei jätä rikkinäistä JSON-tiedostoa.
    OUTPUT.parent.mkdir(exist_ok=True)
    tmp = OUTPUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(OUTPUT)

    print(f"Tallennettu {len(activities)} harjoitusta tiedostoon {OUTPUT}")


if __name__ == "__main__":
    main()
