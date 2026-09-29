"""Settings for Running Log: defaults, migration from older files, validation and saving.

Everything personal lives in settings.json (not in git). settings.example.json shows the shape.
Used by serve.py (the Settings view) and fetch_garmin.py (token folder, fetch range).
Standard library only, so serve.py still runs without any packages.
"""

import copy
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent
SETTINGS = ROOT / "settings.json"
OLD_RACES = ROOT / "content" / "races.json"   # races before settings.json existed; imported once

DEFAULTS = {
    "goals": {
        "main_race": None,         # {name, date, distance_km, goal}
        "time_trials": [],         # [{name, date, distance_km, result?}]
        "weekly_km": 0,            # 0 = no weekly goal
    },
    "plan": {
        "source": "garmin",        # "garmin" (workouts in the Garmin calendar) | "none"
        "easy_keywords": ["easy", "recovery", "kevyt", "palauttava"],   # same as DEFAULT_EASY_WORDS in js/metrics.js
        "easy_max_hr": None,       # None = below heart rate zone 4
    },
    "body": {
        "weight_source": "garmin", "weight_kg": None,
        "max_hr_source": "garmin", "max_hr": None,
        "resting_hr_source": "garmin", "resting_hr": None,
    },
    "privacy": {
        "zones": [],               # [{name, lat, lon, radius_m}], hidden from route maps later
    },
    "data": {
        "garmin_tokens_dir": "~/AppData/Local/garminconnect",
        "fetch_days": 365,
    },
    "appearance": {
        "theme": "system",         # "system" | "dark" | "light"
        "units": "km",             # "km" | "mi"
    },
    "routing": {
        "ors_api_key": "",         # openrouteservice key for the Routes tab; never sent to the browser
        "mml_api_key": "",         # MML (National Land Survey of Finland) key: 2 m elevation in Finland
    },
}

# API keys are never sent to the browser: GET /api/settings shows this instead, and a save that sends
# it back keeps the stored key.
SECRET_MASK = "•" * 8
SECRETS = [("routing", "ors_api_key"), ("routing", "mml_api_key")]


def mask_secrets(settings: dict) -> dict:
    """A copy for the browser: every set API key replaced by SECRET_MASK"""
    out = copy.deepcopy(settings)
    for section, key in SECRETS:
        if out.get(section, {}).get(key):
            out[section][key] = SECRET_MASK
    return out


def keep_secrets(new: dict, old: dict) -> dict:
    """Put the stored key back where the browser sent the mask (the user didn't change it)"""
    for section, key in SECRETS:
        if new.get(section, {}).get(key) == SECRET_MASK:
            new[section][key] = old.get(section, {}).get(key, "")
    return new

DEFAULT_ZONE_RADIUS_M = 400


class SettingsError(Exception):
    """settings.json exists but can't be read."""


def defaults() -> dict:
    return copy.deepcopy(DEFAULTS)


def _merge(base: dict, extra: dict) -> dict:
    """Values from `extra` over `base`; nested sections are merged, unknown keys are dropped."""
    out = copy.deepcopy(base)
    for key, value in (extra or {}).items():
        if key not in base:
            continue
        if isinstance(base[key], dict):
            if isinstance(value, dict):          # a section that isn't an object keeps its defaults
                out[key] = _merge(base[key], value)
        else:
            out[key] = value
    return out


def normalize(raw: dict) -> dict:
    """Settings sent by the app in the full shape: missing values get their defaults, unknown keys go."""
    return _merge(DEFAULTS, raw)


def migrate(raw: dict, races_file: Path | None = None) -> dict:
    """Bring an older or missing settings file up to date (without saving it).

    - A top-level garmin_tokens_dir (the first settings.json) moves under data.
    - If there are no goals yet, races from content/races.json are imported: the race with a goal
      time becomes the main race, the others become time trials (they keep their results).
    """
    races_file = races_file or OLD_RACES
    raw = dict(raw or {})
    if "garmin_tokens_dir" in raw:
        raw.setdefault("data", {})
        raw["data"] = {**raw["data"], "garmin_tokens_dir": raw.pop("garmin_tokens_dir")}
    raw.pop("_help", None)
    if "goals" not in raw and races_file.is_file():
        try:
            races = json.loads(races_file.read_text(encoding="utf-8")).get("races", [])
        except (OSError, ValueError, AttributeError):
            races = []
        main = next((r for r in races if r.get("goal")), None)
        keep = ("name", "date", "distance_km", "goal", "result")
        raw["goals"] = {
            "main_race": {k: main[k] for k in keep if k in main and k != "result"} if main else None,
            "time_trials": [{k: r[k] for k in keep if k in r and k != "goal"} for r in races if r is not main],
        }
    return _merge(DEFAULTS, raw)


def load(path: Path | None = None, races_file: Path | None = None) -> tuple[dict, bool]:
    """(settings, first_run). first_run is True when settings.json doesn't exist yet."""
    path = path or SETTINGS
    if not path.is_file():
        return migrate({}, races_file), True
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as e:
        raise SettingsError(f"settings.json is not valid JSON ({e}). Fix it or delete it to start over.") from e
    if not isinstance(raw, dict):
        raise SettingsError("settings.json should contain a JSON object ({ ... }).")
    return migrate(raw, races_file), False


def save(settings: dict, path: Path | None = None) -> None:
    """Write via a temporary file, so an interrupted save never leaves a broken settings.json."""
    path = path or SETTINGS
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def upgrade_file(path: Path | None = None, races_file: Path | None = None) -> bool:
    """Rewrite an existing settings.json in the current shape. Returns True if it changed."""
    path = path or SETTINGS
    if not path.is_file():
        return False
    current, _ = load(path, races_file)
    if json.loads(path.read_text(encoding="utf-8")) == current:
        return False
    save(current, path)
    return True


# ---------- Validation ----------

TIME = re.compile(r"^\d{1,2}:[0-5]\d:[0-5]\d$")


def _date_error(value) -> str | None:
    if value in (None, ""):
        return "Enter a date."
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return "Use the format YYYY-MM-DD, e.g. 2027-05-15."
    try:
        date.fromisoformat(value)
    except ValueError:
        return "This date doesn't exist."
    return None


def _time_error(value) -> str | None:
    if not isinstance(value, str) or not TIME.match(value):
        return "Use the format h:mm:ss, e.g. 3:30:00 or 0:47:10."
    if all(int(x) == 0 for x in value.split(":")):
        return "The time can't be zero."
    return None


def _number_error(value, low, high, unit, whole=False) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return "Enter a number."
    if whole and value != int(value):
        return "Enter a whole number."
    if not low <= value <= high:
        return f"Enter a value between {low} and {high}{' ' + unit if unit else ''}."
    return None


def _race_errors(race, prefix: str, errors: dict, time_key: str | None, time_required: bool) -> None:
    if not isinstance(race, dict):
        errors[prefix] = "Invalid race."
        return
    name = race.get("name")
    if not isinstance(name, str) or not name.strip():
        errors[f"{prefix}.name"] = "Give the race a name."
    elif len(name) > 80:
        errors[f"{prefix}.name"] = "Keep the name under 80 characters."
    if err := _date_error(race.get("date")):
        errors[f"{prefix}.date"] = err
    if err := _number_error(race.get("distance_km"), 0.1, 300, "km"):
        errors[f"{prefix}.distance_km"] = err
    if time_key:
        value = race.get(time_key)
        if value in (None, ""):
            if time_required:
                errors[f"{prefix}.{time_key}"] = "Enter a time as h:mm:ss."
        elif err := _time_error(value):
            errors[f"{prefix}.{time_key}"] = err


def validate(s: dict) -> dict:
    """{field path: message} for every invalid value, e.g. {"goals.main_race.goal": "Use the format h:mm:ss ..."}.
    An empty dict means the settings are fine."""
    errors: dict = {}
    g = s["goals"]
    if g["main_race"] is not None:
        _race_errors(g["main_race"], "goals.main_race", errors, "goal", time_required=True)
    if not isinstance(g["time_trials"], list):
        errors["goals.time_trials"] = "Invalid list."
    else:
        for i, t in enumerate(g["time_trials"]):
            _race_errors(t, f"goals.time_trials.{i}", errors, "result", time_required=False)
    if err := _number_error(g["weekly_km"], 0, 500, "km"):
        errors["goals.weekly_km"] = err

    p = s["plan"]
    if p["source"] not in ("garmin", "none"):
        errors["plan.source"] = "Choose Garmin calendar or no plan."
    words = p["easy_keywords"]
    if not isinstance(words, list) or not all(isinstance(w, str) and w.strip() and len(w) <= 40 for w in words):
        errors["plan.easy_keywords"] = "Enter words separated by commas (each at most 40 characters)."
    if p["easy_max_hr"] is not None and (err := _number_error(p["easy_max_hr"], 80, 220, "bpm", whole=True)):
        errors["plan.easy_max_hr"] = err

    b = s["body"]
    for key, low, high, unit, whole in (("weight", 30, 250, "kg", False), ("max_hr", 120, 230, "bpm", True),
                                        ("resting_hr", 25, 120, "bpm", True)):
        field = "weight_kg" if key == "weight" else key
        source = b[f"{key}_source"]
        if source not in ("garmin", "manual"):
            errors[f"body.{key}_source"] = "Choose Garmin or manual."
        elif source == "manual" and (err := _number_error(b[field], low, high, unit, whole)):
            errors[f"body.{field}"] = err
    if (b["max_hr_source"] == "manual" and b["resting_hr_source"] == "manual"
            and not errors.get("body.max_hr") and not errors.get("body.resting_hr") and b["resting_hr"] >= b["max_hr"]):
        errors["body.resting_hr"] = "Resting heart rate must be lower than maximum heart rate."

    zones = s["privacy"]["zones"]
    if not isinstance(zones, list):
        errors["privacy.zones"] = "Invalid list."
    else:
        for i, z in enumerate(zones):
            prefix = f"privacy.zones.{i}"
            if not isinstance(z, dict):
                errors[prefix] = "Invalid zone."
                continue
            if not isinstance(z.get("name"), str) or not z["name"].strip():
                errors[f"{prefix}.name"] = "Give the zone a name, e.g. Home."
            if err := _number_error(z.get("lat"), -90, 90, "", False):
                errors[f"{prefix}.lat"] = err
            if err := _number_error(z.get("lon"), -180, 180, "", False):
                errors[f"{prefix}.lon"] = err
            if err := _number_error(z.get("radius_m"), 50, 5000, "m", whole=True):
                errors[f"{prefix}.radius_m"] = err

    d = s["data"]
    if not isinstance(d["garmin_tokens_dir"], str) or not d["garmin_tokens_dir"].strip():
        errors["data.garmin_tokens_dir"] = "Enter the folder that contains garmin_tokens.json."
    if err := _number_error(d["fetch_days"], 7, 1095, "days", whole=True):
        errors["data.fetch_days"] = err

    a = s["appearance"]
    if a["theme"] not in ("system", "dark", "light"):
        errors["appearance.theme"] = "Choose system, dark or light."
    if a["units"] not in ("km", "mi"):
        errors["appearance.units"] = "Choose kilometres or miles."

    for field in ("ors_api_key", "mml_api_key"):
        key = s["routing"][field]
        if not isinstance(key, str) or len(key) > 200 or (key != SECRET_MASK and any(c.isspace() for c in key)):
            errors[f"routing.{field}"] = "Paste the key without spaces (at most 200 characters)."
    return errors


def tokens_dir(settings: dict) -> Path:
    return Path(settings["data"]["garmin_tokens_dir"]).expanduser()
