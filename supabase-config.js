/**
 * supabase-config.js
 *
 * ONE file to rule them all. Drop this in your repo root alongside
 * novus-core.js and load it with:
 *
 *   <script src="supabase-config.js"></script>
 *
 * BEFORE the page's own <script> block. Every page then has access
 * to the global `NovusDB` object which has the same shape as the old
 * GAS fetch calls, just much faster.
 *
 * ─── SETUP (one time) ────────────────────────────────────────────────────
 * 1. Go to supabase.com → your project → Settings → API
 * 2. Copy "Project URL" → paste as SUPABASE_URL below
 * 3. Copy "anon public" key → paste as SUPABASE_ANON_KEY below
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WHY anon key is fine here:
 * Your app already guards every page via sessionStorage auth in novus-core.js.
 * The anon key combined with permissive RLS policies (see SQL setup guide)
 * is the standard pattern for internal tools. Never paste the service_role key.
 */

const SUPABASE_URL      = 'https://easfrwilbxypcdooawtt.supabase.co';   // ← fixed (was doubled)
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhc2Zyd2lsYnh5cGNkb29hd3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNDk0NDEsImV4cCI6MjA5MjYyNTQ0MX0.Y2kCtATKaMRWWPiE6n0XQ5mGCuq1qS8PnS5OglFxSSM'; // ← paste yours

// The Supabase JS CDN is loaded by each HTML page. By the time this
// runs, window.supabase is available.
const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * NovusDB — thin wrapper that mirrors the shape of the old GAS calls.
 *
 * All methods return { data, error } just like the Supabase client.
 * Pages that used the raw GAS fetch have been updated to call these
 * instead — the business logic (rendering, state) is completely unchanged.
 */
window.NovusDB = {

  // ── Announcements ───────────────────────────────────────────────────────
  announcements: {
    getAll: () =>
      _sb.from('announcements').select('*').order('created_at', { ascending: false }),

    add: (item) =>
      _sb.from('announcements').insert({
        id:        item.id,
        number:    item.number,
        text:      item.text,
        date:      item.date,
        image:     item.image,
        color:     item.color,
      }),

    updateField: (id, field, value) =>
      _sb.from('announcements').update({ [field]: value }).eq('id', id),

    delete: (id) =>
      _sb.from('announcements').delete().eq('id', id),

    /** Real-time: callback fires on any INSERT / UPDATE / DELETE */
    subscribe: (callback) =>
      _sb
        .channel('announcements-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, callback)
        .subscribe(),
  },

  // ── Rules of Engagement ─────────────────────────────────────────────────
  rules: {
    getAll: () =>
      _sb.from('rules').select('*').order('created_at', { ascending: true }),

    add: (item) =>
      _sb.from('rules').insert({ id: item.id, text: item.text, date: item.date }),

    update: (id, text) =>
      _sb.from('rules').update({ text }).eq('id', id),

    delete: (id) =>
      _sb.from('rules').delete().eq('id', id),

    subscribe: (callback) =>
      _sb
        .channel('rules-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rules' }, callback)
        .subscribe(),
  },

  // ── Needs Action ────────────────────────────────────────────────────────
  needsAction: {
    getAll: () =>
      _sb.from('needs_action').select('*').order('created_at', { ascending: false }),

    add: (item) =>
      _sb.from('needs_action').insert({
        id:             item.id,
        date:           item.date,
        description:    item.description,
        owner:          item.owner,
        completed_date: '',
      }),

    setCompleted: (id, dateStr) =>
      _sb.from('needs_action').update({ completed_date: dateStr }).eq('id', id),

    updateDescription: (id, description) =>
      _sb.from('needs_action').update({ description }).eq('id', id),

    updateOwner: (id, owner) =>
      _sb.from('needs_action').update({ owner }).eq('id', id),

    delete: (id) =>
      _sb.from('needs_action').delete().eq('id', id),

    subscribe: (callback) =>
      _sb
        .channel('needs-action-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'needs_action' }, callback)
        .subscribe(),
  },

  // ── Weekly Staff Meeting ─────────────────────────────────────────────────
  weeklyStaffMeeting: {
    /**
     * Fetch all 13 department rows and reshape into the same
     * { [dept]: deptObj } map that the old GAS ?action=read returned.
     */
    getAll: async () => {
      const { data, error } = await _sb
        .from('weekly_staff_meeting')
        .select('*');
      if (error) return { data: null, error };
      // Reshape array → keyed object
      const map = {};
      (data || []).forEach(row => {
        map[row.dept] = {
          lwItems:    row.lw_items    || [],
          twItems:    row.tw_items    || [],
          frontTiles: row.front_tiles || [],
          tiles:      row.back_tiles  || [],
        };
      });
      return { data: map, error: null };
    },

    /**
     * Upsert one department's full data object.
     * Mirrors the old GAS { action:'write', dept, data } call.
     */
    saveDept: (dept, deptObj) =>
      _sb.from('weekly_staff_meeting').upsert({
        dept,
        lw_items:    deptObj.lwItems    || [],
        tw_items:    deptObj.twItems    || [],
        front_tiles: deptObj.frontTiles || [],
        back_tiles:  deptObj.tiles      || [],
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'dept' }),

    /**
     * Upload a base64 image to Supabase Storage.
     * Returns a public URL — replaces the old GAS uploadImage action.
     * Requires a public bucket named "staff-meeting-images" in Supabase.
     */
    uploadImage: async (base64DataUrl, dept) => {
      try {
        // Strip the data:image/...;base64, prefix
        const [header, b64] = base64DataUrl.split(',');
        const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
        const ext  = mime.split('/')[1] || 'jpg';
        const path = `${dept.replace(/\s+/g, '_')}/${Date.now()}.${ext}`;

        // Convert base64 → Uint8Array
        const binary = atob(b64);
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const { error } = await _sb.storage
          .from('staff-meeting-images')
          .upload(path, bytes, { contentType: mime, upsert: false });

        if (error) throw error;

        const { data } = _sb.storage
          .from('staff-meeting-images')
          .getPublicUrl(path);

        return { ok: true, url: data.publicUrl };
      } catch (e) {
        console.error('[NovusDB.weeklyStaffMeeting.uploadImage]', e);
        return { ok: false, error: e.message };
      }
    },

    subscribe: (callback) =>
      _sb
        .channel('weekly-staffmtg-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'weekly_staff_meeting' }, callback)
        .subscribe(),
  },
};

// ── Play Call ──────────────────────────────────────────────────────────────
// NOTE: was missing — this fixes play-call.html
window.NovusDB.playCall = {
  getAll: () =>
    _sb.from('play_call').select('*').order('created_at', { ascending: true }),

  add: (item) =>
    _sb.from('play_call').insert({
      id:      item.id,
      owner:   item.owner,
      text:    item.text,
      webhook: item.webhook || '',
      date:    item.date    || '',
    }),

  delete: (id) =>
    _sb.from('play_call').delete().eq('id', id),

  subscribe: (callback) =>
    _sb
      .channel('play-call-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'play_call' }, callback)
      .subscribe(),
};

// ── Lean Initiatives ───────────────────────────────────────────────────────
window.NovusDB.leanInitiatives = {

  /** All initiatives — filter by dept client-side */
  getAll: () =>
    _sb.from('lean_initiatives').select('*').order('created_at', { ascending: false }),

  /** Initiatives for one department */
  getByDept: (dept) =>
    _sb.from('lean_initiatives').select('*')
      .eq('dept', dept)
      .order('created_at', { ascending: false }),

  add: (item) =>
    _sb.from('lean_initiatives').insert({
      id:                      item.id,
      dept:                    item.dept                    || '',
      title:                   item.title,
      owner:                   item.owner,
      category:                item.category                || 'Process',
      status:                  item.status                  || 'Proposed',
      est_hours_saved:         item.est_hours_saved         || 0,
      actual_hours_saved:      item.actual_hours_saved      || 0,
      est_material_savings:    item.est_material_savings    || 0,
      actual_material_savings: item.actual_material_savings || 0,
      notes:                   item.notes                   || '',
      week_flagged:            item.week_flagged            || '',
      completed_date:          item.completed_date          || '',
    }),

  updateStatus: (id, status, completedDate) => {
    const fields = { status };
    if (completedDate !== undefined) fields.completed_date = completedDate;
    return _sb.from('lean_initiatives').update(fields).eq('id', id);
  },

  update: (id, fields) =>
    _sb.from('lean_initiatives').update(fields).eq('id', id),

  delete: (id) =>
    _sb.from('lean_initiatives').delete().eq('id', id),

  subscribe: (callback) =>
    _sb
      .channel('lean-init-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lean_initiatives' }, callback)
      .subscribe(),
};

// ── Lean Department State ───────────────────────────────────────────────────
window.NovusDB.leanDeptState = {

  /** Returns all 13 rows as { dept → current_state } map */
  getAll: async () => {
    const { data, error } = await _sb.from('lean_dept_state').select('*');
    if (error) return { data: null, error };
    const map = {};
    (data || []).forEach(r => { map[r.dept] = r.current_state || ''; });
    return { data: map, error: null };
  },

  /** Upsert the current-state narrative for one department */
  save: (dept, currentState) =>
    _sb.from('lean_dept_state').upsert({
      dept,
      current_state: currentState,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'dept' }),

  subscribe: (callback) =>
    _sb
      .channel('lean-dept-state-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lean_dept_state' }, callback)
      .subscribe(),
};