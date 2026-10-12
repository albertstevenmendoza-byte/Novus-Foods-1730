@echo off
rem Converts the OneDrive-synced weekly_KPIs.xlsx and uploads it to Supabase.
rem 1) Edit the three values below.  2) Schedule this file (see README_AUTOMATION.md).
set SUPABASE_URL=https://YOUR-PROJECT.supabase.co
set SUPABASE_SERVICE_KEY=PASTE-SERVICE-ROLE-KEY-HERE
set WORKBOOK=C:\Users\YOU\OneDrive - Novus Foods\weekly_KPIs.xlsx
cd /d "%~dp0"
python upload_kpi_to_supabase.py "%WORKBOOK%" --plant 1730 >> sync_kpis.log 2>&1
