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

Browsers do not allow `fetch()` or ES modules from a `file://` address, so the page is served through a local server.

```
uv run fetch_garmin.py                    # 1. fetch fresh data
uv run --no-project python serve.py       # 2. start the server (--port N to change)
```

Then open http://localhost:8000. Stop the server with Ctrl+C. The same server is defined in `.claude/launch.json`.
`serve.py` is used instead of `python -m http.server` because it forces correct JS/CSS MIME types and sends `Cache-Control: no-store` (edits show up on reload). On this machine port 8001 is taken by another service; use another port (e.g. 8123) for a second server.

`start.bat` does the same with a double-click (fetch + server + browser).

## Scheduling

The Windows Task Scheduler task **"Running Log - Garmin fetch"** runs `fetch_data.bat` daily at 06:00 (or as soon as the computer is on, if that time was missed). Log: `data/fetch_data.log`. Once a day is enough: do not add more frequent scheduling (Garmin rate limits).

## Structure

- `fetch_garmin.py`: fetches activities → `data/activities.json`:
  `{fetchedAt, activities: [{id, start_time, type, name, distance_m, duration_s, avg_hr, max_hr, avg_speed_mps, te_label, hr_zones_s: [z1..z5 seconds] | null}], hr_settings: {max_hr, zone_floors: [5 bpm], method} | null, resting_hr: [{date, bpm}]}`.
  3 requests per run: activities, `/biometric-service/heartRateZones`, resting HR for the whole period (`/userstats-service/wellness/daily/…`, metricId 60). The extra two are optional (warning on failure).
  Garmin does **not** provide a per-activity training load (`activityTrainingLoad`) for this account; load is computed in the app (Edwards TRIMP).
- `index.html`: page structure only (header, tab bar, one `<section role="tabpanel">` per tab). No inline CSS or JS.
- `css/tokens.css`: all colors, fonts and sizes as CSS variables; dark mode redefines colors only. `css/layout.css`: page structure and responsive grids. `css/components.css`: tabs, cards, KPIs, buttons, tables.
- `js/app.js`: entry point (data loading, data source controls, tabs). `js/state.js`: shared state + localStorage. `js/data.js`: Garmin JSON, CSV parsing (English and Finnish column names), sample data. `js/format.js`: **all** displayed numbers and dates go through it. `js/parse.js`, `js/dates.js`: input parsing and ISO week helpers. `js/charts.js`: shared Chart.js theme/options. `js/nav.js`: tabs (hash in URL, arrow-key navigation).
- `js/tabs/training.js`: the Training tab (activities with a distance only). `js/tabs/fitness.js`: Fitness and load tab. `js/metrics.js`: pure formulas (Edwards TRIMP, CTL 42 d / ATL 7 d EWMA, TSB = yesterday's CTL − ATL, ACWR 7/28 rolling averages, easy-run rules, aerobic efficiency = m/min ÷ avg HR with a 5-run average).
- Other tabs (Overview, Recovery, Nutrition) are placeholders in `index.html`; a new tab gets its own `js/tabs/<name>.js` with `init…()` and `render…()`, called from `app.js`.
- Chart.js and PapaParse are loaded as globals from cdnjs in `index.html`.
- `start.bat`: fetch + server + browser. `fetch_data.bat`: fetch only, used by the scheduled task.

## Design (direction "Graphite")

- Calm, data-dense dashboard. IBM Plex Sans for text, IBM Plex Mono for all numbers.
- One accent color (`--accent`, amber) used only for highlights: current week, goal bar, primary button, focus ring, "Coming soon" badge. Everything else is neutral.
- Status colors (`--status-under/ok/watch/warn`) only for risk gauges such as ACWR. Every metric card has a `details.info` "How it's calculated" text.
- Decisions (user): load = Edwards TRIMP, max HR = Garmin setting, easy run = ≥30 min + HR + no hard-session words + (easy/recovery name or Garmin label RECOVERY/AEROBIC_BASE) + avg HR below zone 4.
- Every section is a `.card`; key figures are `.kpi`. Number formats: km with one decimal (`fmtKm`), pace `m:ss /km` (`fmtPace`), HR whole numbers.
- Must work at phone width (16px side gutter, no horizontal page scroll) and in both light and dark mode.
- `.bat` files must keep CRLF line endings (enforced by `.gitattributes`).
