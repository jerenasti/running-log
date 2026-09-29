"""Sending a planned route to Garmin as a course (a fake client: Garmin is never contacted)."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
import courses  # noqa: E402
import plans  # noqa: E402

PLAN = {"id": "0123456789ab", "name": "Seaside <loop>", "climb": 12.0, "points": [[60.1, 24.9], [60.11, 24.92]],
        "segments": [{"points": [[60.1, 24.9, 10.0], [60.105, 24.91, 16.0]]}, {"points": [[60.105, 24.91, 16.0], [60.11, 24.92, 11.0]]}]}


class FakeClient:
    def __init__(self, geo=None, saved=None):
        self.calls = []
        self.geo = geo if geo is not None else [
            {"latitude": 60.1, "longitude": 24.9, "elevation": 10.0},
            {"latitude": 60.105, "longitude": 24.91, "elevation": None},
            {"latitude": 60.11, "longitude": 24.92, "elevation": 11.0}]
        self.saved = saved if saved is not None else {"courseId": 987, "courseName": "Seaside <loop>", "distanceMeter": 1400.0}

    def post(self, domain, path, **kw):
        self.calls.append(("post", path, kw))
        return {"geoPoints": self.geo} if path.endswith("/import") else self.saved

    def delete(self, domain, path, **kw):
        self.calls.append(("delete", path, kw))


def test_plan_line_and_gpx():
    line = courses.plan_line(PLAN)
    assert line == [[60.1, 24.9, 10.0], [60.105, 24.91, 16.0], [60.11, 24.92, 11.0]], "joints are not doubled"
    g = courses.gpx(line, PLAN["name"]).decode()
    assert "<name>Seaside &lt;loop&gt;</name>" in g and g.count("<trkpt ") == 3


def test_send_is_two_requests_and_the_course_is_private_running():
    c = FakeClient()
    assert courses.send(c, PLAN) == {"course_id": 987, "name": "Seaside <loop>", "distance_m": 1400.0}
    assert [x[1] for x in c.calls] == ["/course-service/course/import", "/course-service/course"]
    upload = c.calls[0][2]["files"]["file"]
    assert upload[0] == "Seaside <loop>.gpx" and upload[2] == "application/gpx+xml"
    body = c.calls[1][2]["json"]
    assert body["rulePK"] == courses.PRIVATE == 2, "only you can see it"
    assert body["activityTypePk"] == courses.RUNNING == 1
    assert body["courseName"] == "Seaside <loop>" and body["elevationGainMeter"] == 12.0
    assert 1560 < body["distanceMeter"] < 1580, "two legs of about 785 m, measured from Garmin's points"
    assert body["geoPoints"][1]["elevation"] == 0.0, "Garmin needs a number"


def test_send_fails_clearly():
    with pytest.raises(courses.CourseError):
        courses.send(FakeClient(geo=[]), PLAN)
    with pytest.raises(courses.CourseError):
        courses.send(FakeClient(saved={}), PLAN)
    with pytest.raises(courses.CourseError):
        courses.send(FakeClient(), {**PLAN, "segments": []})


def test_remove():
    c = FakeClient()
    courses.remove(c, "987")
    assert c.calls == [("delete", "/course-service/course/987", {"api": True})]


def test_a_sent_plan_that_is_edited_is_marked(tmp_path):
    p = plans.save({k: v for k, v in PLAN.items() if k != "id"}, tmp_path)
    plans.set_course(p["id"], {"id": 987, "sent": "2026-09-30T08:00:00"}, tmp_path)
    assert plans.summaries(tmp_path)[0]["garmin_course"] == {"id": 987, "sent": "2026-09-30T08:00:00"}
    plans.save({**PLAN, "id": p["id"], "name": "Seaside loop v2"}, tmp_path)
    assert plans.load(p["id"], tmp_path)["garmin_course"]["changed"] is True
    plans.set_course(p["id"], None, tmp_path)
    assert "garmin_course" not in plans.load(p["id"], tmp_path)


def test_send_course_script_explains_missing_tokens(tmp_path, monkeypatch, capsys):
    import fetch_garmin
    import send_course
    monkeypatch.setattr(plans, "PLANS_DIR", tmp_path)
    saved = plans.save({k: v for k, v in PLAN.items() if k != "id"})
    monkeypatch.setattr(fetch_garmin, "tokens_dir", lambda: tmp_path / "no-tokens")
    assert send_course.main(["send_course.py", "send", saved["id"]]) == 1
    out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert out["ok"] is False and out["code"] == "no_tokens" and "garmin-mcp-auth" in out["error"]
    assert "garmin_course" not in plans.load(saved["id"]), "nothing is marked as sent"
