"""
Pulls OEE/Downtime (per line) and Code Red/Code Yellow (counts) from
L2L and writes them to l2l-data.json -- a SEPARATE file from
dashboard-data.json, so Power Automate's own sync never touches or
overwrites these numbers, and this script never touches anything
Power Automate owns (HR, QA, Finance, Attainment, Start Up, CIL, etc).

dds-dashboard.html merges l2l-data.json on top of dashboard-data.json
after loading both -- see the small addition in fetchFromSharePoint().

Usage:
    python sync_l2l_to_dashboard.py            # today
    python sync_l2l_to_dashboard.py 2026-09-05  # a specific date
"""

import json
import os
import sys
from datetime import date, datetime, timedelta

import config
from l2l_client import get_daily_oee, get_dispatches

L2L_DATA_PATH = "l2l-data.json"

# Matches dds-dashboard.html's own (n - 25569) Excel-serial-date formula.
EXCEL_EPOCH = date(1899, 12, 30)


def to_excel_serial(target_date):
    return str((target_date - EXCEL_EPOCH).days)


def upsert_row(rows, match_fields, new_values):
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

    if os.path.exists(L2L_DATA_PATH):
        with open(L2L_DATA_PATH, "r", encoding="utf-8") as f:
            l2l_data = json.load(f)
    else:
        l2l_data = {"Production": [], "Maintenance": []}

    daily_records = get_daily_oee(config.SITE_NUMBER, start, end, config.LINE_CODES) or []
    production_rows = l2l_data.setdefault("Production", [])
    for record in daily_records:
        line_code = config.LINECODE_DICT.get(record.get("line"))
        if not line_code:
            continue
        oee = record.get("overall_equipment_effectiveness")
        downtime = record.get("downtime_minutes")
        upsert_row(production_rows, {"Date": date_serial, "Line": line_code}, {"OEE": oee, "Downtime": downtime})
        print(f"  {line_code}: OEE={oee}  Downtime={downtime}")

    dispatches = get_dispatches(config.SITE_NUMBER, start, end, config.LINE_CODES) or []
    code_red_count = sum(1 for d in dispatches if d.get("dispatchtype") == config.CODE_RED_ID)
    code_yellow_count = sum(1 for d in dispatches if d.get("dispatchtype") == config.CODE_YELLOW_ID)
    maintenance_rows = l2l_data.setdefault("Maintenance", [])
    upsert_row(maintenance_rows, {"Date": date_serial}, {"Code Red": code_red_count, "Code Yellow": code_yellow_count})
    print(f"  Code Red={code_red_count}  Code Yellow={code_yellow_count}")

    l2l_data["synced_at"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "0Z"

    with open(L2L_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(l2l_data, f, separators=(",", ":"))

    print(f"\nWrote {L2L_DATA_PATH}. Upload it to GitHub alongside dashboard-data.json.")


if __name__ == "__main__":
    target = datetime.strptime(sys.argv[1], "%Y-%m-%d").date() if len(sys.argv) > 1 else date.today()
    sync(target)
