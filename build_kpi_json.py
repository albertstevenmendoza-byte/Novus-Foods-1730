#!/usr/bin/env python3
"""
Turn the weekly KPI workbook into kpi_data.json for the Plant KPI Explorer.

Usage
    python build_kpi_json.py weekly_KPIs.xlsx
    python build_kpi_json.py weekly_KPIs.xlsx --map kpi_map.xlsx -o kpi_data.json

Reads
    * the sheet "Weekly_Data" (columns: Department, KPI, Week Ending, Value, optional Target)
    * the KPI map: --map FILE, else a sheet named "KPI_Map" inside the workbook,
      else kpi_map.xlsx sitting next to this script.

Needs:  pip install pandas openpyxl
"""
import argparse, datetime as dt, json, math, re, sys
from pathlib import Path
import pandas as pd

UNITS = {'num': 'number', 'count': 'count', 'usd': 'US dollars',
         'pct_frac': 'fraction shown as %', 'pct_pts': 'already in percentage points'}
UNSCORED_NOTE = 'Reporting period for this target is not stated in the source sheet, so it is shown but not scored.'
DEFAULT_MIN_REPORTING = 2


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', str(s).lower().replace('%', ' pct ')).strip('-')


def clean(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ''
    return str(v).strip()


def fmt_num(v):
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def parse_target(raw):
    """Target cell -> {'op','value','raw'} or None."""
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return None
    s = fmt_num(raw).strip() if not isinstance(raw, str) else raw.strip()
    if not s:
        return None
    m = re.match(r'^([<>]=?)\s*([\d.]+)\s*(%?)$', s)
    if m:
        v = float(m.group(2)) / (100 if m.group(3) else 1)
        return {'op': m.group(1), 'value': v, 'raw': s}
    try:
        return {'op': None, 'value': float(s), 'raw': s}
    except ValueError:
        return None


def load_map(workbook, map_path):
    here = Path(__file__).resolve().parent
    if map_path:
        src = Path(map_path)
    else:
        try:
            pd.read_excel(workbook, sheet_name='KPI_Map', nrows=1)
            src = Path(workbook)
        except ValueError:
            src = here / 'kpi_map.xlsx'
    if not src.exists():
        sys.exit(f'Could not find a KPI map. Put kpi_map.xlsx next to this script or pass --map. (looked for {src})')
    m = pd.read_excel(src, sheet_name='KPI_Map', dtype=object).fillna('')
    try:
        n = pd.read_excel(src, sheet_name='Notes', dtype=object).fillna('')
        notes = [clean(x) for x in n.iloc[:, 0].tolist() if clean(x)]
    except ValueError:
        notes = []
    return m, notes, src


def build(workbook, map_path=None, min_reporting=DEFAULT_MIN_REPORTING, latest=None):
    raw = pd.read_excel(workbook, sheet_name='Weekly_Data')
    for col in ('Department', 'KPI', 'Week Ending', 'Value'):
        if col not in raw.columns:
            sys.exit(f'Weekly_Data is missing the column "{col}". Found: {list(raw.columns)}')
    if 'Target' not in raw.columns:
        raw['Target'] = None
    df = raw[['Department', 'KPI', 'Week Ending', 'Value', 'Target']].copy()
    df['Department'] = df['Department'].astype(str).str.strip()
    df['KPI'] = df['KPI'].astype(str).str.strip()
    df['Week Ending'] = pd.to_datetime(df['Week Ending'], errors='coerce')
    df['Value'] = pd.to_numeric(df['Value'], errors='coerce')
    df = df.dropna(subset=['Week Ending', 'Value'])

    mp, static_notes, map_src = load_map(workbook, map_path)
    notes, warnings = [], []

    # 1. drop weeks that are zero-filled placeholders or plan-only values
    if latest:
        latest_ts = pd.Timestamp(latest)
    else:
        nz = df[df['Value'] != 0].groupby('Week Ending')[['Department', 'KPI']].apply(lambda g: len(g.drop_duplicates()))
        ok = nz[nz >= min_reporting]
        latest_ts = ok.index.max() if len(ok) else df['Week Ending'].max()
    extra = df[df['Week Ending'] > latest_ts]
    if len(extra):
        notes.append(f'Weeks after {latest_ts:%Y-%m-%d} were treated as placeholders or plan values '
                     f'(fewer than {min_reporting} KPIs reporting) and were removed. '
                     f'{extra["Week Ending"].nunique()} week(s), {len(extra)} rows.')
    df = df[df['Week Ending'] <= latest_ts]

    # 2. de-duplicate
    before = len(df)
    df = df.drop_duplicates(['Department', 'KPI', 'Week Ending', 'Value'])
    if before - len(df):
        notes.append(f'{before - len(df)} duplicate rows with identical values were removed.')
    conflict = df.duplicated(['Department', 'KPI', 'Week Ending'], keep=False)
    if conflict.any():
        bad = df[conflict][['Department', 'KPI']].drop_duplicates().values.tolist()
        warnings.append('Check: same KPI and week appears with different values, the last one was kept: '
                        + '; '.join(f'{d} / {k}' for d, k in bad))
        df = df.drop_duplicates(['Department', 'KPI', 'Week Ending'], keep='last')

    weeks = sorted(df['Week Ending'].dt.strftime('%Y-%m-%d').unique())
    in_data = set(map(tuple, df[['Department', 'KPI']].drop_duplicates().values))

    def series_of(dept, kpi):
        s = df[(df.Department == dept) & (df.KPI == kpi)].sort_values('Week Ending')
        return {w.strftime('%Y-%m-%d'): float(v) for w, v in zip(s['Week Ending'], s['Value'])}, s

    # 3. walk the map
    rows = []
    for _, r in mp.iterrows():
        d = {k: clean(r.get(k)) for k in ['Department', 'KPI', 'ID', 'Section', 'Group', 'Display Name',
                                          'Parent KPI', 'Unit', 'Decimals', 'Fill Zero', 'Score Op', 'Score Value', 'Score Label']}
        if d['Department'] and d['KPI']:
            rows.append(d)
    mapped = {(r['Department'], r['KPI']) for r in rows}
    dropped = {(r['Department'], r['KPI']) for r in rows if r['Section'].lower() == '(drop)'}
    items = {}          # (dept,kpi) -> item
    meta_of = {}
    for r in rows:
        key = (r['Department'], r['KPI'])
        if key in dropped:
            continue
        if key not in in_data:
            warnings.append(f'Check: "{r["Department"]} / {r["KPI"]}" is in KPI_Map but not in Weekly_Data. Skipped.')
            continue
        meta_of[key] = r
    fills = {}
    for key, r in meta_of.items():
        ser, srows = series_of(*key)
        if r['Fill Zero'].upper() == 'Y' and r['Parent KPI']:
            pkey = (key[0], r['Parent KPI'])
            pser, _ = series_of(*pkey) if pkey in in_data else ({}, None)
            ser = {w: ser.get(w, 0.0) for w in pser}
        t = None
        if r['Score Op'] and r['Score Value'] != '':
            t = {'op': r['Score Op'], 'value': float(r['Score Value']), 'label': r['Score Label'] or f'{r["Score Op"]} {r["Score Value"]}', 'scored': True}
        else:
            tv = srows['Target'].dropna()
            p = parse_target(tv.iloc[0]) if len(tv) else None
            if p and p['op']:
                t = {'op': p['op'], 'value': p['value'], 'label': p['raw'].replace('<=', '≤').replace('>=', '≥'), 'scored': True}
            elif p:
                t = {'op': None, 'value': p['value'], 'label': 'Target ' + p['raw'], 'scored': False, 'note': UNSCORED_NOTE}
        try:
            dec = int(float(r['Decimals'])) if r['Decimals'] != '' else 0
        except ValueError:
            dec = 0
        items[key] = {
            'id': r['ID'] or slug(f'{key[0]}-{key[1]}'),
            'name': r['Display Name'] or r['KPI'], 'unit': r['Unit'] or 'num', 'decimals': dec, 'target': t,
            'series': [[w, round(ser[w], 6)] for w in sorted(ser)],
        }

    # 4. attach children, build sections > groups
    sections, sec_idx, grp_idx = [], {}, {}
    for r in rows:
        key = (r['Department'], r['KPI'])
        if key not in items:
            continue
        it = items[key]
        parent_key = (key[0], r['Parent KPI']) if r['Parent KPI'] else None
        if parent_key and parent_key in items and parent_key != key:
            items[parent_key].setdefault('children', []).append(it)
            continue
        sname, gname = r['Section'] or 'Other', r['Group'] or 'Other'
        if sname not in sec_idx:
            sec_idx[sname] = {'id': slug(sname), 'name': sname, 'groups': []}; sections.append(sec_idx[sname])
        gk = (sname, gname)
        if gk not in grp_idx:
            grp_idx[gk] = {'id': slug(gname), 'name': gname, 'kpis': []}; sec_idx[sname]['groups'].append(grp_idx[gk])
        grp_idx[gk]['kpis'].append(it)

    # 5. anything in the workbook that the map does not know about
    new = sorted(in_data - mapped)
    if new:
        sec = sec_idx.setdefault('Unmapped', None)
        if sec is None:
            sec = {'id': 'unmapped', 'name': 'Unmapped', 'groups': [{'id': 'new-kpis', 'name': 'New KPIs', 'kpis': []}]}
            sections.append(sec)
        for dept, kpi in new:
            ser, srows = series_of(dept, kpi)
            ints = all(float(v).is_integer() for v in ser.values())
            tv = srows['Target'].dropna(); p = parse_target(tv.iloc[0]) if len(tv) else None
            sec['groups'][0]['kpis'].append({
                'id': slug(f'{dept}-{kpi}'), 'name': kpi, 'unit': 'num', 'decimals': 0 if ints else 2,
                'target': ({'op': None, 'value': p['value'], 'label': 'Target ' + p['raw'], 'scored': False, 'note': UNSCORED_NOTE} if p and not p['op'] else None),
                'series': [[w, round(ser[w], 6)] for w in sorted(ser)]})
        warnings.append('Check: these KPIs are in Weekly_Data but not in KPI_Map, so they appear under "Unmapped": '
                        + '; '.join(f'{d} / {k}' for d, k in new) + '. Add a row for each in KPI_Map to name and place them.')
    if dropped & in_data:
        notes.append('Excluded on purpose (marked "(drop)" in KPI_Map): ' + '; '.join(f'{d} / {k}' for d, k in sorted(dropped & in_data)) + '.')

    out = {'meta': {
        'title': 'Weekly KPI Dashboard', 'source': f'{Path(workbook).name} (Weekly_Data)',
        'generated': dt.date.today().isoformat(), 'latestWeek': latest_ts.strftime('%Y-%m-%d'),
        'firstWeek': weeks[0], 'weeks': weeks, 'units': UNITS,
        'notes': warnings + notes + static_notes}, 'sections': sections}
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('workbook')
    ap.add_argument('--map', help='KPI map workbook (default: KPI_Map sheet in the workbook, else kpi_map.xlsx beside this script)')
    ap.add_argument('-o', '--out', default='kpi_data.json')
    ap.add_argument('--min-reporting', type=int, default=DEFAULT_MIN_REPORTING,
                    help='a week counts as real once this many KPIs have a non-zero value (default 2)')
    ap.add_argument('--latest', help='force the last week to keep, YYYY-MM-DD')
    a = ap.parse_args()
    out = build(a.workbook, a.map, a.min_reporting, a.latest)
    Path(a.out).write_text(json.dumps(out, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')

    def count(k): return 1 + sum(count(c) for c in k.get('children', []))
    n = sum(count(k) for s in out['sections'] for g in s['groups'] for k in g['kpis'])
    print(f'Wrote {a.out}: {len(out["meta"]["weeks"])} weeks, {n} KPIs, latest week {out["meta"]["latestWeek"]}')
    for note in out['meta']['notes']:
        if note.startswith('Check:'):
            print('  !', note)


if __name__ == '__main__':
    main()
