# Refreshing the Plant KPI Explorer from the Excel workbook

## Files
| File | What it is |
|---|---|
| `kpi_dashboard_v2.html` | The dashboard. Double-click to open. Also published as an artifact. |
| `weekly_KPIs.xlsx` | Your workbook. The dashboard reads its **Weekly_Data** sheet. |
| `kpi_map.xlsx` | The KPI map: which department tab, group, name, unit and target each KPI gets. Edit in Excel. |
| `build_kpi_json.py` | Optional. Does the same conversion from the command line and writes `kpi_data.json`. |
| `kpi_data.json` | Output of the converter. The dashboard can also load this. |

## Weekly refresh (no code)
1. Open `weekly_KPIs.xlsx`, then **Data > Refresh All**. Wait for it to finish, then **Save**.
2. Open the dashboard. Click **Load data** (or drop the file onto the page) and pick `weekly_KPIs.xlsx`.
3. Open **Data notes** at the bottom. If any line starts with **Check:**, read it (see below).

The dashboard remembers the last file you loaded in that browser. **Customize > Use built-in data** goes back to the snapshot.

## What the loader does to the data
- Reads only the `Weekly_Data` sheet: Department, KPI, Week Ending, Value, Target.
- Removes trailing weeks that are placeholders. A week counts as real once at least 2 KPIs have a non-zero value. This is why the forward plan values for Conversion Cost (Oct to Jan) are ignored.
- Removes rows that are exact duplicates. Keeps the last value if the same KPI and week has two different values, and says so.
- Uses `kpi_map.xlsx` (not the Department column, which is over-filled in the source) to decide the tab, group, display name, unit and sub-items.
- Fills sub-items that are blank-when-zero (Near Miss and Complaints categories) with 0 for weeks the parent reported.

## When a "Check:" appears
| Message | Fix |
|---|---|
| KPIs "appear under Unmapped" | A new KPI was added to the tracker. Add a row for it in `kpi_map.xlsx` (copy a similar row, change Department and KPI to match Weekly_Data exactly, set Section, Group, Display Name, Unit, Decimals). |
| "in KPI_Map but not in Weekly_Data" | A KPI was renamed or removed in the tracker. Update the Department / KPI text in the map. |
| "same KPI and week appears with different values" | Two rows in the tracker disagree. Fix them at the source. |

To make the dashboard use your edited map, copy the `KPI_Map` and `Notes` sheets into `weekly_KPIs.xlsx` (right-click the sheet tab > Move or Copy > To book > weekly_KPIs.xlsx, tick Create a copy). The loader uses a `KPI_Map` sheet in the workbook when it finds one, otherwise the built-in map.

## Command-line option
```
pip install pandas openpyxl
python build_kpi_json.py weekly_KPIs.xlsx            # uses KPI_Map in the workbook, else kpi_map.xlsx beside the script
python build_kpi_json.py weekly_KPIs.xlsx --map kpi_map.xlsx -o kpi_data.json
```
Flags: `--min-reporting N` (default 2) and `--latest YYYY-MM-DD` to force the last week.
The browser loader and the script produce identical output. To have the dashboard pick up `kpi_data.json` automatically, put it next to `kpi_dashboard_v2.html` and serve the folder (`python -m http.server`), then open `http://localhost:8000/kpi_dashboard_v2.html`.

## Key KPIs and arrow colors
Both are set in the `CONFIG` block at the top of the dashboard script: `KEY_KPI_IDS` (the four big cards) and `HIGHER_IS_BETTER` / `LOWER_IS_BETTER` (green and red arrows).
