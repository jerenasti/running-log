"""Route planning backend: the openrouteservice call (faked, never contacted), errors in plain words,
the segment cache, and the API key that never reaches the browser."""

import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
import routing  # noqa: E402
import settings as st  # noqa: E402

ORS_ANSWER = {"type": "FeatureCollection", "features": [{
    "geometry": {"type": "LineString", "coordinates": [[24.9, 60.1, 12.3], [24.9005, 60.1004, 14.0], [24.901, 60.1008, 13.1]]},
    "properties": {"summary": {"distance": 101.26, "duration": 72.9}, "ascent": 1.7, "descent": 0.9},
}]}


class Answer:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return self.body


def opener_returning(body, seen=None):
    def opener(req, timeout):
        if seen is not None:
            seen.append(req)
        return Answer(body)
    return opener


def opener_failing(status, body):
    def opener(req, timeout):
        raise urllib.error.HTTPError(req.full_url, status, "err", {}, io.BytesIO(json.dumps(body).encode()))
    return opener


def test_segment_from_ors_answer_and_request_shape():
    seen = []
    seg = routing.segment("KEY", [60.1, 24.9], [60.1008, 24.901], opener=opener_returning(ORS_ANSWER, seen))
    assert seg == {"points": [[60.1, 24.9, 12.3], [60.1004, 24.9005, 14.0], [60.1008, 24.901, 13.1]],
                   "distance": 101.3, "ascent": 1.7, "descent": 0.9}
    req = seen[0]
    assert req.get_header("Authorization") == "KEY", "the key goes in a header, never in the URL"
    assert "KEY" not in req.full_url
    body = json.loads(req.data)
    assert body["coordinates"] == [[24.9, 60.1], [24.901, 60.1008]], "ORS wants [lon, lat]"
    assert body["elevation"] is True
    assert req.full_url.endswith("/foot-walking/geojson")


@pytest.mark.parametrize("status, body, code", [
    (403, {"error": "Access to this API has been disallowed"}, "bad_key"),
    (429, {"error": "Rate limit exceeded"}, "quota"),
    (404, {"error": {"code": 2010, "message": "Could not find routable point"}}, "no_path"),
    (500, {"error": "boom"}, "routing"),
])
def test_errors_in_plain_words(status, body, code):
    with pytest.raises(routing.RoutingError) as e:
        routing.segment("KEY", [60.1, 24.9], [60.2, 24.9], opener=opener_failing(status, body))
    assert e.value.code == code
    assert "HTTP" not in str(e.value) or code == "routing"


def test_no_key_and_no_network():
    with pytest.raises(routing.RoutingError) as e:
        routing.segment("", [60.1, 24.9], [60.2, 24.9], opener=opener_returning(ORS_ANSWER))
    assert e.value.code == "no_key"

    def offline(req, timeout):
        raise urllib.error.URLError("no network")
    with pytest.raises(routing.RoutingError) as e:
        routing.segment("KEY", [60.1, 24.9], [60.2, 24.9], opener=offline)
    assert e.value.code == "network"


def test_cache_keeps_the_newest():
    c = routing.SegmentCache(size=2)
    c.put([1, 1], [2, 2], "foot-walking", "a")
    c.put([2, 2], [3, 3], "foot-walking", "b")
    assert c.get([1, 1], [2, 2], "foot-walking") == "a"
    c.put([3, 3], [4, 4], "foot-walking", "c")
    assert c.get([2, 2], [3, 3], "foot-walking") is None, "least recently used goes first"
    assert c.get([1.0000001, 1], [2, 2], "foot-walking") == "a", "rounded to 6 decimals"


def test_api_key_never_sent_to_the_browser_and_kept_on_save():
    s = st.normalize({"routing": {"ors_api_key": "secret123"}})
    masked = st.mask_secrets(s)
    assert masked["routing"]["ors_api_key"] == st.SECRET_MASK
    assert s["routing"]["ors_api_key"] == "secret123", "the original is not changed"
    back = st.keep_secrets(st.normalize(masked), s)
    assert back["routing"]["ors_api_key"] == "secret123"
    assert st.validate(masked) == {}
    s["routing"]["ors_api_key"] = "has space"
    assert "routing.ors_api_key" in st.validate(s)
