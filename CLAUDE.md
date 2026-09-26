# Running Log (Juoksupäiväkirja)

A personal running training tracker. `index.html` shows weekly distance, pace and heart rate trends, a weekly goal and recent activities. The UI is in English.

## Goal

The app fetches Garmin data by itself, with no manual work:

1. A Python script fetches activities from Garmin Connect (at least the last year) and writes them to `data/activities.json`.
2. `index.html` reads `data/activities.json`. Garmin data is the only data source (CSV upload and sample data were removed). A copy is kept in localStorage so the page shows data immediately and still works if the file is missing.

The user is learning to program through this project: briefly explain what you are doing and why. Ask before moving from one major step to the next. Reply in the language the user writes in (usually Finnish).

## Environment

- Windows. Uses `uv` (Python dependencies and running scripts) and `git`.
- Garmin library: `python-garminconnect` (the `garminconnect` package, pinned to 0.3.2).
- Saved tokens: `%LOCALAPPDATA%\garminconnect` (created with the `garmin-mcp-auth` tool from Taxuspt/garmin_mcp). The path comes **only** from `settings.json` (`garmin_tokens_dir`); environment variables such as `GARMINTOKENS` are ignored on purpose.

## Conventions

- Write commit messages in English (imperative mood, e.g. "Add weekly goal"). Older commits are in Finnish; leave them as they are.
- Code, comments and UI text are in English.

## Testing

Run the tests before every commit: double-click `test.bat`, or run
```
node --test "tests/*.test.js"                                          # JavaScript (js/), no npm packages needed
uv run --with pytest --with garminconnect==0.3.2 pytest tests -q       # Python (fetch_garmin.py)
```
- `tests/*.test.js` use Node's built-in `node:test` and a fixed date (`TODAY` in `tests/helpers.js`), never the real date. `package.json` only sets `"type": "module"` and the test script.
- `tests/test_fetch_garmin.py` uses `FakeGarmin`, so tests never contact Garmin. It also checks the absolute rule: `connect()` never passes an email or password and stops without tokens.
- When fixing a bug, add a test that fails without the fix (see the `null < 60` sleep-score and `\b` time-trial regressions).
- Only the logic files are tested (js/*.js, fetch_garmin.py); the tab files in js/tabs/ are checked in the browser.

## Dates

- Never add days as `n × 24 h` (`DAY_MS`, `864e5`): on daylight saving changes a day is 23 or 25 hours and the date lands on the wrong day. Use `addDays()` / `daysBetween()` from `js/dates.js`. `DAY_MS` is only fine for rounded or approximate differences.

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

The Windows Task Scheduler task **"Running Log - Garmin fetch"** runs `fetch_data.bat` daily at 06:00 (or as soon as the computer is on, if that time was missed). Log: `data/fetch_data.log`.
`fetch_data.bat` then runs `backup.py` (always) and, if the fetch failed, `notify.ps1` (Windows toast with the error from `data/fetch_status.json`).
- `data/fetch_status.json` (`{at, ok, reason, message, error, last_success, warnings}`): written by `fetch_garmin.py`'s `main()` for every run, also when it stops with an error. `reason` (no_tokens, invalid_tokens, rate_limited, network, unknown) maps to a plain-words `message` (`REASONS`); `error` is the technical text, shown in the app only under "Show details". Stops go through `Stopped` (a `SystemExit` that carries the reason). The header shows the last successful fetch and an OK / Fetch failed badge; the Overview attention list explains a failure.
- `backup.py`: copies `content/races.json` and `data/activities.json` (holds the plan history Garmin drops) to a dated folder, keeps 30 days. Location: `BACKUP_DIR`, else the **personal** OneDrive (`%OneDriveConsumer%\Juoksupaivakirja-varmuuskopio`; `%OneDrive%` can be a work or school OneDrive and must not be used), else `data/backups`. Once a day is enough: do not add more frequent scheduling (Garmin rate limits).

## Structure

- `fetch_garmin.py`: fetches activities → `data/activities.json`:
  `{fetchedAt, activities: [{id, start_time, type, name, distance_m, duration_s, avg_hr, max_hr, avg_speed_mps, te_label, calories, hr_zones_s: [z1..z5 seconds] | null}], hr_settings: {max_hr, zone_floors: [5 bpm], method} | null, resting_hr: [{date, bpm}],
  recovery: {hrv: [{date, last_night, weekly_avg, status, baseline_low, baseline_high}], sleep: [{date, duration_s, score, quality, deep_s, light_s, rem_s, awake_s}], body_battery: [{date, high, low, charged, drained}]}, schedule: [{date, title, sport, workout_id, description}], weight: {kg, date} | null, vo2max: [{date, vo2max}], race_predictions: [{date, marathon_s, half_s, k10_s, k5_s}]}` (recovery = last 28 days; schedule = plan history: Garmin calendar workouts (this and next month) merged with the plan saved by earlier runs (`merge_plan`: past days are kept because Runna/Garmin drop them, future days follow Garmin), last 365 days; activities also carry `workout_id`; weight = latest weigh-in).
  11 requests per run (+1 per new time trial, +1 per new scheduled workout for its description), all date ranges or months: activities, `/biometric-service/heartRateZones`, resting HR (`/userstats-service/wellness/daily/…`, metricId 60), HRV (`/hrv-service/hrv/daily/{start}/{end}`), sleep (`/sleep-service/stats/sleep/daily/{start}/{end}`), Body Battery, calendar this month + next month (scheduled workouts), weigh-ins, VO2max (`/metrics-service/metrics/maxmet/daily/{start}/{end}`), race predictions (daily, max 1 year per request). All but activities are optional (warning on failure).
  Races are not in Garmin (no race events, no Garmin training plan): the user keeps them in `content/races.json`.
  The training plan is Runna (synced to the Garmin calendar); its time trials replace separate test runs.
  Time trials: runs whose name matches `TIME_TRIAL` (time trial, TT, test, testi, aika-ajo) get `laps: [{distance_m, duration_s, intensity, step}]` (`get_activity_splits`). Laps from the previous activities.json are reused, so each time trial is fetched only once. The pattern is generic until the first real Runna time trial shows its naming; then refine it (in both fetch_garmin.py and js/forecast.js).
  Training readiness and running tolerance return empty lists for this watch, so they are not fetched.
  Garmin does **not** provide a per-activity training load (`activityTrainingLoad`) for this account; load is computed in the app (Edwards TRIMP).
- `index.html`: page structure only (header, tab bar, one `<section role="tabpanel">` per tab). No inline CSS or JS.
- `css/tokens.css`: all colors, fonts and sizes as CSS variables; dark mode redefines colors only. `css/layout.css`: page structure and responsive grids. `css/components.css`: tabs, cards, KPIs, buttons, tables.
- `js/app.js`: entry point (Garmin data loading, header status, tabs). `js/state.js`: shared state + localStorage. `js/data.js`: loading and converting `data/activities.json`. `js/format.js`: **all** displayed numbers and dates go through it. `js/parse.js`: date parsing. `js/dates.js`: day keys and ISO week helpers. `js/charts.js`: shared Chart.js theme/options. `js/nav.js`: tabs (hash in URL, arrow-key navigation).
- `js/tabs/training.js`: the Training tab (activities with a distance only). `js/tabs/fitness.js`: Fitness and load tab. `js/metrics.js`: pure formulas (Edwards TRIMP, CTL 42 d / ATL 7 d EWMA, TSB = yesterday's CTL − ATL, ACWR 7/28 rolling averages, easy-run rules, aerobic efficiency = m/min ÷ avg HR with a 5-run average).
- `js/tabs/recovery.js`: Recovery tab. `js/recovery.js`: recovery checks and the daily recommendation; every limit is in `RULES` and the tab shows each rule with its value (no black box). HRV normal range = Garmin baseline; resting HR and ATL normal range = mean ± 1 SD of the previous 28 days (min 14 values). Uses the latest synced night, not necessarily today. `recoveryTrends()` compares the last 7 days with the last 28 for sleep (hours, score, deep share) and Body Battery (daily high/low, today left out); the tab draws 4-week sleep stage and Body Battery range charts.
- `js/tabs/nutrition.js`: Nutrition tab. `js/nutrition.js`: workout classification (long > tempo/intervals > easy), g/kg targets (DAY_TARGETS, RECOVERY, FUELING, PROTEIN_PER_DAY), race-week logic, meal picking. Principle: food is tied to training, never "earned"; Garmin calories are background info only, always labelled as an estimate.
- `content/meals.json`: editable meal ideas (tracked). `content/races.json`: the user's races with optional `goal` and `result` (gitignored, template in `races.example.json`). Loaded with `fetchContent()`; a broken file shows an error notice.
- `js/plan.js`: plan follow-up and weekly review. A run matches a planned workout by Garmin `workoutId` (within 7 days): done / moved / missed / today / upcoming / extra. Before the plan history, Runna names ("W3 Tue ...") give the planned day. `weekReview()` compares a week with the one before and builds highlights by fixed rules (missed, distance +10%, HRV −5 ms, resting HR ±2 bpm, VO2max change). `js/tabs/review.js` draws the "Plan and weekly review" card on the Training tab (week navigation).
- `js/paces.js`: Daniels training paces from VDOT (easy 59–74%, threshold 88%, interval 98%, repetition 105% of VDOT; marathon = marathon race pace), checked against the published pace table. Runna puts no pace targets in the Garmin workout steps, only in the description text ("no faster than 5:40/km", "1.5km at 4:50/km"): `runnaPaces()` parses them (kind from the sentence, else the workout name) and `runnaVdot()` gives the VDOT they correspond to. Shown as the Training paces card on the Fitness and load tab and as a line in the Overview marathon card. Runna's plan: "Run Further Plan", 13 weeks.
- `js/longruns.js`: long run progression (weekly longest run and its share of the week, planned long runs from the plan, outlook: longest of the last 4 weeks → 32 km peak 3 weeks before the marathon, needed km/week, status on-track/steep/reached/late). Drawn by `js/tabs/longruns.js` on the Training tab.
- `js/tabs/overview.js`: Overview tab, the front page and default tab. Reuses the other logic files (recovery, metrics, nutrition, forecast); the attention list collects items from all tabs, sorted warn > watch > info.
- `js/forecast.js`: VO2max forecast (saturating curve a + b·(1 − e^(−t/τ)), τ = 90 d under 8 weeks of data, else best fit in 45–120 d; 80% band covers the prediction interval for every τ in that range; 2-week backtest) and Daniels' VDOT formula (no lookup table), marathon time by bisection, calibration from time trials found in the activities (`timeTrials`: laps of the same workout step are summed, because Garmin splits steps into 1 km laps; the step closest to the distance in the name is used; warm-up/cool-down/rest are skipped) plus race results in races.json. Checked against the published VDOT table (within ~10 s).
- Marathon goal: the user's main race and goal time (in `content/races.json` as the race with `goal`). Calibration (`chooseCalibration`): time trials / race results first; until the first one, the VDOT implied by the Runna plan's paces ÷ Garmin's latest VO2max (user's choice, 26 Sep 2026). The UI always says which source is used.
- A new tab gets its own `js/tabs/<name>.js` with `init…()` and `render…()`, called from `app.js`.
- Chart.js is loaded as a global from cdnjs in `index.html`.
- `start.bat`: fetch + server + browser. `fetch_data.bat`: fetch only, used by the scheduled task. `test.bat`: all tests.

## Design (direction "Graphite")

- Calm, data-dense dashboard. IBM Plex Sans for text, IBM Plex Mono for all numbers.
- One accent color (`--accent`, amber) used only for highlights: current week, goal bar, header status dot, focus ring, "Coming soon" badge. Everything else is neutral.
- Status colors (`--status-under/ok/watch/warn`) only for risk and recovery status (ACWR gauge, recommendation, out-of-range points). Every metric card has a `details.info` "How it's calculated" text.
- The active race-week card has an accent border (highlight).
- Decisions (user): nutrition g/kg targets and classification as in `js/nutrition.js`, weight from Garmin weigh-in, meal names in English with the Finnish name in parentheses; load = Edwards TRIMP, max HR = Garmin setting, easy run = ≥30 min + HR + no hard-session words + (easy/recovery name or Garmin label RECOVERY/AEROBIC_BASE) + avg HR below zone 4.
- Every section is a `.card`; key figures are `.kpi`. Number formats: km with one decimal (`fmtKm`), pace `m:ss /km` (`fmtPace`), HR whole numbers.
- Must work at phone width (16px side gutter, no horizontal page scroll) and in both light and dark mode.
- `.bat` files must keep CRLF line endings (enforced by `.gitattributes`).
