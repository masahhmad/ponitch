// Stopwatch tab: big elapsed time, reset + play/pause (styled like the Pomodoro timer).
const { iconButton, centered, ticker } = require('./widgets');
const { countdown } = require('./activity');
const { _ } = require('./i18n');

// ctx: { gi, stopwatch }
function buildStopwatchTab(ctx) {
    const { Clutter, St } = ctx.gi;
    const sw = ctx.stopwatch;
    const box = new St.BoxLayout({ style_class: 'ponitch-pomodoro', x_expand: true, y_expand: true });
    const timer = new St.BoxLayout({ vertical: true, style_class: 'ponitch-pomo-timer', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    const title = new St.Label({ text: _('Work stopwatch'), style_class: 'ponitch-pomo-phase', x_align: Clutter.ActorAlign.CENTER });
    const time = new St.Label({ style_class: 'ponitch-pomo-big', x_align: Clutter.ActorAlign.CENTER });
    const controls = new St.BoxLayout({ style_class: 'ponitch-controls', x_align: Clutter.ActorAlign.CENTER });
    const toggle = iconButton('media-playback-start-symbolic', 'prominent large', () => sw.toggle());
    controls.add_child(centered(iconButton('view-refresh-symbolic', 'small', () => sw.reset())));
    controls.add_child(centered(toggle));
    [title, time, controls].forEach(a => timer.add_child(a));
    box.add_child(timer);

    const draw = () => {
        const v = sw.view;
        time.text = countdown(Date.now(), v.since); // counts up: "12:04", "1:02:03"
        toggle.setIcon(v.running ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic');
    };
    const unsub = sw.subscribe(draw);
    box.connect('destroy', unsub);
    ticker(box, 1000, draw);
    return { actor: box };
}

module.exports = { buildStopwatchTab };
