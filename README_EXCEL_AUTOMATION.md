# Sending the weekly KPI data to Supabase straight from SharePoint (no Python, no PC left on)

Your weekly_KPIs.xlsx is built by a Power Query that reads the **"Wkly Data" sheet of "SFRESH - OGSM 2026 Tracker.xlsx"**
(SharePoint site BPStaffMeeting, General / 3.Weekly OGSM). The tracker is the real source, so the automation reads it
directly. That removes the Power Query refresh step, which is the part that cannot be relied on in an unattended flow.

    SFRESH - OGSM 2026 Tracker.xlsx  (sheet "Wkly Data")
        -> Office Script  (reads the cells, changes nothing)
        -> Power Automate (runs the script on a schedule, POSTs the result to Supabase)
        -> table weekly_kpi_data
        -> Weekly KPIs page (repeats your Power Query steps, then applies the KPI map and scoring rules)

Run `weekly_kpi_data.sql` first (see README_AUTOMATION.md).

## What the page does with the tracker cells (same as your Power Query)
Skip the first 2 rows; row 3 is the header (the week dates); skip 1 more row; columns A/B/C are Department/KPI/Target;
fill Department down; drop rows with no KPI; turn the week columns into one row per KPI per week; keep real dates and
numbers only. Everything after that (names, groups, sub-items, targets, stale weeks) is the same as Load data. If someone
changes the tracker's layout (rows above the header, columns A to C), this is the one piece to adjust (`wideToRows` in
`kpi-boards.html`).

## 1. Add the script
1. Open **SFRESH - OGSM 2026 Tracker.xlsx** in Excel for the web.
2. **Automate > New Script**, paste all of `office-script/ExportWeeklyKpis.ts`, name it `ExportWeeklyKpis`, **Save**.
3. **Run** once. It should end without an error. (If you do not have permission to add scripts to that file, save the
   script in any workbook you own: a Power Automate "Run script" step can run it against the tracker anyway, as long as
   you can open the tracker.)

## 2. Build the flow
1. **Create > Scheduled cloud flow**. Daily at the time the tracker is normally finished, or hourly on weekdays.
2. **Run script** (Excel Online (Business)): Location = the SharePoint site (BPStaffMeeting), Document Library =
   Documents, File = General/3.Weekly OGSM/SFRESH - OGSM 2026 Tracker.xlsx, Script = `ExportWeeklyKpis`.
3. **HTTP** (Premium connector):
   - Method `POST`, URI `https://easfrwilbxypcdooawtt.supabase.co/rest/v1/weekly_kpi_data?on_conflict=plant_id`
   - Headers: `apikey` = service_role key; `Authorization` = `Bearer ` + that key; `Content-Type` = `application/json`;
     `Prefer` = `resolution=merge-duplicates,return=minimal`
   - Body:

         {
           "plant_id": "1730",
           "latest_week": "@{outputs('Run_script')?['body']?['result']?['latest_week']}",
           "source": "SFRESH OGSM 2026 Tracker (Power Automate)",
           "updated_at": "@{utcNow()}",
           "data": @{outputs('Run_script')?['body']?['result']}
         }

     If the flow errors on the body, open the Run script step in a test run and copy the exact path it shows for the result.
4. **Test > Manually.** Supabase > Table Editor > weekly_kpi_data should show the row. Open Weekly KPIs; the source line
   reads "Supabase · updated ...".

Keep the service_role key only inside the flow (secure input). It can write to everything.

## What still needs a human
- Someone still updates the tracker each week; the flow only picks up what is saved there.
- A KPI that is not in the KPI map appears under "Unmapped" with a Check note in Data notes. Add it to `kpi_map.xlsx`
  (or paste KPI_Map and Notes sheets into the tracker; the script sends them only in the weekly_KPIs.xlsx fallback).
- Size: the tracker's "Wkly Data" is small (tens of KB as JSON), well inside Power Automate limits.

## If the flow cannot read the tracker or you have no HTTP action
Use the Python route (README_AUTOMATION.md): it converts a saved weekly_KPIs.xlsx on a scheduled PC. Same table, same page.
