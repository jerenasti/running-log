"""Tests for fetch_garmin.py. They never contact Garmin: FakeGarmin returns fixed answers.

Run:  uv run --with pytest --with garminconnect==0.3.2 pytest tests -q
"""

import json
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
import fetch_garmin as fg  # noqa: E402


class FakeGarmin:
    """Stands in for garminconnect.Garmin. `answers` maps a URL prefix to the response."""

    def __init__(self, answers=None, **methods):
        self.answers = answers or {}
        self.display_name = "tester"
        self.calls = []
        for name, value in methods.items():
            setattr(self, name, lambda *args, _v=value, _n=name, **kw: (self.calls.append(_n), _v)[1])

    def connectapi(self, url, params=None):
        self.calls.append(url)
        for prefix, answer in self.answers.items():
            if url.startswith(prefix):
                return answer
        raise AssertionError(f"unexpected request {url}")


# ---------- The most important rule: never log in with a password ----------

def test_connect_stops_without_tokens_and_never_logs_in(tmp_path, monkeypatch):
    created = []
    monkeypatch.setattr(fg, "Garmin", lambda *a, **kw: created.append((a, kw)))
    with pytest.raises(SystemExit) as exit_info:
        fg.connect(tmp_path)  # empty folder: no garmin_tokens.json
    assert "never logs in with a password" in str(exit_info.value)
    assert created == [], "Garmin() must not even be created without tokens"


def test_connect_creates_garmin_without_email_or_password(tmp_path, monkeypatch):
    (tmp_path / "garmin_tokens.json").write_text("{}")
    created = []

    class Recorder:
        def __init__(self, *args, **kwargs):
            created.append((args, kwargs))

        def login(self, tokenstore):
            self.tokenstore = tokenstore

    monkeypatch.setattr(fg, "Garmin", Recorder)
    fg.connect(tmp_path)
    assert created == [((), {})], "no email, no password"


def test_connect_stops_on_invalid_tokens(tmp_path, monkeypatch):
    (tmp_path / "garmin_tokens.json").write_text("{}")

    class Expired:
        def login(self, tokenstore):
            raise fg.GarminConnectAuthenticationError("Username and password are required")

    monkeypatch.setattr(fg, "Garmin", Expired)
    with pytest.raises(SystemExit) as exit_info:
        fg.connect(tmp_path)
    assert "garmin-mcp-auth" in str(exit_info.value)


# ---------- Reading Garmin's answers ----------

def test_simplify_activity():
    raw = {"activityId": 1, "startTimeLocal": "2026-09-25 18:05:16", "activityType": {"typeKey": "running"},
           "activityName": "W4 Fri Tempo", "distance": 5119.18, "duration": 1570.05, "averageHR": 164.0, "maxHR": 182.0,
           "averageSpeed": 3.2609, "trainingEffectLabel": "VO2MAX", "calories": 417.0, "workoutId": 1704302220,
           "hrTimeInZone_1": 24.0, "hrTimeInZone_2": 84.3, "hrTimeInZone_3": 214.5, "hrTimeInZone_4": 1156.9, "hrTimeInZone_5": 59.0}
    a = fg.simplify(raw)
    assert a == {"id": 1, "start_time": "2026-09-25 18:05:16", "type": "running", "name": "W4 Fri Tempo",
                 "distance_m": 5119, "duration_s": 1570, "avg_hr": 164, "max_hr": 182, "avg_speed_mps": 3.261,
                 "te_label": "VO2MAX", "calories": 417, "workout_id": 1704302220, "hr_zones_s": [24, 84, 214, 1157, 59]}


def test_simplify_activity_without_heart_rate():
    a = fg.simplify({"activityId": 2, "activityType": {"typeKey": "running"}, "distance": 5530, "duration": 1858})
    assert a["avg_hr"] is None and a["hr_zones_s"] is None and a["calories"] is None


def test_hr_settings_prefers_the_default_sport():
    g = FakeGarmin({"/biometric-service/heartRateZones": [
        {"sport": "RUNNING", "maxHeartRateUsed": 190, "zone1Floor": 1, "zone2Floor": 2, "zone3Floor": 3, "zone4Floor": 4, "zone5Floor": 5},
        {"sport": "DEFAULT", "maxHeartRateUsed": 201, "zone1Floor": 98, "zone2Floor": 118, "zone3Floor": 137,
         "zone4Floor": 161, "zone5Floor": 181, "trainingMethod": "HR_MAX"}]})
    assert fg.fetch_hr_settings(g) == {"max_hr": 201, "zone_floors": [98, 118, 137, 161, 181], "method": "HR_MAX"}


def test_resting_hr_skips_empty_days():
    g = FakeGarmin({"/userstats-service/wellness/daily/tester": {"allMetrics": {"metricsMap": {"WELLNESS_RESTING_HEART_RATE": [
        {"value": 46.0, "calendarDate": "2026-09-25"}, {"value": None, "calendarDate": "2026-09-26"}]}}}})
    assert fg.fetch_resting_hr(g, date(2026, 9, 1), date(2026, 9, 26)) == [{"date": "2026-09-25", "bpm": 46}]


def test_hrv_sleep_and_body_battery():
    g = FakeGarmin({
        "/hrv-service/hrv/daily/": {"hrvSummaries": [{"calendarDate": "2026-09-25", "lastNightAvg": 88, "weeklyAvg": 82,
                                                      "status": "BALANCED", "baseline": {"balancedLow": 55, "balancedUpper": 91}}]},
        "/sleep-service/stats/sleep/daily/": {"individualStats": [{"calendarDate": "2026-09-25", "values": {
            "totalSleepTimeInSeconds": 32220, "sleepScore": 83, "sleepScoreQuality": "GOOD",
            "deepTime": 6360, "lightTime": 19500, "remTime": 6360, "awakeTime": 2220}}]},
    }, get_body_battery=[{"date": "2026-09-25", "charged": 67, "drained": 61,
                          "bodyBatteryValuesArray": [[1, 43], [2, 100], [3, None], [4, 32]]}])
    s, e = date(2026, 8, 30), date(2026, 9, 26)
    assert fg.fetch_hrv(g, s, e) == [{"date": "2026-09-25", "last_night": 88, "weekly_avg": 82, "status": "BALANCED",
                                      "baseline_low": 55, "baseline_high": 91}]
    assert fg.fetch_sleep(g, s, e)[0]["score"] == 83
    assert fg.fetch_body_battery(g, s, e) == [{"date": "2026-09-25", "high": 100, "low": 32, "charged": 67, "drained": 61}]


def test_schedule_keeps_workouts_once_with_their_workout_id():
    items = {"calendarItems": [
        {"id": 1, "itemType": "workout", "date": "2026-09-25", "title": "Tempo", "sportTypeKey": "running", "workoutId": 11},
        {"id": 2, "itemType": "workout", "date": "2026-09-27", "title": "Long Run (12km)", "sportTypeKey": "running", "workoutId": 12},
        {"id": 3, "itemType": "activity", "date": "2026-09-27", "title": "Not a workout"},
    ]}
    g = FakeGarmin(get_scheduled_workouts=items)  # both months return the same items, like Garmin's overlapping views
    assert fg.fetch_schedule(g, date(2026, 9, 26)) == [
        {"date": "2026-09-25", "title": "Tempo", "sport": "running", "workout_id": 11},
        {"date": "2026-09-27", "title": "Long Run (12km)", "sport": "running", "workout_id": 12}]


TODAY = date(2026, 9, 26)
w = lambda d, wid, title="W": {"date": d, "title": title, "sport": "running", "workout_id": wid}


def test_merge_plan_keeps_past_workouts_garmin_has_dropped():
    previous = [w("2026-09-20", 1), w("2026-09-23", 2)]
    fetched = [w("2026-09-25", 3), w("2026-09-27", 4)]
    assert [x["workout_id"] for x in fg.merge_plan(previous, fetched, TODAY)] == [1, 2, 3, 4]


def test_merge_plan_future_follows_garmin():
    # A workout Runna moved from Sunday to Monday: the old Sunday entry must not stay in the plan
    previous = [w("2026-09-27", 4)]
    fetched = [w("2026-09-28", 4)]
    assert fg.merge_plan(previous, fetched, TODAY) == [w("2026-09-28", 4)]


def test_merge_plan_drops_entries_older_than_a_year_and_no_duplicates():
    previous = [w("2025-09-01", 9), w("2026-09-20", 1)]
    fetched = [w("2026-09-20", 1)]
    assert fg.merge_plan(previous, fetched, TODAY) == [w("2026-09-20", 1)]


def test_descriptions_are_fetched_once_and_reused():
    g = FakeGarmin(get_workout_by_id={"description": "5km easy run (no faster than 5:40/km)"})
    previous = [{**w("2026-09-20", 1), "description": "old text"}]
    plan = [w("2026-09-20", 1), w("2026-09-29", 2), w("2026-08-01", 3), {"date": "2026-09-30", "title": "No id", "sport": "running"}]
    out = fg.add_descriptions(g, plan, previous, TODAY)
    assert out[0]["description"] == "old text", "reused, not fetched again"
    assert out[1]["description"] == "5km easy run (no faster than 5:40/km)"
    assert "description" not in out[2], "too old to fetch"
    assert g.calls == ["get_workout_by_id"], "exactly one request"


def test_merge_plan_keeps_saved_plan_when_the_calendar_request_failed():
    previous = [w("2026-09-20", 1), w("2026-09-28", 5)]
    assert fg.merge_plan(previous, None, TODAY) == previous


def test_weight_takes_the_latest_weigh_in_in_kg():
    g = FakeGarmin(get_weigh_ins={"dailyWeightSummaries": [
        {"summaryDate": "2026-08-01", "latestWeight": {"weight": 90100.0, "calendarDate": "2026-08-01"}},
        {"summaryDate": "2026-09-07", "latestWeight": {"weight": 89400.0, "calendarDate": "2026-09-07"}}]})
    assert fg.fetch_weight(g, date(2026, 1, 1), date(2026, 9, 26)) == {"kg": 89.4, "date": "2026-09-07"}
    assert fg.fetch_weight(FakeGarmin(get_weigh_ins={}), date(2026, 1, 1), date(2026, 9, 26)) is None


def test_vo2max_and_race_predictions():
    g = FakeGarmin({"/metrics-service/metrics/maxmet/daily/": [
        {"generic": {"calendarDate": "2026-09-25", "vo2MaxPreciseValue": 49.7, "vo2MaxValue": 50.0}},
        {"generic": {"calendarDate": "2026-09-26", "vo2MaxPreciseValue": None, "vo2MaxValue": None}}]},
        get_race_predictions=[{"calendarDate": "2026-08-01", "timeMarathon": None},
                              {"calendarDate": "2026-09-26", "timeMarathon": 14571, "timeHalfMarathon": 6589, "time10K": 2851, "time5K": 1320}])
    assert fg.fetch_vo2max(g, date(2026, 1, 1), date(2026, 9, 26)) == [{"date": "2026-09-25", "vo2max": 49.7}]
    assert fg.fetch_race_predictions(g, date(2026, 1, 1), date(2026, 9, 26)) == [
        {"date": "2026-09-26", "marathon_s": 14571, "half_s": 6589, "k10_s": 2851, "k5_s": 1320}]


# ---------- Time trials ----------

@pytest.mark.parametrize("name, expected", [
    ("W6 Sat Time Trial - 5km", True), ("5km TT", True), ("Timetrial 3k", True), ("Fitness Test - 1 mile", True),
    ("Aika-ajo 10 km", True), ("Testijuoksu 10 km", True),
    ("W3 Tue Easy Run", False), ("Tempo 2-1-1", False), ("Attempt long run", False), ("Attest", False),
])
def test_time_trial_names(name, expected):
    # Regression: the word boundaries (\b) once got lost, and "5km TT" was not recognised
    assert bool(fg.TIME_TRIAL.search(name)) is expected


def test_laps_keep_distance_time_intensity_and_step():
    g = FakeGarmin(get_activity_splits={"lapDTOs": [
        {"distance": 500.0, "duration": 177.3, "intensityType": "WARMUP", "wktStepIndex": 0},
        {"distance": 1000.0, "duration": 303.0, "intensityType": "ACTIVE", "wktStepIndex": 1}]})
    assert fg.fetch_laps(g, 1) == [{"distance_m": 500, "duration_s": 177.3, "intensity": "WARMUP", "step": 0},
                                   {"distance_m": 1000, "duration_s": 303.0, "intensity": "ACTIVE", "step": 1}]


def test_previous_laps_are_reused(tmp_path, monkeypatch):
    out = tmp_path / "activities.json"
    out.write_text(json.dumps({"activities": [{"id": 7, "laps": [{"distance_m": 5000}]}, {"id": 8}]}), encoding="utf-8")
    monkeypatch.setattr(fg, "OUTPUT", out)
    assert fg.previous_laps() == {7: [{"distance_m": 5000}]}
    monkeypatch.setattr(fg, "OUTPUT", tmp_path / "missing.json")
    assert fg.previous_laps() == {}


# ---------- Status file (read by the app and the failure notification) ----------

def run_main(tmp_path, monkeypatch, run):
    status = tmp_path / "fetch_status.json"
    monkeypatch.setattr(fg, "STATUS", status)
    monkeypatch.setattr(fg, "WARNINGS", [])
    monkeypatch.setattr(fg, "run", run)
    return status


def test_status_after_a_successful_run_lists_warnings(tmp_path, monkeypatch):
    def run():
        fg.optional("sleep", lambda: (_ for _ in ()).throw(ValueError("boom")), [])
    status = run_main(tmp_path, monkeypatch, run)
    fg.main()
    s = json.loads(status.read_text(encoding="utf-8"))
    assert s["ok"] is True and s["error"] is None and s["warnings"] == ["sleep"]


def test_status_records_why_the_run_stopped_in_plain_words_and_in_detail(tmp_path, monkeypatch):
    def run():
        raise fg.Stopped("invalid_tokens", "The saved tokens are not valid (expired).")
    status = run_main(tmp_path, monkeypatch, run)
    with pytest.raises(SystemExit):
        fg.main()
    s = json.loads(status.read_text(encoding="utf-8"))
    assert s["ok"] is False and s["reason"] == "invalid_tokens"
    assert s["message"] == fg.REASONS["invalid_tokens"], "plain words for the user"
    assert s["error"] == "The saved tokens are not valid (expired).", "technical text for Show details"


def test_status_records_unexpected_errors_and_recognises_network_errors(tmp_path, monkeypatch):
    def run():
        raise ConnectionError("no network")
    status = run_main(tmp_path, monkeypatch, run)
    with pytest.raises(ConnectionError):
        fg.main()
    s = json.loads(status.read_text(encoding="utf-8"))
    assert s["error"] == "ConnectionError: no network" and s["reason"] == "network"


def test_status_keeps_the_time_of_the_last_success_when_a_run_fails(tmp_path, monkeypatch):
    status = run_main(tmp_path, monkeypatch, lambda: None)
    fg.main()
    success_at = json.loads(status.read_text(encoding="utf-8"))["at"]

    def failing():
        raise fg.Stopped("rate_limited", "429")
    monkeypatch.setattr(fg, "run", failing)
    with pytest.raises(SystemExit):
        fg.main()
    s = json.loads(status.read_text(encoding="utf-8"))
    assert s["ok"] is False and s["last_success"] == success_at


# ---------- Token folder comes only from settings.json ----------

def test_tokens_dir_comes_from_settings_and_ignores_environment_variables(tmp_path, monkeypatch):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"garmin_tokens_dir": str(tmp_path / "tokens")}), encoding="utf-8")
    monkeypatch.setattr(fg, "SETTINGS", settings)
    monkeypatch.setenv("GARMINTOKENS", str(tmp_path / "somewhere-else"))
    assert fg.tokens_dir() == tmp_path / "tokens"


def test_tokens_dir_falls_back_to_the_default_without_settings(tmp_path, monkeypatch):
    monkeypatch.setattr(fg, "SETTINGS", tmp_path / "missing.json")
    assert fg.tokens_dir() == fg.DEFAULT_TOKENSTORE
    broken = tmp_path / "broken.json"
    broken.write_text("{ not json", encoding="utf-8")
    monkeypatch.setattr(fg, "SETTINGS", broken)
    assert fg.tokens_dir() == fg.DEFAULT_TOKENSTORE


def test_project_settings_point_to_the_garmin_mcp_auth_folder():
    assert fg.tokens_dir() == Path.home() / "AppData" / "Local" / "garminconnect"


# ---------- Optional requests ----------

def test_optional_request_failure_is_only_a_warning(capsys):
    def broken():
        raise ValueError("boom")
    assert fg.optional("sleep", broken, []) == []
    assert "Warning: could not fetch sleep" in capsys.readouterr().out


def test_optional_request_429_still_stops():
    def too_many():
        raise fg.GarminConnectTooManyRequestsError("429")
    with pytest.raises(SystemExit):
        fg.optional("sleep", too_many, [])
