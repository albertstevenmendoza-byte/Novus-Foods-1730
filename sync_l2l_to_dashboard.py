"""
Fills dashboard-data.json's Production (OEE + Downtime) and Maintenance
(Code Red / Code Yellow) numbers with real data pulled from L2L, in the
exact same shape your Power Automate flow already writes -- so
dds-dashboard.html needs ZERO changes. It already knows how to read
these fields; right now it's just reading placeholder zeros.

What this does NOT touch: every other sheet (HR, QA, Finance, SAP,
Warehouse, Inventory Control), and on Production/Maintenance rows,
every column other than OEE/Downtime/Code Red/Code Yellow (Attainment,
Start Up, CIL, Expected/Actual Pounds, etc. are all left exactly as
they are, whatever last set them).

Usage:
    python sync_l2l_to_dashboard.py            # today
    python sync_l2l_to_dashboard.py 2026-09-05  # a specific date

After running, dashboard-data.json is updated on disk. Commit + push it
(or however you currently publish it to GitHub Pages) to make the new
numbers show up on the live dashboard.
"""

import json
import sys
from datetime import date, datetime, timedelta

import config
from l2l_client import get_daily_oee, get_dispatches

DASHBOARD_DATA_PATH = "dashboard-data.json"

# dds-dashboard.html converts Date values with `(n - 25569) * 86400 * 1000`,
# the standard Excel-serial-date formula. 1899-12-30 is that formula's
# "day zero" -- matching it means our rows sort/parse exactly like every
# other row already in this file.
EXCEL_EPOCH = date(1899, 12, 30)


def to_excel_serial(target_date):
    return str((target_date - EXCEL_EPOCH).days)


def upsert_row(rows, match_fields, new_values):
    """
    Find the row where every key in match_fields already matches, and
    update just new_values onto it (every other existing column on that
    row -- Attainment, Start Up, CIL, whatever -- is left untouched). If
    no matching row exists yet, append a new one with match_fields +
    new_values and nothing else.
    """
    for row in rows:
        if all(str(row.get(key, "")).strip() == str(value).strip() for key, value in match_fields.items()):
            row.update(new_values)
            return
    rows.append({**match_fields, **new_values})


def sync(target_date):
    date_serial = to_excel_serial(target_date)
    start = target_date.strftime("%Y-%m-%d") + " 00:00"
    end = (target_date + timedelta(days=1)).strftime("%Y-%m-%d") + " 00:00"

    print(f"Pulling L2L data for {target_date} ({start} -> {end})...")

    with open(DASHBOARD_DATA_PATH, "r", encoding="utf-8") as f:
        dash_data = json.load(f)

    # ---- Production: OEE + Downtime, one row per line ----
    daily_records = get_daily_oee(config.SITE_NUMBER, start, end, config.LINE_CODES) or []
    production_rows = dash_data.setdefault("Production", [])

    for record in daily_records:
        line_code = config.LINECODE_DICT.get(record.get("line"))
        if not line_code:
            continue  # a line this dashboard doesn't track
        oee = record.get("overall_equipment_effectiveness")
        downtime = record.get("downtime_minutes")
        upsert_row(
            production_rows,
            match_fields={"Date": date_serial, "Line": line_code},
            new_values={"OEE": oee, "Downtime": downtime},
        )
        print(f"  {line_code}: OEE={oee}  Downtime={downtime}")

    # ---- Maintenance: Code Red / Code Yellow counts, one row per date ----
    dispatches = get_dispatches(config.SITE_NUMBER, start, end, config.LINE_CODES) or []
    code_red_count = sum(1 for d in dispatches if d.get("dispatchtype") == config.CODE_RED_ID)
    code_yellow_count = sum(1 for d in dispatches if d.get("dispatchtype") == config.CODE_YELLOW_ID)

    maintenance_rows = dash_data.setdefault("Maintenance", [])
    upsert_row(
        maintenance_rows,
        match_fields={"Date": date_serial},
        new_values={"Code Red": code_red_count, "Code Yellow": code_yellow_count},
    )
    print(f"  Code Red={code_red_count}  Code Yellow={code_yellow_count}")

    dash_data["synced_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "0Z"

    # No indent/spaces: matches the minified format Power Automate already
    # writes this file in, so this doesn't needlessly bloat a file that
    # gets downloaded by the dashboard on every page load.
    with open(DASHBOARD_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(dash_data, f, separators=(",", ":"))

    print(f"\nWrote {DASHBOARD_DATA_PATH}. Commit + push it to make the new numbers live.")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        target = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
    else:
        target = date.today()
    sync(target)
