#!/usr/bin/env python3
"""
Convert weekly_KPIs.xlsx and upload the result to Supabase (table weekly_kpi_data).

  pip install pandas openpyxl
  set SUPABASE_URL=https://xxxx.supabase.co
  set SUPABASE_SERVICE_KEY=<service_role key>      (never commit this, never put it in the web app)

  python upload_kpi_to_supabase.py "C:\\Users\\you\\OneDrive - ...\\weekly_KPIs.xlsx" --plant 1730
  python upload_kpi_to_supabase.py --json kpi-data.json --plant 1730      # upload an existing JSON instead

Safety: it will not replace a newer week with an older one unless you add --force,
and it refuses to upload if the converter finds nothing. A "Check:" note from the
converter is printed so you notice new or renamed KPIs.
"""
import argparse, json, os, sys, urllib.request, urllib.error, urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent


def request(method, url, key, body=None, extra=None):
    h = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
    h.update(extra or {})
    req = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('workbook', nargs='?', help='weekly_KPIs.xlsx (omit if you pass --json)')
    ap.add_argument('--json', help='upload this kpi-data.json instead of converting a workbook')
    ap.add_argument('--map', help='KPI map workbook (default: KPI_Map sheet in the workbook, else kpi_map.xlsx beside this script)')
    ap.add_argument('--plant', default='1730')
    ap.add_argument('--force', action='store_true', help='allow replacing a newer week with an older one')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    url, key = os.environ.get('SUPABASE_URL', '').rstrip('/'), os.environ.get('SUPABASE_SERVICE_KEY', '')
    if not a.dry_run and (not url or not key):
        sys.exit('Set SUPABASE_URL and SUPABASE_SERVICE_KEY first.')

    if a.json:
        doc = json.loads(Path(a.json).read_text(encoding='utf-8'))
        source = Path(a.json).name
    elif a.workbook:
        sys.path.insert(0, str(HERE))
        from build_kpi_json import build
        doc = build(a.workbook, a.map)
        source = Path(a.workbook).name
    else:
        sys.exit('Give a workbook or --json.')

    meta = doc.get('meta') or {}
    if not meta.get('weeks') or not doc.get('sections'):
        sys.exit('Nothing to upload: the converter found no weeks or no KPIs.')
    latest = meta['latestWeek']
    for n in meta.get('notes', []):
        if n.startswith('Check:'):
            print('  !', n)
    print(f'Plant {a.plant}: {len(meta["weeks"])} weeks, latest week {latest}')
    if a.dry_run:
        return

    q = f'{url}/rest/v1/weekly_kpi_data?plant_id=eq.{urllib.parse.quote(a.plant)}&select=latest_week'
    st, txt = request('GET', q, key)
    if st == 200 and txt.strip() not in ('', '[]'):
        cur = json.loads(txt)[0]['latest_week']
        if cur > latest and not a.force:
            sys.exit(f'Supabase already has week {cur}, which is newer than {latest}. Nothing uploaded (use --force to override).')
    elif st not in (200, 404):
        sys.exit(f'Could not read weekly_kpi_data ({st}): {txt[:300]}\nDid you run weekly_kpi_data.sql?')

    row = {'plant_id': a.plant, 'data': doc, 'latest_week': latest, 'generated': meta.get('generated'),
           'source': source, 'updated_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()}
    st, txt = request('POST', f'{url}/rest/v1/weekly_kpi_data?on_conflict=plant_id', key,
                      json.dumps(row).encode('utf-8'), {'Prefer': 'resolution=merge-duplicates,return=minimal'})
    if st not in (200, 201, 204):
        sys.exit(f'Upload failed ({st}): {txt[:400]}')
    print('Uploaded. The Weekly KPIs page will pick it up on next load (or live, if it is open).')


if __name__ == '__main__':
    main()
