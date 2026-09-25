"""Local development server for Running Log.

Usage:
    uv run --no-project python serve.py            # http://localhost:8000
    uv run --no-project python serve.py --port 8080

Works like `python -m http.server`, with two fixes:
- JavaScript and CSS are always sent with the correct MIME type. On Windows the
  registry can map .js to text/plain, and browsers refuse to run ES modules then.
- Responses are marked no-store, so the browser never serves an old JS/CSS file
  from its cache after you edit it.
"""

import argparse
import functools
import http.server
from pathlib import Path

ROOT = Path(__file__).parent


class DevHandler(http.server.SimpleHTTPRequestHandler):
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8000, help="port to listen on (default 8000)")
    args = parser.parse_args()

    handler = functools.partial(DevHandler, directory=str(ROOT))
    # 127.0.0.1 only: the server is reachable from this computer, not from the network.
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as httpd:
        print(f"Serving Running Log at http://localhost:{args.port}  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
