# L2L → l2l-data.json sync

Files:

- `config.py` — your L2L API key and site settings. **Never commit this**
  (see below) — it's only here for running the script by hand. Locally,
  `.gitignore` already excludes it.
- `l2l_client.py` — the same tested L2L API functions from your other
  L2L project.
- `sync_l2l_to_dashboard.py` — pulls real OEE/Downtime (per line) and
  Code Red/Code Yellow (counts) from L2L and writes them into
  **`l2l-data.json`** — a separate file from `dashboard-data.json`, so
  Power Automate's own sync never touches or overwrites these numbers,
  and this script never touches anything Power Automate owns
  (Attainment, Start Up, CIL, HR, QA, Finance, etc). `dds-dashboard.html`
  merges `l2l-data.json` on top of `dashboard-data.json` after loading
  both, so no dashboard changes are needed beyond that merge.
- `l2l_sync_requirements.txt` — just `requests`. Named with the `l2l_sync_`
  prefix (not plain `requirements.txt`) so it doesn't collide with any
  other `requirements.txt` at the repo root.

It only ever touches the `OEE` and `Downtime` fields on `Production`
rows and the `Code Red`/`Code Yellow` fields on `Maintenance` rows, for
the date(s) you ask it to sync — matched by `Date` + `Line` so it
updates an existing row in place rather than creating a duplicate.

## Running it

```
pip install -r l2l_sync_requirements.txt    # just installs "requests"
python sync_l2l_to_dashboard.py             # self-healing: last 7 days through today
python sync_l2l_to_dashboard.py 2026-09-05                # just one specific date
python sync_l2l_to_dashboard.py 2026-09-02 2026-09-07     # backfill a range (inclusive)
```

Run it from inside this project folder (it reads/writes `l2l-data.json`
right next to it). With no arguments it re-syncs the last 7 days every
run, not just today — each day is upserted in place, so if a scheduled
run is ever missed, the next one automatically catches that day back up.

## Already automated

`l2l-sync.yml` (in this repo's `.github/workflows/`) runs this sync
every 3 hours via GitHub Actions and commits the updated `l2l-data.json`
— no manual runs needed day to day. It writes `config.py` at runtime
from the `L2L_API_KEY` repository secret, so the real key is never
committed. Manual runs (above) are only for testing or a one-off
backfill.

## Before running this by hand / pushing to GitHub — important

This repo's `dashboard-data.json` is fetched from a public GitHub Pages
URL, which means **this repo is public**. `config.py` has your real L2L
API key in it — don't let it get committed. It's already listed in
`.gitignore` here; if you copy these files elsewhere, carry that
`.gitignore` entry with them.

## One thing I couldn't map

Your `Production` rows also have an `Attainment` column that this
script doesn't touch — L2L's daily report doesn't have a field
literally called "attainment," and I didn't want to guess which of its
fields (`peff`, `operational_availability`, `actual`/`demand`, etc.)
you mean by that on this dashboard. If you want that wired up too, tell
me which one it should be and I'll add it.
