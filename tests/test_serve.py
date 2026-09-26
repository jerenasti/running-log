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
