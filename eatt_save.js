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
    var SYNC_KEY     = PROGRAMS_KEY + '_lastsync';  // when this device last merged with the cloud
    var DELETED_KEY  = PROGRAMS_KEY + '_deleted';   // deletes not yet confirmed by the cloud
    var MAX_PROGRAMS   = 3;     // Current Programs slots
    var MAX_LOCAL_LOGS = 1000;  // device copy; the cloud keeps everything

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
            supa.from('workout_logs').select('*').eq('user_id', userId)
                .order('client_ts', { ascending: false, nullsFirst: false }).limit(MAX_LOCAL_LOGS)
        ]).then(function(results) {
            var stateRes = results[0], logRes = results[1];

            if (!stateRes.error && stateRes.data) {
                mergePrograms(userId, stateRes.data);
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
                localStorage.setItem(LOGS_KEY, JSON.stringify(localLogs.slice(0, MAX_LOCAL_LOGS)));

                // Only push what's newer than the cloud window we fetched, so old
                // local logs outside it aren't re-inserted on every load.
                var oldestFetched = logRes.data.length >= MAX_LOCAL_LOGS
                    ? logRes.data[logRes.data.length - 1].client_ts || 0 : 0;
                var onServerKey = {};
                logRes.data.forEach(function(row) {
                    onServerKey[row.client_ts != null ? row.client_ts : Date.parse(row.created_at || row.date)] = true;
                });
                localLogs.forEach(function(l) {
                    if (!onServerKey[l.ts] && l.ts > oldestFetched) pushLog(userId, l);
                });
            }
        });
    }

    // Programs: newer copy wins. A program this device has but the cloud doesn't
    // is either new here since the last sync (push it) or was deleted on another
    // device (drop it). Sync itself never deletes cloud rows — only an explicit
    // delete/replace does — so one device can't silently remove another's program.
    function mergePrograms(userId, rows) {
        var lastSync = Number(localStorage.getItem(SYNC_KEY)) || 0;
        var deleted = getDeleted();
        var local = loadAll();
        var merged = [], seen = {};

        rows.forEach(function(row) {
            if (!SAFE_ID.test(row.prog_id || '') || APP_PAGES.indexOf(row.page) < 0) return;
            if (deleted[row.prog_id] && deleted[row.prog_id] >= (row.saved_at || 0)) {
                deleteCloudProgram(userId, row.prog_id);   // a delete that didn't reach the cloud yet
                return;
            }
            var remote = rowToProgram(row);
            var mine = local.find(function(p) { return p.id === remote.id; });
            var winner = mine && (mine.savedAt || 0) > (remote.savedAt || 0) ? mine : remote;
            if (winner === mine) pushProgram(userId, mine);
            merged.push(winner);
            seen[remote.id] = true;
        });
        local.forEach(function(p) {
            if (seen[p.id]) return;
            if ((p.savedAt || 0) > lastSync) { merged.push(p); pushProgram(userId, p); }
        });

        merged.sort(function(a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
        localStorage.setItem(PROGRAMS_KEY, JSON.stringify(merged.slice(0, MAX_PROGRAMS)));
        localStorage.setItem(SYNC_KEY, String(Date.now()));
    }

    function getDeleted() {
        try { return JSON.parse(localStorage.getItem(DELETED_KEY) || '{}') || {}; } catch(e) { return {}; }
    }

    function setDeleted(progId, at) {
        var d = getDeleted();
        if (at) d[progId] = at; else delete d[progId];
        localStorage.setItem(DELETED_KEY, JSON.stringify(d));
    }

    // Program ids/pages end up in links and onclick handlers, so only accept
    // the shapes the app itself produces.
    var SAFE_ID   = /^[\w-]+$/;

    function localISODate() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    // Page-specific extras (5x5 deloads/max tests, AMRAP results, ...) ride
    // along inside the inputs jsonb, so they sync without new columns.
    var CORE_FIELDS = ['id', 'name', 'page', 'inputs', 'cursor', 'week', 'day', 'wave', 'cycleCount', 'savedAt'];

    function rowToProgram(row) {
        var inputs = row.inputs || {};
        var p = {
            id: row.prog_id, name: row.name, page: row.page, inputs: inputs,
            cursor: row.cursor, week: row.week, day: row.day, wave: row.wave,
            cycleCount: row.cycle_count, savedAt: row.saved_at
        };
        if (inputs.__extra) {
            // Extras can never override the validated core fields.
            Object.keys(inputs.__extra).forEach(function(k) {
                if (CORE_FIELDS.indexOf(k) < 0 && !/^(__proto__|constructor|prototype)$/.test(k)) p[k] = inputs.__extra[k];
            });
            p.inputs = Object.assign({}, inputs);
            delete p.inputs.__extra;
        }
        return p;
    }

    function packInputs(state) {
        var extra = {};
        Object.keys(state).forEach(function(k) { if (CORE_FIELDS.indexOf(k) < 0) extra[k] = state[k]; });
        return Object.keys(extra).length ? Object.assign({}, state.inputs, { __extra: extra }) : state.inputs;
    }

    function rowToLog(row, key) {
        return { date: row.date, ts: key, program: row.program_name, session: row.session_name, exercises: row.exercises };
    }

    function pushProgram(userId, state) {
        if (!supa) return;
        supa.from('eatt_program_state').upsert({
            user_id: userId, prog_id: state.id, name: state.name, page: state.page,
            inputs: packInputs(state), cursor: state.cursor, week: state.week, day: state.day,
            wave: state.wave, cycle_count: state.cycleCount, saved_at: state.savedAt
        }, { onConflict: 'user_id,prog_id' }).then(function(res) {
            if (res.error) console.warn('EATT cloud save failed:', res.error.message);
        });
    }

    function pushLog(userId, log) {
        if (!supa) return;
        var row = {
            user_id: userId, date: log.date, program_name: log.program,
            session_name: log.session, exercises: log.exercises, client_ts: log.ts
        };
        supa.from('workout_logs').upsert(row, { onConflict: 'user_id,client_ts', ignoreDuplicates: true })
            .then(function(res) {
                // 42P10 = the unique index isn't there yet (03 migration not run): plain insert
                if (res.error && res.error.code === '42P10') return supa.from('workout_logs').insert(row);
                return res;
            }).then(function(res) {
                if (res && res.error) console.warn('EATT cloud log failed:', res.error.message);
            });
    }

    function deleteCloudProgram(userId, progId) {
        if (!supa) return;
        supa.from('eatt_program_state').delete().eq('user_id', userId).eq('prog_id', progId)
            .then(function(res) {
                if (res.error) console.warn('EATT cloud delete failed:', res.error.message);
                else setDeleted(progId, null);
            });
    }

    function withUser(fn) {
        if (!supa) return;
        supa.auth.getSession().then(function(res) {
            var session = res.data && res.data.session;
            if (session) fn(session.user.id);
        });
    }

    var declined = {};

    function showNotSavedBanner(name) {
        if (document.getElementById('eattNotSaved')) return;
        var b = document.createElement('div');
        b.id = 'eattNotSaved';
        b.setAttribute('role', 'status');
        b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#3a1d1d;' +
            'border:1px solid #ff6b6b;color:#fff;border-radius:12px;padding:12px 14px;font-size:0.82rem;' +
            'box-shadow:0 8px 30px rgba(0,0,0,.5)';
        b.textContent = 'Progress on ' + name + ' is not being saved: Current Programs is full (' + MAX_PROGRAMS +
            '). Workouts you log still go to Archives. Remove a program under My Programs to save this one.';
        document.body.appendChild(b);
    }

    // ── Save a full program state ─────────────────────────────────────────────
    // Pages call this when a workout is logged (and when a new cycle starts),
    // so savedAt = "last logged" and cursor = where to resume.
    // Keeps up to MAX_PROGRAMS. Saving another one asks to free the least
    // recently logged slot; returns false if the user says no.
    function save(state) {
        // state = { id, name, page, inputs, cursor, savedAt, cycleCount, ...extras }
        var programs = loadAll();
        var idx = programs.findIndex(function(p) { return p.id === state.id; });
        state.savedAt = Date.now();
        if (idx >= 0) {
            programs[idx] = state;
        } else {
            if (programs.length >= MAX_PROGRAMS) {
                programs.sort(function(a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
                var oldest = programs[programs.length - 1];
                if (declined[state.id]) return false;
                if (!confirm('You already have ' + MAX_PROGRAMS + ' current programs. Saving ' + state.name +
                             ' will remove "' + oldest.name + '" (least recently logged) from Current Programs.' +
                             ' Its logged workouts stay in Archives.\n\nContinue?')) {
                    declined[state.id] = true;   // don't ask again on every log this visit
                    showNotSavedBanner(state.name);
                    return false;
                }
                deleteProgram(oldest.id);
                programs = loadAll();
            }
            programs.unshift(state);
        }
        programs.sort(function(a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
        localStorage.setItem(PROGRAMS_KEY, JSON.stringify(programs.slice(0, MAX_PROGRAMS)));
        withUser(function(userId) { pushProgram(userId, state); });
        return true;
    }

    // ── Load all saved program states ─────────────────────────────────────────
    // Saved programs end up in links and onclick handlers, so everything read
    // back is re-checked here (localStorage is shared by the whole github.io
    // origin, and cloud rows sync between devices).
    var APP_PAGES = ['5x5.html', '531workout.html', 'strongman531.html', 'juggernaut.html', 'cube.html',
                     'arnoldsplit.html', 'brosplit.html', 'deckofcards.html', 'nutrition.html'];

    function num(v) { var n = Number(v); return v == null || v === '' || isNaN(n) ? undefined : n; }

    function loadAll() {
        var raw;
        try { raw = JSON.parse(localStorage.getItem(PROGRAMS_KEY) || '[]'); } catch(e) { return []; }
        if (!Array.isArray(raw)) return [];
        return raw.filter(function(p) {
            return p && SAFE_ID.test(p.id || '') && APP_PAGES.indexOf(p.page) >= 0;
        }).map(function(p) {
            p.name = String(p.name == null ? '' : p.name);
            ['cursor', 'week', 'day', 'wave', 'cycleCount', 'savedAt'].forEach(function(k) { p[k] = num(p[k]); });
            return p;
        });
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
        setDeleted(progId, Date.now());
        withUser(function(userId) { deleteCloudProgram(userId, progId); });
    }

    // ── Log a completed workout ───────────────────────────────────────────────
    function logWorkout(programName, sessionName, exerciseList) {
        var logs = [];
        try { logs = JSON.parse(localStorage.getItem(LOGS_KEY) || '[]'); } catch(e){}
        var entry = {
            date:      localISODate(),
            ts:        Date.now(),
            program:   programName,
            session:   sessionName,
            exercises: exerciseList
        };
        logs.unshift(entry);
        localStorage.setItem(LOGS_KEY, JSON.stringify(logs.slice(0, MAX_LOCAL_LOGS)));
        withUser(function(userId) { pushLog(userId, entry); });
        return true;
    }

    function getLogs() {
        try { return JSON.parse(localStorage.getItem(LOGS_KEY) || '[]'); } catch(e) { return []; }
    }

    // ── Full history for Archives: every logged workout in the cloud (paged),
    //    merged with this device's copy. Falls back to local when offline.
    function getAllLogs() {
        var local = getLogs();
        if (!supa) return Promise.resolve(local);
        return init().then(function() { return supa.auth.getSession(); }).then(function(res) {
            var session = res.data && res.data.session;
            if (!session) return local;
            var PAGE = 1000, rows = [];
            function page(from) {
                return supa.from('workout_logs').select('*').eq('user_id', session.user.id)
                    .order('created_at', { ascending: false }).order('id', { ascending: true })
                    .range(from, from + PAGE - 1)
                    .then(function(r) {
                        if (r.error) throw r.error;
                        rows = rows.concat(r.data);
                        // the server may cap pages below PAGE, so stop only on an empty page
                        return r.data.length ? page(from + r.data.length) : rows;
                    });
            }
            return page(0).then(function(all) {
                var byKey = {};
                local.forEach(function(l) { byKey[l.ts] = l; });
                all.forEach(function(row) {
                    var key = row.client_ts != null ? row.client_ts : Date.parse(row.created_at || row.date);
                    if (!byKey[key]) byKey[key] = rowToLog(row, key);
                });
                return Object.keys(byKey).map(function(k) { return byKey[k]; })
                    .sort(function(a, b) { return b.ts - a.ts; });
            });
        }).catch(function(err) {
            console.warn('EATT archive fetch failed, showing this device only:', err && err.message || err);
            return local;
        });
    }

    return { init: init, save: save, loadAll: loadAll, getMostRecent: getMostRecent, deleteProgram: deleteProgram,
             logWorkout: logWorkout, getLogs: getLogs, getAllLogs: getAllLogs, MAX_PROGRAMS: MAX_PROGRAMS };
})();
