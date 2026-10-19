// ── EATT Estimated 1RM ───────────────────────────────────────────────────────
// Shared by every strength program (not bodybuilding). Programs record their
// AMRAP / top sets as { lift, weight, reps } while you train. The setup screen
// shows a projected 1RM preview (mountPreview); at the end of the chosen
// length E1RM.finish() asks what the user actually hit, with a short note,
// and writes it to Archives so the numbers build a year-over-year history.
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

    // ── End of program: the user records the max they actually hit ─────────
    // results: [{ lift, e1rm, detail }] — the estimate from logged sets, shown
    //   as a hint next to each input.
    // opts: { program, length, note, nextLabel, onNext(resultsWithActuals),
    //         projected: { Lift: lbs } (the setup-screen preview),
    //         completed: the page's saved completion object — the recorded
    //           maxes are stored on it as completed.recorded,
    //         onRecorded() — the page saves its state }
    // Archives gets one "Program complete" entry when the user saves the form.
    function finish(results, opts) {
        opts = opts || {};
        if (opts.completed && opts.completed.recorded) return showRecorded(results, opts);
        showForm(results, opts);
    }

    // Same entry point for the page's "view results" banner.
    function showSummary(results, opts) { finish(results, opts); }

    function openModal(html) {
        var old = document.getElementById('e1rmModal');
        if (old) old.remove();
        var modal = document.createElement('div');
        modal.id = 'e1rmModal';
        modal.className = 'e1rm-modal';
        modal.innerHTML = '<div class="e1rm-box" role="dialog" aria-modal="true" aria-labelledby="e1rmTitle">' + html + '</div>';
        document.body.appendChild(modal);
        return modal;
    }

    function header(opts) {
        return '<div class="e1rm-trophy">🏆</div>' +
               '<div class="e1rm-title" id="e1rmTitle">PROGRAM COMPLETE</div>' +
               '<div class="e1rm-sub">' + esc(opts.program || '') + (opts.length ? ' · ' + esc(opts.length) : '') + '</div>';
    }

    function showForm(results, opts) {
        var projected = opts.projected || {};
        var rows = results.map(function(r, i) {
            var hints = [];
            if (projected[r.lift]) hints.push('Projected ' + projected[r.lift]);
            if (r.e1rm && r.source !== 'carried') hints.push('Est. ' + r.e1rm + ' from your sets');
            return '<div class="e1rm-row e1rm-form-row">' +
                     '<div class="e1rm-lift">' + esc(r.lift) + '</div>' +
                     '<label class="e1rm-hit">Max hit <input type="number" inputmode="numeric" min="0" max="2000" id="e1rmHit' + i + '" placeholder="lbs"></label>' +
                     (hints.length ? '<div class="e1rm-detail">' + esc(hints.join(' · ')) + '</div>' : '') +
                     '<input type="text" class="e1rm-notein" id="e1rmNote' + i + '" maxlength="160" ' +
                       'placeholder="Note — e.g. felt good, could have hit more but not safe">' +
                   '</div>';
        }).join('');
        var modal = openModal(
            header(opts) +
            '<div class="e1rm-head">What did you hit?</div>' +
            '<div class="e1rm-note">Test your 1 rep max (or your best single) and record it. Leave a lift blank if you didn\'t test it.</div>' +
            '<div class="e1rm-list">' + rows + '</div>' +
            '<div class="e1rm-actions">' +
              '<button class="e1rm-btn e1rm-primary" id="e1rmSave">Save to Archives</button>' +
              '<button class="e1rm-btn" id="e1rmClose">Later</button>' +
            '</div>');
        document.getElementById('e1rmClose').onclick = function() { modal.remove(); };
        document.getElementById('e1rmSave').onclick = function() {
            var recorded = [];
            results.forEach(function(r, i) {
                var hit = parseInt(document.getElementById('e1rmHit' + i).value, 10);
                var note = document.getElementById('e1rmNote' + i).value.trim().slice(0, 160);
                if (!(hit > 0) && !note) return;
                recorded.push({ lift: r.lift, hit: hit > 0 ? hit : null, note: note,
                                projected: projected[r.lift] || null, estimate: r.e1rm });
            });
            if (!recorded.length && !confirm('Nothing entered. Close without recording?')) return;
            if (recorded.length && typeof EATT !== 'undefined') {
                EATT.logWorkout(opts.program, 'Program complete — 1RM' + (opts.length ? ' (' + opts.length + ')' : ''),
                    recorded.map(function(x) {
                        return { name: x.lift, type: 'e1rm', weight: x.hit, e1rm: x.hit, note: x.note,
                                 projected: x.projected, estimate: x.estimate,
                                 scheme: x.hit ? '1RM hit' : 'not tested' };
                    }));
            }
            if (opts.completed) opts.completed.recorded = recorded;
            if (opts.onRecorded) opts.onRecorded();
            modal.remove();
            if (recorded.length) showRecorded(results, opts);
        };
    }

    function showRecorded(results, opts) {
        var recorded = (opts.completed && opts.completed.recorded) || [];
        var rows = recorded.map(function(x) {
            return '<div class="e1rm-row"><div class="e1rm-lift">' + esc(x.lift) + '</div>' +
                   '<div class="e1rm-val">' + (x.hit ? esc(x.hit) + ' <span>lbs</span>' : '<span>not tested</span>') + '</div>' +
                   (x.projected ? '<div class="e1rm-detail">Projected ' + esc(x.projected) + '</div>' : '') +
                   (x.note ? '<div class="e1rm-detail e1rm-quote">“' + esc(x.note) + '”</div>' : '') + '</div>';
        }).join('');
        var modal = openModal(
            header(opts) +
            '<div class="e1rm-head">Your 1 Rep Max</div>' +
            '<div class="e1rm-list">' + rows + '</div>' +
            (opts.note ? '<div class="e1rm-note">' + esc(opts.note) + '</div>' : '') +
            '<div class="e1rm-saved">Saved to Archives.</div>' +
            '<div class="e1rm-actions">' +
              (opts.onNext ? '<button class="e1rm-btn e1rm-primary" id="e1rmNext">' + esc(opts.nextLabel || 'Start next cycle') + '</button>' : '') +
              '<button class="e1rm-btn" id="e1rmClose">Close</button>' +
            '</div>');
        document.getElementById('e1rmClose').onclick = function() { modal.remove(); };
        if (opts.onNext) document.getElementById('e1rmNext').onclick = function() {
            modal.remove();
            // Next cycle starts from what was actually hit; untested lifts keep the estimate
            opts.onNext(results.map(function(r) {
                var x = recorded.find(function(y) { return y.lift === r.lift && y.hit; });
                return x ? Object.assign({}, r, { e1rm: x.hit, source: 'hit' }) : r;
            }));
        };
    }

    // ── Setup screen: projected 1RM preview ───────────────────────────────────
    // anchor: element the preview card is inserted before (the Build button).
    // compute() → { length: '12 weeks', rows: [{ lift, now, projected }], note }
    // Re-renders whenever an input/select inside the setup panel changes.
    function mountPreview(anchor, compute) {
        if (!anchor) return;
        var box = document.createElement('div');
        box.className = 'e1rm-preview';
        anchor.parentNode.insertBefore(box, anchor);
        function render() {
            var d;
            try { d = compute(); } catch (e) { d = null; }
            if (!d || !d.rows || !d.rows.some(function(r) { return r.now > 0; })) { box.style.display = 'none'; return; }
            box.style.display = '';
            box.innerHTML =
                '<div class="e1rm-pv-head">Projected 1RM after ' + esc(d.length) + '</div>' +
                '<div class="e1rm-pv-grid">' + d.rows.map(function(r) {
                    var gain = r.projected - r.now;
                    return '<div class="e1rm-pv-cell"><div class="e1rm-pv-lift">' + esc(r.lift) + '</div>' +
                           '<div class="e1rm-pv-val">' + esc(r.projected || '–') + '</div>' +
                           '<div class="e1rm-pv-gain">' + (r.now > 0 ? esc(r.now) + ' → +' + esc(Math.max(0, gain)) : '') + '</div></div>';
                }).join('') + '</div>' +
                (d.note ? '<div class="e1rm-pv-note">' + esc(d.note) + '</div>' : '');
        }
        var panel = anchor.parentNode;
        panel.addEventListener('input', render);
        panel.addEventListener('change', render);
        render();
        return render;
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
            '.e1rm-form-row{grid-template-columns:1fr auto;gap:6px}' +
            '.e1rm-hit{font-size:.75rem;opacity:.9;display:flex;align-items:center;gap:6px}' +
            '.e1rm-hit input{width:84px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,215,0,.5);background:rgba(0,0,0,.3);color:#fff;font-weight:800;font-size:1rem}' +
            '.e1rm-notein{grid-column:1/-1;width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.25);color:#fff;font-size:.78rem}' +
            '.e1rm-quote{font-style:italic;opacity:.75}' +
            '.e1rm-preview{margin:18px 0 6px;padding:14px;border-radius:14px;border:1px solid rgba(255,215,0,.3);background:rgba(255,215,0,.05)}' +
            '.e1rm-pv-head{font-size:.7rem;letter-spacing:2px;text-transform:uppercase;opacity:.7;margin-bottom:10px;text-align:center}' +
            '.e1rm-pv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px}' +
            '.e1rm-pv-cell{text-align:center;background:rgba(0,0,0,.2);border-radius:10px;padding:8px 4px}' +
            '.e1rm-pv-lift{font-size:.65rem;letter-spacing:1px;text-transform:uppercase;opacity:.6}' +
            '.e1rm-pv-val{font-size:1.25rem;font-weight:800;color:#ffd700}' +
            '.e1rm-pv-gain{font-size:.65rem;opacity:.55}' +
            '.e1rm-pv-note{font-size:.68rem;opacity:.55;margin-top:8px;text-align:center;line-height:1.4}' +
            '.e1rm-reps input{width:56px;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,215,0,.5);background:rgba(0,0,0,.3);color:#fff;font-weight:700}';
        document.head.appendChild(css);
    })();

    return { epley: epley, bestByLift: bestByLift, pick: pick, repsInput: repsInput, readReps: readReps,
             finish: finish, showSummary: showSummary, mountPreview: mountPreview };
})();
