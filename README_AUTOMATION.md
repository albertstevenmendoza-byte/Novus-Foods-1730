# Weekly KPIs: automatic upload to Supabase

How it flows:

    weekly_KPIs.xlsx (OneDrive)  ->  upload_kpi_to_supabase.py  ->  Supabase table weekly_kpi_data  ->  Weekly KPIs page

The page asks Supabase first, then falls back to kpi-data.json on the site, then to the built-in snapshot.
It only switches to a source that is newer than what it already has. An open page updates itself (with a toast)
when a new row lands.

## One-time setup
1. **Create the table.** Supabase > SQL Editor > paste `weekly_kpi_data.sql` > Run. The anon key (used by the app) can
   read only. Writes need the service_role key.
2. **Deploy the app files** from the update zip: `weekly-kpis.html`, `kpi-boards.html`, and the updated `supabase-config.js`
   (it adds `NovusDB.kpiData`).
3. **Get the service_role key:** Supabase > Settings > API > `service_role`. Treat it like a password. Never put it in
   the repo or in any page.
4. **Test by hand** (PowerShell or Terminal):

       pip install pandas openpyxl
       set SUPABASE_URL=https://easfrwilbxypcdooawtt.supabase.co
       set SUPABASE_SERVICE_KEY=<service_role key>
       python upload_kpi_to_supabase.py "C:\path\to\weekly_KPIs.xlsx" --plant 1730

   Open Weekly KPIs. The Settings panel shows "Supabase · updated ...".

## Making it automatic
**Option A: Windows Task Scheduler on the PC that has the OneDrive-synced workbook (recommended, no IT needed)**
1. Edit the three values in `sync_kpis.bat` (URL, service key, workbook path).
2. Task Scheduler > Create Task > Trigger: daily at the time you usually finish the weekly update, or every hour on
   weekdays. Action: Start a program > `sync_kpis.bat`.
3. Results are appended to `sync_kpis.log`. A run with nothing newer does nothing harmful: it never replaces a newer
   week with an older one (add `--force` to override).

Important: the script reads the **saved** file. Your workbook gets its numbers from Power Query, so someone must open it,
**Data > Refresh All**, and **Save** (or the workbook must refresh on open and be saved by a flow). The upload is automatic;
the Excel refresh is the one manual step unless you also automate that.

**Option B: GitHub Action (fully hosted, needs IT)** Same script, run on a schedule like `l2l-sync.yml`. It needs a way to
download the workbook headlessly from SharePoint (an Azure app registration with a client secret and `Files.Read.All`),
which your current sign-in setup does not have. If IT can provide that, the workflow is: download the file, `pip install
pandas openpyxl`, run `upload_kpi_to_supabase.py`, with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` as repository secrets.

## Other plants
Run with `--plant 1710` (and so on). Each plant gets its own row; the page uses the plant chosen in the DDS.

## Troubleshooting
- "Could not read weekly_kpi_data (404)": the SQL has not been run.
- "Supabase already has week ... newer": you are uploading an older workbook. Use `--force` only if that is intended.
- A `!` line starting with Check: means a new or renamed KPI. Fix it in `kpi_map.xlsx` (see README.md).
