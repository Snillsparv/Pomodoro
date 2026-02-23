(function () {
  'use strict';

  // --- Constants ---
  const WORK_MINUTES = 25;
  const BREAK_MINUTES = 5;
  const WORK_SECONDS = WORK_MINUTES * 60;
  const BREAK_SECONDS = BREAK_MINUTES * 60;

  // --- State ---
  let timeLeft = WORK_SECONDS;
  let isRunning = false;
  let isBreak = false;
  let intervalId = null;
  let todayPomodoros = 0;

  // --- DOM Elements ---
  const timerDisplay = document.getElementById('timer-display');
  const sessionLabel = document.getElementById('session-label');
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnReset = document.getElementById('btn-reset');
  const pomodoroCount = document.getElementById('pomodoro-count');
  const logModal = document.getElementById('log-modal');
  const activityInput = document.getElementById('activity-input');
  const activitySuggestions = document.getElementById('activity-suggestions');
  const btnSaveActivity = document.getElementById('btn-save-activity');
  const navBtns = document.querySelectorAll('.nav-btn');
  const views = document.querySelectorAll('.view');
  const statsTabs = document.querySelectorAll('.stats-tab');
  const statsPrev = document.getElementById('stats-prev');
  const statsNext = document.getElementById('stats-next');
  const statsPeriodLabel = document.getElementById('stats-period-label');
  const statsSummary = document.getElementById('stats-summary');
  const statsBreakdown = document.getElementById('stats-breakdown');

  // --- Storage helpers ---
  function getSessions() {
    return JSON.parse(localStorage.getItem('pomodoro_sessions') || '[]');
  }

  function saveSessions(sessions) {
    localStorage.setItem('pomodoro_sessions', JSON.stringify(sessions));
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

  // --- Timer ---
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

  function countTodayPomodoros() {
    var sessions = getSessions();
    var today = new Date().toISOString().slice(0, 10);
    var count = 0;
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].date === today) count++;
    }
    todayPomodoros = count;
    updatePomodoroCount();
  }

  function updatePomodoroCount() {
    if (todayPomodoros > 0) {
      pomodoroCount.textContent = todayPomodoros + ' pomodoro' + (todayPomodoros !== 1 ? 's' : '') + ' idag';
    } else {
      pomodoroCount.textContent = '';
    }
  }

  function tick() {
    timeLeft--;
    if (timeLeft < 0) {
      clearInterval(intervalId);
      intervalId = null;
      isRunning = false;

      if (isBreak) {
        // Break ended, reset to work
        isBreak = false;
        timeLeft = WORK_SECONDS;
        updateDisplay();
        btnStart.textContent = 'Starta';
        btnPause.disabled = true;
        sessionLabel.textContent = '';
      } else {
        // Work ended, show log modal
        timeLeft = 0;
        updateDisplay();
        btnPause.disabled = true;
        showLogModal();
      }
      return;
    }
    updateDisplay();
  }

  function startTimer() {
    if (isRunning) return;
    isRunning = true;
    btnStart.textContent = isBreak ? 'Starta' : 'Starta';
    btnStart.disabled = true;
    btnPause.disabled = false;
    intervalId = setInterval(tick, 1000);
    updateDisplay();
  }

  function pauseTimer() {
    if (!isRunning) return;
    isRunning = false;
    clearInterval(intervalId);
    intervalId = null;
    btnStart.disabled = false;
    btnPause.disabled = true;
  }

  function resetTimer() {
    pauseTimer();
    isBreak = false;
    timeLeft = WORK_SECONDS;
    btnStart.disabled = false;
    btnStart.textContent = 'Starta';
    sessionLabel.textContent = '';
    updateDisplay();
  }

  btnStart.addEventListener('click', startTimer);
  btnPause.addEventListener('click', pauseTimer);
  btnReset.addEventListener('click', resetTimer);

  // --- Activity logging ---
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
      date: new Date().toISOString().slice(0, 10),
      timestamp: Date.now()
    });
    saveSessions(sessions);

    hideLogModal();
    todayPomodoros++;
    updatePomodoroCount();

    // Start break
    isBreak = true;
    timeLeft = BREAK_SECONDS;
    updateDisplay();
    startTimer();
  }

  // --- Navigation ---
  navBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.view;
      navBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      views.forEach(function (v) { v.classList.remove('active'); });
      document.getElementById(target + '-view').classList.add('active');
      if (target === 'stats') renderStats();
    });
  });

  // --- Stats ---
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

    // Aggregate by activity
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

    // Sort by minutes descending
    var sorted = Object.keys(activities).map(function (name) {
      return { name: name, minutes: activities[name].minutes, count: activities[name].count };
    }).sort(function (a, b) { return b.minutes - a.minutes; });

    // Render summary
    var hours = Math.floor(totalMinutes / 60);
    var mins = totalMinutes % 60;
    var timeStr = hours > 0 ? hours + 'h ' + mins + 'min' : mins + ' min';
    statsSummary.innerHTML =
      '<div class="total-time">' + timeStr + '</div>' +
      '<div class="total-label">Total tid</div>' +
      '<div class="total-sessions">' + filtered.length + ' pomodoro' + (filtered.length !== 1 ? 's' : '') + '</div>';

    // Render breakdown
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

  // --- Init ---
  updateDisplay();
  countTodayPomodoros();
})();
