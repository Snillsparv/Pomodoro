// Kör med: node --test
var test = require('node:test');
var assert = require('node:assert/strict');
var C = require('../core.js');

var TODAY = '2026-10-07'; // onsdag, vecka 41
var NOW = new Date(2026, 9, 7, 10, 0).getTime();

function project(id, name, extra) {
  var p = { id: id, name: name, color: '#e5484d', deadline: null, notes: '', archived: false, createdAt: 1 };
  for (var k in extra) p[k] = extra[k];
  return p;
}

function task(id, name, extra) {
  var t = {
    id: id, projectId: null, name: name, notes: '', date: null, time: null,
    recurring: null, done: false, doneAt: null, createdAt: 1
  };
  for (var k in extra) t[k] = extra[k];
  return t;
}

function data(projects, tasks, sessions) {
  return C.normalizeData({ projects: projects || [], tasks: tasks || [], sessions: sessions || [] });
}

// ---------- Datum ----------
test('datumsträngar är lokala och validerade', function () {
  assert.equal(C.toDateStr(new Date(2026, 0, 5, 0, 30)), '2026-01-05');
  assert.equal(C.isDateStr('2026-02-29'), false);
  assert.equal(C.isDateStr('2028-02-29'), true);
  assert.equal(C.isDateStr('2026-1-5'), false);
  assert.equal(C.addDays('2026-10-25', 1), '2026-10-26'); // sommartid slutar
  assert.equal(C.addDays('2026-03-29', 1), '2026-03-30'); // sommartid börjar
  assert.equal(C.diffDays('2026-10-07', '2026-12-15'), 69);
  assert.equal(C.diffDays('2026-10-07', '2026-10-05'), -2);
});

test('ISO-veckor', function () {
  assert.equal(C.isoWeek('2026-10-07'), 41);
  assert.equal(C.isoWeek('2026-01-01'), 1);
  assert.equal(C.isoWeek('2026-12-31'), 53);
  assert.equal(C.isoWeek('2027-01-01'), 53);
  assert.equal(C.isoWeek('2027-01-04'), 1);
  assert.equal(C.isoWeek('2024-12-30'), 1);
  assert.equal(C.startOfWeek('2026-10-11'), '2026-10-05');
  assert.equal(C.startOfWeek('2026-10-05'), '2026-10-05');
});

test('formattering på svenska', function () {
  assert.equal(C.formatShort('2026-10-09', TODAY), 'fre 9 okt');
  assert.equal(C.formatShort('2027-01-04', TODAY), 'mån 4 jan 2027');
  assert.equal(C.formatLong(TODAY), 'onsdag 7 oktober 2026');
  assert.equal(C.formatDayHeading('2026-10-08', TODAY), 'Imorgon');
  assert.equal(C.formatDayHeading('2026-10-09', TODAY), 'Fredag 9 okt');
  assert.equal(C.formatRelative('2026-10-12', TODAY), 'om 5 dagar');
  assert.equal(C.formatRelative('2026-12-15', TODAY), 'om 9 veckor');
  assert.equal(C.formatRelative('2026-10-05', TODAY), 'för 2 dagar sedan');
  assert.equal(C.formatRange('2026-10-12', '2026-10-18', TODAY), '12–18 okt');
  assert.equal(C.formatRange('2026-10-26', '2026-11-01', TODAY), '26 okt – 1 nov');
  assert.equal(C.formatMinutes(100), '1 h 40 min');
  assert.equal(C.formatMinutes(25), '25 min');
  assert.equal(C.formatMinutes(120), '2 h');
  assert.equal(C.normalizeTime('9.05'), '09:05');
  assert.equal(C.normalizeTime('24:00'), null);
});

// ---------- Återkommande ----------
test('återkommande uppgifter flyttas till nästa tillfälle', function () {
  assert.equal(C.nextOccurrence('daily', '2026-10-04', TODAY), '2026-10-08');
  assert.equal(C.nextOccurrence('daily', TODAY, TODAY), '2026-10-08');
  assert.equal(C.nextOccurrence('weekly', '2026-10-05', TODAY), '2026-10-12');
  assert.equal(C.nextOccurrence('weekly', '2026-10-09', TODAY), '2026-10-16');
  assert.equal(C.nextOccurrence('weekdays', '2026-10-09', '2026-10-09'), '2026-10-12');
  var t = C.completeTask(task('a', 'Träna', { date: TODAY, recurring: 'weekly' }), TODAY, NOW);
  assert.equal(t.done, false);
  assert.equal(t.date, '2026-10-14');
  var u = C.completeTask(task('b', 'Ring', { date: TODAY }), TODAY, NOW);
  assert.equal(u.done, true);
  assert.equal(u.doneAt, NOW);
});

// ---------- Översikt ----------
test('översikten grupperar framåt i tid', function () {
  var d = data(
    [project('p1', 'Uppsats', { deadline: '2026-10-20' }), project('p2', 'Gammalt', { archived: true, deadline: '2026-10-10' })],
    [
      task('t1', 'Försenad', { date: '2026-10-05' }),
      task('t2', 'Möte', { date: TODAY, time: '14:00', projectId: 'p1' }),
      task('t3', 'Idag utan tid', { date: TODAY, createdAt: 0 }),
      task('t4', 'Tidigt möte', { date: TODAY, time: '08:30' }),
      task('t5', 'Imorgon', { date: '2026-10-08' }),
      task('t6', 'Fredag', { date: '2026-10-09' }),
      task('t7', 'Nästa onsdag', { date: '2026-10-14' }),
      task('t8', 'Om tre veckor', { date: '2026-10-29' }),
      task('t9', 'December', { date: '2026-12-02' }),
      task('t10', 'Nästa år', { date: '2027-02-01' }),
      task('t11', 'Någon gång'),
      task('t12', 'Arkiverat projekt', { date: TODAY, projectId: 'p2' }),
      task('t13', 'Klar idag', { date: '2026-10-01', done: true, doneAt: NOW }),
      task('t14', 'Klar förut', { date: '2026-10-01', done: true, doneAt: NOW - 3 * 86400000 })
    ]
  );
  var a = C.buildAgenda(d, TODAY);
  var keys = a.sections.map(function (s) { return s.key; });
  assert.deepEqual(keys, [
    'overdue', 'today', 'tomorrow', 'day:2026-10-09', 'week:2026-10-12', 'week:2026-10-19',
    'week:2026-10-26', 'month:2026-12', 'month:2027-02'
  ]);
  var today = a.sections[1];
  assert.deepEqual(today.items.map(function (i) { return i.task.id; }), ['t4', 't2', 't3', 't13']);
  assert.equal(today.items[3].done, true);
  var deadlineWeek = a.sections[5];
  assert.equal(deadlineWeek.title, 'Vecka 43');
  assert.equal(deadlineWeek.items[0].kind, 'deadline');
  assert.equal(a.sections[8].title, 'Februari 2027');
  assert.deepEqual(a.someday.map(function (t) { return t.id; }), ['t11']);
  assert.deepEqual(a.counts, { overdue: 1, todayOpen: 3, todayDone: 1, someday: 1 });
});

test('idag finns alltid med och passerade deadlines är försenade', function () {
  var d = data([project('p1', 'Rapport', { deadline: '2026-10-01' })], []);
  var a = C.buildAgenda(d, TODAY);
  assert.deepEqual(a.sections.map(function (s) { return s.key; }), ['overdue', 'today']);
  assert.equal(a.sections[0].items[0].kind, 'deadline');
  assert.equal(a.counts.overdue, 0);
});

test('projektstatus räknar det som behövs för deadlines', function () {
  var p = project('p1', 'Uppsats', { deadline: '2026-10-10' });
  var tasks = [
    task('a', 'A', { projectId: 'p1', done: true, doneAt: NOW }),
    task('b', 'B', { projectId: 'p1', date: '2026-10-05' }),
    task('c', 'C', { projectId: 'p1', date: '2026-10-12' }),
    task('d', 'D', { projectId: 'p1' }),
    task('e', 'E')
  ];
  var st = C.projectStats(p, tasks, TODAY);
  assert.equal(st.total, 4);
  assert.equal(st.done, 1);
  assert.equal(st.open, 3);
  assert.equal(st.undated, 1);
  assert.equal(st.overdue, 1);
  assert.equal(st.afterDeadline, 1);
  assert.equal(st.next.id, 'b');
  assert.equal(st.daysLeft, 3);
  assert.equal(st.urgency, 'urgent');
  assert.equal(C.projectStats(project('x', 'X'), tasks, TODAY).urgency, 'none');
});

test('projekt sorteras på deadline, utan deadline sist', function () {
  var sorted = C.sortProjects([
    project('a', 'A', { createdAt: 1 }),
    project('b', 'B', { deadline: '2026-12-01' }),
    project('c', 'C', { deadline: '2026-10-20' })
  ]);
  assert.deepEqual(sorted.map(function (p) { return p.id; }), ['c', 'b', 'a']);
});

// ---------- Migrering ----------
test('migrering från gamla versionen behåller allt', function () {
  var old = {
    projects: [{ id: 'p1', name: 'Jobb', color: '#e94560' }, { id: 'p2', name: 'Hem' }],
    tasks: [
      { id: 't1', projectId: 'p1', name: 'Rapport', description: 'Kapitel 2' },
      { id: 't2', projectId: 'p2', name: 'Städa', recurring: 'weekly', recurDay: 5 },
      { id: 't3', projectId: 'p1', name: 'Mejl', recurring: 'daily' },
      { id: 't4', projectId: 'borta', name: 'Föräldralös' },
      { id: 't5', projectId: 'p2', name: 'Handla' }
    ],
    sessions: [{ activity: 'Jobb — Rapport', duration: 25, date: '2026-10-06', timestamp: NOW - 86400000 }],
    schedule: { date: '2026-10-07', items: [{ taskId: 't5', done: false }, { taskId: 't5', done: true }] }
  };
  var d = C.migrateV1(old, [TODAY, TODAY], NOW);
  assert.equal(d.projects.length, 2);
  assert.equal(d.projects[0].color, '#e94560');
  assert.ok(d.projects[1].color);
  assert.equal(d.projects[0].deadline, null);
  var byId = {};
  d.tasks.forEach(function (t) { byId[t.id] = t; });
  assert.equal(byId.t1.notes, 'Kapitel 2');
  assert.equal(byId.t1.date, null);
  assert.equal(byId.t2.date, '2026-10-09'); // fredag
  assert.equal(byId.t2.recurring, 'weekly');
  assert.equal(byId.t3.date, TODAY);
  assert.equal(byId.t4.projectId, null);
  assert.equal(byId.t5.date, TODAY);
  assert.equal(d.tasks.every(function (t) { return t.done === false; }), true);
  assert.equal(d.sessions.length, 1);
});

test('migrering klarar tom och trasig data', function () {
  var d = C.migrateV1({ projects: null, tasks: [null, 5, { id: 'x' }], sessions: 'nej' }, [TODAY], NOW);
  assert.deepEqual(d.projects, []);
  assert.equal(d.tasks.length, 1);
  assert.equal(d.tasks[0].name, 'Namnlös uppgift');
  assert.deepEqual(d.sessions, []);
});

// ---------- Statistik ----------
test('fokusstatistik per dag, projekt och streak', function () {
  var d = data(
    [project('p1', 'Jobb')],
    [task('t1', 'Rapport', { projectId: 'p1' })],
    [
      { activity: 'x', duration: 25, date: TODAY, timestamp: NOW, taskId: 't1' },
      { activity: 'Jobb — Gammal', duration: 25, date: '2026-10-06', timestamp: NOW - 86400000 },
      { activity: 'Fokus', duration: 25, date: '2026-10-05', timestamp: NOW - 2 * 86400000 },
      { activity: 'Fokus', duration: 25, date: '2026-09-01', timestamp: new Date(2026, 8, 1, 10).getTime() }
    ]
  );
  var s = C.focusStats(d, TODAY, 7);
  assert.equal(s.todayCount, 1);
  assert.equal(s.todayMinutes, 25);
  assert.equal(s.streak, 3);
  assert.equal(s.byDay.length, 7);
  assert.equal(s.byDay[6].minutes, 25);
  assert.equal(s.weekMinutes, 75);
  assert.equal(s.week[0].name, 'Jobb');
  assert.equal(s.week[0].minutes, 50);
  assert.equal(s.week[1].name, 'Övrigt');
  assert.equal(s.perTask.t1, 1);
});

// ---------- Export / import ----------
function sample() {
  return data(
    [
      project('p1', 'Kandidatuppsats', { deadline: '2026-12-15', notes: 'Mål: godkänd' }),
      project('p2', 'Deklaration', { deadline: '2026-10-20' }),
      project('p3', 'Klart', { archived: true })
    ],
    [
      task('t1', 'Skriva metod', { projectId: 'p1', date: '2026-10-08' }),
      task('t2', 'Handledarmöte', { projectId: 'p1', date: '2026-10-10', time: '14:00', notes: 'Ta med utkast' }),
      task('t3', 'Läsa artiklar', { projectId: 'p1' }),
      task('t4', 'Välja ämne', { projectId: 'p1', date: '2026-10-01', done: true, doneAt: NOW - 86400000 }),
      task('t5', 'Ring banken', { date: '2026-10-05' }),
      task('t6', 'Träna', { date: TODAY, recurring: 'weekly' }),
      task('t7', 'Gammalt klart', { done: true, doneAt: NOW - 30 * 86400000 })
    ]
  );
}

test('exporten är läsbar och innehåller planen', function () {
  var out = C.exportText(sample(), TODAY, NOW);
  assert.match(out, /^# Min planering – onsdag 7 oktober 2026 \(vecka 41\)/);
  assert.match(out, /- \*\*Deklaration\*\* – deadline tis 20 okt \(om 13 dagar\) · 0 av 0 klara/);
  assert.match(out, /- \*\*Kandidatuppsats\*\* – deadline tis 15 dec \(om 9 veckor\) · 1 av 4 klara · 1 utan datum/);
  assert.match(out, /### Försenat\n- \[ \] mån 5 okt Ring banken · Övrigt/);
  assert.match(out, /### Idag \(ons 7 okt\)\n- \[ \] Träna · Övrigt \(varje vecka\)/);
  assert.match(out, /- ⚑ Deadline: Deklaration \(tis 20 okt\)/);
  assert.match(out, /## Kandidatuppsats \| deadline 2026-12-15\n> Mål: godkänd\n- \[ \] 2026-10-08 Skriva metod\n- \[ \] 2026-10-10 14:00 Handledarmöte\n  > Ta med utkast\n- \[ \] Läsa artiklar\n- \[x\] 2026-10-01 Välja ämne/);
  assert.doesNotMatch(out, /Gammalt klart/);
  assert.doesNotMatch(out, /## Klart/);
  assert.match(out, /## Övrigt\n- \[ \] 2026-10-05 Ring banken\n- \[ \] 2026-10-07 Träna \(varje vecka\)/);
});

test('export → import utan ändringar ger inga ändringar', function () {
  var d = sample();
  var out = C.exportText(d, TODAY, NOW);
  var parsed = C.parsePlan(out);
  assert.deepEqual(parsed.errors, []);
  var res = C.applyPlan(d, parsed, TODAY, NOW);
  assert.deepEqual(res.changes, []);
  assert.deepEqual(res.data, d);
});

test('import av ett svar från Claude', function () {
  var d = sample();
  var reply = [
    'Här är ett förslag:',
    '',
    '```markdown',
    '## Kandidatuppsats',
    '- [ ] 2026-10-09 Skriva metod',
    '- [x] Läsa artiklar',
    '- [ ] 2026-10-12 09:00 Skriva resultat',
    '',
    '## Deklaration | deadline 2026-10-25',
    '- [ ] 2026-10-18 Samla kvitton',
    '',
    '## Flytt | deadline 2026-11-30',
    '- [ ] 2026-11-01 Boka flyttfirma',
    '',
    '## Övrigt',
    '- [-] Ring banken',
    '- [ ] Träna (varje vecka)',
    '```',
    '',
    'Säg till om du vill ändra något!'
  ].join('\n');
  var parsed = C.parsePlan(reply);
  assert.deepEqual(parsed.errors, []);
  var res = C.applyPlan(d, parsed, TODAY, NOW);
  var n = res.data;
  var byName = {};
  n.tasks.forEach(function (t) { byName[t.name] = t; });
  assert.equal(byName['Skriva metod'].date, '2026-10-09');
  assert.equal(byName['Läsa artiklar'].done, true);
  assert.equal(byName['Skriva resultat'].time, '09:00');
  assert.equal(byName['Skriva resultat'].projectId, 'p1');
  assert.equal(byName['Ring banken'], undefined);
  assert.equal(byName['Träna'].date, TODAY);
  assert.equal(byName['Träna'].recurring, 'weekly');
  var proj = {};
  n.projects.forEach(function (p) { proj[p.name] = p; });
  assert.equal(proj.Kandidatuppsats.deadline, '2026-12-15'); // orörd utan deadline-del
  assert.equal(proj.Deklaration.deadline, '2026-10-25');
  assert.equal(proj.Flytt.deadline, '2026-11-30');
  assert.equal(byName['Boka flyttfirma'].projectId, proj.Flytt.id);
  assert.equal(byName['Handledarmöte'].date, '2026-10-10'); // inte nämnd = orörd
  var types = res.changes.map(function (c) { return c.type; }).sort();
  assert.deepEqual(types, ['add', 'add', 'add', 'add', 'change', 'change', 'change', 'remove']);
  // originalet är orört
  assert.equal(d.tasks.length, 7);
});

test('import: deadline ingen, fel och upprepning', function () {
  var d = sample();
  var parsed = C.parsePlan([
    '## Kandidatuppsats | deadline ingen',
    '- [ ] 2026-13-01 Fel datum',
    '- [ ] 25:00 Fel tid',
    'Bara text',
    '---',
    '- [x] 2026-10-07 Träna (varje vecka)'
  ].join('\n'));
  assert.equal(parsed.errors.length, 3);
  var res = C.applyPlan(d, parsed, TODAY, NOW);
  var p1 = res.data.projects.filter(function (p) { return p.id === 'p1'; })[0];
  assert.equal(p1.deadline, null);
  // "Träna" finns i Övrigt, inte i Kandidatuppsats → ny uppgift som direkt flyttas fram
  var trana = res.data.tasks.filter(function (t) { return t.name === 'Träna' && t.projectId === 'p1'; })[0];
  assert.equal(trana.date, '2026-10-14');
  assert.equal(trana.done, false);
});

test('import utan kodblock och uppgifter före rubrik', function () {
  var parsed = C.parsePlan('- [ ] 2026-10-09 Köpa present\n* Ringa mamma');
  assert.equal(parsed.projects.length, 1);
  assert.equal(parsed.projects[0].isNone, true);
  assert.equal(parsed.projects[0].tasks[1].name, 'Ringa mamma');
  assert.equal(parsed.projects[0].tasks[1].state, 'open');
  var res = C.applyPlan(data([], []), parsed, TODAY, NOW);
  assert.equal(res.data.tasks.length, 2);
  assert.equal(res.data.tasks[0].projectId, null);
});

test('säkerhetskopia går att läsa tillbaka', function () {
  var d = sample();
  var json = C.makeBackup(d, { theme: 'dark' }, NOW);
  var back = C.readBackup(json);
  assert.deepEqual(back.data, d);
  assert.equal(back.settings.theme, 'dark');
  assert.throws(function () { C.readBackup('{"hej":1}'); });
});
