// ── EATT Estimated 1RM ───────────────────────────────────────────────────────
// Shared by every strength program (not bodybuilding). Programs record their
// AMRAP / top sets as { lift, weight, reps } while you train; when the last
// session of the chosen length is logged they call E1RM.finish(), which shows
// the "Program complete" summary and writes it to Archives so the numbers
// build a year-over-year history.
//
// Formula: Epley, e1RM = weight × (1 + reps / 30). Reliable up to ~10 reps;
// sets above that are capped at 10 so a 20-rep grinder doesn't inflate it.

var E1RM = (function() {

    var MAX_REPS = 10;

    function round5(v) { return Math.round(v / 5) * 5; }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // e1RM for one set, or null if the set can't be used.
    function epley(weight, reps) {
        weight = Number(weight); reps = Number(reps);
        if (!(weight > 0) || !(reps >= 1)) return null;
        if (reps === 1) return round5(weight);
        return round5(weight * (1 + Math.min(reps, MAX_REPS) / 30));
    }

    // Best estimate per lift from a list of { lift, weight, reps, ... } sets.
    // Returns { Squat: { e1rm, weight, reps }, ... }.
    function bestByLift(sets) {
        var best = {};
        (sets || []).forEach(function(s) {
            var e = epley(s.weight, s.reps);
            if (e == null) return;
            if (!best[s.lift] || e > best[s.lift].e1rm) best[s.lift] = { e1rm: e, weight: Number(s.weight), reps: Number(s.reps) };
        });
        return best;
    }

    // The one rule every program uses for its end-of-program number:
    //   1. best set logged in the FINAL block (last wave / last cycle) — current evidence
    //   2. else a set from earlier in the program, but only if it beats the max the
    //      user started this cycle with (proof of improvement)
    //   3. else the starting max carries over — never a projection, so an
    //      unlogged program can't inflate (or deflate) next cycle's numbers.
    // finalSets/allSets: [{ lift, weight, reps, ... }]; startMax: the 1RM entered
    // for this cycle; describe(set) → e.g. "225 × 8 AMRAP (wave 3)".
    // Returns { lift, e1rm, detail, source: 'final' | 'earlier' | 'carried' }.
    function pick(lift, finalSets, allSets, startMax, describe) {
        describe = describe || function(s) { return s.weight + ' × ' + s.reps; };
        function bestSet(sets) {
            var best = null;
            (sets || []).forEach(function(s) {
                if (s.lift !== lift) return;
                var e = epley(s.weight, s.reps);
                if (e != null && (!best || e > best.e1rm)) best = { e1rm: e, set: s };
            });
            return best;
        }
        var f = bestSet(finalSets);
        if (f) return { lift: lift, e1rm: f.e1rm, detail: describe(f.set), source: 'final' };
        var start = round5(Number(startMax) || 0);
        var a = bestSet(allSets);
        if (a && a.e1rm > start) {
            return { lift: lift, e1rm: a.e1rm, source: 'earlier',
                     detail: describe(a.set) + ' — earlier in the program; log final-block reps for a current estimate' };
        }
        return { lift: lift, e1rm: start, source: 'carried',
                 detail: 'no reps logged in the final block — starting max carried over' };
    }

    // HTML for a "reps done" box on an AMRAP / top set. `id` must be unique on
    // the page; read it back with readReps(id).
    function repsInput(id, value) {
        return '<label class="e1rm-reps">Reps done ' +
               '<input type="number" inputmode="numeric" min="0" max="50" id="' + esc(id) + '"' +
               (value ? ' value="' + esc(value) + '"' : '') + ' placeholder="#"></label>';
    }

    function readReps(id) {
        var el = document.getElementById(id);
        var n = el ? parseInt(el.value, 10) : NaN;
        return n >= 1 && n <= 50 ? n : null;
    }

    // results: [{ lift, e1rm, detail }] — detail says where the number came from,
    //   e.g. "225 × 8 AMRAP" or "projected from training max".
    // opts: { program, length (e.g. "3 waves · 12 weeks"), note, nextLabel, onNext }
    function finish(results, opts) {
        opts = opts || {};
        if (typeof EATT !== 'undefined') {
            EATT.logWorkout(opts.program, 'Program complete — Estimated 1RM' + (opts.length ? ' (' + opts.length + ')' : ''),
                results.map(function(r) {
                    return { name: r.lift, type: 'e1rm', e1rm: r.e1rm, weight: r.e1rm, scheme: 'Est. 1RM', detail: r.detail };
                }));
        }
        showSummary(results, opts);
    }

    function showSummary(results, opts) {
        var old = document.getElementById('e1rmModal');
        if (old) old.remove();
        var modal = document.createElement('div');
        modal.id = 'e1rmModal';
        modal.className = 'e1rm-modal';
        var rows = results.map(function(r) {
            return '<div class="e1rm-row"><div class="e1rm-lift">' + esc(r.lift) + '</div>' +
                   '<div class="e1rm-val">' + esc(r.e1rm) + ' <span>lbs</span></div>' +
                   '<div class="e1rm-detail">' + esc(r.detail || '') + '</div></div>';
        }).join('');
        modal.innerHTML =
            '<div class="e1rm-box" role="dialog" aria-modal="true" aria-labelledby="e1rmTitle">' +
              '<div class="e1rm-trophy">🏆</div>' +
              '<div class="e1rm-title" id="e1rmTitle">PROGRAM COMPLETE</div>' +
              '<div class="e1rm-sub">' + esc(opts.program || '') + (opts.length ? ' · ' + esc(opts.length) : '') + '</div>' +
              '<div class="e1rm-head">Estimated 1 Rep Max</div>' +
              '<div class="e1rm-list">' + rows + '</div>' +
              (opts.note ? '<div class="e1rm-note">' + esc(opts.note) + '</div>' : '') +
              '<div class="e1rm-saved">Saved to Archives.</div>' +
              '<div class="e1rm-actions">' +
                (opts.onNext ? '<button class="e1rm-btn e1rm-primary" id="e1rmNext">' + esc(opts.nextLabel || 'Start next cycle') + '</button>' : '') +
                '<button class="e1rm-btn" id="e1rmClose">Close</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(modal);
        document.getElementById('e1rmClose').onclick = function() { modal.remove(); };
        if (opts.onNext) document.getElementById('e1rmNext').onclick = function() { modal.remove(); opts.onNext(); };
    }

    // Styles live here so every page gets the same summary without copying CSS.
    (function injectCss() {
        if (document.getElementById('e1rmCss')) return;
        var css = document.createElement('style');
        css.id = 'e1rmCss';
        css.textContent =
            '.e1rm-modal{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px}' +
            '.e1rm-box{background:linear-gradient(145deg,#1a2540,#0f1a2e);border:1px solid rgba(255,215,0,.35);border-radius:20px;padding:32px 26px;max-width:440px;width:100%;text-align:center;color:#fff;box-shadow:0 24px 70px rgba(0,0,0,.7);max-height:90vh;overflow:auto}' +
            '.e1rm-trophy{font-size:2.6rem;margin-bottom:6px}' +
            '.e1rm-title{font-size:1.5rem;font-weight:800;letter-spacing:3px;color:#ffd700}' +
            '.e1rm-sub{font-size:.85rem;opacity:.65;margin:4px 0 20px}' +
            '.e1rm-head{font-size:.72rem;letter-spacing:2px;text-transform:uppercase;opacity:.6;margin-bottom:10px}' +
            '.e1rm-list{display:grid;gap:10px;margin-bottom:16px}' +
            '.e1rm-row{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px 14px;display:grid;grid-template-columns:1fr auto;align-items:center;text-align:left}' +
            '.e1rm-lift{font-weight:700}' +
            '.e1rm-val{font-size:1.35rem;font-weight:800;color:#ffd700}.e1rm-val span{font-size:.7rem;opacity:.6;font-weight:600}' +
            '.e1rm-detail{grid-column:1/-1;font-size:.72rem;opacity:.55;margin-top:2px}' +
            '.e1rm-note{font-size:.78rem;opacity:.7;margin-bottom:10px;line-height:1.4}' +
            '.e1rm-saved{font-size:.72rem;opacity:.5;margin-bottom:18px}' +
            '.e1rm-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}' +
            '.e1rm-btn{padding:12px 20px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;font-weight:700;cursor:pointer}' +
            '.e1rm-primary{background:linear-gradient(135deg,#f7971e,#ffd200);color:#1a1a1a;border:none}' +
            '.e1rm-reps{display:inline-flex;align-items:center;gap:6px;font-size:.75rem;opacity:.85;margin-left:8px}' +
            '.e1rm-reps input{width:56px;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,215,0,.5);background:rgba(0,0,0,.3);color:#fff;font-weight:700}';
        document.head.appendChild(css);
    })();

    return { epley: epley, bestByLift: bestByLift, pick: pick, repsInput: repsInput, readReps: readReps, finish: finish, showSummary: showSummary };
})();
