(function () {
  'use strict';

  // --- Constants ---
  var WORK_MINUTES = 25;
  var BREAK_MINUTES = 5;
  var WORK_SECONDS = WORK_MINUTES * 60;
  var BREAK_SECONDS = BREAK_MINUTES * 60;

  var PROJECT_COLORS = [
    '#e94560', '#53a8b6', '#f0a500', '#a855f7',
    '#34d399', '#f472b6', '#60a5fa', '#fb923c'
  ];

  // --- Timer Worker (immune to background-tab throttling) ---
  var timerWorker = null;
  try {
    var workerCode = 'var id=null;self.onmessage=function(e){if(e.data==="start"){if(id)clearInterval(id);id=setInterval(function(){self.postMessage("t")},250)}else if(e.data==="stop"){if(id){clearInterval(id);id=null}}};';
    var blob = new Blob([workerCode], { type: 'application/javascript' });
    timerWorker = new Worker(URL.createObjectURL(blob));
  } catch (e) {
    timerWorker = null; // fallback to setInterval if Workers unavailable
  }

  // --- State ---
  var timeLeft = WORK_SECONDS;
  var endTime = null; // wall-clock timestamp (ms) when timer expires
  var isRunning = false;
  var isBreak = false;
  var intervalId = null;
  var todayPomodoros = 0;
  var activeScheduleIndex = -1; // which schedule item is active in timer
  var addTaskToProjectId = null; // which project we're adding a task to
  var scheduleViewDate = null; // null = today, otherwise a date string for history

  // --- DOM Elements ---
  var timerDisplay = document.getElementById('timer-display');
  var sessionLabel = document.getElementById('session-label');
  var btnStart = document.getElementById('btn-start');
  var btnPause = document.getElementById('btn-pause');
  var btnReset = document.getElementById('btn-reset');
  var pomodoroCount = document.getElementById('pomodoro-count');
  var currentTaskBanner = document.getElementById('current-task-banner');
  var timerSchedule = document.getElementById('timer-schedule');
  var logModal = document.getElementById('log-modal');
  var activityInput = document.getElementById('activity-input');
  var activitySuggestions = document.getElementById('activity-suggestions');
  var btnSaveActivity = document.getElementById('btn-save-activity');
  var navBtns = document.querySelectorAll('.nav-btn');
  var views = document.querySelectorAll('.view');
  var statsTabs = document.querySelectorAll('.stats-tab');
  var statsPrev = document.getElementById('stats-prev');
  var statsNext = document.getElementById('stats-next');
  var statsPeriodLabel = document.getElementById('stats-period-label');
  var statsSummary = document.getElementById('stats-summary');
  var statsBreakdown = document.getElementById('stats-breakdown');

  // Plan view elements
  var btnAddProject = document.getElementById('btn-add-project');
  var projectsList = document.getElementById('projects-list');
  var btnAddToSchedule = document.getElementById('btn-add-to-schedule');
  var scheduleList = document.getElementById('schedule-list');
  var scheduleEmpty = document.getElementById('schedule-empty');
  var scheduleHeading = document.getElementById('schedule-heading');
  var scheduleDateNav = document.getElementById('schedule-date-nav');
  var schedulePrev = document.getElementById('schedule-prev');
  var scheduleNext = document.getElementById('schedule-next');
  var scheduleDateLabel = document.getElementById('schedule-date-label');
  var carryoverBanner = document.getElementById('carryover-banner');
  var carryoverMessage = document.getElementById('carryover-message');
  var btnCarryover = document.getElementById('btn-carryover');
  var btnCarryoverDismiss = document.getElementById('btn-carryover-dismiss');

  // Modals
  var scheduleModal = document.getElementById('schedule-modal');
  var schedulePicker = document.getElementById('schedule-picker');
  var btnClosePicker = document.getElementById('btn-close-picker');
  var projectModal = document.getElementById('project-modal');
  var projectNameInput = document.getElementById('project-name-input');
  var btnSaveProject = document.getElementById('btn-save-project');
  var taskModal = document.getElementById('task-modal');
  var taskNameInput = document.getElementById('task-name-input');
  var btnSaveTask = document.getElementById('btn-save-task');

  // ========================================
  // Storage helpers
  // ========================================
  function getSessions() {
    return JSON.parse(localStorage.getItem('pomodoro_sessions') || '[]');
  }

  function saveSessions(sessions) {
    localStorage.setItem('pomodoro_sessions', JSON.stringify(sessions));
  }

  function getProjects() {
    return JSON.parse(localStorage.getItem('pomodoro_projects') || '[]');
  }

  function saveProjects(projects) {
    localStorage.setItem('pomodoro_projects', JSON.stringify(projects));
  }

  function getTasks() {
    return JSON.parse(localStorage.getItem('pomodoro_tasks') || '[]');
  }

  function saveTasks(tasks) {
    localStorage.setItem('pomodoro_tasks', JSON.stringify(tasks));
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function getScheduleHistory() {
    return JSON.parse(localStorage.getItem('pomodoro_schedule_history') || '{}');
  }

  function saveScheduleHistory(history) {
    localStorage.setItem('pomodoro_schedule_history', JSON.stringify(history));
  }

  function archiveSchedule(data) {
    if (!data || !data.date || !data.items || data.items.length === 0) return;
    var history = getScheduleHistory();
    history[data.date] = data.items;
    saveScheduleHistory(history);
  }

  // Migrate old format {taskId, pomodoros, completed} → new {taskId, done}
  function migrateScheduleItems(items) {
    if (!items || items.length === 0) return items;
    if (typeof items[0].done !== 'undefined') return items;
    var newItems = [];
    for (var i = 0; i < items.length; i++) {
      var poms = items[i].pomodoros || 1;
      var completed = items[i].completed || 0;
      for (var j = 0; j < poms; j++) {
        newItems.push({ taskId: items[i].taskId, done: j < completed });
      }
    }
    return newItems;
  }

  // Group flat items by taskId for plan view display
  // Empty slots (taskId === null) are kept as individual entries
  function groupScheduleItems(items) {
    var groups = [];
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var tid = items[i].taskId;
      if (!tid) {
        groups.push({ taskId: null, total: 1, completed: 0, flatIdx: i });
        continue;
      }
      if (!seen[tid]) {
        seen[tid] = { taskId: tid, total: 0, completed: 0 };
        groups.push(seen[tid]);
      }
      seen[tid].total++;
      if (items[i].done) seen[tid].completed++;
    }
    return groups;
  }

  function getSchedule() {
    var data = JSON.parse(localStorage.getItem('pomodoro_schedule') || '{}');
    if (data.date !== todayStr()) {
      archiveSchedule(data);
      return { date: todayStr(), items: [] };
    }
    data.items = migrateScheduleItems(data.items);
    return data;
  }

  function getScheduleForDate(dateStr) {
    if (dateStr === todayStr()) return getSchedule();
    var history = getScheduleHistory();
    return { date: dateStr, items: migrateScheduleItems(history[dateStr] || []) };
  }

  function saveSchedule(schedule) {
    localStorage.setItem('pomodoro_schedule', JSON.stringify(schedule));
    // Also keep history in sync for today
    if (schedule.date === todayStr() && schedule.items.length > 0) {
      var history = getScheduleHistory();
      history[schedule.date] = schedule.items;
      saveScheduleHistory(history);
    }
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getProjectColor(project) {
    if (!project) return '#8888aa';
    if (project.color) return project.color;
    return PROJECT_COLORS[0];
  }

  function nextProjectColor() {
    var projects = getProjects();
    var usedColors = projects.map(function (p) { return p.color; }).filter(Boolean);
    for (var i = 0; i < PROJECT_COLORS.length; i++) {
      if (usedColors.indexOf(PROJECT_COLORS[i]) === -1) return PROJECT_COLORS[i];
    }
    return PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
  }

  function getRecentActivities() {
    var sessions = getSessions();
    var seen = {};
    var activities = [];
    for (var i = sessions.length - 1; i >= 0; i--) {
      var name = sessions[i].activity;
      if (!seen[name]) {
        seen[name] = true;
        activities.push(name);
      }
    }
    return activities;
  }

  // ========================================
  // Timer
  // ========================================
  function formatTime(seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateDisplay() {
    timerDisplay.textContent = formatTime(timeLeft);
    document.title = formatTime(timeLeft) + (isBreak ? ' (Vila)' : ' (Arbete)');

    if (isBreak) {
      timerDisplay.classList.add('break-mode');
      sessionLabel.textContent = 'Vila';
    } else {
      timerDisplay.classList.remove('break-mode');
      sessionLabel.textContent = isRunning ? 'Arbete' : '';
    }
  }

  function updateTaskBanner() {
    var schedule = getSchedule();
    if (schedule.items.length === 0) {
      currentTaskBanner.classList.add('hidden');
      activeScheduleIndex = -1;
      renderTimerSchedule();
      return;
    }

    // Find first not-done item (skip empty slots)
    var idx = -1;
    for (var i = 0; i < schedule.items.length; i++) {
      if (!schedule.items[i].done && schedule.items[i].taskId) {
        idx = i;
        break;
      }
    }

    if (idx === -1) {
      currentTaskBanner.innerHTML = '<span class="banner-done">Alla uppgifter klara!</span>';
      currentTaskBanner.classList.remove('hidden');
      activeScheduleIndex = -1;
      renderTimerSchedule();
      return;
    }

    activeScheduleIndex = idx;
    var item = schedule.items[idx];
    var tasks = getTasks();
    var projects = getProjects();
    var task = tasks.filter(function (t) { return t.id === item.taskId; })[0];
    var project = task ? projects.filter(function (p) { return p.id === task.projectId; })[0] : null;

    var projectName = project ? project.name : (task && task.projectId === null ? 'Övrigt' : '');
    var taskName = task ? task.name : 'Okänd uppgift';
    // Compute progress for this task across all items
    var totalForTask = 0, completedForTask = 0;
    for (var j = 0; j < schedule.items.length; j++) {
      if (schedule.items[j].taskId === item.taskId) {
        totalForTask++;
        if (schedule.items[j].done) completedForTask++;
      }
    }
    var progress = completedForTask + '/' + totalForTask;
    var color = getProjectColor(project);

    currentTaskBanner.style.borderLeft = '4px solid ' + color;
    currentTaskBanner.innerHTML =
      '<span class="banner-project" style="color:' + color + '">' + escapeHtml(projectName) + '</span>' +
      '<span class="banner-task">' + escapeHtml(taskName) + '</span>' +
      '<span class="banner-progress">' + progress + '</span>';
    currentTaskBanner.classList.remove('hidden');
    renderTimerSchedule();
  }

  function renderTimerSchedule() {
    var schedule = getSchedule();
    var tasks = getTasks();
    var projects = getProjects();

    if (schedule.items.length === 0) {
      timerSchedule.innerHTML = '';
      return;
    }

    // Find current (first not-done) index
    var currentIdx = -1;
    for (var i = 0; i < schedule.items.length; i++) {
      if (!schedule.items[i].done) {
        currentIdx = i;
        break;
      }
    }

    // Compute per-slot start times
    var dayStart = getDayStartMinutes();
    var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    var nowInserted = false;
    var html = '';

    schedule.items.forEach(function (item, idx) {
      var slotStart = dayStart + idx * (WORK_MINUTES + BREAK_MINUTES);
      var slotEnd = slotStart + WORK_MINUTES;

      // Insert "now" line before this slot if current time falls here
      if (!nowInserted && nowMin < slotEnd && nowMin >= dayStart) {
        html += '<div class="timeline-now"></div>';
        nowInserted = true;
      }

      var timeLabel = formatMinutesAsTime(slotStart);

      // Empty slot
      if (!item.taskId) {
        html += '<div class="ts-item ts-empty" data-idx="' + idx + '">' +
          '<div class="ts-item-inner">' +
          '<span class="ts-time">' + timeLabel + '</span>' +
          '<span class="ts-dot-empty"></span>' +
          '<span class="ts-name ts-name-empty">Ledig</span>' +
          '<button class="ts-remove-empty btn-tiny" data-idx="' + idx + '">&times;</button>' +
          '</div>' +
          '</div>';
        return;
      }

      var task = tasks.filter(function (t) { return t.id === item.taskId; })[0];
      var project = task ? projects.filter(function (p) { return p.id === task.projectId; })[0] : null;
      var color = getProjectColor(project);
      var isPast = nowMin >= slotEnd;

      var cls = 'ts-item';
      if (item.done) cls += ' ts-done';
      else if (idx === currentIdx) cls += ' ts-current';
      else if (isPast) cls += ' ts-past';
      else cls += ' ts-upcoming';

      var indicator = item.done
        ? '<span class="ts-check">&check;</span>'
        : '<span class="ts-dot" style="background:' + color + '"></span>';

      var taskName = task ? task.name : 'Borttagen';
      var addBtn = item.done ? '<button class="ts-add-pom btn-tiny" data-idx="' + idx + '">+</button>' : '';

      // Action buttons for undone items
      var pastBtns = '';
      if (!item.done) {
        if (isPast) {
          pastBtns = '<button class="ts-mark-done btn-tiny" data-idx="' + idx + '" title="Markera klar">&check;</button>' +
            '<button class="ts-mark-remove btn-tiny" data-idx="' + idx + '" title="Ta bort">&times;</button>';
        } else {
          pastBtns = '<button class="ts-mark-remove btn-tiny" data-idx="' + idx + '" title="Ta bort">&times;</button>';
        }
      }

      html += '<div class="' + cls + '" data-idx="' + idx + '" data-task-id="' + (item.taskId || '') + '">' +
        '<div class="ts-item-bg bg-done">Klar</div>' +
        '<div class="ts-item-bg bg-remove">Ta bort</div>' +
        '<div class="ts-item-inner">' +
        '<span class="ts-time">' + timeLabel + '</span>' +
        indicator +
        '<span class="ts-name">' + escapeHtml(taskName) + '</span>' +
        pastBtns +
        addBtn +
        '</div>' +
        '</div>';
    });

    // "Now" line at end if not yet placed
    if (!nowInserted && nowMin >= dayStart) {
      html += '<div class="timeline-now"></div>';
    }

    timerSchedule.innerHTML = html;

    // + button: add another pomodoro after this one
    timerSchedule.querySelectorAll('.ts-add-pom').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        addPomodoroAfter(parseInt(btn.dataset.idx));
      });
    });

    // Past item: mark done
    timerSchedule.querySelectorAll('.ts-mark-done').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        haptic(12);
        var schedule = getSchedule();
        var i = parseInt(btn.dataset.idx);
        if (i < schedule.items.length) {
          schedule.items[i].done = true;
          saveSchedule(schedule);
          updateTaskBanner();
          checkAllDoneConfetti();
        }
      });
    });

    // Remove item: past → empty slot, upcoming/current → splice
    timerSchedule.querySelectorAll('.ts-mark-remove').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        haptic(12);
        var schedule = getSchedule();
        var i = parseInt(btn.dataset.idx);
        if (i < schedule.items.length) {
          var el = btn.closest('.ts-item');
          if (el && el.classList.contains('ts-past')) {
            schedule.items[i] = { taskId: null, done: false };
          } else {
            schedule.items.splice(i, 1);
          }
          saveSchedule(schedule);
          updateTaskBanner();
        }
      });
    });

    // Remove empty slot buttons
    timerSchedule.querySelectorAll('.ts-remove-empty').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var schedule = getSchedule();
        var i = parseInt(btn.dataset.idx);
        if (i < schedule.items.length && !schedule.items[i].taskId) {
          schedule.items.splice(i, 1);
          saveSchedule(schedule);
          updateTaskBanner();
        }
      });
    });

    // Timer schedule drag reorder + swipe gestures
    timerSchedule.querySelectorAll('.ts-item:not(.ts-empty)').forEach(function (el) {
      initTimerScheduleDrag(el);
      if (!el.classList.contains('ts-done')) {
        initTimerSwipe(el, parseInt(el.dataset.idx));
      }
    });
  }

  function addPomodoroAfter(idx) {
    var schedule = getSchedule();
    if (idx < 0 || idx >= schedule.items.length) return;
    var taskId = schedule.items[idx].taskId;
    schedule.items.splice(idx + 1, 0, { taskId: taskId, done: false });
    saveSchedule(schedule);
    updateTaskBanner();
  }

  function initTimerScheduleDrag(el) {
    var idx = parseInt(el.dataset.idx);
    var taskId = el.dataset.taskId;

    function onStart(clientX, clientY, e) {
      if (e.target.closest('.btn-tiny')) return;
      drag.active = true;
      drag.started = false;
      drag.type = 'timer-reorder';
      drag.sourceIdx = idx;
      drag.taskId = taskId;
      drag.sourceEl = el;
      drag.startX = clientX;
      drag.startY = clientY;
    }

    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      onStart(t.clientX, t.clientY, e);
    }, { passive: true });

    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      onStart(e.clientX, e.clientY, e);
    });
  }

  function countTodayPomodoros() {
    var sessions = getSessions();
    var today = todayStr();
    var count = 0;
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].date === today) count++;
    }
    todayPomodoros = count;
    updatePomodoroCount();
  }

  // --- Alarm sound (Web Audio API + <audio> fallback for background tabs) ---
  var audioCtx = null;

  function getAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  // Generate a tiny WAV file in memory for a sequence of tones
  function generateWav(tones, sampleRate) {
    sampleRate = sampleRate || 22050;
    var totalSamples = 0;
    tones.forEach(function (t) { totalSamples += Math.ceil((t.delay + t.duration) * sampleRate); });
    // Use the longest tone end as total length
    var maxEnd = 0;
    tones.forEach(function (t) { var end = t.delay + t.duration + 0.02; if (end > maxEnd) maxEnd = end; });
    var numSamples = Math.ceil(maxEnd * sampleRate);
    var samples = new Float32Array(numSamples);

    tones.forEach(function (t) {
      var startSample = Math.floor(t.delay * sampleRate);
      var durSamples = Math.ceil(t.duration * sampleRate);
      for (var i = 0; i < durSamples; i++) {
        var env = 1 - (i / durSamples); // linear fade out
        if (i < sampleRate * 0.02) env *= i / (sampleRate * 0.02); // fade in
        samples[startSample + i] += Math.sin(2 * Math.PI * t.freq * i / sampleRate) * t.volume * env;
      }
    });

    // Encode as 16-bit PCM WAV
    var buffer = new ArrayBuffer(44 + numSamples * 2);
    var view = new DataView(buffer);
    function writeStr(offset, s) { for (var i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);
    for (var i = 0; i < numSamples; i++) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s * 0x7FFF, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  // Pre-generate alarm WAV blobs so they're ready instantly
  var alarmBlobs = {
    work: generateWav([
      { freq: 660, duration: 0.18, delay: 0, volume: 0.5 },
      { freq: 880, duration: 0.18, delay: 0.2, volume: 0.5 },
      { freq: 1100, duration: 0.15, delay: 0.4, volume: 0.6 }
    ]),
    break: generateWav([
      { freq: 520, duration: 0.14, delay: 0, volume: 0.4 },
      { freq: 680, duration: 0.14, delay: 0.15, volume: 0.4 }
    ]),
    start: generateWav([
      { freq: 440, duration: 0.1, delay: 0, volume: 0.25 },
      { freq: 560, duration: 0.12, delay: 0.12, volume: 0.3 }
    ])
  };
  var alarmUrls = {};
  Object.keys(alarmBlobs).forEach(function (k) {
    alarmUrls[k] = URL.createObjectURL(alarmBlobs[k]);
  });

  function playAlarm(type) {
    playAlarmOnce(type);
    setTimeout(function () { playAlarmOnce(type); }, 1500);
    setTimeout(function () { playAlarmOnce(type); }, 3000);
  }

  function playAlarmOnce(type) {
    // Primary: <audio> element — works reliably in background tabs
    try {
      var audio = new Audio(alarmUrls[type] || alarmUrls.work);
      audio.play().catch(function () {});
    } catch (e) { /* ignore */ }

    // Secondary: Web Audio API — better quality when tab is in foreground
    try {
      var ctx = getAudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().then(function () { playTones(ctx, type); });
      } else {
        playTones(ctx, type);
      }
    } catch (e) { /* ignore */ }
  }

  function playTones(ctx, type) {
    if (type === 'work') {
      playTone(ctx, 660, 0.18, 0, 0.25);
      playTone(ctx, 880, 0.18, 0.2, 0.25);
      playTone(ctx, 1100, 0.15, 0.4, 0.3);
    } else if (type === 'start') {
      playTone(ctx, 440, 0.1, 0, 0.12);
      playTone(ctx, 560, 0.12, 0.12, 0.15);
    } else {
      playTone(ctx, 520, 0.14, 0, 0.2);
      playTone(ctx, 680, 0.14, 0.15, 0.2);
    }
  }

  function playTone(ctx, freq, duration, delay, volume) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    var t = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.01);
  }

  function updatePomodoroCount() {
    if (todayPomodoros > 0) {
      pomodoroCount.textContent = todayPomodoros + ' pomodoro' + (todayPomodoros !== 1 ? 's' : '') + ' idag';
    } else {
      pomodoroCount.textContent = '';
    }
  }

  function tick() {
    timeLeft = Math.round((endTime - Date.now()) / 1000);
    if (timeLeft < 0) {
      if (timerWorker) timerWorker.postMessage('stop');
      clearInterval(intervalId);
      intervalId = null;
      endTime = null;
      isRunning = false;

      if (isBreak) {
        playAlarm('break');
        isBreak = false;
        timeLeft = WORK_SECONDS;
        updateDisplay();
        btnStart.textContent = 'Starta';
        btnStart.disabled = false;
        btnPause.disabled = true;
        sessionLabel.textContent = '';
        updateTaskBanner();
      } else {
        playAlarm('work');
        timeLeft = 0;
        updateDisplay();
        btnPause.disabled = true;

        // If schedule is active, auto-log
        if (activeScheduleIndex >= 0) {
          autoLogFromSchedule();
        } else {
          showLogModal();
        }
      }
      return;
    }
    if (timeLeft !== lastTickDisplay) {
      lastTickDisplay = timeLeft;
      updateDisplay();
    }
  }

  var lastTickDisplay = -1;

  function autoLogFromSchedule() {
    var schedule = getSchedule();
    var item = schedule.items[activeScheduleIndex];
    if (!item) {
      showLogModal();
      return;
    }

    var tasks = getTasks();
    var projects = getProjects();
    var task = tasks.filter(function (t) { return t.id === item.taskId; })[0];
    var project = task ? projects.filter(function (p) { return p.id === task.projectId; })[0] : null;

    var projLabel = project ? project.name : (task && task.projectId === null ? 'Övrigt' : '');
    var activityName = (projLabel ? projLabel + ' — ' : '') + (task ? task.name : 'Okänd');

    // Save session
    var sessions = getSessions();
    sessions.push({
      activity: activityName,
      duration: WORK_MINUTES,
      date: todayStr(),
      timestamp: Date.now()
    });
    saveSessions(sessions);

    // Mark this pomodoro as done
    item.done = true;
    saveSchedule(schedule);

    todayPomodoros++;
    updatePomodoroCount();
    updateStreakCounter();
    checkAllDoneConfetti();
    haptic(20);

    // Start break
    isBreak = true;
    timeLeft = BREAK_SECONDS;
    updateDisplay();
    startTimer();
  }

  function startTimer() {
    if (isRunning) return;
    haptic(12);
    // Unlock audio context on user gesture (required by mobile browsers)
    try {
      var ctx = getAudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { /* ignore */ }
    // Play start sound (only for work sessions, not breaks)
    if (!isBreak) playAlarm('start');
    endTime = Date.now() + timeLeft * 1000;
    isRunning = true;
    btnStart.disabled = true;
    btnPause.disabled = false;
    // Use Web Worker for ticks (immune to background-tab throttling)
    if (timerWorker) {
      timerWorker.postMessage('start');
    } else {
      intervalId = setInterval(tick, 250);
    }
    updateDisplay();
  }

  function pauseTimer() {
    if (!isRunning) return;
    // Snapshot remaining time from wall clock
    timeLeft = Math.max(0, Math.round((endTime - Date.now()) / 1000));
    endTime = null;
    isRunning = false;
    if (timerWorker) {
      timerWorker.postMessage('stop');
    }
    clearInterval(intervalId);
    intervalId = null;
    btnStart.disabled = false;
    btnPause.disabled = true;
  }

  function resetTimer() {
    pauseTimer();
    isBreak = false;
    endTime = null;
    timeLeft = WORK_SECONDS;
    btnStart.disabled = false;
    btnStart.textContent = 'Starta';
    sessionLabel.textContent = '';
    updateDisplay();
  }

  btnStart.addEventListener('click', startTimer);
  btnPause.addEventListener('click', pauseTimer);
  btnReset.addEventListener('click', resetTimer);

  // Wire up Web Worker ticks
  if (timerWorker) {
    timerWorker.onmessage = function () {
      if (isRunning) tick();
    };
  }

  // Catch up immediately when user returns to the tab
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && isRunning) tick();
  });

  // ========================================
  // Activity logging (fallback for no schedule)
  // ========================================
  function showLogModal() {
    logModal.classList.remove('hidden');
    activityInput.value = '';
    renderSuggestions('');
    activityInput.focus();
  }

  function hideLogModal() {
    logModal.classList.add('hidden');
  }

  function renderSuggestions(filter) {
    var activities = getRecentActivities();
    var lowerFilter = filter.toLowerCase();
    activitySuggestions.innerHTML = '';

    var filtered = activities.filter(function (a) {
      return !filter || a.toLowerCase().indexOf(lowerFilter) !== -1;
    });

    filtered.forEach(function (name) {
      var div = document.createElement('div');
      div.className = 'suggestion';
      div.textContent = name;
      div.addEventListener('click', function () {
        activityInput.value = name;
        activitySuggestions.innerHTML = '';
      });
      activitySuggestions.appendChild(div);
    });
  }

  activityInput.addEventListener('input', function () {
    renderSuggestions(activityInput.value);
  });

  btnSaveActivity.addEventListener('click', saveActivity);
  activityInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveActivity();
  });

  function saveActivity() {
    var name = activityInput.value.trim();
    if (!name) return;

    var sessions = getSessions();
    sessions.push({
      activity: name,
      duration: WORK_MINUTES,
      date: todayStr(),
      timestamp: Date.now()
    });
    saveSessions(sessions);

    hideLogModal();
    todayPomodoros++;
    updatePomodoroCount();
    updateStreakCounter();
    checkAllDoneConfetti();

    isBreak = true;
    timeLeft = BREAK_SECONDS;
    updateDisplay();
    startTimer();
  }

  // ========================================
  // Navigation
  // ========================================
  navBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.view;
      navBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      views.forEach(function (v) { v.classList.remove('active'); });
      document.getElementById(target + '-view').classList.add('active');
      if (target === 'stats') renderStats();
      if (target === 'plan') {
        scheduleViewDate = null;
        renderPlanView();
      }
      if (target === 'timer') updateTaskBanner();
    });
  });

  // ========================================
  // Task carryover from previous day
  // ========================================
  function getCarryoverItems() {
    var history = getScheduleHistory();
    var dates = Object.keys(history).filter(function (d) {
      return d < todayStr() && history[d] && history[d].length > 0;
    });
    if (dates.length === 0) return null;
    dates.sort();
    var lastDate = dates[dates.length - 1];
    var items = migrateScheduleItems(history[lastDate]);
    var tasks = getTasks();
    var taskIds = tasks.map(function (t) { return t.id; });
    // Filter to only unfinished items whose tasks still exist
    var unfinished = items.filter(function (item) {
      return !item.done && taskIds.indexOf(item.taskId) !== -1;
    });
    if (unfinished.length === 0) return null;
    return { date: lastDate, items: unfinished };
  }

  function isCarryoverDismissed() {
    return localStorage.getItem('pomodoro_carryover_dismissed') === todayStr();
  }

  function dismissCarryover() {
    localStorage.setItem('pomodoro_carryover_dismissed', todayStr());
    carryoverBanner.classList.add('hidden');
  }

  function carryoverTasks() {
    var carryover = getCarryoverItems();
    if (!carryover) return;
    var schedule = getSchedule();
    var existingTaskIds = schedule.items.map(function (i) { return i.taskId; });
    // Group carryover items by task to avoid duplicate tasks
    var added = {};
    for (var i = 0; i < carryover.items.length; i++) {
      var item = carryover.items[i];
      if (existingTaskIds.indexOf(item.taskId) === -1 || added[item.taskId]) {
        schedule.items.push({ taskId: item.taskId, done: false });
        added[item.taskId] = true;
        // Track so we don't add same task from existingTaskIds check on next iteration
        if (existingTaskIds.indexOf(item.taskId) === -1) {
          existingTaskIds.push(item.taskId);
        }
      }
    }
    saveSchedule(schedule);
    dismissCarryover();
    renderPlanView();
    updateTaskBanner();
  }

  function renderCarryoverBanner() {
    var viewDate = scheduleViewDate || todayStr();
    if (viewDate !== todayStr() || isCarryoverDismissed()) {
      carryoverBanner.classList.add('hidden');
      return;
    }
    var carryover = getCarryoverItems();
    if (!carryover) {
      carryoverBanner.classList.add('hidden');
      return;
    }
    // Build message with task count and source date
    var taskIds = {};
    for (var i = 0; i < carryover.items.length; i++) {
      taskIds[carryover.items[i].taskId] = true;
    }
    var taskCount = Object.keys(taskIds).length;
    var sourceLabel = formatDateLabel(carryover.date).toLowerCase();
    carryoverMessage.textContent = taskCount + ' oavklarad' + (taskCount !== 1 ? 'e' : '') +
      ' uppgift' + (taskCount !== 1 ? 'er' : '') + ' fr\u00e5n ' + sourceLabel;
    carryoverBanner.classList.remove('hidden');
  }

  btnCarryover.addEventListener('click', carryoverTasks);
  btnCarryoverDismiss.addEventListener('click', dismissCarryover);

  // ========================================
  // Projects & Tasks (Planera)
  // ========================================
  function renderPlanView() {
    updateScheduleDateNav();
    renderCarryoverBanner();
    renderSchedule();
    renderProjects();
  }

  function formatDateLabel(dateStr) {
    var today = todayStr();
    if (dateStr === today) return 'Idag';
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (dateStr === yesterday.toISOString().slice(0, 10)) return 'Ig\u00e5r';
    var d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function getScheduleDates() {
    var history = getScheduleHistory();
    var dates = Object.keys(history).filter(function (d) { return (history[d] && history[d].length > 0); });
    // Also include today if it has items
    var schedule = getSchedule();
    if (schedule.items.length > 0 && dates.indexOf(todayStr()) === -1) {
      dates.push(todayStr());
    }
    dates.sort();
    return dates;
  }

  function updateScheduleDateNav() {
    var viewDate = scheduleViewDate || todayStr();
    var isToday = viewDate === todayStr();

    scheduleDateLabel.textContent = formatDateLabel(viewDate);

    // Can always go back if there's history before current view
    var dates = getScheduleDates();
    var currentIdx = dates.indexOf(viewDate);

    // Prev: enabled if there are dates before current, or if we're on today and there's any history
    var hasPrev = false;
    if (currentIdx > 0) {
      hasPrev = true;
    } else if (currentIdx === -1 && dates.length > 0) {
      // viewDate is not in the list — check if there are dates before it
      for (var i = 0; i < dates.length; i++) {
        if (dates[i] < viewDate) { hasPrev = true; break; }
      }
    }
    schedulePrev.disabled = !hasPrev;

    // Next: enabled if we're viewing history and there are newer dates or we can go to today
    scheduleNext.disabled = isToday;

    // Show/hide editing controls based on whether viewing today
    btnAddToSchedule.style.display = isToday ? '' : 'none';
    scheduleHeading.textContent = isToday ? 'Dagens schema' : 'Schema';
    document.getElementById('schedule-time-bar').style.display = isToday ? '' : 'none';
  }

  // --- Projects ---
  function renderProjects() {
    var projects = getProjects();
    var tasks = getTasks();
    var schedule = getSchedule();
    var scheduledTaskIds = schedule.items.map(function (i) { return i.taskId; });

    if (projects.length === 0) {
      projectsList.innerHTML = '<div class="no-data">Inga projekt &auml;nnu</div>';
      return;
    }

    projectsList.innerHTML = projects.map(function (proj, pIdx) {
      var projTasks = tasks.filter(function (t) { return t.projectId === proj.id; });
      var taskHtml = projTasks.map(function (task) {
        var inSchedule = scheduledTaskIds.indexOf(task.id) !== -1;
        var recurLabel = task.recurring ? (task.recurring === 'daily' ? 'daglig' : 'veckovis') : '';
        return '<div class="task-item' + (inSchedule ? ' in-schedule' : '') + '" data-task-id="' + task.id + '">' +
          '<button class="btn-edit-task btn-tiny" data-task-id="' + task.id + '">&#9998;</button>' +
          '<span class="task-name">' + escapeHtml(task.name) + '</span>' +
          (recurLabel ? '<span class="recurring-badge">' + recurLabel + '</span>' : '') +
          (inSchedule ? '<span class="task-scheduled-badge">i schema</span>' : '') +
          '<button class="btn-delete-task btn-tiny" data-task-id="' + task.id + '">&times;</button>' +
          '</div>';
      }).join('');

      var color = getProjectColor(proj);
      return '<div class="project-card" style="border-left:4px solid ' + color + '">' +
        '<div class="project-header">' +
        '<span class="project-name" style="color:' + color + '">' + escapeHtml(proj.name) + '</span>' +
        '<div class="project-actions">' +
        '<button class="btn-add-task btn-tiny" data-project-id="' + proj.id + '">+</button>' +
        '<button class="btn-delete-project btn-tiny" data-project-id="' + proj.id + '">&times;</button>' +
        '</div>' +
        '</div>' +
        '<div class="task-list">' + (taskHtml || '<div class="no-tasks">Inga uppgifter</div>') + '</div>' +
        '</div>';
    }).join('');

    // Event listeners
    projectsList.querySelectorAll('.btn-add-task').forEach(function (btn) {
      btn.addEventListener('click', function () {
        addTaskToProjectId = btn.dataset.projectId;
        taskNameInput.value = '';
        taskModal.classList.remove('hidden');
        taskNameInput.focus();
      });
    });

    projectsList.querySelectorAll('.btn-delete-project').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteProject(btn.dataset.projectId);
      });
    });

    projectsList.querySelectorAll('.btn-delete-task').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteTask(btn.dataset.taskId);
      });
    });

    projectsList.querySelectorAll('.btn-edit-task').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openTaskDetail(btn.dataset.taskId);
      });
    });

    // Task items: tap to add to schedule, drag to schedule
    projectsList.querySelectorAll('.task-item').forEach(function (el) {
      initTaskDrag(el);
    });
  }

  btnAddProject.addEventListener('click', function () {
    projectNameInput.value = '';
    projectModal.classList.remove('hidden');
    projectNameInput.focus();
  });

  btnSaveProject.addEventListener('click', saveProject);
  projectNameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveProject();
  });

  function saveProject() {
    var name = projectNameInput.value.trim();
    if (!name) return;
    var color = nextProjectColor();
    var projects = getProjects();
    projects.push({ id: generateId(), name: name, color: color });
    saveProjects(projects);
    projectModal.classList.add('hidden');
    renderProjects();
  }

  function deleteProject(id) {
    var projects = getProjects().filter(function (p) { return p.id !== id; });
    saveProjects(projects);
    // Also remove tasks belonging to project
    var tasks = getTasks().filter(function (t) { return t.projectId !== id; });
    saveTasks(tasks);
    // Remove from schedule
    var removedTaskIds = getTasks().filter(function (t) { return t.projectId === id; }).map(function (t) { return t.id; });
    // tasks already filtered, so get original
    var schedule = getSchedule();
    schedule.items = schedule.items.filter(function (item) {
      return removedTaskIds.indexOf(item.taskId) === -1;
    });
    saveSchedule(schedule);
    renderPlanView();
  }

  // --- Tasks ---
  btnSaveTask.addEventListener('click', saveTask);
  taskNameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveTask();
  });

  function saveTask() {
    var name = taskNameInput.value.trim();
    if (!name || !addTaskToProjectId) return;
    var tasks = getTasks();
    tasks.push({ id: generateId(), projectId: addTaskToProjectId, name: name });
    saveTasks(tasks);
    taskModal.classList.add('hidden');
    addTaskToProjectId = null;
    renderProjects();
  }

  function deleteTask(id) {
    var tasks = getTasks().filter(function (t) { return t.id !== id; });
    saveTasks(tasks);
    // Remove from schedule
    var schedule = getSchedule();
    schedule.items = schedule.items.filter(function (item) { return item.taskId !== id; });
    saveSchedule(schedule);
    renderPlanView();
  }

  // --- Schedule date navigation ---
  schedulePrev.addEventListener('click', function () {
    var viewDate = scheduleViewDate || todayStr();
    var dates = getScheduleDates();
    // Find the closest date before current viewDate
    var prevDate = null;
    for (var i = dates.length - 1; i >= 0; i--) {
      if (dates[i] < viewDate) { prevDate = dates[i]; break; }
    }
    if (prevDate) {
      scheduleViewDate = prevDate;
      updateScheduleDateNav();
      renderSchedule();
    }
  });

  scheduleNext.addEventListener('click', function () {
    var viewDate = scheduleViewDate || todayStr();
    if (viewDate === todayStr()) return;
    var dates = getScheduleDates();
    // Find the closest date after current viewDate
    var nextDate = null;
    for (var i = 0; i < dates.length; i++) {
      if (dates[i] > viewDate) { nextDate = dates[i]; break; }
    }
    // If no next date in history, go to today
    if (!nextDate || nextDate >= todayStr()) {
      scheduleViewDate = null;
    } else {
      scheduleViewDate = nextDate;
    }
    updateScheduleDateNav();
    renderSchedule();
  });

  // --- Schedule ---
  function renderSchedule() {
    var viewDate = scheduleViewDate || todayStr();
    var isToday = viewDate === todayStr();
    var schedule = isToday ? getSchedule() : getScheduleForDate(viewDate);
    var tasks = getTasks();
    var projects = getProjects();
    var groups = groupScheduleItems(schedule.items);

    if (groups.length === 0) {
      scheduleList.innerHTML = '';
      scheduleEmpty.classList.remove('hidden');
      scheduleEmpty.textContent = isToday ? 'Dra uppgifter hit eller tryck +' : 'Inget schema denna dag';
      return;
    }

    scheduleEmpty.classList.add('hidden');

    if (isToday) {
      updateTimeEstimate();
      // Compute timeline start times for each group
      var dayStart = getDayStartMinutes();
      var cumMin = dayStart;
      var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      var nowInserted = false;

      // Editable today view — grouped by task
      var html = '';
      groups.forEach(function (group, gIdx) {
        var groupEndMin = cumMin + group.total * WORK_MINUTES + (group.total - 1) * BREAK_MINUTES;

        // Insert "now" line before this group if appropriate
        if (!nowInserted && nowMin < groupEndMin && nowMin >= dayStart) {
          if (nowMin >= cumMin || gIdx === 0) {
            html += '<div class="timeline-now"></div>';
            nowInserted = true;
          }
        }

        var timeLabel = formatMinutesAsTime(cumMin);

        // Empty slot
        if (!group.taskId) {
          html += '<div class="schedule-item schedule-empty-slot" data-gidx="' + gIdx + '" data-flat-idx="' + group.flatIdx + '">' +
            '<span class="schedule-time-label">' + timeLabel + '</span>' +
            '<span class="schedule-empty-label">Ledig</span>' +
            '<button class="btn-remove-empty-slot btn-tiny" data-flat-idx="' + group.flatIdx + '">&times;</button>' +
            '</div>';
          cumMin = groupEndMin + BREAK_MINUTES;
          return;
        }

        var task = tasks.filter(function (t) { return t.id === group.taskId; })[0];
        var project = task ? projects.filter(function (p) { return p.id === task.projectId; })[0] : null;
        var isDone = group.completed >= group.total;
        var color = getProjectColor(project);

        var recurring = task && task.recurring;
        var recurBadge = recurring ? '<span class="recurring-badge">' + (recurring === 'daily' ? 'daglig' : 'veckovis') + '</span>' : '';
        var playBtn = isDone ? '' : '<button class="btn-play-task" data-task-id="' + group.taskId + '" title="Starta">&#9654;</button>';

        html += '<div class="schedule-item' + (isDone ? ' done' : '') + '" data-task-id="' + group.taskId + '" data-gidx="' + gIdx + '" style="border-left:4px solid ' + color + '">' +
          '<span class="schedule-time-label">' + timeLabel + '</span>' +
          '<span class="schedule-drag-handle">&#9776;</span>' +
          '<div class="schedule-item-body">' +
          '<div class="schedule-item-info">' +
          '<span class="schedule-project" style="color:' + color + '">' + escapeHtml(project ? project.name : (task && task.projectId === null ? 'Övrigt' : '')) + recurBadge + '</span>' +
          '<span class="schedule-task">' + escapeHtml(task ? task.name : 'Borttagen') + '</span>' +
          '</div>' +
          '</div>' +
          '<div class="schedule-item-controls">' +
          playBtn +
          '<button class="btn-pom-minus btn-tiny" data-task-id="' + group.taskId + '">&minus;</button>' +
          '<span class="schedule-pom-count">' + group.completed + '/' + group.total + '</span>' +
          '<button class="btn-pom-plus btn-tiny" data-task-id="' + group.taskId + '">+</button>' +
          '<button class="btn-remove-schedule btn-tiny" data-task-id="' + group.taskId + '">&times;</button>' +
          '</div>' +
          '</div>';

        cumMin = groupEndMin + BREAK_MINUTES; // break between groups
      });

      // Insert "now" line at end if not yet inserted
      if (!nowInserted && nowMin >= dayStart) {
        html += '<div class="timeline-now"></div>';
      }

      scheduleList.innerHTML = html;

      // Event listeners
      scheduleList.querySelectorAll('.btn-pom-minus').forEach(function (btn) {
        btn.addEventListener('click', function () {
          changePomCount(btn.dataset.taskId, -1);
        });
      });
      scheduleList.querySelectorAll('.btn-pom-plus').forEach(function (btn) {
        btn.addEventListener('click', function () {
          changePomCount(btn.dataset.taskId, 1);
        });
      });
      scheduleList.querySelectorAll('.btn-remove-schedule').forEach(function (btn) {
        btn.addEventListener('click', function () {
          removeScheduleItem(btn.dataset.taskId);
        });
      });
      scheduleList.querySelectorAll('.btn-play-task').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          playTask(btn.dataset.taskId);
        });
      });
      scheduleList.querySelectorAll('.btn-remove-empty-slot').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var schedule = getSchedule();
          var fi = parseInt(btn.dataset.flatIdx);
          if (fi < schedule.items.length && !schedule.items[fi].taskId) {
            schedule.items.splice(fi, 1);
            saveSchedule(schedule);
            renderPlanView();
            updateTaskBanner();
          }
        });
      });

      // Whole schedule items are draggable (skip empty slots)
      scheduleList.querySelectorAll('.schedule-item:not(.schedule-empty-slot)').forEach(function (item) {
        initScheduleDrag(item);
      });
    } else {
      // Read-only history view — grouped
      scheduleList.innerHTML = groups.map(function (group) {
        var task = tasks.filter(function (t) { return t.id === group.taskId; })[0];
        var project = task ? projects.filter(function (p) { return p.id === task.projectId; })[0] : null;
        var isDone = group.completed >= group.total;

        var color = getProjectColor(project);
        return '<div class="schedule-item history-item' + (isDone ? ' done' : '') + '" style="border-left:4px solid ' + color + '">' +
          '<div class="schedule-item-body">' +
          '<div class="schedule-item-info">' +
          '<span class="schedule-project" style="color:' + color + '">' + escapeHtml(project ? project.name : (task && task.projectId === null ? 'Övrigt' : '')) + '</span>' +
          '<span class="schedule-task">' + escapeHtml(task ? task.name : 'Borttagen') + '</span>' +
          '</div>' +
          '</div>' +
          '<span class="schedule-pom-count">' + group.completed + '/' + group.total + '</span>' +
          '</div>';
      }).join('');

      // Summary
      var totalCompleted = 0, totalPomodoros = 0;
      for (var i = 0; i < groups.length; i++) {
        totalCompleted += groups[i].completed;
        totalPomodoros += groups[i].total;
      }
      scheduleList.innerHTML += '<div class="schedule-history-summary">' +
        totalCompleted + '/' + totalPomodoros + ' pomodoros avklarade' +
        '</div>';
    }
  }

  function changePomCount(taskId, delta) {
    var schedule = getSchedule();
    if (delta > 0) {
      // Add a new pomodoro after the last one for this task
      var lastIdx = -1;
      for (var i = schedule.items.length - 1; i >= 0; i--) {
        if (schedule.items[i].taskId === taskId) { lastIdx = i; break; }
      }
      if (lastIdx >= 0) {
        schedule.items.splice(lastIdx + 1, 0, { taskId: taskId, done: false });
      }
    } else {
      // Remove last undone pomodoro for this task; if all done, remove last done
      var total = 0;
      for (var i = 0; i < schedule.items.length; i++) {
        if (schedule.items[i].taskId === taskId) total++;
      }
      if (total <= 1) return; // Don't remove last one
      var removeIdx = -1;
      for (var i = schedule.items.length - 1; i >= 0; i--) {
        if (schedule.items[i].taskId === taskId && !schedule.items[i].done) {
          removeIdx = i;
          break;
        }
      }
      if (removeIdx === -1) {
        // All done — remove last done
        for (var i = schedule.items.length - 1; i >= 0; i--) {
          if (schedule.items[i].taskId === taskId) { removeIdx = i; break; }
        }
      }
      if (removeIdx >= 0) schedule.items.splice(removeIdx, 1);
    }
    saveSchedule(schedule);
    renderPlanView();
  }

  function removeScheduleItem(taskId) {
    var schedule = getSchedule();
    schedule.items = schedule.items.filter(function (item) { return item.taskId !== taskId; });
    saveSchedule(schedule);
    renderPlanView();
  }

  // --- Schedule picker ---
  btnAddToSchedule.addEventListener('click', function () {
    renderSchedulePicker();
    scheduleModal.classList.remove('hidden');
  });

  btnClosePicker.addEventListener('click', function () {
    scheduleModal.classList.add('hidden');
    renderSchedule();
  });

  function renderSchedulePicker() {
    var projects = getProjects();
    var tasks = getTasks();
    var schedule = getSchedule();
    var scheduledTaskIds = schedule.items.map(function (i) { return i.taskId; });

    if (projects.length === 0) {
      schedulePicker.innerHTML = '<div class="no-data">Skapa ett projekt f&ouml;rst</div>';
      return;
    }

    schedulePicker.innerHTML = projects.map(function (proj) {
      var projTasks = tasks.filter(function (t) { return t.projectId === proj.id; });
      if (projTasks.length === 0) return '';

      var taskBtns = projTasks.map(function (task) {
        var alreadyAdded = scheduledTaskIds.indexOf(task.id) !== -1;
        return '<button class="picker-task' + (alreadyAdded ? ' added' : '') + '" data-task-id="' + task.id + '">' +
          escapeHtml(task.name) +
          (alreadyAdded ? ' &check;' : '') +
          '</button>';
      }).join('');

      var color = getProjectColor(proj);
      return '<div class="picker-project">' +
        '<div class="picker-project-name" style="color:' + color + '">' + escapeHtml(proj.name) + '</div>' +
        '<div class="picker-tasks">' + taskBtns + '</div>' +
        '</div>';
    }).join('');

    schedulePicker.querySelectorAll('.picker-task:not(.added)').forEach(function (btn) {
      btn.addEventListener('click', function () {
        addToSchedule(btn.dataset.taskId);
        renderSchedulePicker();
      });
    });
  }

  function addToSchedule(taskId) {
    var schedule = getSchedule();
    // Don't add duplicates
    for (var i = 0; i < schedule.items.length; i++) {
      if (schedule.items[i].taskId === taskId) return;
    }
    schedule.items.push({ taskId: taskId, done: false });
    saveSchedule(schedule);
  }

  // ========================================
  // Task detail modal
  // ========================================
  var taskDetailModal = document.getElementById('task-detail-modal');
  var taskDetailName = document.getElementById('task-detail-name');
  var taskDetailProject = document.getElementById('task-detail-project');
  var taskDetailDesc = document.getElementById('task-detail-desc');
  var btnSaveTaskDetail = document.getElementById('btn-save-task-detail');
  var taskSwapSection = document.getElementById('task-swap-section');
  var taskSwapList = document.getElementById('task-swap-list');
  var editingTaskId = null;
  var editingTimerIdx = null; // non-null when editing from timer view

  function openTaskDetail(taskId, timerIdx) {
    var tasks = getTasks();
    var task = tasks.filter(function (t) { return t.id === taskId; })[0];
    if (!task) return;
    editingTaskId = taskId;
    editingTimerIdx = (timerIdx != null) ? timerIdx : null;
    taskDetailName.value = task.name;
    taskDetailDesc.value = task.description || '';
    // Populate project dropdown
    var projects = getProjects();
    taskDetailProject.innerHTML = '<option value="">\u00d6vrigt</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
      }).join('');
    taskDetailProject.value = task.projectId || '';
    taskDetailRecurring.value = task.recurring || '';

    // Show swap section only when editing from timer view
    if (editingTimerIdx != null) {
      taskSwapSection.classList.remove('hidden');
      renderTaskSwapList(taskId);
    } else {
      taskSwapSection.classList.add('hidden');
    }

    taskDetailModal.classList.remove('hidden');
    taskDetailName.focus();
  }

  function renderTaskSwapList(currentTaskId) {
    var tasks = getTasks();
    var projects = getProjects();

    // Group tasks by project
    var groups = [];
    projects.forEach(function (p) {
      var projTasks = tasks.filter(function (t) { return t.projectId === p.id && t.id !== currentTaskId; });
      if (projTasks.length) groups.push({ name: p.name, color: getProjectColor(p), tasks: projTasks });
    });
    // Ungrouped tasks (Övrigt)
    var loose = tasks.filter(function (t) { return !t.projectId && t.id !== currentTaskId; });
    if (loose.length) groups.push({ name: 'Övrigt', color: '#8888aa', tasks: loose });

    if (groups.length === 0) {
      taskSwapList.innerHTML = '<div class="no-tasks">Inga andra uppgifter</div>';
      return;
    }

    taskSwapList.innerHTML = groups.map(function (g) {
      return '<div class="swap-group">' +
        '<div class="swap-group-name" style="color:' + g.color + '">' + escapeHtml(g.name) + '</div>' +
        g.tasks.map(function (t) {
          return '<button class="swap-task-btn" data-task-id="' + t.id + '">' + escapeHtml(t.name) + '</button>';
        }).join('') +
        '</div>';
    }).join('');

    taskSwapList.querySelectorAll('.swap-task-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        swapTimerTask(btn.dataset.taskId);
      });
    });
  }

  function swapTimerTask(newTaskId) {
    if (editingTimerIdx == null) return;
    var schedule = getSchedule();
    if (editingTimerIdx < schedule.items.length) {
      schedule.items[editingTimerIdx].taskId = newTaskId;
      saveSchedule(schedule);
    }
    taskDetailModal.classList.add('hidden');
    editingTaskId = null;
    editingTimerIdx = null;
    updateTaskBanner();
  }

  btnSaveTaskDetail.addEventListener('click', saveTaskDetail);
  taskDetailName.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      taskDetailDesc.focus();
    }
  });

  function saveTaskDetail() {
    if (!editingTaskId) return;
    var name = taskDetailName.value.trim();
    if (!name) return;
    var newProjectId = taskDetailProject.value || null;
    var tasks = getTasks();
    for (var i = 0; i < tasks.length; i++) {
      if (tasks[i].id === editingTaskId) {
        tasks[i].name = name;
        tasks[i].projectId = newProjectId;
        tasks[i].description = taskDetailDesc.value.trim();
        var recurVal = taskDetailRecurring.value || null;
        tasks[i].recurring = recurVal;
        if (recurVal === 'weekly') {
          tasks[i].recurDay = new Date().getDay();
        }
        break;
      }
    }
    saveTasks(tasks);
    taskDetailModal.classList.add('hidden');
    editingTaskId = null;
    editingTimerIdx = null;
    renderPlanView();
    updateTaskBanner();
  }

  // ========================================
  // Drag and drop system
  // ========================================
  var drag = {
    active: false,
    started: false,
    type: null,       // 'task-to-schedule' or 'schedule-reorder'
    taskId: null,
    sourceIdx: null,
    sourceEl: null,
    ghost: null,
    startX: 0,
    startY: 0,
    threshold: 8
  };

  function createGhost(text, color) {
    var el = document.createElement('div');
    el.className = 'drag-ghost';
    if (color) el.style.borderLeft = '4px solid ' + color;
    el.textContent = text;
    document.body.appendChild(el);
    return el;
  }

  function cleanupDrag() {
    if (drag.ghost) {
      drag.ghost.remove();
      drag.ghost = null;
    }
    if (drag.sourceEl) {
      drag.sourceEl.classList.remove('dragging');
      drag.sourceEl = null;
    }
    scheduleList.classList.remove('drop-active');
    // Remove any placeholders
    var phs = document.querySelectorAll('.schedule-drop-placeholder, .ts-drop-placeholder');
    phs.forEach(function (p) { p.remove(); });
    drag.active = false;
    drag.started = false;
    drag.type = null;
  }

  // --- Task drag (project → schedule) ---
  function initTaskDrag(el) {
    var taskId = el.dataset.taskId;

    function onStart(clientX, clientY, e) {
      // Don't drag from buttons
      if (e.target.closest('.btn-tiny')) return;
      drag.active = true;
      drag.started = false;
      drag.type = 'task-to-schedule';
      drag.taskId = taskId;
      drag.sourceEl = el;
      drag.startX = clientX;
      drag.startY = clientY;
    }

    el.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      onStart(t.clientX, t.clientY, e);
    }, { passive: true });

    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      onStart(e.clientX, e.clientY, e);
    });
  }

  // --- Schedule drag (reorder by task group) ---
  function initScheduleDrag(item) {
    var taskId = item.dataset.taskId;

    function onStart(clientX, clientY, e) {
      if (e.target.closest('.btn-tiny')) return;
      drag.active = true;
      drag.started = false;
      drag.type = 'schedule-reorder';
      drag.taskId = taskId;
      drag.sourceEl = item;
      drag.startX = clientX;
      drag.startY = clientY;
    }

    item.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      onStart(t.clientX, t.clientY, e);
    }, { passive: true });

    item.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      onStart(e.clientX, e.clientY, e);
    });
  }

  // --- Global move handler ---
  function onDragMove(clientX, clientY, e) {
    if (!drag.active) return;

    var dx = clientX - drag.startX;
    var dy = clientY - drag.startY;

    if (!drag.started) {
      if (Math.sqrt(dx * dx + dy * dy) < drag.threshold) return;
      drag.started = true;
      drag.sourceEl.classList.add('dragging');
      haptic(10);

      if (drag.type === 'task-to-schedule') {
        var tasks = getTasks();
        var projects = getProjects();
        var task = tasks.filter(function (t) { return t.id === drag.taskId; })[0];
        var project = task ? projects.filter(function (p) { return p.id === task.projectId; })[0] : null;
        var color = getProjectColor(project);
        drag.ghost = createGhost(task ? task.name : '', color);
        scheduleList.classList.add('drop-active');
        scheduleEmpty.classList.add('hidden');
      } else if (drag.type === 'schedule-reorder') {
        var taskText = drag.sourceEl.querySelector('.schedule-task');
        drag.ghost = createGhost(taskText ? taskText.textContent : '', null);
      } else if (drag.type === 'timer-reorder') {
        var tsName = drag.sourceEl.querySelector('.ts-name');
        drag.ghost = createGhost(tsName ? tsName.textContent : '', null);
      }
    }

    if (!drag.started) return;
    if (e && e.cancelable) e.preventDefault();

    drag.ghost.style.left = (clientX + 12) + 'px';
    drag.ghost.style.top = (clientY - 20) + 'px';

    if (drag.type === 'schedule-reorder') {
      updateReorderPlaceholder(clientY, scheduleList, '.schedule-item', 'schedule-drop-placeholder');
    } else if (drag.type === 'timer-reorder') {
      updateReorderPlaceholder(clientY, timerSchedule, '.ts-item', 'ts-drop-placeholder');
    }
  }

  function updateReorderPlaceholder(clientY, container, itemSelector, phClass) {
    var old = container.querySelectorAll('.' + phClass);
    old.forEach(function (p) { p.remove(); });

    var items = container.querySelectorAll(itemSelector);
    var insertBefore = null;

    for (var i = 0; i < items.length; i++) {
      var rect = items[i].getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      if (clientY < midY) {
        insertBefore = items[i];
        break;
      }
    }

    var ph = document.createElement('div');
    ph.className = phClass;
    if (insertBefore) {
      container.insertBefore(ph, insertBefore);
    } else {
      container.appendChild(ph);
    }
  }

  // --- Global end handler ---
  function onDragEnd(clientX, clientY) {
    if (!drag.active) return;

    if (drag.started) {
      if (drag.type === 'task-to-schedule') {
        // Check if dropped over schedule area
        var scheduleRect = document.getElementById('schedule-section').getBoundingClientRect();
        var overSchedule = clientY >= scheduleRect.top - 40 && clientY <= scheduleRect.bottom + 40;
        if (overSchedule) {
          addToSchedule(drag.taskId);
          renderSchedule();
          renderProjects();
        }
      } else if (drag.type === 'schedule-reorder') {
        // Group-based reorder in plan view
        var ph = scheduleList.querySelector('.schedule-drop-placeholder');
        var newGroupIdx = 0;
        if (ph) {
          var sibling = scheduleList.firstChild;
          var count = 0;
          while (sibling) {
            if (sibling === ph) break;
            if (sibling.classList && sibling.classList.contains('schedule-item')) count++;
            sibling = sibling.nextSibling;
          }
          newGroupIdx = count;
        }
        reorderScheduleGroups(drag.taskId, newGroupIdx);
      } else if (drag.type === 'timer-reorder') {
        // Individual item reorder — leave empty slot behind
        var ph = timerSchedule.querySelector('.ts-drop-placeholder');
        var newIdx = 0;
        if (ph) {
          var sibling = timerSchedule.firstChild;
          var count = 0;
          while (sibling) {
            if (sibling === ph) break;
            if (sibling.classList && sibling.classList.contains('ts-item')) count++;
            sibling = sibling.nextSibling;
          }
          newIdx = count;
        }
        var schedule = getSchedule();
        var fromIdx = drag.sourceIdx;
        if (fromIdx !== newIdx && fromIdx !== newIdx - 1) {
          var movedItem = schedule.items[fromIdx];
          schedule.items[fromIdx] = { taskId: null, done: false };
          schedule.items.splice(newIdx, 0, movedItem);
          saveSchedule(schedule);
        }
        updateTaskBanner();
      }
    } else if (drag.taskId) {
      // Wasn't a drag (no movement)
      if (drag.type === 'task-to-schedule') {
        // Tap on task in plan view → add to schedule
        addToSchedule(drag.taskId);
        renderSchedule();
        renderProjects();
      } else if (drag.type === 'timer-reorder') {
        openTaskDetail(drag.taskId, drag.sourceIdx);
      } else {
        openTaskDetail(drag.taskId);
      }
    }

    cleanupDrag();
  }

  function reorderScheduleGroups(draggedTaskId, newGroupIdx) {
    var schedule = getSchedule();
    // Build current group order (unique taskIds by first occurrence)
    var groupOrder = [];
    var seen = {};
    for (var i = 0; i < schedule.items.length; i++) {
      var tid = schedule.items[i].taskId;
      if (!seen[tid]) {
        seen[tid] = true;
        groupOrder.push(tid);
      }
    }
    var oldIdx = groupOrder.indexOf(draggedTaskId);
    if (oldIdx === -1) return;
    if (oldIdx === newGroupIdx || oldIdx === newGroupIdx - 1) {
      renderSchedule();
      return;
    }
    // Remove from old position and insert at new
    groupOrder.splice(oldIdx, 1);
    var targetIdx = oldIdx < newGroupIdx ? newGroupIdx - 1 : newGroupIdx;
    groupOrder.splice(targetIdx, 0, draggedTaskId);
    // Rebuild items array in new group order
    var itemsByTask = {};
    for (var i = 0; i < schedule.items.length; i++) {
      var tid = schedule.items[i].taskId;
      if (!itemsByTask[tid]) itemsByTask[tid] = [];
      itemsByTask[tid].push(schedule.items[i]);
    }
    var newItems = [];
    for (var i = 0; i < groupOrder.length; i++) {
      var taskItems = itemsByTask[groupOrder[i]];
      if (taskItems) {
        for (var j = 0; j < taskItems.length; j++) {
          newItems.push(taskItems[j]);
        }
      }
    }
    schedule.items = newItems;
    saveSchedule(schedule);
    renderSchedule();
  }

  // Touch events
  document.addEventListener('touchmove', function (e) {
    if (!drag.active) return;
    var t = e.touches[0];
    onDragMove(t.clientX, t.clientY, e);
  }, { passive: false });

  document.addEventListener('touchend', function (e) {
    if (!drag.active) return;
    var t = e.changedTouches[0];
    onDragEnd(t.clientX, t.clientY);
  });

  document.addEventListener('touchcancel', function () {
    if (drag.active) cleanupDrag();
  });

  // Mouse events (for desktop)
  document.addEventListener('mousemove', function (e) {
    if (!drag.active) return;
    onDragMove(e.clientX, e.clientY, e);
  });

  document.addEventListener('mouseup', function (e) {
    if (!drag.active) return;
    onDragEnd(e.clientX, e.clientY);
  });

  // ========================================
  // Quick-add task from timer
  // ========================================
  var quickAddModal = document.getElementById('quick-add-modal');
  var quickAddName = document.getElementById('quick-add-name');
  var quickAddProject = document.getElementById('quick-add-project');
  var btnQuickAddSave = document.getElementById('btn-quick-add-save');
  var btnTimerAdd = document.getElementById('btn-timer-add');

  btnTimerAdd.addEventListener('click', function () {
    // Populate project dropdown
    var projects = getProjects();
    quickAddProject.innerHTML = '<option value="">&Ouml;vrigt</option>' +
      projects.map(function (p) {
        return '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>';
      }).join('');
    quickAddName.value = '';
    quickAddModal.classList.remove('hidden');
    quickAddName.focus();
  });

  btnQuickAddSave.addEventListener('click', saveQuickAdd);
  quickAddName.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveQuickAdd();
  });

  function saveQuickAdd() {
    var name = quickAddName.value.trim() || 'Ny uppgift';
    var projectId = quickAddProject.value || null;

    // Create the task
    var tasks = getTasks();
    var taskId = generateId();
    tasks.push({ id: taskId, projectId: projectId, name: name });
    saveTasks(tasks);

    // Add to schedule
    var schedule = getSchedule();
    schedule.items.push({ taskId: taskId, done: false });
    saveSchedule(schedule);

    quickAddModal.classList.add('hidden');
    updateTaskBanner();
  }

  // Close modals on backdrop click
  [logModal, scheduleModal, projectModal, taskModal, taskDetailModal, quickAddModal].forEach(function (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  });

  // ========================================
  // Stats
  // ========================================
  var statsPeriod = 'day';
  var statsOffset = 0;

  statsTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      statsTabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      statsPeriod = tab.dataset.period;
      statsOffset = 0;
      renderStats();
    });
  });

  statsPrev.addEventListener('click', function () {
    statsOffset++;
    renderStats();
  });

  statsNext.addEventListener('click', function () {
    if (statsOffset > 0) {
      statsOffset--;
      renderStats();
    }
  });

  function getDateRange(period, offset) {
    var now = new Date();
    var start, end, label;

    if (period === 'day') {
      var d = new Date(now);
      d.setDate(d.getDate() - offset);
      var dateStr = d.toISOString().slice(0, 10);
      start = dateStr;
      end = dateStr;
      if (offset === 0) {
        label = 'Idag';
      } else if (offset === 1) {
        label = 'Ig\u00e5r';
      } else {
        label = d.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'short' });
      }
    } else if (period === 'week') {
      var monday = new Date(now);
      var dayOfWeek = monday.getDay();
      var diff = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
      monday.setDate(monday.getDate() - diff - (offset * 7));
      var sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      start = monday.toISOString().slice(0, 10);
      end = sunday.toISOString().slice(0, 10);
      if (offset === 0) {
        label = 'Denna vecka';
      } else if (offset === 1) {
        label = 'F\u00f6rra veckan';
      } else {
        label = monday.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' }) +
          ' \u2013 ' + sunday.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
      }
    } else {
      var monthDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      var lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      start = monthDate.toISOString().slice(0, 10);
      end = lastDay.toISOString().slice(0, 10);
      label = monthDate.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
      label = label.charAt(0).toUpperCase() + label.slice(1);
    }

    return { start: start, end: end, label: label };
  }

  function renderStats() {
    var range = getDateRange(statsPeriod, statsOffset);
    statsPeriodLabel.textContent = range.label;

    var sessions = getSessions();
    var filtered = sessions.filter(function (s) {
      return s.date >= range.start && s.date <= range.end;
    });

    var activities = {};
    var totalMinutes = 0;
    filtered.forEach(function (s) {
      if (!activities[s.activity]) {
        activities[s.activity] = { minutes: 0, count: 0 };
      }
      activities[s.activity].minutes += s.duration;
      activities[s.activity].count++;
      totalMinutes += s.duration;
    });

    var sorted = Object.keys(activities).map(function (name) {
      return { name: name, minutes: activities[name].minutes, count: activities[name].count };
    }).sort(function (a, b) { return b.minutes - a.minutes; });

    var hours = Math.floor(totalMinutes / 60);
    var mins = totalMinutes % 60;
    var timeStr = hours > 0 ? hours + 'h ' + mins + 'min' : mins + ' min';
    statsSummary.innerHTML =
      '<div class="total-time">' + timeStr + '</div>' +
      '<div class="total-label">Total tid</div>' +
      '<div class="total-sessions">' + filtered.length + ' pomodoro' + (filtered.length !== 1 ? 's' : '') + '</div>';

    if (sorted.length === 0) {
      statsBreakdown.innerHTML = '<div class="no-data">Inga sessioner under denna period</div>';
      return;
    }

    var maxMinutes = sorted[0].minutes;
    statsBreakdown.innerHTML = sorted.map(function (item) {
      var pct = Math.round((item.minutes / maxMinutes) * 100);
      var h = Math.floor(item.minutes / 60);
      var m = item.minutes % 60;
      var t = h > 0 ? h + 'h ' + m + 'min' : m + ' min';
      return '<div class="activity-row">' +
        '<div class="activity-header">' +
        '<span class="activity-name">' + escapeHtml(item.name) + '</span>' +
        '<span class="activity-time">' + t + '</span>' +
        '</div>' +
        '<div class="activity-bar-bg"><div class="activity-bar" style="width:' + pct + '%"></div></div>' +
        '<div class="activity-sessions">' + item.count + ' session' + (item.count !== 1 ? 'er' : '') + '</div>' +
        '</div>';
    }).join('');
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ========================================
  // Theme toggle
  // ========================================
  var btnThemeToggle = document.getElementById('btn-theme-toggle');

  function applyTheme(light) {
    if (light) {
      document.body.classList.add('light-theme');
      btnThemeToggle.innerHTML = '&#9788;'; // sun
      document.querySelector('meta[name="theme-color"]').content = '#f0f0f5';
    } else {
      document.body.classList.remove('light-theme');
      btnThemeToggle.innerHTML = '&#9789;'; // moon
      document.querySelector('meta[name="theme-color"]').content = '#1a1a2e';
    }
  }

  btnThemeToggle.addEventListener('click', function () {
    var isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('pomodoro_theme', isLight ? 'light' : 'dark');
    applyTheme(isLight);
    haptic(10);
  });

  // ========================================
  // Haptic feedback
  // ========================================
  function haptic(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) {}
  }

  // ========================================
  // Streak counter
  // ========================================
  var streakCounter = document.getElementById('streak-counter');

  function calculateStreak() {
    var sessions = getSessions();
    if (sessions.length === 0) return 0;
    var dates = {};
    for (var i = 0; i < sessions.length; i++) {
      dates[sessions[i].date] = true;
    }
    var d = new Date();
    // If no session today, start from yesterday
    if (!dates[d.toISOString().slice(0, 10)]) {
      d.setDate(d.getDate() - 1);
    }
    var streak = 0;
    while (dates[d.toISOString().slice(0, 10)]) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function updateStreakCounter() {
    var streak = calculateStreak();
    if (streak >= 2) {
      streakCounter.textContent = streak + ' dagar i rad!';
    } else {
      streakCounter.textContent = '';
    }
  }

  // ========================================
  // Day start time & time estimate
  // ========================================
  var dayStartTimeInput = document.getElementById('day-start-time');
  var scheduleTimeEstimate = document.getElementById('schedule-time-estimate');

  dayStartTimeInput.value = localStorage.getItem('pomodoro_day_start') || '09:00';
  dayStartTimeInput.addEventListener('change', function () {
    localStorage.setItem('pomodoro_day_start', dayStartTimeInput.value);
    renderSchedule();
  });

  function getDayStartMinutes() {
    var val = dayStartTimeInput.value || '09:00';
    var parts = val.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }

  function formatMinutesAsTime(totalMin) {
    var h = Math.floor(totalMin / 60) % 24;
    var m = totalMin % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function updateTimeEstimate() {
    var schedule = getSchedule();
    var totalPoms = schedule.items.length;
    if (totalPoms === 0) {
      scheduleTimeEstimate.textContent = '';
      return;
    }
    var totalMin = totalPoms * WORK_MINUTES + (totalPoms - 1) * BREAK_MINUTES;
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    var str = '~';
    if (h > 0) str += h + 'h ';
    str += m + 'min planerat';
    scheduleTimeEstimate.textContent = str;
  }

  // ========================================
  // Recurring tasks
  // ========================================
  var taskDetailRecurring = document.getElementById('task-detail-recurring');

  function autoAddRecurringTasks() {
    var tasks = getTasks();
    var schedule = getSchedule();
    var scheduledTaskIds = schedule.items.map(function (i) { return i.taskId; });
    var today = new Date();
    var dayOfWeek = today.getDay(); // 0=sun

    var changed = false;
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (!t.recurring) continue;
      if (scheduledTaskIds.indexOf(t.id) !== -1) continue;

      if (t.recurring === 'daily') {
        schedule.items.push({ taskId: t.id, done: false });
        scheduledTaskIds.push(t.id);
        changed = true;
      } else if (t.recurring === 'weekly') {
        // Add on same weekday as creation, default monday (1)
        var recurDay = t.recurDay != null ? t.recurDay : 1;
        if (dayOfWeek === recurDay) {
          schedule.items.push({ taskId: t.id, done: false });
          scheduledTaskIds.push(t.id);
          changed = true;
        }
      }
    }
    if (changed) saveSchedule(schedule);
  }

  // ========================================
  // Confetti effect
  // ========================================
  var confettiCanvas = document.getElementById('confetti-canvas');
  var confettiCtx = confettiCanvas.getContext('2d');
  var confettiParticles = [];
  var confettiRunning = false;

  function launchConfetti() {
    if (confettiRunning) return;
    confettiRunning = true;
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
    confettiParticles = [];

    var colors = ['#e94560', '#53a8b6', '#f0a500', '#a855f7', '#34d399', '#f472b6', '#60a5fa', '#fb923c'];
    for (var i = 0; i < 80; i++) {
      confettiParticles.push({
        x: Math.random() * confettiCanvas.width,
        y: -20 - Math.random() * 200,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.2,
        life: 1
      });
    }
    haptic(50);
    requestAnimationFrame(animateConfetti);
  }

  function animateConfetti() {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    var alive = false;
    for (var i = 0; i < confettiParticles.length; i++) {
      var p = confettiParticles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.rot += p.rotV;
      p.life -= 0.005;
      if (p.life <= 0 || p.y > confettiCanvas.height + 20) continue;
      alive = true;
      confettiCtx.save();
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate(p.rot);
      confettiCtx.globalAlpha = p.life;
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      confettiCtx.restore();
    }
    if (alive) {
      requestAnimationFrame(animateConfetti);
    } else {
      confettiRunning = false;
      confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
  }

  var lastAllDoneState = false;
  function checkAllDoneConfetti() {
    var schedule = getSchedule();
    var realItems = schedule.items.filter(function (i) { return i.taskId; });
    if (realItems.length === 0) { lastAllDoneState = false; return; }
    var allDone = realItems.every(function (i) { return i.done; });
    if (allDone && !lastAllDoneState) {
      launchConfetti();
    }
    lastAllDoneState = allDone;
  }

  // ========================================
  // Swipe gestures on timer schedule items
  // ========================================
  function initTimerSwipe(el, idx) {
    var startX = 0, currentX = 0, swiping = false;
    var inner = el.querySelector('.ts-item-inner');
    var bgDone = el.querySelector('.bg-done');
    var bgRemove = el.querySelector('.bg-remove');
    var threshold = 80;

    function onTouchStart(e) {
      if (e.touches.length !== 1) return;
      if (e.target.closest('.btn-tiny')) return;
      startX = e.touches[0].clientX;
      currentX = startX;
      swiping = true;
      el.classList.add('swiping');
    }

    function onTouchMove(e) {
      if (!swiping) return;
      currentX = e.touches[0].clientX;
      var dx = currentX - startX;
      inner.style.transform = 'translateX(' + dx + 'px)';
      if (dx > 20) {
        bgDone.style.opacity = Math.min(1, (dx - 20) / threshold);
        bgRemove.style.opacity = 0;
      } else if (dx < -20) {
        bgRemove.style.opacity = Math.min(1, (-dx - 20) / threshold);
        bgDone.style.opacity = 0;
      } else {
        bgDone.style.opacity = 0;
        bgRemove.style.opacity = 0;
      }
    }

    function onTouchEnd() {
      if (!swiping) return;
      swiping = false;
      el.classList.remove('swiping');
      var dx = currentX - startX;
      if (dx > threshold) {
        // Swipe right → mark done
        haptic(15);
        el.classList.add('swipe-away');
        setTimeout(function () {
          var schedule = getSchedule();
          if (idx < schedule.items.length) {
            schedule.items[idx].done = true;
            saveSchedule(schedule);
            updateTaskBanner();
            checkAllDoneConfetti();
          }
        }, 250);
        return;
      } else if (dx < -threshold) {
        // Swipe left → remove
        haptic(15);
        el.classList.add('swipe-away-left');
        setTimeout(function () {
          var schedule = getSchedule();
          if (idx < schedule.items.length) {
            schedule.items.splice(idx, 1);
            saveSchedule(schedule);
            updateTaskBanner();
          }
        }, 250);
        return;
      }
      // Snap back
      inner.style.transform = '';
      bgDone.style.opacity = 0;
      bgRemove.style.opacity = 0;
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd);
  }

  // ========================================
  // Play button (quick-start from plan view)
  // ========================================
  function playTask(taskId) {
    haptic(12);
    // Ensure task is in schedule
    var schedule = getSchedule();
    var found = false;
    for (var i = 0; i < schedule.items.length; i++) {
      if (schedule.items[i].taskId === taskId && !schedule.items[i].done) {
        found = true;
        break;
      }
    }
    if (!found) {
      schedule.items.push({ taskId: taskId, done: false });
      saveSchedule(schedule);
    }

    // Reorder so this task's first undone item is at the front of undone items
    schedule = getSchedule();
    var firstUndone = -1;
    for (var i = 0; i < schedule.items.length; i++) {
      if (!schedule.items[i].done) {
        firstUndone = i;
        break;
      }
    }
    var targetIdx = -1;
    for (var i = 0; i < schedule.items.length; i++) {
      if (schedule.items[i].taskId === taskId && !schedule.items[i].done) {
        targetIdx = i;
        break;
      }
    }
    if (targetIdx > firstUndone) {
      var item = schedule.items.splice(targetIdx, 1)[0];
      schedule.items.splice(firstUndone, 0, item);
      saveSchedule(schedule);
    }

    // Switch to timer view and start
    navBtns.forEach(function (b) { b.classList.remove('active'); });
    navBtns[0].classList.add('active');
    views.forEach(function (v) { v.classList.remove('active'); });
    document.getElementById('timer-view').classList.add('active');
    updateTaskBanner();

    if (!isRunning && !isBreak) {
      startTimer();
    }
  }

  // ========================================
  // Init
  // ========================================

  // Migrate: assign colors to projects that don't have one
  (function migrateProjectColors() {
    var projects = getProjects();
    var changed = false;
    var usedColors = projects.map(function (p) { return p.color; }).filter(Boolean);
    for (var i = 0; i < projects.length; i++) {
      if (!projects[i].color) {
        // Pick first unused color
        for (var c = 0; c < PROJECT_COLORS.length; c++) {
          if (usedColors.indexOf(PROJECT_COLORS[c]) === -1) {
            projects[i].color = PROJECT_COLORS[c];
            usedColors.push(PROJECT_COLORS[c]);
            changed = true;
            break;
          }
        }
        if (!projects[i].color) {
          projects[i].color = PROJECT_COLORS[i % PROJECT_COLORS.length];
          changed = true;
        }
      }
    }
    if (changed) saveProjects(projects);
  })();

  // Apply saved theme
  applyTheme(localStorage.getItem('pomodoro_theme') === 'light');

  // Auto-add recurring tasks for today
  autoAddRecurringTasks();

  updateDisplay();
  countTodayPomodoros();
  updateTaskBanner();
  updateStreakCounter();

  // Update now-line position every 60 s
  setInterval(function () {
    if (!isRunning) updateTaskBanner();
  }, 60000);
})();
