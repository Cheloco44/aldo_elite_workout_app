// ═══════════════════════════════════════════════════════════
// EATT PROGRAM SAVE / RESUME — shared across all program pages
// ═══════════════════════════════════════════════════════════
// How it works:
//   1. After generateProgram() / buildProgram() runs, call:
//        EATT.saveProgram(programName, configInputs, programArray, cursor)
//      This writes everything to localStorage.
//   2. On page load, call EATT.checkResume(programName, loadFn)
//      If a saved program exists it shows a Resume banner.
//   3. When the user navigates (cursor changes), call:
//        EATT.saveCursor(programName, cursor)
//   4. account.html reads localStorage to display saved programs
//      in the Programs tab with a Resume link.
// ═══════════════════════════════════════════════════════════

var EATT = (function() {

  var PREFIX = 'eatt_prog_';

  function key(name) {
    return PREFIX + name.replace(/\s+/g, '_').toLowerCase();
  }

  // Save the full built program
  function saveProgram(programName, configInputs, programArray, cursorPos) {
    var payload = {
      programName:  programName,
      savedAt:      new Date().toISOString(),
      cursor:       cursorPos || 0,
      config:       configInputs,   // raw inputs object {squat:315, bench:225, ...}
      program:      programArray    // the full generated program[] array
    };
    try {
      localStorage.setItem(key(programName), JSON.stringify(payload));
    } catch(e) {
      // storage full — try removing old entries
      console.warn('EATT: localStorage full, clearing old programs');
      clearOldPrograms();
      try { localStorage.setItem(key(programName), JSON.stringify(payload)); } catch(e2) {}
    }
    // Also update the programs index so account.html can list them
    updateIndex(programName);
  }

  // Save only cursor position (called on every navigate)
  function saveCursor(programName, cursorPos) {
    try {
      var raw = localStorage.getItem(key(programName));
      if (!raw) return;
      var payload = JSON.parse(raw);
      payload.cursor = cursorPos;
      payload.lastOpenedAt = new Date().toISOString();
      localStorage.setItem(key(programName), JSON.stringify(payload));
    } catch(e) {}
  }

  // Load a saved program — returns null if none
  function loadProgram(programName) {
    try {
      var raw = localStorage.getItem(key(programName));
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  // Delete a saved program
  function deleteProgram(programName) {
    localStorage.removeItem(key(programName));
    removeFromIndex(programName);
  }

  // Keep an index of all saved program names for account.html
  function updateIndex(programName) {
    var idx = getIndex();
    if (idx.indexOf(programName) === -1) idx.push(programName);
    localStorage.setItem('eatt_prog_index', JSON.stringify(idx));
  }

  function removeFromIndex(programName) {
    var idx = getIndex().filter(function(n) { return n !== programName; });
    localStorage.setItem('eatt_prog_index', JSON.stringify(idx));
  }

  function getIndex() {
    try { return JSON.parse(localStorage.getItem('eatt_prog_index') || '[]'); }
    catch(e) { return []; }
  }

  function getAllSaved() {
    return getIndex().map(function(name) {
      return loadProgram(name);
    }).filter(Boolean);
  }

  function clearOldPrograms() {
    var idx = getIndex();
    idx.forEach(function(name) { localStorage.removeItem(key(name)); });
    localStorage.removeItem('eatt_prog_index');
  }

  // Show a Resume banner on a program page if a save exists
  // loadFn(savedData) — you supply this, it restores program state
  function checkResume(programName, loadFn) {
    var saved = loadProgram(programName);
    if (!saved) return;

    // Build the banner
    var wrap = document.createElement('div');
    wrap.id = 'eattResumeBanner';
    wrap.style.cssText = [
      'position:fixed','bottom:20px','left:50%','transform:translateX(-50%)',
      'z-index:999','display:flex','align-items:center','gap:12px','flex-wrap:wrap',
      'background:#111','border:1px solid rgba(255,215,0,0.35)',
      'border-radius:12px','padding:14px 20px',
      'box-shadow:0 8px 40px rgba(0,0,0,0.7)',
      'font-family:Segoe UI,system-ui,sans-serif',
      'max-width:90vw'
    ].join(';');

    var dayNum  = (saved.cursor || 0) + 1;
    var total   = (saved.program || []).length;
    var dateStr = saved.savedAt ? new Date(saved.savedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';

    wrap.innerHTML =
      '<div style="flex:1;min-width:180px">' +
        '<div style="font-size:0.6rem;letter-spacing:2px;text-transform:uppercase;color:rgba(255,215,0,0.55);margin-bottom:3px">Saved Program Found</div>' +
        '<div style="font-size:0.92rem;font-weight:800;color:#ffd700">' + programName + '</div>' +
        '<div style="font-size:0.75rem;color:rgba(240,232,216,0.5);margin-top:2px">Day ' + dayNum + ' of ' + total + (dateStr ? ' &nbsp;·&nbsp; ' + dateStr : '') + '</div>' +
      '</div>' +
      '<button id="eattResumeBtn" style="background:linear-gradient(135deg,#b8860b,#ffd700);color:#111;border:none;border-radius:8px;padding:10px 18px;font-size:0.82rem;font-weight:900;letter-spacing:1px;cursor:pointer;white-space:nowrap">▶ Resume</button>' +
      '<button id="eattDismissBtn" style="background:none;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);border-radius:8px;padding:10px 14px;font-size:0.82rem;cursor:pointer;white-space:nowrap">New Build</button>';

    document.body.appendChild(wrap);

    document.getElementById('eattResumeBtn').onclick = function() {
      wrap.remove();
      loadFn(saved);
    };
    document.getElementById('eattDismissBtn').onclick = function() {
      wrap.remove();
      // Don't delete the save — just dismiss the banner this session
    };
  }

  return {
    saveProgram:   saveProgram,
    saveCursor:    saveCursor,
    loadProgram:   loadProgram,
    deleteProgram: deleteProgram,
    getAllSaved:    getAllSaved,
    checkResume:   checkResume,
    getIndex:      getIndex
  };

})();