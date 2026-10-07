/*
 * Kärnlogik för planeringen: datum, översikt, deadlines, statistik,
 * migrering från gamla versionen samt export/import av planen som text.
 * Ingen DOM här – samma kod körs i appen och i testerna (node --test).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlanCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_MS = 86400000;

  var WEEKDAYS = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
  var WEEKDAYS_SHORT = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
  var MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli',
    'augusti', 'september', 'oktober', 'november', 'december'];
  var MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

  var PROJECT_COLORS = ['#e5484d', '#0f9bb8', '#d99a0b', '#8b5cf6', '#22a06b', '#3b82f6', '#e0559f', '#ee7a2c'];
  var NO_PROJECT_COLOR = '#8e8e98';
  var NO_PROJECT_NAME = 'Övrigt';

  var RECURRING = {
    daily: 'varje dag',
    weekdays: 'varje vardag',
    weekly: 'varje vecka'
  };

  // ========================================
  // Datum (alltid lokala 'YYYY-MM-DD'-strängar)
  // ========================================
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function toDateStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // Klockan 12 lokal tid så att sommartid aldrig flyttar datumet
  function parseDate(s) {
    return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12);
  }

  function isDateStr(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    return toDateStr(parseDate(s)) === s;
  }

  function addDays(s, n) {
    var d = parseDate(s);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }

  function diffDays(from, to) {
    return Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
  }

  function weekdayOf(s) {
    return parseDate(s).getDay();
  }

  function isWeekend(s) {
    var w = weekdayOf(s);
    return w === 0 || w === 6;
  }

  // Måndag i samma vecka
  function startOfWeek(s) {
    return addDays(s, -((weekdayOf(s) + 6) % 7));
  }

  // ISO-veckonummer (vecka 1 är veckan med 4 januari)
  function isoWeek(s) {
    var thursday = addDays(startOfWeek(s), 3);
    var firstThursday = addDays(startOfWeek(thursday.slice(0, 4) + '-01-04'), 3);
    return 1 + Math.round(diffDays(firstThursday, thursday) / 7);
  }

  function normalizeTime(t) {
    if (typeof t !== 'string') return null;
    var m = /^(\d{1,2})[:.](\d{2})$/.exec(t.trim());
    if (!m) return null;
    var h = +m[1];
    var min = +m[2];
    if (h > 23 || min > 59) return null;
    return pad(h) + ':' + pad(min);
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // '7 okt' (+ år om det inte är samma år som idag)
  function formatDayMonth(s, today) {
    var d = parseDate(s);
    var out = d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
    if (today && s.slice(0, 4) !== today.slice(0, 4)) out += ' ' + s.slice(0, 4);
    return out;
  }

  // 'ons 7 okt'
  function formatShort(s, today) {
    return WEEKDAYS_SHORT[weekdayOf(s)] + ' ' + formatDayMonth(s, today);
  }

  // 'onsdag 7 oktober 2026'
  function formatLong(s) {
    var d = parseDate(s);
    return WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  // 'Idag', 'Imorgon', 'Igår' eller 'Fredag 9 okt'
  function formatDayHeading(s, today) {
    var n = diffDays(today, s);
    if (n === 0) return 'Idag';
    if (n === 1) return 'Imorgon';
    if (n === -1) return 'Igår';
    return capitalize(WEEKDAYS[weekdayOf(s)]) + ' ' + formatDayMonth(s, today);
  }

  // 'idag', 'imorgon', 'om 5 dagar', 'om 4 veckor', 'för 2 dagar sedan'
  function formatRelative(s, today) {
    var n = diffDays(today, s);
    if (n === 0) return 'idag';
    if (n === 1) return 'imorgon';
    if (n === -1) return 'igår';
    var abs = Math.abs(n);
    var amount = abs < 21 ? abs + ' dagar' : Math.floor(abs / 7) + ' veckor';
    return n > 0 ? 'om ' + amount : 'för ' + amount + ' sedan';
  }

  // '12–18 okt' eller '26 okt – 1 nov'
  function formatRange(from, to, today) {
    var a = parseDate(from);
    var b = parseDate(to);
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
      return a.getDate() + '–' + formatDayMonth(to, today);
    }
    return formatDayMonth(from, today) + ' – ' + formatDayMonth(to, today);
  }

  // Kompakt: '50 min', '4,2 h'
  function formatHours(total) {
    total = Math.round(total);
    if (total < 60) return total + ' min';
    var h = Math.round(total / 6) / 10;
    return String(h).replace('.', ',') + ' h';
  }

  function formatMinutes(total) {
    total = Math.round(total);
    var h = Math.floor(total / 60);
    var m = total % 60;
    if (h === 0) return m + ' min';
    return m === 0 ? h + ' h' : h + ' h ' + m + ' min';
  }

  // ========================================
  // Datamodell
  // ========================================
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function text(v) {
    return typeof v === 'string' ? v : (v == null ? '' : String(v));
  }

  function oneLine(s) {
    return text(s).replace(/\s+/g, ' ').trim();
  }

  function normName(s) {
    return text(s).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function indexById(list) {
    var map = {};
    for (var i = 0; i < list.length; i++) map[list[i].id] = list[i];
    return map;
  }

  function nextColor(projects) {
    var used = projects.map(function (p) { return p.color; });
    for (var i = 0; i < PROJECT_COLORS.length; i++) {
      if (used.indexOf(PROJECT_COLORS[i]) === -1) return PROJECT_COLORS[i];
    }
    return PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
  }

  function isColor(c) {
    return typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
  }

  function normalizeProject(p, i) {
    if (!p || typeof p !== 'object' || p.id == null || p.id === '') return null;
    return {
      id: String(p.id),
      name: oneLine(p.name) || 'Namnlöst projekt',
      color: isColor(p.color) ? p.color : PROJECT_COLORS[i % PROJECT_COLORS.length],
      deadline: isDateStr(p.deadline) ? p.deadline : null,
      notes: text(p.notes),
      archived: !!p.archived,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0
    };
  }

  function normalizeTask(t, projectIds) {
    if (!t || typeof t !== 'object' || t.id == null || t.id === '') return null;
    var date = isDateStr(t.date) ? t.date : null;
    var done = !!t.done;
    return {
      id: String(t.id),
      projectId: t.projectId != null && projectIds[t.projectId] ? String(t.projectId) : null,
      name: oneLine(t.name) || 'Namnlös uppgift',
      notes: text(t.notes != null ? t.notes : t.description),
      date: date,
      time: date ? normalizeTime(t.time) : null,
      recurring: date && RECURRING.hasOwnProperty(t.recurring) ? t.recurring : null,
      done: done,
      doneAt: done && typeof t.doneAt === 'number' ? t.doneAt : null,
      createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0
    };
  }

  function normalizeSession(s) {
    if (!s || typeof s !== 'object') return null;
    var duration = typeof s.duration === 'number' && s.duration > 0 ? s.duration : 25;
    var timestamp = typeof s.timestamp === 'number' ? s.timestamp : null;
    var date = isDateStr(s.date) ? s.date : (timestamp ? toDateStr(new Date(timestamp)) : null);
    if (!date) return null;
    var out = { activity: text(s.activity), duration: duration, date: date, timestamp: timestamp };
    if (s.taskId) out.taskId = String(s.taskId);
    if (s.projectId) out.projectId = String(s.projectId);
    return out;
  }

  function normalizeData(raw) {
    raw = raw || {};
    var projects = (Array.isArray(raw.projects) ? raw.projects : [])
      .map(normalizeProject).filter(Boolean);
    var seen = {};
    projects = projects.filter(function (p) {
      if (seen[p.id]) return false;
      seen[p.id] = true;
      return true;
    });
    var tasks = (Array.isArray(raw.tasks) ? raw.tasks : [])
      .map(function (t) { return normalizeTask(t, seen); }).filter(Boolean);
    var sessions = (Array.isArray(raw.sessions) ? raw.sessions : [])
      .map(normalizeSession).filter(Boolean);
    return { projects: projects, tasks: tasks, sessions: sessions };
  }

  // Ett schemablock från gamla versionen räknas som oavklarat om något pass
  // återstår (två format: {taskId, done} och {taskId, pomodoros, completed})
  function unfinishedIds(items) {
    var ids = {};
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it || !it.taskId) return;
      var open = typeof it.done !== 'undefined' ? !it.done : (it.completed || 0) < (it.pomodoros || 1);
      if (open) ids[it.taskId] = true;
    });
    return ids;
  }

  // Gamla versionen: uppgifter utan datum + ett dagsschema med pomodoro-block.
  // Uppgifter i dagens schema får dagens datum. Oavklarade uppgifter från det
  // senaste schemat före idag (det gamla "flytta över") får det datumet och
  // syns som försenade. Återkommande uppgifter får sitt nästa datum och
  // resten hamnar under "Utan datum".
  // todayDates: datum som räknas som "idag" (lokalt + UTC, eftersom gamla
  // versionen sparade schemats datum i UTC).
  function migrateV1(old, todayDates, now) {
    old = old || {};
    var today = todayDates[0];
    var projects = (Array.isArray(old.projects) ? old.projects : []).filter(function (p) {
      return p && p.id != null;
    });
    var withColors = [];
    projects.forEach(function (p) {
      var copy = {};
      for (var k in p) copy[k] = p[k];
      if (!isColor(copy.color)) copy.color = nextColor(withColors);
      if (typeof copy.createdAt !== 'number') copy.createdAt = now;
      withColors.push(copy);
    });

    var inTodaysSchedule = {};
    var schedule = old.schedule;
    if (schedule && todayDates.indexOf(schedule.date) !== -1 && Array.isArray(schedule.items)) {
      schedule.items.forEach(function (it) {
        if (it && it.taskId) inTodaysSchedule[it.taskId] = true;
      });
    }

    // Senaste schemat före idag (högst två veckor gammalt)
    var past = {};
    var history = old.scheduleHistory && typeof old.scheduleHistory === 'object' ? old.scheduleHistory : {};
    Object.keys(history).forEach(function (d) { past[d] = history[d]; });
    if (schedule && isDateStr(schedule.date) && Array.isArray(schedule.items)) past[schedule.date] = schedule.items;
    var lastDate = Object.keys(past).filter(function (d) {
      return isDateStr(d) && d < today && todayDates.indexOf(d) === -1 && diffDays(d, today) <= 14;
    }).sort().pop();
    var carryover = lastDate ? unfinishedIds(past[lastDate]) : {};

    var tasks = (Array.isArray(old.tasks) ? old.tasks : []).map(function (t) {
      if (!t || typeof t !== 'object') return t;
      var copy = {};
      for (var k in t) copy[k] = t[k];
      var date = isDateStr(t.date) ? t.date : null;
      var weekly = t.recurring === 'weekly';
      if (t.recurring === 'daily') {
        date = date || today;
      } else if (weekly && !date) {
        // Veckorytmen behålls: nästa gång på samma veckodag som förut
        var wd = typeof t.recurDay === 'number' ? t.recurDay : 1;
        date = addDays(today, (wd - weekdayOf(today) + 7) % 7);
      } else if (!date && carryover[t.id]) {
        date = lastDate;
      }
      if (inTodaysSchedule[t.id] && !weekly) date = today;
      copy.date = date;
      copy.done = !!t.done;
      if (typeof copy.createdAt !== 'number') copy.createdAt = now;
      delete copy.recurDay;
      return copy;
    });

    return normalizeData({ projects: withColors, tasks: tasks, sessions: old.sessions });
  }

  // ========================================
  // Uppgifter
  // ========================================
  function nextOccurrence(rule, from, today) {
    var d = isDateStr(from) ? from : today;
    var step = rule === 'weekly' ? 7 : 1;
    do {
      d = addDays(d, step);
    } while (d <= today || (rule === 'weekdays' && isWeekend(d)));
    return d;
  }

  // Returnerar en ny version av uppgiften när den bockas av.
  // Återkommande uppgifter flyttas till nästa tillfälle i stället.
  function completeTask(task, today, now) {
    var copy = {};
    for (var k in task) copy[k] = task[k];
    if (task.recurring) {
      copy.date = nextOccurrence(task.recurring, task.date, today);
      copy.done = false;
      copy.doneAt = null;
    } else {
      copy.done = true;
      copy.doneAt = now;
    }
    return copy;
  }

  function compareTasks(a, b) {
    var da = a.date || '9999-99-99';
    var db = b.date || '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    if (!!a.time !== !!b.time) return a.time ? -1 : 1;
    if (a.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  }

  function doneOn(task) {
    return task.done && typeof task.doneAt === 'number' ? toDateStr(new Date(task.doneAt)) : null;
  }

  // ========================================
  // Översikt
  // ========================================
  // Grupperar allt framåt: Försenat, Idag, Imorgon, resten av veckan dag för
  // dag, sedan per vecka och till sist per månad. Projektens deadlines läggs
  // in på sina datum. Uppgifter utan datum hamnar sist.
  function buildAgenda(data, today, opts) {
    opts = opts || {};
    var weeksAhead = opts.weeksAhead != null ? opts.weeksAhead : 4;
    var projects = indexById(data.projects);
    var sections = {};
    var list = [];

    function section(key, title, subtitle, multiDay) {
      if (!sections[key]) {
        sections[key] = { key: key, title: title, subtitle: subtitle, multiDay: multiDay, date: null, items: [] };
        list.push(sections[key]);
      }
      return sections[key];
    }

    function sectionFor(date) {
      var n = diffDays(today, date);
      if (n < 0) return section('overdue', 'Försenat', '', true);
      if (n === 0) return section('today', 'Idag', formatShort(today, today), false);
      if (n === 1) return section('tomorrow', 'Imorgon', formatShort(date, today), false);
      if (n < 7) return section('day:' + date, capitalize(WEEKDAYS[weekdayOf(date)]), formatDayMonth(date, today), false);
      var week = startOfWeek(date);
      if (diffDays(startOfWeek(today), week) <= weeksAhead * 7) {
        // Dagarna före today+7 har egna rubriker ovanför, så intervallet börjar där
        var from = week < addDays(today, 7) ? addDays(today, 7) : week;
        return section('week:' + week, 'Vecka ' + isoWeek(date), formatRange(from, addDays(week, 6), today), true);
      }
      var month = date.slice(0, 7);
      var title = capitalize(MONTHS[+month.slice(5, 7) - 1]);
      if (month.slice(0, 4) !== today.slice(0, 4)) title += ' ' + month.slice(0, 4);
      return section('month:' + month, title, '', true);
    }

    var todaySection = section('today', 'Idag', formatShort(today, today), false);
    todaySection.date = today;

    data.tasks.forEach(function (t) {
      var p = t.projectId ? projects[t.projectId] : null;
      if (p && p.archived) return;
      if (t.done) {
        if (doneOn(t) === today) todaySection.items.push({ kind: 'task', task: t, date: today, done: true });
        return;
      }
      if (!t.date) return;
      var sec = sectionFor(t.date);
      sec.items.push({ kind: 'task', task: t, date: t.date, done: false });
    });

    data.projects.forEach(function (p) {
      if (p.archived || !p.deadline) return;
      sectionFor(p.deadline).items.push({ kind: 'deadline', project: p, date: p.deadline, done: false });
    });

    list.forEach(function (sec) {
      sec.items.sort(function (a, b) {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (a.kind !== b.kind) return a.kind === 'deadline' ? -1 : 1;
        if (a.kind === 'deadline') return a.project.name < b.project.name ? -1 : 1;
        return compareTasks(a.task, b.task);
      });
      if (!sec.multiDay && sec.items.length && !sec.date) sec.date = sec.items[0].date;
    });

    // Sektionernas datumintervall överlappar inte, så tidigaste datum ger rätt ordning
    function firstDate(sec) {
      if (sec.key === 'overdue') return '0000-00-00';
      if (sec.key === 'today') return today;
      return sec.items.length ? sec.items[0].date : '9999-99-99';
    }
    list.sort(function (a, b) {
      var fa = firstDate(a);
      var fb = firstDate(b);
      return fa < fb ? -1 : (fa > fb ? 1 : 0);
    });

    var someday = data.tasks.filter(function (t) {
      var p = t.projectId ? projects[t.projectId] : null;
      return !t.done && !t.date && !(p && p.archived);
    }).sort(function (a, b) {
      var pa = a.projectId && projects[a.projectId] ? projects[a.projectId].name.toLowerCase() : '￿';
      var pb = b.projectId && projects[b.projectId] ? projects[b.projectId].name.toLowerCase() : '￿';
      if (pa !== pb) return pa < pb ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    var overdue = sections.overdue ? sections.overdue.items.filter(function (i) { return i.kind === 'task'; }).length : 0;
    var todayOpen = 0;
    var todayDone = 0;
    todaySection.items.forEach(function (i) {
      if (i.kind !== 'task') return;
      if (i.done) todayDone++;
      else todayOpen++;
    });

    return {
      sections: list,
      someday: someday,
      counts: { overdue: overdue, todayOpen: todayOpen, todayDone: todayDone, someday: someday.length }
    };
  }

  // Läget för ett projekt: hur mycket som är kvar och hur bråttom det är
  function projectStats(project, tasks, today) {
    var own = tasks.filter(function (t) { return t.projectId === project.id; });
    var open = own.filter(function (t) { return !t.done; });
    var dated = open.filter(function (t) { return t.date; }).sort(compareTasks);
    var daysLeft = project.deadline ? diffDays(today, project.deadline) : null;
    var urgency = 'none';
    if (daysLeft !== null) {
      if (daysLeft < 0) urgency = 'overdue';
      else if (daysLeft <= 3) urgency = 'urgent';
      else if (daysLeft <= 14) urgency = 'soon';
      else urgency = 'later';
    }
    return {
      total: own.length,
      done: own.length - open.length,
      open: open.length,
      undated: open.length - dated.length,
      overdue: dated.filter(function (t) { return t.date < today; }).length,
      afterDeadline: project.deadline ? dated.filter(function (t) { return t.date > project.deadline; }).length : 0,
      next: dated[0] || open.slice().sort(compareTasks)[0] || null,
      daysLeft: daysLeft,
      urgency: urgency
    };
  }

  function sortProjects(projects) {
    return projects.slice().sort(function (a, b) {
      if (!!a.deadline !== !!b.deadline) return a.deadline ? -1 : 1;
      if (a.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  // ========================================
  // Fokusstatistik
  // ========================================
  function sessionDate(s) {
    return typeof s.timestamp === 'number' ? toDateStr(new Date(s.timestamp)) : s.date;
  }

  function focusStats(data, today, days) {
    days = days || 7;
    var projects = indexById(data.projects);
    var tasks = indexById(data.tasks);
    var byName = {};
    data.projects.forEach(function (p) { byName[normName(p.name)] = p; });

    function projectOf(s) {
      if (s.projectId && projects[s.projectId]) return s.projectId;
      if (s.taskId && tasks[s.taskId]) return tasks[s.taskId].projectId;
      var a = s.activity || '';
      var i = a.indexOf(' — ');
      if (i > 0 && byName[normName(a.slice(0, i))]) return byName[normName(a.slice(0, i))].id;
      return null;
    }

    var first = addDays(today, -(days - 1));
    var weekStart = startOfWeek(today);
    var perDay = {};
    var perProject = {};
    var perTask = {};
    var activeDays = {};
    var todayCount = 0;
    var todayMinutes = 0;
    var weekMinutes = 0;

    data.sessions.forEach(function (s) {
      var d = sessionDate(s);
      activeDays[d] = true;
      if (s.taskId) perTask[s.taskId] = (perTask[s.taskId] || 0) + 1;
      if (d >= first && d <= today) perDay[d] = (perDay[d] || 0) + s.duration;
      if (d === today) {
        todayCount++;
        todayMinutes += s.duration;
      }
      if (d >= weekStart && d <= today) {
        weekMinutes += s.duration;
        var pid = projectOf(s) || '';
        perProject[pid] = (perProject[pid] || 0) + s.duration;
      }
    });

    var byDay = [];
    for (var i = 0; i < days; i++) {
      var date = addDays(first, i);
      byDay.push({ date: date, minutes: perDay[date] || 0 });
    }

    var week = Object.keys(perProject).map(function (pid) {
      var p = projects[pid];
      return {
        projectId: pid || null,
        name: p ? p.name : NO_PROJECT_NAME,
        color: p ? p.color : NO_PROJECT_COLOR,
        minutes: perProject[pid]
      };
    }).sort(function (a, b) { return b.minutes - a.minutes; });

    var streak = 0;
    var cursor = activeDays[today] ? today : addDays(today, -1);
    while (activeDays[cursor]) {
      streak++;
      cursor = addDays(cursor, -1);
    }

    return {
      byDay: byDay,
      todayCount: todayCount,
      todayMinutes: todayMinutes,
      weekMinutes: weekMinutes,
      week: week,
      streak: streak,
      perTask: perTask
    };
  }

  // ========================================
  // Export som text (för att diskutera med Claude)
  // ========================================
  var NONE_NAMES = ['Övrigt', 'Inget projekt', 'Utan projekt'];
  var NONE_RE = /^(övrigt|inget projekt|utan projekt)$/i;

  // Rubriken för uppgifter utan projekt – får inte krocka med ett riktigt projekt
  function noneHeading(projects) {
    var taken = {};
    projects.forEach(function (p) { if (!p.archived) taken[normName(p.name)] = true; });
    for (var i = 0; i < NONE_NAMES.length; i++) {
      if (!taken[normName(NONE_NAMES[i])]) return NONE_NAMES[i];
    }
    return NONE_NAMES[0];
  }

  function claudeNote(none) {
    return [
      '> Till Claude: Det här är min planering från min Pomodoro-app. Hjälp mig att få överblick, prioritera och planera.',
      '> Om du föreslår ändringar: skriv dem i ETT kodblock i samma format som under "Plan", så klistrar jag in det i appen (Dela → Importera).',
      '> Format: `## Projektnamn | deadline ÅÅÅÅ-MM-DD` per projekt (`| deadline ingen` tar bort deadline; utan deadline-del lämnas den orörd).',
      '> Uppgifter under rubriken: `- [ ] ÅÅÅÅ-MM-DD HH:MM Namn (varje vecka)`. Datum, tid och upprepning (varje dag / varje vardag / varje vecka) är valfria; en öppen uppgift `[ ]` utan datum blir odaterad.',
      '> `[x]` = klar, `[-]` = ta bort – för dem räcker namnet. Uppgifter och projekt som inte står med lämnas orörda, så det räcker att skicka det som ändras.',
      '> Uppgifter utan projekt står under `## ' + none + '`. Rader som börjar med `>` är anteckningar och ignoreras. Ett `\\` först i ett namn betyder att resten ska läsas bokstavligt.'
    ];
  }

  var DATE_OR_TIME_START = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[:.]\d{2})(\s|$)/;
  var RECUR_END = /(\((?:varje dag|varje vardag|varje vecka)\)\s*)$/i;

  // Namn som annars skulle tolkas som datum, tid eller upprepning skyddas med \
  function escapeTaskName(name) {
    var out = name.replace(RECUR_END, '\\$1');
    if (DATE_OR_TIME_START.test(out) || out.charAt(0) === '\\') out = '\\' + out;
    return out;
  }

  function escapeProjectName(name) {
    var out = name.replace(/\|/g, '\\|');
    if (/^projekt\s*:/i.test(out) || /^(\*\*|__).*\1$/.test(out) || out.charAt(0) === '\\') out = '\\' + out;
    return out;
  }

  function exportTaskLine(t) {
    var parts = [t.done ? '- [x]' : '- [ ]'];
    if (t.date) parts.push(t.date);
    if (t.date && t.time) parts.push(t.time);
    parts.push(escapeTaskName(t.name));
    var line = parts.join(' ');
    if (t.recurring) line += ' (' + RECURRING[t.recurring] + ')';
    return line;
  }

  function quoteLines(s, indent) {
    return text(s).split('\n').map(function (l) { return l.trim(); }).filter(Boolean)
      .map(function (l) { return indent + '> ' + l; });
  }

  function exportText(data, today, now) {
    var projects = indexById(data.projects);
    var active = sortProjects(data.projects.filter(function (p) { return !p.archived; }));
    var none = noneHeading(data.projects);
    var L = [];

    L.push('# Min planering – ' + formatLong(today) + ' (vecka ' + isoWeek(today) + ')');
    L.push('');
    L = L.concat(claudeNote(none));
    L.push('');

    L.push('## Projekt');
    if (!active.length) L.push('- Inga projekt ännu');
    active.forEach(function (p) {
      var st = projectStats(p, data.tasks, today);
      var line = '- **' + p.name + '** – ';
      if (p.deadline) {
        line += 'deadline ' + formatShort(p.deadline, today) + ' (' + formatRelative(p.deadline, today) + ')';
      } else {
        line += 'ingen deadline';
      }
      line += ' · ' + st.done + ' av ' + st.total + ' klara';
      if (st.overdue) line += ' · ' + st.overdue + (st.overdue === 1 ? ' försenad' : ' försenade');
      if (st.undated) line += ' · ' + st.undated + ' utan datum';
      if (st.afterDeadline) {
        line += ' · ' + st.afterDeadline + (st.afterDeadline === 1 ? ' planerad' : ' planerade') + ' efter deadline';
      }
      L.push(line);
    });
    L.push('');

    var agenda = buildAgenda(data, today);
    L.push('## Kommande');
    agenda.sections.forEach(function (sec) {
      L.push('');
      L.push('### ' + sec.title + (sec.subtitle ? ' (' + sec.subtitle + ')' : ''));
      if (!sec.items.length) L.push('- Inget planerat');
      sec.items.forEach(function (item) {
        if (item.kind === 'deadline') {
          L.push('- ⚑ Deadline: ' + item.project.name +
            (sec.multiDay ? ' (' + formatShort(item.date, today) + ')' : ''));
          return;
        }
        var t = item.task;
        var p = t.projectId ? projects[t.projectId] : null;
        var line = item.done ? '- [x] ' : '- [ ] ';
        if (sec.multiDay) line += formatShort(t.date, today) + ' ';
        if (t.time) line += t.time + ' ';
        line += t.name + ' · ' + (p ? p.name : none);
        if (t.recurring) line += ' (' + RECURRING[t.recurring] + ')';
        L.push(line);
      });
    });
    if (agenda.someday.length) {
      L.push('');
      L.push('_' + agenda.someday.length + (agenda.someday.length === 1 ? ' uppgift' : ' uppgifter') +
        ' utan datum finns med i planen nedan._');
    }
    L.push('');

    // Planen i importformat: öppna uppgifter + det som blev klart senaste veckan
    var recentLimit = now - 7 * DAY_MS;
    function planTasks(pid) {
      return data.tasks.filter(function (t) {
        if (t.projectId !== pid) return false;
        return !t.done || (typeof t.doneAt === 'number' && t.doneAt >= recentLimit);
      }).sort(function (a, b) {
        if (a.done !== b.done) return a.done ? 1 : -1;
        return compareTasks(a, b);
      });
    }

    L.push('## Plan');
    L.push('');
    L.push('```');
    var first = true;
    function block(heading, notes, tasks) {
      if (!first) L.push('');
      first = false;
      L.push(heading);
      L = L.concat(quoteLines(notes, ''));
      tasks.forEach(function (t) {
        L.push(exportTaskLine(t));
        L = L.concat(quoteLines(t.notes, '  '));
      });
    }
    active.forEach(function (p) {
      block('## ' + escapeProjectName(p.name) + (p.deadline ? ' | deadline ' + p.deadline : ''), p.notes, planTasks(p.id));
    });
    var loose = planTasks(null);
    if (loose.length || first) block('## ' + none, '', loose);
    L.push('```');

    return L.join('\n');
  }

  // ========================================
  // Import av plan (t.ex. ett svar från Claude)
  // ========================================
  var TASK_RE = /^[-*•]\s+(?:\[([^\]]?)\]\s*)?(.+)$/;
  var RULE_RE = /^[-*_](\s*[-*_]){2,}$/;
  var HEADING_RE = /^#{1,6}\s+(.+)$/;
  var RECUR_RE = /\s*\((varje dag|varje vardag|varje vecka)\)\s*$/i;
  var RECUR_KEYS = { 'varje dag': 'daily', 'varje vardag': 'weekdays', 'varje vecka': 'weekly' };

  // Plockar ut kodblocken med en plan. Finns flera används det sista.
  function extractFenced(src) {
    var re = /(^|\n)[ \t]*(```|~~~)[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;
    var blocks = [];
    var m;
    while ((m = re.exec(src))) {
      var body = m[3];
      var useful = body.split('\n').some(function (l) {
        l = l.trim();
        return HEADING_RE.test(l) || TASK_RE.test(l);
      });
      if (useful) blocks.push(body);
    }
    return blocks;
  }

  // Delar på | som inte är skyddade med \
  function splitPipes(s) {
    var parts = [''];
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) === '\\' && s.charAt(i + 1) === '|') {
        parts[parts.length - 1] += '|';
        i++;
      } else if (s.charAt(i) === '|') {
        parts.push('');
      } else {
        parts[parts.length - 1] += s.charAt(i);
      }
    }
    return parts.map(function (x) { return x.trim(); });
  }

  function parseHeading(s) {
    var parts = splitPipes(s);
    var raw = parts[0];
    var literal = raw.charAt(0) === '\\';
    var name = literal ? raw.slice(1).trim()
      : raw.replace(/^projekt\s*:\s*/i, '').replace(/^(\*\*|__)(.+)\1$/, '$2').trim();
    var out = {
      name: name,
      isNone: !literal && NONE_RE.test(name),
      deadline: undefined,
      tasks: [],
      error: null,
      warnings: []
    };
    for (var i = 1; i < parts.length; i++) {
      var part = parts[i].replace(/\*\*|__/g, '').trim();
      if (!part) continue;
      var m = /^deadline\s*:?\s*(.*)$/i.exec(part);
      if (!m) {
        out.warnings.push('Okänd del i rubriken: "' + part + '"');
        continue;
      }
      var v = m[1].trim();
      if (!v || /^(ingen|inget|-|–|none)$/i.test(v)) out.deadline = null;
      else if (isDateStr(v)) out.deadline = v;
      else out.warnings.push('Ogiltigt datum för deadline: "' + v + '" (använd ÅÅÅÅ-MM-DD)');
    }
    if (!name) out.error = 'Rubriken saknar projektnamn';
    return out;
  }

  function parseTaskLine(mark, rest) {
    var state = 'open';
    if (mark && /[xX✓✔]/.test(mark)) state = 'done';
    else if (mark && /[-–~]/.test(mark)) state = 'remove';
    var task = { state: state, name: '', date: null, time: null, recurring: null };
    rest = rest.trim();
    var m = /^(\d{4}-\d{2}-\d{2})(?:\s+|$)/.exec(rest);
    if (m) {
      if (!isDateStr(m[1])) return { error: 'Ogiltigt datum: ' + m[1] };
      task.date = m[1];
      rest = rest.slice(m[0].length);
    }
    var literal = rest.charAt(0) === '\\';
    if (literal) {
      rest = rest.slice(1);
    } else if (task.date) {
      m = /^(\d{1,2}[:.]\d{2})(?:\s+|$)/.exec(rest);
      if (m) {
        task.time = normalizeTime(m[1]);
        if (!task.time) return { error: 'Ogiltig tid: ' + m[1] };
        rest = rest.slice(m[0].length);
      }
    }
    m = RECUR_RE.exec(rest);
    if (m && rest.charAt(m.index + m[0].indexOf('(') - 1) !== '\\') {
      task.recurring = RECUR_KEYS[m[1].toLowerCase()];
      rest = rest.slice(0, m.index);
    }
    task.name = rest.trim().replace(/\\(\((?:varje dag|varje vardag|varje vecka)\))$/i, '$1');
    if (!task.name) return { error: 'Uppgiften saknar namn' };
    return task;
  }

  function parsePlan(input) {
    var src = text(input).replace(/\r\n?/g, '\n');
    var result = { projects: [], errors: [], notes: [] };
    var blocks = extractFenced(src);
    if (blocks.length) {
      src = blocks[blocks.length - 1];
      if (blocks.length > 1) {
        result.notes.push('Texten innehöll ' + blocks.length + ' kodblock med planer – bara det sista används.');
      }
    }
    var current = null;
    src.split('\n').forEach(function (raw) {
      var line = raw.trim();
      if (!line || line.charAt(0) === '>' || RULE_RE.test(line)) return;
      var h = HEADING_RE.exec(line);
      if (h) {
        current = parseHeading(h[1]);
        if (current.error) result.errors.push({ text: line, message: current.error });
        current.warnings.forEach(function (w) { result.errors.push({ text: line, message: w }); });
        result.projects.push(current);
        return;
      }
      var t = TASK_RE.exec(line);
      if (t) {
        var task = parseTaskLine(t[1], t[2]);
        if (task.error) {
          result.errors.push({ text: line, message: task.error });
          return;
        }
        if (!current) {
          current = { name: NO_PROJECT_NAME, isNone: true, deadline: undefined, tasks: [], error: null, warnings: [] };
          result.projects.push(current);
        }
        current.tasks.push(task);
        return;
      }
      result.errors.push({ text: line, message: 'Förstod inte raden' });
    });
    return result;
  }

  function describeDate(date, time, today) {
    if (!date) return 'utan datum';
    return formatShort(date, today) + (time ? ' ' + time : '');
  }

  function taskLabel(t, today) {
    return t.name + (t.date ? ' (' + formatShort(t.date, today) + ')' : '');
  }

  // Bästa matchningen bland uppgifter med samma namn: samma status och
  // samma datum först, annars närmaste datum.
  function bestMatch(candidates, pt) {
    var wantDone = pt.state === 'done';
    var best = null;
    var bestScore = -1;
    var bestDist = Infinity;
    candidates.forEach(function (t) {
      var score = 0;
      if (t.done === wantDone) score += 4;
      if (pt.date && t.date === pt.date) score += 2;
      if (pt.date && t.date === pt.date && pt.time && t.time === pt.time) score += 1;
      var dist = pt.date && t.date ? Math.abs(diffDays(pt.date, t.date)) : 100000;
      if (score > bestScore || (score === bestScore && dist < bestDist)) {
        best = t;
        bestScore = score;
        bestDist = dist;
      }
    });
    return best;
  }

  // Tillämpar en tolkad plan på en kopia av datan. Inget ändras i originalet,
  // så appen kan visa förhandsgranskningen först.
  function applyPlan(data, parsed, today, now) {
    var next = JSON.parse(JSON.stringify(data));
    var changes = (parsed.notes || []).map(function (n) { return { type: 'note', text: n }; });
    var used = {};

    function activeProject(name) {
      var key = normName(name);
      return next.projects.filter(function (p) { return !p.archived && normName(p.name) === key; })[0] || null;
    }

    parsed.projects.forEach(function (pp) {
      if (!pp.name) return;
      // Ett riktigt projekt med samma namn vinner över "Övrigt"
      var project = activeProject(pp.name);
      if (!project && !pp.isNone) {
        project = {
          id: uid(), name: pp.name, color: nextColor(next.projects),
          deadline: pp.deadline || null, notes: '', archived: false, createdAt: now
        };
        next.projects.push(project);
        changes.push({ type: 'add', text: 'Nytt projekt: ' + pp.name +
          (project.deadline ? ' (deadline ' + formatShort(project.deadline, today) + ')' : '') });
      } else if (project && pp.deadline !== undefined && project.deadline !== pp.deadline) {
        changes.push({ type: 'change', text: pp.deadline
          ? project.name + ': deadline ' + formatShort(pp.deadline, today)
          : project.name + ': deadline borttagen' });
        project.deadline = pp.deadline;
      }
      var pid = project ? project.id : null;
      var pname = project ? project.name : NO_PROJECT_NAME;

      pp.tasks.forEach(function (pt) {
        var key = normName(pt.name);
        var task = bestMatch(next.tasks.filter(function (t) {
          return t.projectId === pid && !used[t.id] && normName(t.name) === key;
        }), pt);
        if (task) used[task.id] = true;
        var wantDone = pt.state === 'done';

        if (pt.state === 'remove') {
          if (task) {
            next.tasks = next.tasks.filter(function (t) { return t.id !== task.id; });
            changes.push({ type: 'remove', text: 'Tas bort: ' + taskLabel(task, today) + ' · ' + pname });
          } else {
            changes.push({ type: 'note', text: 'Hittade ingen "' + pt.name + '" att ta bort i ' + pname });
          }
          return;
        }

        // [x] med bara namnet ändrar inget annat än att uppgiften blir klar
        var keep = task && wantDone && !pt.date && !pt.recurring;
        var date = keep ? task.date : pt.date;
        if (!date && pt.recurring) date = (task && task.date) || today;
        var time = keep ? task.time : (date ? pt.time : null);
        var recurring = keep ? task.recurring : (date ? pt.recurring : null);

        if (!task) {
          var nt = {
            id: uid(), projectId: pid, name: pt.name, notes: '', date: date, time: time,
            recurring: recurring, done: false, doneAt: null, createdAt: now
          };
          var extra = '';
          if (wantDone) {
            nt = completeTask(nt, today, now);
            extra = nt.done ? ' (klar)' : '';
          }
          next.tasks.push(nt);
          changes.push({ type: 'add', text: 'Ny uppgift: ' + nt.name + ' – ' +
            describeDate(nt.date, nt.time, today) + extra + ' · ' + pname });
          return;
        }

        var label = taskLabel(task, today);
        var diffs = [];
        if (task.date !== date || task.time !== time) diffs.push(describeDate(date, time, today));
        if (task.recurring !== recurring) diffs.push(recurring ? RECURRING[recurring] : 'upprepas inte');
        task.date = date;
        task.time = time;
        task.recurring = recurring;
        if (wantDone && !task.done) {
          var completed = completeTask(task, today, now);
          for (var k in completed) task[k] = completed[k];
          diffs.push(task.done ? 'klar' : 'klar, nästa gång ' + formatShort(task.date, today));
        } else if (!wantDone && task.done) {
          task.done = false;
          task.doneAt = null;
          diffs.push('inte klar');
        }
        if (diffs.length) changes.push({ type: 'change', text: label + ' → ' + diffs.join(', ') + ' · ' + pname });
      });
    });

    return { data: next, changes: changes };
  }

  // ========================================
  // Säkerhetskopia
  // ========================================
  function makeBackup(data, settings, now) {
    return JSON.stringify({
      app: 'pomodoro-planering',
      version: 2,
      exportedAt: new Date(now).toISOString(),
      settings: settings || null,
      projects: data.projects,
      tasks: data.tasks,
      sessions: data.sessions
    }, null, 2);
  }

  function readBackup(json) {
    var obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.projects) || !Array.isArray(obj.tasks)) {
      throw new Error('Filen ser inte ut som en säkerhetskopia från appen.');
    }
    return { data: normalizeData(obj), settings: obj.settings || null };
  }

  return {
    WEEKDAYS: WEEKDAYS,
    WEEKDAYS_SHORT: WEEKDAYS_SHORT,
    MONTHS: MONTHS,
    MONTHS_SHORT: MONTHS_SHORT,
    PROJECT_COLORS: PROJECT_COLORS,
    NO_PROJECT_COLOR: NO_PROJECT_COLOR,
    NO_PROJECT_NAME: NO_PROJECT_NAME,
    RECURRING: RECURRING,
    toDateStr: toDateStr,
    parseDate: parseDate,
    isDateStr: isDateStr,
    addDays: addDays,
    diffDays: diffDays,
    weekdayOf: weekdayOf,
    isWeekend: isWeekend,
    startOfWeek: startOfWeek,
    isoWeek: isoWeek,
    normalizeTime: normalizeTime,
    capitalize: capitalize,
    formatDayMonth: formatDayMonth,
    formatShort: formatShort,
    formatLong: formatLong,
    formatDayHeading: formatDayHeading,
    formatRelative: formatRelative,
    formatRange: formatRange,
    formatMinutes: formatMinutes,
    formatHours: formatHours,
    uid: uid,
    nextColor: nextColor,
    isColor: isColor,
    normalizeData: normalizeData,
    migrateV1: migrateV1,
    nextOccurrence: nextOccurrence,
    completeTask: completeTask,
    compareTasks: compareTasks,
    buildAgenda: buildAgenda,
    projectStats: projectStats,
    sortProjects: sortProjects,
    focusStats: focusStats,
    exportText: exportText,
    parsePlan: parsePlan,
    applyPlan: applyPlan,
    makeBackup: makeBackup,
    readBackup: readBackup,
    noneHeading: noneHeading
  };
});
