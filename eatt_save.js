// ── EATT Program Save/Restore Library ────────────────────────────────────────
// Shared across all program pages. Saves to localStorage instantly (works
// offline, no login required) and syncs to Supabase in the background under
// an anonymous session, so the same programs/logs show up on any device that
// signs in later with the same account.
//
// Cloud tables used (see supabase/schema.sql):
//   eatt_program_state — resume state (inputs + cursor) per user per program
//   workout_logs       — your existing table, reused as-is for completed sessions

var EATT = (function() {

    var PROGRAMS_KEY = 'eatt_programs';  // array of saved program states
    var LOGS_KEY     = 'eatt_logs';

    // ── Supabase ──────────────────────────────────────────────────────────────
    var SUPA_URL  = 'https://paecbytkqkhevexmfdmq.supabase.co';
    var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZWNieXRrcWtoZXZleG1mZG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNTE3NjgsImV4cCI6MjA4OTYyNzc2OH0.CRAlB_8t5MWliMLvtzmNk0R1U_AFzZCERlypOfVpYfw';
    var supa = (typeof supabase !== 'undefined') ? supabase.createClient(SUPA_URL, SUPA_ANON) : null;
    var initPromise = null;

    // ── Call once per page load, before reading saved state. Ensures we have
    //    a session (anonymous is fine) and merges any cloud data down into
    //    localStorage. Safe to call multiple times — only runs once.
    function init() {
        if (initPromise) return initPromise;
        if (!supa) { initPromise = Promise.resolve(); return initPromise; }

        initPromise = supa.auth.getSession().then(function(res) {
            var session = res.data && res.data.session;
            if (session) return session;
            return supa.auth.signInAnonymously().then(function(res2) {
                if (res2.error) throw res2.error;
                return res2.data.session;
            });
        }).then(function(session) {
            if (session) return syncFromCloud(session.user.id);
        }).catch(function(err) {
            console.warn('EATT cloud sync unavailable, using local data only:', err && err.message || err);
        });

        return initPromise;
    }

    // ── Pull remote program state / logs and merge into local storage (newer
    //    wins for program state; union for logs), then push up anything that
    //    only exists locally so far.
    function syncFromCloud(userId) {
        return Promise.all([
            supa.from('eatt_program_state').select('*').eq('user_id', userId),
            supa.from('workout_logs').select('*').eq('user_id', userId).order('date', { ascending: false }).limit(200)
        ]).then(function(results) {
            var stateRes = results[0], logRes = results[1];

            if (!stateRes.error && stateRes.data) {
                var local = loadAll();
                stateRes.data.forEach(function(row) {
                    var remote = rowToProgram(row);
                    var idx = local.findIndex(function(p) { return p.id === remote.id; });
                    if (idx < 0) local.push(remote);
                    else if ((remote.savedAt || 0) > (local[idx].savedAt || 0)) local[idx] = remote;
                });
                localStorage.setItem(PROGRAMS_KEY, JSON.stringify(local.slice(0, 10)));
                local.forEach(function(p) {
                    var onServer = stateRes.data.some(function(row) { return row.prog_id === p.id; });
                    if (!onServer) pushProgram(userId, p);
                });
            }

            if (!logRes.error && logRes.data) {
                var localLogs = getLogs();
                var haveKey = {};
                localLogs.forEach(function(l) { haveKey[l.ts] = true; });
                logRes.data.forEach(function(row) {
                    var key = row.client_ts != null ? row.client_ts : Date.parse(row.created_at || row.date);
                    if (!haveKey[key]) { localLogs.push(rowToLog(row, key)); haveKey[key] = true; }
                });
                localLogs.sort(function(a, b) { return b.ts - a.ts; });
                localStorage.setItem(LOGS_KEY, JSON.stringify(localLogs.slice(0, 200)));

                var onServerKey = {};
                logRes.data.forEach(function(row) {
                    onServerKey[row.client_ts != null ? row.client_ts : Date.parse(row.created_at || row.date)] = true;
                });
                localLogs.forEach(function(l) {
                    if (!onServerKey[l.ts]) pushLog(userId, l);
                });
            }
        });
    }

    function rowToProgram(row) {
        return {
            id: row.prog_id, name: row.name, page: row.page, inputs: row.inputs,
            cursor: row.cursor, week: row.week, day: row.day, wave: row.wave,
            cycleCount: row.cycle_count, savedAt: row.saved_at
        };
    }

    function rowToLog(row, key) {
        return { date: row.date, ts: key, program: row.program_name, session: row.session_name, exercises: row.exercises };
    }

    function pushProgram(userId, state) {
        if (!supa) return;
        supa.from('eatt_program_state').upsert({
            user_id: userId, prog_id: state.id, name: state.name, page: state.page,
            inputs: state.inputs, cursor: state.cursor, week: state.week, day: state.day,
            wave: state.wave, cycle_count: state.cycleCount, saved_at: state.savedAt
        }, { onConflict: 'user_id,prog_id' }).then(function(res) {
            if (res.error) console.warn('EATT cloud save failed:', res.error.message);
        });
    }

    function pushLog(userId, log) {
        if (!supa) return;
        supa.from('workout_logs').insert({
            user_id: userId, date: log.date, program_name: log.program,
            session_name: log.session, exercises: log.exercises, client_ts: log.ts
        }).then(function(res) {
            if (res.error) console.warn('EATT cloud log failed:', res.error.message);
        });
    }

    function withUser(fn) {
        if (!supa) return;
        supa.auth.getSession().then(function(res) {
            var session = res.data && res.data.session;
            if (session) fn(session.user.id);
        });
    }

    // ── Save a full program state ─────────────────────────────────────────────
    function save(state) {
        // state = { id, name, page, inputs, cursor, savedAt, cycleCount }
        var programs = loadAll();
        var idx = programs.findIndex(function(p) { return p.id === state.id; });
        state.savedAt = Date.now();
        if (idx >= 0) {
            programs[idx] = state;
        } else {
            programs.unshift(state);
        }
        // Keep max 10 saved programs
        localStorage.setItem(PROGRAMS_KEY, JSON.stringify(programs.slice(0, 10)));
        withUser(function(userId) { pushProgram(userId, state); });
    }

    // ── Load all saved program states ─────────────────────────────────────────
    function loadAll() {
        try { return JSON.parse(localStorage.getItem(PROGRAMS_KEY) || '[]'); }
        catch(e) { return []; }
    }

    // ── Get most recent program ───────────────────────────────────────────────
    function getMostRecent() {
        var all = loadAll();
        return all.length ? all.sort(function(a,b){ return b.savedAt - a.savedAt; })[0] : null;
    }

    // ── Delete a saved program state (local + cloud) ───────────────────────────
    function deleteProgram(progId) {
        var programs = loadAll().filter(function(p) { return p.id !== progId; });
        localStorage.setItem(PROGRAMS_KEY, JSON.stringify(programs));
        withUser(function(userId) {
            if (!supa) return;
            supa.from('eatt_program_state').delete().eq('user_id', userId).eq('prog_id', progId)
                .then(function(res) {
                    if (res.error) console.warn('EATT cloud delete failed:', res.error.message);
                });
        });
    }

    // ── Log a completed workout ───────────────────────────────────────────────
    function logWorkout(programName, sessionName, exerciseList) {
        var logs = [];
        try { logs = JSON.parse(localStorage.getItem(LOGS_KEY) || '[]'); } catch(e){}
        var entry = {
            date:      new Date().toLocaleDateString(),
            ts:        Date.now(),
            program:   programName,
            session:   sessionName,
            exercises: exerciseList
        };
        logs.unshift(entry);
        localStorage.setItem(LOGS_KEY, JSON.stringify(logs.slice(0, 200)));
        withUser(function(userId) { pushLog(userId, entry); });
        return true;
    }

    function getLogs() {
        try { return JSON.parse(localStorage.getItem(LOGS_KEY) || '[]'); } catch(e) { return []; }
    }

    return { init: init, save: save, loadAll: loadAll, getMostRecent: getMostRecent, deleteProgram: deleteProgram, logWorkout: logWorkout, getLogs: getLogs };
})();
