// node tests/test_stopwatch.js: elapsed time across pauses/power-off, and its place in the notch.
const assert = require('assert');
const { elapsedAt } = require('../src/core/stopwatch');
const { pickActivity, countdown } = require('../src/core/activity');

const H = 3600 * 1000, t = Date.UTC(2026, 10, 14, 8, 0, 0);
// Paused: the saved total, whatever the clock says.
assert.strictEqual(elapsedAt({ running: false, startedAt: null, elapsed: 90000 }, t + H), 90000);
// Running: saved total + time since the last start, including hours the laptop was off.
assert.strictEqual(elapsedAt({ running: true, startedAt: t, elapsed: 90000 }, t + 8 * H), 8 * H + 90000);
// Clock set back before the start: never negative, never less than the saved total.
assert.strictEqual(elapsedAt({ running: true, startedAt: t, elapsed: 5000 }, t - 60000), 5000);
// Counting up with countdown(now, since).
assert.strictEqual(countdown(t + 65000, t), '1:05');
assert.strictEqual(countdown(t + 2 * H + 3000, t), '2:00:03');

// Closed notch: a running stopwatch shows (counting up), lowest priority after the pomodoro.
const base = { now: t, prayer: null, pomodoro: null, todo: null };
const sw = { running: true, since: t - 65000 };
assert.strictEqual(pickActivity({ ...base, stopwatch: { running: false, since: t } }), null);
const act = pickActivity({ ...base, stopwatch: sw });
assert.strictEqual(act.icon, 'stopwatch');
assert.strictEqual(act.since, sw.since);
assert.strictEqual(act.until, undefined);
assert.strictEqual(pickActivity({ ...base, stopwatch: sw, pomodoro: { label: 'Focus', running: true, endsAt: t + 60000 } }).icon, 'timer');
console.log('test_stopwatch: ok');
