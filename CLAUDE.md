# Running Log (Juoksupäiväkirja)

A personal running training tracker. `index.html` shows weekly distance, pace and heart rate trends, a weekly goal and recent activities. The UI is in English.

## Goal

The app fetches Garmin data by itself, with no manual work:

1. A Python script fetches activities from Garmin Connect (at least the last year) and writes them to `data/activities.json`.
2. `index.html` reads `data/activities.json`. CSV upload remains as a fallback.

The user is learning to program through this project: briefly explain what you are doing and why. Ask before moving from one major step to the next. Reply in the language the user writes in (usually Finnish).

## Environment

- Windows. Uses `uv` (Python dependencies and running scripts) and `git`.
- Garmin library: `python-garminconnect` (the `garminconnect` package, pinned to 0.3.2).
- Saved tokens: `%LOCALAPPDATA%\garminconnect` (created with the `garmin-mcp-auth` tool from Taxuspt/garmin_mcp).

## Conventions

- Write commit messages in English (imperative mood, e.g. "Add weekly goal"). Older commits are in Finnish; leave them as they are.
- Code, comments and UI text are in English.

## Constraints (absolute)

- **NEVER log in to Garmin with a password.** Garmin blocks repeated logins (HTTP 429). Use only the saved tokens. If the tokens are expired or missing, the script must stop with a clear error message and must not try to log in again. The user renews the tokens themselves with the `garmin-mcp-auth` tool.
- **Never commit the tokens to version control, print them, or copy them into the project folder.**
- **Activity data is personal data** (times, locations). `data/` and CSV files stay out of git. Do not embed real data in `index.html`.
- Avoid unnecessary API calls: fetch data deliberately, never in a retry loop.

## Running locally

Browsers do not allow `fetch()` from a `file://` address, so the page is served through a local server.

```
uv run fetch_garmin.py                                                  # 1. fetch fresh data
uv run --no-project python -m http.server 8000 --bind 127.0.0.1         # 2. start the server
```

Then open http://localhost:8000. Stop the server with Ctrl+C. The same server is defined in `.claude/launch.json`.

`kaynnista.bat` does the same with a double-click (fetch + server + browser).

## Scheduling

The Windows Task Scheduler task **"Juoksupaivakirja - Garmin-haku"** runs `hae_data.bat` daily at 06:00 (or as soon as the computer is on, if that time was missed). Log: `data/hae_data.log`. Once a day is enough: do not add more frequent scheduling (Garmin rate limits).

## Structure

- `fetch_garmin.py`: fetches activities → `data/activities.json` (`{fetchedAt, activities: [{id, start_time, type, name, distance_m, duration_s, avg_hr}]}`).
- `index.html`: a single file (HTML + CSS + JS). Reads the JSON with `fetch()`; CSV upload and sample data as fallbacks. CSV column detection supports both English and Finnish Garmin exports.
- `kaynnista.bat`: fetch + server + browser. `hae_data.bat`: fetch only, used by the scheduled task.
- `.bat` files must keep CRLF line endings (enforced by `.gitattributes`).
