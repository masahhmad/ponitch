// node tests/test_m3_logic.js: todo quick-add parsing and live-activity priority (PLAN.md §4.5, §5).
const assert = require('assert');
const { parseTodo } = require('../src/core/todo_parse.js');
const { pickActivity, countdown, POMODORO_ALERTS } = require('../src/core/activity.js');

const now = new Date(2026, 10, 5, 10, 0); // Thu 5 Nov 2026 10:00 local
const at = (d, h, m) => new Date(2026, 10, d, h, m).getTime();

// --- parseTodo ---
assert.deepStrictEqual(parseTodo('Beli kopi', now), { title: 'Beli kopi', due: null });
assert.deepStrictEqual(parseTodo('Kirim laporan @15:30', now), { title: 'Kirim laporan', due: at(5, 15, 30) });
assert.deepStrictEqual(parseTodo('Kirim laporan 15.30', now), { title: 'Kirim laporan', due: at(5, 15, 30) });
assert.deepStrictEqual(parseTodo('besok Rapat tim', now), { title: 'Rapat tim', due: at(6, 9, 0) });
assert.deepStrictEqual(parseTodo('Rapat tim besok @08:15', now), { title: 'Rapat tim', due: at(6, 8, 15) });
assert.deepStrictEqual(parseTodo('tomorrow 7:05 run', now), { title: 'run', due: at(6, 7, 5) });
// Not times / not keywords: left in the title.
assert.deepStrictEqual(parseTodo('Bayar 25:99 tagihan', now), { title: 'Bayar 25:99 tagihan', due: null });
assert.deepStrictEqual(parseTodo('besokan', now), { title: 'besokan', due: null });
// Month boundary.
assert.strictEqual(parseTodo('besok', new Date(2026, 10, 30, 10)).due, new Date(2026, 11, 1, 9).getTime());
// Only a keyword: keep the text as title rather than an empty one.
assert.strictEqual(parseTodo('besok', now).title, 'besok');

// --- pickActivity ---
const t = now.getTime(), MIN = 60000;
const base = { now: t, prayer: null, pomodoro: null, todo: null };
assert.strictEqual(pickActivity(base), null);
const pomo = { phase: 'focus', label: 'Focus', running: true, endsAt: t + 20 * MIN };
const soon = { next: { name: 'Dzuhur', at: t + 10 * MIN }, current: null };
assert.strictEqual(pickActivity({ ...base, pomodoro: pomo }).icon, 'timer');
assert.strictEqual(pickActivity({ ...base, pomodoro: pomo }).text, 'Focus'); // the label, not the internal phase id
// Prayer within 15 min beats a running pomodoro; not when 20 min away.
assert.strictEqual(pickActivity({ ...base, pomodoro: pomo, prayer: soon }).text, 'Dzuhur');
assert.strictEqual(pickActivity({ ...base, pomodoro: pomo, prayer: { next: { name: 'Dzuhur', at: t + 20 * MIN } } }).icon, 'timer');
// Todo due soon beats prayer soon; overdue shows red until 15 min past.
const todo = { title: 'Kirim', due: t + 5 * MIN };
assert.strictEqual(pickActivity({ ...base, prayer: soon, todo }).icon, 'todo');
assert.strictEqual(pickActivity({ ...base, todo: { title: 'x', due: t - 5 * MIN } }).tint, 'red');
assert.strictEqual(pickActivity({ ...base, todo: { title: 'x', due: t - 20 * MIN } }), null);
// Prayer time just began beats everything for 5 minutes.
const nowPrayer = { next: soon.next, current: { name: 'Ashar', at: t - 2 * MIN } };
assert.strictEqual(pickActivity({ ...base, prayer: nowPrayer, todo, pomodoro: pomo }).label, 'now');
assert.strictEqual(pickActivity({ ...base, prayer: { next: soon.next, current: { name: 'Ashar', at: t - 6 * MIN } } }).text, 'Dzuhur');
// A finished pomodoro session is announced by the notch's alert, keyed by the phase that starts.
assert.strictEqual(POMODORO_ALERTS.short.title, 'Take a break!');
assert.strictEqual(POMODORO_ALERTS.long.title, 'Take a long break!');
assert.strictEqual(POMODORO_ALERTS.focus.title, 'Time to focus!');

// --- countdown ---
assert.strictEqual(countdown(t + 12 * MIN + 4000, t), '12:04');
assert.strictEqual(countdown(t + 62 * MIN + 3000, t), '1:02:03');
assert.strictEqual(countdown(t - 65000, t), '−1:05');

console.log('test_m3_logic: ok');
