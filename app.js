(function () {
  'use strict';

  var C = window.PlanCore;

  var KEY = {
    projects: 'pomodoro_projects',
    tasks: 'pomodoro_tasks',
    sessions: 'pomodoro_sessions',
    version: 'pomodoro_version',
    settings: 'pomodoro_settings',
    timer: 'pomodoro_timer',
    ui: 'pomodoro_ui',
    v1Backup: 'pomodoro_v1_backup'
  };
  var DATA_VERSION = '2';

  function $(id) {
    return document.getElementById(id);
  }

  // ========================================
  // Lagring
  // ========================================
  function readRaw(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function read(key, fallback) {
    var raw = readRaw(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  var storageWarned = false;
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      if (!storageWarned) {
        storageWarned = true;
        setTimeout(function () {
          toast('Kunde inte spara – webbläsarens lagring är full eller blockerad.');
        }, 0);
      }
      return false;
    }
  }

  function today() {
    return C.toDateStr(new Date());
  }

  function loadData() {
    var raw = {
      projects: read(KEY.projects, []),
      tasks: read(KEY.tasks, []),
      sessions: read(KEY.sessions, [])
    };
    if (readRaw(KEY.version) === DATA_VERSION) return C.normalizeData(raw);

    // Första starten efter uppdateringen: spara en orörd kopia av den gamla
    // datan och flytta över allt till den nya modellen.
    if (readRaw(KEY.projects) || readRaw(KEY.tasks) || readRaw(KEY.sessions)) {
      try {
        localStorage.setItem(KEY.v1Backup, JSON.stringify({
          savedAt: new Date().toISOString(),
          projects: readRaw(KEY.projects),
          tasks: readRaw(KEY.tasks),
          sessions: readRaw(KEY.sessions),
          schedule: readRaw('pomodoro_schedule'),
          scheduleHistory: readRaw('pomodoro_schedule_history')
        }));
      } catch (e) { /* ingen plats – migreringen fortsätter ändå */ }
    }
    raw.schedule = read('pomodoro_schedule', null);
    var migrated = C.migrateV1(raw, [today(), new Date().toISOString().slice(0, 10)], Date.now());
    saveData(migrated);
    try {
      localStorage.setItem(KEY.version, DATA_VERSION);
    } catch (e) { /* ignoreras */ }
    return migrated;
  }

  function saveData(data) {
    data = data || state;
    write(KEY.projects, data.projects);
    write(KEY.tasks, data.tasks);
    write(KEY.sessions, data.sessions);
  }

  function clampInt(v, min, max, fallback) {
    v = parseInt(v, 10);
    if (isNaN(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  }

  function loadSettings() {
    var s = read(KEY.settings, null) || {};
    var oldTheme = readRaw('pomodoro_theme');
    var theme = ['system', 'light', 'dark'].indexOf(s.theme) !== -1 ? s.theme
      : (oldTheme === 'light' || oldTheme === 'dark' ? oldTheme : 'system');
    return {
      theme: theme,
      workMin: clampInt(s.workMin, 1, 180, 25),
      breakMin: clampInt(s.breakMin, 1, 60, 5)
    };
  }

  function saveSettings() {
    write(KEY.settings, settings);
  }

  function loadUi() {
    var u = read(KEY.ui, null) || {};
    return {
      view: 'overview',
      showSomeday: !!u.showSomeday,
      showArchived: false,
      expanded: u.expanded && typeof u.expanded === 'object' ? u.expanded : {},
      showDone: {}
    };
  }

  function saveUi() {
    write(KEY.ui, { showSomeday: ui.showSomeday, expanded: ui.expanded });
  }

  var state = loadData();
  var settings = loadSettings();
  var ui = loadUi();

  function projectById(id) {
    if (!id) return null;
    for (var i = 0; i < state.projects.length; i++) {
      if (state.projects[i].id === id) return state.projects[i];
    }
    return null;
  }

  function taskIndex(id) {
    for (var i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === id) return i;
    }
    return -1;
  }

  function taskById(id) {
    var i = id ? taskIndex(id) : -1;
    return i === -1 ? null : state.tasks[i];
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function commit() {
    saveData();
    render();
  }

  // ========================================
  // Hjälpare för HTML
  // ========================================
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    flag: '<path d="M5 21V4M5 4h12l-2.5 4.5L17 13H5"/>',
    repeat: '<path d="M17 2.5l3 3-3 3M4 11.5v-1a5 5 0 0 1 5-5h11M7 21.5l-3-3 3-3M20 12.5v1a5 5 0 0 1-5 5H4"/>',
    note: '<path d="M6 3.5h9l4 4v13H6z"/><path d="M9.5 12h6M9.5 16h4"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17v.01"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'
  };
  var FILLED = { play: true };

  function icon(name, cls) {
    return '<svg class="icon' + (FILLED[name] ? ' icon-fill' : '') + (cls ? ' ' + cls : '') +
      '" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  // ========================================
  // Element
  // ========================================
  var el = {
    main: $('main'),
    kicker: $('view-kicker'),
    title: $('view-title'),
    subtitle: $('view-subtitle'),
    overview: $('view-overview'),
    projects: $('view-projects'),
    focus: $('view-focus'),
    tabs: document.querySelectorAll('.tab'),
    fab: document.querySelector('.fab'),
    focusTabLabel: $('focus-tab-label'),
    focusTab: document.querySelector('.tab[data-view="focus"]'),
    toast: $('toast'),
    // timer
    timer: $('timer'),
    timerTime: $('timer-time'),
    timerPhase: $('timer-phase'),
    timerSub: $('timer-sub'),
    ring: $('ring-progress'),
    timerToggle: $('timer-toggle'),
    togglePlay: $('timer-toggle-play'),
    togglePause: $('timer-toggle-pause'),
    timerSkip: $('timer-skip'),
    focusTask: $('focus-task'),
    focusFinished: $('focus-finished'),
    focusStats: $('focus-stats')
  };

  // ========================================
  // Tema
  // ========================================
  function applyTheme() {
    var root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
    var dark = settings.theme === 'dark' ||
      (settings.theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#111114' : '#f6f5f2');
  }

  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () { if (settings.theme === 'system') applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  }

  // ========================================
  // Toast med ångra
  // ========================================
  var toastTimer = null;

  function toast(message, actionLabel, action) {
    var t = el.toast;
    t.innerHTML = '<span class="toast-msg"></span>' + (actionLabel ? '<button type="button"></button>' : '');
    t.querySelector('.toast-msg').textContent = message;
    if (actionLabel) {
      var b = t.querySelector('button');
      b.textContent = actionLabel;
      b.addEventListener('click', function () {
        hideToast();
        action();
      });
    }
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetHeight;
    t.style.animation = '';
    // Som popover hamnar toasten ovanpå öppna dialoger
    if (t.showPopover) {
      try {
        if (t.matches(':popover-open')) t.hidePopover();
        t.showPopover();
      } catch (e) { /* ignoreras */ }
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 5500 : 3000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    el.toast.hidden = true;
    if (el.toast.hidePopover) {
      try { el.toast.hidePopover(); } catch (e) { /* ignoreras */ }
    }
  }

  if (el.toast.showPopover) el.toast.setAttribute('popover', 'manual');

  function haptic(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern || 8);
    } catch (e) { /* ignoreras */ }
  }

  // ========================================
  // Dialoger
  // ========================================
  function openDialog(d) {
    if (d.open) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }

  function closeDialog(d) {
    if (!d.open) return;
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }

  Array.prototype.forEach.call(document.querySelectorAll('dialog'), function (d) {
    var downOnBackdrop = false;
    d.addEventListener('pointerdown', function (e) { downOnBackdrop = e.target === d; });
    d.addEventListener('click', function (e) {
      if (e.target === d && downOnBackdrop) closeDialog(d);
      downOnBackdrop = false;
    });
    Array.prototype.forEach.call(d.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', function () { closeDialog(d); });
    });
  });

  function anyDialogOpen() {
    return !!document.querySelector('dialog[open]');
  }

  var confirmSheet = $('confirm-sheet');
  function confirmDialog(message, okLabel) {
    return new Promise(function (resolve) {
      $('confirm-text').textContent = message;
      $('confirm-ok').textContent = okLabel || 'Ta bort';
      var settled = false;
      function done(v) {
        if (settled) return;
        settled = true;
        $('confirm-ok').onclick = null;
        $('confirm-cancel').onclick = null;
        confirmSheet.removeEventListener('close', onClose);
        closeDialog(confirmSheet);
        resolve(v);
      }
      function onClose() { done(false); }
      $('confirm-ok').onclick = function () { done(true); };
      $('confirm-cancel').onclick = function () { done(false); };
      confirmSheet.addEventListener('close', onClose);
      openDialog(confirmSheet);
      $('confirm-cancel').focus();
    });
  }

  // ========================================
  // Uppgifter
  // ========================================
  function toggleTask(id) {
    var i = taskIndex(id);
    if (i === -1) return;
    var task = state.tasks[i];
    var before = clone(task);
    if (task.done) {
      task.done = false;
      task.doneAt = null;
      commit();
      return;
    }
    var updated = C.completeTask(task, today(), Date.now());
    state.tasks[i] = updated;
    haptic(12);
    commit();
    var undo = function () { restoreTask(before); };
    if (updated.done) {
      toast('Klart: ' + task.name, 'Ångra', undo);
      celebrateIfDayDone();
    } else {
      toast('Klart! Nästa gång ' + C.formatShort(updated.date, today()), 'Ångra', undo);
    }
  }

  function restoreTask(snapshot, index) {
    var i = taskIndex(snapshot.id);
    if (i !== -1) state.tasks[i] = snapshot;
    else if (typeof index === 'number') state.tasks.splice(Math.min(index, state.tasks.length), 0, snapshot);
    else state.tasks.push(snapshot);
    commit();
  }

  function deleteTask(id) {
    var i = taskIndex(id);
    if (i === -1) return;
    var removed = state.tasks.splice(i, 1)[0];
    commit();
    toast('Borttagen: ' + removed.name, 'Ångra', function () { restoreTask(removed, i); });
  }

  function celebrateIfDayDone() {
    var counts = C.buildAgenda(state, today()).counts;
    if (counts.todayOpen === 0 && counts.overdue === 0 && counts.todayDone > 0) launchConfetti();
  }

  function playTask(id) {
    var task = taskById(id);
    if (!task) return;
    timer.taskId = task.id;
    if (timer.phase === 'work') timer.finishedTaskId = null;
    saveTimer();
    setView('focus');
    if (timer.phase === 'work' && !timer.running) startTimer();
  }

  // ========================================
  // Uppgiftsarket
  // ========================================
  var taskSheet = $('task-sheet');
  var tf = {
    form: $('task-form'),
    title: $('task-sheet-title'),
    name: $('task-name'),
    date: $('task-date'),
    time: $('task-time'),
    project: $('task-project'),
    recurring: $('task-recurring'),
    notes: $('task-notes'),
    chips: $('task-date-chips'),
    hint: $('task-deadline-hint'),
    del: $('task-delete'),
    submit: $('task-submit')
  };
  var editingTaskId = null;

  function chipDate(kind) {
    var t = today();
    if (kind === 'today') return t;
    if (kind === 'tomorrow') return C.addDays(t, 1);
    if (kind === 'nextweek') return C.addDays(C.startOfWeek(t), 7);
    return '';
  }

  function updateTaskSheetState() {
    var value = tf.date.value;
    Array.prototype.forEach.call(tf.chips.querySelectorAll('.chip'), function (chip) {
      chip.setAttribute('aria-pressed', String(chipDate(chip.dataset.date) === value));
    });
    tf.time.disabled = !value;
    if (!value) tf.time.value = '';

    var p = projectById(tf.project.value);
    var t = today();
    if (p && p.deadline) {
      var late = value && value > p.deadline;
      tf.hint.textContent = late
        ? 'Datumet ligger efter projektets deadline (' + C.formatShort(p.deadline, t) + ').'
        : 'Projektets deadline: ' + C.formatShort(p.deadline, t) + ' (' + C.formatRelative(p.deadline, t) + ').';
      tf.hint.classList.toggle('is-warn', !!late);
      tf.hint.hidden = false;
    } else {
      tf.hint.hidden = true;
    }
  }

  function fillProjectSelect(select, currentId) {
    var options = '<option value="">' + esc(C.NO_PROJECT_NAME) + ' (inget projekt)</option>';
    C.sortProjects(state.projects).forEach(function (p) {
      if (p.archived && p.id !== currentId) return;
      options += '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.archived ? ' (avslutat)' : '') + '</option>';
    });
    select.innerHTML = options;
    select.value = currentId && projectById(currentId) ? currentId : '';
  }

  function openTaskSheet(opts) {
    opts = opts || {};
    var task = opts.id ? taskById(opts.id) : null;
    editingTaskId = task ? task.id : null;
    tf.title.textContent = task ? 'Redigera uppgift' : 'Ny uppgift';
    tf.submit.textContent = task ? 'Spara' : 'Lägg till';
    tf.del.hidden = !task;
    tf.name.value = task ? task.name : '';
    tf.date.value = task ? (task.date || '') : (opts.date != null ? opts.date : '');
    tf.time.value = task && task.time ? task.time : '';
    fillProjectSelect(tf.project, task ? task.projectId : (opts.projectId || null));
    tf.recurring.value = task && task.recurring ? task.recurring : '';
    tf.notes.value = task ? task.notes : '';
    updateTaskSheetState();
    openDialog(taskSheet);
    if (!task) tf.name.focus();
  }

  tf.chips.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    tf.date.value = chipDate(chip.dataset.date);
    if (!tf.date.value) tf.recurring.value = '';
    updateTaskSheetState();
  });
  tf.date.addEventListener('input', updateTaskSheetState);
  tf.date.addEventListener('change', updateTaskSheetState);
  tf.project.addEventListener('change', updateTaskSheetState);
  tf.recurring.addEventListener('change', function () {
    if (tf.recurring.value && !tf.date.value) {
      tf.date.value = today();
      updateTaskSheetState();
    }
  });

  tf.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = tf.name.value.trim();
    if (!name) {
      tf.name.focus();
      return;
    }
    var date = C.isDateStr(tf.date.value) ? tf.date.value : null;
    var recurring = tf.recurring.value || null;
    if (recurring && !date) date = today();
    var fields = {
      name: name,
      date: date,
      time: date ? C.normalizeTime(tf.time.value) : null,
      projectId: tf.project.value && projectById(tf.project.value) ? tf.project.value : null,
      recurring: recurring,
      notes: tf.notes.value.trim()
    };
    var isNew = !editingTaskId;
    if (editingTaskId) {
      var task = taskById(editingTaskId);
      if (task) {
        for (var k in fields) task[k] = fields[k];
      }
    } else {
      var nt = { id: C.uid(), done: false, doneAt: null, createdAt: Date.now() };
      for (var f in fields) nt[f] = fields[f];
      state.tasks.push(nt);
    }
    closeDialog(taskSheet);
    commit();
    if (isNew) {
      toast('Tillagd: ' + name + ' – ' + (date ? C.formatDayHeading(date, today()).toLowerCase() : 'utan datum'));
    }
  });

  tf.del.addEventListener('click', function () {
    var id = editingTaskId;
    closeDialog(taskSheet);
    if (id) deleteTask(id);
  });

  // ========================================
  // Projektarket
  // ========================================
  var projectSheet = $('project-sheet');
  var pf = {
    form: $('project-form'),
    title: $('project-sheet-title'),
    name: $('project-name'),
    deadline: $('project-deadline'),
    clear: $('project-deadline-clear'),
    colors: $('project-colors'),
    notes: $('project-notes'),
    del: $('project-delete'),
    archive: $('project-archive'),
    submit: $('project-submit')
  };
  var editingProjectId = null;
  var selectedColor = null;

  function renderSwatches() {
    var colors = C.PROJECT_COLORS.slice();
    if (selectedColor && colors.indexOf(selectedColor) === -1) colors.push(selectedColor);
    pf.colors.innerHTML = colors.map(function (c, i) {
      var on = c === selectedColor;
      return '<button type="button" class="swatch" role="radio" style="--c:' + esc(c) + '" data-color="' + esc(c) +
        '" aria-checked="' + on + '" aria-label="Färg ' + (i + 1) + '" tabindex="' + (on ? '0' : '-1') + '"></button>';
    }).join('');
  }

  pf.colors.addEventListener('click', function (e) {
    var sw = e.target.closest('.swatch');
    if (!sw) return;
    selectedColor = sw.dataset.color;
    renderSwatches();
    pf.colors.querySelector('[aria-checked="true"]').focus();
  });

  pf.colors.addEventListener('keydown', function (e) {
    var dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    var all = Array.prototype.slice.call(pf.colors.querySelectorAll('.swatch'));
    var i = all.findIndex(function (s) { return s.dataset.color === selectedColor; });
    selectedColor = all[(i + dir + all.length) % all.length].dataset.color;
    renderSwatches();
    pf.colors.querySelector('[aria-checked="true"]').focus();
  });

  function openProjectSheet(id) {
    var p = id ? projectById(id) : null;
    editingProjectId = p ? p.id : null;
    pf.title.textContent = p ? 'Redigera projekt' : 'Nytt projekt';
    pf.submit.textContent = p ? 'Spara' : 'Skapa';
    pf.name.value = p ? p.name : '';
    pf.deadline.value = p && p.deadline ? p.deadline : '';
    pf.notes.value = p ? p.notes : '';
    pf.del.hidden = !p;
    pf.archive.hidden = !p;
    pf.archive.textContent = p && p.archived ? 'Återaktivera' : 'Markera klart';
    selectedColor = p ? p.color : C.nextColor(state.projects);
    renderSwatches();
    openDialog(projectSheet);
    if (!p) pf.name.focus();
  }

  pf.clear.addEventListener('click', function () {
    pf.deadline.value = '';
  });

  pf.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = pf.name.value.trim();
    if (!name) {
      pf.name.focus();
      return;
    }
    var fields = {
      name: name,
      deadline: C.isDateStr(pf.deadline.value) ? pf.deadline.value : null,
      color: C.isColor(selectedColor) ? selectedColor : C.nextColor(state.projects),
      notes: pf.notes.value.trim()
    };
    var id = editingProjectId;
    if (id) {
      var p = projectById(id);
      if (p) {
        for (var k in fields) p[k] = fields[k];
      }
    } else {
      id = C.uid();
      var np = { id: id, archived: false, createdAt: Date.now() };
      for (var f in fields) np[f] = fields[f];
      state.projects.push(np);
      ui.expanded[id] = true;
      saveUi();
    }
    closeDialog(projectSheet);
    commit();
    if (!editingProjectId) {
      if (ui.view === 'projects') flashProject(id);
      else toast('Projektet ' + name + ' är skapat');
    }
  });

  pf.archive.addEventListener('click', function () {
    var p = projectById(editingProjectId);
    if (!p) return;
    p.archived = !p.archived;
    closeDialog(projectSheet);
    commit();
    if (p.archived) {
      toast(p.name + ' är klart', 'Ångra', function () {
        p.archived = false;
        commit();
      });
      launchConfetti();
    }
  });

  pf.del.addEventListener('click', function () {
    var p = projectById(editingProjectId);
    if (!p) return;
    var own = state.tasks.filter(function (t) { return t.projectId === p.id; });
    var msg = own.length
      ? 'Ta bort ' + p.name + ' och ' + plural(own.length, 'uppgift', 'uppgifter') + '?'
      : 'Ta bort ' + p.name + '?';
    confirmDialog(msg, 'Ta bort').then(function (ok) {
      if (!ok) return;
      var before = clone(state);
      state.projects = state.projects.filter(function (x) { return x.id !== p.id; });
      state.tasks = state.tasks.filter(function (t) { return t.projectId !== p.id; });
      closeDialog(projectSheet);
      commit();
      toast('Borttaget: ' + p.name, 'Ångra', function () {
        state.projects = before.projects;
        state.tasks = before.tasks;
        commit();
      });
    });
  });

  function flashProject(id) {
    var card = $('proj-' + id);
    if (!card) return;
    card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    card.classList.remove('is-flash');
    void card.offsetWidth;
    card.classList.add('is-flash');
  }

  // ========================================
  // Dela med Claude / importera
  // ========================================
  var shareSheet = $('share-sheet');
  var shareText = $('share-text');
  var shareCopy = $('share-copy');
  var shareNative = $('share-native');

  function openShare() {
    shareText.value = C.exportText(state, today(), Date.now());
    shareNative.hidden = !navigator.share;
    shareCopy.textContent = 'Kopiera';
    closeDialog($('settings-sheet'));
    openDialog(shareSheet);
    shareCopy.focus();
    shareText.scrollTop = 0;
  }

  function copyFallback() {
    shareText.focus();
    shareText.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) { /* ignoreras */ }
    return ok;
  }

  shareCopy.addEventListener('click', function () {
    var textValue = shareText.value;
    function copied() {
      shareCopy.textContent = 'Kopierat ✓';
      haptic(10);
      setTimeout(function () { shareCopy.textContent = 'Kopiera'; }, 2200);
    }
    function failed() {
      if (copyFallback()) copied();
      else toast('Kunde inte kopiera – markera texten och kopiera den själv.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textValue).then(copied, failed);
    } else {
      failed();
    }
  });

  shareNative.addEventListener('click', function () {
    navigator.share({ title: 'Min planering', text: shareText.value }).catch(function () {});
  });

  var importSheet = $('import-sheet');
  var importText = $('import-text');
  var importPaste = $('import-paste');
  var importEdit = $('import-edit');
  var importReview = $('import-review');
  var importPreview = $('import-preview');
  var importApply = $('import-apply');
  var pendingImport = null;

  function openImport() {
    closeDialog(shareSheet);
    closeDialog($('settings-sheet'));
    pendingImport = null;
    importEdit.hidden = false;
    importReview.hidden = true;
    importPaste.hidden = !(navigator.clipboard && navigator.clipboard.readText);
    openDialog(importSheet);
    importText.focus();
  }

  importPaste.addEventListener('click', function () {
    navigator.clipboard.readText().then(function (txt) {
      importText.value = txt;
      importText.focus();
    }, function () {
      toast('Kunde inte läsa urklipp – klistra in i rutan i stället.');
    });
  });

  $('import-preview-btn').addEventListener('click', function () {
    var src = importText.value;
    if (!src.trim()) {
      importText.focus();
      return;
    }
    var parsed = C.parsePlan(src);
    var result = C.applyPlan(state, parsed, today(), Date.now());
    pendingImport = result;
    var real = result.changes.filter(function (c) { return c.type !== 'note'; });
    var marks = { add: '+', change: '~', remove: '−', note: 'i', error: '!' };
    var html = '<p class="import-summary">' + (real.length
      ? plural(real.length, 'ändring', 'ändringar') + ' att genomföra:'
      : 'Inga ändringar hittades.') + '</p>';
    var items = result.changes.map(function (c) {
      return '<li class="change-' + c.type + '"><span class="change-mark" aria-hidden="true">' + marks[c.type] +
        '</span><span>' + esc(c.text) + '</span></li>';
    });
    parsed.errors.forEach(function (err) {
      items.push('<li class="change-error"><span class="change-mark" aria-hidden="true">!</span><span>Hoppar över rad ' +
        err.line + ': ' + esc(err.message) + ' – <code>' + esc(err.text) + '</code></span></li>');
    });
    if (items.length) html += '<ul>' + items.join('') + '</ul>';
    importPreview.innerHTML = html;
    importApply.disabled = !real.length;
    importApply.textContent = real.length ? 'Genomför ' + plural(real.length, 'ändring', 'ändringar') : 'Inget att genomföra';
    importEdit.hidden = true;
    importReview.hidden = false;
    $('import-back').focus();
  });

  $('import-back').addEventListener('click', function () {
    importEdit.hidden = false;
    importReview.hidden = true;
    importText.focus();
  });

  importApply.addEventListener('click', function () {
    if (!pendingImport) return;
    var before = clone(state);
    state = C.normalizeData(pendingImport.data);
    pendingImport = null;
    importText.value = '';
    closeDialog(importSheet);
    commit();
    toast('Planen är uppdaterad', 'Ångra', function () {
      state = before;
      commit();
    });
  });

  // ========================================
  // Inställningar och säkerhetskopia
  // ========================================
  var settingsSheet = $('settings-sheet');
  var settingWork = $('setting-work');
  var settingBreak = $('setting-break');

  function openSettings() {
    Array.prototype.forEach.call(settingsSheet.querySelectorAll('input[name="theme"]'), function (r) {
      r.checked = r.value === settings.theme;
    });
    settingWork.value = settings.workMin;
    settingBreak.value = settings.breakMin;
    openDialog(settingsSheet);
  }

  settingsSheet.addEventListener('change', function (e) {
    if (e.target.name === 'theme') {
      settings.theme = e.target.value;
      applyTheme();
      saveSettings();
    } else if (e.target === settingWork || e.target === settingBreak) {
      settings.workMin = clampInt(settingWork.value, 1, 180, settings.workMin);
      settings.breakMin = clampInt(settingBreak.value, 1, 60, settings.breakMin);
      settingWork.value = settings.workMin;
      settingBreak.value = settings.breakMin;
      saveSettings();
      // Ett pass som inte har startats får den nya längden direkt
      if (!timer.running && timer.remaining === timer.total) {
        setPhase(timer.phase);
        saveTimer();
      }
      render();
    }
  });

  $('backup-download').addEventListener('click', function () {
    var json = C.makeBackup(state, settings, Date.now());
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'pomodoro-sakerhetskopia-' + today() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  });

  var backupFile = $('backup-file');
  $('backup-restore').addEventListener('click', function () {
    backupFile.value = '';
    backupFile.click();
  });

  backupFile.addEventListener('change', function () {
    var file = backupFile.files && backupFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var backup;
      try {
        backup = C.readBackup(String(reader.result));
      } catch (e) {
        toast(e instanceof SyntaxError ? 'Filen är ingen giltig JSON-fil.' : e.message);
        return;
      }
      var d = backup.data;
      confirmDialog('Ersätta allt i appen med säkerhetskopian (' + plural(d.projects.length, 'projekt', 'projekt') +
        ', ' + plural(d.tasks.length, 'uppgift', 'uppgifter') + ')?', 'Återställ').then(function (ok) {
        if (!ok) return;
        var before = clone(state);
        state = d;
        closeDialog(settingsSheet);
        commit();
        toast('Säkerhetskopian är återställd', 'Ångra', function () {
          state = before;
          commit();
        });
      });
    };
    reader.readAsText(file);
  });

  // ========================================
  // Ljud
  // ========================================
  var audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function unlockAudio() {
    try {
      var ctx = getAudioCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    } catch (e) { /* ignoreras */ }
  }

  // Liten WAV i minnet – <audio> fungerar även när fliken ligger i bakgrunden
  function generateWav(tones) {
    var sampleRate = 22050;
    var maxEnd = 0;
    tones.forEach(function (t) { maxEnd = Math.max(maxEnd, t.delay + t.duration + 0.02); });
    var numSamples = Math.ceil(maxEnd * sampleRate);
    var samples = new Float32Array(numSamples);
    tones.forEach(function (t) {
      var start = Math.floor(t.delay * sampleRate);
      var dur = Math.ceil(t.duration * sampleRate);
      for (var i = 0; i < dur && start + i < numSamples; i++) {
        var env = 1 - i / dur;
        if (i < sampleRate * 0.02) env *= i / (sampleRate * 0.02);
        samples[start + i] += Math.sin(2 * Math.PI * t.freq * i / sampleRate) * t.volume * env;
      }
    });
    var buffer = new ArrayBuffer(44 + numSamples * 2);
    var view = new DataView(buffer);
    function str(offset, s) {
      for (var i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    }
    str(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, numSamples * 2, true);
    for (var j = 0; j < numSamples; j++) {
      var s = Math.max(-1, Math.min(1, samples[j]));
      view.setInt16(44 + j * 2, s * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  var SOUNDS = {
    work: [
      { freq: 660, duration: 0.18, delay: 0, volume: 0.5 },
      { freq: 880, duration: 0.18, delay: 0.2, volume: 0.5 },
      { freq: 1100, duration: 0.15, delay: 0.4, volume: 0.6 }
    ],
    break: [
      { freq: 520, duration: 0.14, delay: 0, volume: 0.4 },
      { freq: 680, duration: 0.14, delay: 0.15, volume: 0.4 }
    ],
    start: [
      { freq: 440, duration: 0.1, delay: 0, volume: 0.25 },
      { freq: 560, duration: 0.12, delay: 0.12, volume: 0.3 }
    ]
  };
  var soundUrls = {};
  try {
    Object.keys(SOUNDS).forEach(function (k) {
      soundUrls[k] = URL.createObjectURL(generateWav(SOUNDS[k]));
    });
  } catch (e) { /* inget ljud */ }

  function playSound(type) {
    try {
      if (soundUrls[type]) new Audio(soundUrls[type]).play().catch(function () {});
    } catch (e) { /* ignoreras */ }
    try {
      var ctx = getAudioCtx();
      if (!ctx) return;
      var go = function () {
        SOUNDS[type].forEach(function (t) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.value = t.freq;
          var at = ctx.currentTime + t.delay;
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(t.volume / 2, at + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, at + t.duration);
          osc.start(at);
          osc.stop(at + t.duration + 0.01);
        });
      };
      if (ctx.state === 'suspended') ctx.resume().then(go, function () {});
      else go();
    } catch (e) { /* ignoreras */ }
  }

  // Larmet spelas tre gånger så att det inte missas
  function playAlarm(type) {
    playSound(type);
    setTimeout(function () { playSound(type); }, 1500);
    setTimeout(function () { playSound(type); }, 3000);
  }

  // ========================================
  // Timer
  // ========================================
  var worker = null;
  try {
    var workerSrc = 'var id=null;self.onmessage=function(e){if(e.data==="start"){if(id)clearInterval(id);' +
      'id=setInterval(function(){self.postMessage("t")},250)}else if(e.data==="stop"){if(id){clearInterval(id);id=null}}};';
    worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'application/javascript' })));
    worker.onmessage = function () { tick(); };
  } catch (e) {
    worker = null;
  }
  var intervalId = null;

  function phaseSeconds(phase) {
    return (phase === 'work' ? settings.workMin : settings.breakMin) * 60;
  }

  function loadTimer() {
    var t = read(KEY.timer, null) || {};
    var phase = t.phase === 'break' ? 'break' : 'work';
    var total = typeof t.total === 'number' && t.total > 0 ? t.total : phaseSeconds(phase);
    var running = !!t.running && typeof t.endTime === 'number';
    return {
      phase: phase,
      total: total,
      running: running,
      endTime: running ? t.endTime : null,
      remaining: typeof t.remaining === 'number' && t.remaining >= 0 ? Math.min(t.remaining, total) : total,
      taskId: typeof t.taskId === 'string' ? t.taskId : null,
      finishedTaskId: typeof t.finishedTaskId === 'string' ? t.finishedTaskId : null
    };
  }

  var timer = loadTimer();
  var timerSaved = true;

  function saveTimer() {
    timerSaved = write(KEY.timer, timer);
  }

  function setPhase(phase) {
    timer.phase = phase;
    timer.total = phaseSeconds(phase);
    timer.remaining = timer.total;
    timer.running = false;
    timer.endTime = null;
  }

  function remaining() {
    if (!timer.running) return timer.remaining;
    return Math.max(0, Math.ceil((timer.endTime - Date.now()) / 1000));
  }

  function startTicking() {
    if (worker) worker.postMessage('start');
    else if (!intervalId) intervalId = setInterval(tick, 250);
  }

  function stopTicking() {
    if (worker) worker.postMessage('stop');
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function suggestedTask() {
    var agenda = C.buildAgenda(state, today());
    for (var i = 0; i < agenda.sections.length; i++) {
      var sec = agenda.sections[i];
      if (sec.key !== 'overdue' && sec.key !== 'today') break;
      for (var j = 0; j < sec.items.length; j++) {
        var item = sec.items[j];
        if (item.kind === 'task' && !item.done) return item.task;
      }
    }
    return null;
  }

  // Uppgiften som timern gäller: vald uppgift, annars förslag från idag
  function focusTask() {
    if (timer.taskId === '') return null;
    var t = timer.taskId ? taskById(timer.taskId) : null;
    if (t && (!t.done || (timer.running && timer.phase === 'work'))) return t;
    return suggestedTask();
  }

  function startTimer() {
    if (timer.running) return;
    unlockAudio();
    if (timer.phase === 'work') {
      timer.finishedTaskId = null;
      var t = focusTask();
      if (timer.taskId !== '') timer.taskId = t ? t.id : null;
      if (timer.remaining === timer.total) playSound('start');
    }
    timer.running = true;
    timer.endTime = Date.now() + timer.remaining * 1000;
    haptic(12);
    saveTimer();
    startTicking();
    renderFocus();
  }

  function pauseTimer() {
    if (!timer.running) return;
    timer.remaining = remaining();
    timer.running = false;
    timer.endTime = null;
    stopTicking();
    saveTimer();
    renderFocus();
  }

  function resetTimer() {
    stopTicking();
    setPhase('work');
    timer.finishedTaskId = null;
    saveTimer();
    renderFocus();
  }

  function skipBreak() {
    if (timer.phase !== 'break') return;
    stopTicking();
    setPhase('work');
    saveTimer();
    renderFocus();
  }

  function logSession(endedAt, seconds) {
    var task = timer.taskId ? taskById(timer.taskId) : null;
    var project = task ? projectById(task.projectId) : null;
    var session = {
      activity: (project ? project.name + ' — ' : '') + (task ? task.name : 'Fokus'),
      duration: Math.max(1, Math.round(seconds / 60)),
      date: C.toDateStr(new Date(endedAt)),
      timestamp: endedAt
    };
    if (task) session.taskId = task.id;
    if (project) session.projectId = project.id;
    state.sessions.push(session);
  }

  // silent = passet tog slut medan appen var stängd
  function finishPhase(silent) {
    // En annan flik kan redan ha avslutat samma pass
    var stored = read(KEY.timer, null);
    if (timerSaved && stored && (stored.phase !== timer.phase || stored.endTime !== timer.endTime)) {
      timer = loadTimer();
      if (!timer.running) stopTicking();
      state = loadData();
      render();
      return;
    }
    var endedAt = timer.endTime || Date.now();
    if (timer.phase === 'work') {
      logSession(endedAt, timer.total);
      var finished = timer.taskId || null;
      setPhase('break');
      timer.finishedTaskId = finished;
      var breakEnd = endedAt + timer.total * 1000;
      if (breakEnd > Date.now()) {
        timer.running = true;
        timer.endTime = breakEnd;
      } else {
        setPhase('work');
      }
      if (!silent) {
        playAlarm('work');
        haptic([30, 60, 30]);
      }
    } else {
      setPhase('work');
      if (!silent) {
        playAlarm('break');
        haptic(30);
      }
    }
    if (timer.running) startTicking();
    else stopTicking();
    saveTimer();
    saveData();
    render();
  }

  function tick() {
    if (!timer.running) return;
    if (Date.now() >= timer.endTime) {
      finishPhase(false);
      return;
    }
    renderTimer();
  }

  function formatClock(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  var lastTimerText = '';
  function renderTimer() {
    var rem = remaining();
    var clock = formatClock(rem);
    var active = timer.running || rem !== timer.total;
    var label = active ? clock : 'Fokus';
    if (el.focusTabLabel.textContent !== label) el.focusTabLabel.textContent = label;
    el.focusTab.classList.toggle('is-running', timer.running);
    el.focusTab.setAttribute('aria-label', active
      ? 'Fokus, ' + (timer.phase === 'work' ? 'fokuspass' : 'paus') + ' ' + clock + (timer.running ? '' : ' (pausad)')
      : 'Fokus');
    document.title = timer.running ? clock + ' · ' + (timer.phase === 'work' ? 'Fokus' : 'Paus') : 'Pomodoro';

    if (ui.view !== 'focus') return;
    var stateKey = clock + timer.phase + timer.running;
    if (stateKey === lastTimerText) return;
    lastTimerText = stateKey;

    var isBreak = timer.phase === 'break';
    el.timerTime.textContent = clock;
    el.timerPhase.textContent = isBreak ? 'Paus' : 'Fokus';
    el.timer.classList.toggle('is-break', isBreak);
    el.ring.style.strokeDashoffset = String(100 * (1 - rem / timer.total));
    if (timer.running) {
      var end = new Date(timer.endTime);
      el.timerSub.textContent = (isBreak ? 'Paus till ' : 'Klar ') +
        (end.getHours() < 10 ? '0' : '') + end.getHours() + ':' + (end.getMinutes() < 10 ? '0' : '') + end.getMinutes();
    } else if (rem !== timer.total) {
      el.timerSub.textContent = 'Pausad';
    } else {
      el.timerSub.textContent = isBreak ? settings.breakMin + ' min paus' : settings.workMin + ' min fokus';
    }
    // SVG-element saknar .hidden-egenskapen, så attributet sätts direkt
    el.togglePlay.toggleAttribute('hidden', timer.running);
    el.togglePause.toggleAttribute('hidden', !timer.running);
    el.timerToggle.setAttribute('aria-label', timer.running ? 'Pausa' : (rem !== timer.total ? 'Fortsätt' : 'Starta'));
    el.timerSkip.hidden = !isBreak;
  }

  // ========================================
  // Rendering
  // ========================================
  function sessionCounts() {
    var counts = {};
    state.sessions.forEach(function (s) {
      if (s.taskId) counts[s.taskId] = (counts[s.taskId] || 0) + 1;
    });
    return counts;
  }

  function urgencyPill(p, st, t) {
    var label = st.daysLeft < 0 ? 'passerad' : C.formatRelative(p.deadline, t);
    return '<span class="pill is-' + st.urgency + '">' + esc(label) + '</span>';
  }

  function taskRow(task, opts) {
    var t = opts.today;
    var p = projectById(task.projectId);
    var color = p ? p.color : C.NO_PROJECT_COLOR;
    var meta = [];
    if (opts.showDate && task.date) {
      var late = !task.done && task.date < t;
      meta.push('<span class="' + (late ? 'meta-late' : '') + '">' + esc(C.formatShort(task.date, t)) + '</span>');
    }
    if (task.time) meta.push('<span class="meta-time">' + esc(task.time) + '</span>');
    if (opts.showProject) {
      meta.push('<span><i class="dot" style="--c:' + esc(color) + '"></i>' + esc(p ? p.name : C.NO_PROJECT_NAME) + '</span>');
    }
    if (opts.deadline && task.date && task.date > opts.deadline && !task.done) {
      meta.push('<span class="meta-warn">' + icon('alert') + 'efter deadline</span>');
    }
    if (task.recurring) meta.push('<span>' + icon('repeat') + esc(C.RECURRING[task.recurring]) + '</span>');
    if (task.notes) meta.push('<span title="Har anteckningar">' + icon('note') + '<span class="visually-hidden">anteckning</span></span>');
    var n = opts.counts[task.id];
    if (n) meta.push('<span title="Fokuspass">' + icon('timer') + n + '</span>');

    var id = esc(task.id);
    return '<li class="row' + (task.done ? ' is-done' : '') + '">' +
      '<button type="button" class="check" style="--c:' + esc(color) + '" data-action="toggle-task" data-id="' + id +
      '" aria-pressed="' + task.done + '" aria-label="Klar: ' + esc(task.name) + '">' +
      '<span class="check-ring">' + icon('check') + '</span></button>' +
      '<button type="button" class="row-main" data-action="open-task" data-id="' + id + '">' +
      '<span class="row-title">' + esc(task.name) + '</span>' +
      (meta.length ? '<span class="row-meta">' + meta.join('') + '</span>' : '') +
      '</button>' +
      (task.done ? '' : '<button type="button" class="icon-btn row-play" data-action="play-task" data-id="' + id +
        '" aria-label="Fokusera på ' + esc(task.name) + '">' + icon('play') + '</button>') +
      '</li>';
  }

  function deadlineRow(item, sec, t) {
    var p = item.project;
    var st = C.projectStats(p, state.tasks, t);
    var meta = [];
    if (sec.multiDay) meta.push('<span>' + esc(C.formatShort(item.date, t)) + '</span>');
    meta.push('<span>' + esc(st.daysLeft < 0 ? 'passerad ' + C.formatRelative(p.deadline, t) : C.formatRelative(p.deadline, t)) + '</span>');
    meta.push('<span>' + (st.total ? st.done + ' av ' + st.total + ' klara' : 'inga uppgifter') + '</span>');
    return '<li class="row row-deadline" style="--c:' + esc(p.color) + '">' +
      '<span class="flag">' + icon('flag') + '</span>' +
      '<button type="button" class="row-main" data-action="goto-project" data-id="' + esc(p.id) + '">' +
      '<span class="row-title">Deadline: <b>' + esc(p.name) + '</b></span>' +
      '<span class="row-meta">' + meta.join('') + '</span></button></li>';
  }

  function sectionHtml(sec, t, counts, agendaCounts) {
    var addDate = null;
    if (sec.key === 'today') addDate = t;
    else if (sec.key === 'tomorrow' || sec.key.indexOf('day:') === 0) addDate = sec.date;
    var head = '<div class="sec-head"><h2 class="sec-title">' + esc(sec.title) + '</h2>' +
      (sec.subtitle ? '<span class="sec-sub">' + esc(sec.subtitle) + '</span>' : '') +
      (addDate ? '<button type="button" class="icon-btn sec-add" data-action="add-task" data-date="' + addDate +
        '" aria-label="Lägg till uppgift ' + esc(sec.key === 'today' ? 'idag' : sec.title.toLowerCase()) + '">' +
        icon('plus') + '</button>' : '') +
      '</div>';
    var rows = sec.items.map(function (item) {
      if (item.kind === 'deadline') return deadlineRow(item, sec, t);
      return taskRow(item.task, { today: t, showDate: sec.multiDay, showProject: true, counts: counts });
    }).join('');
    if (sec.key === 'today') {
      if (!sec.items.length) {
        rows = '<li class="row-empty">Inget planerat idag. Tryck på + för att lägga till något.</li>';
      } else if (agendaCounts.todayOpen === 0 && agendaCounts.todayDone > 0) {
        rows = '<li class="row-empty is-celebrate">Allt klart för idag – snyggt jobbat!</li>' + rows;
      }
    }
    return '<section class="agenda-sec' + (sec.key === 'overdue' ? ' is-overdue' : '') + '">' + head +
      '<ul class="rows">' + rows + '</ul></section>';
  }

  function deadlinesHtml(t) {
    var list = C.sortProjects(state.projects.filter(function (p) { return !p.archived && p.deadline; }));
    var html = '<div class="panel-head"><h2 class="panel-title">Deadlines</h2>' +
      '<button type="button" class="link-btn" data-action="nav" data-view="projects">Alla projekt</button></div>';
    if (!list.length) {
      return html + '<div class="dl-list"><div class="dl-empty">Inga deadlines ännu. Ge ett projekt en deadline så syns den här och i tidslinjen.' +
        '<button type="button" class="link-btn" data-action="add-project">+ Nytt projekt</button></div></div>';
    }
    return html + '<div class="dl-list">' + list.map(function (p) {
      var st = C.projectStats(p, state.tasks, t);
      var pct = st.total ? Math.round(st.done / st.total * 100) : 0;
      return '<button type="button" class="dl-card" style="--c:' + esc(p.color) + '" data-action="goto-project" data-id="' + esc(p.id) + '">' +
        '<span class="dl-top"><span class="dl-name">' + esc(p.name) + '</span>' + urgencyPill(p, st, t) + '</span>' +
        '<span class="dl-sub"><span>' + esc(C.formatShort(p.deadline, t)) + '</span><span>' +
        (st.total ? st.done + ' av ' + st.total + ' klara' : 'inga uppgifter än') + '</span></span>' +
        '<span class="progress" aria-hidden="true"><span style="width:' + pct + '%"></span></span>' +
        '</button>';
    }).join('') + '</div>';
  }

  function renderOverview(t) {
    var agenda = C.buildAgenda(state, t);
    var counts = sessionCounts();
    var html = '<div class="overview">';
    html += '<aside class="overview-side" aria-label="Deadlines">' + deadlinesHtml(t) + '</aside>';
    html += '<div class="overview-main">';
    agenda.sections.forEach(function (sec) {
      html += sectionHtml(sec, t, counts, agenda.counts);
    });
    if (agenda.someday.length) {
      var open = ui.showSomeday;
      html += '<section class="agenda-sec"><button type="button" class="sec-toggle" data-action="toggle-someday" aria-expanded="' + open + '">' +
        '<span class="sec-title">Utan datum</span><span class="sec-count">' + agenda.someday.length + '</span>' +
        icon('chevron', 'chev') + '</button>';
      if (open) {
        html += '<ul class="rows">' + agenda.someday.map(function (task) {
          return taskRow(task, { today: t, showProject: true, counts: counts });
        }).join('') + '</ul>';
      }
      html += '</section>';
    }
    html += '</div></div>';
    el.overview.innerHTML = html;
    return agenda;
  }

  function projectCard(p, t, counts, loose) {
    var st = C.projectStats(p, state.tasks, t);
    var key = loose ? '__none__' : p.id;
    var open = !!ui.expanded[key];
    var pct = st.total ? Math.round(st.done / st.total * 100) : 0;
    var deadline = p.deadline
      ? '<span>Deadline ' + esc(C.formatShort(p.deadline, t)) + '</span>' + urgencyPill(p, st, t)
      : '<span>' + (loose ? 'Uppgifter utan projekt' : 'Ingen deadline') + '</span>';
    var flags = [];
    if (st.overdue) flags.push('<span class="meta-late">' + icon('alert') + st.overdue + ' ' + (st.overdue === 1 ? 'försenad' : 'försenade') + '</span>');
    if (st.afterDeadline) flags.push('<span class="meta-warn">' + icon('alert') + st.afterDeadline + ' ' + (st.afterDeadline === 1 ? 'planerad' : 'planerade') + ' efter deadline</span>');
    if (st.undated && p.deadline) flags.push('<span class="muted">' + st.undated + ' utan datum</span>');
    var next = !open && st.next
      ? '<span class="proj-next">Nästa: <b>' + esc(st.next.name) + '</b>' + (st.next.date ? ' · ' + esc(C.formatShort(st.next.date, t)) : '') + '</span>'
      : '';

    var html = '<article class="proj-card' + (p.archived ? ' is-archived' : '') + '" id="proj-' + esc(key) + '" style="--c:' + esc(p.color) + '">' +
      '<div class="proj-top">' +
      '<button type="button" class="proj-head" data-action="toggle-project" data-id="' + esc(key) + '" aria-expanded="' + open + '">' +
      '<span class="dot"></span><span class="proj-name">' + esc(p.name) + '</span>' + icon('chevron', 'chev') +
      '<span class="proj-info"><span class="proj-deadline">' + deadline + '</span>' +
      '<span class="proj-progress"><span class="progress" aria-hidden="true"><span style="width:' + pct + '%"></span></span>' +
      '<span>' + (st.total ? st.done + ' av ' + st.total + ' klara' : 'Inga uppgifter än') + '</span></span>' +
      (flags.length ? '<span class="proj-flags">' + flags.join('') + '</span>' : '') + next +
      '</span></button>' +
      (loose ? '' : '<button type="button" class="icon-btn proj-edit" data-action="edit-project" data-id="' + esc(p.id) +
        '" aria-label="Redigera ' + esc(p.name) + '">' + icon('edit') + '</button>') +
      '</div>';

    if (open) {
      var own = state.tasks.filter(function (x) { return x.projectId === p.id; });
      var openTasks = own.filter(function (x) { return !x.done; }).sort(C.compareTasks);
      var doneTasks = own.filter(function (x) { return x.done; }).sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
      var showDone = !!ui.showDone[key];
      var rowOpts = { today: t, showDate: true, counts: counts, deadline: p.deadline };
      html += '<div class="proj-body">' +
        (p.notes ? '<p class="proj-notes">' + esc(p.notes) + '</p>' : '') +
        (openTasks.length
          ? '<ul class="rows">' + openTasks.map(function (x) { return taskRow(x, rowOpts); }).join('') + '</ul>'
          : '<p class="row-empty">' + (doneTasks.length ? 'Allt är klart här!' : 'Inga uppgifter än.') + '</p>') +
        (showDone && doneTasks.length
          ? '<ul class="rows rows-done">' + doneTasks.map(function (x) { return taskRow(x, rowOpts); }).join('') + '</ul>'
          : '') +
        '<div class="proj-foot">' +
        '<button type="button" class="btn btn-soft" data-action="add-task" data-project="' + esc(loose ? '' : p.id) + '">' +
        icon('plus') + 'Lägg till uppgift</button>' +
        (doneTasks.length ? '<button type="button" class="btn btn-soft" data-action="toggle-done" data-id="' + esc(key) + '">' +
          (showDone ? 'Dölj klara' : 'Visa klara (' + doneTasks.length + ')') + '</button>' : '') +
        '</div></div>';
    }
    return html + '</article>';
  }

  function renderProjects(t) {
    var counts = sessionCounts();
    var active = C.sortProjects(state.projects.filter(function (p) { return !p.archived; }));
    var archived = state.projects.filter(function (p) { return p.archived; });
    var loose = state.tasks.some(function (x) { return !x.projectId; });
    var html = '<div class="proj-wrap">';
    if (!active.length && !loose && !archived.length) {
      html += '<div class="card empty-state"><h2>Inga projekt ännu</h2>' +
        '<p>Skapa ett projekt för det du måste bli klar med – en kurs, en rapport, en flytt – och sätt en deadline.</p>' +
        '<button type="button" class="btn btn-primary" data-action="add-project">' + icon('plus') + 'Nytt projekt</button></div>';
    } else {
      html += '<div class="proj-list">';
      active.forEach(function (p) { html += projectCard(p, t, counts, false); });
      if (loose) {
        html += projectCard({ id: null, name: C.NO_PROJECT_NAME, color: C.NO_PROJECT_COLOR, deadline: null, notes: '', archived: false }, t, counts, true);
      }
      if (!active.length) {
        html += '<div class="card empty-state"><p>Inga aktiva projekt.</p><button type="button" class="btn btn-primary" data-action="add-project">' +
          icon('plus') + 'Nytt projekt</button></div>';
      }
      html += '</div>';
      if (archived.length) {
        html += '<section class="archived-toggle"><button type="button" class="sec-toggle" data-action="toggle-archived" aria-expanded="' + ui.showArchived + '">' +
          '<span class="sec-title">Avslutade projekt</span><span class="sec-count">' + archived.length + '</span>' + icon('chevron', 'chev') + '</button>';
        if (ui.showArchived) {
          html += '<div class="proj-list">' + archived.map(function (p) { return projectCard(p, t, counts, false); }).join('') + '</div>';
        }
        html += '</section>';
      }
    }
    el.projects.innerHTML = html + '</div>';
  }

  function renderFocus() {
    lastTimerText = '';
    var t = today();
    var task = focusTask();
    var p = task ? projectById(task.projectId) : null;
    var label = timer.running && timer.phase === 'work' ? 'Jobbar med' : 'Fokusera på';
    var name = task ? task.name : (timer.taskId === '' ? 'Inget specifikt' : 'Välj uppgift');
    el.focusTask.innerHTML = (task ? '<i class="dot" style="--c:' + esc(p ? p.color : C.NO_PROJECT_COLOR) + '"></i>' : '') +
      '<span class="focus-task-text"><span class="focus-task-label">' + label + '</span>' +
      '<span class="focus-task-name">' + esc(name) + '</span></span>' + icon('chevron', 'chev');
    el.focusTask.setAttribute('aria-label', label + ': ' + name + '. Byt uppgift');

    var finished = timer.phase === 'break' && timer.finishedTaskId ? taskById(timer.finishedTaskId) : null;
    if (timer.phase === 'break') {
      var fh = '<p>Pass klart – dags för paus!</p>';
      if (finished && !finished.done) {
        fh += '<div class="field-row"><button type="button" class="btn btn-primary" data-action="finish-task" data-id="' + esc(finished.id) + '">' +
          icon('check') + 'Markera klar</button>' +
          '<button type="button" class="btn btn-soft" data-action="finish-dismiss">Inte klar än</button></div>';
      }
      el.focusFinished.innerHTML = fh;
      el.focusFinished.hidden = false;
    } else {
      el.focusFinished.hidden = true;
    }

    renderFocusStats(t);
    renderTimer();
  }

  function renderFocusStats(t) {
    var fs = C.focusStats(state, t, 7);
    var html = '<div class="tiles">' +
      '<div class="tile"><div class="tile-label">Idag</div><div class="tile-value">' + fs.todayCount + '</div><div class="tile-note">pass · ' +
      C.formatMinutes(fs.todayMinutes) + '</div></div>' +
      '<div class="tile"><div class="tile-label">Veckan</div><div class="tile-value">' + C.formatHours(fs.weekMinutes) + '</div><div class="tile-note">vecka ' + C.isoWeek(t) + '</div></div>' +
      '<div class="tile"><div class="tile-label">I rad</div><div class="tile-value">' + fs.streak + '</div><div class="tile-note">' +
      (fs.streak === 1 ? 'dag' : 'dagar') + '</div></div>' +
      '</div>';

    var max = Math.max.apply(null, fs.byDay.map(function (d) { return d.minutes; }));
    // Direktetikett bara på idag och den första toppen – resten via tooltip
    var peakDate = null;
    fs.byDay.forEach(function (d) { if (max && d.minutes === max && !peakDate) peakDate = d.date; });
    var total7 = fs.byDay.reduce(function (s, d) { return s + d.minutes; }, 0);
    html += '<div class="chart-card"><h2 class="chart-title">Fokustid senaste 7 dagarna</h2>' +
      '<p class="chart-sub">' + (total7 ? 'Totalt ' + C.formatMinutes(total7) : 'Inga pass ännu – starta ett pass så syns det här.') + '</p>';
    html += '<div class="cols" role="list">';
    fs.byDay.forEach(function (d) {
      var h = max ? Math.round(d.minutes / max * 100) : 0;
      var isToday = d.date === t;
      var label = C.capitalize(C.formatShort(d.date, t)) + ': ' + (d.minutes ? C.formatMinutes(d.minutes) : 'inget');
      var showValue = d.minutes && (isToday || d.date === peakDate);
      html += '<div class="col' + (isToday ? ' is-today' : '') + '" role="listitem" tabindex="0" aria-label="' + esc(label) + '">' +
        '<span class="col-tip" aria-hidden="true">' + esc(label) + '</span>' +
        (showValue ? '<span class="col-value" aria-hidden="true">' + esc(C.formatHours(d.minutes)) + '</span>' : '') +
        '<span class="col-bar" style="height:' + h + '%"></span></div>';
    });
    html += '</div><div class="col-labels" aria-hidden="true">' + fs.byDay.map(function (d) {
      return '<span' + (d.date === t ? ' class="is-today"' : '') + '>' + (d.date === t ? 'idag' : C.WEEKDAYS_SHORT[C.weekdayOf(d.date)]) + '</span>';
    }).join('') + '</div></div>';

    html += '<div class="chart-card"><h2 class="chart-title">Per projekt den här veckan</h2>';
    if (!fs.week.length) {
      html += '<p class="chart-empty">Inga fokuspass den här veckan ännu.</p>';
    } else {
      var wmax = fs.week[0].minutes;
      html += '<p class="chart-sub">Vecka ' + C.isoWeek(t) + '</p><div class="hbars">' + fs.week.map(function (w) {
        return '<div class="hbar-row"><span class="hbar-name"><i class="dot" style="--c:' + esc(w.color) + '"></i><span>' + esc(w.name) + '</span></span>' +
          '<span class="hbar-value">' + esc(C.formatMinutes(w.minutes)) + '</span>' +
          '<span class="hbar-track" aria-hidden="true"><span class="hbar" style="--c:' + esc(w.color) + ';width:' + Math.max(2, Math.round(w.minutes / wmax * 100)) + '%"></span></span></div>';
      }).join('') + '</div>';
    }
    html += '</div>';
    el.focusStats.innerHTML = html;
  }

  function renderHeader(t, agenda) {
    var kicker, title, sub;
    if (ui.view === 'overview') {
      var d = C.parseDate(t);
      kicker = 'Vecka ' + C.isoWeek(t);
      title = C.capitalize(C.WEEKDAYS[d.getDay()]) + ' ' + d.getDate() + ' ' + C.MONTHS[d.getMonth()];
      var bits = [];
      var c = agenda.counts;
      if (c.todayOpen) bits.push(c.todayOpen + ' kvar idag');
      else if (c.todayDone) bits.push('Allt klart idag');
      else bits.push('Inget planerat idag');
      if (c.overdue) bits.push(c.overdue + ' ' + (c.overdue === 1 ? 'försenad' : 'försenade'));
      sub = bits.join(' · ');
    } else if (ui.view === 'projects') {
      var active = C.sortProjects(state.projects.filter(function (p) { return !p.archived; }));
      var next = active.filter(function (p) { return p.deadline && p.deadline >= t; })[0];
      kicker = plural(active.length, 'aktivt', 'aktiva');
      title = 'Projekt';
      sub = next ? 'Nästa deadline: ' + next.name + ' ' + C.formatRelative(next.deadline, t)
        : 'Sätt en deadline på det som måste bli klart.';
    } else {
      kicker = 'Pomodoro';
      title = 'Fokus';
      sub = settings.workMin + ' min fokus · ' + settings.breakMin + ' min paus';
    }
    el.kicker.textContent = kicker;
    el.title.textContent = title;
    el.subtitle.textContent = sub;
  }

  var lastRenderDay = null;

  function render() {
    var t = today();
    lastRenderDay = t;

    // Behåll tangentbordsfokus på samma knapp efter omritning
    var active = document.activeElement;
    var focusKey = null;
    if (active && el.main.contains(active) && active.dataset && active.dataset.action) {
      focusKey = { action: active.dataset.action, id: active.dataset.id };
    }

    var agenda = null;
    if (ui.view === 'overview') agenda = renderOverview(t);
    else if (ui.view === 'projects') renderProjects(t);
    else renderFocus();
    renderHeader(t, agenda);
    renderTimer();

    if (focusKey) {
      var candidates = el.main.querySelectorAll('[data-action="' + focusKey.action + '"]');
      for (var i = 0; i < candidates.length; i++) {
        if (candidates[i].dataset.id === focusKey.id) {
          candidates[i].focus({ preventScroll: true });
          break;
        }
      }
    }
  }

  function setView(view) {
    if (['overview', 'projects', 'focus'].indexOf(view) === -1) view = 'overview';
    var changed = ui.view !== view;
    ui.view = view;
    el.overview.hidden = view !== 'overview';
    el.projects.hidden = view !== 'projects';
    el.focus.hidden = view !== 'focus';
    Array.prototype.forEach.call(el.tabs, function (tab) {
      if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    el.fab.hidden = view === 'focus';
    el.fab.setAttribute('aria-label', view === 'projects' ? 'Nytt projekt' : 'Lägg till uppgift');
    render();
    if (changed) window.scrollTo(0, 0);
  }

  // ========================================
  // Klick (en lyssnare för hela appen)
  // ========================================
  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var action = target.dataset.action;
    var id = target.dataset.id;
    switch (action) {
      case 'nav':
        closeDialog(settingsSheet);
        setView(target.dataset.view);
        break;
      case 'fab':
        if (ui.view === 'projects') openProjectSheet(null);
        else openTaskSheet({ date: today() });
        break;
      case 'add-task':
        if (target.dataset.project !== undefined) openTaskSheet({ projectId: target.dataset.project || null, date: '' });
        else openTaskSheet({ date: target.dataset.date || '' });
        break;
      case 'open-task':
        openTaskSheet({ id: id });
        break;
      case 'toggle-task':
        toggleTask(id);
        break;
      case 'play-task':
        playTask(id);
        break;
      case 'add-project':
        openProjectSheet(null);
        break;
      case 'edit-project':
        openProjectSheet(id);
        break;
      case 'toggle-project':
        ui.expanded[id] = !ui.expanded[id];
        if (!ui.expanded[id]) delete ui.expanded[id];
        saveUi();
        render();
        break;
      case 'toggle-done':
        ui.showDone[id] = !ui.showDone[id];
        render();
        break;
      case 'toggle-archived':
        ui.showArchived = !ui.showArchived;
        render();
        break;
      case 'toggle-someday':
        ui.showSomeday = !ui.showSomeday;
        saveUi();
        render();
        break;
      case 'goto-project':
        ui.expanded[id] = true;
        saveUi();
        setView('projects');
        flashProject(id);
        break;
      case 'share':
        openShare();
        break;
      case 'open-import':
        openImport();
        break;
      case 'settings':
        openSettings();
        break;
      case 'pick-focus':
        openPick();
        break;
      case 'pick':
        timer.taskId = id || '';
        saveTimer();
        closeDialog(pickSheet);
        renderFocus();
        break;
      case 'timer-toggle':
        if (timer.running) pauseTimer();
        else startTimer();
        break;
      case 'timer-reset':
        resetTimer();
        break;
      case 'timer-skip':
        skipBreak();
        break;
      case 'finish-task':
        timer.finishedTaskId = null;
        saveTimer();
        toggleTask(id);
        break;
      case 'finish-dismiss':
        timer.finishedTaskId = null;
        saveTimer();
        renderFocus();
        break;
    }
  });

  // Snabbkommando på dator: N = ny uppgift
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'n' && e.key !== 'N') return;
    if (e.metaKey || e.ctrlKey || e.altKey || anyDialogOpen()) return;
    var tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
    e.preventDefault();
    if (ui.view === 'projects') openProjectSheet(null);
    else openTaskSheet({ date: today() });
  });

  // ========================================
  // Välj fokusuppgift
  // ========================================
  var pickSheet = $('pick-sheet');

  function openPick() {
    var t = today();
    var agenda = C.buildAgenda(state, t);
    var current = focusTask();
    var groups = [];
    var soon = [];
    agenda.sections.forEach(function (sec) {
      var tasks = sec.items.filter(function (i) { return i.kind === 'task' && !i.done; }).map(function (i) { return i.task; });
      if (!tasks.length) return;
      if (sec.key === 'overdue' || sec.key === 'today' || sec.key === 'tomorrow') groups.push({ title: sec.title, tasks: tasks });
      else soon = soon.concat(tasks);
    });
    if (soon.length) groups.push({ title: 'Kommande', tasks: soon.slice(0, 15) });
    if (agenda.someday.length) groups.push({ title: 'Utan datum', tasks: agenda.someday });

    var html = '<div class="pick-group"><button type="button" class="pick-btn" data-action="pick" data-id=""' +
      (timer.taskId === '' ? ' aria-current="true"' : '') + '><span class="row-title">Inget specifikt</span></button></div>';
    groups.forEach(function (g) {
      html += '<div class="pick-group"><h3>' + esc(g.title) + '</h3>' + g.tasks.map(function (task) {
        var p = projectById(task.projectId);
        return '<button type="button" class="pick-btn" data-action="pick" data-id="' + esc(task.id) + '"' +
          (current && current.id === task.id ? ' aria-current="true"' : '') + '>' +
          '<i class="dot" style="--c:' + esc(p ? p.color : C.NO_PROJECT_COLOR) + '"></i>' +
          '<span><span class="row-title">' + esc(task.name) + '</span><span class="row-meta">' +
          esc((p ? p.name : C.NO_PROJECT_NAME) + (task.date && g.title !== 'Idag' ? ' · ' + C.formatShort(task.date, t) : '')) +
          '</span></span></button>';
      }).join('') + '</div>';
    });
    if (!groups.length) {
      html += '<p class="muted">Inga öppna uppgifter. Lägg till något i översikten så kan du välja det här.</p>';
    }
    $('pick-list').innerHTML = html;
    openDialog(pickSheet);
  }

  // ========================================
  // Konfetti
  // ========================================
  var confetti = $('confetti');
  var confettiRunning = false;

  function launchConfetti() {
    if (confettiRunning) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var ctx = confetti.getContext && confetti.getContext('2d');
    if (!ctx) return;
    confettiRunning = true;
    confetti.width = window.innerWidth;
    confetti.height = window.innerHeight;
    var parts = [];
    for (var i = 0; i < 90; i++) {
      parts.push({
        x: Math.random() * confetti.width,
        y: -20 - Math.random() * 200,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 4,
        color: C.PROJECT_COLORS[i % C.PROJECT_COLORS.length],
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.2,
        life: 1
      });
    }
    haptic(40);
    function frame() {
      ctx.clearRect(0, 0, confetti.width, confetti.height);
      var alive = false;
      parts.forEach(function (p) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1;
        p.rot += p.rotV;
        p.life -= 0.006;
        if (p.life <= 0 || p.y > confetti.height + 20) return;
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (alive) requestAnimationFrame(frame);
      else {
        confettiRunning = false;
        ctx.clearRect(0, 0, confetti.width, confetti.height);
      }
    }
    requestAnimationFrame(frame);
  }

  // ========================================
  // Synk mellan flikar, nytt dygn och återkomst
  // ========================================
  window.addEventListener('storage', function (e) {
    if (e.key === KEY.projects || e.key === KEY.tasks || e.key === KEY.sessions) {
      state = C.normalizeData({
        projects: read(KEY.projects, []),
        tasks: read(KEY.tasks, []),
        sessions: read(KEY.sessions, [])
      });
      render();
    } else if (e.key === KEY.timer) {
      timer = loadTimer();
      if (timer.running) startTicking();
      else stopTicking();
      render();
    } else if (e.key === KEY.settings) {
      settings = loadSettings();
      applyTheme();
      render();
    }
  });

  function onWake() {
    if (timer.running) tick();
    if (today() !== lastRenderDay) render();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) onWake();
  });
  window.addEventListener('focus', onWake);
  setInterval(function () {
    if (today() !== lastRenderDay && !anyDialogOpen()) render();
  }, 30000);

  // ========================================
  // Start
  // ========================================
  applyTheme();

  // Ett pass som tog slut medan appen var stängd loggas tyst
  var finishedWhileAway = false;
  for (var guard = 0; guard < 3 && timer.running && Date.now() >= timer.endTime; guard++) {
    if (timer.phase === 'work') finishedWhileAway = true;
    finishPhase(true);
  }

  setView(timer.running ? 'focus' : 'overview');
  if (timer.running) startTicking();
  if (finishedWhileAway) toast('Ett fokuspass blev klart medan appen var stängd och är sparat.');
})();
