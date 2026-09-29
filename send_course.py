# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "garminconnect==0.3.2",
# ]
# ///
"""Send a saved route plan to Garmin Connect as a course, or remove a sent course.

Usage (serve.py runs this; the Routes tab asks for confirmation first):
    uv run send_course.py send <plan id>
    uv run send_course.py remove <plan id>

Uses only the saved Garmin tokens (fetch_garmin.connect): never a password, never a retry.
Prints one JSON line: {"ok": true, ...} or {"ok": false, "error": "...", "code": "..."}.
The result is also written into the plan (garmin_course: {id, sent}) so the app can show it.
"""

import json
import sys
from datetime import datetime

import courses
import fetch_garmin
import plans


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in ("send", "remove"):
        print(json.dumps({"ok": False, "error": "Usage: send_course.py send|remove <plan id>", "code": "usage"}))
        return 2
    action, pid = argv[1], argv[2]
    try:
        plan = plans.load(pid)
        garmin = fetch_garmin.connect(fetch_garmin.tokens_dir())     # saved tokens only
        if action == "send":
            result = courses.send(garmin.client, plan)
            plans.set_course(pid, {"id": result["course_id"], "sent": datetime.now().isoformat(timespec="seconds")})
            print(json.dumps({"ok": True, **result}))
        else:
            course = plan.get("garmin_course") or {}
            if not course.get("id"):
                raise courses.CourseError("This route has not been sent to Garmin.")
            courses.remove(garmin.client, course["id"])
            plans.set_course(pid, None)
            print(json.dumps({"ok": True, "removed": course["id"]}))
        return 0
    except fetch_garmin.Stopped as e:                                  # no tokens / expired: plain words
        print(json.dumps({"ok": False, "error": fetch_garmin.REASONS.get(e.reason, str(e)), "code": e.reason}))
    except (plans.PlanError, courses.CourseError) as e:
        print(json.dumps({"ok": False, "error": str(e), "code": getattr(e, "code", "plan")}))
    except Exception as e:                                             # Garmin refused or the network failed
        print(json.dumps({"ok": False, "error": f"Garmin did not accept the course ({type(e).__name__}).",
                          "code": "garmin", "detail": str(e)[:300]}))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
