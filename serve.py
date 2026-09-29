"""Local server for Running Log: serves the app and a small settings/refresh API.

Usage:
    uv run --no-project python serve.py            # http://localhost:8000
    uv run --no-project python serve.py --port 8080
    uv run --no-project python serve.py --settings test-settings.json   # e.g. to try the first-run wizard

Standard library only (no packages to install). Besides serving files like `python -m http.server`:
- JavaScript and CSS are always sent with the correct MIME type (on Windows the registry can map
  .js to text/plain, and browsers refuse to run ES modules then), and responses are marked no-store,
  so an edited file shows up on reload.
- API:
    GET  /api/settings   {settings, first_run}          settings.json, or the defaults if it is missing
    POST /api/settings   the whole settings object      → 200 {settings} or 400 {errors: {field: message}}
    GET  /api/status     {status, running, retry_after_s}  how the last Garmin fetch went
    POST /api/validate   the whole settings object      → 200 {errors} without saving (first-run wizard steps)
    POST /api/check-tokens {dir}                        → {found, folder}: is garmin_tokens.json there (never read)
    POST /api/route      {a: [lat, lon], b: [lat, lon]}  → one planned segment {points, distance, ascent, descent}
                         through openrouteservice (key from settings.json, cached in memory)
    GET  /api/plans      [{id, name, distance, climb, updated}]   saved route plans (data/plans/)
    GET  /api/plans/<id> the plan: waypoints + routed segments
    POST /api/plans      {id?, name, points, segments, distance, climb} → saved (a new id without one)
    POST /api/plans/delete {id}
    POST /api/course/send {id}   sends a saved plan to Garmin Connect as a private course (send_course.py)
    POST /api/course/remove {id} removes that course from Garmin Connect
    POST /api/refresh    starts fetch_garmin.py          → 202, 409 (already running), 429 (too soon)

Safety: listens on 127.0.0.1 only; requests must name localhost as the host (blocks DNS rebinding),
and POSTs must be JSON from this page (another website can't change settings or start a fetch).
The fetch uses only the saved Garmin tokens; nothing here ever logs in with a password.
"""

import argparse
import functools
import http.server
import json
import shutil
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

import elevation
import plans
import routing
import settings as app_settings

ROOT = Path(__file__).parent
STATUS = ROOT / "data" / "fetch_status.json"
REFRESH_LOG = ROOT / "data" / "refresh.log"
REFRESH_COOLDOWN_S = 15 * 60     # Garmin rate-limits: at most one manual fetch per 15 minutes
MAX_BODY = 100_000               # bytes; settings are a few kB
MAX_PLAN_BODY = 3_000_000        # a saved route with its routed line (tens of thousands of points)


def read_status() -> dict | None:
    try:
        return json.loads(STATUS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


class Refresher:
    """Runs fetch_garmin.py in the background: one run at a time, and not again within the cooldown."""

    def __init__(self, command: list[str] | None = None, cooldown_s: int = REFRESH_COOLDOWN_S):
        uv = shutil.which("uv")
        self.command = command or ([uv, "run", "fetch_garmin.py"] if uv else None)
        self.cooldown_s = cooldown_s
        self.proc: subprocess.Popen | None = None
        self.started_at: float | None = None      # time.time() of our last start
        self.lock = threading.Lock()

    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def retry_after(self) -> int:
        """Seconds until a new fetch is allowed (counts the scheduled morning fetch too)."""
        last = self.started_at or 0
        at = (read_status() or {}).get("at")
        try:
            last = max(last, datetime.fromisoformat(at).timestamp()) if at else last
        except ValueError:
            pass
        return max(0, int(last + self.cooldown_s - time.time()))

    def start(self) -> tuple[int, dict]:
        with self.lock:
            if not self.command:
                return 500, {"error": "uv was not found, so the fetch can't be started. Install uv or run fetch_garmin.py yourself."}
            if self.running():
                return 409, {"error": "A fetch is already running."}
            wait = self.retry_after()
            if wait:
                return 429, {"error": f"Garmin limits how often data can be fetched. Try again in {wait // 60 + 1} min.",
                             "retry_after_s": wait}
            REFRESH_LOG.parent.mkdir(exist_ok=True)
            log = REFRESH_LOG.open("w", encoding="utf-8")
            self.proc = subprocess.Popen(self.command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            self.started_at = time.time()
            return 202, {"started": True}


class CourseRunner:
    """Runs `uv run send_course.py send|remove <plan id>` (the Garmin library lives in uv's environment):
    one at a time, never retried, 2 minutes at most. Returns the script's JSON answer."""

    def __init__(self):
        self.lock = threading.Lock()

    def __call__(self, action: str, pid: str) -> tuple[int, dict]:
        uv = shutil.which("uv")
        if not uv:
            return 500, {"error": "uv was not found, so the course can't be sent."}
        if not self.lock.acquire(blocking=False):
            return 409, {"error": "A course is already being sent."}
        try:
            done = subprocess.run([uv, "run", "send_course.py", action, pid], cwd=ROOT, capture_output=True,
                                  text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return 504, {"error": "Garmin did not answer in time. Check Garmin Connect before sending again."}
        finally:
            self.lock.release()
        lines = [ln for ln in done.stdout.splitlines() if ln.strip().startswith("{")]
        try:
            answer = json.loads(lines[-1])
        except (IndexError, ValueError):
            return 502, {"error": "Sending failed without an answer.", "detail": (done.stderr or "")[-300:]}
        return (200 if answer.get("ok") else 502), answer


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---------- checks ----------
    def host_ok(self) -> bool:
        return self.headers.get("Host", "") in self.server.allowed_hosts

    def post_ok(self) -> bool:
        origin = self.headers.get("Origin")
        json_body = self.headers.get("Content-Type", "").split(";")[0].strip() == "application/json"
        return json_body and (origin is None or origin in self.server.allowed_origins)

    def send_json(self, code: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---------- route planning (the API key stays on this server) ----------
    def route(self, body: dict) -> None:
        """POST /api/route {a: [lat, lon], b: [lat, lon], profile?} → one segment along roads and paths"""
        def point(v):
            ok = isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v)
            return ok and -90 <= v[0] <= 90 and -180 <= v[1] <= 180
        a, b, profile = body.get("a"), body.get("b"), body.get("profile", "foot-walking")
        if not point(a) or not point(b):
            return self.send_json(400, {"error": "Send two points as [lat, lon]."})
        cached = self.server.segments.get(a, b, profile)
        if cached:
            return self.send_json(200, cached)
        try:
            settings, _ = app_settings.load(self.server.settings_path)
            seg = self.server.router(settings["routing"]["ors_api_key"], a, b, profile)
        except app_settings.SettingsError as e:
            return self.send_json(500, {"error": str(e)})
        except routing.RoutingError as e:
            return self.send_json(e.status, {"error": str(e), "code": e.code})
        seg = self.add_elevation(seg, settings["routing"].get("mml_api_key", ""))
        self.server.segments.put(a, b, profile, seg)
        return self.send_json(200, seg)

    def add_elevation(self, seg: dict, mml_key: str) -> dict:
        """In Finland, with an MML key, the heights come from the 2 m elevation model; otherwise (and for
        points the model doesn't cover) openrouteservice's heights stay. seg["elevation"] says which."""
        seg = {**seg, "elevation": "ors"}
        if not mml_key or not any(elevation.in_finland(p[0], p[1]) for p in seg["points"]):
            return seg
        try:
            points, done = self.server.elevation(seg["points"], mml_key)
        except elevation.ElevationError as e:
            return {**seg, "elevation_note": str(e)}
        seg.update(points=points, elevation="mml" if done == len(points) else "mixed" if done else "ors")
        return seg

    # ---------- routes ----------
    def do_GET(self) -> None:
        if not self.host_ok():
            return self.send_json(403, {"error": "Open the app at http://localhost."})
        path = self.path.split("?")[0]
        if path == "/api/settings":
            try:
                settings, first_run = app_settings.load(self.server.settings_path)
            except app_settings.SettingsError as e:
                return self.send_json(500, {"error": str(e)})
            return self.send_json(200, {"settings": app_settings.mask_secrets(settings), "first_run": first_run})
        if path == "/api/status":
            r = self.server.refresher
            return self.send_json(200, {"status": read_status(), "running": r.running(), "retry_after_s": r.retry_after()})
        if path == "/api/plans":
            return self.send_json(200, {"plans": plans.summaries(self.server.plans_dir)})
        if path.startswith("/api/plans/"):
            try:
                return self.send_json(200, {"plan": plans.load(path.rsplit("/", 1)[1], self.server.plans_dir)})
            except plans.PlanError as e:
                return self.send_json(404, {"error": str(e)})
        if path.startswith("/api/"):
            return self.send_json(404, {"error": "Unknown API path."})
        super().do_GET()

    def do_HEAD(self) -> None:
        if not self.host_ok():
            return self.send_json(403, {"error": "Open the app at http://localhost."})
        super().do_HEAD()

    def discard_body(self) -> None:
        """Read (and drop) a request body we are not going to use. Answering before the client has sent
        it makes Windows reset the connection, and the client may then never see the answer."""
        length = min(int(self.headers.get("Content-Length") or 0), MAX_PLAN_BODY)
        while length > 0:
            chunk = self.rfile.read(min(length, 65536))
            if not chunk:
                break
            length -= len(chunk)

    def do_POST(self) -> None:
        if not self.host_ok() or not self.post_ok():
            self.discard_body()
            return self.send_json(403, {"error": "Only this app can change settings."})
        path = self.path.split("?")[0]
        if path in ("/api/settings", "/api/validate", "/api/check-tokens", "/api/route", "/api/plans", "/api/plans/delete",
                    "/api/course/send", "/api/course/remove"):
            length = int(self.headers.get("Content-Length") or 0)
            if length > (MAX_PLAN_BODY if path.startswith("/api/plans") else MAX_BODY):
                self.close_connection = True          # too large to read: answer and close
                return self.send_json(413, {"error": "The request is too large."})
            try:
                body = json.loads(self.rfile.read(length) or b"null")
            except ValueError:
                return self.send_json(400, {"error": "The request was not valid JSON."})
            if not isinstance(body, dict):
                return self.send_json(400, {"error": "Send a JSON object."})
        if path == "/api/check-tokens":
            # Only checks that the file exists; the tokens are never read or sent anywhere
            folder = body.get("dir")
            if not isinstance(folder, str) or not folder.strip():
                return self.send_json(400, {"error": "Enter a folder."})
            resolved = Path(folder.strip()).expanduser()
            return self.send_json(200, {"found": (resolved / "garmin_tokens.json").is_file(), "folder": str(resolved)})
        if path in ("/api/settings", "/api/validate"):
            settings = app_settings.normalize(body)
            errors = app_settings.validate(settings)
            if path == "/api/validate":
                return self.send_json(200, {"errors": errors})
            if errors:
                return self.send_json(400, {"errors": errors})
            try:
                old, _ = app_settings.load(self.server.settings_path)
            except app_settings.SettingsError:
                old = app_settings.defaults()
            app_settings.save(app_settings.keep_secrets(settings, old), self.server.settings_path)
            return self.send_json(200, {"settings": app_settings.mask_secrets(settings)})
        if path == "/api/route":
            return self.route(body)
        if path == "/api/plans":
            errors = plans.validate(body)
            if errors:
                return self.send_json(400, {"errors": errors})
            try:
                saved = plans.save(body, self.server.plans_dir)
            except plans.PlanError as e:
                return self.send_json(404, {"error": str(e)})
            return self.send_json(200, {"plan": {k: saved[k] for k in ("id", "name", "updated")}})
        if path == "/api/plans/delete":
            try:
                plans.delete(body.get("id"), self.server.plans_dir)
            except plans.PlanError as e:
                return self.send_json(404, {"error": str(e)})
            return self.send_json(200, {"deleted": body.get("id")})
        if path in ("/api/course/send", "/api/course/remove"):
            # Writes to the Garmin account: the Routes tab has asked the user to confirm first
            pid = body.get("id")
            if not isinstance(pid, str) or not plans.ID.match(pid):
                return self.send_json(400, {"error": "Unknown route."})
            code, answer = self.server.course_runner(path.rsplit("/", 1)[1], pid)
            return self.send_json(code, answer)
        if path == "/api/refresh":
            code, body = self.server.refresher.start()
            return self.send_json(code, body)
        self.send_json(404, {"error": "Unknown API path."})


def make_server(port: int, settings_path: Path = app_settings.SETTINGS, refresher: Refresher | None = None, router=None):
    handler = functools.partial(Handler, directory=str(ROOT))
    # 127.0.0.1 only: the server is reachable from this computer, not from the network.
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    real_port = httpd.server_address[1]
    httpd.allowed_hosts = {f"localhost:{real_port}", f"127.0.0.1:{real_port}"}
    httpd.allowed_origins = {f"http://{h}" for h in httpd.allowed_hosts}
    httpd.settings_path = settings_path
    httpd.refresher = refresher or Refresher()
    httpd.router = router or routing.segment        # tests pass a fake; the real one calls openrouteservice
    httpd.segments = routing.SegmentCache()
    httpd.plans_dir = None                          # data/plans (tests use a temporary folder)
    httpd.elevation = elevation.add_mml_elevation   # tests pass a fake; the real one calls MML (cached tiles)
    httpd.course_runner = CourseRunner()             # tests pass a fake; the real one sends to Garmin
    return httpd


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8000, help="port to listen on (default 8000)")
    parser.add_argument("--settings", type=Path, default=app_settings.SETTINGS,
                        help="settings file (default settings.json; another path is handy for trying the first-run wizard)")
    args = parser.parse_args()

    if app_settings.upgrade_file(args.settings):
        print(f"Updated {args.settings.name} to the current format.")
    with make_server(args.port, settings_path=args.settings) as httpd:
        print(f"Serving Running Log at http://localhost:{args.port}  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
