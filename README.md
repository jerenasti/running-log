# Running Log

A personal running dashboard built on my own Garmin data. It fetches activities, heart rate, sleep and recovery metrics from Garmin Connect once a day and turns them into training insights on a local web page: weekly volume, training load, recovery, a marathon finish-time forecast and a route planner that can send planned runs to the watch.

I built it as a learning project in AI-assisted development with Claude Code.

## Features

- **Overview**: the week at a glance, the most important attention items from every tab and the main marathon forecast.
- **Training**: activity list, a page per run (route map, synced heart rate and pace curves, km splits), route heatmap, long run progression, and plan follow-up with a weekly review against the Runna plan.
- **Fitness and load**: daily load (Edwards TRIMP), fitness, fatigue and form (CTL / ATL / TSB), acute:chronic workload ratio and an aerobic efficiency index.
- **Recovery**: HRV, resting heart rate, sleep stages and Body Battery trends, with a daily recommendation where every rule and limit is shown.
- **Marathon forecast**: a VO2max trend model with an 80% range, calibrated with time trials (Daniels' VDOT), plus training paces.
- **Nutrition**: daily carbohydrate and protein targets based on the training plan, and race-week guidance.
- **Routes**: plan runs on a map (openrouteservice), elevation from the Finnish National Land Survey 2 m model in Finland, hill detection and a time estimate, GPX export, and sending a route to the watch as a private Garmin course.
- **Settings**: race goals, plan source, heart rate limits, privacy zones, km or miles, light and dark theme.

## How it works

- `fetch_garmin.py` reads Garmin Connect with saved tokens and writes `data/activities.json`. It never logs in with a password.
- `serve.py` serves the app and a small local API (Python standard library only).
- The front end is plain HTML, CSS and JavaScript modules: no build step and no npm dependencies. Charts use Chart.js and maps use Leaflet.

## Running locally

Requirements: Python with [uv](https://docs.astral.sh/uv/), and Garmin tokens created with the `garmin-mcp-auth` tool from [garmin_mcp](https://github.com/Taxuspt/garmin_mcp). Node.js is needed only for the tests.

```
uv run fetch_garmin.py                    # 1. fetch your Garmin data
uv run --no-project python serve.py       # 2. start the local server
```

Then open http://localhost:8000. On the first visit a setup wizard creates `settings.json` (see `settings.example.json`). On Windows, `start.bat` does all of this with a double-click.

## Tests

```
node --test "tests/*.test.js"                                       # JavaScript logic
uv run --with pytest --with garminconnect==0.3.2 pytest tests -q    # Python
```

## Privacy

Activity data, routes, settings and Garmin tokens stay on the computer: `data/`, `settings.json` and token files are excluded from version control. Routes can hide privacy zones, such as home, when exported or shared.
