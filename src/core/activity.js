// Which live activity the closed notch shows (PLAN.md §5). Pure JS so node can test the order.
const { _, N_ } = require('./i18n');
const SOON_MS = 15 * 60 * 1000;
const PRAYER_NOW_MS = 5 * 60 * 1000;
const TODO_OVERDUE_MS = 15 * 60 * 1000;

// s: {
//   now: ms,
//   prayer: { next: { name, at }, current: { name, at } | null } | null,
//   pomodoro: { label, running, endsAt } | null,
//   todo: { title, due } | null   (nearest undone todo with a due time)
//   stopwatch: { running, since } | null
//   playing: bool                 (music)
// }
// Returns { key, icon, text, until? (ms, countdown to) | since? (ms, count up from), tint } or null (music/dot decided by the notch).
function pickActivity(s) {
    const { now, prayer, pomodoro, todo, stopwatch } = s;
    if (prayer && prayer.current && now - prayer.current.at < PRAYER_NOW_MS)
        return { key: `prayer-now-${prayer.current.at}`, icon: 'prayer', text: prayer.current.name, tint: 'green', label: 'now' };
    if (todo && todo.due - now < SOON_MS && now - todo.due < TODO_OVERDUE_MS)
        return { key: `todo-${todo.due}-${todo.title}`, icon: 'todo', text: todo.title, until: todo.due, tint: todo.due < now ? 'red' : 'yellow' };
    if (prayer && prayer.next && prayer.next.at - now < SOON_MS)
        return { key: `prayer-soon-${prayer.next.at}`, icon: 'prayer', text: prayer.next.name, until: prayer.next.at, tint: 'teal' };
    if (pomodoro && pomodoro.running)
        return { key: `pomo-${pomodoro.label}-${pomodoro.endsAt}`, icon: 'timer', text: pomodoro.label, until: pomodoro.endsAt, tint: 'orange' };
    if (stopwatch && stopwatch.running)
        return { key: `stopwatch-${stopwatch.since}`, icon: 'stopwatch', text: _('Stopwatch'), since: stopwatch.since, tint: 'green' };
    return null;
}

// "12:04" / "1:02:03" until `until`; negative (overdue) gets a leading minus.
function countdown(until, now) {
    const sign = until < now ? '−' : '';
    const s = Math.floor(Math.abs(until - now) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return sign + (h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`);
}

// What the notch says when a pomodoro session runs out, by the phase that starts now.
const POMODORO_ALERTS = {
    short: { title: N_('Take a break!'), tint: 'green' },
    long: { title: N_('Take a long break!'), tint: 'green' },
    focus: { title: N_('Time to focus!'), tint: 'orange' },
};

module.exports = { pickActivity, countdown, POMODORO_ALERTS };
