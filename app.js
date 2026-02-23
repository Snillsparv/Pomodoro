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

  // --- State ---
  var timeLeft = WORK_SECONDS;
  var isRunning = false;
  var isBreak = false;
  var intervalId = null;
  var todayPomodoros = 0;
  var activeScheduleIndex = -1; // which schedule item is active in timer
  var addTaskToProjectId = null; // which project we're adding a task to

  // --- DOM Elements ---
  var timerDisplay = document.getElementById('timer-display');
  var sessionLabel = document.getElementById('session-label');
  var btnStart = document.getElementById('btn-start');
  var btnPause = document.getElementById('btn-pause');
  var btnReset = document.getElementById('btn-reset');
  var pomodoroCount = document.getElementById('pomodoro-count');
  var currentTaskBanner = document.getElementById('current-task-banner');
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

  function getSchedule() {
    var data = JSON.parse(localStorage.getItem('pomodoro_schedule') || '{}');
    if (data.date !== todayStr()) {
      return { date: todayStr(), items: [] };
    }
    return data;
  }

  function saveSchedule(schedule) {
    localStorage.setItem('pomodoro_schedule', JSON.stringify(schedule));
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
      return;
    }

    // Find first incomplete item
    var idx = -1;
    for (var i = 0; i < schedule.items.length; i++) {
      if (schedule.items[i].completed < schedule.items[i].pomodoros) {
        idx = i;
        break;
      }
    }

    if (idx === -1) {
      currentTaskBanner.innerHTML = '<span class="banner-done">Alla uppgifter klara!</span>';
      currentTaskBanner.classList.remove('hidden');
      activeScheduleIndex = -1;
      return;
    }

    activeScheduleIndex = idx;
    var item = schedule.items[idx];
    var tasks = getTasks();
    var projects = getProjects();
    var task = tasks.filter(function (t) { return t.id === item.taskId; })[0];
    var project = task ? projects.filter(function (p) { return p.id === task.projectId; })[0] : null;

    var projectName = project ? project.name : '';
    var taskName = task ? task.name : 'Okänd uppgift';
    var progress = item.completed + '/' + item.pomodoros;
    var color = getProjectColor(project);

    currentTaskBanner.style.borderLeft = '4px solid ' + color;
    currentTaskBanner.innerHTML =
      '<span class="banner-project" style="color:' + color + '">' + escapeHtml(projectName) + '</span>' +
      '<span class="banner-task">' + escapeHtml(taskName) + '</span>' +
      '<span class="banner-progress">' + progress + '</span>';
    currentTaskBanner.classList.remove('hidden');
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
        isBreak = false;
        timeLeft = WORK_SECONDS;
        updateDisplay();
        btnStart.textContent = 'Starta';
        btnStart.disabled = false;
        btnPause.disabled = true;
        sessionLabel.textContent = '';
        updateTaskBanner();
      } else {
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
    updateDisplay();
  }

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

    var activityName = (project ? project.name + ' — ' : '') + (task ? task.name : 'Okänd');

    // Save session
    var sessions = getSessions();
    sessions.push({
      activity: activityName,
      duration: WORK_MINUTES,
      date: todayStr(),
      timestamp: Date.now()
    });
    saveSessions(sessions);

    // Update schedule progress
    item.completed++;
    saveSchedule(schedule);

    todayPomodoros++;
    updatePomodoroCount();

    // Start break
    isBreak = true;
    timeLeft = BREAK_SECONDS;
    updateDisplay();
    startTimer();
  }

  function startTimer() {
    if (isRunning) return;
    isRunning = true;
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
      if (target === 'plan') renderPlanView();
      if (target === 'timer') updateTaskBanner();
    });
  });

  // ========================================
  // Projects & Tasks (Planera)
  // ========================================
  function renderPlanView() {
    renderSchedule();
    renderProjects();
  }

  // --- Projects ---
  function renderProjects() {
    var projects = getProjects();
    var tasks = getTasks();

    if (projects.length === 0) {
      projectsList.innerHTML = '<div class="no-data">Inga projekt &auml;nnu</div>';
      return;
    }

    projectsList.innerHTML = projects.map(function (proj) {
      var projTasks = tasks.filter(function (t) { return t.projectId === proj.id; });
      var taskHtml = projTasks.map(function (task) {
        return '<div class="task-item" data-task-id="' + task.id + '">' +
          '<span class="task-name">' + escapeHtml(task.name) + '</span>' +
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

  // --- Schedule ---
  function renderSchedule() {
    var schedule = getSchedule();
    var tasks = getTasks();
    var projects = getProjects();

    if (schedule.items.length === 0) {
      scheduleList.innerHTML = '';
      scheduleEmpty.classList.remove('hidden');
      return;
    }

    scheduleEmpty.classList.add('hidden');
    scheduleList.innerHTML = schedule.items.map(function (item, idx) {
      var task = tasks.filter(function (t) { return t.id === item.taskId; })[0];
      var project = task ? projects.filter(function (p) { return p.id === task.projectId; })[0] : null;
      var isDone = item.completed >= item.pomodoros;

      var color = getProjectColor(project);
      return '<div class="schedule-item' + (isDone ? ' done' : '') + '" style="border-left:4px solid ' + color + '">' +
        '<div class="schedule-item-info">' +
        '<span class="schedule-project" style="color:' + color + '">' + escapeHtml(project ? project.name : '') + '</span>' +
        '<span class="schedule-task">' + escapeHtml(task ? task.name : 'Borttagen') + '</span>' +
        '</div>' +
        '<div class="schedule-item-controls">' +
        '<button class="btn-pom-minus btn-tiny" data-idx="' + idx + '">&minus;</button>' +
        '<span class="schedule-pom-count">' + item.completed + '/' + item.pomodoros + '</span>' +
        '<button class="btn-pom-plus btn-tiny" data-idx="' + idx + '">+</button>' +
        '<button class="btn-move-up btn-tiny" data-idx="' + idx + '">&uarr;</button>' +
        '<button class="btn-move-down btn-tiny" data-idx="' + idx + '">&darr;</button>' +
        '<button class="btn-remove-schedule btn-tiny" data-idx="' + idx + '">&times;</button>' +
        '</div>' +
        '</div>';
    }).join('');

    // Event listeners
    scheduleList.querySelectorAll('.btn-pom-minus').forEach(function (btn) {
      btn.addEventListener('click', function () {
        changePomCount(parseInt(btn.dataset.idx), -1);
      });
    });
    scheduleList.querySelectorAll('.btn-pom-plus').forEach(function (btn) {
      btn.addEventListener('click', function () {
        changePomCount(parseInt(btn.dataset.idx), 1);
      });
    });
    scheduleList.querySelectorAll('.btn-move-up').forEach(function (btn) {
      btn.addEventListener('click', function () {
        moveScheduleItem(parseInt(btn.dataset.idx), -1);
      });
    });
    scheduleList.querySelectorAll('.btn-move-down').forEach(function (btn) {
      btn.addEventListener('click', function () {
        moveScheduleItem(parseInt(btn.dataset.idx), 1);
      });
    });
    scheduleList.querySelectorAll('.btn-remove-schedule').forEach(function (btn) {
      btn.addEventListener('click', function () {
        removeScheduleItem(parseInt(btn.dataset.idx));
      });
    });
  }

  function changePomCount(idx, delta) {
    var schedule = getSchedule();
    var item = schedule.items[idx];
    if (!item) return;
    item.pomodoros = Math.max(1, item.pomodoros + delta);
    saveSchedule(schedule);
    renderSchedule();
  }

  function moveScheduleItem(idx, direction) {
    var schedule = getSchedule();
    var newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= schedule.items.length) return;
    var temp = schedule.items[idx];
    schedule.items[idx] = schedule.items[newIdx];
    schedule.items[newIdx] = temp;
    saveSchedule(schedule);
    renderSchedule();
  }

  function removeScheduleItem(idx) {
    var schedule = getSchedule();
    schedule.items.splice(idx, 1);
    saveSchedule(schedule);
    renderSchedule();
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
    schedule.items.push({ taskId: taskId, pomodoros: 1, completed: 0 });
    saveSchedule(schedule);
  }

  // Close modals on backdrop click
  [logModal, scheduleModal, projectModal, taskModal].forEach(function (modal) {
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
  // Init
  // ========================================
  updateDisplay();
  countTodayPomodoros();
  updateTaskBanner();
})();
