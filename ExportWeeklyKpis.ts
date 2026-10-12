/**
 * Office Script: ExportWeeklyKpis
 * Run it on "SFRESH - OGSM 2026 Tracker.xlsx" (the file people actually edit).
 * Excel for the web > Automate > New Script > paste this whole file > Save.
 *
 * It returns ONE TEXT STRING of JSON (Office Scripts only allows simple return types, and a string always works).
 * It only READS the sheet "Wkly Data" and returns its cells. Nothing in the tracker is changed.
 * The Weekly KPIs page turns those cells into KPIs (it repeats the Power Query steps from weekly_KPIs.xlsx),
 * so there is no Power Query refresh to wait for and no second copy of the rules here.
 *
 * It also works if you point it at weekly_KPIs.xlsx instead: if there is no "Wkly Data" sheet it sends
 * Weekly_Data (and KPI_Map / Notes if present).
 */
function serialToISO(n: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
}

function textToISO(s: string): string {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return "";
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return y + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2);
}

function cellToISO(v: string | number | boolean): string {
  if (typeof v === "number" && v > 20000 && v < 80000) return serialToISO(v);
  if (typeof v === "string") return textToISO(v.trim());
  return "";
}

function main(workbook: ExcelScript.Workbook): string {
  const wide = workbook.getWorksheet("Wkly Data");
  if (wide) {
    const values = wide.getUsedRange().getValues();
    if (values.length < 5) throw new Error('"Wkly Data" has fewer rows than expected.');
    // Latest REAL week: the tracker carries plan values (e.g. Conversion Cost) out to Jan 2027, so a week counts
    // only once at least 2 KPIs have a non-zero number in it (same rule the page uses).
    const hdr = values[2];
    let latest = "";
    for (let c = 3; c < hdr.length; c++) {
      const iso = cellToISO(hdr[c]);
      if (!iso || iso <= latest) continue;
      let reporting = 0;
      for (let r = 4; r < values.length; r++) {
        const v = values[r][c];
        if (String(values[r][1]).trim() !== "" && typeof v === "number" && v !== 0) reporting++;
      }
      if (reporting >= 2) latest = iso;
    }
    if (!latest) throw new Error("Could not find a week with data in the Wkly Data header row (row 3).");
    return JSON.stringify({ latest_week: latest, raw: { Wkly_Data: values } });
  }

  // Fallback: the Power Query output workbook (weekly_KPIs.xlsx)
  const wd = workbook.getWorksheet("Weekly_Data");
  if (!wd) throw new Error('Neither "Wkly Data" nor "Weekly_Data" was found in this workbook.');
  const asObjects = (sheet: ExcelScript.Worksheet) => {
    const v = sheet.getUsedRange().getValues();
    const headers = v[0].map(h => String(h).trim());
    const out: Array<{ [col: string]: string | number | boolean | null }> = [];
    for (let r = 1; r < v.length; r++) {
      if (v[r].every(c => c === "")) continue;
      const o: { [col: string]: string | number | boolean | null } = {};
      headers.forEach((h, i) => { if (h) o[h] = v[r][i] === "" ? null : v[r][i]; });
      out.push(o);
    }
    return out;
  };
  const rows = asObjects(wd);
  if (rows.length === 0) throw new Error("Weekly_Data is empty. Refresh the query first.");
  let latest = "";
  rows.forEach(r => { const iso = cellToISO(r["Week Ending"] as string | number); if (iso > latest) latest = iso; });
  const raw: { [name: string]: object } = { Weekly_Data: rows };
  const map = workbook.getWorksheet("KPI_Map");
  if (map) {
    raw["KPI_Map"] = asObjects(map);
    const notes = workbook.getWorksheet("Notes");
    if (notes) raw["notes"] = notes.getUsedRange().getValues().slice(1).map(r => String(r[0])).filter(s => s.trim() !== "");
  }
  return JSON.stringify({ latest_week: latest, raw: raw });
}
