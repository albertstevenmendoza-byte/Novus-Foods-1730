# L2L → dashboard-data.json sync

Three new files, nothing else touched:

- `config.py` — your L2L API key and site settings.
- `l2l_client.py` — the same tested L2L API functions from your other
  L2L project.
- `sync_l2l_to_dashboard.py` — pulls real OEE/Downtime (per line) and
  Code Red/Code Yellow (counts) from L2L and writes them into
  `dashboard-data.json`, in the exact same shape Power Automate already
  produces. **`dds-dashboard.html` needs no changes at all** — it
  already reads `Production` and `Maintenance` rows this way; right now
  it's just reading the placeholder/zero values that are in there.

It only ever touches the `OEE` and `Downtime` fields on `Production`
rows and the `Code Red`/`Code Yellow` fields on `Maintenance` rows, for
the date you ask it to sync — matched by `Date` + `Line` so it updates
today's existing row in place if Power Automate (or you) already made
one, rather than creating a duplicate. Everything else — Attainment,
Start Up, CIL, every other sheet — is left exactly as it is.

## Running it

```
pip install -r requirements.txt   # flask isn't needed here, just: pip install requests
python sync_l2l_to_dashboard.py            # syncs today
python sync_l2l_to_dashboard.py 2026-09-05  # syncs a specific date
```

Run it from inside this project folder (it reads/writes
`dashboard-data.json` right next to it).

## Before you push this to GitHub — important

This repo's `dashboard-data.json` is fetched from a public GitHub Pages
URL, which means **this repo is public**. `config.py` has your real L2L
API key in it — don't let it get committed. Add this to a `.gitignore`
in this project if you don't already have one:

```
config.py
```

If you want this to run automatically (e.g. a scheduled sync instead of
running it by hand), the key belongs in a GitHub Actions secret or
similar — not in a file that ends up in the repo — happy to help set
that up when you're ready for it.

## One thing I couldn't map

Your `Production` rows also have an `Attainment` column that this
script doesn't touch — L2L's daily report doesn't have a field
literally called "attainment," and I didn't want to guess which of its
fields (`peff`, `operational_availability`, `actual`/`demand`, etc.)
you mean by that on this dashboard. If you want that wired up too, tell
me which one it should be and I'll add it.
