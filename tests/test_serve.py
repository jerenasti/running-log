"""Tests for serve.py: the settings/status/refresh API and its localhost-only checks.
A real server runs on a free port; the Garmin fetch is replaced by a harmless command."""

import http.client
import json
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
import serve  # noqa: E402
import settings as st  # noqa: E402

EXAMPLE = json.loads((Path(__file__).parent.parent / "settings.example.json").read_text(encoding="utf-8"))


@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setattr(serve, "STATUS", tmp_path / "fetch_status.json")
    monkeypatch.setattr(serve, "REFRESH_LOG", tmp_path / "refresh.log")
    monkeypatch.setattr(st, "OLD_RACES", tmp_path / "no-races.json")
    refresher = serve.Refresher(command=[sys.executable, "-c", "import time; time.sleep(0.5)"], cooldown_s=60)
    httpd = serve.make_server(0, settings_path=tmp_path / "settings.json", refresher=refresher)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield httpd
    httpd.shutdown()
    httpd.server_close()
    if refresher.proc:
        refresher.proc.wait()


def call(httpd, method, path, body=None, headers=None):
    port = httpd.server_address[1]
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    h = {"Host": f"localhost:{port}"}
    if body is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
    res = conn.getresponse()
    data = res.read()
    conn.close()
    try:
        return res.status, json.loads(data)
    except ValueError:
        return res.status, data


def test_first_run_returns_defaults(server):
    code, body = call(server, "GET", "/api/settings")
    assert code == 200
    assert body == {"settings": st.DEFAULTS, "first_run": True}


def test_save_and_load_settings(server):
    code, body = call(server, "POST", "/api/settings", EXAMPLE)
    assert code == 200 and body["settings"]["goals"]["weekly_km"] == 40
    assert call(server, "GET", "/api/settings")[1] == {"settings": st.normalize(EXAMPLE), "first_run": False}


def test_invalid_settings_are_not_saved(server):
    bad = json.loads(json.dumps(EXAMPLE))
    bad["goals"]["main_race"]["goal"] = "3:30"
    code, body = call(server, "POST", "/api/settings", bad)
    assert code == 400
    assert "h:mm:ss" in body["errors"]["goals.main_race.goal"]
    assert not server.settings_path.exists()


def test_validate_checks_without_saving(server):
    bad = json.loads(json.dumps(EXAMPLE))
    bad["goals"]["weekly_km"] = -5
    assert call(server, "POST", "/api/validate", bad) == (200, {"errors": {"goals.weekly_km": "Enter a value between 0 and 500 km."}})
    assert call(server, "POST", "/api/validate", EXAMPLE) == (200, {"errors": {}})
    assert not server.settings_path.exists()


def test_check_tokens_only_looks_for_the_file(server, tmp_path):
    folder = tmp_path / "tokens"
    folder.mkdir()
    assert call(server, "POST", "/api/check-tokens", {"dir": str(folder)})[1]["found"] is False
    (folder / "garmin_tokens.json").write_text('{"secret": "never sent back"}', encoding="utf-8")
    code, body = call(server, "POST", "/api/check-tokens", {"dir": str(folder)})
    assert code == 200 and body == {"found": True, "folder": str(folder)}, "the answer never contains the tokens"
    assert call(server, "POST", "/api/check-tokens", {"dir": ""})[0] == 400
    assert call(server, "POST", "/api/check-tokens", {"dir": str(folder)}, {"Origin": "https://evil.example"})[0] == 403


def test_other_websites_and_hosts_are_refused(server):
    port = server.server_address[1]
    assert call(server, "POST", "/api/settings", EXAMPLE, {"Origin": "https://evil.example"})[0] == 403
    assert call(server, "POST", "/api/settings", EXAMPLE, {"Origin": f"http://localhost:{port}"})[0] == 200
    assert call(server, "GET", "/api/settings", headers={"Host": "evil.example"})[0] == 403, "DNS rebinding"
    assert call(server, "GET", "/index.html", headers={"Host": f"evil.example:{port}"})[0] == 403
    # A form post from another site can't send JSON without asking first, so plain text is refused
    assert call(server, "POST", "/api/refresh", headers={"Content-Type": "text/plain"})[0] == 403


def test_refresh_runs_once_and_then_waits(server):
    assert call(server, "POST", "/api/refresh", {})[0] == 202
    assert call(server, "GET", "/api/status")[1]["running"] is True
    assert call(server, "POST", "/api/refresh", {})[0] == 409, "already running"
    server.refresher.proc.wait()
    code, body = call(server, "POST", "/api/refresh", {})
    assert code == 429 and 0 < body["retry_after_s"] <= 60, "cooldown"


def test_cooldown_counts_the_scheduled_fetch(server):
    serve.STATUS.write_text(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "ok": True}), encoding="utf-8")
    code, body = call(server, "GET", "/api/status")
    assert body["status"]["ok"] is True and body["retry_after_s"] > 0
    assert call(server, "POST", "/api/refresh", {})[0] == 429


def test_static_files_still_work(server):
    code, body = call(server, "GET", "/index.html")
    assert code == 200 and b"Running Log" in body


# ---------- Route planning through the server ----------

def test_route_uses_the_key_from_settings_caches_and_hides_the_key(server, monkeypatch):
    calls = []

    def fake_router(key, a, b, profile):
        calls.append((key, a, b, profile))
        return {"points": [[a[0], a[1], 10.0], [b[0], b[1], 12.0]], "distance": 111.2, "ascent": 2.0, "descent": 0.0}

    server.router = fake_router
    settings = json.loads(json.dumps(EXAMPLE))
    settings["routing"] = {"ors_api_key": "secret123"}
    assert call(server, "POST", "/api/settings", settings)[0] == 200
    code, body = call(server, "GET", "/api/settings")
    assert "secret123" not in json.dumps(body), "the key never goes to the browser"
    # Saving the masked value back keeps the key
    assert call(server, "POST", "/api/settings", body["settings"])[0] == 200
    code, seg = call(server, "POST", "/api/route", {"a": [60.1, 24.9], "b": [60.101, 24.9]})
    assert code == 200 and seg["distance"] == 111.2
    assert calls == [("secret123", [60.1, 24.9], [60.101, 24.9], "foot-walking")]
    call(server, "POST", "/api/route", {"a": [60.1, 24.9], "b": [60.101, 24.9]})
    assert len(calls) == 1, "the same segment again comes from the cache"
    assert call(server, "POST", "/api/route", {"a": [95, 24.9], "b": [60.1, 24.9]})[0] == 400
    assert call(server, "POST", "/api/route", {"a": [60.1, 24.9], "b": [60.2, 24.9]}, {"Origin": "https://evil.example"})[0] == 403


def test_route_without_a_key_says_what_to_do(server):
    code, body = call(server, "POST", "/api/route", {"a": [60.1, 24.9], "b": [60.101, 24.9]})
    assert code == 400 and body["code"] == "no_key" and "Settings" in body["error"]


# ---------- Saved route plans ----------

def test_plans_through_the_server(server, tmp_path):
    server.plans_dir = tmp_path / "plans"
    plan = {"name": "Loop", "points": [[60.1, 24.9], [60.11, 24.92]],
            "segments": [{"points": [[60.1, 24.9, 10.0], [60.11, 24.92, 11.0]]}], "distance": 1500, "climb": 1}
    code, body = call(server, "POST", "/api/plans", plan)
    assert code == 200
    pid = body["plan"]["id"]
    assert call(server, "GET", "/api/plans")[1]["plans"][0]["name"] == "Loop"
    assert call(server, "GET", f"/api/plans/{pid}")[1]["plan"]["points"] == plan["points"]
    assert call(server, "GET", "/api/plans/..%2Fsettings")[0] == 404
    assert call(server, "POST", "/api/plans", {**plan, "name": ""})[0] == 400
    assert call(server, "POST", "/api/plans/delete", {"id": pid}, {"Origin": "https://evil.example"})[0] == 403
    assert call(server, "POST", "/api/plans/delete", {"id": pid})[0] == 200
    assert call(server, "GET", "/api/plans")[1]["plans"] == []


def test_route_heights_from_mml_in_finland_only(server):
    server.router = lambda key, a, b, profile: {"points": [[a[0], a[1], 5.0], [b[0], b[1], 6.0]], "distance": 100, "ascent": 1, "descent": 0}
    seen = []

    def fake_mml(points, key):
        seen.append(key)
        return [[p[0], p[1], 40.0] for p in points], len(points)

    server.elevation = fake_mml
    settings = json.loads(json.dumps(EXAMPLE))
    settings["routing"] = {"ors_api_key": "ors", "mml_api_key": ""}
    call(server, "POST", "/api/settings", settings)
    assert call(server, "POST", "/api/route", {"a": [60.1, 24.9], "b": [60.101, 24.9]})[1]["elevation"] == "ors", "no MML key"
    settings["routing"]["mml_api_key"] = "mml"
    call(server, "POST", "/api/settings", settings)
    code, seg = call(server, "POST", "/api/route", {"a": [60.2, 24.9], "b": [60.201, 24.9]})
    assert seg["elevation"] == "mml" and [p[2] for p in seg["points"]] == [40.0, 40.0] and seen == ["mml"]
    code, seg = call(server, "POST", "/api/route", {"a": [59.33, 18.07], "b": [59.331, 18.07]})
    assert seg["elevation"] == "ors" and seen == ["mml"], "Stockholm: no MML request"
