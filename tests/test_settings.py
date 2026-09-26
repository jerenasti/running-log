"""Tests for settings.py: defaults, migration from older files, validation and saving."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
import settings as st  # noqa: E402

EXAMPLE = Path(__file__).parent.parent / "settings.example.json"


def valid() -> dict:
    return st.normalize(json.loads(EXAMPLE.read_text(encoding="utf-8")))


def test_example_file_is_valid_and_complete():
    raw = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    assert st.validate(valid()) == {}
    assert set(raw) == set(st.DEFAULTS), "the example shows every section"


def test_missing_file_is_a_first_run_with_defaults(tmp_path):
    s, first_run = st.load(tmp_path / "settings.json", tmp_path / "no-races.json")
    assert first_run is True
    assert s == st.DEFAULTS
    assert st.validate(s) == {}


def test_broken_file_gives_a_clear_error(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text("{ not json", encoding="utf-8")
    with pytest.raises(st.SettingsError, match="not valid JSON"):
        st.load(path, tmp_path / "no-races.json")


def test_first_settings_format_and_races_json_are_migrated(tmp_path):
    path, races = tmp_path / "settings.json", tmp_path / "races.json"
    path.write_text(json.dumps({"_help": "old", "garmin_tokens_dir": "C:/tokens"}), encoding="utf-8")
    races.write_text(json.dumps({"races": [
        {"date": "2026-10-10", "name": "10 km test", "distance_km": 10, "result": "0:47:10"},
        {"date": "2027-05-15", "name": "Marathon", "distance_km": 42.195, "goal": "3:30:00"},
    ]}), encoding="utf-8")
    s, first_run = st.load(path, races)
    assert first_run is False
    assert s["data"]["garmin_tokens_dir"] == "C:/tokens"
    assert s["goals"]["main_race"] == {"name": "Marathon", "date": "2027-05-15", "distance_km": 42.195, "goal": "3:30:00"}
    assert s["goals"]["time_trials"] == [{"name": "10 km test", "date": "2026-10-10", "distance_km": 10, "result": "0:47:10"}]
    assert "_help" not in s

    assert st.upgrade_file(path, races) is True
    assert json.loads(path.read_text(encoding="utf-8")) == s
    assert st.upgrade_file(path, races) is False, "already up to date"
    races.write_text(json.dumps({"races": []}), encoding="utf-8")
    assert st.load(path, races)[0]["goals"]["main_race"]["name"] == "Marathon", "races.json is imported only once"


def test_unknown_keys_are_dropped_and_wrong_sections_keep_defaults():
    s = st.normalize({"goals": 5, "extra": 1, "data": {"fetch_days": 30, "secret": "x"}})
    assert s["goals"] == st.DEFAULTS["goals"]
    assert "extra" not in s and "secret" not in s["data"]
    assert s["data"]["fetch_days"] == 30


@pytest.mark.parametrize("field, value, message", [
    ("date", "8.5.2027", "YYYY-MM-DD"),
    ("date", "2027-02-30", "doesn't exist"),
    ("date", "", "Enter a date"),
    ("goal", "3:30", "h:mm:ss"),
    ("goal", "3:75:00", "h:mm:ss"),
    ("goal", "0:00:00", "zero"),
    ("goal", "", "Enter a time"),
    ("distance_km", "42", "number"),
    ("distance_km", 0, "between"),
    ("name", " ", "name"),
])
def test_main_race_validation(field, value, message):
    s = valid()
    s["goals"]["main_race"][field] = value
    errors = st.validate(s)
    assert list(errors) == [f"goals.main_race.{field}"]
    assert message in errors[f"goals.main_race.{field}"]


def test_time_trial_result_is_optional_but_checked():
    s = valid()
    s["goals"]["time_trials"][1].pop("result", None)
    assert st.validate(s) == {}
    s["goals"]["time_trials"][0]["result"] = "47:10"
    assert list(st.validate(s)) == ["goals.time_trials.0.result"]


def test_manual_values_are_checked_only_when_manual():
    s = valid()
    s["body"]["max_hr"] = 999
    assert st.validate(s) == {}, "ignored while the source is Garmin"
    s["body"]["max_hr_source"] = "manual"
    assert "body.max_hr" in st.validate(s)
    s["body"].update(max_hr=120, resting_hr_source="manual", resting_hr=120)
    assert "lower than maximum" in st.validate(s)["body.resting_hr"]
    s["body"]["max_hr"] = 190.5
    assert "whole number" in st.validate(s)["body.max_hr"]


def test_other_sections():
    s = valid()
    s["plan"]["easy_keywords"] = ["easy", ""]
    s["privacy"]["zones"][0]["radius_m"] = 10
    s["data"]["fetch_days"] = 5000
    s["appearance"]["units"] = "furlongs"
    assert set(st.validate(s)) == {"plan.easy_keywords", "privacy.zones.0.radius_m", "data.fetch_days", "appearance.units"}


def test_save_writes_json_that_loads_back(tmp_path):
    path = tmp_path / "settings.json"
    st.save(valid(), path)
    assert st.load(path, tmp_path / "no-races.json") == (valid(), False)
    assert not path.with_suffix(".json.tmp").exists()
